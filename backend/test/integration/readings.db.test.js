/**
 * Sensor reading ingestion, alert episode and query integration tests.
 *
 * Skipped unless a dedicated test database is explicitly configured. The
 * suite drops that database before and after running.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const {
  Alert,
  Device,
  SensorReading,
  Shipment,
} = require('../../src/models')
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
  scheduleShipment,
  departShipment,
  completeShipment,
  archiveShipment,
} = require('../../src/services/shipmentLifecycleService')
const {
  ingestReading,
  listShipmentReadings,
  listDeviceReadings,
  getReadingDetail,
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
  test('sensor reading database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'RD') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
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

  async function makeDevice(sensors = ['temperature', 'humidity', 'door']) {
    const deviceId = nextId('DEV')
    await registerDevice({
      deviceId,
      name: `Reading device ${deviceId}`,
      sensors,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    await recordSelfTest(deviceId, {
      results: sensors.map((sensorId) => ({ sensorId, status: 'ok' })),
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

  async function makeCompleted({ archive = false, deviceId } = {}) {
    const resolvedDeviceId = deviceId ?? (await makeDevice())
    const created = await createShipment(
      shipmentBody(resolvedDeviceId, { status: 'scheduled' }),
    )
    await departShipment(created.shipmentId, { at: new Date() })

    const completedAt = new Date(Date.now() - 30 * 60 * 1000)
    const delivered = await completeShipment(created.shipmentId, {
      completedAt,
      source: 'operator',
    })

    if (archive) {
      await archiveShipment(created.shipmentId, {
        archivedAt: new Date(completedAt.getTime() + 60 * 1000),
      })
    }

    return { deviceId: resolvedDeviceId, shipment: delivered, completedAt }
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

  test('a normal reading is stored, updates the heartbeat and evaluates cargo', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const beforeHeartbeat = await Device.findOne({ deviceId }).lean()

    const result = await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 4.2,
      humidity: 85,
    })

    assert.equal(result.evaluation.applied, true)
    assert.equal(result.evaluation.heartbeatUpdated, true)
    assert.equal(result.evaluation.skipReason, null)
    assert.equal(result.evaluation.cargoHealth, 'healthy')
    assert.equal(result.reading.evaluationSkipped, false)
    assert.equal(result.reading.late, false)
    assert.equal(String(result.reading.shipment), String(shipment._id))

    const stored = await SensorReading.findById(result.reading._id).lean()
    assert.equal(stored.temperature, 4.2)
    assert.equal(stored.humidity, 85)

    const device = await Device.findOne({ deviceId }).lean()
    assert.equal(device.status, 'online')
    assert.ok(
      new Date(device.lastSeenAt).getTime() >=
        new Date(beforeHeartbeat.lastSeenAt).getTime(),
    )

    const updatedShipment = await Shipment.findById(shipment._id).lean()
    assert.equal(updatedShipment.healthStatus, 'healthy')
    assert.equal(await Alert.countDocuments({ shipment: shipment._id }), 0)
  })

  test('a scheduled shipment accepts readings but skips cargo evaluation', async () => {
    const deviceId = await makeDevice()
    const scheduled = await createShipment(
      shipmentBody(deviceId, { status: 'scheduled' }),
    )

    const result = await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 4,
    })

    assert.equal(result.evaluation.applied, false)
    assert.equal(result.evaluation.skipReason, 'pre-departure')
    assert.equal(result.evaluation.heartbeatUpdated, true)
    assert.equal(result.reading.skipReason, 'pre-departure')

    const stored = await Shipment.findById(scheduled._id).lean()
    assert.equal(stored.healthStatus, 'unknown')
  })

  test('invalid readings and future timestamps are rejected', async () => {
    const { deviceId, shipment } = await makeInTransit()

    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(),
          temperature: 4,
          sampleId: 'packet-1',
        }),
      (error) => error.code === 'VALIDATION_ERROR' && error.statusCode === 400,
    )

    await assert.rejects(
      () => ingestReading(deviceId, { recordedAt: new Date() }),
      (error) => error.code === 'VALIDATION_ERROR',
    )

    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(),
          humidity: 150,
        }),
      (error) => error.code === 'VALIDATION_ERROR',
    )

    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(Date.now() + 6 * 60 * 1000),
          temperature: 4,
        }),
      (error) =>
        error.code === 'FUTURE_TIMESTAMP' && error.statusCode === 422,
    )

    assert.equal(
      await SensorReading.countDocuments({ shipment: shipment._id }),
      0,
    )
  })

  test('out-of-order readings are stored, flagged and skipped', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const base = Date.now() - 3 * 60 * 1000

    await ingestReading(deviceId, {
      recordedAt: new Date(base + 60 * 1000),
      temperature: 4,
    })

    const heartbeat = await Device.findOne({ deviceId }).lean()

    const older = await ingestReading(deviceId, {
      recordedAt: new Date(base),
      temperature: 9,
    })

    assert.equal(older.reading.outOfOrder, true)
    assert.equal(older.reading.evaluationSkipped, true)
    assert.equal(older.reading.skipReason, 'out-of-order')
    assert.equal(older.evaluation.applied, false)
    assert.equal(older.evaluation.heartbeatUpdated, false)

    const device = await Device.findOne({ deviceId }).lean()
    assert.equal(
      new Date(device.lastSeenAt).getTime(),
      new Date(heartbeat.lastSeenAt).getTime(),
    )

    assert.equal(await Alert.countDocuments({ shipment: shipment._id }), 0)
  })

  test('stale readings are stored, flagged and skipped', async () => {
    const { deviceId, shipment } = await makeInTransit()

    const result = await ingestReading(deviceId, {
      recordedAt: new Date(Date.now() - 30 * 60 * 1000),
      temperature: 9,
    })

    assert.equal(result.reading.stale, true)
    assert.equal(result.reading.outOfOrder, false)
    assert.equal(result.reading.evaluationSkipped, true)
    assert.equal(result.reading.skipReason, 'stale')
    assert.equal(result.evaluation.heartbeatUpdated, false)

    assert.equal(await Alert.countDocuments({ shipment: shipment._id }), 0)
  })

  test('alerts deduplicate, escalate and recover without resolving', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const base = Date.now() - 5 * 60 * 1000

    const warning = await ingestReading(deviceId, {
      recordedAt: new Date(base),
      temperature: 9,
    })
    assert.equal(warning.evaluation.cargoHealth, 'warning')

    const alerts = await Alert.find({ shipment: shipment._id }).lean()
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].severity, 'warning')
    assert.equal(alerts[0].source, 'cargo')
    assert.equal(alerts[0].parameter, 'temperature')

    const alertId = String(alerts[0]._id)

    const repeated = await ingestReading(deviceId, {
      recordedAt: new Date(base + 30 * 1000),
      temperature: 9.5,
    })
    assert.equal(repeated.evaluation.alerts.created.length, 0)
    assert.equal(
      await Alert.countDocuments({ shipment: shipment._id }),
      1,
    )

    const escalated = await ingestReading(deviceId, {
      recordedAt: new Date(base + 60 * 1000),
      temperature: 11,
    })
    assert.equal(escalated.evaluation.cargoHealth, 'critical')
    assert.equal(escalated.evaluation.alerts.escalated.length, 1)

    const afterEscalation = await Alert.findById(alertId).lean()
    assert.equal(afterEscalation.severity, 'critical')
    assert.equal(afterEscalation.status, 'active')
    assert.equal(afterEscalation.recoveredAt, null)

    const recovered = await ingestReading(deviceId, {
      recordedAt: new Date(base + 90 * 1000),
      temperature: 4,
    })
    assert.equal(recovered.evaluation.alerts.recovered.length, 1)
    assert.equal(recovered.evaluation.cargoHealth, 'critical')

    const afterRecovery = await Alert.findById(alertId).lean()
    assert.equal(afterRecovery.status, 'active')
    assert.ok(afterRecovery.recoveredAt instanceof Date)
    assert.equal(await Alert.countDocuments({ shipment: shipment._id }), 1)
  })

  test('system alerts never affect cargo health', async () => {
    const { deviceId, shipment } = await makeInTransit()

    await Alert.create({
      shipment: shipment._id,
      device: shipment.device,
      source: 'system',
      systemType: 'battery',
      parameter: 'device',
      severity: 'critical',
      title: 'Battery critical',
      message: 'Device battery is below the critical threshold.',
      triggerValue: 5,
      threshold: { max: 20 },
      startedAt: new Date(),
      status: 'active',
    })

    const result = await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 4,
    })

    assert.equal(result.evaluation.cargoHealth, 'healthy')
    const stored = await Shipment.findById(shipment._id).lean()
    assert.equal(stored.healthStatus, 'healthy')
  })

  test('late readings are stored without heartbeat, alert or health side effects', async () => {
    const { deviceId, shipment, completedAt } = await makeCompleted()

    await Shipment.updateOne(
      { _id: shipment._id },
      { $set: { healthStatus: 'warning' } },
    )

    const heartbeat = await Device.findOne({ deviceId }).lean()
    const alertCount = await Alert.countDocuments({ shipment: shipment._id })

    const recordedAt = new Date(completedAt.getTime() - 5 * 60 * 1000)
    const result = await ingestReading(deviceId, {
      recordedAt,
      temperature: 12,
    })

    assert.equal(result.reading.late, true)
    assert.equal(result.reading.lateReason, 'completed-shipment')
    assert.equal(result.reading.evaluationSkipped, true)
    assert.equal(result.reading.skipReason, 'late-completed-shipment')
    assert.equal(result.evaluation.applied, false)
    assert.equal(result.evaluation.heartbeatUpdated, false)
    assert.equal(result.evaluation.cargoHealth, 'warning')

    const device = await Device.findOne({ deviceId }).lean()
    assert.equal(
      new Date(device.lastSeenAt).getTime(),
      new Date(heartbeat.lastSeenAt).getTime(),
    )

    const stored = await Shipment.findById(shipment._id).lean()
    assert.equal(stored.healthStatus, 'warning')

    assert.equal(
      await Alert.countDocuments({ shipment: shipment._id }),
      alertCount,
    )
  })

  test('an explicit shipmentId must belong to the submitting device', async () => {
    const { shipment, completedAt } = await makeCompleted()
    const otherDevice = await makeDevice()

    await assert.rejects(
      () =>
        ingestReading(otherDevice, {
          recordedAt: new Date(completedAt.getTime() - 5 * 60 * 1000),
          temperature: 4,
          shipmentId: shipment.shipmentId,
        }),
      (error) =>
        error.code === 'LATE_READING_INVALID_SHIPMENT' &&
        error.statusCode === 422,
    )
  })

  test('late recordedAt must fall inside the shipment window', async () => {
    const { deviceId, shipment, completedAt } = await makeCompleted()

    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(
            new Date(shipment.route.departure).getTime() - 60 * 1000,
          ),
          temperature: 4,
          shipmentId: shipment.shipmentId,
        }),
      (error) =>
        error.code === 'RECORDED_AT_OUTSIDE_SHIPMENT' &&
        error.statusCode === 422,
    )

    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(completedAt.getTime() + 6 * 60 * 1000),
          temperature: 4,
          shipmentId: shipment.shipmentId,
        }),
      (error) => error.code === 'RECORDED_AT_OUTSIDE_SHIPMENT',
    )
  })

  test('late readings older than 24 hours are rejected', async () => {
    const { deviceId, shipment } = await makeCompleted()
    const oldCompletion = new Date(Date.now() - 25 * 60 * 60 * 1000)

    await Shipment.updateOne(
      { _id: shipment._id },
      { $set: { completedAt: oldCompletion } },
    )

    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(oldCompletion.getTime() - 5 * 60 * 1000),
          temperature: 4,
          shipmentId: shipment.shipmentId,
        }),
      (error) =>
        error.code === 'LATE_READING_WINDOW_EXPIRED' &&
        error.statusCode === 422,
    )
  })

  test('ambiguous late readings require an explicit shipmentId', async () => {
    const first = await makeCompleted()
    const second = await makeCompleted({ deviceId: first.deviceId })
    const deviceId = first.deviceId
    const completedAt = first.completedAt

    // Both shipments are complete and the reading falls inside both windows.
    await assert.rejects(
      () =>
        ingestReading(deviceId, {
          recordedAt: new Date(completedAt.getTime() - 5 * 60 * 1000),
          temperature: 4,
        }),
      (error) =>
        error.code === 'AMBIGUOUS_SHIPMENT' && error.statusCode === 409,
    )

    const resolved = await ingestReading(deviceId, {
      recordedAt: new Date(completedAt.getTime() - 5 * 60 * 1000),
      temperature: 4,
      shipmentId: first.shipment.shipmentId,
    })
    assert.equal(resolved.reading.late, true)
    assert.equal(String(resolved.reading.shipment), String(first.shipment._id))

    assert.notEqual(String(first.shipment._id), String(second.shipment._id))
  })

  test('archived shipments accept late readings', async () => {
    const { deviceId, shipment, completedAt } = await makeCompleted({ archive: true })

    const result = await ingestReading(deviceId, {
      recordedAt: new Date(completedAt.getTime() - 5 * 60 * 1000),
      temperature: 4,
      shipmentId: shipment.shipmentId,
    })

    assert.equal(result.reading.late, true)
    assert.equal(result.shipment.status, 'archived')
    assert.equal(await Alert.countDocuments({ shipment: shipment._id }), 0)
  })

  test('reading history supports shipment, device and date filters', async () => {
    const { deviceId, shipment } = await makeInTransit()
    const base = Date.now() - 5 * 60 * 1000

    const first = await ingestReading(deviceId, {
      recordedAt: new Date(base),
      temperature: 4,
    })
    await ingestReading(deviceId, {
      recordedAt: new Date(base + 60 * 1000),
      temperature: 5,
      humidity: 80,
    })
    await ingestReading(deviceId, {
      recordedAt: new Date(base + 120 * 1000),
      temperature: 6,
    })

    const byShipment = await listShipmentReadings(shipment.shipmentId, {
      limit: '2',
    })
    assert.equal(byShipment.meta.total, 3)
    assert.equal(byShipment.meta.limit, 2)
    assert.equal(byShipment.meta.totalPages, 2)
    assert.equal(byShipment.items.length, 2)
    assert.equal(byShipment.items[0].shipmentId, shipment.shipmentId)

    const byDevice = await listDeviceReadings(deviceId, {
      sensor: 'humidity',
    })
    assert.equal(byDevice.meta.total, 1)
    assert.equal(byDevice.items[0].humidity, 80)
    assert.equal(byDevice.items[0].display.humidity, '80 % RH')

    const byDate = await listDeviceReadings(deviceId, {
      from: new Date(base).toISOString(),
      to: new Date(base + 60 * 1000).toISOString(),
    })
    assert.equal(byDate.meta.total, 2)

    const detail = await getReadingDetail(String(first.reading._id))
    assert.equal(detail.id, String(first.reading._id))
    assert.equal(detail.deviceId, deviceId)

    await assert.rejects(
      () => listShipmentReadings(shipment.shipmentId, { limit: '501' }),
      (error) => error.code === 'INVALID_QUERY',
    )
  })

  test('completed shipments keep their cargo health and readings', async () => {
    const { deviceId, shipment } = await makeInTransit()

    await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 4,
    })

    const before = await getShipmentDetail(shipment.shipmentId)
    assert.equal(before.healthStatus, 'healthy')

    await completeShipment(shipment.shipmentId, { source: 'operator' })

    const after = await getShipmentDetail(shipment.shipmentId)
    assert.equal(after.healthStatus, 'healthy')
    assert.ok(
      await SensorReading.countDocuments({ shipment: shipment._id }),
    )
  })
}
