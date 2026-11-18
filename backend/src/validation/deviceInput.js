/**
 * Device API input validation.
 *
 * Every helper validates the body shape, normalises strings and dates and
 * returns a plain object the service can persist. Unknown fields are rejected
 * so a client can never write derived fields such as `lastSeenAt` directly.
 */

const ApiError = require('../utils/ApiError')
const { SENSOR_IDS } = require('../constants/sensors')
const {
  DEVICE_STATUSES,
  SENSOR_HEALTH_STATUSES,
  DEVICE_EVENT_TYPES,
  ALERT_SEVERITIES,
} = require('../constants/enums')
const {
  FUTURE_TOLERANCE_MS,
  isPlainObject,
} = require('./lifecycleInput')

const REGISTER_ALLOWED_KEYS = [
  'deviceId',
  'name',
  'status',
  'connectivity',
  'signal',
  'signalDbm',
  'battery',
  'firmware',
  'sensors',
  'sensorHealth',
  'hardware',
  'lastBootAt',
]

const HARDWARE_KEYS = [
  'board',
  'chip',
  'revision',
  'serial',
  'mac',
  'installedAt',
  'flash',
  'powerSource',
]

const HEARTBEAT_ALLOWED_KEYS = [
  'battery',
  'signal',
  'signalDbm',
  'firmware',
  'connectivity',
  'booted',
]

const SELF_TEST_ALLOWED_KEYS = ['results', 'occurredAt']
const SELF_TEST_RESULT_KEYS = ['sensorId', 'status', 'note']

const EVENT_ALLOWED_KEYS = [
  'type',
  'sensor',
  'severity',
  'title',
  'description',
  'shipmentId',
  'occurredAt',
]

function badField(field, message) {
  throw ApiError.badRequest('VALIDATION_ERROR', message, [{ field, message }])
}

function requireObject(value, field) {
  if (!isPlainObject(value)) badField(field, `${field} must be an object.`)
}

function rejectUnknownKeys(value, allowed, field = 'body') {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    badField(
      field,
      `${field} contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    )
  }
}

function optionalText(value, field, maxLength) {
  if (value === undefined) return undefined
  if (value === null) return ''
  if (typeof value !== 'string') badField(field, `${field} must be text.`)
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    badField(field, `${field} cannot exceed ${maxLength} characters.`)
  }
  return trimmed
}

function requiredText(value, field, maxLength) {
  if (typeof value !== 'string') badField(field, `${field} is required.`)
  const trimmed = value.trim()
  if (trimmed.length === 0) badField(field, `${field} cannot be empty.`)
  if (trimmed.length > maxLength) {
    badField(field, `${field} cannot exceed ${maxLength} characters.`)
  }
  return trimmed
}

function parseOptionalDate(value, field) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) badField(field, `${field} must be a valid ISO date.`)
    return value
  }
  if (typeof value !== 'string') badField(field, `${field} must be a valid ISO date.`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) badField(field, `${field} must be a valid ISO date.`)
  return date
}

function assertNotFuture(date, field) {
  if (date && date.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw ApiError.unprocessable(
      'FUTURE_TIMESTAMP',
      `${field} cannot be more than five minutes in the future.`,
      [{ field, message: `${field} cannot be in the future.` }],
    )
  }
}

function parseOptionalNumber(value, field, min, max) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    badField(field, `${field} must be a valid number.`)
  }
  if (min !== undefined && value < min) {
    badField(field, `${field} cannot be below ${min}.`)
  }
  if (max !== undefined && value > max) {
    badField(field, `${field} cannot exceed ${max}.`)
  }
  return value
}

function validateSensors(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) badField('sensors', 'sensors must be an array.')

  const sensors = []
  for (const sensorId of value) {
    if (!SENSOR_IDS.includes(sensorId)) {
      badField('sensors', `Unknown sensor "${sensorId}".`)
    }
    if (!sensors.includes(sensorId)) sensors.push(sensorId)
  }

  return sensors
}

function validateSensorHealthEntry(entry, field, fittedSensors) {
  requireObject(entry, field)
  rejectUnknownKeys(entry, ['sensorId', 'status', 'lastSelfTestAt', 'note'], field)

  if (!SENSOR_IDS.includes(entry.sensorId)) {
    badField(`${field}.sensorId`, `${field}.sensorId is not a known sensor.`)
  }
  if (fittedSensors && !fittedSensors.includes(entry.sensorId)) {
    badField(
      `${field}.sensorId`,
      `${field}.sensorId is not fitted on this device.`,
    )
  }
  if (!SENSOR_HEALTH_STATUSES.includes(entry.status)) {
    badField(
      `${field}.status`,
      `${field}.status must be one of: ${SENSOR_HEALTH_STATUSES.join(', ')}.`,
    )
  }

  const lastSelfTestAt = parseOptionalDate(entry.lastSelfTestAt, `${field}.lastSelfTestAt`)
  assertNotFuture(lastSelfTestAt, `${field}.lastSelfTestAt`)
  const note = optionalText(entry.note, `${field}.note`, 500) ?? ''

  return {
    sensorId: entry.sensorId,
    status: entry.status,
    lastSelfTestAt: lastSelfTestAt ?? null,
    note,
  }
}

function validateSensorHealth(value, fittedSensors) {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    badField('sensorHealth', 'sensorHealth must be an array.')
  }

  const seen = new Set()
  return value.map((entry, index) => {
    const field = `sensorHealth[${index}]`
    const normalised = validateSensorHealthEntry(entry, field, fittedSensors)
    if (seen.has(normalised.sensorId)) {
      badField(`${field}.sensorId`, 'Each sensor may appear only once in sensorHealth.')
    }
    seen.add(normalised.sensorId)
    return normalised
  })
}

function validateHardware(value) {
  if (value === undefined) return undefined
  requireObject(value, 'hardware')
  rejectUnknownKeys(value, HARDWARE_KEYS, 'hardware')

  const hardware = {}
  for (const key of ['board', 'chip', 'revision', 'mac', 'flash', 'powerSource']) {
    if (value[key] !== undefined) {
      hardware[key] = optionalText(value[key], `hardware.${key}`, 120) ?? ''
    }
  }
  if (value.serial !== undefined) {
    hardware.serial = optionalText(value.serial, 'hardware.serial', 120) ?? ''
  }
  if (value.installedAt !== undefined) {
    hardware.installedAt = parseOptionalDate(value.installedAt, 'hardware.installedAt')
  }

  return hardware
}

/** Validate a device registration body and return its persistable shape. */
function validateRegisterShape(input) {
  requireObject(input, 'body')
  rejectUnknownKeys(input, REGISTER_ALLOWED_KEYS)

  const deviceId = requiredText(input.deviceId, 'deviceId', 80)
  const name = requiredText(input.name, 'name', 120)

  if (input.status !== undefined && !DEVICE_STATUSES.includes(input.status)) {
    badField('status', `status must be one of: ${DEVICE_STATUSES.join(', ')}.`)
  }

  const sensors = validateSensors(input.sensors)
  const sensorHealth = validateSensorHealth(input.sensorHealth, sensors ?? [])

  const normalised = {
    deviceId,
    name,
    status: input.status ?? 'offline',
  }

  const connectivity = optionalText(input.connectivity, 'connectivity', 120)
  if (connectivity !== undefined) normalised.connectivity = connectivity

  const signal = optionalText(input.signal, 'signal', 40)
  if (signal !== undefined) normalised.signal = signal

  const signalDbm = parseOptionalNumber(input.signalDbm, 'signalDbm', -120, 0)
  if (signalDbm !== undefined) normalised.signalDbm = signalDbm

  const battery = parseOptionalNumber(input.battery, 'battery', 0, 100)
  if (battery !== undefined) normalised.battery = battery

  const firmware = optionalText(input.firmware, 'firmware', 120)
  if (firmware !== undefined) normalised.firmware = firmware

  if (sensors !== undefined) normalised.sensors = sensors
  if (sensorHealth !== undefined) normalised.sensorHealth = sensorHealth

  const hardware = validateHardware(input.hardware)
  if (hardware !== undefined) normalised.hardware = hardware

  const lastBootAt = parseOptionalDate(input.lastBootAt, 'lastBootAt')
  assertNotFuture(lastBootAt, 'lastBootAt')
  if (lastBootAt !== undefined) normalised.lastBootAt = lastBootAt

  return normalised
}

/** Validate an optional heartbeat body. An empty body is a valid heartbeat. */
function validateHeartbeatShape(input) {
  requireObject(input, 'body')
  rejectUnknownKeys(input, HEARTBEAT_ALLOWED_KEYS)

  const normalised = {}

  const battery = parseOptionalNumber(input.battery, 'battery', 0, 100)
  if (battery !== undefined) normalised.battery = battery

  const signal = optionalText(input.signal, 'signal', 40)
  if (signal !== undefined) normalised.signal = signal

  const signalDbm = parseOptionalNumber(input.signalDbm, 'signalDbm', -120, 0)
  if (signalDbm !== undefined) normalised.signalDbm = signalDbm

  const firmware = optionalText(input.firmware, 'firmware', 120)
  if (firmware !== undefined) normalised.firmware = firmware

  const connectivity = optionalText(input.connectivity, 'connectivity', 120)
  if (connectivity !== undefined) normalised.connectivity = connectivity

  if (input.booted !== undefined) {
    if (typeof input.booted !== 'boolean') {
      badField('booted', 'booted must be a boolean.')
    }
    normalised.booted = input.booted
  }

  return normalised
}

/** Validate self-test evidence for one or more fitted sensors. */
function validateSelfTestShape(input) {
  requireObject(input, 'body')
  rejectUnknownKeys(input, SELF_TEST_ALLOWED_KEYS)

  if (!Array.isArray(input.results) || input.results.length === 0) {
    badField('results', 'results must contain at least one sensor result.')
  }

  const seen = new Set()
  const results = input.results.map((entry, index) => {
    const field = `results[${index}]`
    requireObject(entry, field)
    rejectUnknownKeys(entry, SELF_TEST_RESULT_KEYS, field)

    if (!SENSOR_IDS.includes(entry.sensorId)) {
      badField(`${field}.sensorId`, `${field}.sensorId is not a known sensor.`)
    }
    if (seen.has(entry.sensorId)) {
      badField(`${field}.sensorId`, 'Each sensor may appear only once in results.')
    }
    seen.add(entry.sensorId)

    if (!SENSOR_HEALTH_STATUSES.includes(entry.status)) {
      badField(
        `${field}.status`,
        `${field}.status must be one of: ${SENSOR_HEALTH_STATUSES.join(', ')}.`,
      )
    }

    return {
      sensorId: entry.sensorId,
      status: entry.status,
      note: optionalText(entry.note, `${field}.note`, 500) ?? '',
    }
  })

  const occurredAt = parseOptionalDate(input.occurredAt, 'occurredAt')
  assertNotFuture(occurredAt, 'occurredAt')

  return {
    results,
    occurredAt: occurredAt ?? new Date(),
  }
}

/** Validate a device-event creation body. */
function validateEventShape(input) {
  requireObject(input, 'body')
  rejectUnknownKeys(input, EVENT_ALLOWED_KEYS)

  if (!DEVICE_EVENT_TYPES.includes(input.type)) {
    badField(
      'type',
      `type must be one of: ${DEVICE_EVENT_TYPES.join(', ')}.`,
    )
  }

  if (input.sensor !== undefined && input.sensor !== null) {
    if (!SENSOR_IDS.includes(input.sensor)) {
      badField('sensor', 'sensor is not a known sensor.')
    }
  }

  if (
    input.severity !== undefined &&
    !ALERT_SEVERITIES.includes(input.severity)
  ) {
    badField(
      'severity',
      `severity must be one of: ${ALERT_SEVERITIES.join(', ')}.`,
    )
  }

  const occurredAt = parseOptionalDate(input.occurredAt, 'occurredAt')
  assertNotFuture(occurredAt, 'occurredAt')

  const shipmentId = optionalText(input.shipmentId, 'shipmentId', 80)
  if (shipmentId !== undefined && shipmentId.length === 0) {
    badField('shipmentId', 'shipmentId cannot be empty.')
  }

  return {
    type: input.type,
    sensor: input.sensor ?? null,
    severity: input.severity ?? 'info',
    title: requiredText(input.title, 'title', 200),
    description: optionalText(input.description, 'description', 2000) ?? '',
    shipmentId: shipmentId ?? null,
    occurredAt: occurredAt ?? new Date(),
  }
}

module.exports = {
  REGISTER_ALLOWED_KEYS,
  HEARTBEAT_ALLOWED_KEYS,
  SELF_TEST_ALLOWED_KEYS,
  EVENT_ALLOWED_KEYS,
  validateRegisterShape,
  validateHeartbeatShape,
  validateSelfTestShape,
  validateEventShape,
}
