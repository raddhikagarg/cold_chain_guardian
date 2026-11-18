/**
 * Shipment history helpers.
 *
 * History is the dedicated view for completed (delivered) and archived
 * shipments. It reuses the same `shipments` records as every other screen —
 * there is no separate historical store.
 *
 * Completion is only ever derived from an explicit `completedAt` timestamp
 * (operator confirmation or a confirmed delivery event). Route estimates are
 * never treated as proof of delivery.
 */

import { CARGO_CATEGORIES } from '../data/shipmentData.js'
import { ACTIVE_STATUSES, formatDate, formatDateTime } from './shipments.js'
import { formatDuration } from './alerts.js'

export const COMPLETED_STATUS = 'delivered'
export const ARCHIVED_STATUS = 'archived'

/** Statuses shown in the Overview selector: scheduled + in transit. */
export const OPERATIONAL_STATUSES = ACTIVE_STATUSES

export const HISTORY_STATUS_OPTIONS = [
  { value: 'all', label: 'All records' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

export const HISTORY_DATE_OPTIONS = [
  { value: 'all', label: 'All time', days: null },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
  { value: '90', label: 'Last 90 days', days: 90 },
]

export const COMPLETION_SOURCE_LABELS = {
  operator: 'Confirmed by operator',
  'delivery-event': 'Confirmed delivery event',
}

/**
 * Proposed retention defaults. Informational only — nothing is deleted,
 * expired or hidden based on these values in this prototype.
 */
export const RETENTION_DEFAULTS = [
  { label: 'Completed shipment records', value: '90 days in easily accessible history' },
  { label: 'Alert history', value: '1 year' },
  { label: 'Sensor readings', value: '1 year' },
]

export const RETENTION_NOTE =
  'Proposed defaults, not automatic deletion rules. No records are deleted, expired or hidden in this prototype; retention will be configurable in the backend.'

const DAY_MS = 24 * 60 * 60 * 1000

function toTime(value) {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

export function isCompletedShipment(shipment) {
  return shipment?.status === COMPLETED_STATUS
}

export function isArchivedShipment(shipment) {
  return shipment?.status === ARCHIVED_STATUS
}

export function isHistoricalShipment(shipment) {
  return isCompletedShipment(shipment) || isArchivedShipment(shipment)
}

/** Scheduled, in transit or in an in-transit exception state. */
export function isOperationalShipment(shipment) {
  return OPERATIONAL_STATUSES.includes(shipment?.status)
}

export function getLifecycleStage(status) {
  if (status === COMPLETED_STATUS) return 'completed'
  if (status === ARCHIVED_STATUS) return 'archived'
  if (status === 'scheduled') return 'scheduled'
  if (OPERATIONAL_STATUSES.includes(status)) return 'in-transit'
  return 'draft'
}

export const LIFECYCLE_LABELS = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  'in-transit': 'In transit',
  completed: 'Completed',
  archived: 'Archived',
}

export function getLifecycleLabel(status) {
  return LIFECYCLE_LABELS[getLifecycleStage(status)]
}

/** Only a confirmed delivery can move into the archive. */
export function canArchiveShipment(shipment) {
  return isCompletedShipment(shipment)
}

/** Only a journey that has departed can be confirmed as delivered. */
export function canConfirmDelivery(shipment) {
  return ['in-transit', 'warning', 'critical'].includes(shipment?.status)
}

function nextTimelineId(timeline = []) {
  const highest = timeline.reduce((max, event) => {
    const number = Number(String(event.id).match(/(\d+)$/)?.[1])
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0)
  return `TL-${highest + 1}`
}

/**
 * Explicitly complete a shipment. Updated 2026-11: delivery is a deliberate
 * operator action or confirmed delivery event — never inferred from the
 * estimated arrival time. Alerts and incidents are deliberately left
 * untouched, so an unresolved alert stays unresolved after delivery.
 */
export function completeShipment(
  shipment,
  { completedAt = new Date().toISOString(), source = 'operator' } = {},
) {
  if (!canConfirmDelivery(shipment)) return shipment

  const timeline = shipment.timeline ?? []
  return {
    ...shipment,
    status: COMPLETED_STATUS,
    completedAt,
    completionSource: source,
    route: shipment.route
      ? { ...shipment.route, progress: 100 }
      : shipment.route,
    timeline: [
      ...timeline,
      {
        id: nextTimelineId(timeline),
        time: completedAt,
        title:
          source === 'delivery-event'
            ? 'Delivery event confirmed'
            : 'Delivery confirmed by operator',
        description:
          'Delivery recorded explicitly. Alerts keep their existing status and are not resolved automatically.',
        tone: 'ok',
      },
    ],
  }
}

/**
 * Archive a completed shipment. The whole record is retained; nothing is
 * deleted, hidden or expired based on the informational retention defaults.
 */
export function archiveShipment(
  shipment,
  { archivedAt = new Date().toISOString() } = {},
) {
  if (!canArchiveShipment(shipment)) return shipment

  const timeline = shipment.timeline ?? []
  return {
    ...shipment,
    status: ARCHIVED_STATUS,
    archivedAt,
    timeline: [
      ...timeline,
      {
        id: nextTimelineId(timeline),
        time: archivedAt,
        title: 'Record archived',
        description:
          'Full record retained; no readings, alerts, incidents or timeline events were removed.',
        tone: 'muted',
      },
    ],
  }
}

/* ------------------------------------------------------------------ */
/* Completion / journey timing                                        */
/* ------------------------------------------------------------------ */

/**
 * Explicit completion metadata. `completedAt` is only set by an operator
 * confirmation or a confirmed delivery event — never from `route.arrival`.
 */
export function getCompletionInfo(shipment) {
  const completedAt = shipment?.completedAt ?? null
  const archivedAt = shipment?.archivedAt ?? null
  const source = shipment?.completionSource ?? null

  return {
    completedAt,
    archivedAt,
    confirmed: Boolean(completedAt),
    source,
    sourceLabel:
      COMPLETION_SOURCE_LABELS[source] ??
      (completedAt ? 'Completion recorded' : null),
  }
}

/** Used for date filters and sorting; falls back to the archive date. */
export function getCompletionTime(shipment) {
  return toTime(shipment?.completedAt) ?? toTime(shipment?.archivedAt)
}

export function getJourneyDurationMs(shipment) {
  const start = toTime(shipment?.route?.departure)
  const end = toTime(shipment?.completedAt)
  if (start == null || end == null || end < start) return null
  return end - start
}

export function formatJourneyDuration(shipment) {
  const duration = getJourneyDurationMs(shipment)
  return duration == null ? '—' : formatDuration(duration)
}

export function getShipmentRecordCounts(shipment) {
  const alerts = shipment?.alerts ?? []
  const openAlerts = alerts.filter((alert) => alert.status !== 'resolved').length
  return {
    alerts: alerts.length,
    openAlerts,
    resolvedAlerts: alerts.length - openAlerts,
    incidents: (shipment?.incidents ?? []).length,
  }
}

/* ------------------------------------------------------------------ */
/* Collections, summary and filtering                                 */
/* ------------------------------------------------------------------ */

export function getHistoricalShipments(shipments) {
  return shipments.filter(isHistoricalShipment)
}

export function getOperationalShipments(shipments) {
  return shipments.filter(isOperationalShipment)
}

export function summarizeHistory(shipments) {
  return shipments.reduce(
    (summary, shipment) => {
      if (isCompletedShipment(shipment)) summary.completed += 1
      if (isArchivedShipment(shipment)) summary.archived += 1
      if (isHistoricalShipment(shipment)) summary.total += 1
      return summary
    },
    { completed: 0, archived: 0, total: 0 },
  )
}

export function getHistoryCarrierOptions(shipments) {
  const carriers = new Set()
  getHistoricalShipments(shipments).forEach((shipment) => {
    const carrier = shipment.route?.carrier?.trim()
    if (carrier) carriers.add(carrier)
  })
  return [...carriers]
    .sort((a, b) => a.localeCompare(b))
    .map((carrier) => ({ value: carrier, label: carrier }))
}

export function getHistoryCargoOptions() {
  return CARGO_CATEGORIES.map((category) => ({
    value: category.id,
    label: category.label,
  }))
}

function categoryLabel(id) {
  return CARGO_CATEGORIES.find((category) => category.id === id)?.label ?? id
}

function matchesStatus(shipment, status) {
  if (status === 'completed') return isCompletedShipment(shipment)
  if (status === 'archived') return isArchivedShipment(shipment)
  return isHistoricalShipment(shipment)
}

export function filterHistory(
  shipments,
  {
    query = '',
    status = 'all',
    category = 'all',
    carrier = 'all',
    dateRange = 'all',
    now = Date.now(),
  } = {},
) {
  const normalized = query.trim().toLowerCase()
  const days =
    HISTORY_DATE_OPTIONS.find((option) => option.value === dateRange)?.days ?? null
  const cutoff = days ? now - days * DAY_MS : null

  return shipments.filter((shipment) => {
    if (!isHistoricalShipment(shipment)) return false
    if (!matchesStatus(shipment, status)) return false
    if (category !== 'all' && shipment.cargo?.category !== category) return false
    if (carrier !== 'all' && (shipment.route?.carrier ?? '') !== carrier) {
      return false
    }
    if (cutoff != null) {
      const completed = getCompletionTime(shipment)
      if (completed == null || completed < cutoff) return false
    }
    if (!normalized) return true

    const haystack = [
      shipment.id,
      shipment.cargo?.produce ?? '',
      categoryLabel(shipment.cargo?.category),
      shipment.cargo?.batch ?? '',
      shipment.route?.origin ?? '',
      shipment.route?.destination ?? '',
      shipment.route?.carrier ?? '',
      shipment.deviceId ?? '',
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(normalized)
  })
}

/** Newest confirmed completion first. */
export function sortHistory(shipments) {
  return [...shipments].sort(
    (a, b) => (getCompletionTime(b) ?? 0) - (getCompletionTime(a) ?? 0),
  )
}

export function formatCompletedDate(shipment) {
  return formatDate(shipment?.completedAt)
}

export function formatDeliveredAt(shipment) {
  return formatDateTime(shipment?.completedAt)
}
