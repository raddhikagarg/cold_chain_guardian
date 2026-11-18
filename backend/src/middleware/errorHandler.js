const ApiError = require('../utils/ApiError')
const { sendError } = require('../utils/apiResponse')

const DUPLICATE_FIELD_LABELS = {
  shipmentId: 'Shipment ID',
  deviceId: 'Device ID',
  alertCode: 'Alert code',
  'hardware.serial': 'Hardware serial',
}

function validationDetails(error) {
  return Object.values(error.errors ?? {}).map((entry) => ({
    field: entry.path,
    message: entry.message,
  }))
}

function duplicateDetails(error) {
  const keyValue = error.keyValue ?? {}
  const fields = Object.keys(keyValue)
  if (fields.length === 0) return undefined
  return fields.map((field) => ({
    field,
    message: `${DUPLICATE_FIELD_LABELS[field] ?? field} must be unique.`,
  }))
}

function duplicateMessage(error) {
  const fields = Object.keys(error.keyValue ?? {})
  if (fields.length === 0) return 'A duplicate record already exists.'
  const label = DUPLICATE_FIELD_LABELS[fields[0]] ?? fields[0]
  return `${label} already exists.`
}

/**
 * Central error handler.
 *
 * Express 5 forwards rejected async handlers here automatically, so route
 * code can simply throw ApiError instances.
 */
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error)
  }

  if (error instanceof ApiError) {
    return sendError(res, {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    })
  }

  // JSON body parser errors.
  if (
    error.type === 'entity.parse.failed' ||
    (error instanceof SyntaxError && error.status === 400 && 'body' in error)
  ) {
    return sendError(res, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request body must be valid JSON.',
    })
  }

  if (error.name === 'ValidationError' && error.errors) {
    return sendError(res, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: validationDetails(error),
    })
  }

  if (error.name === 'CastError') {
    return sendError(res, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'A supplied value has the wrong type.',
      details: [
        {
          field: error.path,
          message: `${error.path} is invalid.`,
        },
      ],
    })
  }

  if (error.code === 11000) {
    return sendError(res, {
      statusCode: 409,
      code: 'DUPLICATE_RESOURCE',
      message: duplicateMessage(error),
      details: duplicateDetails(error),
    })
  }

  if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
    return sendError(res, {
      statusCode: error.statusCode,
      code: 'VALIDATION_ERROR',
      message: error.expose ? error.message : 'Request could not be processed.',
    })
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[api] Unhandled error: ${error.message}`)
  }

  return sendError(res, {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
  })
}

module.exports = errorHandler
