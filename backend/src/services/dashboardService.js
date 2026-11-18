const ApiError = require('../utils/ApiError')
const { Alert, Device, SensorReading, Shipment } = require('../models')
const {
  OPERATIONAL_SHIPMENT_STATUSES,
  SHIPMENT_LIFECYCLE_STATUSES,
  SHIPMENT_HEALTH_STATUSES,
} = require('../constants/enums')
const {
  READING_EVIDENCE_FRESH_MINUTES,
  MINUTE_MS,
} = require('../constants/deviceHealth')
const { parseOptionalString } = require('../validation/queryParams')
const { deriveDeviceHealth } = require('../utils/deviceHealth')
const { buildShipmentFilter } = require('./shipmentService')
const {
  presentShipment,
  presentAlert,
  toIso,
} = require('./shipmentPresenter')
const { presentDevice } = require('./devicePresenter')
const { calculateExposure } = require('./exposureService')

/**
 * Dashboard aggregate.
 *
 * Only scheduled and in-transit shipments are operational. Fleet counters,
 * alerts and device summaries therefore describe the live fleet; completed and
 * archived shipments remain available through their history endpoints.
 *
 * A requested shipment is never silently replaced: unknown, completed and
 * archived identifiers all return 404.
 */

const ALERT_TYPE_BUCKETS = Object.freeze([
  'cargo',
  'offline',
  'battery',
  'sensorFault',
  'selfTest',
])

function emptyCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]))
}

function addHealthCount(counts, status) {
  counts[status] = (counts[status] ?? 0) + 1
}

async function loadStatusCounts() {
  const rows = await Shipment.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ])

  const counts = emptyCounts(SHIPMENT_LIFECYCLE_STATUSES)
  for (const row of rows) {
    if (row._id) counts[row._id] = row.count
  }
  return counts
}

async function loadCargoHealthCounts() {
  const rows = await Shipment.aggregate([
    { $match: { status: { $in: OPERATIONAL_SHIPMENT_STATUSES } } },
    { $group: { _id: '$healthStatus', count: { $sum: 1 } } },
  ])

  const counts = emptyCounts(SHIPMENT_HEALTH_STATUSES)
  for (const row of rows) {
    if (row._id) counts[row._id] = row.count
  }
  return counts
}

async function loadFleetAlerts() {
  const rows = await Alert.aggregate([
    { $match: { status: { $ne: 'resolved' } } },
    {
      $lookup: {
        from: 'shipments',
        localField: 'shipment',
        foreignField: '_id',
        as: 'shipmentDoc',
      },
    },
    {
      $match: {
        'shipmentDoc.status': { $in: OPERATIONAL_SHIPMENT_STATUSES },
      },
    },
    {
      $group: {
        _id: {
          severity: '$severity',
          source: '$source',
          systemType: '$systemType',
        },
        count: { $sum: 1 },
      },
    },
  ])

  const bySeverity = emptyCounts(['critical', 'warning', 'info'])
  const byType = emptyCounts(ALERT_TYPE_BUCKETS)
  let total = 0

  for (const row of rows) {
    const count = row.count ?? 0
    total += count
    if (row._id?.severity) bySeverity[row._id.severity] = count + (bySeverity[row._id.severity] ?? 0)

    if (row._id?.source === 'cargo') {
      byType.cargo += count
    } else if (row._id?.systemType) {
      byType[row._id.systemType] = count + (byType[row._id.systemType] ?? 0)
    }
  }

  return { total, bySeverity, byType }
}

async function loadFleetDevices() {
  const [registeredTotal, assignedIds] = await Promise.all([
    Device.countDocuments({}),
    Shipment.distinct('device', {
      status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
      device: { $ne: null },
    }),
  ])

  const devices =
    assignedIds.length === 0
      ? []
      : await Device.find({ _id: { $in: assignedIds } })
          .select(
            'deviceId name status battery lastSeenAt sensors sensorHealth',
          )
          .lean()

  const connection = emptyCounts(['online', 'stale', 'offline'])
  const health = emptyCounts(['healthy', 'warning', 'critical', 'unknown'])

  for (const device of devices) {
    const derived = deriveDeviceHealth(device)
    connection[derived.connection.state] =
      (connection[derived.connection.state] ?? 0) + 1
    addHealthCount(health, derived.status)
  }

  return {
    registered: registeredTotal,
    assigned: devices.length,
    available: Math.max(0, registeredTotal - devices.length),
    connection,
    health,
  }
}

function buildFleetSummary({ statusCounts, cargoHealth, alerts, devices }) {
  const operationalTotal =
    (statusCounts.scheduled ?? 0) + (statusCounts['in-transit'] ?? 0)

  return {
    operational: operationalTotal,
    statusCounts: {
      scheduled: statusCounts.scheduled ?? 0,
      inTransit: statusCounts['in-transit'] ?? 0,
      draft: statusCounts.draft ?? 0,
      delivered: statusCounts.delivered ?? 0,
      completed: statusCounts.delivered ?? 0,
      archived: statusCounts.archived ?? 0,
      total:
        (statusCounts.draft ?? 0) +
        (statusCounts.scheduled ?? 0) +
        (statusCounts['in-transit'] ?? 0) +
        (statusCounts.delivered ?? 0) +
        (statusCounts.archived ?? 0),
    },
    cargoHealth,
    alerts,
    devices,
  }
}

function monitorSummary(monitoring = {}) {
  return Object.fromEntries(
    Object.entries(monitoring).map(([sensorId, config]) => [
      sensorId,
      {
        available: config?.available === true,
        enabled: config?.enabled === true,
        warning: config?.warning ?? null,
        critical: config?.critical ?? null,
        escalationMinutes: config?.escalationMinutes ?? null,
        expectedState: config?.expectedState ?? null,
      },
    ]),
  )
}

async function loadSelectedShipment(identifier, now) {
  const shipment = await Shipment.findOne(buildShipmentFilter(identifier)).lean()

  if (!shipment) {
    throw ApiError.notFound(`Shipment "${identifier}" was not found.`)
  }

  if (!OPERATIONAL_SHIPMENT_STATUSES.includes(shipment.status)) {
    throw ApiError.notFound(
      `Shipment "${identifier}" is ${shipment.status} and is not an operational shipment. Use the shipment history endpoints instead.`,
      [{ field: 'shipmentId', message: 'Only scheduled and in-transit shipments are dashboard-selectable.' }],
    )
  }

  const [device, alerts, alertCounts, resolvedCount, latestReading, exposure] =
    await Promise.all([
      shipment.device ? Device.findById(shipment.device).lean() : null,
      Alert.find({ shipment: shipment._id, status: { $ne: 'resolved' } })
        .sort({ startedAt: -1 })
        .limit(100)
        .lean(),
      Alert.aggregate([
        {
          $match: {
            shipment: shipment._id,
            status: { $ne: 'resolved' },
          },
        },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      Alert.countDocuments({ shipment: shipment._id, status: 'resolved' }),
      SensorReading.findOne({
        shipment: shipment._id,
        evaluationSkipped: { $ne: true },
      })
        .sort({ recordedAt: -1 })
        .lean(),
      calculateExposure(shipment),
    ])

  const alertSummary = {
    open: 0,
    critical: 0,
    warning: 0,
    resolved: resolvedCount,
  }
  for (const row of alertCounts) {
    const count = row.count ?? 0
    alertSummary.open += count
    if (row._id === 'critical') alertSummary.critical += count
    if (row._id === 'warning') alertSummary.warning += count
  }

  const readingAgeMinutes =
    latestReading?.recordedAt === null || latestReading?.recordedAt === undefined
      ? null
      : Math.max(
          0,
          (now.getTime() - new Date(latestReading.recordedAt).getTime()) / MINUTE_MS,
        )

  const connectionState = device
    ? deriveDeviceHealth(device, now).connection.state
    : 'offline'
  const isCurrentReading =
    Boolean(latestReading) &&
    connectionState === 'online' &&
    readingAgeMinutes !== null &&
    readingAgeMinutes <= READING_EVIDENCE_FRESH_MINUTES

  const shipmentView = presentShipment(shipment, {
    device,
    alertSummary,
    detail: true,
    alerts,
    latestReading,
    exposure,
  })

  return {
    shipment: shipmentView,
    device: presentDevice(device, { assignedShipment: shipment }),
    monitoring: monitorSummary(shipment.monitoring),
    systemAlerts: shipment.systemAlerts ?? {},
    alerts: alerts.map((alert) => presentAlert(alert, { shipment, device })),
    alertSummary,
    alertsTruncated: alertSummary.open > alerts.length,
    latestReading: latestReading
      ? {
          ...shipmentView.latestReading,
          eligible: true,
          current: isCurrentReading,
          ageMinutes:
            readingAgeMinutes === null
              ? null
              : Number(readingAgeMinutes.toFixed(1)),
        }
      : null,
    readingFreshness: {
      state: isCurrentReading
        ? 'current'
        : latestReading
          ? 'not-current'
          : 'no-eligible-readings',
      current: isCurrentReading,
      staleAfterMinutes: READING_EVIDENCE_FRESH_MINUTES,
      deviceConnectionState: connectionState,
      lastEligibleReadingAt: toIso(latestReading?.recordedAt),
    },
    timeline: shipmentView.timeline,
    operational: {
      isOperational: true,
      cargoHealth: shipment.healthStatus,
      lifecycleStatus: shipment.status,
      routeProgress: shipment.route?.progress ?? 0,
      departure: toIso(shipment.route?.departure),
      arrival: toIso(shipment.route?.arrival),
      deadline: toIso(shipment.route?.deadline),
    },
  }
}

async function getDashboardOverview(query = {}) {
  const shipmentId = parseOptionalString(query.shipmentId, {
    field: 'shipmentId',
    maxLength: 80,
  })

  const now = new Date()

  const [statusCounts, cargoHealth, alerts, devices, selectedShipment] =
    await Promise.all([
      loadStatusCounts(),
      loadCargoHealthCounts(),
      loadFleetAlerts(),
      loadFleetDevices(),
      shipmentId ? loadSelectedShipment(shipmentId, now) : null,
    ])

  const fleet = buildFleetSummary({
    statusCounts,
    cargoHealth,
    alerts,
    devices,
  })

  return {
    data: {
      fleet,
      selectedShipment,
    },
    meta: {
      generatedAt: now.toISOString(),
      operationalStatuses: [...OPERATIONAL_SHIPMENT_STATUSES],
      selectedShipmentId: selectedShipment?.shipment?.shipmentId ?? null,
      selected: Boolean(selectedShipment),
    },
  }
}

module.exports = {
  ALERT_TYPE_BUCKETS,
  getDashboardOverview,
  loadCargoHealthCounts,
  loadFleetAlerts,
  loadFleetDevices,
  loadStatusCounts,
}
