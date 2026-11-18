const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parseEnum,
  parseOptionalString,
  parseDate,
  parseSort,
  escapeRegex,
} = require('../../src/validation/queryParams')

test('parseEnum returns defaults and validates values', () => {
  assert.equal(
    parseEnum(undefined, { field: 'status', allowed: ['all', 'draft'], defaultValue: 'all' }),
    'all',
  )
  assert.equal(
    parseEnum('draft', { field: 'status', allowed: ['all', 'draft'], defaultValue: 'all' }),
    'draft',
  )
  assert.throws(
    () => parseEnum('nope', { field: 'status', allowed: ['all', 'draft'] }),
    (error) => error.code === 'INVALID_QUERY',
  )
})

test('parseOptionalString trims and rejects overly long values', () => {
  assert.equal(parseOptionalString('  hello  ', { field: 'q' }), 'hello')
  assert.equal(parseOptionalString('   ', { field: 'q' }), null)
  assert.throws(
    () => parseOptionalString('x'.repeat(201), { field: 'q', maxLength: 200 }),
    (error) => error.code === 'INVALID_QUERY',
  )
})

test('parseDate parses valid dates and rejects invalid dates', () => {
  const parsed = parseDate('2026-11-15T10:00:00.000Z', { field: 'from' })
  assert.equal(parsed.toISOString(), '2026-11-15T10:00:00.000Z')
  assert.throws(
    () => parseDate('not-a-date', { field: 'from' }),
    (error) => error.code === 'INVALID_QUERY',
  )
})

test('parseSort whitelists fields and directions', () => {
  assert.deepEqual(
    parseSort(undefined, {
      allowed: ['createdAt', 'shipmentId'],
      defaultValue: 'createdAt:desc',
    }),
    { createdAt: -1 },
  )
  assert.deepEqual(
    parseSort('shipmentId:asc', {
      allowed: ['createdAt', 'shipmentId'],
      defaultValue: 'createdAt:desc',
    }),
    { shipmentId: 1 },
  )
  assert.throws(
    () =>
      parseSort('secret:asc', {
        allowed: ['createdAt'],
        defaultValue: 'createdAt:desc',
      }),
    (error) => error.code === 'INVALID_QUERY',
  )
})

test('escapeRegex escapes user input', () => {
  assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c')
})
