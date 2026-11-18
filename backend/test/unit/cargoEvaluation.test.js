const test = require('node:test')
const assert = require('node:assert/strict')

const {
  severityRank,
  assessNumericSensor,
  assessDoorSensor,
  deriveCargoHealth,
  enabledSensorIds,
  isOutsideRange,
} = require('../../src/services/cargoEvaluation')

const TEMPERATURE = {
  enabled: true,
  available: true,
  warning: { min: 2, max: 8 },
  critical: { min: 0, max: 10 },
  escalationMinutes: 0,
}

test('severity ranking orders info, warning and critical', () => {
  assert.equal(severityRank('info'), 0)
  assert.equal(severityRank('warning'), 1)
  assert.equal(severityRank('critical'), 2)
  assert.equal(severityRank('unknown'), 0)
})

test('in-range numeric values have no severity', () => {
  assert.equal(assessNumericSensor('temperature', 4, TEMPERATURE).severity, null)
})

test('warning and critical numeric ranges are distinguished', () => {
  const warning = assessNumericSensor('temperature', 9, TEMPERATURE)
  assert.equal(warning.severity, 'warning')
  assert.equal(warning.direction, 'above')

  const critical = assessNumericSensor('temperature', 11, TEMPERATURE)
  assert.equal(critical.severity, 'critical')
  assert.equal(critical.direction, 'above')

  const lowWarning = assessNumericSensor('temperature', 1, TEMPERATURE)
  assert.equal(lowWarning.severity, 'warning')
  assert.equal(lowWarning.direction, 'below')

  const lowCritical = assessNumericSensor('temperature', -1, TEMPERATURE)
  assert.equal(lowCritical.severity, 'critical')
  assert.equal(lowCritical.direction, 'below')
})

test('single-sided ranges work', () => {
  const maxOnly = { warning: { max: 8 }, critical: null }
  assert.equal(assessNumericSensor('temperature', 9, maxOnly).severity, 'warning')
  assert.equal(assessNumericSensor('temperature', -100, maxOnly).severity, null)

  const minOnly = { warning: { min: 2 }, critical: null }
  assert.equal(assessNumericSensor('temperature', 1, minOnly).severity, 'warning')
  assert.equal(assessNumericSensor('temperature', 100, minOnly).severity, null)
})

test('a warning escalates after the configured escalation time', () => {
  const config = {
    warning: { max: 8 },
    critical: null,
    escalationMinutes: 10,
  }
  const recordedAt = new Date('2026-11-15T10:00:00.000Z')

  const fresh = assessNumericSensor('temperature', 9, config, {
    alertStartedAt: recordedAt,
    recordedAt,
  })
  assert.equal(fresh.severity, 'warning')

  const prolonged = assessNumericSensor('temperature', 9, config, {
    alertStartedAt: new Date('2026-11-15T09:45:00.000Z'),
    recordedAt,
  })
  assert.equal(prolonged.severity, 'critical')
})

test('door alerts require the unexpected state to exceed a duration', () => {
  const config = {
    expectedState: 'closed',
    warning: { maxOpenMinutes: 10 },
    critical: { maxOpenMinutes: 20 },
    escalationMinutes: 0,
  }

  assert.equal(
    assessDoorSensor(config, { observedOpen: false, openMinutes: 60 }).severity,
    null,
  )
  assert.equal(
    assessDoorSensor(config, { observedOpen: true, openMinutes: 9 }).severity,
    null,
  )
  assert.equal(
    assessDoorSensor(config, { observedOpen: true, openMinutes: 10 }).severity,
    'warning',
  )
  assert.equal(
    assessDoorSensor(config, { observedOpen: true, openMinutes: 20 }).severity,
    'critical',
  )
})

test('door escalation time can promote a warning to critical', () => {
  const config = {
    expectedState: 'closed',
    warning: { maxOpenMinutes: 10 },
    critical: null,
    escalationMinutes: 5,
  }

  assert.equal(
    assessDoorSensor(config, { observedOpen: true, openMinutes: 12 }).severity,
    'warning',
  )
  assert.equal(
    assessDoorSensor(config, { observedOpen: true, openMinutes: 16 }).severity,
    'critical',
  )
})

test('cargo health is derived from open cargo alerts and evidence', () => {
  assert.equal(
    deriveCargoHealth({
      openAlerts: [{ severity: 'critical' }, { severity: 'warning' }],
      requiredSensors: ['temperature'],
      evidencedSensors: ['temperature'],
    }),
    'critical',
  )

  assert.equal(
    deriveCargoHealth({
      openAlerts: [{ severity: 'warning' }],
      requiredSensors: ['temperature'],
      evidencedSensors: ['temperature'],
    }),
    'warning',
  )

  assert.equal(
    deriveCargoHealth({
      openAlerts: [],
      requiredSensors: ['temperature', 'humidity'],
      evidencedSensors: ['temperature', 'humidity'],
    }),
    'healthy',
  )

  assert.equal(
    deriveCargoHealth({
      openAlerts: [],
      requiredSensors: ['temperature', 'humidity'],
      evidencedSensors: ['temperature'],
    }),
    'unknown',
  )

  assert.equal(
    deriveCargoHealth({
      openAlerts: [],
      requiredSensors: [],
      evidencedSensors: [],
    }),
    'unknown',
  )
})

test('only enabled sensors participate in monitoring', () => {
  const sensors = enabledSensorIds({
    temperature: { enabled: true },
    humidity: { enabled: false },
    door: { enabled: true },
  })

  assert.deepEqual(sensors, ['temperature', 'door'])
})

test('isOutsideRange handles one-sided bounds', () => {
  assert.equal(isOutsideRange(4, { min: 2, max: 8 }), false)
  assert.equal(isOutsideRange(9, { min: 2, max: 8 }), true)
  assert.equal(isOutsideRange(1, { max: 8 }), false)
  assert.equal(isOutsideRange(101, { min: 0, max: 100 }), true)
  assert.equal(isOutsideRange(5, null), false)
})
