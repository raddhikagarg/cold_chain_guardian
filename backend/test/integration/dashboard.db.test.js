/**
 * Dashboard aggregate integration tests.
 *
 * Skipped unless a dedicated test database is explicitly configured. The
 * suite drops that database before and after running and clears documents
 * between tests.
 */

const { test, before, after, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const { Alert, Device, SensorReading, Shipment } = require('../../src/models')
const {
  registerDevice,
  recordHeartbeat,
  recordSelfTest,
} = require('../../src/services/deviceService')
const { createShipment } = require('../../src/services/shipmentService')
const {
  departShipment,
  completeShipment,
  archiveShipment,
} = require('../../src/services/shipmentLifecycleService')
const { ingestReading } = require('../../src/services/readingService')
const { getDashboardOverview } = require('../../src/services/dashboardService')

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
  test('dashboard database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'DB') {
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
      name: `Dashboard device ${deviceId}`,
      sensors: SENSORS,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    await recordSelfTest(deviceId, {
      results: SENSORS.map((sensorId) => ({ sensorId, status: 'ok' })),
    })
    return deviceId
  }

  async function makeScheduled(overrides = {}) {
    const deviceId = overrides.deviceId ?? (await makeDevice())
    const created = await createShipment({
      ...shipmentBody(deviceId, { status: 'scheduled', ...overrides }),
      status: 'scheduled',
    })
    return { deviceId, shipment: created }
  }

  async function makeInTransit(overrides = {}) {
    const scheduled = await makeScheduled(overrides)
    const departed = await departShipment(scheduled.shipment.shipmentId, {
      at: new Date(),
    })
    return { deviceId: scheduled.deviceId, shipment: departed }
  }

  async function makeCompleted({ archive = false, overrides = {} } = {}) {
    const { deviceId, shipment } = await makeInTransit(overrides)
    const completedAt = new Date()
    const delivered = await completeShipment(shipment.shipmentId, {
      completedAt,
      source: 'operator',
    })

    let archived = null
    if (archive) {
      archived = await archiveShipment(shipment.shipmentId, {
        archivedAt: new Date(completedAt.getTime() + 60 * 1000),
      })
    }

    return { deviceId, shipment: archived ?? delivered, completedAt }
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

  beforeEach(async () => {
    await Promise.all([
      Alert.deleteMany({}),
      SensorReading.deleteMany({}),
      Shipment.deleteMany({}),
      Device.deleteMany({}),
    ])
  })

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('fleet overview counts operational shipments, alerts and devices', async () => {
    const scheduled = await makeScheduled()
    const transit = await makeInTransit()
    const completed = await makeCompleted()
    const archived = await makeCompleted({ archive: true })

    const transitDevice = await Device.findOne({ deviceId: transit.deviceId })

    await Alert.create({
      shipment: transit.shipment._id,
      device: transitDevice._id,
      source: 'cargo',
      parameter: 'temperature',
      severity: 'warning',
      title: 'Temperature warning',
      message: 'Temperature breached the warning limit.',
      startedAt: new Date(),
      status: 'active',
    })
    await Alert.create({
      shipment: transit.shipment._id,
      device: transitDevice._id,
      source: 'system',
      systemType: 'offline',
      parameter: 'device',
      severity: 'critical',
      title: 'Device offline',
      message: 'No heartbeat was received.',
      startedAt: new Date(),
      status: 'active',
    })
    await Alert.create({
      shipment: completed.shipment._id,
      device: null,
      source: 'cargo',
      parameter: 'temperature',
      severity: 'critical',
      title: 'Historical alert',
      message: 'This alert belongs to a delivered shipment.',
      startedAt: new Date(),
      status: 'active',
    })

    const overview = await getDashboardOverview({})
    const { fleet } = overview.data

    assert.equal(overview.data.selectedShipment, null)
    assert.equal(overview.meta.selected, false)
    assert.equal(fleet.operational, 2)
    assert.deepEqual(fleet.statusCounts, {
      scheduled: 1,
      inTransit: 1,
      draft: 0,
      delivered: 1,
      completed: 1,
      archived: 1,
      total: 4,
    })

    assert.equal(
      fleet.cargoHealth.healthy +
        fleet.cargoHealth.warning +
        fleet.cargoHealth.critical +
        fleet.cargoHealth.unknown,
      2,
    )

    // Only alerts on operational shipments are part of the live fleet.
    assert.equal(fleet.alerts.total, 2)
    assert.equal(fleet.alerts.bySeverity.critical, 1)
    assert.equal(fleet.alerts.bySeverity.warning, 1)
    assert.equal(fleet.alerts.byType.cargo, 1)
    assert.equal(fleet.alerts.byType.offline, 1)

    assert.equal(fleet.devices.assigned, 2)
    assert.ok(fleet.devices.registered >= 4)
    assert.ok(fleet.devices.available >= 2)
    assert.equal(
      fleet.devices.connection.online +
        fleet.devices.connection.stale +
        fleet.devices.connection.offline,
      2,
    )

    assert.ok(scheduled.shipment.shipmentId)
    assert.ok(archived.shipment.shipmentId)
  })

  test('a selected operational shipment includes live context and current readings', async () => {
    const { deviceId, shipment } = await makeInTransit()
    await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 4,
    })

    const device = await Device.findOne({ deviceId })
    await Alert.create({
      shipment: shipment._id,
      device: device._id,
      source: 'cargo',
      parameter: 'temperature',
      severity: 'warning',
      title: 'Temperature warning',
      message: 'Temperature breached the warning limit.',
      startedAt: new Date(),
      status: 'active',
    })

    await Shipment.updateOne(
      { _id: shipment._id },
      { $set: { healthStatus: 'warning' } },
    )

    const overview = await getDashboardOverview({
      shipmentId: shipment.shipmentId,
    })
    const selected = overview.data.selectedShipment

    assert.ok(selected)
    assert.equal(overview.meta.selected, true)
    assert.equal(selected.shipment.shipmentId, shipment.shipmentId)
    assert.equal(selected.shipment.lifecycleStatus, 'in-transit')
    assert.equal(selected.shipment.status, 'warning')
    assert.equal(selected.operational.lifecycleStatus, 'in-transit')
    assert.equal(selected.shipment.healthStatus, 'warning')

    assert.equal(selected.device.deviceId, deviceId)
    assert.equal(selected.device.health.status, 'healthy')

    assert.equal(selected.alerts.length, 1)
    assert.equal(selected.alertSummary.open, 1)
    assert.equal(selected.monitoring.temperature.enabled, true)

    assert.equal(selected.latestReading.temperature, 4)
    assert.equal(selected.latestReading.eligible, true)
    assert.equal(selected.latestReading.current, true)
    assert.equal(selected.readingFreshness.state, 'current')

    assert.ok(Array.isArray(selected.timeline))
    assert.ok(selected.timeline.length > 0)
    assert.ok(selected.timeline[0].id)
    assert.equal(selected.timeline[0].time, selected.timeline[0].occurredAt)
    assert.deepEqual(selected.shipment.incidents, [])

    assert.equal(selected.shipment.exposure.available, true)
    assert.equal(selected.shipment.exposure.temperatureMinutesOutOfRange, 0)
  })

  test('unknown, completed and archived shipments return 404 instead of another shipment', async () => {
    const delivered = await makeCompleted()
    const archived = await makeCompleted({ archive: true })

    for (const identifier of [
      'SHP-DOES-NOT-EXIST',
      delivered.shipment.shipmentId,
      archived.shipment.shipmentId,
    ]) {
      await assert.rejects(
        () => getDashboardOverview({ shipmentId: identifier }),
        (error) => error.statusCode === 404,
      )
    }
  })

  test('stale or offline devices are never reported as current readings', async () => {
    const { deviceId, shipment } = await makeInTransit()

    const device = await Device.findOne({ deviceId })
    device.status = 'offline'
    device.lastSeenAt = new Date(Date.now() - 60 * 60 * 1000)
    await device.save()

    await SensorReading.create({
      shipment: shipment._id,
      device: device._id,
      recordedAt: new Date(Date.now() - 30 * 60 * 1000),
      temperature: 4,
      evaluationSkipped: false,
      stale: false,
    })

    const overview = await getDashboardOverview({
      shipmentId: shipment.shipmentId,
    })
    const selected = overview.data.selectedShipment

    assert.equal(selected.latestReading.temperature, 4)
    assert.equal(selected.latestReading.current, false)
    assert.equal(selected.readingFreshness.current, false)
    assert.equal(selected.readingFreshness.state, 'not-current')
    assert.equal(selected.readingFreshness.deviceConnectionState, 'offline')
  })
}
