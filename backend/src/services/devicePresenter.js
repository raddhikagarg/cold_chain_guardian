const { Shipment } = require('../models')
const { OPERATIONAL_SHIPMENT_STATUSES } = require('../constants/enums')
const { deriveDeviceHealth, toIso } = require('../utils/deviceHealth')

/**
 * Device presenters.
 *
 * `assignedShipment` mirrors the Device model virtual: only scheduled and
 * in-transit shipments count. Completed and archived history never looks like
 * a live assignment.
 */

function toPlain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value
}

function presentAssignedShipment(shipment) {
  if (!shipment) return null
  const plain = toPlain(shipment) ?? {}

  return {
    id: plain.shipmentId,
    objectId: plain._id ? String(plain._id) : null,
    shipmentId: plain.shipmentId,
    lifecycleStatus: plain.status,
    status: plain.status,
  }
}

function presentSensorHealth(device) {
  const plain = toPlain(device) ?? {}
  return (plain.sensorHealth ?? []).map((entry) => {
    const item = toPlain(entry) ?? {}
    return {
      sensorId: item.sensorId ?? null,
      status: item.status ?? null,
      lastSelfTestAt: toIso(item.lastSelfTestAt),
      note: item.note ?? '',
    }
  })
}

function presentHardware(device) {
  const plain = toPlain(device) ?? {}
  const hardware = toPlain(plain.hardware) ?? {}

  return {
    board: hardware.board ?? '',
    chip: hardware.chip ?? '',
    revision: hardware.revision ?? '',
    serial: hardware.serial ?? null,
    mac: hardware.mac ?? '',
    installedAt: toIso(hardware.installedAt),
    flash: hardware.flash ?? '',
    powerSource: hardware.powerSource ?? '',
  }
}

function presentDevice(device, options = {}) {
  if (!device) return null
  const plain = toPlain(device) ?? {}
  const health = deriveDeviceHealth(plain)
  const assignedShipment =
    options.assignedShipment === undefined ? null : presentAssignedShipment(options.assignedShipment)

  return {
    id: plain.deviceId,
    objectId: plain._id ? String(plain._id) : null,
    deviceId: plain.deviceId,
    name: plain.name ?? '',
    status: plain.status ?? 'offline',
    connectionState: health.connection.state,
    health,
    connectivity: plain.connectivity ?? '',
    signal: plain.signal ?? '',
    signalDbm: plain.signalDbm ?? null,
    battery: plain.battery ?? null,
    firmware: plain.firmware ?? '',
    sensors: [...(plain.sensors ?? [])],
    sensorHealth: presentSensorHealth(plain),
    lastSeenAt: toIso(plain.lastSeenAt),
    lastBootAt: toIso(plain.lastBootAt),
    hardware: presentHardware(plain),
    assignedShipment,
    createdAt: toIso(plain.createdAt),
    updatedAt: toIso(plain.updatedAt),
  }
}

async function findAssignedShipment(deviceObjectId) {
  if (!deviceObjectId) return null
  return Shipment.findOne({
    device: deviceObjectId,
    status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
  })
    .select('shipmentId status')
    .lean()
}

/** Bulk-load live assignments for a device list to avoid N+1 queries. */
async function loadAssignedShipments(deviceIds = []) {
  const map = new Map()
  if (deviceIds.length === 0) return map

  const rows = await Shipment.find({
    device: { $in: deviceIds },
    status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
  })
    .select('shipmentId status device')
    .lean()

  for (const row of rows) {
    map.set(String(row.device), row)
  }

  return map
}

module.exports = {
  presentDevice,
  presentAssignedShipment,
  findAssignedShipment,
  loadAssignedShipments,
  presentHardware,
  presentSensorHealth,
}
