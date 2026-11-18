/**
 * Operational error type used by routes, services and middleware.
 *
 * Anything thrown as an ApiError is safe to return to the caller: it has an
 * HTTP status, a stable machine-readable code and an optional list of field
 * details. Unexpected errors are converted to a generic 500 by the central
 * error handler instead of leaking stack traces.
 */
class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.code = code
    if (details !== undefined) {
      this.details = details
    }
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details)
  }

  static notFound(message, details) {
    return new ApiError(404, 'RESOURCE_NOT_FOUND', message, details)
  }

  static conflict(code, message, details) {
    return new ApiError(409, code, message, details)
  }

  static unprocessable(code, message, details) {
    return new ApiError(422, code, message, details)
  }

  static internal(message = 'An unexpected error occurred.') {
    return new ApiError(500, 'INTERNAL_ERROR', message)
  }
}

module.exports = ApiError
