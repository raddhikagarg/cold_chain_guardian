const ApiError = require('../utils/ApiError')
const { Device, DeviceEvent, Shipment } = require('../models')
const { OPERATIONAL_SHIPMENT_STATUSES } = require('../constants/enums')
const {
  badField,
  requirePlainBody,
  rejectUnknownKeys,
} = require('../validation/lifecycleInput')
const {
  validateMonitoringAvailability,
} = require('../validation/shipmentInput')
const { findShipmentDocument } = require('./shipmentService')
const {
  resolveDevice,
  assertDeviceAvailable,
  isOperationalDeviceConflict,
  operationalDeviceConflict,
} = require('./deviceAvailability')
const { presentDevice } = require('./devicePresenter')

const DEVICE_CHANGE_STATUSES = ['draft', 'scheduled']

function assertDeviceMutable(shipment) {
  if (DEVICE_CHANGE_STATUSES.includes(shipment.status)) return

  throw ApiError.conflict(
    'INVALID_STATE_TRANSITION',
    `Cannot change the device of a shipment with status "${shipment.status}".`,
    [
      {
        field: 'status',
        message: 'Device assignment is locked once a shipment is in transit.',
      },
    ],
  )
}

function requireDeviceId(input) {
  const body = requirePlainBody(input)
  rejectUnknownKeys(body, ['deviceId'])

  if (typeof body.deviceId !== 'string' || body.deviceId.trim().length === 0) {
    badField('deviceId', 'deviceId is required and must be text.')
  }

  return body.deviceId.trim()
}

function timelineEntry(title, description) {
  return {
    title,
    description,
    tone: 'info',
    occurredAt: new Date(),
  }
}

async function recordAssignmentEvents({ device, shipment, previousDevice }) {
  const events = []

  if (previousDevice && String(previousDevice._id) !== String(device._id)) {
    events.push({
      device: previousDevice._id,
      shipment: shipment._id,
      type: 'release',
      severity: 'info',
      title: 'Device released',
      description: `${previousDevice.deviceId} was released from ${shipment.shipmentId}.`,
      occurredAt: new Date(),
    })
  }

  events.push({
    device: device._id,
    shipment: shipment._id,
    type: 'assignment',
    severity: 'info',
    title: 'Device assigned',
    description: `${device.deviceId} was assigned to ${shipment.shipmentId}.`,
    occurredAt: new Date(),
  })

  await DeviceEvent.insertMany(events)
}

/**
 * Assign or replace a device on a draft or scheduled shipment.
 *
 * The friendly pre-check gives a stable 409 DEVICE_BUSY in normal use. Under a
 * race, the `operational_device_unique` partial index rejects the loser and
 * `isOperationalDeviceConflict` maps that write error to the same response.
 */
async function assignShipmentDevice(identifier, input) {
  const deviceId = requireDeviceId(input)
  const shipment = await findShipmentDocument(identifier)
  assertDeviceMutable(shipment)

  const device = await resolveDevice(deviceId)
  const previousDevice = shipment.device
    ? await Device.findById(shipment.device)
    : null

  if (previousDevice && String(previousDevice._id) === String(device._id)) {
    return {
      shipment,
      device,
      previousDevice,
      changed: false,
    }
  }

  await assertDeviceAvailable(device, {
    excludeShipmentId: shipment._id,
    requireOnline: shipment.status === 'scheduled',
  })

  validateMonitoringAvailability(shipment, device)

  try {
    const updated = await Shipment.findOneAndUpdate(
      { _id: shipment._id, status: { $in: DEVICE_CHANGE_STATUSES } },
      {
        $set: { device: device._id },
        $push: {
          timeline: timelineEntry(
            'Device assigned',
            `${device.deviceId} is now assigned to this shipment.`,
          ),
        },
      },
      { new: true, runValidators: true },
    )

    if (!updated) {
      throw ApiError.conflict(
        'INVALID_STATE_TRANSITION',
        'The shipment status changed while the device was being assigned.',
        [{ field: 'status', message: 'Only draft and scheduled shipments are editable.' }],
      )
    }

    await recordAssignmentEvents({
      device,
      shipment: updated,
      previousDevice,
    })

    return {
      shipment: updated,
      device,
      previousDevice,
      changed: true,
    }
  } catch (error) {
    if (isOperationalDeviceConflict(error)) {
      throw operationalDeviceConflict(device)
    }
    throw error
  }
}

/**
 * Release the device from a draft or scheduled shipment.
 *
 * Releasing a scheduled shipment returns it to draft. That keeps the domain
 * invariant "a scheduled shipment always has an online device" true; it does
 * not change any agreed in-transit/delivered/archived transition.
 */
async function releaseShipmentDevice(identifier) {
  const shipment = await findShipmentDocument(identifier)
  assertDeviceMutable(shipment)

  if (!shipment.device) {
    return { shipment, previousDevice: null, changed: false, returnedToDraft: false }
  }

  const previousDevice = await Device.findById(shipment.device)
  const returnedToDraft = shipment.status === 'scheduled'
  const updates = { device: null }
  if (returnedToDraft) updates.status = 'draft'

  const description = returnedToDraft
    ? `${previousDevice?.deviceId ?? 'The device'} was released and the shipment returned to draft.`
    : `${previousDevice?.deviceId ?? 'The device'} is no longer assigned to this draft.`

  const updated = await Shipment.findOneAndUpdate(
    { _id: shipment._id, status: { $in: DEVICE_CHANGE_STATUSES } },
    {
      $set: updates,
      $push: {
        timeline: {
          title: 'Device released',
          description,
          tone: 'muted',
          occurredAt: new Date(),
        },
      },
    },
    { new: true, runValidators: true },
  )

  if (!updated) {
    throw ApiError.conflict(
      'INVALID_STATE_TRANSITION',
      'The shipment status changed while the device was being released.',
      [{ field: 'status', message: 'Only draft and scheduled shipments are editable.' }],
    )
  }

  if (previousDevice) {
    await DeviceEvent.create({
      device: previousDevice._id,
      shipment: updated._id,
      type: 'release',
      severity: 'info',
      title: 'Device released',
      description,
      occurredAt: new Date(),
    })
  }

  return {
    shipment: updated,
    previousDevice,
    changed: true,
    returnedToDraft,
  }
}

async function getShipmentDevice(identifier) {
  const shipment = await findShipmentDocument(identifier)
  const isOperational = OPERATIONAL_SHIPMENT_STATUSES.includes(shipment.status)

  let device = null
  if (shipment.device) {
    const document = await Device.findById(shipment.device)
    device = presentDevice(document, {
      assignedShipment: isOperational ? shipment : null,
    })
  }

  return {
    shipmentId: shipment.shipmentId,
    objectId: String(shipment._id),
    lifecycleStatus: shipment.status,
    status: shipment.status,
    assigned: Boolean(device) && isOperational,
    deviceId: device?.deviceId ?? null,
    device,
  }
}

module.exports = {
  DEVICE_CHANGE_STATUSES,
  assignShipmentDevice,
  releaseShipmentDevice,
  getShipmentDevice,
}
