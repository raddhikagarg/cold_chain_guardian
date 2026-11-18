const ApiError = require('../utils/ApiError')
const { SENSOR_IDS, SENSOR_CATALOG } = require('../constants/sensors')
const { validateMonitoring, validateSystemAlerts } = require('./monitoring')

const CREATE_STATUSES = ['draft', 'scheduled']

const CREATE_ALLOWED_KEYS = [
  'shipmentId',
  'status',
  'cargo',
  'route',
  'monitoring',
  'systemAlerts',
  'deviceId',
  'isDemo',
]

const PATCH_ALLOWED_KEYS = [
  'cargo',
  'route',
  'monitoring',
  'systemAlerts',
  'deviceId',
]

const CARGO_KEYS = ['category', 'produce', 'quantity', 'unit', 'batch']
const ROUTE_KEYS = [
  'origin',
  'destination',
  'carrier',
  'vehicle',
  'departure',
  'arrival',
  'deadline',
  'distanceKm',
  'progress',
]
const IN_TRANSIT_ROUTE_KEYS = ['carrier', 'vehicle', 'progress']

const NUMERIC_MONITOR_KEYS = [
  'available',
  'enabled',
  'warning',
  'critical',
  'escalationMinutes',
]
const DOOR_MONITOR_KEYS = [
  'available',
  'enabled',
  'expectedState',
  'warning',
  'critical',
  'escalationMinutes',
]
const THRESHOLD_KEYS = ['min', 'max', 'maxOpenMinutes']
const SYSTEM_ALERT_KEYS = ['offline', 'battery', 'sensorFault', 'selfTest']

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

function badField(field, message) {
  throw ApiError.badRequest('VALIDATION_ERROR', message, [{ field, message }])
}

function requireObject(value, field) {
  if (!isPlainObject(value)) badField(field, `${field} must be an object.`)
}

function rejectUnknownKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    badField(
      field,
      `${field} contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    )
  }
}

function validateCargoShape(cargo) {
  requireObject(cargo, 'cargo')
  rejectUnknownKeys(cargo, CARGO_KEYS, 'cargo')
}

function validateRouteShape(route, allowed = ROUTE_KEYS) {
  requireObject(route, 'route')
  rejectUnknownKeys(route, allowed, 'route')
}

function validateThresholdShape(value, field) {
  if (value === null || value === undefined) return
  requireObject(value, field)
  rejectUnknownKeys(value, THRESHOLD_KEYS, field)
}

function validateMonitoringShape(monitoring) {
  requireObject(monitoring, 'monitoring')

  for (const sensorId of Object.keys(monitoring)) {
    if (!SENSOR_IDS.includes(sensorId)) {
      badField('monitoring', `Unknown monitoring parameter "${sensorId}".`)
    }

    const config = monitoring[sensorId]
    requireObject(config, `monitoring.${sensorId}`)
    const allowed =
      SENSOR_CATALOG[sensorId].kind === 'state'
        ? DOOR_MONITOR_KEYS
        : NUMERIC_MONITOR_KEYS
    rejectUnknownKeys(config, allowed, `monitoring.${sensorId}`)

    validateThresholdShape(config.warning, `monitoring.${sensorId}.warning`)
    validateThresholdShape(config.critical, `monitoring.${sensorId}.critical`)
  }
}

function validateSystemAlertsShape(systemAlerts) {
  requireObject(systemAlerts, 'systemAlerts')
  rejectUnknownKeys(systemAlerts, SYSTEM_ALERT_KEYS, 'systemAlerts')

  for (const key of SYSTEM_ALERT_KEYS) {
    if (systemAlerts[key] !== undefined) {
      requireObject(systemAlerts[key], `systemAlerts.${key}`)
    }
  }
}

function validateCreateShape(input) {
  requireObject(input, 'body')
  rejectUnknownKeys(input, CREATE_ALLOWED_KEYS, 'body')

  if (input.status !== undefined && !CREATE_STATUSES.includes(input.status)) {
    badField('status', 'status must be draft or scheduled when creating a shipment.')
  }

  if (input.shipmentId !== undefined) {
    if (typeof input.shipmentId !== 'string') {
      badField('shipmentId', 'shipmentId must be text.')
    }
    if (input.shipmentId.trim().length === 0) {
      badField('shipmentId', 'shipmentId cannot be empty.')
    }
    if (input.shipmentId.trim().length > 40) {
      badField('shipmentId', 'shipmentId cannot exceed 40 characters.')
    }
  }

  if (input.cargo !== undefined) validateCargoShape(input.cargo)
  if (input.route !== undefined) validateRouteShape(input.route)
  if (input.monitoring !== undefined) validateMonitoringShape(input.monitoring)
  if (input.systemAlerts !== undefined) validateSystemAlertsShape(input.systemAlerts)

  if (input.deviceId !== undefined && input.deviceId !== null && typeof input.deviceId !== 'string') {
    badField('deviceId', 'deviceId must be text or null.')
  }

  if (input.isDemo !== undefined && typeof input.isDemo !== 'boolean') {
    badField('isDemo', 'isDemo must be a boolean.')
  }
}

function validatePatchShape(input) {
  requireObject(input, 'body')
  rejectUnknownKeys(input, PATCH_ALLOWED_KEYS, 'body')

  if (Object.keys(input).length === 0) {
    badField('body', 'At least one editable field must be supplied.')
  }

  if (input.cargo !== undefined) validateCargoShape(input.cargo)
  if (input.route !== undefined) validateRouteShape(input.route)
  if (input.monitoring !== undefined) validateMonitoringShape(input.monitoring)
  if (input.systemAlerts !== undefined) validateSystemAlertsShape(input.systemAlerts)

  if (input.deviceId !== undefined && input.deviceId !== null && typeof input.deviceId !== 'string') {
    badField('deviceId', 'deviceId must be text or null.')
  }
}

function assertInTransitRoutePatch(route) {
  requireObject(route, 'route')
  rejectUnknownKeys(route, IN_TRANSIT_ROUTE_KEYS, 'route')
}

function toPlain(value) {
  if (value && typeof value.toObject === 'function') {
    return value.toObject()
  }
  return value
}

function toTimestamp(value) {
  if (value === null || value === undefined) return null
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Cross-field route ordering. Kept separate from the Mongoose path validators
 * so the API can return the approved 422 DOMAIN_RULE_VIOLATION envelope before
 * schema validation runs.
 */
function validateRouteOrdering(route = {}) {
  const plain = toPlain(route) ?? {}
  const departure = toTimestamp(plain.departure)
  const arrival = toTimestamp(plain.arrival)
  const deadline = toTimestamp(plain.deadline)
  const details = []

  if (departure !== null && arrival !== null && arrival < departure) {
    details.push({
      field: 'route.arrival',
      message: 'Arrival cannot be before departure.',
    })
  }

  if (arrival !== null && deadline !== null && deadline < arrival) {
    details.push({
      field: 'route.deadline',
      message: 'Deadline cannot be before arrival.',
    })
  }

  if (details.length > 0) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'Shipment route dates are invalid.',
      details,
    )
  }
}

/**
 * Validate the complete persisted configuration. Called after constructing or
 * mutating a shipment document, before saving it.
 */
function validateShipmentConfiguration(shipment) {
  const monitoring = toPlain(shipment.monitoring) ?? {}
  const systemAlerts = toPlain(shipment.systemAlerts) ?? {}

  const errors = [
    ...validateMonitoring(monitoring),
    ...validateSystemAlerts(systemAlerts),
  ]

  if (shipment.status === 'scheduled') {
    if (!shipment.device) {
      errors.push('A device is required before a shipment can be scheduled.')
    }

    const enabledSensors = SENSOR_IDS.filter(
      (sensorId) => monitoring[sensorId]?.enabled,
    )
    if (enabledSensors.length === 0) {
      errors.push('Enable at least one monitoring parameter before scheduling.')
    }
  }

  if (errors.length > 0) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'Shipment configuration is invalid.',
      errors.map((message) => ({ field: 'configuration', message })),
    )
  }
}

/**
 * Monitoring availability must match the fitted sensors of the assigned
 * device. A draft may omit a device, but it may not claim a sensor is
 * available when no device provides it.
 */
function validateMonitoringAvailability(shipment, device) {
  const monitoring = toPlain(shipment.monitoring) ?? {}
  const fitted = new Set(device?.sensors ?? [])
  const errors = []

  SENSOR_IDS.forEach((sensorId) => {
    const config = monitoring[sensorId]
    if (!config) return

    if (config.available && !fitted.has(sensorId)) {
      errors.push(
        `${SENSOR_CATALOG[sensorId].label} cannot be available because the assigned device does not provide it.`,
      )
    }

    if (config.enabled && !fitted.has(sensorId)) {
      errors.push(
        `${SENSOR_CATALOG[sensorId].label} cannot be monitored because the assigned device does not provide it.`,
      )
    }
  })

  if (errors.length > 0) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'Shipment monitoring does not match the assigned device.',
      errors.map((message) => ({ field: 'monitoring', message })),
    )
  }
}

module.exports = {
  CREATE_ALLOWED_KEYS,
  PATCH_ALLOWED_KEYS,
  IN_TRANSIT_ROUTE_KEYS,
  isPlainObject,
  validateCreateShape,
  validatePatchShape,
  assertInTransitRoutePatch,
  validateRouteOrdering,
  validateShipmentConfiguration,
  validateMonitoringAvailability,
}
