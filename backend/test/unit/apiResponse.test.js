const test = require('node:test')
const assert = require('node:assert/strict')

const { sendData, sendList, sendError } = require('../../src/utils/apiResponse')

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
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

test('sendData wraps a single resource and defaults to 200', () => {
  const res = mockResponse()
  sendData(res, { id: 'SHP-1' })

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { data: { id: 'SHP-1' } })
})

test('sendData accepts an explicit status code and meta', () => {
  const res = mockResponse()
  sendData(res, { id: 'SHP-1' }, 201, { source: 'create' })

  assert.equal(res.statusCode, 201)
  assert.deepEqual(res.body, {
    data: { id: 'SHP-1' },
    meta: { source: 'create' },
  })
})

test('sendList always includes the pagination meta', () => {
  const res = mockResponse()
  sendList(res, [], { page: 1, limit: 20, total: 0, totalPages: 0 })

  assert.deepEqual(res.body, {
    data: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  })
})

test('sendError uses the approved error envelope', () => {
  const res = mockResponse()
  sendError(res, {
    statusCode: 422,
    code: 'DOMAIN_RULE_VIOLATION',
    message: 'Shipment route dates are invalid.',
    details: [{ field: 'route.arrival', message: 'Arrival cannot be before departure.' }],
  })

  assert.equal(res.statusCode, 422)
  assert.deepEqual(res.body, {
    error: {
      code: 'DOMAIN_RULE_VIOLATION',
      message: 'Shipment route dates are invalid.',
      details: [
        { field: 'route.arrival', message: 'Arrival cannot be before departure.' },
      ],
    },
  })
})

test('sendError omits empty details and defaults to 500', () => {
  const res = mockResponse()
  sendError(res, { code: 'INTERNAL_ERROR', message: 'Failed.', details: [] })

  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.body, {
    error: { code: 'INTERNAL_ERROR', message: 'Failed.' },
  })
})
