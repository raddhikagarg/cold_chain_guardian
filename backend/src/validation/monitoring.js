/**
 * Pure validation helpers for shipment monitoring configuration.
 *
 * These functions contain the cross-field rules that do not fit cleanly into
 * individual Mongoose paths. Future routes/services call them before saving so
 * the schema stays simple and the rules stay testable without a database.
 *
 * Every function returns an array of human-readable error strings. An empty
 * array means the configuration is valid.
 */

const { SENSOR_IDS, SENSOR_CATALOG } = require('../constants/sensors')

const NON_NEGATIVE_SENSOR_IDS = new Set([
  'humidity',
  'shock',
  'light',
  'ethylene',
])

const HUMIDITY_MIN = 0
const HUMIDITY_MAX = 100

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasBound(value) {
  return value !== null && value !== undefined
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function labelFor(sensorId) {
  return SENSOR_CATALOG[sensorId]?.label ?? sensorId
}

function validateBoundValue(sensorId, label, kind, value, errors) {
  if (!hasBound(value)) return

  if (!isNumber(value)) {
    errors.push(`${label} ${kind} must be a valid number.`)
    return
  }

  if (NON_NEGATIVE_SENSOR_IDS.has(sensorId) && value < 0) {
    errors.push(`${label} ${kind} cannot be negative.`)
  }

  if (
    sensorId === 'humidity' &&
    (value < HUMIDITY_MIN || value > HUMIDITY_MAX)
  ) {
    errors.push(`${label} ${kind} must be between 0 and 100%.`)
  }
}

function validateNumericBounds(sensorId, boundsLabel, bounds, errors) {
  if (bounds == null) return { min: null, max: null }

  const label = labelFor(sensorId)
  const { min, max } = bounds

  validateBoundValue(sensorId, label, `${boundsLabel} minimum`, min, errors)
  validateBoundValue(sensorId, label, `${boundsLabel} maximum`, max, errors)

  if (isNumber(min) && isNumber(max) && min >= max) {
    errors.push(
      `${label} ${boundsLabel} minimum must be below its maximum.`,
    )
  }

  return { min: isNumber(min) ? min : null, max: isNumber(max) ? max : null }
}

/**
 * Validate warning/critical ranges for a numeric sensor.
 *
 * Each range may contain only a lower bound, only an upper bound, or both.
 * Neither bound is individually mandatory. Ordering is only checked when the
 * relevant values are present.
 */
function validateNumericThresholds(sensorId, { warning, critical } = {}) {
  const errors = []

  if (SENSOR_CATALOG[sensorId]?.kind !== 'numeric') {
    return [`${labelFor(sensorId)} is not a numeric sensor.`]
  }

  const warningBounds = validateNumericBounds(sensorId, 'warning range', warning, errors)
  const criticalBounds = validateNumericBounds(
    sensorId,
    'critical range',
    critical,
    errors,
  )

  if (
    warningBounds.min != null &&
    criticalBounds.min != null &&
    criticalBounds.min >= warningBounds.min
  ) {
    errors.push(
      `${labelFor(sensorId)} critical minimum must be below the warning minimum.`,
    )
  }

  if (
    warningBounds.max != null &&
    criticalBounds.max != null &&
    criticalBounds.max <= warningBounds.max
  ) {
    errors.push(
      `${labelFor(sensorId)} critical maximum must be above the warning maximum.`,
    )
  }

  return errors
}

/** Validate door expected state and duration thresholds. */
function validateDoorThresholds({ expectedState, warning, critical } = {}) {
  const errors = []
  const label = labelFor('door')

  if (expectedState !== 'open' && expectedState !== 'closed') {
    errors.push(`Select the expected state for ${label}.`)
  }

  const warningMinutes = warning?.maxOpenMinutes
  const criticalMinutes = critical?.maxOpenMinutes

  if (!hasBound(warningMinutes)) {
    errors.push(`Enter a warning duration for ${label}.`)
  } else if (!isPositiveInteger(warningMinutes)) {
    errors.push(
      `${label} warning duration must be a positive whole number of minutes.`,
    )
  }

  if (!hasBound(criticalMinutes)) {
    errors.push(`Enter a critical duration for ${label}.`)
  } else if (!isPositiveInteger(criticalMinutes)) {
    errors.push(
      `${label} critical duration must be a positive whole number of minutes.`,
    )
  }

  if (
    isPositiveInteger(warningMinutes) &&
    isPositiveInteger(criticalMinutes) &&
    criticalMinutes <= warningMinutes
  ) {
    errors.push(
      `${label} critical duration must be longer than the warning duration.`,
    )
  }

  return errors
}

function validateEscalationMinutes(sensorId, value, errors) {
  if (!hasBound(value)) return
  if (!isPositiveInteger(value) && value !== 0) {
    errors.push(
      `${labelFor(sensorId)} escalation time must be a non-negative whole number of minutes.`,
    )
  }
}

/**
 * Validate one sensor entry, including the enabled/available relationship and
 * the rule that disabled parameters never keep active thresholds.
 */
function validateEnabledSensor(sensorId, config = {}) {
  const errors = []
  const meta = SENSOR_CATALOG[sensorId]

  if (!meta) return [`Unknown sensor "${sensorId}".`]

  if (config.enabled && !config.available) {
    errors.push(
      `${meta.label} cannot be monitored when the sensor is not available.`,
    )
  }

  if (!config.enabled) {
    if (config.warning != null || config.critical != null) {
      errors.push(
        `${meta.label} thresholds must be null while monitoring is disabled.`,
      )
    }
    if (meta.kind === 'state' && config.expectedState != null) {
      errors.push(
        `${meta.label} expected state must be null while monitoring is disabled.`,
      )
    }
    return errors
  }

  if (meta.kind === 'state') {
    errors.push(
      ...validateDoorThresholds({
        expectedState: config.expectedState,
        warning: config.warning,
        critical: config.critical,
      }),
    )
    validateEscalationMinutes(sensorId, config.escalationMinutes, errors)
    return errors
  }

  if (config.expectedState != null) {
    errors.push(`${meta.label} does not use an expected state.`)
  }

  const warning = config.warning ?? null
  if (warning == null || (!hasBound(warning.min) && !hasBound(warning.max))) {
    errors.push(
      `Enter at least one warning limit (minimum or maximum) for ${meta.label}.`,
    )
  }

  errors.push(
    ...validateNumericThresholds(sensorId, {
      warning: config.warning,
      critical: config.critical,
    }),
  )
  validateEscalationMinutes(sensorId, config.escalationMinutes, errors)

  return errors
}

/** Validate all six monitoring entries. Every parameter must be present. */
function validateMonitoring(monitoring = {}) {
  const errors = []

  SENSOR_IDS.forEach((sensorId) => {
    if (!monitoring[sensorId]) {
      errors.push(
        `Monitoring configuration is missing ${labelFor(sensorId)}.`,
      )
      return
    }
    errors.push(...validateEnabledSensor(sensorId, monitoring[sensorId]))
  })

  return errors
}

/** Validate the shipment's four system/device alert settings. */
function validateSystemAlerts(systemAlerts = {}) {
  const errors = []
  const offline = systemAlerts.offline ?? {}
  const battery = systemAlerts.battery ?? {}

  if (offline.enabled) {
    if (!isNumber(offline.afterMinutes) || offline.afterMinutes <= 0) {
      errors.push(
        'Enter an ESP32 offline delay greater than 0 minutes, or disable the offline alert.',
      )
    }
  }

  if (battery.enabled) {
    if (
      !isNumber(battery.thresholdPercent) ||
      battery.thresholdPercent < 0 ||
      battery.thresholdPercent > 100
    ) {
      errors.push(
        'Enter a battery threshold between 0 and 100%, or disable the battery alert.',
      )
    }
  }

  return errors
}

module.exports = {
  validateNumericThresholds,
  validateDoorThresholds,
  validateEnabledSensor,
  validateMonitoring,
  validateSystemAlerts,
}
