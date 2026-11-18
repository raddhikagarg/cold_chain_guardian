const ApiError = require('../utils/ApiError')
const { Device, SensorReading, Shipment } = require('../models')
const { OPERATIONAL_SHIPMENT_STATUSES } = require('../constants/enums')
const { SENSOR_IDS } = require('../constants/sensors')
const {
  HOUR_MS,
  MINUTE_MS,
  LATE_READING_WINDOW_HOURS,
  LATE_RECORDING_TOLERANCE_MS,
  READING_STALE_AFTER_MINUTES,
  COMPLETED_SHIPMENT_STATUSES,
} = require('../constants/deviceHealth')
const {
  parseEnum,
  parseOptionalString,
  parseDate,
  parseSort,
} = require('../validation/queryParams')
const {
  validateReadingPayload,
  measurementFieldFor,
} = require('../validation/readingInput')
const { parsePagination, buildPaginationMeta } = require('../utils/pagination')
const { findDeviceDocument } = require('./deviceAvailability')
const {
  findShipmentDocument,
  buildShipmentFilter,
} = require('./shipmentService')
const { evaluateReading } = require('./cargoEvaluation')
const { evaluateSystemAlertsForDevice } = require('./systemAlertService')
const { presentReading } = require('./readingPresenter')

const READING_SORT_FIELDS = ['recordedAt', 'createdAt']
const SENSOR_FILTERS = ['all', ...SENSOR_IDS]
const LATE_WINDOW_MS = LATE_READING_WINDOW_HOURS * HOUR_MS

function lateError(code, message, field = 'shipmentId') {
  return ApiError.unprocessable(code, message, [{ field, message }])
}

function isWithinLateWindow(completedAt, now = new Date()) {
  if (!completedAt) return false
  const completed = new Date(completedAt).getTime()
  if (!Number.isFinite(completed)) return false
  const reference = new Date(now).getTime()
  return completed <= reference && reference - completed <= LATE_WINDOW_MS
}

function isRecordedAtWithinShipmentWindow(recordedAt, shipment) {
  const departure = shipment?.route?.departure
  const completedAt = shipment?.completedAt
  if (!departure || !completedAt) return false

  const recorded = new Date(recordedAt).getTime()
  const start = new Date(departure).getTime()
  const end = new Date(completedAt).getTime() + LATE_RECORDING_TOLERANCE_MS
  if (!Number.isFinite(recorded) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return false
  }

  return recorded >= start && recorded <= end
}

function matchesShipment(shipment, identifier) {
  return (
    identifier === shipment.shipmentId || identifier === String(shipment._id)
  )
}

function assertHistoricalEligibility(shipment, payload, now) {
  if (!COMPLETED_SHIPMENT_STATUSES.includes(shipment.status) || !shipment.completedAt) {
    throw lateError(
      'LATE_READING_INVALID_SHIPMENT',
      'Late readings are only accepted for a completed or archived shipment.',
      'shipmentId',
    )
  }

  if (!isWithinLateWindow(shipment.completedAt, now)) {
    throw lateError(
      'LATE_READING_WINDOW_EXPIRED',
      `Late readings must be received within ${LATE_READING_WINDOW_HOURS} hours of completion.`,
      'shipmentId',
    )
  }

  if (!isRecordedAtWithinShipmentWindow(payload.recordedAt, shipment)) {
    throw lateError(
      'RECORDED_AT_OUTSIDE_SHIPMENT',
      'recordedAt must fall between departure and five minutes after completion.',
      'recordedAt',
    )
  }
}

async function resolveHistoricalShipment(device, payload, now) {
  if (payload.shipmentId) {
    const shipment = await findShipmentDocument(payload.shipmentId)

    if (!shipment.device || String(shipment.device) !== String(device._id)) {
      throw lateError(
        'LATE_READING_INVALID_SHIPMENT',
        'The supplied shipment does not belong to this device.',
        'shipmentId',
      )
    }

    assertHistoricalEligibility(shipment, payload, now)
    return shipment
  }

  const cutoff = new Date(new Date(now).getTime() - LATE_WINDOW_MS)
  const candidates = await Shipment.find({
    device: device._id,
    status: { $in: COMPLETED_SHIPMENT_STATUSES },
    completedAt: { $ne: null, $gte: cutoff },
  })

  const eligible = candidates.filter((shipment) =>
    isRecordedAtWithinShipmentWindow(payload.recordedAt, shipment),
  )

  if (eligible.length === 0) {
    throw lateError(
      'NO_ELIGIBLE_SHIPMENT',
      'No operational or eligible completed shipment accepts this reading.',
      'shipmentId',
    )
  }

  if (eligible.length > 1) {
    throw ApiError.conflict(
      'AMBIGUOUS_SHIPMENT',
      'Multiple completed shipments match this reading. Supply an explicit shipmentId.',
      [
        {
          field: 'shipmentId',
          message: `Candidates: ${eligible.map((shipment) => shipment.shipmentId).join(', ')}.`,
        },
      ],
    )
  }

  return eligible[0]
}

/**
 * Ingest one reading.
 *
 * Live operational readings are evaluated. Historical readings for completed
 * shipments are stored with `late: true` and never touch cargo health, device
 * heartbeat or assignment. Stale and out-of-order live readings are stored but
 * skipped.
 */
async function ingestReading(deviceIdentifier, input) {
  const payload = validateReadingPayload(input)
  const device = await findDeviceDocument(deviceIdentifier)
  const now = new Date()

  let shipment = await Shipment.findOne({
    device: device._id,
    status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
  })

  let late = false
  let lateReason = null

  if (shipment) {
    if (payload.shipmentId && !matchesShipment(shipment, payload.shipmentId)) {
      throw ApiError.conflict(
        'SHIPMENT_MISMATCH',
        'The supplied shipment is not the operational shipment assigned to this device.',
        [{ field: 'shipmentId', message: 'Use a completed shipment for historical readings.' }],
      )
    }
  } else {
    shipment = await resolveHistoricalShipment(device, payload, now)
    late = true
    lateReason = 'completed-shipment'
  }

  let outOfOrder = false
  let stale = false

  if (!late) {
    const latest = await SensorReading.findOne({ shipment: shipment._id })
      .sort({ recordedAt: -1 })
      .select('recordedAt')
      .lean()

    outOfOrder = Boolean(
      latest &&
        new Date(payload.recordedAt).getTime() <
          new Date(latest.recordedAt).getTime(),
    )
    stale =
      now.getTime() - new Date(payload.recordedAt).getTime() >
      READING_STALE_AFTER_MINUTES * MINUTE_MS
  }

  const preDeparture = !late && shipment.status === 'scheduled'
  const evaluationEligible =
    !late && !outOfOrder && !stale && shipment.status === 'in-transit'

  const skipReason = late
    ? 'late-completed-shipment'
    : outOfOrder
      ? 'out-of-order'
      : stale
        ? 'stale'
        : preDeparture
          ? 'pre-departure'
          : null

  const reading = new SensorReading({
    shipment: shipment._id,
    device: device._id,
    recordedAt: payload.recordedAt,
    ...payload.measurements,
    late,
    lateReason,
    outOfOrder,
    stale,
    evaluationSkipped: !evaluationEligible,
    skipReason,
  })

  await reading.save()

  const heartbeatEligible = !late && !outOfOrder && !stale
  let heartbeatDevice = device

  if (heartbeatEligible) {
    heartbeatDevice = await Device.findByIdAndUpdate(
      device._id,
      { $set: { status: 'online', lastSeenAt: now } },
      { new: true, runValidators: true },
    )
    await evaluateSystemAlertsForDevice(heartbeatDevice, now)
  }

  let evaluation = {
    applied: false,
    skipReason,
    cargoHealth: shipment.healthStatus,
    heartbeatUpdated: heartbeatEligible,
    alerts: { created: [], escalated: [], recovered: [] },
  }

  if (evaluationEligible) {
    evaluation = {
      ...(await evaluateReading({ shipment, device, reading, now })),
      heartbeatUpdated: true,
    }
  }

  return {
    reading,
    shipment,
    device,
    evaluation,
    now,
  }
}

function parseReadingQuery(query = {}) {
  const pagination = parsePagination(query, { defaultLimit: 20, maxLimit: 500 })
  const from = parseDate(query.from, { field: 'from' })
  const to = parseDate(query.to, { field: 'to' })
  const sensor = parseEnum(query.sensor, {
    field: 'sensor',
    allowed: SENSOR_FILTERS,
    defaultValue: 'all',
  })
  const sort = parseSort(query.sort, {
    field: 'sort',
    allowed: READING_SORT_FIELDS,
    defaultValue: 'recordedAt:desc',
  })

  if (from && to && from.getTime() > to.getTime()) {
    throw ApiError.badRequest('INVALID_QUERY', 'from must not be after to.', [
      { field: 'from', message: 'from must not be after to.' },
    ])
  }

  const filter = {}
  if (from || to) {
    filter.recordedAt = {}
    if (from) filter.recordedAt.$gte = from
    if (to) filter.recordedAt.$lte = to
  }
  if (sensor !== 'all') {
    filter[measurementFieldFor(sensor)] = { $ne: null }
  }

  return { pagination, sort, filter, sensor }
}

async function loadDeviceMap(readings) {
  const ids = readings.map((reading) => reading.device).filter(Boolean)
  if (ids.length === 0) return new Map()

  const devices = await Device.find({ _id: { $in: ids } })
    .select('deviceId')
    .lean()

  return new Map(devices.map((device) => [String(device._id), device]))
}

async function listShipmentReadings(shipmentIdentifier, query = {}) {
  const { pagination, sort, filter } = parseReadingQuery(query)
  const deviceId = parseOptionalString(query.deviceId, {
    field: 'deviceId',
    maxLength: 80,
  })

  const shipment = await findShipmentDocument(shipmentIdentifier)

  filter.shipment = shipment._id

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

  const [total, readings] = await Promise.all([
    SensorReading.countDocuments(filter),
    SensorReading.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ])

  const deviceMap = await loadDeviceMap(readings)

  return {
    items: readings.map((reading) =>
      presentReading(reading, {
        shipmentId: shipment.shipmentId,
        deviceId: deviceMap.get(String(reading.device))?.deviceId ?? null,
      }),
    ),
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total,
    }),
  }
}

async function listDeviceReadings(deviceIdentifier, query = {}) {
  const { pagination, sort, filter } = parseReadingQuery(query)
  const shipmentId = parseOptionalString(query.shipmentId, {
    field: 'shipmentId',
    maxLength: 80,
  })

  const device = await findDeviceDocument(deviceIdentifier)

  filter.device = device._id

  let shipment = null
  if (shipmentId) {
    shipment = await Shipment.findOne(buildShipmentFilter(shipmentId))
      .select('shipmentId')
      .lean()

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

    filter.shipment = shipment._id
  }

  const [total, readings] = await Promise.all([
    SensorReading.countDocuments(filter),
    SensorReading.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ])

  const shipmentMap = new Map()
  if (shipment) {
    shipmentMap.set(String(shipment._id), shipment)
  } else {
    const ids = readings.map((reading) => reading.shipment).filter(Boolean)
    if (ids.length > 0) {
      const rows = await Shipment.find({ _id: { $in: ids } })
        .select('shipmentId')
        .lean()
      for (const row of rows) shipmentMap.set(String(row._id), row)
    }
  }

  return {
    items: readings.map((reading) =>
      presentReading(reading, {
        shipmentId: shipmentMap.get(String(reading.shipment))?.shipmentId ?? null,
        deviceId: device.deviceId,
      }),
    ),
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total,
    }),
  }
}

async function getReadingDetail(readingId) {
  const identifier = String(readingId ?? '').trim()
  if (!/^[0-9a-fA-F]{24}$/.test(identifier)) {
    throw ApiError.notFound('Reading was not found.')
  }

  const reading = await SensorReading.findById(identifier)
  if (!reading) {
    throw ApiError.notFound(`Reading "${readingId}" was not found.`)
  }

  const [shipment, device] = await Promise.all([
    Shipment.findById(reading.shipment).select('shipmentId').lean(),
    Device.findById(reading.device).select('deviceId').lean(),
  ])

  return presentReading(reading, {
    shipmentId: shipment?.shipmentId ?? null,
    deviceId: device?.deviceId ?? null,
  })
}

module.exports = {
  READING_SORT_FIELDS,
  SENSOR_FILTERS,
  isWithinLateWindow,
  isRecordedAtWithinShipmentWindow,
  ingestReading,
  listShipmentReadings,
  listDeviceReadings,
  getReadingDetail,
  parseReadingQuery,
}
