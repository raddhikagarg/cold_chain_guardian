/**
 * Alert lifecycle body validation.
 *
 * Acknowledging records only the timestamp already supported by the model.
 * Resolution may include the model's `resolutionNote` and `resolvedBy` fields.
 */

const ApiError = require('../utils/ApiError')
const {
  isPlainObject,
  requirePlainBody,
  rejectUnknownKeys,
} = require('./lifecycleInput')

function optionalText(value, field, maxLength) {
  if (value === undefined) return undefined
  if (value === null) return ''
  if (typeof value !== 'string') {
    throw ApiError.badRequest('VALIDATION_ERROR', `${field} must be text.`, [
      { field, message: `${field} must be text.` },
    ])
  }

  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw ApiError.badRequest(
      'VALIDATION_ERROR',
      `${field} cannot exceed ${maxLength} characters.`,
      [{ field, message: `${field} cannot exceed ${maxLength} characters.` }],
    )
  }

  return trimmed
}

function validateAcknowledgeShape(input) {
  if (input === undefined || input === null) return {}
  if (!isPlainObject(input)) {
    throw ApiError.badRequest('VALIDATION_ERROR', 'Request body must be an object.', [
      { field: 'body', message: 'Request body must be an object.' },
    ])
  }

  const body = requirePlainBody(input)
  rejectUnknownKeys(body, [])
  return {}
}

function validateResolveShape(input) {
  if (input === undefined || input === null) {
    return { resolutionNote: '', resolvedBy: '' }
  }

  const body = requirePlainBody(input)
  rejectUnknownKeys(body, ['resolutionNote', 'resolvedBy'])

  return {
    resolutionNote:
      optionalText(body.resolutionNote, 'resolutionNote', 1000) ?? '',
    resolvedBy: optionalText(body.resolvedBy, 'resolvedBy', 120) ?? '',
  }
}

module.exports = {
  validateAcknowledgeShape,
  validateResolveShape,
}
