const test = require('node:test')
const assert = require('node:assert/strict')

const {
  emptyAlertSummary,
  summarizeAlerts,
  summarizeAlertRows,
  displayStatusFor,
  presentAlert,
  presentDeviceSummary,
  presentShipment,
  toIso,
} = require('../../src/services/shipmentPresenter')

const SHIPMENT = {
  _id: '651111111111111111111111',
  shipmentId: 'SHP-2481',
  status: 'in-transit',
  healthStatus: 'warning',
  cargo: { category: 'fruits', produce: 'Mango', quantity: 120, unit: 'kg' },
  route: {
    origin: 'Nashik',
    destination: 'Pune',
    carrier: 'ColdMove',
    vehicle: 'Reefer Truck · TR-104',
    departure: '2026-11-15T08:00:00.000Z',
    arrival: '2026-11-15T14:00:00.000Z',
    deadline: '2026-11-15T16:00:00.000Z',
    distanceKm: 210,
    progress: 45,
  },
  device: '652222222222222222222222',
  completedAt: null,
  archivedAt: null,
  completionSource: null,
  createdAt: '2026-11-15T07:00:00.000Z',
  updatedAt: '2026-11-15T09:30:00.000Z',
  isDemo: false,
}

test('displayStatus derives health state only while in transit', () => {
  assert.equal(
    displayStatusFor({ status: 'in-transit', healthStatus: 'critical' }),
    'critical',
  )
  assert.equal(
    displayStatusFor({ status: 'in-transit', healthStatus: 'warning' }),
    'warning',
  )
  assert.equal(
    displayStatusFor({ status: 'in-transit', healthStatus: 'healthy' }),
    'in-transit',
  )
  assert.equal(
    displayStatusFor({ status: 'in-transit', healthStatus: 'unknown' }),
    'in-transit',
  )
  assert.equal(
    displayStatusFor({ status: 'delivered', healthStatus: 'critical' }),
    'delivered',
  )
  assert.equal(
    displayStatusFor({ status: 'draft', healthStatus: 'unknown' }),
    'draft',
  )
})

test('presentShipment returns lifecycle, health and the status alias', () => {
  const presented = presentShipment(SHIPMENT)

  assert.equal(presented.id, 'SHP-2481')
  assert.equal(presented.objectId, '651111111111111111111111')
  assert.equal(presented.lifecycleStatus, 'in-transit')
  assert.equal(presented.healthStatus, 'warning')
  assert.equal(presented.displayStatus, 'warning')
  assert.equal(presented.status, 'warning')
  assert.deepEqual(presented.alertSummary, emptyAlertSummary())
  assert.equal(presented.deviceId, null)
  assert.equal(presented.device, null)
  assert.equal(presented.route.progress, 45)
  assert.equal('monitoring' in presented, false)
  assert.equal('alerts' in presented, false)
  assert.equal('timeline' in presented, false)
})

test('presentShipment detail adds monitoring, timeline, alerts and reading', () => {
  const presented = presentShipment(
    {
      ...SHIPMENT,
      monitoring: {
        temperature: {
          available: true,
          enabled: true,
          warning: { min: 2, max: 8 },
          critical: { min: 0, max: 10 },
          escalationMinutes: 0,
        },
      },
      systemAlerts: { offline: { enabled: true, afterMinutes: 10 } },
      timeline: [
        {
          title: 'Draft created',
          description: 'Created.',
          tone: 'muted',
          occurredAt: '2026-11-15T07:00:00.000Z',
        },
        {
          title: 'Departed',
          description: 'Monitoring active.',
          tone: 'info',
          occurredAt: '2026-11-15T08:00:00.000Z',
        },
      ],
    },
    {
      detail: true,
      device: {
        _id: '652222222222222222222222',
        deviceId: 'CCG-ESP32-01',
        name: 'Reefer unit 1',
        status: 'online',
        battery: 88,
        lastSeenAt: new Date(),
      },
      alerts: [
        {
          _id: '653333333333333333333333',
          alertCode: 'SHP-2481:TEMP:HIGH:1',
          source: 'cargo',
          parameter: 'temperature',
          severity: 'warning',
          title: 'Temperature high',
          message: 'Temperature reached 9.1 °C.',
          triggerValue: 9.1,
          peakValue: 9.4,
          threshold: { min: 2, max: 8 },
          status: 'active',
          startedAt: '2026-11-15T09:00:00.000Z',
        },
      ],
      latestReading: {
        _id: '654444444444444444444444',
        recordedAt: '2026-11-15T09:30:00.000Z',
        temperature: 9.1,
        humidity: 62,
        doorOpen: false,
      },
      alertSummary: { open: 1, critical: 0, warning: 1, resolved: 0 },
      exposure: null,
    },
  )

  assert.equal(presented.monitoring.temperature.enabled, true)
  assert.deepEqual(presented.systemAlerts, {
    offline: { enabled: true, afterMinutes: 10 },
  })
  assert.equal(presented.device.connectionState, 'online')
  assert.equal(presented.device.battery, 88)
  assert.equal(presented.timeline.length, 2)
  assert.equal(presented.timeline[0].id, 'TL-SHP-2481-1')
  assert.equal(presented.timeline[1].id, 'TL-SHP-2481-2')
  assert.equal(presented.timeline[1].time, '2026-11-15T08:00:00.000Z')
  assert.equal(presented.alerts.length, 1)
  assert.equal(presented.alerts[0].id, 'SHP-2481:TEMP:HIGH:1')
  assert.equal(presented.alerts[0].display.reading, '9.1 °C')
  assert.equal(presented.alerts[0].display.threshold, '2.0 °C – 8.0 °C')
  assert.equal(presented.alerts[0].display.peakReading, '9.4 °C')
  assert.equal(presented.latestReading.temperature, 9.1)
  assert.equal(presented.latestReading.id, '654444444444444444444444')
  assert.equal(presented.exposure, null)
  assert.deepEqual(presented.incidents, [])
})

test('summarizeAlerts counts open, severity and resolved alerts', () => {
  assert.deepEqual(
    summarizeAlerts([
      { status: 'active', severity: 'critical' },
      { status: 'acknowledged', severity: 'warning' },
      { status: 'resolved', severity: 'critical' },
      { status: 'active', severity: 'warning' },
    ]),
    { open: 3, critical: 1, warning: 2, resolved: 1 },
  )
})

test('summarizeAlertRows aggregates grouped alert counts', () => {
  assert.deepEqual(
    summarizeAlertRows([
      { _id: { status: 'active', severity: 'critical' }, count: 2 },
      { _id: { status: 'resolved', severity: 'warning' }, count: 3 },
    ]),
    { open: 2, critical: 2, warning: 0, resolved: 3 },
  )
})

test('presentAlert formats door duration and system alerts', () => {
  const door = presentAlert({
    _id: '653333333333333333333333',
    source: 'cargo',
    parameter: 'door',
    severity: 'critical',
    title: 'Door open too long',
    message: 'Door was unexpectedly open.',
    triggerValue: 22,
    threshold: { maxOpenMinutes: 15 },
    status: 'active',
    startedAt: '2026-11-15T09:00:00.000Z',
  })

  assert.equal(door.display.reading, '22 min unexpected')
  assert.equal(
    door.display.threshold,
    'Unexpected state for more than 15 min',
  )

  const battery = presentAlert({
    _id: '653333333333333333333334',
    source: 'system',
    systemType: 'battery',
    parameter: 'device',
    severity: 'warning',
    title: 'Battery low',
    message: 'Battery is low.',
    triggerValue: 15,
    threshold: { max: 20 },
    status: 'active',
    startedAt: '2026-11-15T09:00:00.000Z',
  })

  assert.equal(battery.display.reading, '15%')
  assert.equal(battery.display.threshold, 'Battery below 20%')

  const offline = presentAlert({
    source: 'system',
    systemType: 'offline',
    parameter: 'device',
    severity: 'critical',
    title: 'Device offline',
    message: 'No telemetry.',
    triggerValue: 12,
    threshold: { max: 10 },
    status: 'active',
    startedAt: '2026-11-15T09:00:00.000Z',
  })

  assert.equal(offline.display.reading, '12 min')
  assert.equal(offline.display.threshold, 'No telemetry for 10 min')
})

test('presentAlert falls back to the object id when no code exists', () => {
  const alert = presentAlert({
    _id: '653333333333333333333335',
    source: 'cargo',
    parameter: 'humidity',
    severity: 'warning',
    title: 'Humidity high',
    message: 'Humidity is high.',
    status: 'active',
    startedAt: '2026-11-15T09:00:00.000Z',
  })

  assert.equal(alert.id, '653333333333333333333335')
  assert.equal(alert.objectId, '653333333333333333333335')
  assert.equal(alert.alertCode, null)
  assert.equal(alert.thresholdSnapshot, null)
})

test('presentDeviceSummary reports staleness and missing devices', () => {
  assert.equal(presentDeviceSummary(null), null)

  const summary = presentDeviceSummary({
    _id: '652222222222222222222222',
    deviceId: 'CCG-ESP32-02',
    name: 'Reefer unit 2',
    status: 'online',
    battery: 42,
    lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
  })

  assert.equal(summary.id, 'CCG-ESP32-02')
  assert.equal(summary.connectionState, 'stale')
})

test('toIso normalises values and rejects invalid dates', () => {
  assert.equal(toIso(null), null)
  assert.equal(toIso('2026-11-15T10:00:00.000Z'), '2026-11-15T10:00:00.000Z')
  assert.equal(toIso('not-a-date'), null)
})
