const ApiError = require('../utils/ApiError')
const { DeviceEvent, Shipment } = require('../models')
const { DEVICE_EVENT_TYPES, ALERT_SEVERITIES } = require('../constants/enums')
const { SENSOR_IDS } = require('../constants/sensors')
const {
  parseEnum,
  parseOptionalString,
  parseDate,
  parseSort,
} = require('../validation/queryParams')
const { parsePagination, buildPaginationMeta } = require('../utils/pagination')
const { validateEventShape } = require('../validation/deviceInput')
const { findDeviceDocument } = require('./deviceAvailability')
const { findShipmentDocument } = require('./shipmentService')
const { toIso } = require('../utils/deviceHealth')

const EVENT_TYPE_FILTERS = ['all', ...DEVICE_EVENT_TYPES]
const SEVERITY_FILTERS = ['all', ...ALERT_SEVERITIES]
const EVENT_SORT_FIELDS = ['occurredAt', 'createdAt', 'severity', 'type']

function toPlain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value
}

function presentEvent(event, options = {}) {
  const plain = toPlain(event) ?? {}
  const device = options.device ? toPlain(options.device) : null
  const shipment = options.shipment ? toPlain(options.shipment) : null

  return {
    id: plain._id ? String(plain._id) : null,
    objectId: plain._id ? String(plain._id) : null,
    deviceId: device?.deviceId ?? null,
    deviceObjectId: plain.device ? String(plain.device) : null,
    shipmentId: shipment?.shipmentId ?? null,
    shipmentObjectId: plain.shipment ? String(plain.shipment) : null,
    type: plain.type ?? null,
    sensor: plain.sensor ?? null,
    severity: plain.severity ?? 'info',
    title: plain.title ?? '',
    description: plain.description ?? '',
    occurredAt: toIso(plain.occurredAt),
    createdAt: toIso(plain.createdAt),
  }
}

/** Validate an event body, then resolve the device and persist the event. */
async function createDeviceEvent(identifier, input) {
  const event = validateEventShape(input)
  const device = await findDeviceDocument(identifier)

  let shipment = null
  if (event.shipmentId) {
    shipment = await findShipmentDocument(event.shipmentId)
  }

  const document = await DeviceEvent.create({
    device: device._id,
    shipment: shipment ? shipment._id : null,
    type: event.type,
    sensor: event.sensor,
    severity: event.severity,
    title: event.title,
    description: event.description,
    occurredAt: event.occurredAt,
  })

  return presentEvent(document, { device, shipment })
}

function buildEventFilter({ type, severity, sensor, shipment, from, to }) {
  const filter = {}

  if (type !== 'all') filter.type = type
  if (severity !== 'all') filter.severity = severity
  if (sensor !== 'all') filter.sensor = sensor
  if (shipment) filter.shipment = shipment._id

  if (from || to) {
    filter.occurredAt = {}
    if (from) filter.occurredAt.$gte = from
    if (to) filter.occurredAt.$lte = to
  }

  return filter
}

async function loadShipmentMap(events) {
  const ids = events.map((event) => event.shipment).filter(Boolean)
  if (ids.length === 0) return new Map()

  const shipments = await Shipment.find({ _id: { $in: ids } })
    .select('shipmentId')
    .lean()

  return new Map(shipments.map((shipment) => [String(shipment._id), shipment]))
}

async function listDeviceEvents(identifier, query = {}) {
  const pagination = parsePagination(query, { defaultLimit: 20, maxLimit: 100 })
  const type = parseEnum(query.type, {
    field: 'type',
    allowed: EVENT_TYPE_FILTERS,
    defaultValue: 'all',
  })
  const severity = parseEnum(query.severity, {
    field: 'severity',
    allowed: SEVERITY_FILTERS,
    defaultValue: 'all',
  })
  const sensor = parseOptionalString(query.sensor, {
    field: 'sensor',
    maxLength: 40,
  })
  const shipmentId = parseOptionalString(query.shipmentId, {
    field: 'shipmentId',
    maxLength: 80,
  })
  const from = parseDate(query.from, { field: 'from' })
  const to = parseDate(query.to, { field: 'to' })
  const sort = parseSort(query.sort, {
    field: 'sort',
    allowed: EVENT_SORT_FIELDS,
    defaultValue: 'occurredAt:desc',
  })

  if (from && to && from.getTime() > to.getTime()) {
    throw ApiError.badRequest('INVALID_QUERY', 'from must not be after to.', [
      { field: 'from', message: 'from must not be after to.' },
    ])
  }

  if (sensor && !SENSOR_IDS.includes(sensor)) {
    throw ApiError.badRequest(
      'INVALID_QUERY',
      `sensor must be one of: ${SENSOR_IDS.join(', ')}.`,
      [{ field: 'sensor', message: `sensor must be one of: ${SENSOR_IDS.join(', ')}.` }],
    )
  }

  const device = await findDeviceDocument(identifier)

  let shipment = null
  if (shipmentId) {
    shipment = await Shipment.findOne({ shipmentId }).select('_id').lean()
    if (!shipment) {
      return {
        items: [],
        meta: buildPaginationMeta({
          page: pagination.page,
          limit: pagination.limit,
          total: 0,
        }),
      }
    }
  }

  const filter = buildEventFilter({
    type,
    severity,
    sensor: sensor ?? 'all',
    shipment,
    from,
    to,
  })
  filter.device = device._id

  const [total, events] = await Promise.all([
    DeviceEvent.countDocuments(filter),
    DeviceEvent.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ])

  const shipmentMap = await loadShipmentMap(events)

  return {
    items: events.map((event) =>
      presentEvent(event, {
        device,
        shipment: shipmentMap.get(String(event.shipment)) ?? null,
      }),
    ),
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total,
    }),
  }
}

module.exports = {
  EVENT_TYPE_FILTERS,
  SEVERITY_FILTERS,
  createDeviceEvent,
  listDeviceEvents,
  presentEvent,
}
