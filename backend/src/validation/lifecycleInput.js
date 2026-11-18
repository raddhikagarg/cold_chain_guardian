/**
 * Input helpers for shipment lifecycle actions.
 *
 * Keeping these rules in the validation layer makes the service easier to
 * test and ensures every lifecycle endpoint applies the same body, date and
 * state-transition checks.
 */

const ApiError = require('../utils/ApiError')

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000

function badField(field, message) {
  throw ApiError.badRequest('VALIDATION_ERROR', message, [{ field, message }])
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

function requirePlainBody(value) {
  if (!isPlainObject(value)) badField('body', 'Request body must be an object.')
  return value
}

function rejectUnknownKeys(input, allowed) {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    badField(
      'body',
      `Request contains unsupported field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    )
  }
}

function parseBodyDate(value, field, defaultValue = null) {
  if (value === undefined) return defaultValue
  if (value === null || value === '') {
    badField(field, `${field} must be a valid ISO date.`)
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    badField(field, `${field} must be a valid ISO date.`)
  }
  return date
}

function assertNotFuture(date, field, toleranceMs = FUTURE_TOLERANCE_MS) {
  if (date.getTime() > Date.now() + toleranceMs) {
    throw ApiError.unprocessable(
      'FUTURE_TIMESTAMP',
      `${field} cannot be more than five minutes in the future.`,
      [{ field, message: `${field} cannot be in the future.` }],
    )
  }
}

function assertStatus(shipment, expected, action) {
  if (shipment.status !== expected) {
    throw ApiError.conflict(
      'INVALID_STATE_TRANSITION',
      `Cannot ${action} a shipment with status "${shipment.status}".`,
      [
        {
          field: 'status',
          message: `Expected lifecycle status "${expected}".`,
        },
      ],
    )
  }
}

module.exports = {
  FUTURE_TOLERANCE_MS,
  badField,
  isPlainObject,
  requirePlainBody,
  rejectUnknownKeys,
  parseBodyDate,
  assertNotFuture,
  assertStatus,
}
