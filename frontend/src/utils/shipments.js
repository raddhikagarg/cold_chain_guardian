import { SENSOR_CATALOG, SENSOR_IDS } from '../data/shipmentData.js'
import { getDeviceConnectionState } from './deviceState.js'

export const ACTIVE_STATUSES = ['scheduled', 'in-transit', 'warning', 'critical']

export const STATUS_META = {
  draft: { label: 'Draft', tone: 'muted' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  'in-transit': { label: 'In Transit', tone: 'info' },
  warning: { label: 'Warning', tone: 'warn' },
  critical: { label: 'Critical', tone: 'critical' },
  delivered: { label: 'Completed', tone: 'ok' },
  archived: { label: 'Archived', tone: 'muted' },
}

export const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in-transit', label: 'In Transit' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
  { value: 'draft', label: 'Draft' },
  { value: 'delivered', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

export function getStatusMeta(status) {
  return STATUS_META[status] ?? { label: status, tone: 'muted' }
}

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status)
}

export function summarizeShipments(shipments) {
  return shipments.reduce(
    (summary, shipment) => {
      if (!isActiveStatus(shipment.status)) return summary
      summary.totalActive += 1
      if (shipment.status === 'in-transit') summary.inTransit += 1
      if (shipment.status === 'warning') summary.warning += 1
      if (shipment.status === 'critical') summary.critical += 1
      return summary
    },
    { totalActive: 0, inTransit: 0, warning: 0, critical: 0 },
  )
}

export function generateShipmentId(shipments) {
  const numbers = shipments
    .map((shipment) => Number(String(shipment.id).match(/(\d+)$/)?.[1]))
    .filter((value) => Number.isFinite(value))

  const highest = numbers.length ? Math.max(...numbers) : 2480
  return `SHP-${highest + 1}`
}

/**
 * Devices are considered busy when an active shipment references them.
 * A sensor being present on a device is separate from whether the operator
 * selected it for monitoring and entered cargo thresholds.
 *
 * Availability also requires a fresh heartbeat. A device that claims to be
 * online but has gone quiet is stale and cannot be assigned until it reports.
 */
export function getDeviceAvailability(devices, shipments, now = Date.now()) {
  const busyDevices = new Map()
  shipments.forEach((shipment) => {
    if (isActiveStatus(shipment.status) && shipment.deviceId) {
      busyDevices.set(shipment.deviceId, shipment.id)
    }
  })

  return devices.map((device) => {
    const assignedShipmentId = busyDevices.get(device.id) ?? null
    const connectionState = getDeviceConnectionState(device, now)
    const online = connectionState === 'online'
    return {
      ...device,
      assignedShipmentId,
      connectionState,
      online,
      available: online && !assignedShipmentId,
    }
  })
}

export function findDeviceAssignment(shipments, deviceId, ignoreShipmentId = null) {
  return shipments.find(
    (shipment) =>
      shipment.id !== ignoreShipmentId &&
      isActiveStatus(shipment.status) &&
      shipment.deviceId === deviceId,
  )
}

/**
 * The operator-configured warning range is the single numeric range for a
 * parameter. `acceptable` is only read as a fallback for older demo records
 * that predate warning/critical configuration; new shipments never persist it.
 */
export function getMonitoringRange(entry) {
  if (!entry) return null
  return entry.warning ?? entry.acceptable ?? null
}

/** Door status stores an expected state instead of a numeric range. */
export function getExpectedDoorState(entry) {
  if (!entry) return null
  return entry.expectedState ?? entry.acceptable?.state ?? null
}

/**
 * A selected sensor needs availability and operator-entered cargo limits.
 * Numeric parameters may configure only one side (for example a high limit),
 * so either a low or a high bound is sufficient. Door status uses the expected
 * state instead of a numeric range.
 */
export function isMonitoringConfigured(entry) {
  if (!entry || !entry.available || !entry.enabled) return false
  const expectedState = getExpectedDoorState(entry)
  if (expectedState != null) return Boolean(expectedState)

  const range = getMonitoringRange(entry)
  if (!range) return false
  return Number.isFinite(range.min) || Number.isFinite(range.max)
}

export function getShipmentMonitoringState(shipment) {
  if (shipment.status === 'draft') {
    return { tone: 'muted', label: 'Draft', detail: 'Monitoring has not started.' }
  }
  if (shipment.status === 'delivered') {
    return { tone: 'ok', label: 'Completed', detail: 'Shipment delivered.' }
  }
  if (shipment.status === 'archived') {
    return {
      tone: 'muted',
      label: 'Archived',
      detail: 'Read-only record retained in shipment history.',
    }
  }

  // Acknowledged alerts are seen but not fixed, so they still count as
  // unresolved when summarising the shipment's monitoring status.
  const unresolvedAlerts = (shipment.alerts ?? []).filter(
    (alert) => alert.status !== 'resolved',
  )
  if (unresolvedAlerts.some((alert) => alert.severity === 'critical')) {
    return {
      tone: 'critical',
      label: 'Critical alert active',
      detail: 'One or more configured critical thresholds are currently exceeded.',
    }
  }
  if (unresolvedAlerts.some((alert) => alert.severity === 'warning')) {
    return {
      tone: 'warn',
      label: 'Warning active',
      detail: 'One or more configured warning thresholds are currently exceeded.',
    }
  }
  if (shipment.status === 'scheduled') {
    return {
      tone: 'info',
      label: 'Scheduled',
      detail: 'Device assigned; monitoring begins at departure.',
    }
  }

  const enabledSensors = SENSOR_IDS.filter(
    (id) => shipment.monitoring?.[id]?.enabled,
  )
  const needsConfiguration = enabledSensors.some(
    (id) => !isMonitoringConfigured(shipment.monitoring[id]),
  )
  if (needsConfiguration) {
    return {
      tone: 'warn',
      label: 'Needs configuration',
      detail: 'At least one selected parameter has no warning limit configured.',
    }
  }
  if (enabledSensors.length === 0) {
    return {
      tone: 'muted',
      label: 'Not monitoring',
      detail: 'No parameters are enabled for this shipment.',
    }
  }
  return {
    tone: 'ok',
    label: 'Monitoring normally',
    detail: 'All enabled readings are within the configured ranges.',
  }
}

export function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatSensorValue(sensorId, value) {
  const meta = SENSOR_CATALOG[sensorId]
  if (!meta || value == null) return '—'
  if (meta.kind === 'state') return value ? 'Open' : 'Closed'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${numeric.toFixed(meta.decimals)} ${meta.unit}`
}

export function formatRange(range, sensorId) {
  const meta = SENSOR_CATALOG[sensorId]
  if (!range || !meta) return 'Needs configuration'
  if (range.state != null) return `Expected ${range.state}`
  const { min, max } = range
  const hasMin = Number.isFinite(min)
  const hasMax = Number.isFinite(max)
  if (hasMin && hasMax) return `${min}–${max} ${meta.unit}`
  if (hasMax) return `≤ ${max} ${meta.unit}`
  if (hasMin) return `≥ ${min} ${meta.unit}`
  return 'Needs configuration'
}