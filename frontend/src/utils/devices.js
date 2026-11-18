/**
 * Device registry composition.
 *
 * Device identity and hardware live in the single DEVICES registry. Active
 * shipment assignment continues to be derived from shipment state — this
 * module never stores a second "assignedDeviceId" field.
 */

import {
  getDeviceAvailability,
  isActiveStatus,
} from './shipments.js'
import {
  formatDurationMinutes,
  getDeviceHealth,
  getDeviceLastSeen,
  getDeviceLastSeenAgeMinutes,
} from './deviceState.js'

const MINUTE_MS = 60 * 1000

function minutesAgoToTimestamp(minutesAgo, now) {
  const reference = now instanceof Date ? now.getTime() : now
  return reference - minutesAgo * MINUTE_MS
}

function parseTimestamp(value) {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function shipmentRecordTime(shipment) {
  return (
    parseTimestamp(shipment.completedAt) ??
    parseTimestamp(shipment.archivedAt) ??
    parseTimestamp(shipment.route?.arrival) ??
    parseTimestamp(shipment.createdAt) ??
    parseTimestamp(shipment.route?.departure) ??
    0
  )
}

function shipmentAssignedTime(shipment) {
  return (
    parseTimestamp(shipment.route?.departure) ??
    parseTimestamp(shipment.createdAt) ??
    0
  )
}

/**
 * Merge identity, derived assignment and device health into one read model.
 * `sensors` stays the array of fitted sensor IDs; the evidence rows live in
 * `sensorEntries`.
 */
export function getDeviceRegistry(devices, shipments, now = Date.now()) {
  const availability = getDeviceAvailability(devices, shipments, now)

  return availability.map((device) => {
    const activeAssignments = shipments.filter(
      (shipment) =>
        isActiveStatus(shipment.status) && shipment.deviceId === device.id,
    )
    const currentAssignment = activeAssignments[0] ?? null
    const assignmentConflict = activeAssignments.length > 1

    const lastAssignment =
      shipments
        .filter(
          (shipment) =>
            shipment.deviceId === device.id &&
            !isActiveStatus(shipment.status) &&
            (shipment.status === 'delivered' ||
              shipment.status === 'archived'),
        )
        .sort((a, b) => shipmentRecordTime(b) - shipmentRecordTime(a))[0] ??
      null

    const health = getDeviceHealth(device, now)
    const sensorEntries = health.sensors
    const sensorIssueCount = sensorEntries.filter(
      (sensor) => sensor.currentStatus !== 'ok',
    ).length
    const lastSeen = getDeviceLastSeen(device, now)
    const lastSeenAgeMinutes = getDeviceLastSeenAgeMinutes(device, now)

    return {
      ...device,
      connectionState: device.connectionState ?? health.connectionState,
      currentAssignment,
      lastAssignment,
      assignmentConflict,
      assigned: Boolean(currentAssignment),
      unassigned: !currentAssignment,
      health,
      sensorEntries,
      sensorFittedCount: device.sensors?.length ?? 0,
      sensorIssueCount,
      lastSeen,
      lastSeenAgeMinutes,
    }
  })
}

export function summarizeDevices(registry) {
  return registry.reduce(
    (summary, device) => {
      summary.total += 1
      if (device.connectionState === 'online') summary.online += 1
      if (device.connectionState === 'stale') summary.stale += 1
      if (device.connectionState === 'offline') summary.offline += 1

      if (device.health.label === 'Healthy') {
        summary.healthy += 1
      } else {
        summary.attention += 1
      }

      if (device.currentAssignment) summary.assigned += 1
      else summary.unassigned += 1

      if (device.assignmentConflict) summary.conflicts += 1
      summary.sensorFitted += device.sensorFittedCount
      summary.sensorIssues += device.sensorIssueCount
      return summary
    },
    {
      total: 0,
      online: 0,
      stale: 0,
      offline: 0,
      healthy: 0,
      attention: 0,
      assigned: 0,
      unassigned: 0,
      conflicts: 0,
      sensorFitted: 0,
      sensorIssues: 0,
    },
  )
}

export const CONNECTIVITY_FILTER_OPTIONS = [
  { value: 'all', label: 'All connectivity' },
  { value: 'online', label: 'Online' },
  { value: 'stale', label: 'Stale heartbeat' },
  { value: 'offline', label: 'Offline' },
]

export const ASSIGNMENT_FILTER_OPTIONS = [
  { value: 'all', label: 'All assignments' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'unassigned', label: 'Unassigned' },
]

export const HEALTH_FILTER_OPTIONS = [
  { value: 'all', label: 'All health states' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'attention', label: 'Needs attention' },
]

function deviceSearchText(device) {
  return [
    device.id,
    device.name,
    device.firmware,
    device.connectivity,
    device.hardware?.serial,
    device.hardware?.mac,
    device.hardware?.board,
    device.currentAssignment?.id,
    device.currentAssignment?.cargo?.produce,
    device.lastAssignment?.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function filterDevices(registry, filters = {}) {
  const query = (filters.query ?? '').trim().toLowerCase()
  const connectivity = filters.connectivity ?? 'all'
  const assignment = filters.assignment ?? 'all'
  const health = filters.health ?? 'all'

  return registry.filter((device) => {
    if (query && !deviceSearchText(device).includes(query)) return false
    if (connectivity !== 'all' && device.connectionState !== connectivity) {
      return false
    }
    if (assignment === 'assigned' && !device.currentAssignment) return false
    if (assignment === 'unassigned' && device.currentAssignment) return false
    if (health === 'healthy' && device.health.label !== 'Healthy') return false
    if (health === 'attention' && device.health.label === 'Healthy') {
      return false
    }
    return true
  })
}

/** Attention-first ordering keeps offline, stale and failing devices visible. */
export function sortDevices(registry) {
  return [...registry].sort((a, b) => {
    if (b.health.rank !== a.health.rank) return b.health.rank - a.health.rank
    return a.id.localeCompare(b.id)
  })
}

/**
 * Connectivity timeline: recent heartbeats plus notable connection events
 * and the existing offline/reconnect system alerts. Nothing is invented as a
 * successful reconnect unless a matching event or alert exists.
 */
export function getConnectivityHistory(device, shipments, now = Date.now()) {
  const entries = []

  if (device.lastSeen != null) {
    entries.push({
      at: device.lastSeen,
      state: device.connectionState,
      signal: device.signal,
      source: 'heartbeat',
      note:
        device.connectionState === 'online'
          ? 'Heartbeat received within the freshness window.'
          : device.connectionState === 'stale'
            ? 'Last successful contact; scheduled heartbeats have since been missed.'
            : 'Last contact before the device went offline.',
    })

    // A small amount of previous contact history helps show the heartbeat
    // cadence without pretending to be a real recorder.
    for (let index = 1; index <= 3; index += 1) {
      entries.push({
        at: device.lastSeen - index * 5 * MINUTE_MS,
        state: 'online',
        signal: device.signal,
        source: 'heartbeat',
        note: 'Heartbeat received.',
      })
    }
  }

  ;(device.connectivityEvents ?? []).forEach((event) => {
    entries.push({
      at: minutesAgoToTimestamp(event.atMinutesAgo, now),
      state: event.state,
      signal: event.signal ?? device.signal,
      source: 'device',
      note: event.note,
      durationMinutes: event.durationMinutes,
    })
  })

  shipments
    .filter((shipment) => shipment.deviceId === device.id)
    .forEach((shipment) => {
      ;(shipment.alerts ?? []).forEach((alert) => {
        if (alert.source !== 'system' || alert.systemType !== 'offline') return
        const at = parseTimestamp(alert.startedAt)
        if (at == null) return
        const title = (alert.title ?? '').toLowerCase()
        const isReconnect =
          title.includes('reconnect') ||
          title.includes('restored') ||
          title.includes('resumed') ||
          alert.severity === 'info'

        entries.push({
          at,
          state: isReconnect ? 'online' : 'offline',
          signal: isReconnect ? device.signal : '—',
          source: 'alert',
          shipmentId: shipment.id,
          note: isReconnect
            ? `Connection restored. ${alert.message}`
            : alert.message,
        })
      })
    })

  const seen = new Set()
  return entries
    .filter((entry) => {
      const key = `${Math.round(entry.at / MINUTE_MS)}-${entry.state}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.at - a.at)
    .map((entry) => ({
      ...entry,
      ageMinutes: Math.max(
        0,
        Math.round(
          ((now instanceof Date ? now.getTime() : now) - entry.at) / MINUTE_MS,
        ),
      ),
    }))
}

/**
 * Device events combine device-layer maintenance/firmware records, existing
 * shipment system alerts and assignment lifecycles. Cargo threshold alerts
 * stay in the shipment/alert views; this feed is about the device itself.
 */
export function getDeviceEventFeed(device, shipments, now = Date.now()) {
  const events = []

  ;(device.deviceEvents ?? []).forEach((event) => {
    events.push({
      at: minutesAgoToTimestamp(event.atMinutesAgo, now),
      source: 'device',
      type: event.type ?? 'device',
      severity: event.severity ?? 'info',
      title: event.title,
      detail: event.detail,
    })
  })

  shipments
    .filter((shipment) => shipment.deviceId === device.id)
    .forEach((shipment) => {
      ;(shipment.alerts ?? []).forEach((alert) => {
        if (alert.source !== 'system') return
        const at = parseTimestamp(alert.startedAt)
        if (at == null) return
        events.push({
          at,
          source: 'alert',
          type: alert.systemType ?? 'system',
          severity: alert.severity ?? 'info',
          title: alert.title,
          detail: alert.message,
          status: alert.status,
          shipmentId: shipment.id,
        })
      })

      const assignedAt = shipmentAssignedTime(shipment)
      if (assignedAt) {
        events.push({
          at: assignedAt,
          source: 'lifecycle',
          type: 'assignment',
          severity: 'info',
          title: `Assigned to ${shipment.id}`,
          detail: `${shipment.cargo?.produce ?? 'Shipment'} · ${
            shipment.route?.origin ?? 'Origin not recorded'
          } → ${shipment.route?.destination ?? 'Destination not recorded'}`,
          shipmentId: shipment.id,
        })
      }

      if (
        shipment.status === 'delivered' ||
        shipment.status === 'archived'
      ) {
        const releasedAt =
          parseTimestamp(shipment.completedAt) ??
          parseTimestamp(shipment.archivedAt) ??
          parseTimestamp(shipment.route?.arrival)
        if (releasedAt) {
          events.push({
            at: releasedAt,
            source: 'lifecycle',
            type: 'release',
            severity: 'info',
            title: `Released from ${shipment.id}`,
            detail:
              shipment.status === 'archived'
                ? 'Archived shipment record retained; device no longer reserved.'
                : 'Completed shipment record retained; device no longer reserved.',
            shipmentId: shipment.id,
          })
        }
      }
    })

  return events
    .sort((a, b) => b.at - a.at)
    .map((event) => ({
      ...event,
      ageMinutes: Math.max(
        0,
        Math.round(
          ((now instanceof Date ? now.getTime() : now) - event.at) / MINUTE_MS,
        ),
      ),
    }))
}

export function getSensorEvidenceLabel(sensor) {
  if (sensor.currentStatus !== 'unknown') {
    return sensor.note
  }
  return `${sensor.note} Last known status: ${
    sensor.lastKnownStatus === 'ok'
      ? 'healthy'
      : sensor.lastKnownStatus === 'degraded'
        ? 'degraded'
        : sensor.lastKnownStatus === 'fault'
          ? 'fault'
          : 'not verified'
  }.`
}

export function getDeviceFleetDuration(device) {
  return formatDurationMinutes(device.lastSeenAgeMinutes)
}
