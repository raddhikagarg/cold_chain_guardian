/**
 * Device-layer health helpers.
 *
 * These helpers deliberately treat missing or stale evidence as unknown.
 * A device is only healthy when it has checked in recently, and a sensor is
 * only healthy when its record includes a recent successful self-test.
 */

import { SENSOR_CATALOG } from '../data/shipmentData.js'

export const DEVICE_STALE_AFTER_MINUTES = 10
export const SENSOR_EVIDENCE_MAX_MINUTES = 24 * 60
export const BATTERY_LOW_PERCENT = 20
export const BATTERY_CRITICAL_PERCENT = 10

const MINUTE_MS = 60 * 1000

export function toTimestamp(now = Date.now()) {
  if (now instanceof Date) return now.getTime()
  if (typeof now === 'number') return now
  const parsed = new Date(now).getTime()
  return Number.isNaN(parsed) ? Date.now() : parsed
}

export function getDeviceLastSeen(device, now = Date.now()) {
  if (Number.isFinite(device?.lastSeenMinutesAgo)) {
    return toTimestamp(now) - device.lastSeenMinutesAgo * MINUTE_MS
  }
  if (device?.lastSeen) {
    const parsed = new Date(device.lastSeen).getTime()
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

export function getDeviceLastSeenAgeMinutes(device, now = Date.now()) {
  const lastSeen = getDeviceLastSeen(device, now)
  if (lastSeen == null) return null
  return Math.max(0, Math.round((toTimestamp(now) - lastSeen) / MINUTE_MS))
}

/**
 * 'online' = a fresh heartbeat, 'stale' = status says online but the last
 * contact is too old, 'offline' = explicitly offline or no evidence at all.
 */
export function getDeviceConnectionState(device, now = Date.now()) {
  if (!device || device.status !== 'online') return 'offline'

  const ageMinutes = getDeviceLastSeenAgeMinutes(device, now)
  if (ageMinutes == null) return 'stale'
  return ageMinutes > DEVICE_STALE_AFTER_MINUTES ? 'stale' : 'online'
}

export function getBatteryState(battery) {
  if (!Number.isFinite(battery)) return 'unknown'
  if (battery <= BATTERY_CRITICAL_PERCENT) return 'critical'
  if (battery <= BATTERY_LOW_PERCENT) return 'low'
  return 'normal'
}

function normalizeSensorStatus(status) {
  if (status === 'ok' || status === 'degraded' || status === 'fault') {
    return status
  }
  return 'unknown'
}

export function sensorStatusTone(status) {
  if (status === 'ok') return 'ok'
  if (status === 'degraded') return 'warn'
  if (status === 'fault') return 'critical'
  return 'muted'
}

export function sensorStatusLabel(status) {
  if (status === 'ok') return 'Healthy'
  if (status === 'degraded') return 'Degraded'
  if (status === 'fault') return 'Fault'
  return 'Unknown'
}

/**
 * Returns one entry per physically fitted sensor. Current status is Unknown
 * unless there is both a fresh heartbeat and a recent successful self-test.
 * The last known status is retained separately for context.
 */
export function getSensorHealthEntries(device, now = Date.now()) {
  const connectionState = getDeviceConnectionState(device, now)
  const sensors = device?.sensors ?? []
  const nowMs = toTimestamp(now)

  return sensors.map((sensorId) => {
    const meta = SENSOR_CATALOG[sensorId]
    const evidence = device?.sensorHealth?.[sensorId] ?? null
    const lastKnownStatus = normalizeSensorStatus(evidence?.status)
    const selfTestMinutesAgo = Number.isFinite(evidence?.selfTestMinutesAgo)
      ? evidence.selfTestMinutesAgo
      : null
    const evidenceFresh =
      selfTestMinutesAgo != null &&
      selfTestMinutesAgo <= SENSOR_EVIDENCE_MAX_MINUTES

    const verified =
      connectionState === 'online' &&
      evidenceFresh &&
      lastKnownStatus !== 'unknown'
    const currentStatus = verified ? lastKnownStatus : 'unknown'

    let reason = evidence?.note ?? 'No sensor-health evidence recorded.'
    if (evidence && !evidenceFresh) {
      reason = 'The last self-test is older than 24 hours.'
    } else if (connectionState === 'stale') {
      reason = 'The device heartbeat is stale, so sensor status is unknown.'
    } else if (connectionState === 'offline') {
      reason = 'The device is offline, so sensor status is unknown.'
    } else if (!evidence) {
      reason = 'No self-test evidence has been recorded for this sensor.'
    }

    return {
      id: sensorId,
      label: meta?.label ?? sensorId,
      model: meta?.model ?? 'Model not recorded',
      color: meta?.color ?? 'var(--text-secondary)',
      currentStatus,
      lastKnownStatus,
      tone: sensorStatusTone(currentStatus),
      lastKnownTone: sensorStatusTone(lastKnownStatus),
      verified,
      selfTestMinutesAgo,
      lastSelfTestAt:
        selfTestMinutesAgo == null
          ? null
          : nowMs - selfTestMinutesAgo * MINUTE_MS,
      note: reason,
    }
  })
}

export function formatDurationMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return 'Unknown'
  const rounded = Math.max(0, Math.round(minutes))
  if (rounded < 1) return 'Just now'
  if (rounded < 60) return `${rounded} min`
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  if (hours < 24) {
    return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`
  }
  const days = Math.floor(hours / 24)
  const leftoverHours = hours % 24
  return leftoverHours === 0 ? `${days} d` : `${days} d ${leftoverHours} hr`
}

export function formatRelativeMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return 'Unknown'
  const rounded = Math.max(0, Math.round(minutes))
  if (rounded < 1) return 'Just now'
  if (rounded < 60) return `${rounded} min ago`
  if (rounded < 24 * 60) return `${formatDurationMinutes(rounded)} ago`
  return `${Math.floor(rounded / (24 * 60))} d ago`
}

/**
 * Overall health is ordered by operational impact. Offline/stale always wins
 * over sensor or battery information, so healthy last-known readings can
 * never make an offline device look healthy.
 */
export function getDeviceHealth(device, now = Date.now()) {
  const connectionState = getDeviceConnectionState(device, now)
  const ageMinutes = getDeviceLastSeenAgeMinutes(device, now)
  const sensors = getSensorHealthEntries(device, now)
  const issues = []

  if (connectionState === 'offline') {
    issues.push({
      key: 'offline',
      tone: 'critical',
      label: 'Offline',
      detail:
        ageMinutes == null
          ? 'No heartbeat has been recorded.'
          : `No heartbeat for ${formatDurationMinutes(ageMinutes)}. Last recorded readings are not current.`,
    })
  } else if (connectionState === 'stale') {
    issues.push({
      key: 'stale',
      tone: 'warn',
      label: 'Telemetry stale',
      detail:
        ageMinutes == null
          ? 'There is not enough heartbeat evidence to treat this device as online.'
          : `No heartbeat for ${formatDurationMinutes(ageMinutes)}. Readings may be out of date.`,
    })
  }

  const currentFaults = sensors.filter(
    (sensor) => sensor.currentStatus === 'fault',
  )
  if (currentFaults.length > 0) {
    issues.push({
      key: 'sensor-fault',
      tone: 'critical',
      label: 'Sensor fault',
      detail: `${currentFaults.map((sensor) => sensor.label).join(', ')} ${
        currentFaults.length === 1 ? 'is' : 'are'
      } reporting a fault.`,
    })
  }

  const batteryState = getBatteryState(device?.battery)
  if (batteryState === 'critical' || batteryState === 'low') {
    issues.push({
      key: 'battery',
      tone: batteryState === 'critical' ? 'critical' : 'warn',
      label: batteryState === 'critical' ? 'Battery critical' : 'Battery low',
      detail: `Battery is at ${device.battery}%.`,
    })
  }

  const currentDegraded = sensors.filter(
    (sensor) => sensor.currentStatus === 'degraded',
  )
  if (currentDegraded.length > 0) {
    issues.push({
      key: 'sensor-degraded',
      tone: 'warn',
      label: 'Sensor degraded',
      detail: `${currentDegraded.map((sensor) => sensor.label).join(', ')} ${
        currentDegraded.length === 1 ? 'needs' : 'need'
      } attention.`,
    })
  }

  const unverified = sensors.filter(
    (sensor) => sensor.currentStatus === 'unknown' && connectionState === 'online',
  )
  if (unverified.length > 0) {
    issues.push({
      key: 'sensor-unverified',
      tone: 'info',
      label: 'Sensor evidence incomplete',
      detail: `${unverified.length} fitted ${
        unverified.length === 1 ? 'sensor has' : 'sensors have'
      } no recent verified self-test.`,
    })
  }

  if (issues.length === 0) {
    return {
      connectionState,
      tone: 'ok',
      label: 'Healthy',
      detail: `Heartbeat is fresh and all ${sensors.length} fitted ${
        sensors.length === 1 ? 'sensor has' : 'sensors have'
      } recent self-test evidence.`,
      issues,
      sensors,
      rank: 0,
    }
  }

  const primary = issues.find((issue) => issue.tone === 'critical') ?? issues[0]
  const rank =
    connectionState === 'offline'
      ? 4
      : connectionState === 'stale'
        ? 3
        : primary.key === 'sensor-fault'
          ? 3
          : primary.key === 'battery'
            ? 2
            : 1

  return {
    connectionState,
    tone: primary.tone,
    label: primary.label,
    detail: primary.detail,
    issues,
    sensors,
    rank,
  }
}
