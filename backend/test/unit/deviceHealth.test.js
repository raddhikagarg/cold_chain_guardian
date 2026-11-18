const test = require('node:test')
const assert = require('node:assert/strict')

const {
  deriveBatteryHealth,
  deriveSensorEvidence,
  deriveDeviceHealth,
} = require('../../src/utils/deviceHealth')

const NOW = new Date('2026-11-15T10:00:00.000Z')

function device(overrides = {}) {
  return {
    status: 'online',
    lastSeenAt: new Date('2026-11-15T09:58:00.000Z'),
    battery: 80,
    sensors: ['temperature', 'humidity'],
    sensorHealth: [
      {
        sensorId: 'temperature',
        status: 'ok',
        lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
      },
      {
        sensorId: 'humidity',
        status: 'ok',
        lastSelfTestAt: new Date('2026-11-15T08:00:00.000Z'),
      },
    ],
    ...overrides,
  }
}

test('battery thresholds use 20% warning and 10% critical', () => {
  assert.equal(deriveBatteryHealth(21).status, 'ok')
  assert.equal(deriveBatteryHealth(20).status, 'warning')
  assert.equal(deriveBatteryHealth(11).status, 'warning')
  assert.equal(deriveBatteryHealth(10).status, 'critical')
  assert.equal(deriveBatteryHealth(0).status, 'critical')
  assert.equal(deriveBatteryHealth(null).status, 'unknown')
})

test('a fresh online device with fresh self-tests is healthy', () => {
  const health = deriveDeviceHealth(device(), NOW)

  assert.equal(health.status, 'healthy')
  assert.equal(health.healthy, true)
  assert.equal(health.connection.state, 'online')
  assert.equal(health.sensors.length, 2)
  assert.ok(health.sensors.every((sensor) => sensor.selfTestValid))
})

test('a stale heartbeat is never healthy', () => {
  const health = deriveDeviceHealth(
    device({ lastSeenAt: new Date('2026-11-15T09:40:00.000Z') }),
    NOW,
  )

  assert.equal(health.connection.state, 'stale')
  assert.equal(health.status, 'warning')
  assert.equal(health.healthy, false)
})

test('an offline device is critical and never healthy', () => {
  const health = deriveDeviceHealth(
    device({
      status: 'offline',
      lastSeenAt: new Date('2026-11-15T09:59:00.000Z'),
    }),
    NOW,
  )

  assert.equal(health.connection.state, 'offline')
  assert.equal(health.status, 'critical')
  assert.equal(health.healthy, false)
})

test('battery warning and critical affect device health', () => {
  const warning = deriveDeviceHealth(device({ battery: 20 }), NOW)
  assert.equal(warning.battery.status, 'warning')
  assert.equal(warning.status, 'warning')
  assert.equal(warning.healthy, false)

  const critical = deriveDeviceHealth(device({ battery: 8 }), NOW)
  assert.equal(critical.battery.status, 'critical')
  assert.equal(critical.status, 'critical')
})

test('self-test evidence expires after 24 hours', () => {
  const health = deriveDeviceHealth(
    device({
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-14T09:00:00.000Z'),
        },
        {
          sensorId: 'humidity',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
      ],
    }),
    NOW,
  )

  const temperature = health.sensors.find((s) => s.sensorId === 'temperature')
  assert.equal(temperature.selfTestExpired, true)
  assert.equal(temperature.status, 'expired')
  assert.equal(health.status, 'warning')
  assert.equal(health.healthy, false)
})

test('a fitted sensor without self-test evidence prevents healthy', () => {
  const health = deriveDeviceHealth(
    device({
      sensors: ['temperature', 'humidity', 'light'],
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
        {
          sensorId: 'humidity',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
      ],
    }),
    NOW,
  )

  const light = health.sensors.find((s) => s.sensorId === 'light')
  assert.equal(light.status, 'unknown')
  assert.equal(health.status, 'warning')
  assert.equal(health.healthy, false)
})

test('a sensor fault makes the device critical', () => {
  const health = deriveDeviceHealth(
    device({
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'fault',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
        {
          sensorId: 'humidity',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
      ],
    }),
    NOW,
  )

  assert.equal(health.status, 'critical')
  assert.equal(health.healthy, false)
})

test('a degraded sensor makes the device a warning', () => {
  const health = deriveDeviceHealth(
    device({
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'degraded',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
        {
          sensorId: 'humidity',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
      ],
    }),
    NOW,
  )

  assert.equal(health.status, 'warning')
  assert.equal(health.healthy, false)
})

test('sensor evidence only covers fitted sensors', () => {
  const sensors = deriveSensorEvidence(
    device({
      sensors: ['temperature'],
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
        {
          sensorId: 'humidity',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
      ],
    }),
    NOW,
  )

  assert.deepEqual(sensors.map((sensor) => sensor.sensorId), ['temperature'])
})

test('an online device without sensors can be healthy', () => {
  const health = deriveDeviceHealth(
    device({ sensors: [], sensorHealth: [] }),
    NOW,
  )

  assert.equal(health.status, 'healthy')
})

test('exactly ten minutes since the heartbeat is still online', () => {
  const health = deriveDeviceHealth(
    device({ lastSeenAt: new Date('2026-11-15T09:50:00.000Z') }),
    NOW,
  )

  assert.equal(health.connection.state, 'online')
})
