/**
 * Shipment lifecycle integration tests.
 *
 * These tests are SKIPPED unless all of the following are true:
 *   - ALLOW_DB_INTEGRATION_TESTS=true
 *   - MONGODB_URI_TEST is set
 *   - MONGODB_URI_TEST differs from MONGODB_URI
 *   - the test database name contains "test"
 *   - the test database name differs from the production database name
 *
 * The suite drops the test database before and after running, so it must never
 * be pointed at the production database.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const { Shipment, Device, Alert, SensorReading } = require('../../src/models')
const {
  createShipment,
  getShipmentDetail,
  listShipments,
} = require('../../src/services/shipmentService')
const {
  updateShipment,
  scheduleShipment,
  departShipment,
  completeShipment,
  archiveShipment,
} = require('../../src/services/shipmentLifecycleService')

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
  test('shipment lifecycle database integration', { skip: SKIP_REASON }, () => {})
} else {
  const DEVICE_ID = 'CCG-TEST-ESP32-01'
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
    const departure = new Date(Date.now() - 60 * 60 * 1000)
    const arrival = new Date(Date.now() + 60 * 60 * 1000)
    const deadline = new Date(Date.now() + 3 * 60 * 60 * 1000)
    return { departure, arrival, deadline }
  }

  function baseBody(overrides = {}) {
    return {
      cargo: {
        category: 'fruits',
        produce: 'Mango',
        quantity: 120,
        unit: 'kg',
        batch: 'BATCH-TEST-1',
      },
      route: {
        origin: 'Nashik',
        destination: 'Pune',
        carrier: 'ColdMove',
        vehicle: 'Reefer Truck · TR-104',
        ...routeTimes(),
      },
      monitoring: MONITORING,
      deviceId: DEVICE_ID,
      ...overrides,
    }
  }

  // A draft without a device cannot claim any sensor is available. Omit the
  // monitoring block so the model applies its all-disabled defaults.
  function draftBody(overrides = {}) {
    return baseBody({ deviceId: null, monitoring: undefined, ...overrides })
  }

  let deviceCounter = 0

  async function makeDevice(overrides = {}) {
    deviceCounter += 1
    const deviceId = `CCG-TEST-DEVICE-${Date.now()}-${deviceCounter}`

    return Device.create({
      deviceId,
      name: `Integration test device ${deviceCounter}`,
      status: 'online',
      lastSeenAt: new Date(),
      sensors: ['temperature', 'humidity', 'shock', 'light', 'door', 'ethylene'],
      ...overrides,
      deviceId: overrides.deviceId ?? deviceId,
    })
  }

  before(async () => {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 15000 })
    await mongoose.connection.dropDatabase()
    await Promise.all([
      Shipment.ensureIndexes(),
      Device.ensureIndexes(),
      Alert.ensureIndexes(),
      SensorReading.ensureIndexes(),
    ])

    await Device.create({
      deviceId: DEVICE_ID,
      name: 'Integration test reefer',
      status: 'online',
      lastSeenAt: new Date(),
      sensors: ['temperature', 'humidity', 'shock', 'light', 'door', 'ethylene'],
    })
  })

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('create, list and detail return the approved envelopes', async () => {
    const shipment = await createShipment(baseBody())

    assert.match(shipment.shipmentId, /^SHP-\d+$/)
    assert.equal(shipment.status, 'draft')
    assert.equal(shipment.healthStatus, 'unknown')

    const detail = await getShipmentDetail(shipment.shipmentId)

    assert.equal(detail.id, shipment.shipmentId)
    assert.equal(detail.lifecycleStatus, 'draft')
    assert.equal(detail.healthStatus, 'unknown')
    assert.equal(detail.status, 'draft')
    assert.equal(detail.deviceId, DEVICE_ID)
    assert.equal(detail.timeline.length, 1)
    assert.deepEqual(detail.alertSummary, {
      open: 0,
      critical: 0,
      warning: 0,
      resolved: 0,
    })
    assert.equal(detail.latestReading, null)
    assert.equal(detail.exposure.available, false)
    assert.equal(detail.exposure.temperatureMinutesOutOfRange, null)
    assert.deepEqual(detail.incidents, [])

    const list = await listShipments({ status: 'draft', limit: '10' })

    assert.equal(list.meta.total, 1)
    assert.equal(list.meta.page, 1)
    assert.equal(list.meta.limit, 10)
    assert.equal(list.items[0].shipmentId, shipment.shipmentId)
  })

  test('automatic ids increase and remain unique', async () => {
    const first = await createShipment(draftBody())
    const second = await createShipment(draftBody())

    assert.notEqual(first.shipmentId, second.shipmentId)
    assert.ok(
      Number(second.shipmentId.slice(4)) > Number(first.shipmentId.slice(4)),
    )
  })

  test('a client-supplied duplicate id is rejected by the database', async () => {
    const id = `SHP-TEST-DUP-${Date.now()}`

    await createShipment(draftBody({ shipmentId: id }))

    await assert.rejects(
      () => createShipment(draftBody({ shipmentId: id })),
      (error) => error.code === 11000,
    )
  })

  test('schedule, depart, complete and archive enforce the lifecycle', async () => {
    const created = await createShipment(baseBody())

    await assert.rejects(
      () => completeShipment(created.shipmentId),
      (error) => error.code === 'INVALID_STATE_TRANSITION' && error.statusCode === 409,
    )

    const scheduled = await scheduleShipment(created.shipmentId, {})
    assert.equal(scheduled.status, 'scheduled')

    await assert.rejects(
      () => scheduleShipment(created.shipmentId, {}),
      (error) => error.code === 'INVALID_STATE_TRANSITION',
    )

    const inTransit = await departShipment(created.shipmentId, { at: new Date() })
    assert.equal(inTransit.status, 'in-transit')

    const progressed = await updateShipment(created.shipmentId, {
      route: { progress: 55, carrier: 'ColdMove Express' },
    })
    assert.equal(progressed.route.progress, 55)
    assert.equal(progressed.route.carrier, 'ColdMove Express')

    await assert.rejects(
      () => updateShipment(created.shipmentId, { cargo: { produce: 'Apple' } }),
      (error) => error.code === 'INVALID_STATE_TRANSITION',
    )

    await Alert.create({
      shipment: created._id,
      device: created.device,
      source: 'cargo',
      parameter: 'temperature',
      severity: 'warning',
      title: 'Temperature high',
      message: 'Temperature exceeded the warning range.',
      triggerValue: 9.1,
      threshold: { min: 2, max: 8 },
      status: 'active',
      startedAt: new Date(),
    })

    await SensorReading.create({
      shipment: created._id,
      device: created.device,
      recordedAt: new Date(),
      temperature: 9.1,
    })

    const delivered = await completeShipment(created.shipmentId, {
      source: 'operator',
    })

    assert.equal(delivered.status, 'delivered')
    assert.equal(delivered.healthStatus, 'unknown')
    assert.equal(delivered.route.progress, 100)
    assert.ok(delivered.completedAt instanceof Date)

    const activeAlerts = await Alert.find({ shipment: created._id }).lean()
    assert.equal(activeAlerts.length, 1)
    assert.equal(activeAlerts[0].status, 'active')

    assert.equal(
      await SensorReading.countDocuments({ shipment: created._id }),
      1,
      'completion keeps readings',
    )

    const archived = await archiveShipment(created.shipmentId, {})
    assert.equal(archived.status, 'archived')
    assert.ok(archived.archivedAt instanceof Date)

    assert.equal(
      await Alert.countDocuments({ shipment: created._id }),
      1,
      'archive keeps alerts',
    )
    assert.equal(
      await SensorReading.countDocuments({ shipment: created._id }),
      1,
      'archive keeps readings',
    )

    await assert.rejects(
      () => updateShipment(created.shipmentId, { cargo: { produce: 'Apple' } }),
      (error) => error.code === 'INVALID_STATE_TRANSITION',
    )

    const history = await listShipments({ status: 'history', limit: '50' })
    assert.ok(
      history.items.some((item) => item.shipmentId === created.shipmentId),
    )

    const detail = await getShipmentDetail(created.shipmentId)
    assert.equal(detail.lifecycleStatus, 'archived')
    assert.equal(detail.alerts.length, 1)
    assert.equal(detail.alertSummary.open, 1)
    assert.equal(detail.alertSummary.warning, 1)
    assert.equal(detail.objectId, String(created._id))
  })

  test('scheduling requires a device and a valid configuration', async () => {
    const draft = await createShipment(draftBody())

    await assert.rejects(
      () => scheduleShipment(draft.shipmentId, {}),
      (error) => error.code === 'DOMAIN_RULE_VIOLATION',
    )
  })

  test('a device reserved by an operational shipment cannot be reused', async () => {
    const first = await createShipment(baseBody())
    await scheduleShipment(first.shipmentId, {})

    await assert.rejects(
      () => createShipment(baseBody()),
      (error) => error.code === 'DEVICE_BUSY' && error.statusCode === 409,
    )
  })

  test('unknown shipments return a 404 ApiError', async () => {
    await assert.rejects(
      () => getShipmentDetail('SHP-DOES-NOT-EXIST'),
      (error) => error.code === 'RESOURCE_NOT_FOUND' && error.statusCode === 404,
    )
  })

  test('created shipments are persisted with timestamps', async () => {
    const draft = await createShipment(draftBody())
    const stored = await Shipment.findOne({ shipmentId: draft.shipmentId }).lean()

    assert.ok(stored)
    assert.ok(stored.createdAt instanceof Date)
    assert.ok(stored.updatedAt instanceof Date)
  })

  test('route dates are ordered before schema validation', async () => {
    const times = routeTimes()
    const device = await makeDevice()

    await assert.rejects(
      () =>
        createShipment(
          baseBody({
            status: 'scheduled',
            deviceId: device.deviceId,
            route: {
              origin: 'Nashik',
              destination: 'Pune',
              departure: times.departure,
              arrival: new Date(times.departure.getTime() - 60 * 60 * 1000),
              deadline: times.deadline,
            },
          }),
        ),
      (error) =>
        error.code === 'DOMAIN_RULE_VIOLATION' && error.statusCode === 422,
    )

    const draft = await createShipment(draftBody())
    await assert.rejects(
      () =>
        updateShipment(draft.shipmentId, {
          route: {
            arrival: new Date(times.departure.getTime() - 60 * 60 * 1000),
          },
        }),
      (error) =>
        error.code === 'DOMAIN_RULE_VIOLATION' &&
        error.statusCode === 422 &&
        error.details.some((detail) => detail.field === 'route.arrival'),
    )
  })

  test('client-supplied health and unknown fields are rejected', async () => {
    await assert.rejects(
      () => createShipment(draftBody({ healthStatus: 'critical' })),
      (error) =>
        error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
    )
  })

  test('an offline device cannot be scheduled', async () => {
    const offline = await makeDevice({
      status: 'offline',
      lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
      sensors: ['temperature'],
    })

    const draft = await createShipment(
      baseBody({ deviceId: offline.deviceId }),
    )
    assert.equal(draft.status, 'draft')

    await assert.rejects(
      () => scheduleShipment(draft.shipmentId, {}),
      (error) =>
        error.code === 'DEVICE_NOT_AVAILABLE' && error.statusCode === 409,
    )
  })

  test('departure cannot precede the planned departure time', async () => {
    const device = await makeDevice()
    const departure = new Date(Date.now() + 60 * 60 * 1000)
    const scheduled = await createShipment(
      baseBody({
        status: 'scheduled',
        deviceId: device.deviceId,
        route: {
          origin: 'Nashik',
          destination: 'Pune',
          carrier: 'ColdMove',
          vehicle: 'Reefer Truck · TR-104',
          departure,
          arrival: new Date(departure.getTime() + 60 * 60 * 1000),
          deadline: new Date(departure.getTime() + 3 * 60 * 60 * 1000),
        },
      }),
    )

    await assert.rejects(
      () =>
        departShipment(scheduled.shipmentId, {
          at: new Date(departure.getTime() - 60 * 60 * 1000),
        }),
      (error) =>
        error.code === 'DOMAIN_RULE_VIOLATION' && error.statusCode === 422,
    )
  })

  test('archive is only allowed after delivery', async () => {
    const draft = await createShipment(draftBody())

    await assert.rejects(
      () => archiveShipment(draft.shipmentId, {}),
      (error) => error.code === 'INVALID_STATE_TRANSITION' && error.statusCode === 409,
    )
  })

  test('detail resolves by ObjectId and legacy filters map to health', async () => {
    const device = await makeDevice()
    const scheduled = await createShipment(
      baseBody({ status: 'scheduled', deviceId: device.deviceId }),
    )
    await departShipment(scheduled.shipmentId, { at: new Date() })
    await Shipment.updateOne(
      { _id: scheduled._id },
      { $set: { healthStatus: 'warning' } },
    )

    const detail = await getShipmentDetail(String(scheduled._id))
    assert.equal(detail.shipmentId, scheduled.shipmentId)
    assert.equal(detail.lifecycleStatus, 'in-transit')
    assert.equal(detail.healthStatus, 'warning')
    assert.equal(detail.displayStatus, 'warning')
    assert.equal(detail.status, 'warning')

    const warningList = await listShipments({ status: 'warning', limit: '100' })
    assert.ok(
      warningList.items.some(
        (item) => item.shipmentId === scheduled.shipmentId,
      ),
    )

    const criticalList = await listShipments({ status: 'critical', limit: '100' })
    assert.equal(
      criticalList.items.some(
        (item) => item.shipmentId === scheduled.shipmentId,
      ),
      false,
    )
  })

  test('timeline events keep their action timestamps and time alias', async () => {
    const device = await makeDevice()
    const created = await createShipment(
      baseBody({ status: 'scheduled', deviceId: device.deviceId }),
    )

    const departAt = new Date()
    const completedAt = new Date(departAt.getTime() + 60 * 1000)
    const archivedAt = new Date(completedAt.getTime() + 60 * 1000)

    await departShipment(created.shipmentId, { at: departAt })
    await completeShipment(created.shipmentId, {
      completedAt,
      source: 'operator',
    })
    await archiveShipment(created.shipmentId, { archivedAt })

    const detail = await getShipmentDetail(created.shipmentId)
    const byTitle = new Map(
      detail.timeline.map((event) => [event.title, event]),
    )

    assert.equal(byTitle.get('Departed').occurredAt, departAt.toISOString())
    assert.equal(
      byTitle.get('Delivery confirmed by operator').occurredAt,
      completedAt.toISOString(),
    )
    assert.equal(byTitle.get('Record archived').occurredAt, archivedAt.toISOString())
    assert.equal(byTitle.get('Departed').time, byTitle.get('Departed').occurredAt)
  })
}
