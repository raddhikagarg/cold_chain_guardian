/**
 * Alert helpers shared by the Alerts page.
 *
 * Alerts live inside each shipment (`shipment.alerts`) so there is a single
 * source of truth. These helpers flatten that structure for filtering and
 * derive display values without inventing thresholds.
 */

import { SENSOR_CATALOG, SENSOR_IDS } from '../data/shipmentData.js'
import { formatDateTime, formatRange, getExpectedDoorState, getMonitoringRange } from './shipments.js'

export const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 }

export const SEVERITY_META = {
  critical: { label: 'Critical', tone: 'critical' },
  warning: { label: 'Warning', tone: 'warn' },
  info: { label: 'Info', tone: 'info' },
}

export const STATUS_META = {
  active: { label: 'Active', tone: 'critical' },
  acknowledged: { label: 'Acknowledged', tone: 'warn' },
  resolved: { label: 'Resolved', tone: 'ok' },
}

export const SYSTEM_TYPE_LABELS = {
  battery: 'Battery',
  offline: 'Connectivity',
  sensorFault: 'Sensor fault',
  selfTest: 'Sensor self-test',
}

export const ALERT_HISTORY_NOTE =
  'Entries tagged “Demo history” are illustrative resolved alerts added for this prototype.'

function toTime(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/** Flatten alerts from every shipment, keeping the owning shipment attached. */
export function getAllAlerts(shipments) {
  return shipments.flatMap((shipment) =>
    (shipment.alerts ?? []).map((alert) => ({ ...alert, shipment })),
  )
}

/** Open queue = anything that has not been resolved yet (active + acknowledged). */
export function isUnresolved(alert) {
  return alert.status !== 'resolved'
}

export function summarizeAlerts(alerts) {
  return alerts.reduce(
    (summary, alert) => {
      if (alert.status === 'resolved') {
        summary.resolved += 1
        return summary
      }
      summary.active += 1
      if (alert.severity === 'critical') summary.critical += 1
      if (alert.severity === 'warning') summary.warning += 1
      return summary
    },
    { active: 0, critical: 0, warning: 0, resolved: 0 },
  )
}

export function getAlertParameterMeta(alert) {
  const sensor = SENSOR_CATALOG[alert.parameter]
  if (sensor) {
    return { label: sensor.label, model: sensor.model, unit: sensor.unit }
  }
  return {
    label: 'Device / system',
    model: SYSTEM_TYPE_LABELS[alert.systemType] ?? 'ESP32 tracker',
    unit: null,
  }
}

function formatThreshold(range, parameter) {
  if (!range) return 'Not configured'
  if (range.maxOpenMinutes != null) {
    return `Unexpected state for more than ${range.maxOpenMinutes} min`
  }
  return formatRange(range, parameter)
}

/**
 * Thresholds come from the shipment's own monitoring / system alert config.
 * When nothing is configured we say so instead of inventing a limit.
 */
export function getConfiguredThreshold(shipment, alert) {
  if (alert.source === 'system') {
    const system = shipment.systemAlerts ?? {}

    if (alert.systemType === 'battery') {
      const config = system.battery
      const configured = Boolean(config?.enabled) && Number.isFinite(config?.thresholdPercent)
      return {
        configured,
        rows: [
          {
            label: 'Battery threshold',
            value: configured ? `< ${config.thresholdPercent}%` : 'Not configured',
          },
        ],
        escalation: null,
      }
    }

    if (alert.systemType === 'offline') {
      const config = system.offline
      const configured = Boolean(config?.enabled) && Number.isFinite(config?.afterMinutes)
      return {
        configured,
        rows: [
          {
            label: 'Offline threshold',
            value: configured
              ? `No telemetry for ${config.afterMinutes} min`
              : 'Not configured',
          },
        ],
        escalation: null,
      }
    }

    if (alert.systemType === 'sensorFault') {
      const config = system.sensorFault
      return {
        configured: Boolean(config?.enabled),
        rows: [
          {
            label: 'Fault detection',
            value: config?.enabled ? 'Enabled' : 'Not configured',
          },
        ],
        escalation: null,
      }
    }

    if (alert.systemType === 'selfTest') {
      const config = system.selfTest
      return {
        configured: Boolean(config?.enabled),
        rows: [
          {
            label: 'Self-test monitoring',
            value: config?.enabled ? 'Enabled' : 'Not configured',
          },
        ],
        escalation: null,
      }
    }

    return {
      configured: false,
      rows: [{ label: 'System threshold', value: 'Not configured' }],
      escalation: null,
    }
  }

  const config = shipment.monitoring?.[alert.parameter]
  if (!config || !config.available) {
    return {
      configured: false,
      rows: [{ label: 'Configured threshold', value: 'Sensor not fitted' }],
      escalation: null,
    }
  }

  const expectedState = getExpectedDoorState(config)
  const warning = getMonitoringRange(config)
  const rows = []

  if (expectedState) {
    rows.push({
      label: 'Expected state',
      value: expectedState === 'open' ? 'Open' : 'Closed',
    })
  }

  rows.push({
    label: 'Warning',
    value: formatThreshold(warning, alert.parameter),
  })
  rows.push({
    label: 'Critical',
    value: formatThreshold(config.critical, alert.parameter),
  })

  return {
    configured: Boolean(warning || config.critical || expectedState),
    rows,
    escalation:
      Number(config.escalationMinutes) > 0
        ? `Escalates after ${config.escalationMinutes} min`
        : null,
  }
}

export function isAlertRecovered(alert) {
  return Boolean(alert.recoveredAt) || alert.status === 'resolved'
}

export function getAlertEndTime(alert) {
  if (alert.recoveredAt) return toTime(alert.recoveredAt)
  if (alert.status === 'resolved') return toTime(alert.resolvedAt)
  return null
}

export function getAlertDurationMs(alert, now = Date.now()) {
  const start = toTime(alert.startedAt)
  if (start == null) return null
  const end = getAlertEndTime(alert) ?? now
  return Math.max(0, end - start)
}

export function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 1) return '< 1 min'
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) {
    return minutes ? `${hours} h ${String(minutes).padStart(2, '0')} min` : `${hours} h`
  }
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest ? `${days} d ${rest} h` : `${days} d`
}

export function getDurationLabel(alert, now = Date.now()) {
  const duration = formatDuration(getAlertDurationMs(alert, now))
  if (alert.recoveredAt) return `${duration} · recovered`
  if (alert.status === 'resolved') return duration
  return `${duration} ongoing`
}

export function getAlertCondition(alert) {
  if (alert.status === 'resolved') {
    return {
      key: 'resolved',
      label: 'Resolved',
      tone: 'ok',
      detail: 'This alert has been resolved and is kept in alert history.',
    }
  }
  if (alert.recoveredAt) {
    return {
      key: 'recovered',
      label: 'Condition recovered',
      tone: 'warn',
      detail: 'Readings returned to the configured range, but the alert is still open for review.',
    }
  }
  return {
    key: 'ongoing',
    label: 'Condition ongoing',
    tone: 'critical',
    detail: 'No recovery has been recorded for the condition that triggered this alert.',
  }
}

/**
 * Related incident: same parameter, closest start time. Uses the incidents
 * already stored on the shipment.
 */
export function getRelatedIncident(shipment, alert) {
  const incidents = (shipment.incidents ?? []).filter(
    (incident) => incident.parameter === alert.parameter,
  )
  if (incidents.length === 0) return null

  const target = toTime(alert.startedAt)
  if (target == null) return incidents[0]

  return incidents.reduce((best, incident) => {
    const time = toTime(incident.time)
    if (time == null) return best
    const distance = Math.abs(time - target)
    if (!best || distance < best.distance) return { incident, distance }
    return best
  }, null)?.incident ?? null
}

const TIMELINE_WINDOW_MS = 10 * 60 * 1000

/** Timeline entries around when the alert started or recovered. */
export function getRelatedTimelineEvents(shipment, alert) {
  const anchors = [alert.startedAt, alert.recoveredAt]
    .map(toTime)
    .filter((time) => time != null)
  if (anchors.length === 0) return []

  return (shipment.timeline ?? [])
    .filter((event) => {
      const time = toTime(event.time)
      if (time == null) return false
      return anchors.some((anchor) => Math.abs(time - anchor) <= TIMELINE_WINDOW_MS)
    })
    .slice(0, 4)
}

export function getShipmentOptions(alerts) {
  const seen = new Map()
  alerts.forEach((alert) => {
    const { shipment } = alert
    if (seen.has(shipment.id)) return
    seen.set(shipment.id, {
      value: shipment.id,
      label: `${shipment.id} · ${shipment.cargo?.produce ?? 'Unknown cargo'}`,
    })
  })
  return [...seen.values()].sort((a, b) => a.value.localeCompare(b.value))
}

export function getParameterOptions(alerts) {
  const present = new Set(alerts.map((alert) => alert.parameter))
  const options = SENSOR_IDS.filter((id) => present.has(id)).map((id) => ({
    value: id,
    label: SENSOR_CATALOG[id].label,
  }))
  if (present.has('device')) {
    options.push({ value: 'device', label: 'Device / system' })
  }
  return options
}

export function filterAlerts(
  alerts,
  { tab = 'active', query = '', severity = 'all', shipmentId = 'all', parameter = 'all', status = 'all' },
) {
  const normalized = query.trim().toLowerCase()

  return alerts.filter((alert) => {
    const inTab = tab === 'history' ? alert.status === 'resolved' : alert.status !== 'resolved'
    if (!inTab) return false
    if (severity !== 'all' && alert.severity !== severity) return false
    if (shipmentId !== 'all' && alert.shipment.id !== shipmentId) return false
    if (parameter !== 'all' && alert.parameter !== parameter) return false
    if (status !== 'all' && alert.status !== status) return false
    if (!normalized) return true

    const haystack = [
      alert.id,
      alert.title,
      alert.message,
      alert.reading,
      alert.threshold,
      alert.shipment.id,
      alert.shipment.cargo?.produce ?? '',
      getAlertParameterMeta(alert).label,
      SEVERITY_META[alert.severity]?.label ?? '',
      STATUS_META[alert.status]?.label ?? '',
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalized)
  })
}

export function sortAlerts(alerts, tab = 'active') {
  return [...alerts].sort((a, b) => {
    if (tab === 'history') {
      return (toTime(b.resolvedAt) ?? toTime(b.startedAt) ?? 0) -
        (toTime(a.resolvedAt) ?? toTime(a.startedAt) ?? 0)
    }
    const rank = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
    if (rank !== 0) return rank
    return (toTime(b.startedAt) ?? 0) - (toTime(a.startedAt) ?? 0)
  })
}

export function formatAlertTime(value) {
  return formatDateTime(value)
}
