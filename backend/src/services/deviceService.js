const ApiError = require('../utils/ApiError')
const { Device, DeviceEvent } = require('../models')
const { DEVICE_STATUSES } = require('../constants/enums')
const { SENSOR_IDS } = require('../constants/sensors')
const {
  DEVICE_STALE_AFTER_MINUTES,
  MINUTE_MS,
} = require('../constants/deviceHealth')
const {
  parseEnum,
  parseOptionalString,
  parseSort,
  escapeRegex,
} = require('../validation/queryParams')
const { parsePagination, buildPaginationMeta } = require('../utils/pagination')
const {
  validateRegisterShape,
  validateHeartbeatShape,
  validateSelfTestShape,
} = require('../validation/deviceInput')
const { getDeviceConnectionState } = require('../utils/deviceState')
const {
  findDeviceDocument,
} = require('./deviceAvailability')
const {
  presentDevice,
  findAssignedShipment,
  loadAssignedShipments,
} = require('./devicePresenter')
const {
  evaluateSystemAlertsForDevice,
} = require('./systemAlertService')

const STATUS_FILTERS = ['all', ...DEVICE_STATUSES]
const CONNECTION_FILTERS = ['all', 'online', 'stale', 'offline']
const SENSOR_FILTERS = ['all', ...SENSOR_IDS]
const SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'deviceId',
  'name',
  'lastSeenAt',
  'battery',
  'status',
]

/** Register a device. Device health is derived, never stored here. */
async function registerDevice(input) {
  const payload = validateRegisterShape(input)
  const device = await Device.create(payload)

  return presentDevice(device, { assignedShipment: null })
}

function buildListFilter({ status, connectionState, sensor, q, now }) {
  const filter = {}

  if (status !== 'all') filter.status = status

  if (connectionState === 'online') {
    filter.status = 'online'
    filter.lastSeenAt = {
      $gt: new Date(now - DEVICE_STALE_AFTER_MINUTES * MINUTE_MS),
    }
  } else if (connectionState === 'stale') {
    filter.status = 'online'
    filter.$and = [
      {
        $or: [
          { lastSeenAt: null },
          {
            lastSeenAt: {
              $lte: new Date(now - DEVICE_STALE_AFTER_MINUTES * MINUTE_MS),
            },
          },
        ],
      },
    ]
  } else if (connectionState === 'offline') {
    filter.status = 'offline'
  }

  if (sensor !== 'all') filter.sensors = sensor

  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i')
    filter.$or = [{ deviceId: pattern }, { name: pattern }]
  }

  return filter
}

async function listDevices(query = {}) {
  const pagination = parsePagination(query, { defaultLimit: 20, maxLimit: 100 })
  const status = parseEnum(query.status, {
    field: 'status',
    allowed: STATUS_FILTERS,
    defaultValue: 'all',
  })
  const connectionState = parseEnum(query.connectionState, {
    field: 'connectionState',
    allowed: CONNECTION_FILTERS,
    defaultValue: 'all',
  })
  const sensor = parseEnum(query.sensor, {
    field: 'sensor',
    allowed: SENSOR_FILTERS,
    defaultValue: 'all',
  })
  const q = parseOptionalString(query.q, { field: 'q', maxLength: 200 })
  const sort = parseSort(query.sort, {
    field: 'sort',
    allowed: SORT_FIELDS,
    defaultValue: 'deviceId:asc',
  })

  const now = Date.now()
  const filter = buildListFilter({ status, connectionState, sensor, q, now })

  const [total, devices] = await Promise.all([
    Device.countDocuments(filter),
    Device.find(filter)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ])

  const assignments = await loadAssignedShipments(
    devices.map((device) => device._id),
  )

  return {
    items: devices.map((device) =>
      presentDevice(device, {
        assignedShipment: assignments.get(String(device._id)) ?? null,
      }),
    ),
    meta: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total,
    }),
  }
}

async function getDeviceDetail(identifier) {
  const device = await findDeviceDocument(identifier)
  const assignedShipment = await findAssignedShipment(device._id)

  return presentDevice(device, { assignedShipment })
}

/**
 * Process a heartbeat.
 *
 * The server clock is authoritative for `lastSeenAt`, so an offline device
 * that reconnects immediately stops looking stale. A connection event is
 * recorded when the device was not previously online.
 */
async function recordHeartbeat(identifier, input) {
  const body = validateHeartbeatShape(input)
  const device = await findDeviceDocument(identifier)
  const previousState = getDeviceConnectionState(device)
  const now = new Date()

  const updates = {
    status: 'online',
    lastSeenAt: now,
  }

  if (body.battery !== undefined) updates.battery = body.battery
  if (body.signal !== undefined) updates.signal = body.signal
  if (body.signalDbm !== undefined) updates.signalDbm = body.signalDbm
  if (body.firmware !== undefined) updates.firmware = body.firmware
  if (body.connectivity !== undefined) updates.connectivity = body.connectivity
  if (body.booted === true) updates.lastBootAt = now

  const updated = await Device.findByIdAndUpdate(device._id, { $set: updates }, {
    new: true,
    runValidators: true,
  })

  if (previousState !== 'online') {
    await DeviceEvent.create({
      device: device._id,
      type: 'connectivity',
      severity: previousState === 'stale' ? 'warning' : 'info',
      title: previousState === 'stale' ? 'Heartbeat resumed' : 'Device online',
      description:
        previousState === 'stale'
          ? 'A fresh heartbeat arrived after the device had gone stale.'
          : 'A heartbeat was received and the device is online.',
      occurredAt: now,
    })
  }

  await evaluateSystemAlertsForDevice(updated, now)

  const assignedShipment = await findAssignedShipment(device._id)
  return presentDevice(updated, { assignedShipment })
}

/**
 * Record self-test evidence for fitted sensors. Evidence expires after 24
 * hours when device health is derived; nothing is deleted from the device.
 */
async function recordSelfTest(identifier, input) {
  const body = validateSelfTestShape(input)
  const device = await findDeviceDocument(identifier)

  const missing = body.results
    .filter((result) => !(device.sensors ?? []).includes(result.sensorId))
    .map((result) => result.sensorId)

  if (missing.length > 0) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'Self-test results can only be recorded for sensors fitted on the device.',
      missing.map((sensorId) => ({
        field: 'results',
        message: `${sensorId} is not fitted on this device.`,
      })),
    )
  }

  const bySensor = new Map()
  for (const entry of device.sensorHealth ?? []) {
    bySensor.set(entry.sensorId, {
      sensorId: entry.sensorId,
      status: entry.status,
      lastSelfTestAt: entry.lastSelfTestAt ?? null,
      note: entry.note ?? '',
    })
  }

  for (const result of body.results) {
    bySensor.set(result.sensorId, {
      sensorId: result.sensorId,
      status: result.status,
      lastSelfTestAt: body.occurredAt,
      note: result.note,
    })
  }

  device.sensorHealth = Array.from(bySensor.values())
  await device.save()

  const worst = body.results.some((result) => result.status === 'fault')
    ? 'critical'
    : body.results.some((result) => result.status === 'degraded')
      ? 'warning'
      : 'info'

  await DeviceEvent.create({
    device: device._id,
    type: 'selfTest',
    severity: worst,
    title: 'Sensor self-test completed',
    description: body.results
      .map((result) => `${result.sensorId}: ${result.status}`)
      .join(', '),
    occurredAt: body.occurredAt,
  })

  await evaluateSystemAlertsForDevice(device, new Date())

  const assignedShipment = await findAssignedShipment(device._id)
  return presentDevice(device, { assignedShipment })
}

module.exports = {
  STATUS_FILTERS,
  CONNECTION_FILTERS,
  SENSOR_FILTERS,
  SORT_FIELDS,
  registerDevice,
  listDevices,
  getDeviceDetail,
  recordHeartbeat,
  recordSelfTest,
  findDeviceDocument,
}
