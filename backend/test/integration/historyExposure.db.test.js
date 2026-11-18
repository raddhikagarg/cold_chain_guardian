/**
 * Historical shipment and exposure integration tests.
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
  listShipmentReadings,
} = require('../../src/services/readingService')

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
  test('history and exposure database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'HX') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
  }

  const ALL_SENSORS = [
    'temperature',
    'humidity',
    'shock',
    'light',
    'door',
    'ethylene',
  ]

  const FULL_MONITORING = {
    temperature: {
      available: true,
      enabled: true,
      warning: { min: 2, max: 8 },
      critical: { min: 0, max: 10 },
      escalationMinutes: 0,
    },
    humidity: {
      available: true,
      enabled: true,
      warning: { min: 80, max: 95 },
      critical: { min: 70, max: 100 },
      escalationMinutes: 0,
    },
    shock: {
      available: true,
      enabled: true,
      warning: { min: null, max: 2 },
      critical: { min: null, max: 4 },
      escalationMinutes: 0,
    },
    light: {
      available: true,
      enabled: true,
      warning: { min: null, max: 500 },
      critical: { min: null, max: 800 },
      escalationMinutes: 0,
    },
    door: {
      available: true,
      enabled: true,
      expectedState: 'closed',
      warning: { maxOpenMinutes: 5 },
      critical: { maxOpenMinutes: 15 },
      escalationMinutes: 0,
    },
    ethylene: {
      available: true,
      enabled: true,
      warning: { min: null, max: 2 },
      critical: { min: null, max: 5 },
      escalationMinutes: 0,
    },
  }

  const TEMPERATURE_ONLY = {
    temperature: FULL_MONITORING.temperature,
  }

  function routeTimes() {
    return {
      departure: new Date(Date.now() - 2 * 60 * 60 * 1000),
      arrival: new Date(Date.now() + 60 * 60 * 1000),
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000),
    }
  }

  function shipmentBody(deviceId, monitoring, overrides = {}) {
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
      monitoring,
      deviceId,
      status: 'scheduled',
      ...overrides,
    }
  }

  async function makeDevice(sensors = ALL_SENSORS) {
    const deviceId = nextId('DEV')
    await registerDevice({
      deviceId,
      name: `History device ${deviceId}`,
      sensors,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    await recordSelfTest(deviceId, {
      results: sensors.map((sensorId) => ({ sensorId, status: 'ok' })),
    })
    return deviceId
  }

  async function makeInTransit({ monitoring = TEMPERATURE_ONLY, sensors } = {}) {
    const deviceId = await makeDevice(sensors)
    const created = await createShipment(
      shipmentBody(deviceId, monitoring),
    )
    const departed = await departShipment(created.shipmentId, {
      at: new Date(),
    })
    return { deviceId, shipment: departed }
  }

  async function finish(shipment, { archive = true } = {}) {
    const completedAt = new Date()
    await completeShipment(shipment.shipmentId, {
      completedAt,
      source: 'operator',
    })

    if (archive) {
      await archiveShipment(shipment.shipmentId, {
        archivedAt: new Date(completedAt.getTime() + 60 * 1000),
      })
    }
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

  test('completed and archived shipments keep readings, alerts and timeline history', async () => {
    const { deviceId, shipment } = await makeInTransit()

    await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 9,
      humidity: 85,
      doorOpen: false,
    })

    const beforeComplete = await getShipmentDetail(shipment.shipmentId)
    assert.equal(beforeComplete.alerts.length, 1)
    assert.equal(beforeComplete.alerts[0].status, 'active')

    await finish(shipment)

    const history = await getShipmentDetail(shipment.shipmentId)
    assert.equal(history.status, 'archived')
    assert.equal(history.lifecycleStatus, 'archived')
    assert.equal(history.healthStatus, 'warning')
    assert.equal(history.alerts.length, 1)
    assert.equal(history.alerts[0].status, 'active')
    assert.equal(history.alerts[0].resolvedAt, null)
    assert.ok(history.completedAt)
    assert.ok(history.archivedAt)
    assert.deepEqual(history.incidents, [])
    assert.ok(Array.isArray(history.timeline))
    assert.ok(history.timeline.length > 0)
    for (const entry of history.timeline) {
      assert.ok(entry.id)
      assert.equal(entry.time, entry.occurredAt)
    }

    const readings = await listShipmentReadings(shipment.shipmentId, {})
    assert.equal(readings.meta.total, 1)
    assert.equal(readings.items[0].temperature, 9)
    assert.ok(readings.items[0].id)
    assert.ok(readings.items[0].objectId)

    const storedAlert = await Alert.findOne({ shipment: shipment._id }).lean()
    assert.equal(storedAlert.status, 'active')
    assert.equal(storedAlert.resolvedAt, null)
  })

  test('exposure is derived from eligible stored readings only', async () => {
    const { deviceId, shipment } = await makeInTransit({
      monitoring: FULL_MONITORING,
    })
    await finish(shipment)

    const device = await Device.findOne({ deviceId })
    const base = new Date('2026-11-15T10:00:00.000Z')

    await SensorReading.create([
      {
        shipment: shipment._id,
        device: device._id,
        recordedAt: base,
        temperature: 12,
        humidity: 90,
        shock: 0.5,
        light: 100,
        ethylene: 0.5,
        doorOpen: true,
        evaluationSkipped: false,
      },
      {
        shipment: shipment._id,
        device: device._id,
        recordedAt: new Date(base.getTime() + 5 * 60 * 1000),
        temperature: 12,
        humidity: 97,
        shock: 3.2,
        light: 200,
        ethylene: 1.1,
        doorOpen: true,
        evaluationSkipped: false,
      },
      {
        shipment: shipment._id,
        device: device._id,
        recordedAt: new Date(base.getTime() + 10 * 60 * 1000),
        temperature: 4,
        humidity: 85,
        shock: 0.8,
        light: 300,
        ethylene: 0.7,
        doorOpen: false,
        evaluationSkipped: false,
      },
      // Ineligible reading: must never feed exposure.
      {
        shipment: shipment._id,
        device: device._id,
        recordedAt: new Date(base.getTime() + 15 * 60 * 1000),
        temperature: 20,
        shock: 9,
        evaluationSkipped: true,
        skipReason: 'stale',
      },
    ])

    const history = await getShipmentDetail(shipment.shipmentId)
    const exposure = history.exposure

    assert.equal(exposure.available, true)
    assert.equal(exposure.estimated, true)
    assert.equal(exposure.evidence.readings, 3)
    assert.equal(exposure.temperatureMinutesOutOfRange, 10)
    assert.equal(exposure.humidityMinutesOutOfRange, 5)
    assert.equal(exposure.shockEvents, 1)
    assert.equal(exposure.peakShockG, 3.2)
    assert.equal(exposure.doorOpenSeconds, 600)
    assert.equal(exposure.peakEthylenePpm, 1.1)
    assert.equal(exposure.avgLightLux, 200)
    assert.match(exposure.note, /Not a direct measurement/)
  })

  test('insufficient evidence is distinguishable from a zero exposure', async () => {
    const empty = await makeInTransit()
    await finish(empty.shipment)

    const emptyHistory = await getShipmentDetail(empty.shipment.shipmentId)
    assert.equal(emptyHistory.exposure.available, false)
    assert.equal(emptyHistory.exposure.temperatureMinutesOutOfRange, null)
    assert.equal(emptyHistory.exposure.shockEvents, null)

    const measured = await makeInTransit()
    await finish(measured.shipment)
    const device = await Device.findOne({ deviceId: measured.deviceId })
    const base = new Date('2026-11-15T10:00:00.000Z')

    await SensorReading.create([
      {
        shipment: measured.shipment._id,
        device: device._id,
        recordedAt: base,
        temperature: 4,
        evaluationSkipped: false,
      },
      {
        shipment: measured.shipment._id,
        device: device._id,
        recordedAt: new Date(base.getTime() + 5 * 60 * 1000),
        temperature: 5,
        evaluationSkipped: false,
      },
    ])

    const measuredHistory = await getShipmentDetail(measured.shipment.shipmentId)
    assert.equal(measuredHistory.exposure.available, true)
    assert.equal(measuredHistory.exposure.temperatureMinutesOutOfRange, 0)
  })
}
