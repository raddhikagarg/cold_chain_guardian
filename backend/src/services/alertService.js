const ApiError = require('../utils/ApiError')
const { Alert, Device, Shipment } = require('../models')
const {
  ALERT_SEVERITIES,
  SYSTEM_ALERT_TYPES,
  ALERT_PARAMETERS,
} = require('../constants/enums')
const {
  parseEnum,
  parseOptionalString,
  parseDate,
  parseSort,
} = require('../validation/queryParams')
const {
  validateAcknowledgeShape,
  validateResolveShape,
} = require('../validation/alertInput')
const {
  parsePagination,
  buildPaginationMeta,
} = require('../utils/pagination')
const { buildShipmentFilter } = require('./shipmentService')
const { presentAlert } = require('./shipmentPresenter')
const { resolutionUpdate } = require('./alertEpisodeService')

const ALERT_STATUS_FILTERS = [
  'all',
  'open',
  'active',
  'acknowledged',
  'resolved',
  'warning',
  'critical',
]
const ALERT_SEVERITY_FILTERS = ['all', ...ALERT_SEVERITIES]
const ALERT_TYPE_FILTERS = ['all', 'cargo', 'system', ...SYSTEM_ALERT_TYPES]
const ALERT_SORT_FIELDS = [
  'startedAt',
  'createdAt',
  'updatedAt',
  'resolvedAt',
  'severity',
  'status',
]

function emptyPage(pagination) {
  return {
    items: [],
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total: 0,
    }),
  }
}

function buildAlertFilter({ status, severity, type, parameter, from, to }) {
  const filter = {}

  if (status === 'open') {
    filter.status = { $ne: 'resolved' }
  } else if (status === 'warning' || status === 'critical') {
    filter.status = { $ne: 'resolved' }
    filter.severity = status
  } else if (status !== 'all') {
    filter.status = status
  }

  if (severity !== 'all') filter.severity = severity

  if (type === 'cargo') {
    filter.source = 'cargo'
  } else if (type === 'system') {
    filter.source = 'system'
  } else if (type !== 'all') {
    filter.source = 'system'
    filter.systemType = type
  }

  if (parameter !== 'all') filter.parameter = parameter

  if (from || to) {
    filter.startedAt = {}
    if (from) filter.startedAt.$gte = from
    if (to) filter.startedAt.$lte = to
  }

  return filter
}

async function resolveShipment(identifier) {
  if (!identifier) return { empty: false, shipment: null }
  const shipment = await Shipment.findOne(buildShipmentFilter(identifier))
    .select('shipmentId status')
    .lean()
  return { empty: !shipment, shipment }
}

async function resolveDevice(identifier) {
  if (!identifier) return { empty: false, device: null }
  const filter = /^[0-9a-fA-F]{24}$/.test(identifier)
    ? { $or: [{ deviceId: identifier }, { _id: identifier }] }
    : { deviceId: identifier }
  const device = await Device.findOne(filter).select('deviceId name').lean()
  return { empty: !device, device }
}

async function loadContext(alerts) {
  const shipmentIds = [...new Set(alerts.map((alert) => String(alert.shipment)))]
  const deviceIds = [
    ...new Set(alerts.map((alert) => alert.device).filter(Boolean).map(String)),
  ]

  const [shipments, devices] = await Promise.all([
    shipmentIds.length === 0
      ? []
      : Shipment.find({ _id: { $in: shipmentIds } })
          .select('shipmentId status')
          .lean(),
    deviceIds.length === 0
      ? []
      : Device.find({ _id: { $in: deviceIds } })
          .select('deviceId name')
          .lean(),
  ])

  return {
    shipments: new Map(
      shipments.map((shipment) => [String(shipment._id), shipment]),
    ),
    devices: new Map(devices.map((device) => [String(device._id), device])),
  }
}

function presentWithContext(alert, context) {
  return presentAlert(alert, {
    shipment: context.shipments.get(String(alert.shipment)) ?? null,
    device: alert.device
      ? context.devices.get(String(alert.device)) ?? null
      : null,
  })
}

async function listAlerts(query = {}) {
  const pagination = parsePagination(query, { defaultLimit: 20, maxLimit: 100 })
  const status = parseEnum(query.status, {
    field: 'status',
    allowed: ALERT_STATUS_FILTERS,
    defaultValue: 'all',
  })
  const severity = parseEnum(query.severity, {
    field: 'severity',
    allowed: ALERT_SEVERITY_FILTERS,
    defaultValue: 'all',
  })
  const type = parseEnum(query.type, {
    field: 'type',
    allowed: ALERT_TYPE_FILTERS,
    defaultValue: 'all',
  })
  const parameter = parseEnum(query.parameter, {
    field: 'parameter',
    allowed: ['all', ...ALERT_PARAMETERS],
    defaultValue: 'all',
  })
  const shipmentId = parseOptionalString(query.shipmentId, {
    field: 'shipmentId',
    maxLength: 80,
  })
  const deviceId = parseOptionalString(query.deviceId, {
    field: 'deviceId',
    maxLength: 80,
  })
  const from = parseDate(query.from, { field: 'from' })
  const to = parseDate(query.to, { field: 'to' })
  const sort = parseSort(query.sort, {
    field: 'sort',
    allowed: ALERT_SORT_FIELDS,
    defaultValue: 'startedAt:desc',
  })

  if (from && to && from.getTime() > to.getTime()) {
    throw ApiError.badRequest('INVALID_QUERY', 'from must not be after to.', [
      { field: 'from', message: 'from must not be after to.' },
    ])
  }

  const [shipmentLookup, deviceLookup] = await Promise.all([
    resolveShipment(shipmentId),
    resolveDevice(deviceId),
  ])

  if (shipmentLookup.empty || deviceLookup.empty) {
    return emptyPage(pagination)
  }

  const filter = buildAlertFilter({
    status,
    severity,
    type,
    parameter,
    from,
    to,
  })
  if (shipmentLookup.shipment) filter.shipment = shipmentLookup.shipment._id
  if (deviceLookup.device) filter.device = deviceLookup.device._id

  const [total, alerts] = await Promise.all([
    Alert.countDocuments(filter),
    Alert.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ])

  const context = await loadContext(alerts)

  return {
    items: alerts.map((alert) => presentWithContext(alert, context)),
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total,
    }),
  }
}

function alertFilter(identifier) {
  const trimmed = String(identifier ?? '').trim()
  if (trimmed.length === 0) throw ApiError.notFound('Alert was not found.')

  if (/^[0-9a-fA-F]{24}$/.test(trimmed)) {
    return { $or: [{ _id: trimmed }, { alertCode: trimmed }] }
  }

  return { alertCode: trimmed }
}

async function findAlertDocument(identifier) {
  const alert = await Alert.findOne(alertFilter(identifier))
  if (!alert) {
    throw ApiError.notFound(`Alert "${identifier}" was not found.`)
  }
  return alert
}

async function getAlertDetail(identifier) {
  const alert = await findAlertDocument(identifier)
  const context = await loadContext([alert])
  return presentWithContext(alert, context)
}

function transitionConflict(alert, action) {
  if (alert.status === 'resolved') {
    return ApiError.conflict(
      'ALERT_ALREADY_RESOLVED',
      `Alert ${alert.alertCode ?? alert._id} is already resolved.`,
      [{ field: 'status', message: 'Resolved alerts are read-only.' }],
    )
  }

  if (action === 'acknowledge' && alert.status === 'acknowledged') {
    return ApiError.conflict(
      'ALERT_ALREADY_ACKNOWLEDGED',
      `Alert ${alert.alertCode ?? alert._id} is already acknowledged.`,
      [{ field: 'status', message: 'The acknowledgement was already recorded.' }],
    )
  }

  return ApiError.conflict(
    'INVALID_ALERT_TRANSITION',
    `Cannot ${action} an alert with status "${alert.status}".`,
    [{ field: 'status', message: `Alert status "${alert.status}" cannot be ${action}d.` }],
  )
}

async function acknowledgeAlert(identifier, input) {
  validateAcknowledgeShape(input)
  const alert = await findAlertDocument(identifier)

  if (alert.status !== 'active') throw transitionConflict(alert, 'acknowledge')

  const now = new Date()
  const updated = await Alert.findOneAndUpdate(
    { _id: alert._id, status: 'active' },
    { $set: { status: 'acknowledged', acknowledgedAt: now } },
    { new: true, runValidators: true },
  )

  if (!updated) {
    const current = await Alert.findById(alert._id)
    throw transitionConflict(current ?? alert, 'acknowledge')
  }

  return getAlertDetail(updated._id)
}

async function resolveAlert(identifier, input) {
  const body = validateResolveShape(input)
  const alert = await findAlertDocument(identifier)

  if (alert.status === 'resolved') throw transitionConflict(alert, 'resolve')

  const now = new Date()
  const updated = await Alert.findOneAndUpdate(
    { _id: alert._id, status: { $in: ['active', 'acknowledged'] } },
    {
      $set: {
        status: 'resolved',
        resolvedAt: now,
        resolutionNote: body.resolutionNote,
        resolvedBy: body.resolvedBy,
      },
      ...resolutionUpdate(),
    },
    { new: true, runValidators: true },
  )

  if (!updated) {
    const current = await Alert.findById(alert._id)
    throw transitionConflict(current ?? alert, 'resolve')
  }

  return getAlertDetail(updated._id)
}

module.exports = {
  ALERT_STATUS_FILTERS,
  ALERT_SEVERITY_FILTERS,
  ALERT_TYPE_FILTERS,
  ALERT_SORT_FIELDS,
  buildAlertFilter,
  listAlerts,
  getAlertDetail,
  acknowledgeAlert,
  resolveAlert,
}
