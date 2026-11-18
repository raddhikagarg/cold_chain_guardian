/**
 * Background offline-sweep integration tests.
 *
 * Skipped unless a dedicated test database is explicitly configured.
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
const { departShipment } = require('../../src/services/shipmentLifecycleService')
const {
  isOfflineSweepRunning,
  runOfflineSweep,
  startOfflineSweep,
  stopOfflineSweep,
} = require('../../src/services/offlineSweep')

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
  test('offline sweep database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'SW') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
  }

  const SENSORS = ['temperature', 'humidity']

  async function makeInTransit() {
    const deviceId = nextId('DEV')
    await registerDevice({
      deviceId,
      name: `Sweep device ${deviceId}`,
      sensors: SENSORS,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    await recordSelfTest(deviceId, {
      results: SENSORS.map((sensorId) => ({ sensorId, status: 'ok' })),
    })

    const created = await createShipment({
      status: 'scheduled',
      cargo: {
        category: 'fruits',
        produce: 'Mango',
        quantity: 100,
        unit: 'kg',
      },
      route: {
        origin: 'Nashik',
        destination: 'Pune',
        departure: new Date(Date.now() - 60 * 60 * 1000),
        arrival: new Date(Date.now() + 60 * 60 * 1000),
        deadline: new Date(Date.now() + 3 * 60 * 60 * 1000),
      },
      monitoring: {
        temperature: {
          available: true,
          enabled: true,
          warning: { min: 2, max: 8 },
          critical: { min: 0, max: 10 },
          escalationMinutes: 0,
        },
      },
      deviceId,
    })
    const departed = await departShipment(created.shipmentId, { at: new Date() })
    return { deviceId, shipment: departed }
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
    await stopOfflineSweep()
    await Promise.all([
      Alert.deleteMany({}),
      SensorReading.deleteMany({}),
      Shipment.deleteMany({}),
      Device.deleteMany({}),
    ])
  })

  after(async () => {
    await stopOfflineSweep()
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('a sweep creates one offline alert and never changes cargo health', async () => {
    const { deviceId, shipment } = await makeInTransit()
    await Shipment.updateOne(
      { _id: shipment._id },
      { $set: { healthStatus: 'healthy' } },
    )

    const device = await Device.findOne({ deviceId })
    device.status = 'online'
    device.lastSeenAt = new Date(Date.now() - 30 * 60 * 1000)
    await device.save()

    const first = await runOfflineSweep(new Date())
    assert.equal(first.skipped, null)
    assert.equal(first.truncated, false)
    assert.equal(first.shipments, 1)
    assert.ok(first.created >= 1)

    const offlineAlerts = await Alert.find({
      shipment: shipment._id,
      source: 'system',
      systemType: 'offline',
    }).lean()
    assert.equal(offlineAlerts.length, 1)
    assert.equal(offlineAlerts[0].status, 'active')
    assert.equal(offlineAlerts[0].severity, 'warning')

    const second = await runOfflineSweep(new Date())
    assert.equal(second.created, 0)
    assert.equal(
      await Alert.countDocuments({
        shipment: shipment._id,
        source: 'system',
        systemType: 'offline',
      }),
      1,
    )

    const cargo = await Shipment.findById(shipment._id).lean()
    assert.equal(cargo.healthStatus, 'healthy')
  })

  test('a recovered heartbeat is marked recovered but stays unresolved', async () => {
    const { deviceId, shipment } = await makeInTransit()

    const device = await Device.findOne({ deviceId })
    device.status = 'online'
    device.lastSeenAt = new Date(Date.now() - 30 * 60 * 1000)
    await device.save()

    await runOfflineSweep(new Date())

    device.lastSeenAt = new Date()
    await device.save()

    const recovered = await runOfflineSweep(new Date())
    assert.ok(recovered.recovered >= 1)
    assert.ok(
      recovered.results.some((entry) =>
        entry.recovered.some((alert) => alert.systemType === 'offline'),
      ),
    )

    const alert = await Alert.findOne({
      shipment: shipment._id,
      source: 'system',
      systemType: 'offline',
    }).lean()
    assert.equal(alert.status, 'active')
    assert.ok(alert.recoveredAt)
    assert.equal(alert.resolvedAt, null)
  })

  test('the timer starts and stops cleanly', async () => {
    assert.equal(
      startOfflineSweep({ force: true, intervalMs: 60 * 60 * 1000 }),
      true,
    )
    assert.equal(isOfflineSweepRunning(), true)

    await stopOfflineSweep()
    assert.equal(isOfflineSweepRunning(), false)
  })
}
