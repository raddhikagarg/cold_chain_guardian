const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildSystemConditions,
  enabledSystemTypes,
} = require('../../src/services/systemAlertService')

const NOW = new Date('2026-11-15T10:00:00.000Z')

function freshSensorHealth(sensors) {
  return sensors.map((sensorId) => ({
    sensorId,
    status: 'ok',
    lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
  }))
}

function device(overrides = {}) {
  const sensors = overrides.sensors ?? ['temperature', 'humidity']
  return {
    status: 'online',
    lastSeenAt: new Date('2026-11-15T09:58:00.000Z'),
    battery: 90,
    sensors,
    sensorHealth: freshSensorHealth(sensors),
    ...overrides,
  }
}

function shipment(overrides = {}) {
  return {
    _id: '651111111111111111111111',
    shipmentId: 'SHP-ALERT-1',
    status: 'in-transit',
    systemAlerts: {},
    ...overrides,
  }
}

function byType(conditions, systemType) {
  return conditions.find((condition) => condition.systemType === systemType)
}

test('an offline device produces a critical connectivity condition', () => {
  const conditions = buildSystemConditions(
    shipment(),
    device({ status: 'offline', lastSeenAt: null }),
    NOW,
  )

  const offline = byType(conditions, 'offline')
  assert.equal(offline.severity, 'critical')
  assert.equal(offline.triggerValue, null)
})

test('a stale heartbeat produces a warning and respects a longer configured delay', () => {
  const stale = byType(
    buildSystemConditions(
      shipment(),
      device({ lastSeenAt: new Date('2026-11-15T09:49:00.000Z') }),
      NOW,
    ),
    'offline',
  )
  assert.equal(stale.severity, 'warning')
  assert.equal(stale.triggerValue, 11)

  const configured = byType(
    buildSystemConditions(
      shipment({ systemAlerts: { offline: { enabled: true, afterMinutes: 30 } } }),
      device({ lastSeenAt: new Date('2026-11-15T09:49:00.000Z') }),
      NOW,
    ),
    'offline',
  )
  assert.equal(configured, undefined)
})

test('the offline delay is never shorter than ten minutes', () => {
  const recent = buildSystemConditions(
    shipment({ systemAlerts: { offline: { enabled: true, afterMinutes: 1 } } }),
    device({ lastSeenAt: new Date('2026-11-15T09:55:00.000Z') }),
    NOW,
  )
  assert.equal(byType(recent, 'offline'), undefined)

  const overdue = buildSystemConditions(
    shipment({ systemAlerts: { offline: { enabled: true, afterMinutes: 1 } } }),
    device({ lastSeenAt: new Date('2026-11-15T09:45:00.000Z') }),
    NOW,
  )
  assert.equal(byType(overdue, 'offline').severity, 'warning')
  assert.equal(byType(overdue, 'offline').threshold.max, 10)
})

test('battery conditions use the 20% warning and 10% critical floors', () => {
  const warning = byType(
    buildSystemConditions(shipment(), device({ battery: 20 }), NOW),
    'battery',
  )
  assert.equal(warning.severity, 'warning')

  const critical = byType(
    buildSystemConditions(shipment(), device({ battery: 10 }), NOW),
    'battery',
  )
  assert.equal(critical.severity, 'critical')

  const healthy = byType(
    buildSystemConditions(shipment(), device({ battery: 21 }), NOW),
    'battery',
  )
  assert.equal(healthy, undefined)
})

test('a configured battery threshold cannot loosen the fixed floors', () => {
  const warning = byType(
    buildSystemConditions(
      shipment({ systemAlerts: { battery: { enabled: true, thresholdPercent: 25 } } }),
      device({ battery: 20 }),
      NOW,
    ),
    'battery',
  )
  assert.equal(warning.severity, 'warning')
  assert.equal(warning.threshold.max, 20)

  const critical = byType(
    buildSystemConditions(
      shipment({ systemAlerts: { battery: { enabled: true, thresholdPercent: 25 } } }),
      device({ battery: 10 }),
      NOW,
    ),
    'battery',
  )
  assert.equal(critical.severity, 'critical')
})

test('reported sensor faults and degraded sensors produce conditions', () => {
  const conditions = buildSystemConditions(
    shipment(),
    device({
      sensors: ['temperature', 'humidity'],
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'fault',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
        {
          sensorId: 'humidity',
          status: 'degraded',
          lastSelfTestAt: new Date('2026-11-15T09:00:00.000Z'),
        },
      ],
      battery: 90,
    }),
    NOW,
  )

  const faults = conditions.filter(
    (condition) => condition.systemType === 'sensorFault',
  )
  assert.equal(faults.length, 2)
  assert.deepEqual(
    faults.map((condition) => [condition.parameter, condition.severity]).sort(),
    [
      ['humidity', 'warning'],
      ['temperature', 'critical'],
    ],
  )
})

test('expired self-test evidence produces a self-test condition', () => {
  const conditions = buildSystemConditions(
    shipment(),
    device({
      sensorHealth: [
        {
          sensorId: 'temperature',
          status: 'ok',
          lastSelfTestAt: new Date('2026-11-10T09:00:00.000Z'),
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

  const selfTest = byType(conditions, 'selfTest')
  assert.equal(selfTest.severity, 'warning')
  assert.match(selfTest.message, /Temperature/)
})

test('disabled system alert types are not evaluated', () => {
  const conditions = buildSystemConditions(
    shipment({
      systemAlerts: {
        offline: { enabled: false },
        battery: { enabled: false },
        sensorFault: { enabled: false },
        selfTest: { enabled: false },
      },
    }),
    device({ status: 'offline', battery: 5, lastSeenAt: null }),
    NOW,
  )

  assert.deepEqual(conditions, [])
  assert.deepEqual(enabledSystemTypes({}), [
    'offline',
    'battery',
    'sensorFault',
    'selfTest',
  ])
})

test('non-operational shipments never evaluate device conditions', () => {
  for (const status of ['draft', 'delivered', 'archived']) {
    const conditions = buildSystemConditions(
      shipment({ status }),
      device({ status: 'offline', battery: 5 }),
      NOW,
    )
    assert.deepEqual(conditions, [])
  }
})
