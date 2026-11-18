const { SensorReading } = require('../models')
const { MINUTE_MS, READING_EVIDENCE_FRESH_MINUTES } = require('../constants/deviceHealth')
const { measurementFieldFor } = require('../validation/readingInput')

/**
 * Derived exposure calculations.
 *
 * Exposure is never measured directly. It is estimated from stored, eligible
 * sensor readings only:
 *
 *   - readings flagged `evaluationSkipped` (late, out-of-order, stale or
 *     pre-departure) are excluded, exactly like cargo evaluation;
 *   - no reading is invented or interpolated beyond the interval between two
 *     stored samples;
 *   - gaps longer than the cargo evidence window are not attributed, so a
 *     communication outage never appears as hours of exposure;
 *   - each metric is `null` when there is no usable evidence, which is
 *     different from a measured zero.
 *
 * These are descriptive estimates for the operator. They are not validated
 * spoilage predictions.
 */

// A single pair of samples can attribute at most this much elapsed time.
const MAX_ATTRIBUTION_GAP_MS = READING_EVIDENCE_FRESH_MINUTES * MINUTE_MS

// Hard safety cap so one very long shipment cannot load an unbounded history.
// When the cap is reached, the newest readings are used and the result is
// flagged as truncated rather than silently pretending to be complete.
const MAX_EXPOSURE_READINGS = 50000

const EXPOSURE_NOTE =
  'Estimated from eligible stored readings. Not a direct measurement and not a validated spoilage prediction.'

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function boundOf(config, key) {
  const bounds = config?.[key]
  if (!bounds) return null
  const min = finiteNumber(bounds.min) ? bounds.min : null
  const max = finiteNumber(bounds.max) ? bounds.max : null
  if (min === null && max === null) return null
  return { min, max }
}

function valueOutside(value, bounds) {
  if (!bounds) return null
  const hasMin = bounds.min !== null
  const hasMax = bounds.max !== null
  return (hasMin && value < bounds.min) || (hasMax && value > bounds.max)
}

/**
 * Duration boundaries prefer the configured warning range because that is the
 * first accepted cargo limit. Critical bounds are only used when no warning
 * range exists.
 */
function outOfRangeBounds(config) {
  return boundOf(config, 'warning') ?? boundOf(config, 'critical')
}

function shockEventBounds(config) {
  const warning = boundOf(config, 'warning')
  if (warning?.max !== null && warning?.max !== undefined) return warning
  const critical = boundOf(config, 'critical')
  if (critical?.max !== null && critical?.max !== undefined) return critical
  return null
}

function round(value, decimals) {
  if (!finiteNumber(value)) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

async function loadEligibleReadings(shipmentId, from, to) {
  const filter = {
    shipment: shipmentId,
    evaluationSkipped: { $ne: true },
  }

  if (from || to) {
    filter.recordedAt = {}
    if (from) filter.recordedAt.$gte = from
    if (to) filter.recordedAt.$lte = to
  }

  return SensorReading.find(filter)
    .sort({ recordedAt: 1 })
    .limit(MAX_EXPOSURE_READINGS + 1)
    .select(
      'recordedAt temperature humidity shock light ethylene doorOpen',
    )
    .lean()
}

function sampleCount(readings, field) {
  return readings.filter(
    (reading) =>
      reading[field] !== null && reading[field] !== undefined,
  ).length
}

/**
 * Attribute elapsed time between consecutive stored samples. `predicate`
 * receives the earlier sample of each pair. Gaps beyond the evidence window
 * are ignored entirely rather than guessed.
 */
function attributeIntervals(readings, predicate) {
  let totalMs = 0

  for (let index = 0; index < readings.length - 1; index += 1) {
    const current = readings[index]
    const next = readings[index + 1]
    const gapMs =
      new Date(next.recordedAt).getTime() -
      new Date(current.recordedAt).getTime()

    if (!Number.isFinite(gapMs) || gapMs <= 0) continue
    if (gapMs > MAX_ATTRIBUTION_GAP_MS) continue
    if (!predicate(current)) continue

    totalMs += gapMs
  }

  return totalMs
}

function metricAvailability(readings) {
  return {
    temperature: sampleCount(readings, 'temperature') > 0,
    humidity: sampleCount(readings, 'humidity') > 0,
    shock: sampleCount(readings, 'shock') > 0,
    light: sampleCount(readings, 'light') > 0,
    door: sampleCount(readings, 'doorOpen') > 0,
    ethylene: sampleCount(readings, 'ethylene') > 0,
  }
}

/**
 * Build exposure for one shipment. `readings` may be supplied by a caller that
 * already loaded them, which keeps dashboard/detail requests free of duplicate
 * queries.
 */
function buildExposure(shipment, readings) {
  const monitoring = shipment?.monitoring ?? {}
  const allReadings = [...(readings ?? [])].sort(
    (left, right) =>
      new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime(),
  )
  const truncated = allReadings.length > MAX_EXPOSURE_READINGS
  const ordered = truncated
    ? allReadings.slice(-MAX_EXPOSURE_READINGS)
    : allReadings

  if (ordered.length === 0) {
    return {
      available: false,
      estimated: true,
      evidence: {
        readings: 0,
        firstRecordedAt: null,
        lastRecordedAt: null,
        windowMinutes: 0,
        truncated: false,
      },
      temperatureMinutesOutOfRange: null,
      humidityMinutesOutOfRange: null,
      shockEvents: null,
      peakShockG: null,
      doorOpenSeconds: null,
      peakEthylenePpm: null,
      avgLightLux: null,
      metrics: {
        temperature: false,
        humidity: false,
        shock: false,
        light: false,
        door: false,
        ethylene: false,
      },
      note: EXPOSURE_NOTE,
    }
  }

  const temperatureBounds = outOfRangeBounds(monitoring.temperature)
  const humidityBounds = outOfRangeBounds(monitoring.humidity)
  const shockBounds = shockEventBounds(monitoring.shock)

  const temperatureSamples = ordered.filter((reading) =>
    finiteNumber(reading.temperature),
  )
  const humiditySamples = ordered.filter((reading) =>
    finiteNumber(reading.humidity),
  )
  const shockSamples = ordered.filter((reading) => finiteNumber(reading.shock))
  const lightSamples = ordered.filter((reading) => finiteNumber(reading.light))
  const ethyleneSamples = ordered.filter((reading) =>
    finiteNumber(reading.ethylene),
  )
  const doorSamples = ordered.filter(
    (reading) => reading.doorOpen !== null && reading.doorOpen !== undefined,
  )

  const temperatureMinutesOutOfRange =
    temperatureBounds && temperatureSamples.length > 0
      ? round(
          attributeIntervals(
            ordered,
            (reading) =>
              finiteNumber(reading.temperature) &&
              valueOutside(reading.temperature, temperatureBounds) === true,
          ) / MINUTE_MS,
          1,
        )
      : null

  const humidityMinutesOutOfRange =
    humidityBounds && humiditySamples.length > 0
      ? round(
          attributeIntervals(
            ordered,
            (reading) =>
              finiteNumber(reading.humidity) &&
              valueOutside(reading.humidity, humidityBounds) === true,
          ) / MINUTE_MS,
          1,
        )
      : null

  const shockEvents =
    shockBounds && shockSamples.length > 0
      ? shockSamples.filter(
          (reading) => valueOutside(reading.shock, shockBounds) === true,
        ).length
      : null

  // Door duration needs at least two door samples; one sample cannot bound an
  // interval.
  const doorOpenSeconds =
    doorSamples.length >= 2
      ? round(
          attributeIntervals(
            ordered,
            (reading) => reading.doorOpen === true,
          ) / 1000,
          0,
        )
      : null

  const peakShockG =
    shockSamples.length > 0
      ? round(Math.max(...shockSamples.map((reading) => reading.shock)), 2)
      : null

  const peakEthylenePpm =
    ethyleneSamples.length > 0
      ? round(
          Math.max(...ethyleneSamples.map((reading) => reading.ethylene)),
          1,
        )
      : null

  const avgLightLux =
    lightSamples.length > 0
      ? round(
          lightSamples.reduce((sum, reading) => sum + reading.light, 0) /
            lightSamples.length,
          0,
        )
      : null

  const firstRecordedAt = ordered[0]?.recordedAt ?? null
  const lastRecordedAt = ordered[ordered.length - 1]?.recordedAt ?? null
  const windowMinutes =
    firstRecordedAt && lastRecordedAt
      ? round(
          (new Date(lastRecordedAt).getTime() -
            new Date(firstRecordedAt).getTime()) /
            MINUTE_MS,
          1,
        )
      : 0

  return {
    available: true,
    estimated: true,
    evidence: {
      readings: ordered.length,
      firstRecordedAt: firstRecordedAt
        ? new Date(firstRecordedAt).toISOString()
        : null,
      lastRecordedAt: lastRecordedAt
        ? new Date(lastRecordedAt).toISOString()
        : null,
      windowMinutes: windowMinutes ?? 0,
      attributionCapMinutes: READING_EVIDENCE_FRESH_MINUTES,
      truncated,
    },
    temperatureMinutesOutOfRange,
    humidityMinutesOutOfRange,
    shockEvents,
    peakShockG,
    doorOpenSeconds,
    peakEthylenePpm,
    avgLightLux,
    metrics: metricAvailability(ordered),
    note: EXPOSURE_NOTE,
  }
}

async function calculateExposure(shipment, { from = null, to = null } = {}) {
  const readings = await loadEligibleReadings(shipment._id, from, to)
  return buildExposure(shipment, readings)
}

async function loadExposureForShipments(shipments) {
  const results = new Map()
  if (shipments.length === 0) return results

  // One query for all readings keeps fleet endpoints free of N+1 lookups.
  const readings = await SensorReading.find({
    shipment: { $in: shipments.map((shipment) => shipment._id) },
    evaluationSkipped: { $ne: true },
  })
    .sort({ recordedAt: 1 })
    .limit(MAX_EXPOSURE_READINGS)
    .select('shipment recordedAt temperature humidity shock light ethylene doorOpen')
    .lean()

  const grouped = new Map()
  for (const reading of readings) {
    const key = String(reading.shipment)
    const list = grouped.get(key) ?? []
    list.push(reading)
    grouped.set(key, list)
  }

  for (const shipment of shipments) {
    results.set(
      String(shipment._id),
      buildExposure(shipment, grouped.get(String(shipment._id)) ?? []),
    )
  }

  return results
}

module.exports = {
  EXPOSURE_NOTE,
  MAX_ATTRIBUTION_GAP_MS,
  MAX_EXPOSURE_READINGS,
  buildExposure,
  calculateExposure,
  loadEligibleReadings,
  loadExposureForShipments,
  measurementFieldFor,
}
