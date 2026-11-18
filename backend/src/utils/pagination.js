const ApiError = require('./ApiError')

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function parseInteger(value, { field, defaultValue, min, max }) {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `${field} must be a positive whole number.`,
      [{ field, message: `${field} must be a positive whole number.` }],
    )
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `${field} must be between ${min} and ${max}.`,
      [{ field, message: `${field} must be between ${min} and ${max}.` }],
    )
  }

  return parsed
}

/**
 * Parse page/limit into a Mongo-ready skip/limit pair.
 */
function parsePagination(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT
  const maxLimit = options.maxLimit ?? MAX_LIMIT

  const page = parseInteger(query.page, {
    field: 'page',
    defaultValue: 1,
    min: 1,
    max: 1000000,
  })

  const limit = parseInteger(query.limit, {
    field: 'limit',
    defaultValue: defaultLimit,
    min: 1,
    max: maxLimit,
  })

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  }
}

function buildPaginationMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  }
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
  buildPaginationMeta,
}
