const { SENSOR_CATALOG } = require('../constants/sensors')
const { toIso } = require('../utils/deviceHealth')

/**
 * Sensor-reading presenter.
 *
 * Readings expose plain measurement fields (matching the shipment detail
 * `latestReading` block) plus a `display` block with catalog units. MongoDB
 * internals are never returned raw.
 */

function toPlain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value
}

function formatMeasurement(value, sensorId) {
  if (value === null || value === undefined) return null
  const meta = SENSOR_CATALOG[sensorId]
  if (!meta) return String(value)
  if (meta.kind === 'state') return value === true ? 'Open' : 'Closed'

  const number = Number(value)
  if (!Number.isFinite(number)) return null
  const decimals = Number.isInteger(meta.decimals) ? meta.decimals : 1
  return `${number.toFixed(decimals)} ${meta.unit}`
}

function presentReading(reading, options = {}) {
  if (!reading) return null
  const plain = toPlain(reading) ?? {}

  return {
    id: plain._id ? String(plain._id) : null,
    objectId: plain._id ? String(plain._id) : null,
    shipmentId: options.shipmentId ?? null,
    shipmentObjectId: plain.shipment ? String(plain.shipment) : null,
    deviceId: options.deviceId ?? null,
    deviceObjectId: plain.device ? String(plain.device) : null,
    recordedAt: toIso(plain.recordedAt),
    createdAt: toIso(plain.createdAt),
    temperature: plain.temperature ?? null,
    humidity: plain.humidity ?? null,
    shock: plain.shock ?? null,
    light: plain.light ?? null,
    ethylene: plain.ethylene ?? null,
    doorOpen: plain.doorOpen ?? null,
    late: Boolean(plain.late),
    lateReason: plain.lateReason ?? null,
    outOfOrder: Boolean(plain.outOfOrder),
    stale: Boolean(plain.stale),
    evaluationSkipped: Boolean(plain.evaluationSkipped),
    skipReason: plain.skipReason ?? null,
    evaluated: !plain.evaluationSkipped,
    display: {
      temperature: formatMeasurement(plain.temperature, 'temperature'),
      humidity: formatMeasurement(plain.humidity, 'humidity'),
      shock: formatMeasurement(plain.shock, 'shock'),
      light: formatMeasurement(plain.light, 'light'),
      ethylene: formatMeasurement(plain.ethylene, 'ethylene'),
      doorOpen: formatMeasurement(plain.doorOpen, 'door'),
    },
  }
}

module.exports = {
  presentReading,
  formatMeasurement,
}
