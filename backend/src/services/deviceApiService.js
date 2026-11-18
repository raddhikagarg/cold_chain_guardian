const { SENSOR_IDS, SENSOR_CATALOG } = require('../constants/sensors')
const { findDeviceDocument } = require('./deviceAvailability')
const { getDeviceConnectionState } = require('../utils/deviceState')
const { presentDevice, findAssignedShipment } = require('./devicePresenter')

async function getDeviceStatus(identifier) {
  const device = await findDeviceDocument(identifier)
  const assignedShipment = await findAssignedShipment(device._id)
  const presented = presentDevice(device, { assignedShipment })
  return {
    deviceId: presented.deviceId,
    status: presented.status,
    connectionState: presented.connectionState,
    health: presented.health,
    lastSeenAt: presented.lastSeenAt,
    battery: presented.battery,
    signal: presented.signal,
    signalDbm: presented.signalDbm,
    firmware: presented.firmware,
    evaluatedAt: presented.health?.evaluatedAt ?? null,
  }
}

async function getSensorAvailability(identifier) {
  const device = await findDeviceDocument(identifier)
  const fitted = new Set(device.sensors ?? [])
  const health = new Map((device.sensorHealth ?? []).map((entry) => [entry.sensorId, entry]))
  return {
    deviceId: device.deviceId,
    sensors: SENSOR_IDS.map((sensorId) => {
      const catalog = SENSOR_CATALOG[sensorId]
      const evidence = health.get(sensorId)
      return {
        ...catalog,
          available: fitted.has(sensorId),
          health: fitted.has(sensorId) ? (evidence?.status ?? 'unknown') : 'not-fitted',
          lastSelfTestAt: evidence?.lastSelfTestAt ?? null,
        }
    }),
    fittedCount: fitted.size,
    totalSensors: SENSOR_IDS.length,
  }
}

async function getDeviceAvailability(identifier) {
  const device = await findDeviceDocument(identifier)
  const assignedShipment = await findAssignedShipment(device._id)
  const connectionState = getDeviceConnectionState(device)
  const isAssigned = Boolean(assignedShipment)
  return {
    deviceId: device.deviceId,
    connectionState,
    assigned: isAssigned,
    assignedShipment: assignedShipment
      ? { shipmentId: assignedShipment.shipmentId, status: assignedShipment.status }
      : null,
    available: !isAssigned,
    canAssign: !isAssigned,
    canSchedule: !isAssigned && connectionState === 'online',
    reason: isAssigned
      ? 'Device is reserved by an operational shipment.'
      : connectionState !== 'online'
        ? 'Device must have a fresh heartbeat to schedule a shipment.'
        : null,
  }
}

module.exports = { getDeviceStatus, getSensorAvailability, getDeviceAvailability }
