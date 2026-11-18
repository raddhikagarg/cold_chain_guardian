const test = require('node:test')
const assert = require('node:assert/strict')

const ApiError = require('../../src/utils/ApiError')
const errorHandler = require('../../src/middleware/errorHandler')

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

function runHandler(error) {
  const res = mockResponse()
  errorHandler(error, { method: 'GET', originalUrl: '/test' }, res, () => {})
  return res
}

test('ApiError instances keep their status, code and details', () => {
  const res = runHandler(
    new ApiError(503, 'ID_ALLOCATION_EXHAUSTED', 'No id available.', [
      { field: 'shipmentId', message: 'Try again.' },
    ]),
  )

  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, {
    error: {
      code: 'ID_ALLOCATION_EXHAUSTED',
      message: 'No id available.',
      details: [{ field: 'shipmentId', message: 'Try again.' }],
    },
  })
})

test('duplicate key errors map to a 409 envelope', () => {
  const res = runHandler({
    code: 11000,
    keyValue: { shipmentId: 'SHP-2481' },
  })

  assert.equal(res.statusCode, 409)
  assert.equal(res.body.error.code, 'DUPLICATE_RESOURCE')
  assert.equal(res.body.error.message, 'Shipment ID already exists.')
  assert.deepEqual(res.body.error.details, [
    { field: 'shipmentId', message: 'Shipment ID must be unique.' },
  ])
})

test('mongoose validation errors map to field details', () => {
  const res = runHandler({
    name: 'ValidationError',
    errors: {
      'cargo.produce': {
        path: 'cargo.produce',
        message: 'Produce name is required.',
      },
    },
  })

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  assert.deepEqual(res.body.error.details, [
    { field: 'cargo.produce', message: 'Produce name is required.' },
  ])
})

test('cast errors map to a 400 envelope', () => {
  const res = runHandler({ name: 'CastError', path: 'shipment' })

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error.code, 'VALIDATION_ERROR')
  assert.equal(res.body.error.details[0].field, 'shipment')
})

test('JSON parse errors map to a 400 envelope', () => {
  const res = runHandler({
    type: 'entity.parse.failed',
    status: 400,
    body: {},
  })

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error.message, 'Request body must be valid JSON.')
})

test('unexpected errors become a generic 500 without leaking details', () => {
  const res = runHandler(new Error('secret database detail'))

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.body, {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  })
})

test('headers-sent errors are forwarded to Express', () => {
  const res = mockResponse()
  res.headersSent = true
  let forwarded = null

  errorHandler(new Error('late'), {}, res, (error) => {
    forwarded = error
  })

  assert.equal(forwarded.message, 'late')
  assert.equal(res.body, null)
})
