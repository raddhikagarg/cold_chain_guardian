import { SENSOR_CATALOG } from './shipmentData.js'

/**
 * Deterministic mock telemetry for a shipment/sensor pair.
 *
 * The values are generated around the operator-configured warning range when
 * one exists; they are demonstration readings, not real measurements.
 * This module is the single place to replace with real ESP32 data later.
 */

const DEMO_BASE = {
  temperature: 5.2,
  humidity: 62,
  shock: 0.35,
  light: 350,
  ethylene: 0.8,
}

const DEMO_SPREAD = {
  temperature: 0.5,
  humidity: 2.2,
  shock: 0.18,
  light: 80,
  ethylene: 0.18,
}

const NON_NEGATIVE = new Set(['shock', 'light', 'ethylene'])

function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed) {
  let state = seed
  return function random() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Historical demo records anchor their simulated series to the recorded
 * completion time instead of "now", so charts labelled as history do not
 * look like live telemetry. This is still generated demo data.
 */
function getSeriesEndTime(shipment) {
  if (
    (shipment?.status === 'delivered' || shipment?.status === 'archived') &&
    shipment.completedAt
  ) {
    const completed = new Date(shipment.completedAt).getTime()
    if (Number.isFinite(completed)) return completed
  }
  return Date.now()
}

/**
 * @param {object} shipment shipment record
 * @param {string} sensorId one of SENSOR_IDS
 * @param {{ points?: number, intervalMinutes?: number }} options
 * @returns {{ timestamp: number, value: number }[]}
 */
export function getMockSensorSeries(
  shipment,
  sensorId,
  { points = 48, intervalMinutes = 30 } = {},
) {
  const meta = SENSOR_CATALOG[sensorId]
  const random = mulberry32(hashString(`${shipment.id}:${sensorId}`))
  const endTime = getSeriesEndTime(shipment)
  const timestamps = Array.from(
    { length: points },
    (_, i) => endTime - (points - 1 - i) * intervalMinutes * 60 * 1000,
  )

  if (meta.kind === 'state') {
    const states = new Array(points).fill(0)
    const openIndexes = shipment.mockProfile?.doorOpenAt ?? []
    openIndexes.forEach((index) => {
      if (!Number.isInteger(index) || index < 0 || index >= points) return
      const duration = 1 + Math.floor(random() * 2)
      for (let offset = 0; offset < duration && index + offset < points; offset += 1) {
        states[index + offset] = 1
      }
    })
    return timestamps.map((timestamp, i) => ({ timestamp, value: states[i] }))
  }

  const config = shipment.monitoring?.[sensorId]
  const range = config?.warning ?? config?.acceptable
  const hasRange =
    range && Number.isFinite(range.min) && Number.isFinite(range.max)

  const base = hasRange ? (range.min + range.max) / 2 : DEMO_BASE[sensorId]
  const spread = DEMO_SPREAD[sensorId] ?? 0.5
  const floor = NON_NEGATIVE.has(sensorId) ? 0 : base - spread * 3
  const ceiling = base + spread * 3
  const profile = shipment.mockProfile?.[sensorId]

  let current = base
  const values = []

  for (let i = 0; i < points; i += 1) {
    current += (random() - 0.5) * spread
    current += (base - current) * 0.12
    current = Math.min(ceiling, Math.max(floor, current))

    // Inject the demo excursion specified in the shipment's mock profile.
    if (profile && Number.isFinite(profile.at) && Number.isFinite(profile.value)) {
      const distance = Math.abs(i - profile.at)
      if (distance === 0) {
        current = profile.value
      } else if (distance <= 2) {
        const weight = 0.4 / distance
        current += (profile.value - current) * weight
      }
    }

    const rounded = Number(current.toFixed(meta.decimals))
    values.push(rounded)
  }

  return timestamps.map((timestamp, i) => ({ timestamp, value: values[i] }))
}