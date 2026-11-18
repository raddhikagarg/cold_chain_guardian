const test = require('node:test')
const assert = require('node:assert/strict')

const {
  validateReadingPayload,
  measurementFieldFor,
  hasMeasurement,
} = require('../../src/validation/readingInput')

function iso(minutesFromNow = 0) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString()
}

test('a complete reading is accepted and normalised', () => {
  const payload = validateReadingPayload({
    recordedAt: iso(-1),
    temperature: 4.2,
    humidity: 85,
    shock: 0.3,
    light: 12,
    ethylene: 0.1,
    doorOpen: false,
    shipmentId: '  SHP-1234  ',
  })

  assert.ok(payload.recordedAt instanceof Date)
  assert.equal(payload.shipmentId, 'SHP-1234')
  assert.deepEqual(payload.measurements, {
    temperature: 4.2,
    humidity: 85,
    shock: 0.3,
    light: 12,
    ethylene: 0.1,
    doorOpen: false,
  })
})

test('a reading with one measurement is accepted', () => {
  const payload = validateReadingPayload({
    recordedAt: iso(-1),
    temperature: -12.5,
  })

  assert.equal(payload.measurements.temperature, -12.5)
  assert.equal(payload.measurements.humidity, undefined)
})

test('null measurements are treated as absent', () => {
  assert.throws(
    () =>
      validateReadingPayload({
        recordedAt: iso(-1),
        temperature: null,
        humidity: null,
      }),
    (error) => error.code === 'VALIDATION_ERROR',
  )

  const payload = validateReadingPayload({
    recordedAt: iso(-1),
    temperature: null,
    doorOpen: true,
  })
  assert.deepEqual(payload.measurements, { doorOpen: true })
})

test('a reading without measurements is rejected', () => {
  assert.throws(
    () => validateReadingPayload({ recordedAt: iso(-1) }),
    (error) =>
      error.code === 'VALIDATION_ERROR' &&
      error.details[0].field === 'body',
  )
})

test('sample and packet identifiers are explicitly rejected', () => {
  for (const field of ['sampleId', 'packetId', 'sequence', 'sequenceNumber', 'seq']) {
    assert.throws(
      () =>
        validateReadingPayload({
          recordedAt: iso(-1),
          temperature: 4,
          [field]: 'abc',
        }),
      (error) =>
        error.code === 'VALIDATION_ERROR' && error.details[0].field === field,
    )
  }
})

test('unknown fields are rejected', () => {
  assert.throws(
    () =>
      validateReadingPayload({
        recordedAt: iso(-1),
        temperature: 4,
        firmware: 'v1',
      }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
})

test('recordedAt is required and must be a valid date', () => {
  for (const recordedAt of [undefined, '', 'not-a-date', null]) {
    assert.throws(
      () => validateReadingPayload({ recordedAt, temperature: 4 }),
      (error) => error.code === 'VALIDATION_ERROR',
    )
  }
})

test('a timestamp more than five minutes ahead is a 422', () => {
  assert.throws(
    () =>
      validateReadingPayload({ recordedAt: iso(6), temperature: 4 }),
    (error) =>
      error.code === 'FUTURE_TIMESTAMP' &&
      error.statusCode === 422 &&
      error.details[0].field === 'recordedAt',
  )
})

test('a timestamp within the five-minute tolerance is accepted', () => {
  const payload = validateReadingPayload({
    recordedAt: iso(4),
    temperature: 4,
  })
  assert.ok(payload.recordedAt instanceof Date)
})

test('sensor values respect their bounds', () => {
  const invalid = [
    { humidity: 101 },
    { humidity: -1 },
    { shock: -0.1 },
    { light: -1 },
    { ethylene: -0.1 },
    { temperature: Number.NaN },
    { doorOpen: 'yes' },
  ]

  for (const measurements of invalid) {
    assert.throws(
      () =>
        validateReadingPayload({
          recordedAt: iso(-1),
          ...measurements,
        }),
      (error) => error.code === 'VALIDATION_ERROR',
    )
  }
})

test('measurement helpers map the door sensor to doorOpen', () => {
  assert.equal(measurementFieldFor('door'), 'doorOpen')
  assert.equal(measurementFieldFor('temperature'), 'temperature')
  assert.equal(hasMeasurement(0), true)
  assert.equal(hasMeasurement(false), true)
  assert.equal(hasMeasurement(null), false)
  assert.equal(hasMeasurement(undefined), false)
})
