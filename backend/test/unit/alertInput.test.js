const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validateAcknowledgeShape,
  validateResolveShape,
} = require('../../src/validation/alertInput')

test('acknowledgement accepts an omitted or empty body', () => {
  assert.deepEqual(validateAcknowledgeShape(undefined), {})
  assert.deepEqual(validateAcknowledgeShape(null), {})
  assert.deepEqual(validateAcknowledgeShape({}), {})
})

test('acknowledgement rejects unsupported fields', () => {
  assert.throws(
    () => validateAcknowledgeShape({ note: 'hello' }),
    (error) => error.statusCode === 400 && error.code === 'VALIDATION_ERROR',
  )
  assert.throws(
    () => validateAcknowledgeShape(['nope']),
    (error) => error.statusCode === 400,
  )
})

test('resolution defaults to empty metadata', () => {
  assert.deepEqual(validateResolveShape(undefined), {
    resolutionNote: '',
    resolvedBy: '',
  })
  assert.deepEqual(validateResolveShape({}), {
    resolutionNote: '',
    resolvedBy: '',
  })
})

test('resolution trims and accepts supported metadata', () => {
  assert.deepEqual(
    validateResolveShape({
      resolutionNote: '  Checked the reefer  ',
      resolvedBy: '  Operator 7 ',
    }),
    {
      resolutionNote: 'Checked the reefer',
      resolvedBy: 'Operator 7',
    },
  )
})

test('resolution rejects unknown fields and non-text metadata', () => {
  assert.throws(
    () => validateResolveShape({ status: 'resolved' }),
    (error) => error.statusCode === 400,
  )
  assert.throws(
    () => validateResolveShape({ resolutionNote: 42 }),
    (error) =>
      error.statusCode === 400 && error.details[0].field === 'resolutionNote',
  )
})

test('resolution enforces metadata length limits', () => {
  assert.throws(
    () => validateResolveShape({ resolutionNote: 'x'.repeat(1001) }),
    (error) =>
      error.statusCode === 400 && error.details[0].field === 'resolutionNote',
  )
  assert.throws(
    () => validateResolveShape({ resolvedBy: 'x'.repeat(121) }),
    (error) =>
      error.statusCode === 400 && error.details[0].field === 'resolvedBy',
  )
})
