const test = require('node:test')
const assert = require('node:assert/strict')

const {
  parsePagination,
  buildPaginationMeta,
} = require('../../src/utils/pagination')

test('parsePagination applies defaults', () => {
  assert.deepEqual(parsePagination({}), { page: 1, limit: 20, skip: 0 })
})

test('parsePagination parses page and limit', () => {
  assert.deepEqual(parsePagination({ page: '3', limit: '5' }), {
    page: 3,
    limit: 5,
    skip: 10,
  })
})

test('parsePagination honours a custom maximum', () => {
  assert.throws(
    () => parsePagination({ limit: '501' }, { maxLimit: 500 }),
    (error) => error.code === 'INVALID_QUERY',
  )
})

test('parsePagination rejects invalid values', () => {
  for (const query of [{ page: '0' }, { page: 'abc' }, { limit: '0' }, { limit: '101' }]) {
    assert.throws(
      () => parsePagination(query),
      (error) => error.code === 'INVALID_QUERY',
    )
  }
})

test('buildPaginationMeta reports total pages', () => {
  assert.deepEqual(buildPaginationMeta({ page: 2, limit: 20, total: 57 }), {
    page: 2,
    limit: 20,
    total: 57,
    totalPages: 3,
  })

  assert.deepEqual(buildPaginationMeta({ page: 1, limit: 20, total: 0 }), {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  })
})
