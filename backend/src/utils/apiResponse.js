/**
 * Shared response envelopes.
 *
 * Success: { data, meta? }
 * Error:   { error: { code, message, details? } }
 *
 * The existing /api/health endpoint intentionally keeps its own Phase 1 shape.
 */

function sendData(res, data, statusCode = 200, meta) {
  const body = { data }
  if (meta !== undefined) body.meta = meta
  return res.status(statusCode).json(body)
}

function sendList(res, data, meta, statusCode = 200) {
  return res.status(statusCode).json({ data, meta })
}

function sendError(res, { statusCode = 500, code, message, details }) {
  const error = { code, message }
  if (details !== undefined && details.length > 0) error.details = details
  return res.status(statusCode).json({ error })
}

module.exports = {
  sendData,
  sendList,
  sendError,
}
