/**
 * Device registry, heartbeat, events and assignment integration tests.
 *
 * Skipped unless a dedicated test database is explicitly configured. The
 * suite drops that database before and after running.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const { Device, DeviceEvent, Shipment } = require('../../src/models')
const {
  registerDevice,
  listDevices,
  getDeviceDetail,
  recordHeartbeat,
  recordSelfTest,
} = require('../../src/services/deviceService')
const {
  createDeviceEvent,
  listDeviceEvents,
} = require('../../src/services/deviceEventService')
const {
  assignShipmentDevice,
  releaseShipmentDevice,
  getShipmentDevice,
} = require('../../src/services/deviceAssignmentService')
const {
  createShipment,
} = require('../../src/services/shipmentService')
const {
  scheduleShipment,
  departShipment,
  updateShipment,
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
  test('device registry database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'DEV') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
  }

  function routeTimes() {
    return {
      departure: new Date(Date.now() - 60 * 60 * 1000),
      arrival: new Date(Date.now() + 60 * 60 * 1000),
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000),
    }
  }

  const MONITORING = {
    temperature: {
      available: true,
      enabled: true,
      warning: { min: 2, max: 8 },
      critical: { min: 0, max: 10 },
      escalationMinutes: 0,
    },
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
        departure: routeTimes().departure,
        arrival: routeTimes().arrival,
        deadline: routeTimes().deadline,
        ...overrides.route,
      },
      monitoring: MONITORING,
      deviceId,
      ...overrides,
    }
  }

  async function makeDevice({ sensors = ['temperature'], online = true } = {}) {
    const deviceId = nextId('DEV')
    const device = await registerDevice({
      deviceId,
      name: `Test device ${deviceId}`,
      sensors,
    })

    if (online) {
      await recordHeartbeat(deviceId, { battery: 90 })
    }

    return device
  }

  before(async () => {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 15000 })
    await mongoose.connection.dropDatabase()
    await Promise.all([
      Device.ensureIndexes(),
      Shipment.ensureIndexes(),
      DeviceEvent.ensureIndexes(),
    ])
  })

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('registration, listing and retrieval expose derived health', async () => {
    const deviceId = nextId('DEV')
    const registered = await registerDevice({
      deviceId,
      name: 'Registry device',
      sensors: ['temperature'],
      hardware: { board: 'ESP32', serial: `SN-${Date.now()}` },
    })

    assert.equal(registered.deviceId, deviceId)
    assert.equal(registered.status, 'offline')
    assert.equal(registered.connectionState, 'offline')
    assert.equal(registered.health.healthy, false)
    assert.equal(registered.health.status, 'critical')

    const list = await listDevices({ q: deviceId, limit: '10' })
    assert.equal(list.meta.total, 1)
    assert.equal(list.items[0].deviceId, deviceId)

    const detail = await getDeviceDetail(deviceId)
    assert.equal(detail.id, deviceId)
    assert.equal(detail.hardware.board, 'ESP32')
    assert.equal(detail.assignedShipment, null)
  })

  test('heartbeat makes a self-tested device fresh and healthy', async () => {
    const device = await makeDevice()

    await recordSelfTest(device.deviceId, {
      results: [{ sensorId: 'temperature', status: 'ok' }],
    })

    const heartbeat = await recordHeartbeat(device.deviceId, {
      battery: 20,
      signal: '-60 dBm',
      signalDbm: -60,
      firmware: '2.0.0',
    })

    assert.equal(heartbeat.status, 'online')
    assert.equal(heartbeat.connectionState, 'online')
    assert.equal(heartbeat.battery, 20)
    assert.equal(heartbeat.health.battery.status, 'warning')
    assert.equal(heartbeat.health.healthy, false)
    assert.ok(heartbeat.lastSeenAt)

    const connectivity = await DeviceEvent.countDocuments({
      device: heartbeat.objectId,
      type: 'connectivity',
    })
    assert.ok(connectivity >= 1)
  })

  test('a stale heartbeat is never represented as healthy', async () => {
    const device = await makeDevice()
    await recordSelfTest(device.deviceId, {
      results: [{ sensorId: 'temperature', status: 'ok' }],
    })
    await recordHeartbeat(device.deviceId, { battery: 90 })

    await Device.updateOne(
      { deviceId: device.deviceId },
      { $set: { lastSeenAt: new Date(Date.now() - 20 * 60 * 1000) } },
    )

    const detail = await getDeviceDetail(device.deviceId)
    assert.equal(detail.connectionState, 'stale')
    assert.equal(detail.health.healthy, false)
    assert.equal(detail.health.status, 'warning')

    const stale = await listDevices({ connectionState: 'stale', limit: '100' })
    assert.ok(stale.items.some((item) => item.deviceId === device.deviceId))
  })

  test('self-test evidence expires after 24 hours', async () => {
    const device = await makeDevice()
    await recordSelfTest(device.deviceId, {
      results: [{ sensorId: 'temperature', status: 'ok' }],
    })

    await Device.updateOne(
      { deviceId: device.deviceId },
      {
        $set: {
          sensorHealth: [
            {
              sensorId: 'temperature',
              status: 'ok',
              lastSelfTestAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
            },
          ],
        },
      },
    )

    const detail = await getDeviceDetail(device.deviceId)
    assert.equal(detail.health.sensors[0].selfTestExpired, true)
    assert.equal(detail.health.status, 'warning')
    assert.equal(detail.health.healthy, false)
  })

  test('device events are created and listed with pagination', async () => {
    const device = await makeDevice()

    const created = await createDeviceEvent(device.deviceId, {
      type: 'maintenance',
      severity: 'info',
      title: 'Filter replaced',
      description: 'Routine maintenance',
    })

    assert.equal(created.deviceId, device.deviceId)
    assert.equal(created.type, 'maintenance')
    assert.equal(created.severity, 'info')

    const list = await listDeviceEvents(device.deviceId, {
      type: 'maintenance',
      limit: '10',
    })

    assert.equal(list.meta.total, 1)
    assert.equal(list.meta.page, 1)
    assert.equal(list.items[0].title, 'Filter replaced')
  })

  test('assignment requires draft/scheduled and an online device to schedule', async () => {
    const device = await makeDevice({ online: false })
    const draft = await createShipment(
      shipmentBody(null, { monitoring: undefined, deviceId: null }),
    )

    const assigned = await assignShipmentDevice(draft.shipmentId, {
      deviceId: device.deviceId,
    })

    assert.equal(String(assigned.shipment.device), String(device.objectId))

    await updateShipment(draft.shipmentId, { monitoring: MONITORING })

    await assert.rejects(
      () => scheduleShipment(draft.shipmentId, {}),
      (error) => error.code === 'DEVICE_NOT_AVAILABLE' && error.statusCode === 409,
    )

    await recordHeartbeat(device.deviceId, { battery: 90 })
    const scheduled = await scheduleShipment(draft.shipmentId, {})
    assert.equal(scheduled.status, 'scheduled')

    const populated = await Device.findById(device.objectId).populate(
      'assignedShipment',
    )
    assert.equal(populated.assignedShipment.shipmentId, draft.shipmentId)

    const view = await getShipmentDevice(draft.shipmentId)
    assert.equal(view.assigned, true)
    assert.equal(view.deviceId, device.deviceId)

    await departShipment(draft.shipmentId, { at: new Date() })

    await assert.rejects(
      () =>
        assignShipmentDevice(draft.shipmentId, { deviceId: device.deviceId }),
      (error) => error.code === 'INVALID_STATE_TRANSITION' && error.statusCode === 409,
    )
  })

  test('a device cannot reserve two operational shipments', async () => {
    const device = await makeDevice()
    const first = await createShipment(
      shipmentBody(device.deviceId, { status: 'scheduled' }),
    )
    const second = await createShipment(
      shipmentBody(null, {
        status: 'draft',
        deviceId: null,
        monitoring: undefined,
      }),
    )

    await assert.rejects(
      () =>
        assignShipmentDevice(second.shipmentId, { deviceId: device.deviceId }),
      (error) => error.code === 'DEVICE_BUSY' && error.statusCode === 409,
    )

    const indexes = await Shipment.collection.indexes()
    const unique = indexes.find((index) => index.name === 'operational_device_unique')
    assert.ok(unique, 'operational_device_unique index exists')
    assert.equal(unique.unique, true)
    assert.deepEqual(unique.partialFilterExpression, {
      status: { $in: ['scheduled', 'in-transit'] },
      device: { $type: 'objectId' },
    })

    assert.equal(String(first.device), String(device.objectId))
  })

  test('concurrent assignments allow exactly one winner', async () => {
    const device = await makeDevice()
    const times = routeTimes()

    const makeScheduled = (suffix) =>
      Shipment.create({
        shipmentId: nextId(`SHP-${suffix}`),
        status: 'scheduled',
        cargo: { category: 'fruits', produce: 'Mango', quantity: 10, unit: 'kg' },
        route: {
          origin: 'Nashik',
          destination: 'Pune',
          departure: times.departure,
          arrival: times.arrival,
          deadline: times.deadline,
        },
        monitoring: MONITORING,
        device: null,
      })

    const [first, second] = await Promise.all([
      makeScheduled('A'),
      makeScheduled('B'),
    ])

    const settled = await Promise.allSettled([
      assignShipmentDevice(first.shipmentId, { deviceId: device.deviceId }),
      assignShipmentDevice(second.shipmentId, { deviceId: device.deviceId }),
    ])

    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled')
    const rejected = settled.filter((entry) => entry.status === 'rejected')

    assert.equal(fulfilled.length, 1)
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].reason.code, 'DEVICE_BUSY')
    assert.equal(rejected[0].reason.statusCode, 409)

    assert.equal(
      await Shipment.countDocuments({
        device: device.objectId,
        status: { $in: ['scheduled', 'in-transit'] },
      }),
      1,
    )
  })

  test('releasing a scheduled device returns the shipment to draft', async () => {
    const device = await makeDevice()
    const scheduled = await createShipment(
      shipmentBody(device.deviceId, { status: 'scheduled' }),
    )

    const released = await releaseShipmentDevice(scheduled.shipmentId)
    assert.equal(released.changed, true)
    assert.equal(released.returnedToDraft, true)
    assert.equal(released.shipment.status, 'draft')
    assert.equal(released.shipment.device, null)

    const populated = await Device.findById(device.objectId).populate(
      'assignedShipment',
    )
    assert.equal(populated.assignedShipment, null)

    const releaseEvent = await DeviceEvent.countDocuments({
      device: device.objectId,
      shipment: released.shipment._id,
      type: 'release',
    })
    assert.equal(releaseEvent, 1)
  })
}
