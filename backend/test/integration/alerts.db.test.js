/**
 * Alert query, lifecycle and system-alert integration tests.
 *
 * Skipped unless a dedicated test database is explicitly configured. The
 * suite drops that database before and after running.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const { Alert, Device, SensorReading, Shipment } = require('../../src/models')
const {
  registerDevice,
  recordHeartbeat,
  recordSelfTest,
} = require('../../src/services/deviceService')
const {
  createShipment,
  getShipmentDetail,
} = require('../../src/services/shipmentService')
const {
  departShipment,
  completeShipment,
  archiveShipment,
} = require('../../src/services/shipmentLifecycleService')
const {
  ingestReading,
} = require('../../src/services/readingService')
const {
  listAlerts,
  getAlertDetail,
  acknowledgeAlert,
  resolveAlert,
} = require('../../src/services/alertService')
const {
  evaluateSystemAlertsForShipment,
} = require('../../src/services/systemAlertService')

const TEST_URI = process.env.MONGODB_URI_TEST
const PRODUCTION_URI = process.env.MONGODB_URI
const ALLOWED = process.env.ALLOW_DB_INTEGRATION_TESTS === 'true'

function databaseName(uri) {
  if (!uri) return ''
  try {
    const parsed = new URL(uri)
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  } catch {
    return ''
  }
}

function guardReason() {
  const testDatabase = databaseName(TEST_URI)
  const productionDatabase = databaseName(PRODUCTION_URI)

  if (!ALLOWED) return 'ALLOW_DB_INTEGRATION_TESTS is not "true".'
  if (!TEST_URI) return 'MONGODB_URI_TEST is not configured.'
  if (TEST_URI === PRODUCTION_URI) {
    return 'MONGODB_URI_TEST is identical to MONGODB_URI.'
  }
  if (!/test/i.test(testDatabase)) {
    return 'The test database name must contain "test".'
  }
  if (productionDatabase && testDatabase === productionDatabase) {
    return 'The test database is the production database.'
  }
  return null
}

const SKIP_REASON = guardReason()

if (SKIP_REASON) {
  test('alert database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'AL') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
  }

  const SENSORS = ['temperature', 'humidity', 'door']

  const MONITORING = {
    temperature: {
      available: true,
      enabled: true,
      warning: { min: 2, max: 8 },
      critical: { min: 0, max: 10 },
      escalationMinutes: 0,
    },
  }

  function routeTimes() {
    return {
      departure: new Date(Date.now() - 60 * 60 * 1000),
      arrival: new Date(Date.now() + 60 * 60 * 1000),
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000),
    }
  }

  function shipmentBody(deviceId, overrides = {}) {
    return {
      cargo: {
        category: 'fruits',
        produce: 'Mango',
        quantity: 100,
        unit: 'kg',
      },
      route: {
        origin: 'Nashik',
        destination: 'Pune',
        ...routeTimes(),
      },
      monitoring: MONITORING,
      deviceId,
      ...overrides,
    }
  }

  async function makeDevice() {
    const deviceId = nextId('DEV')
    await registerDevice({
      deviceId,
      name: `Alert device ${deviceId}`,
      sensors: SENSORS,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    await recordSelfTest(deviceId, {
      results: SENSORS.map((sensorId) => ({ sensorId, status: 'ok' })),
    })
    return deviceId
  }

  async function makeInTransit(overrides = {}) {
    const deviceId = overrides.deviceId ?? (await makeDevice())
    const created = await createShipment(
      shipmentBody(deviceId, { status: 'scheduled', ...overrides }),
    )
    const departed = await departShipment(created.shipmentId, {
      at: new Date(),
    })
    return { deviceId, shipment: departed }
  }

  async function reloadShipment(shipmentId) {
    return Shipment.findOne({ shipmentId })
  }

  async function makeAlert(shipment, deviceId, overrides = {}) {
    const device = await Device.findOne({ deviceId })
    return Alert.create({
      shipment: shipment._id,
      device: device?._id ?? null,
      source: 'cargo',
      parameter: 'temperature',
      severity: 'warning',
      title: 'Temperature out of range',
      message: 'Temperature breached the warning limit.',
      startedAt: new Date(),
      status: 'active',
      ...overrides,
    })
  }

  before(async () => {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 15000 })
    await mongoose.connection.dropDatabase()
    await Promise.all([
      Device.ensureIndexes(),
      Shipment.ensureIndexes(),
      SensorReading.ensureIndexes(),
      Alert.ensureIndexes(),
    ])
  })

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('alerts can be listed, retrieved, acknowledged and resolved once', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const alert = await makeAlert(shipment, deviceId)

    const list = await listAlerts({ shipmentId: shipment.shipmentId })
    assert.equal(list.meta.total, 1)
    assert.equal(list.meta.limit, 20)
    assert.equal(list.items[0].id, String(alert._id))
    assert.equal(list.items[0].shipmentId, shipment.shipmentId)
    assert.equal(list.items[0].deviceId, deviceId)
    assert.equal(list.items[0].status, 'active')
    assert.equal(list.items[0].recovered, false)

    const detail = await getAlertDetail(alert._id)
    assert.equal(detail.title, 'Temperature out of range')
    assert.ok(detail.createdAt)

    const acknowledged = await acknowledgeAlert(alert._id, {})
    assert.equal(acknowledged.status, 'acknowledged')
    assert.ok(acknowledged.acknowledgedAt)

    await assert.rejects(
      () => acknowledgeAlert(alert._id, {}),
      (error) => error.statusCode === 409 && error.code === 'ALERT_ALREADY_ACKNOWLEDGED',
    )

    const resolved = await resolveAlert(alert._id, {
      resolutionNote: 'Checked the reefer',
      resolvedBy: 'Operator 7',
    })
    assert.equal(resolved.status, 'resolved')
    assert.ok(resolved.resolvedAt)
    assert.equal(resolved.resolutionNote, 'Checked the reefer')
    assert.equal(resolved.resolvedBy, 'Operator 7')

    const stored = await Alert.findById(alert._id).lean()
    assert.equal(stored.episodeKey, undefined)

    await assert.rejects(
      () => resolveAlert(alert._id, {}),
      (error) => error.statusCode === 409 && error.code === 'ALERT_ALREADY_RESOLVED',
    )
    await assert.rejects(
      () => acknowledgeAlert(alert._id, {}),
      (error) => error.statusCode === 409 && error.code === 'ALERT_ALREADY_RESOLVED',
    )

    const open = await listAlerts({
      shipmentId: shipment.shipmentId,
      status: 'open',
    })
    assert.equal(open.meta.total, 0)
  })

  test('recovered but unresolved alerts stay open and survive completion and archiving', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const startedAt = new Date(Date.now() - 60 * 60 * 1000)
    const recoveredAt = new Date(Date.now() - 30 * 60 * 1000)
    const alert = await makeAlert(shipment, deviceId, {
      startedAt,
      recoveredAt,
    })

    const open = await listAlerts({
      shipmentId: shipment.shipmentId,
      status: 'open',
    })
    assert.equal(open.meta.total, 1)
    assert.equal(open.items[0].recovered, true)

    const completedAt = new Date()
    await completeShipment(shipment.shipmentId, {
      completedAt,
      source: 'operator',
    })
    await archiveShipment(shipment.shipmentId, {
      archivedAt: new Date(completedAt.getTime() + 60 * 1000),
    })

    const stored = await Alert.findById(alert._id).lean()
    assert.equal(stored.status, 'active')
    assert.equal(stored.resolvedAt, null)
    assert.ok(stored.recoveredAt)

    const history = await getShipmentDetail(shipment.shipmentId)
    assert.equal(history.status, 'archived')
    assert.equal(history.lifecycleStatus, 'archived')
    assert.equal(history.alerts.length, 1)
    assert.equal(history.alerts[0].status, 'active')
    assert.deepEqual(history.incidents, [])
  })

  test('alert filters honour shipment, device, legacy status and type aliases', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const device = await Device.findOne({ deviceId })

    await makeAlert(shipment, deviceId, {
      parameter: 'temperature',
      severity: 'warning',
    })
    await makeAlert(shipment, deviceId, {
      parameter: 'humidity',
      severity: 'critical',
    })
    await Alert.create({
      shipment: shipment._id,
      device: device._id,
      source: 'system',
      systemType: 'offline',
      parameter: 'device',
      severity: 'critical',
      title: 'Device offline',
      message: 'No heartbeat was received.',
      startedAt: new Date(),
      status: 'active',
    })

    const all = await listAlerts({ shipmentId: shipment.shipmentId })
    assert.equal(all.meta.total, 3)

    const critical = await listAlerts({
      shipmentId: shipment.shipmentId,
      severity: 'critical',
    })
    assert.equal(critical.meta.total, 2)

    const legacyWarning = await listAlerts({
      shipmentId: shipment.shipmentId,
      status: 'warning',
    })
    assert.equal(legacyWarning.meta.total, 1)
    assert.equal(legacyWarning.items[0].severity, 'warning')

    const cargo = await listAlerts({
      shipmentId: shipment.shipmentId,
      type: 'cargo',
    })
    assert.equal(cargo.meta.total, 2)

    const system = await listAlerts({
      shipmentId: shipment.shipmentId,
      type: 'system',
    })
    assert.equal(system.meta.total, 1)

    const offline = await listAlerts({
      shipmentId: shipment.shipmentId,
      type: 'offline',
    })
    assert.equal(offline.meta.total, 1)
    assert.equal(offline.items[0].systemType, 'offline')

    const byParameter = await listAlerts({
      shipmentId: shipment.shipmentId,
      parameter: 'temperature',
    })
    assert.equal(byParameter.meta.total, 1)

    const byDevice = await listAlerts({ deviceId })
    assert.equal(byDevice.meta.total, 3)

    const unknownShipment = await listAlerts({ shipmentId: 'SHP-DOES-NOT-EXIST' })
    assert.equal(unknownShipment.meta.total, 0)
    assert.deepEqual(unknownShipment.items, [])

    await assert.rejects(
      () => listAlerts({ status: 'nonsense' }),
      (error) => error.statusCode === 400,
    )
  })

  test('cargo episodes escalate without duplicates and reopen after resolution', async () => {
    const { deviceId, shipment } = await makeInTransit()

    await ingestReading(deviceId, {
      recordedAt: new Date(Date.now() - 60 * 1000),
      temperature: 9,
    })

    let alerts = await Alert.find({
      shipment: shipment._id,
      source: 'cargo',
      parameter: 'temperature',
    }).lean()
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].severity, 'warning')
    assert.equal(alerts[0].status, 'active')
    assert.ok(alerts[0].episodeKey)

    await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 12,
    })

    alerts = await Alert.find({
      shipment: shipment._id,
      source: 'cargo',
      parameter: 'temperature',
    }).lean()
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].severity, 'critical')

    await ingestReading(deviceId, {
      recordedAt: new Date(Date.now() + 60 * 1000),
      temperature: 4,
    })

    alerts = await Alert.find({
      shipment: shipment._id,
      source: 'cargo',
      parameter: 'temperature',
    }).lean()
    assert.equal(alerts.length, 1)
    assert.ok(alerts[0].recoveredAt)
    assert.equal(alerts[0].status, 'active')

    await resolveAlert(alerts[0]._id, { resolutionNote: 'Stable again' })

    await ingestReading(deviceId, {
      recordedAt: new Date(Date.now() + 120 * 1000),
      temperature: 9,
    })

    alerts = await Alert.find({
      shipment: shipment._id,
      source: 'cargo',
      parameter: 'temperature',
    }).sort({ startedAt: 1 }).lean()
    assert.equal(alerts.length, 2)
    assert.equal(alerts[0].status, 'resolved')
    assert.equal(alerts[1].status, 'active')
    assert.equal(alerts[1].severity, 'warning')
  })

  test('system alerts are created once and never change cargo health', async () => {
    const { deviceId, shipment } = await makeInTransit()

    const reading = await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 4,
    })
    assert.equal(reading.evaluation.cargoHealth, 'healthy')

    const device = await Device.findOne({ deviceId })
    device.status = 'offline'
    device.battery = 8
    device.lastSeenAt = new Date(Date.now() - 60 * 60 * 1000)
    await device.save()

    const shipmentDoc = await reloadShipment(shipment.shipmentId)
    const now = new Date()

    const first = await evaluateSystemAlertsForShipment(
      shipmentDoc,
      device,
      now,
    )
    assert.equal(first.evaluated, true)
    const types = first.created.map((entry) => entry.systemType).sort()
    assert.deepEqual(types, ['battery', 'offline'])

    const second = await evaluateSystemAlertsForShipment(
      shipmentDoc,
      device,
      now,
    )
    assert.equal(second.created.length, 0)

    const systemAlerts = await Alert.find({
      shipment: shipment._id,
      source: 'system',
    }).lean()
    assert.equal(systemAlerts.length, 2)
    assert.equal(
      systemAlerts.filter((alert) => alert.status !== 'resolved').length,
      2,
    )

    const unchanged = await reloadShipment(shipment.shipmentId)
    assert.equal(unchanged.healthStatus, 'healthy')

    const detail = await getShipmentDetail(shipment.shipmentId)
    assert.equal(detail.healthStatus, 'healthy')
    assert.equal(detail.alerts.length, 2)
    assert.ok(detail.alerts.every((alert) => alert.source === 'system'))
  })

  test('recovered system conditions set recoveredAt without resolving', async () => {
    const { deviceId, shipment } = await makeInTransit()

    const device = await Device.findOne({ deviceId })
    device.status = 'offline'
    device.battery = 8
    device.lastSeenAt = new Date(Date.now() - 60 * 60 * 1000)
    await device.save()

    const shipmentDoc = await reloadShipment(shipment.shipmentId)
    await evaluateSystemAlertsForShipment(shipmentDoc, device, new Date())

    device.status = 'online'
    device.battery = 90
    device.lastSeenAt = new Date()
    await device.save()

    const recovered = await evaluateSystemAlertsForShipment(
      shipmentDoc,
      device,
      new Date(),
    )
    assert.deepEqual(
      recovered.recovered.map((entry) => entry.systemType).sort(),
      ['battery', 'offline'],
    )

    const stored = await Alert.find({
      shipment: shipment._id,
      source: 'system',
    }).lean()
    assert.equal(stored.length, 2)
    for (const alert of stored) {
      assert.equal(alert.status, 'active')
      assert.ok(alert.recoveredAt)
      assert.equal(alert.resolvedAt, null)
    }
  })
}
