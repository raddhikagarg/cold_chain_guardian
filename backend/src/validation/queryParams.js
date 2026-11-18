const ApiError = require('../utils/ApiError')

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  )
}

function assertSingleValue(value, field) {
  if (Array.isArray(value)) {
    throw ApiError.badRequest('INVALID_QUERY', `${field} must be supplied once.`, [
      { field, message: `${field} must be supplied once.` },
    ])
  }
}

function parseEnum(value, { field, allowed, defaultValue }) {
  assertSingleValue(value, field)

  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `${field} must be one of: ${allowed.join(', ')}.`,
      [
        {
          field,
          message: `${field} must be one of: ${allowed.join(', ')}.`,
        },
      ],
    )
  }

  return value
}

function parseOptionalString(value, { field, maxLength = 200 } = {}) {
  assertSingleValue(value, field)

  if (value === undefined || value === null || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw ApiError.badRequest('INVALID_QUERY', `${field} must be text.`, [
      { field, message: `${field} must be text.` },
    ])
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > maxLength) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `${field} cannot exceed ${maxLength} characters.`,
      [{ field, message: `${field} cannot exceed ${maxLength} characters.` }],
    )
  }

  return trimmed
}

function parseDate(value, { field, defaultValue = null } = {}) {
  assertSingleValue(value, field)

  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `${field} must be a valid ISO date.`,
      [{ field, message: `${field} must be a valid ISO date.` }],
    )
  }

  return date
}

function parseSort(value, { field = 'sort', allowed, defaultValue }) {
  assertSingleValue(value, field)

  const raw = value === undefined || value === null || value === '' ? defaultValue : value

  if (typeof raw !== 'string') {
    throw ApiError.badRequest('INVALID_QUERY', `${field} must be text.`, [
      { field, message: `${field} must be text.` },
    ])
  }

  const [sortField, direction, ...rest] = raw.split(':')
  const resolvedDirection = direction ?? 'desc'

  if (
    rest.length > 0 ||
    !allowed.includes(sortField) ||
    !['asc', 'desc'].includes(resolvedDirection)
  ) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `${field} must use one of ${allowed.join(', ')} with :asc or :desc.`,
      [
        {
          field,
          message: `${field} must use one of ${allowed.join(', ')} with :asc or :desc.`,
        },
      ],
    )
  }

  return { [sortField]: resolvedDirection === 'asc' ? 1 : -1 }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

module.exports = {
  isPlainObject,
  parseEnum,
  parseOptionalString,
  parseDate,
  parseSort,
  escapeRegex,
}
