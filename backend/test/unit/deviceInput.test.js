const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validateRegisterShape,
  validateHeartbeatShape,
  validateSelfTestShape,
  validateEventShape,
} = require('../../src/validation/deviceInput')

const NOW = Date.now()

test('minimal registration defaults to offline and trims text', () => {
  const device = validateRegisterShape({
    deviceId: '  CCG-ESP32-01  ',
    name: '  Reefer one  ',
  })

  assert.equal(device.deviceId, 'CCG-ESP32-01')
  assert.equal(device.name, 'Reefer one')
  assert.equal(device.status, 'offline')
})

test('a full registration is normalised', () => {
  const installedAt = new Date(NOW - 60 * 60 * 1000).toISOString()
  const device = validateRegisterShape({
    deviceId: 'CCG-ESP32-02',
    name: 'Reefer two',
    status: 'online',
    connectivity: 'Wi-Fi',
    signal: '-61 dBm',
    signalDbm: -61,
    battery: 92,
    firmware: '1.4.2',
    sensors: ['temperature', 'humidity', 'temperature'],
    sensorHealth: [
      {
        sensorId: 'temperature',
        status: 'ok',
        lastSelfTestAt: new Date(NOW - 60 * 1000),
        note: 'passed',
      },
    ],
    hardware: {
      board: 'ESP32 DevKit',
      serial: 'SN-1',
      installedAt,
    },
    lastBootAt: new Date(NOW - 60 * 1000),
  })

  assert.equal(device.status, 'online')
  assert.deepEqual(device.sensors, ['temperature', 'humidity'])
  assert.equal(device.sensorHealth.length, 1)
  assert.equal(device.hardware.serial, 'SN-1')
  assert.equal(device.battery, 92)
})

test('registration rejects unknown fields and invalid values', () => {
  const invalid = [
    { deviceId: 'D', name: 'N', lastSeenAt: new Date() },
    { deviceId: '', name: 'N' },
    { deviceId: 'D', name: '' },
    { deviceId: 'D', name: 'N', status: 'sleeping' },
    { deviceId: 'D', name: 'N', battery: 101 },
    { deviceId: 'D', name: 'N', signalDbm: -121 },
    { deviceId: 'D', name: 'N', sensors: ['altimeter'] },
    { deviceId: 'D', name: 'N', sensors: 'temperature' },
    {
      deviceId: 'D',
      name: 'N',
      sensors: ['temperature'],
      sensorHealth: [
        { sensorId: 'humidity', status: 'ok', lastSelfTestAt: new Date() },
      ],
    },
    { deviceId: 'D', name: 'N', lastBootAt: 'not-a-date' },
  ]

  for (const body of invalid) {
    assert.throws(
      () => validateRegisterShape(body),
      (error) => error.code === 'VALIDATION_ERROR',
    )
  }
})

test('an empty heartbeat body is valid', () => {
  assert.deepEqual(validateHeartbeatShape({}), {})
})

test('heartbeat telemetry is validated', () => {
  const heartbeat = validateHeartbeatShape({
    battery: 55,
    signal: '-70 dBm',
    signalDbm: -70,
    firmware: '1.5.0',
    connectivity: 'LTE',
    booted: true,
  })

  assert.equal(heartbeat.battery, 55)
  assert.equal(heartbeat.booted, true)

  for (const body of [
    { battery: -1 },
    { battery: 101 },
    { signalDbm: 2 },
    { booted: 'yes' },
    { lastSeenAt: new Date() },
  ]) {
    assert.throws(
      () => validateHeartbeatShape(body),
      (error) => error.code === 'VALIDATION_ERROR',
    )
  }
})

test('self-test results require at least one known sensor and status', () => {
  const shape = validateSelfTestShape({
    results: [
      { sensorId: 'temperature', status: 'ok' },
      { sensorId: 'humidity', status: 'degraded', note: 'slow' },
    ],
  })

  assert.equal(shape.results.length, 2)
  assert.ok(shape.occurredAt instanceof Date)

  assert.throws(
    () => validateSelfTestShape({ results: [] }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
  assert.throws(
    () =>
      validateSelfTestShape({
        results: [{ sensorId: 'altimeter', status: 'ok' }],
      }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
  assert.throws(
    () =>
      validateSelfTestShape({
        results: [{ sensorId: 'temperature', status: 'broken' }],
      }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
  assert.throws(
    () =>
      validateSelfTestShape({
        results: [
          { sensorId: 'temperature', status: 'ok' },
          { sensorId: 'temperature', status: 'ok' },
        ],
      }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
})

test('a self-test timestamp more than five minutes ahead is a 422', () => {
  assert.throws(
    () =>
      validateSelfTestShape({
        results: [{ sensorId: 'temperature', status: 'ok' }],
        occurredAt: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
      }),
    (error) => error.code === 'FUTURE_TIMESTAMP' && error.statusCode === 422,
  )
})

test('device events validate type, severity and title', () => {
  const event = validateEventShape({
    type: 'sensor',
    sensor: 'temperature',
    severity: 'warning',
    title: 'Temperature probe disconnected',
  })

  assert.equal(event.severity, 'warning')
  assert.equal(event.sensor, 'temperature')

  const minimal = validateEventShape({ type: 'other', title: 'Note' })
  assert.equal(minimal.severity, 'info')
  assert.equal(minimal.sensor, null)

  for (const body of [
    { type: 'explode', title: 'x' },
    { type: 'sensor', title: '' },
    { type: 'sensor', title: 'x', sensor: 'altimeter' },
    { type: 'sensor', title: 'x', severity: 'fatal' },
    { type: 'sensor', title: 'x', occurredAt: 'not-a-date' },
    { type: 'sensor', title: 'x', description: 'x'.repeat(2001) },
  ]) {
    assert.throws(
      () => validateEventShape(body),
      (error) => error.code === 'VALIDATION_ERROR',
    )
  }
})
