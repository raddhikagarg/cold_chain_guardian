/**
 * HTTP end-to-end checks for the alert and dashboard APIs.
 *
 * Skipped unless a dedicated test database is explicitly configured. This
 * suite exercises the real Express app against the test database only; the
 * production MONGODB_URI is never used.
 */

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const app = require('../../src/app')
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
  test('alert and dashboard HTTP database integration', { skip: SKIP_REASON }, () => {})
} else {
  let counter = 0

  function nextId(prefix = 'HTTP') {
    counter += 1
    return `CCG-TEST-${prefix}-${Date.now()}-${counter}`
  }

  const SENSORS = ['temperature', 'humidity', 'door']

  function routeTimes() {
    return {
      departure: new Date(Date.now() - 60 * 60 * 1000),
      arrival: new Date(Date.now() + 60 * 60 * 1000),
      deadline: new Date(Date.now() + 3 * 60 * 60 * 1000),
    }
  }

  async function makeDevice() {
    const deviceId = nextId('DEV')
    await registerDevice({
      deviceId,
      name: `HTTP device ${deviceId}`,
      sensors: SENSORS,
    })
    await recordHeartbeat(deviceId, { battery: 90 })
    await recordSelfTest(deviceId, {
      results: SENSORS.map((sensorId) => ({ sensorId, status: 'ok' })),
    })
    return deviceId
  }

  async function makeInTransit() {
    const deviceId = await makeDevice()
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
        ...routeTimes(),
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

  async function withServer(run) {
    const server = app.listen(0)
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })

    const { port } = server.address()

    try {
      return await run(`http://127.0.0.1:${port}`)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }

  async function requestJson(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, options)
    const text = await response.text()
    return {
      response,
      body: text.length > 0 ? JSON.parse(text) : null,
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

  after(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
    }
  })

  test('dashboard, alerts, acknowledgement and resolution work over HTTP', async () => {
    const { deviceId, shipment } = await makeInTransit()
    await ingestReading(deviceId, {
      recordedAt: new Date(),
      temperature: 9,
    })

    await withServer(async (baseUrl) => {
      const dashboard = await requestJson(
        baseUrl,
        `/api/dashboard/overview?shipmentId=${encodeURIComponent(shipment.shipmentId)}`,
      )
      assert.equal(dashboard.response.status, 200)
      assert.ok(dashboard.body.data.fleet)
      assert.ok(dashboard.body.data.selectedShipment)
      assert.equal(
        dashboard.body.data.selectedShipment.shipment.shipmentId,
        shipment.shipmentId,
      )
      assert.equal(dashboard.body.meta.selected, true)

      const alerts = await requestJson(
        baseUrl,
        `/api/alerts?shipmentId=${encodeURIComponent(shipment.shipmentId)}&status=open`,
      )
      assert.equal(alerts.response.status, 200)
      assert.equal(alerts.body.meta.total, 1)
      assert.ok(Array.isArray(alerts.body.data))
      const alert = alerts.body.data[0]
      assert.equal(alert.status, 'active')
      assert.equal(alert.severity, 'warning')
      assert.equal(alert.shipmentId, shipment.shipmentId)

      const detail = await requestJson(
        baseUrl,
        `/api/alerts/${encodeURIComponent(alert.id)}`,
      )
      assert.equal(detail.response.status, 200)
      assert.equal(detail.body.data.id, alert.id)

      const acknowledged = await requestJson(
        baseUrl,
        `/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      )
      assert.equal(acknowledged.response.status, 200)
      assert.equal(acknowledged.body.data.status, 'acknowledged')
      assert.ok(acknowledged.body.data.acknowledgedAt)

      const repeated = await requestJson(
        baseUrl,
        `/api/alerts/${encodeURIComponent(alert.id)}/acknowledge`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        },
      )
      assert.equal(repeated.response.status, 409)
      assert.equal(repeated.body.error.code, 'ALERT_ALREADY_ACKNOWLEDGED')

      const resolved = await requestJson(
        baseUrl,
        `/api/alerts/${encodeURIComponent(alert.id)}/resolve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resolutionNote: 'Verified by operator',
            resolvedBy: 'Operator 3',
          }),
        },
      )
      assert.equal(resolved.response.status, 200)
      assert.equal(resolved.body.data.status, 'resolved')
      assert.ok(resolved.body.data.resolvedAt)
      assert.equal(resolved.body.data.resolutionNote, 'Verified by operator')

      const open = await requestJson(
        baseUrl,
        `/api/alerts?shipmentId=${encodeURIComponent(shipment.shipmentId)}&status=open`,
      )
      assert.equal(open.body.meta.total, 0)

      const history = await requestJson(
        baseUrl,
        `/api/shipments/${encodeURIComponent(shipment.shipmentId)}`,
      )
      assert.equal(history.response.status, 200)
      assert.equal(history.body.data.lifecycleStatus, 'in-transit')
      assert.ok(history.body.data.exposure)
      assert.deepEqual(history.body.data.incidents, [])
    })
  })

  test('completed shipments return 404 on dashboard but remain readable in history', async () => {
    const { shipment } = await makeInTransit()
    const completedAt = new Date()
    await completeShipment(shipment.shipmentId, {
      completedAt,
      source: 'operator',
    })
    await archiveShipment(shipment.shipmentId, {
      archivedAt: new Date(completedAt.getTime() + 60 * 1000),
    })

    await withServer(async (baseUrl) => {
      const dashboard = await requestJson(
        baseUrl,
        `/api/dashboard/overview?shipmentId=${encodeURIComponent(shipment.shipmentId)}`,
      )
      assert.equal(dashboard.response.status, 404)
      assert.equal(dashboard.body.error.code, 'RESOURCE_NOT_FOUND')

      const history = await requestJson(
        baseUrl,
        `/api/shipments/${encodeURIComponent(shipment.shipmentId)}`,
      )
      assert.equal(history.response.status, 200)
      assert.equal(history.body.data.status, 'archived')
      assert.equal(history.body.data.lifecycleStatus, 'archived')

      const missing = await requestJson(baseUrl, '/api/alerts/AL-DOES-NOT-EXIST')
      assert.equal(missing.response.status, 404)
      assert.equal(missing.body.error.code, 'RESOURCE_NOT_FOUND')
    })
  })
}
