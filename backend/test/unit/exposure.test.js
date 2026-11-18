const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildExposure,
  MAX_ATTRIBUTION_GAP_MS,
  EXPOSURE_NOTE,
} = require('../../src/services/exposureService')

const SHIPMENT = {
  _id: '651111111111111111111111',
  monitoring: {
    temperature: {
      enabled: true,
      warning: { min: 2, max: 8 },
      critical: { min: 0, max: 10 },
    },
    humidity: {
      enabled: true,
      warning: { min: 80, max: 95 },
      critical: { min: 70, max: 100 },
    },
    shock: { enabled: true, warning: { min: null, max: 2 } },
    light: { enabled: true },
    door: { enabled: true, expectedState: 'closed' },
    ethylene: { enabled: true },
  },
}

function reading(recordedAt, values = {}) {
  return { recordedAt: new Date(recordedAt), ...values }
}

test('no eligible readings means unavailable, not zero', () => {
  const exposure = buildExposure(SHIPMENT, [])

  assert.equal(exposure.available, false)
  assert.equal(exposure.temperatureMinutesOutOfRange, null)
  assert.equal(exposure.humidityMinutesOutOfRange, null)
  assert.equal(exposure.shockEvents, null)
  assert.equal(exposure.doorOpenSeconds, null)
  assert.equal(exposure.peakShockG, null)
  assert.equal(exposure.note, EXPOSURE_NOTE)
})

test('in-range evidence produces a measured zero rather than null', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', { temperature: 4 }),
    reading('2026-11-15T10:05:00.000Z', { temperature: 5 }),
  ])

  assert.equal(exposure.available, true)
  assert.equal(exposure.temperatureMinutesOutOfRange, 0)
  // No humidity evidence at all: the metric stays unavailable.
  assert.equal(exposure.humidityMinutesOutOfRange, null)
  assert.equal(exposure.metrics.temperature, true)
  assert.equal(exposure.metrics.humidity, false)
})

test('out-of-range duration is attributed only across stored sample gaps', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', { temperature: 12 }),
    reading('2026-11-15T10:05:00.000Z', { temperature: 12 }),
    reading('2026-11-15T10:10:00.000Z', { temperature: 4 }),
  ])

  assert.equal(exposure.temperatureMinutesOutOfRange, 10)
})

test('a gap longer than the evidence window is not attributed', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', { temperature: 12 }),
    reading('2026-11-15T11:00:00.000Z', { temperature: 12 }),
  ])

  assert.equal(exposure.temperatureMinutesOutOfRange, 0)
  assert.equal(
    exposure.evidence.attributionCapMinutes * 60 * 1000,
    MAX_ATTRIBUTION_GAP_MS,
  )
})

test('door duration accumulates only open intervals', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', { doorOpen: true }),
    reading('2026-11-15T10:05:00.000Z', { doorOpen: true }),
    reading('2026-11-15T10:10:00.000Z', { doorOpen: false }),
  ])

  assert.equal(exposure.doorOpenSeconds, 600)
})

test('a single door sample cannot estimate a duration', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', { doorOpen: true }),
  ])

  assert.equal(exposure.doorOpenSeconds, null)
})

test('shock events, peaks and averages use eligible samples', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', {
      shock: 0.4,
      light: 100,
      ethylene: 0.5,
    }),
    reading('2026-11-15T10:05:00.000Z', {
      shock: 3.2,
      light: 200,
      ethylene: 1.1,
    }),
    reading('2026-11-15T10:10:00.000Z', {
      shock: 0.8,
      light: 300,
      ethylene: 0.7,
    }),
  ])

  assert.equal(exposure.shockEvents, 1)
  assert.equal(exposure.peakShockG, 3.2)
  assert.equal(exposure.peakEthylenePpm, 1.1)
  assert.equal(exposure.avgLightLux, 200)
})

test('missing thresholds keep threshold-derived metrics unavailable', () => {
  const exposure = buildExposure(
    { _id: SHIPMENT._id, monitoring: { shock: { enabled: true } } },
    [reading('2026-11-15T10:00:00.000Z', { shock: 3.2 })],
  )

  assert.equal(exposure.shockEvents, null)
  assert.equal(exposure.peakShockG, 3.2)
})

test('exposure is labelled as an estimate with evidence metadata', () => {
  const exposure = buildExposure(SHIPMENT, [
    reading('2026-11-15T10:00:00.000Z', { temperature: 4 }),
    reading('2026-11-15T10:15:00.000Z', { temperature: 4 }),
  ])

  assert.equal(exposure.estimated, true)
  assert.equal(exposure.evidence.readings, 2)
  assert.equal(exposure.evidence.windowMinutes, 15)
  assert.match(exposure.note, /Not a direct measurement/)
})
