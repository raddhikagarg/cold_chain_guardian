/**
 * MongoDB index verification.
 *
 * Skipped unless a dedicated test database is explicitly configured.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const {
  Alert,
  Device,
  DeviceEvent,
  SensorReading,
  Shipment,
} = require('../../src/models')
const { registerDevice, recordHeartbeat } = require('../../src/services/deviceService')
const { createShipment } = require('../../src/services/shipmentService')
const { resolveAlert } = require('../../src/services/alertService')

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
  test('index verification database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'IX') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
  }

  async function makeDevice(sensors = ['temperature', 'humidity']) {
    const deviceId = nextId('DEV')
    await registerDevice({
      deviceId,
      name: `Index device ${deviceId}`,
      sensors,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    return deviceId
  }

  async function makeScheduled(deviceId) {
    return createShipment({
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
  }

  before(async () => {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 15000 })
    await mongoose.connection.dropDatabase()
    await Promise.all([
      Device.ensureIndexes(),
      Shipment.ensureIndexes(),
      SensorReading.ensureIndexes(),
      Alert.ensureIndexes(),
      DeviceEvent.ensureIndexes(),
    ])
  })

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('required alert and shipment indexes exist', async () => {
    const alertIndexes = await Alert.collection.indexes()
    const alertByName = new Map(alertIndexes.map((index) => [index.name, index]))

    const alertCode = alertByName.get('alertCode_unique_string')
    assert.ok(alertCode)
    assert.equal(alertCode.unique, true)
    assert.deepEqual(alertCode.partialFilterExpression, {
      alertCode: { $type: 'string' },
    })

    const episode = alertByName.get('alert_episode_unique')
    assert.ok(episode)
    assert.equal(episode.unique, true)
    assert.deepEqual(episode.partialFilterExpression, {
      episodeKey: { $type: 'string' },
    })

    const shipmentIndexes = await Shipment.collection.indexes()
    const operational = shipmentIndexes.find(
      (index) => index.name === 'operational_device_unique',
    )
    assert.ok(operational)
    assert.equal(operational.unique, true)
    assert.deepEqual(operational.partialFilterExpression, {
      status: { $in: ['scheduled', 'in-transit'] },
      device: { $type: 'objectId' },
    })

    assert.ok(
      shipmentIndexes.some(
        (index) =>
          index.key.status === 1 && index.key.createdAt === -1,
      ),
    )

    const readingIndexes = await SensorReading.collection.indexes()
    assert.ok(
      readingIndexes.some(
        (index) =>
          index.key.shipment === 1 && index.key.recordedAt === -1,
      ),
    )
    assert.ok(
      readingIndexes.some(
        (index) =>
          index.key.shipment === 1 &&
          index.key.evaluationSkipped === 1 &&
          index.key.recordedAt === -1,
      ),
    )
  })

  test('no TTL or automatic purge indexes exist', async () => {
    for (const model of [Shipment, Device, SensorReading, Alert, DeviceEvent]) {
      const indexes = await model.collection.indexes()
      for (const index of indexes) {
        assert.equal(
          index.expireAfterSeconds,
          undefined,
          `${model.modelName}.${index.name} must not expire documents.`,
        )
      }
    }
  })

  test('operational_device_unique rejects a second operational shipment', async () => {
    const deviceId = await makeDevice()
    const first = await makeScheduled(deviceId)
    const clone = await Shipment.findById(first._id).lean()

    delete clone._id
    clone.shipmentId = nextId('SHP')
    clone.status = 'scheduled'

    await assert.rejects(
      () => Shipment.create(clone),
      (error) => error.code === 11000,
    )

    // Delivered history does not reserve the device, so reuse is allowed.
    await Shipment.updateOne(
      { _id: first._id },
      { $set: { status: 'delivered', completedAt: new Date() } },
    )
    const reused = await Shipment.create({
      ...clone,
      shipmentId: nextId('SHP'),
    })
    assert.ok(reused._id)
  })

  test('alert episodes are unique while unresolved and reusable after resolution', async () => {
    const deviceId = await makeDevice()
    const shipment = await makeScheduled(deviceId)
    const device = await Device.findOne({ deviceId })

    const episodeKey = `system:${shipment._id}:offline:device`
    const first = await Alert.create({
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
      episodeKey,
    })

    await assert.rejects(
      () =>
        Alert.create({
          shipment: shipment._id,
          device: device._id,
          source: 'system',
          systemType: 'offline',
          parameter: 'device',
          severity: 'critical',
          title: 'Device offline',
          message: 'Duplicate condition.',
          startedAt: new Date(),
          status: 'active',
          episodeKey,
        }),
      (error) => error.code === 11000,
    )

    await resolveAlert(first._id, { resolutionNote: 'Back online' })

    const second = await Alert.create({
      shipment: shipment._id,
      device: device._id,
      source: 'system',
      systemType: 'offline',
      parameter: 'device',
      severity: 'critical',
      title: 'Device offline',
      message: 'A new episode after resolution.',
      startedAt: new Date(),
      status: 'active',
      episodeKey,
    })
    assert.ok(second._id)
  })
}
