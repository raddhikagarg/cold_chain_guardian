const ApiError = require('../utils/ApiError')
const { Alert, Device, SensorReading, Shipment } = require('../models')
const {
  CARGO_CATEGORIES,
  SHIPMENT_HEALTH_STATUSES,
} = require('../constants/enums')
const {
  validateCreateShape,
  validateRouteOrdering,
  validateShipmentConfiguration,
  validateMonitoringAvailability,
} = require('../validation/shipmentInput')
const {
  parseEnum,
  parseOptionalString,
  parseSort,
  escapeRegex,
} = require('../validation/queryParams')
const {
  parsePagination,
  buildPaginationMeta,
} = require('../utils/pagination')
const {
  emptyAlertSummary,
  presentShipment,
  summarizeAlerts,
} = require('./shipmentPresenter')
const {
  resolveDevice,
  assertDeviceAvailable,
  isOperationalDeviceConflict,
  operationalDeviceConflict,
} = require('./deviceAvailability')
const { calculateExposure } = require('./exposureService')

const STATUS_FILTERS = [
  'all',
  'draft',
  'scheduled',
  'in-transit',
  'warning',
  'critical',
  'delivered',
  'archived',
  'active',
  'history',
]

const HEALTH_FILTERS = ['all', ...SHIPMENT_HEALTH_STATUSES]
const CATEGORY_FILTERS = ['all', ...CARGO_CATEGORIES]
const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'shipmentId',
  'completedAt',
  'archivedAt',
  'status',
  'healthStatus',
]

const AUTO_ID_BASE = 2480
const AUTO_ID_ATTEMPTS = 5

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function buildInitialTimeline(status, device) {
  const now = new Date()

  if (status === 'draft') {
    return [
      {
        title: 'Draft created',
        description: 'Complete the requirements and assign a device when ready.',
        tone: 'muted',
        occurredAt: now,
      },
    ]
  }

  return [
    {
      title: 'Shipment scheduled',
      description: `Monitoring begins at departure${device ? ` with ${device.deviceId}` : ''}.`,
      tone: 'info',
      occurredAt: now,
    },
  ]
}

function buildCreatePayload(input, device) {
  const payload = {
    status: input.status ?? 'draft',
    cargo: input.cargo ?? {},
    route: input.route ?? {},
    isDemo: input.isDemo === true,
  }

  if (input.monitoring !== undefined) payload.monitoring = input.monitoring
  if (input.systemAlerts !== undefined) payload.systemAlerts = input.systemAlerts
  if (input.shipmentId !== undefined) payload.shipmentId = input.shipmentId.trim()
  if (device) payload.device = device._id

  return payload
}

function createProbe(payload, device) {
  return new Shipment({
    ...payload,
    shipmentId: payload.shipmentId ?? 'SHP-validation-probe',
    device: device ? device._id : null,
  })
}

async function nextShipmentId() {
  const rows = await Shipment.find({ shipmentId: { $regex: '^SHP-[0-9]+$' } })
    .select('shipmentId')
    .lean()

  let highest = AUTO_ID_BASE
  for (const row of rows) {
    const numeric = Number(String(row.shipmentId).slice(4))
    if (Number.isFinite(numeric) && numeric > highest) {
      highest = numeric
    }
  }

  return `SHP-${highest + 1}`
}

function isShipmentIdDuplicate(error) {
  return (
    error?.code === 11000 &&
    Boolean(error.keyPattern?.shipmentId || error.keyValue?.shipmentId)
  )
}

async function saveNewShipment(payload, shipmentId, device) {
  const shipment = new Shipment({
    ...payload,
    shipmentId,
    timeline: buildInitialTimeline(payload.status, device),
  })

  try {
    await shipment.save()
  } catch (error) {
    if (isOperationalDeviceConflict(error)) {
      throw operationalDeviceConflict(device)
    }
    throw error
  }

  return shipment
}

async function createShipment(input) {
  validateCreateShape(input)

  const device = await resolveDevice(input.deviceId)
  const status = input.status ?? 'draft'

  if (device) {
    await assertDeviceAvailable(device, {
      requireOnline: status === 'scheduled',
    })
  }

  const payload = buildCreatePayload(input, device)
  const probe = createProbe(payload, device)

  validateRouteOrdering(probe.route)
  await probe.validate()
  validateShipmentConfiguration(probe)
  validateMonitoringAvailability(probe, device)

  if (payload.shipmentId) {
    return saveNewShipment(payload, payload.shipmentId, device)
  }

  for (let attempt = 0; attempt < AUTO_ID_ATTEMPTS; attempt += 1) {
    const shipmentId = await nextShipmentId()

    try {
      return await saveNewShipment(payload, shipmentId, device)
    } catch (error) {
      if (!isShipmentIdDuplicate(error)) throw error
      await delay(10 + Math.floor(Math.random() * 40))
    }
  }

  throw new ApiError(
    503,
    'ID_ALLOCATION_EXHAUSTED',
    'Could not allocate a unique shipment ID after several attempts.',
  )
}

function buildStatusFilter(status) {
  if (status === 'all') return null
  if (status === 'active') return { $in: ['scheduled', 'in-transit'] }
  if (status === 'history') return { $in: ['delivered', 'archived'] }
  return status
}

function buildListFilter({ status, healthStatus, category, carrier, q }) {
  const filter = {}

  if (status === 'warning' || status === 'critical') {
    filter.status = 'in-transit'
    filter.healthStatus = status
  } else {
    const statusFilter = buildStatusFilter(status)
    if (statusFilter) filter.status = statusFilter
    if (healthStatus !== 'all') filter.healthStatus = healthStatus
  }

  if (category !== 'all') filter['cargo.category'] = category

  if (carrier) {
    filter['route.carrier'] = {
      $regex: new RegExp(escapeRegex(carrier), 'i'),
    }
  }

  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i')
    filter.$or = [
      { shipmentId: pattern },
      { 'cargo.produce': pattern },
      { 'cargo.batch': pattern },
      { 'route.origin': pattern },
      { 'route.destination': pattern },
      { 'route.carrier': pattern },
      { 'route.vehicle': pattern },
    ]
  }

  return filter
}

async function loadAlertSummaries(shipmentIds) {
  const summaries = new Map()
  if (shipmentIds.length === 0) return summaries

  const rows = await Alert.aggregate([
    { $match: { shipment: { $in: shipmentIds } } },
    {
      $group: {
        _id: { shipment: '$shipment', status: '$status', severity: '$severity' },
        count: { $sum: 1 },
      },
    },
  ])

  for (const row of rows) {
    const key = String(row._id.shipment)
    const summary = summaries.get(key) ?? emptyAlertSummary()
    const count = row.count ?? 0

    if (row._id.status === 'resolved') {
      summary.resolved += count
    } else {
      summary.open += count
      if (row._id.severity === 'critical') summary.critical += count
      if (row._id.severity === 'warning') summary.warning += count
    }

    summaries.set(key, summary)
  }

  return summaries
}

async function loadDevicesForShipments(shipments) {
  const deviceIds = shipments
    .map((shipment) => shipment.device)
    .filter(Boolean)

  if (deviceIds.length === 0) return new Map()

  const devices = await Device.find({ _id: { $in: deviceIds } })
    .select('deviceId name status battery lastSeenAt')
    .lean()

  return new Map(devices.map((device) => [String(device._id), device]))
}

async function listShipments(query = {}) {
  const pagination = parsePagination(query, { defaultLimit: 20, maxLimit: 100 })
  const status = parseEnum(query.status, {
    field: 'status',
    allowed: STATUS_FILTERS,
    defaultValue: 'all',
  })
  const healthStatus = parseEnum(query.healthStatus, {
    field: 'healthStatus',
    allowed: HEALTH_FILTERS,
    defaultValue: 'all',
  })
  const category = parseEnum(query.category, {
    field: 'category',
    allowed: CATEGORY_FILTERS,
    defaultValue: 'all',
  })
  const carrier = parseOptionalString(query.carrier, {
    field: 'carrier',
    maxLength: 120,
  })
  const q = parseOptionalString(query.q, { field: 'q', maxLength: 200 })
  const deviceId = parseOptionalString(query.deviceId, {
    field: 'deviceId',
    maxLength: 80,
  })
  const sort = parseSort(query.sort, {
    field: 'sort',
    allowed: SORT_FIELDS,
    defaultValue: 'createdAt:desc',
  })

  const filter = buildListFilter({ status, healthStatus, category, carrier, q })

  if (deviceId) {
    const device = await Device.findOne({ deviceId }).select('_id').lean()
    if (!device) {
      return {
        items: [],
        meta: buildPaginationMeta({
          page: pagination.page,
          limit: pagination.limit,
          total: 0,
        }),
      }
    }
    filter.device = device._id
  }

  const [total, shipments] = await Promise.all([
    Shipment.countDocuments(filter),
    Shipment.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ])

  const [deviceMap, alertSummaries] = await Promise.all([
    loadDevicesForShipments(shipments),
    loadAlertSummaries(shipments.map((shipment) => shipment._id)),
  ])

  const items = shipments.map((shipment) =>
    presentShipment(shipment, {
      device: deviceMap.get(String(shipment.device)) ?? null,
      alertSummary: alertSummaries.get(String(shipment._id)) ?? emptyAlertSummary(),
    }),
  )

  return {
    items,
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total,
    }),
  }
}

function buildShipmentFilter(identifier) {
  const trimmed = String(identifier ?? '').trim()
  if (trimmed.length === 0) {
    throw ApiError.notFound('Shipment was not found.')
  }

  if (/^[0-9a-fA-F]{24}$/.test(trimmed)) {
    return { $or: [{ shipmentId: trimmed }, { _id: trimmed }] }
  }

  return { shipmentId: trimmed }
}

async function findShipmentDocument(identifier) {
  const shipment = await Shipment.findOne(buildShipmentFilter(identifier))
  if (!shipment) {
    throw ApiError.notFound(`Shipment "${identifier}" was not found.`)
  }
  return shipment
}

async function getShipmentDetail(identifier) {
  const shipment = await findShipmentDocument(identifier)

  const [device, alerts, latestReading, exposure] = await Promise.all([
    shipment.device ? Device.findById(shipment.device) : null,
    Alert.find({ shipment: shipment._id }).sort({ startedAt: -1 }).lean(),
    SensorReading.findOne({ shipment: shipment._id })
      .sort({ recordedAt: -1 })
      .lean(),
    calculateExposure(shipment),
  ])

  return presentShipment(shipment, {
    detail: true,
    device,
    alerts,
    latestReading,
    alertSummary: summarizeAlerts(alerts),
    exposure,
  })
}

module.exports = {
  createShipment,
  listShipments,
  getShipmentDetail,
  findShipmentDocument,
  buildShipmentFilter,
  buildInitialTimeline,
  nextShipmentId,
}
