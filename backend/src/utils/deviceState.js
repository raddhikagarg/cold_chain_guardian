/**
 * Device connection state shared by shipment scheduling and, later, the
 * device APIs. A device is only "online" when it says it is online and has a
 * fresh heartbeat; missing or stale evidence is never treated as online.
 */

const {
  DEVICE_STALE_AFTER_MINUTES,
  MINUTE_MS,
} = require('../constants/deviceHealth')

function toTimestamp(value) {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function getDeviceLastSeenAgeMinutes(device, now = Date.now()) {
  const lastSeen = toTimestamp(device?.lastSeenAt)
  if (lastSeen === null) return null
  const reference = now instanceof Date ? now.getTime() : Number(now)
  return Math.max(0, (reference - lastSeen) / MINUTE_MS)
}

function getDeviceConnectionState(device, now = Date.now()) {
  if (!device || device.status !== 'online') return 'offline'

  const ageMinutes = getDeviceLastSeenAgeMinutes(device, now)
  if (ageMinutes === null) return 'stale'

  return ageMinutes > DEVICE_STALE_AFTER_MINUTES ? 'stale' : 'online'
}

module.exports = {
  DEVICE_STALE_AFTER_MINUTES,
  getDeviceLastSeenAgeMinutes,
  getDeviceConnectionState,
}
