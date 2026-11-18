const ApiError = require('../utils/ApiError')
const { Device, Shipment } = require('../models')
const { OPERATIONAL_SHIPMENT_STATUSES } = require('../constants/enums')
const { getDeviceConnectionState } = require('../utils/deviceState')

/** Resolve a business device ID (or ObjectId) to its document. */
async function findDeviceDocument(identifier) {
  const trimmed = String(identifier ?? '').trim()
  if (trimmed.length === 0) {
    throw ApiError.notFound('Device was not found.')
  }

  const filter = /^[0-9a-fA-F]{24}$/.test(trimmed)
    ? { $or: [{ deviceId: trimmed }, { _id: trimmed }] }
    : { deviceId: trimmed }

  const device = await Device.findOne(filter)
  if (!device) {
    throw ApiError.notFound(`Device "${identifier}" was not found.`)
  }
  return device
}

/** Resolve a business device ID to its document, or return null for no device. */
async function resolveDevice(deviceId) {
  if (deviceId === undefined || deviceId === null) return null

  if (typeof deviceId !== 'string') {
    throw ApiError.badRequest('VALIDATION_ERROR', 'deviceId must be text.', [
      { field: 'deviceId', message: 'deviceId must be text.' },
    ])
  }

  const trimmed = deviceId.trim()
  if (trimmed.length === 0) return null

  const device = await Device.findOne({ deviceId: trimmed })
  if (!device) {
    throw ApiError.notFound(`Device "${trimmed}" was not found.`, [
      { field: 'deviceId', message: 'Device was not found.' },
    ])
  }

  return device
}

/**
 * A device may back at most one operational shipment. This friendly pre-check
 * is backed by the `operational_device_unique` partial index, which remains
 * authoritative under concurrent requests.
 */
async function assertDeviceAvailable(device, options = {}) {
  const filter = {
    device: device._id,
    status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
  }

  if (options.excludeShipmentId) {
    filter._id = { $ne: options.excludeShipmentId }
  }

  const conflict = await Shipment.findOne(filter)
    .select('shipmentId status')
    .lean()

  if (conflict) {
    throw ApiError.conflict(
      'DEVICE_BUSY',
      `Device ${device.deviceId} is already assigned to ${conflict.shipmentId}.`,
      [
        {
          field: 'deviceId',
          message: `Operational shipment ${conflict.shipmentId} currently reserves this device.`,
        },
      ],
    )
  }

  const connectionState = getDeviceConnectionState(device)

  if (options.requireOnline && connectionState !== 'online') {
    throw ApiError.conflict(
      'DEVICE_NOT_AVAILABLE',
      `Device ${device.deviceId} is ${connectionState} and cannot be scheduled.`,
      [
        {
          field: 'deviceId',
          message: 'Scheduling requires an online device with a fresh heartbeat.',
        },
      ],
    )
  }

  return connectionState
}

/**
 * True when MongoDB rejected a write because another operational shipment
 * already reserves the device (the `operational_device_unique` partial index).
 */
function isOperationalDeviceConflict(error) {
  if (!error || error.code !== 11000) return false
  return Boolean(
    error.keyPattern?.device ||
      error.keyValue?.device ||
      /operational_device_unique/.test(String(error.message ?? '')),
  )
}

/** Convert a raw duplicate-key error into the approved 409 conflict shape. */
function operationalDeviceConflict(device) {
  const label = device?.deviceId ? `Device ${device.deviceId}` : 'That device'
  return ApiError.conflict(
    'DEVICE_BUSY',
    `${label} is already assigned to an operational shipment.`,
    [
      {
        field: 'deviceId',
        message: 'A device can back at most one scheduled or in-transit shipment.',
      },
    ],
  )
}

module.exports = {
  findDeviceDocument,
  resolveDevice,
  assertDeviceAvailable,
  isOperationalDeviceConflict,
  operationalDeviceConflict,
}
