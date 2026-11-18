const { SENSOR_CATALOG } = require('../constants/sensors')
const { getDeviceConnectionState } = require('../utils/deviceState')

function toPlain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value
}

function toIso(value) {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function emptyAlertSummary() {
  return { open: 0, critical: 0, warning: 0, resolved: 0 }
}

function summarizeAlerts(alerts = []) {
  return alerts.reduce((summary, alert) => {
    if (alert.status === 'resolved') {
      summary.resolved += 1
      return summary
    }
    summary.open += 1
    if (alert.severity === 'critical') summary.critical += 1
    if (alert.severity === 'warning') summary.warning += 1
    return summary
  }, emptyAlertSummary())
}

function summarizeAlertRows(rows = []) {
  return rows.reduce((summary, row) => {
    const count = row.count ?? 0
    if (row._id?.status === 'resolved') {
      summary.resolved += count
      return summary
    }
    summary.open += count
    if (row._id?.severity === 'critical') summary.critical += count
    if (row._id?.severity === 'warning') summary.warning += count
    return summary
  }, emptyAlertSummary())
}

function displayStatusFor(shipment) {
  if (shipment.status === 'in-transit') {
    if (shipment.healthStatus === 'critical') return 'critical'
    if (shipment.healthStatus === 'warning') return 'warning'
  }
  return shipment.status
}

function formatNumeric(value, sensorId) {
  const meta = SENSOR_CATALOG[sensorId]
  if (value === null || value === undefined) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (!meta) return String(number)
  const decimals = Number.isInteger(meta.decimals) ? meta.decimals : 0
  return `${number.toFixed(decimals)} ${meta.unit}`
}

function formatThreshold(alert) {
  const snapshot = alert.threshold ?? {}
  const parameter = alert.parameter

  if (snapshot.maxOpenMinutes !== null && snapshot.maxOpenMinutes !== undefined) {
    return `Unexpected state for more than ${snapshot.maxOpenMinutes} min`
  }

  if (alert.source === 'system') {
    if (alert.systemType === 'battery') {
      return Number.isFinite(snapshot.max) ? `Battery below ${snapshot.max}%` : 'Not configured'
    }
    if (alert.systemType === 'offline') {
      return Number.isFinite(snapshot.max)
        ? `No telemetry for ${snapshot.max} min`
        : 'Not configured'
    }
    return 'Configured system alert'
  }

  const meta = SENSOR_CATALOG[parameter]
  if (!meta) return 'Not configured'

  const hasMin = Number.isFinite(snapshot.min)
  const hasMax = Number.isFinite(snapshot.max)

  if (hasMin && hasMax) {
    return `${formatNumeric(snapshot.min, parameter)} – ${formatNumeric(snapshot.max, parameter)}`
  }
  if (hasMax) return `≤ ${formatNumeric(snapshot.max, parameter)}`
  if (hasMin) return `≥ ${formatNumeric(snapshot.min, parameter)}`
  return 'Not configured'
}

function formatReading(alert) {
  const value = alert.triggerValue
  if (value === null || value === undefined) return null

  if (alert.parameter === 'device') {
    if (alert.systemType === 'battery') return `${value}%`
    if (alert.systemType === 'offline') return `${value} min`
    return String(value)
  }

  if (alert.parameter === 'door' && alert.threshold?.maxOpenMinutes != null) {
    return `${value} min unexpected`
  }

  return formatNumeric(value, alert.parameter) ?? String(value)
}

function presentAlert(alert, options = {}) {
  const plain = toPlain(alert) ?? {}
  const objectId = plain._id ? String(plain._id) : null
  const alertCode = plain.alertCode ?? null
  const shipment = options.shipment ? toPlain(options.shipment) : null
  const device = options.device ? toPlain(options.device) : null

  return {
    id: alertCode ?? objectId,
    objectId,
    alertCode,
    shipmentId: shipment?.shipmentId ?? options.shipmentId ?? null,
    shipmentObjectId:
      shipment?._id
        ? String(shipment._id)
        : plain.shipment
          ? String(plain.shipment)
          : null,
    deviceId: device?.deviceId ?? options.deviceId ?? null,
    deviceObjectId:
      device?._id
        ? String(device._id)
        : plain.device
          ? String(plain.device)
          : null,
    source: plain.source ?? null,
    systemType: plain.systemType ?? null,
    parameter: plain.parameter ?? null,
    severity: plain.severity ?? null,
    title: plain.title ?? '',
    message: plain.message ?? '',
    triggerValue: plain.triggerValue ?? null,
    peakValue: plain.peakValue ?? null,
    thresholdSnapshot: plain.threshold
      ? {
          min: plain.threshold.min ?? null,
          max: plain.threshold.max ?? null,
          maxOpenMinutes: plain.threshold.maxOpenMinutes ?? null,
        }
      : null,
    startedAt: toIso(plain.startedAt),
    acknowledgedAt: toIso(plain.acknowledgedAt),
    recoveredAt: toIso(plain.recoveredAt),
    resolvedAt: toIso(plain.resolvedAt),
    status: plain.status ?? null,
    recovered: Boolean(plain.recoveredAt),
    resolutionNote: plain.resolutionNote ?? '',
    resolvedBy: plain.resolvedBy ?? '',
    createdAt: toIso(plain.createdAt),
    updatedAt: toIso(plain.updatedAt),
    display: {
      reading: formatReading(plain),
      threshold: formatThreshold(plain),
      peakReading:
        plain.peakValue === null || plain.peakValue === undefined
          ? null
          : formatNumeric(plain.peakValue, plain.parameter) ??
            String(plain.peakValue),
    },
    isDemo: Boolean(plain.isDemo),
  }
}

function presentDeviceSummary(device) {
  if (!device) return null

  return {
    id: device.deviceId,
    objectId: device._id ? String(device._id) : null,
    deviceId: device.deviceId,
    name: device.name,
    status: device.status,
    connectionState: getDeviceConnectionState(device),
    battery: device.battery ?? null,
    lastSeenAt: toIso(device.lastSeenAt),
  }
}

function presentRoute(route) {
  const plain = toPlain(route) ?? {}
  return {
    origin: plain.origin ?? '',
    destination: plain.destination ?? '',
    carrier: plain.carrier ?? '',
    vehicle: plain.vehicle ?? '',
    departure: toIso(plain.departure),
    arrival: toIso(plain.arrival),
    deadline: toIso(plain.deadline),
    distanceKm: plain.distanceKm ?? null,
    progress: plain.progress ?? 0,
  }
}

function presentTimeline(timeline = [], shipmentId) {
  return (timeline ?? []).map((event, index) => {
    const plain = toPlain(event) ?? {}
    return {
      id: `TL-${shipmentId}-${index + 1}`,
      occurredAt: toIso(plain.occurredAt),
      time: toIso(plain.occurredAt),
      title: plain.title ?? '',
      description: plain.description ?? '',
      tone: plain.tone ?? 'info',
    }
  })
}

function presentLatestReading(reading) {
  if (!reading) return null
  const plain = toPlain(reading) ?? {}

  return {
    id: plain._id ? String(plain._id) : null,
    recordedAt: toIso(plain.recordedAt),
    temperature: plain.temperature ?? null,
    humidity: plain.humidity ?? null,
    shock: plain.shock ?? null,
    light: plain.light ?? null,
    ethylene: plain.ethylene ?? null,
    doorOpen: plain.doorOpen ?? null,
    createdAt: toIso(plain.createdAt),
  }
}

function presentShipment(shipment, options = {}) {
  const plain = toPlain(shipment) ?? {}
  const displayStatus = displayStatusFor(plain)
  const device = options.device ?? null
  const detail = options.detail === true

  const result = {
    id: plain.shipmentId,
    objectId: plain._id ? String(plain._id) : null,
    shipmentId: plain.shipmentId,
    lifecycleStatus: plain.status,
    healthStatus: plain.healthStatus,
    displayStatus,
    status: displayStatus,
    cargo: toPlain(plain.cargo) ?? {},
    route: presentRoute(plain.route),
    deviceId: device?.deviceId ?? null,
    device: presentDeviceSummary(device),
    alertSummary: options.alertSummary ?? emptyAlertSummary(),
    completedAt: toIso(plain.completedAt),
    archivedAt: toIso(plain.archivedAt),
    completionSource: plain.completionSource ?? null,
    createdAt: toIso(plain.createdAt),
    updatedAt: toIso(plain.updatedAt),
    isDemo: Boolean(plain.isDemo),
    // There is no incident model in this phase; the key is kept for frontend
    // compatibility on both list and detail responses.
    incidents: [],
  }

  if (detail) {
    result.monitoring = toPlain(plain.monitoring) ?? {}
    result.systemAlerts = toPlain(plain.systemAlerts) ?? {}
    result.timeline = presentTimeline(plain.timeline, plain.shipmentId)
    result.alerts = (options.alerts ?? []).map((alert) =>
      presentAlert(alert, { shipment: plain, device }),
    )
    result.latestReading = presentLatestReading(options.latestReading)
    result.exposure = options.exposure ?? null
  }

  return result
}

module.exports = {
  emptyAlertSummary,
  summarizeAlerts,
  summarizeAlertRows,
  displayStatusFor,
  presentAlert,
  presentDeviceSummary,
  presentShipment,
  toIso,
}
