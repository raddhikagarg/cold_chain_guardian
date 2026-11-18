/**
 * Sensor-reading input validation.
 *
 * A reading is one sample with one or more measurements. There is deliberately
 * no sample id, packet id, sequence number or unique timestamp field: duplicate
 * timestamps are legitimate and are stored as separate readings.
 */

const ApiError = require('../utils/ApiError')
const { SENSOR_IDS } = require('../constants/sensors')
const { READING_FUTURE_TOLERANCE_MS } = require('../constants/deviceHealth')
const { isPlainObject } = require('./lifecycleInput')

const MEASUREMENT_FIELDS = [
  'temperature',
  'humidity',
  'shock',
  'light',
  'ethylene',
  'doorOpen',
]

const READING_ALLOWED_KEYS = ['recordedAt', 'shipmentId', ...MEASUREMENT_FIELDS]

// Fields that must never be accepted because the design intentionally omits
// them. Listing them separately produces a clearer error than a generic
// unsupported-field message.
const FORBIDDEN_IDENTITY_FIELDS = [
  'sampleId',
  'packetId',
  'sequence',
  'sequenceNumber',
  'seq',
]

function badField(field, message) {
  throw ApiError.badRequest('VALIDATION_ERROR', message, [{ field, message }])
}

function rejectUnknownKeys(value) {
  const unknown = Object.keys(value).filter(
    (key) => !READING_ALLOWED_KEYS.includes(key),
  )
  if (unknown.length === 0) return

  const forbidden = unknown.find((key) => FORBIDDEN_IDENTITY_FIELDS.includes(key))
  if (forbidden) {
    badField(
      forbidden,
      `${forbidden} is not supported. Readings are individual samples and do not carry a packet identifier.`,
    )
  }

  badField(
    'body',
    `body contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
  )
}

function parseRecordedAt(value) {
  if (value === undefined || value === null || value === '') {
    badField('recordedAt', 'recordedAt is required and must be a valid ISO date.')
  }
  if (typeof value !== 'string' && !(value instanceof Date)) {
    badField('recordedAt', 'recordedAt must be a valid ISO date.')
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    badField('recordedAt', 'recordedAt must be a valid ISO date.')
  }
  return date
}

function parseNumeric(value, field, { min, max, integer } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    badField(field, `${field} must be a valid number.`)
  }
  if (integer && !Number.isInteger(value)) {
    badField(field, `${field} must be a whole number.`)
  }
  if (min !== undefined && value < min) {
    badField(field, `${field} cannot be below ${min}.`)
  }
  if (max !== undefined && value > max) {
    badField(field, `${field} cannot exceed ${max}.`)
  }
  return value
}

/**
 * Validate and normalise an ingestion payload.
 *
 * Null measurement values are treated as absent, matching the SensorReading
 * model. At least one real measurement is required.
 */
function validateReadingPayload(input) {
  if (!isPlainObject(input)) {
    badField('body', 'Request body must be an object.')
  }
  rejectUnknownKeys(input)

  const recordedAt = parseRecordedAt(input.recordedAt)
  const measurements = {}

  if (input.temperature !== undefined && input.temperature !== null) {
    measurements.temperature = parseNumeric(input.temperature, 'temperature')
  }
  if (input.humidity !== undefined && input.humidity !== null) {
    measurements.humidity = parseNumeric(input.humidity, 'humidity', {
      min: 0,
      max: 100,
    })
  }
  if (input.shock !== undefined && input.shock !== null) {
    measurements.shock = parseNumeric(input.shock, 'shock', { min: 0 })
  }
  if (input.light !== undefined && input.light !== null) {
    measurements.light = parseNumeric(input.light, 'light', { min: 0 })
  }
  if (input.ethylene !== undefined && input.ethylene !== null) {
    measurements.ethylene = parseNumeric(input.ethylene, 'ethylene', { min: 0 })
  }
  if (input.doorOpen !== undefined && input.doorOpen !== null) {
    if (typeof input.doorOpen !== 'boolean') {
      badField('doorOpen', 'doorOpen must be a boolean.')
    }
    measurements.doorOpen = input.doorOpen
  }

  if (Object.keys(measurements).length === 0) {
    badField(
      'body',
      'At least one measurement value is required.',
    )
  }

  if (recordedAt.getTime() > Date.now() + READING_FUTURE_TOLERANCE_MS) {
    throw ApiError.unprocessable(
      'FUTURE_TIMESTAMP',
      'recordedAt cannot be more than five minutes in the future.',
      [{ field: 'recordedAt', message: 'recordedAt cannot be in the future.' }],
    )
  }

  let shipmentId = null
  if (input.shipmentId !== undefined && input.shipmentId !== null) {
    if (typeof input.shipmentId !== 'string') {
      badField('shipmentId', 'shipmentId must be text.')
    }
    const trimmed = input.shipmentId.trim()
    if (trimmed.length === 0) {
      badField('shipmentId', 'shipmentId cannot be empty.')
    }
    if (trimmed.length > 80) {
      badField('shipmentId', 'shipmentId cannot exceed 80 characters.')
    }
    shipmentId = trimmed
  }

  return {
    recordedAt,
    shipmentId,
    measurements,
  }
}

function hasMeasurement(value) {
  return value !== undefined && value !== null
}

function measurementFieldFor(sensorId) {
  return sensorId === 'door' ? 'doorOpen' : sensorId
}

module.exports = {
  MEASUREMENT_FIELDS,
  READING_ALLOWED_KEYS,
  FORBIDDEN_IDENTITY_FIELDS,
  validateReadingPayload,
  hasMeasurement,
  measurementFieldFor,
  SENSOR_IDS,
}
