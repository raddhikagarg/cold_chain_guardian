const ApiError = require('../utils/ApiError')

/** Convert any unmatched route into the shared 404 error envelope. */
function notFound(req, res, next) {
  next(
    ApiError.notFound(
      `Route ${req.method} ${req.originalUrl} was not found.`,
    ),
  )
}

module.exports = notFound
