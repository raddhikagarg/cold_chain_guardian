const ApiError = require('../utils/ApiError')
const { Device } = require('../models')
const { SENSOR_IDS } = require('../constants/sensors')
const {
  COMPLETION_SOURCES,
} = require('../constants/enums')
const {
  isPlainObject,
  badField,
  requirePlainBody,
  rejectUnknownKeys,
  parseBodyDate,
  assertNotFuture,
  assertStatus,
} = require('../validation/lifecycleInput')
const {
  validatePatchShape,
  validateRouteOrdering,
  validateShipmentConfiguration,
  validateMonitoringAvailability,
  assertInTransitRoutePatch,
} = require('../validation/shipmentInput')
const {
  findShipmentDocument,
} = require('./shipmentService')
const {
  resolveDevice,
  assertDeviceAvailable,
  isOperationalDeviceConflict,
  operationalDeviceConflict,
} = require('./deviceAvailability')

const SYSTEM_ALERT_KEYS = ['offline', 'battery', 'sensorFault', 'selfTest']
const DEPARTURE_TOLERANCE_MS = 5 * 60 * 1000

function appendTimeline(shipment, { title, description, tone, occurredAt }) {
  shipment.timeline.push({
    title,
    description,
    tone,
    occurredAt: occurredAt ?? new Date(),
  })
}

/**
 * Save a shipment while mapping a concurrent device reservation to the same
 * 409 DEVICE_BUSY response as the service-level pre-check.
 */
async function saveShipment(shipment, device) {
  try {
    await shipment.save()
  } catch (error) {
    if (isOperationalDeviceConflict(error)) {
      throw operationalDeviceConflict(device)
    }
    throw error
  }
}

function plain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value ?? {}
}

async function currentDevice(shipment) {
  if (!shipment.device) return null
  return Device.findById(shipment.device)
}

function mergeCargo(shipment, patch) {
  shipment.cargo = { ...plain(shipment.cargo), ...patch }
}

function mergeRoute(shipment, patch) {
  shipment.route = { ...plain(shipment.route), ...patch }
}

function mergeMonitoring(shipment, patch) {
  const current = plain(shipment.monitoring)
  const merged = { ...current }

  for (const sensorId of Object.keys(patch)) {
    merged[sensorId] = {
      ...(current[sensorId] ?? {}),
      ...patch[sensorId],
    }
  }

  shipment.monitoring = merged
}

function mergeSystemAlerts(shipment, patch) {
  const current = plain(shipment.systemAlerts)
  const merged = { ...current }

  for (const key of Object.keys(patch)) {
    merged[key] = {
      ...(current[key] ?? {}),
      ...patch[key],
    }
  }

  shipment.systemAlerts = merged
}

function assertPatchEditable(shipment, patch) {
  if (shipment.status === 'delivered' || shipment.status === 'archived') {
    throw ApiError.conflict(
      'INVALID_STATE_TRANSITION',
      `Cannot update a ${shipment.status} shipment.`,
      [{ field: 'status', message: 'Completed and archived records are read-only.' }],
    )
  }

  if (shipment.status === 'in-transit') {
    const topLevelKeys = Object.keys(patch)
    const onlyRoute = topLevelKeys.every((key) => key === 'route')
    if (!onlyRoute) {
      throw ApiError.conflict(
        'INVALID_STATE_TRANSITION',
        'Only route progress and non-safety metadata may be updated in transit.',
        [
          {
            field: 'body',
            message: 'Monitoring, cargo, system alerts and device are locked in transit.',
          },
        ],
      )
    }

    assertInTransitRoutePatch(patch.route ?? {})
  }
}

async function applyDeviceChange(shipment, deviceId) {
  if (deviceId === undefined) return currentDevice(shipment)

  const existing = await currentDevice(shipment)

  if (deviceId === null || String(deviceId).trim() === '') {
    if (shipment.device) {
      shipment.device = null
      appendTimeline(shipment, {
        title: 'Device released',
        description: 'The device was removed from this shipment.',
        tone: 'muted',
      })
    }
    return null
  }

  const nextDevice = await resolveDevice(deviceId)

  if (existing && String(existing._id) === String(nextDevice._id)) {
    return existing
  }

  await assertDeviceAvailable(nextDevice, {
    excludeShipmentId: shipment._id,
    requireOnline: shipment.status === 'scheduled',
  })

  shipment.device = nextDevice._id
  appendTimeline(shipment, {
    title: 'Device assigned',
    description: `${nextDevice.deviceId} is now assigned to this shipment.`,
    tone: 'info',
  })

  return nextDevice
}

async function updateShipment(identifier, input) {
  const body = requirePlainBody(input)
  validatePatchShape(body)

  const shipment = await findShipmentDocument(identifier)
  assertPatchEditable(shipment, body)

  if (body.cargo !== undefined) mergeCargo(shipment, body.cargo)
  if (body.route !== undefined) mergeRoute(shipment, body.route)
  if (body.monitoring !== undefined) mergeMonitoring(shipment, body.monitoring)
  if (body.systemAlerts !== undefined) mergeSystemAlerts(shipment, body.systemAlerts)

  const device = await applyDeviceChange(shipment, body.deviceId)

  if (body.monitoring !== undefined || body.systemAlerts !== undefined) {
    appendTimeline(shipment, {
      title: 'Monitoring configuration updated',
      description: 'Thresholds and alert settings were updated.',
      tone: 'info',
    })
  }

  validateRouteOrdering(shipment.route)
  validateShipmentConfiguration(shipment)
  validateMonitoringAvailability(shipment, device)

  await saveShipment(shipment, device)
  return shipment
}

async function replaceMonitoring(identifier, input) {
  const body = requirePlainBody(input)
  rejectUnknownKeys(body, ['monitoring', 'systemAlerts'])

  if (!isPlainObject(body.monitoring)) {
    badField('monitoring', 'monitoring is required and must be an object.')
  }
  if (!isPlainObject(body.systemAlerts)) {
    badField('systemAlerts', 'systemAlerts is required and must be an object.')
  }

  const missingSensors = SENSOR_IDS.filter(
    (sensorId) => body.monitoring[sensorId] === undefined,
  )
  if (missingSensors.length > 0) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'A full monitoring replacement must include every sensor.',
      missingSensors.map((sensorId) => ({
        field: `monitoring.${sensorId}`,
        message: `${sensorId} is required.`,
      })),
    )
  }

  const missingSystemAlerts = SYSTEM_ALERT_KEYS.filter(
    (key) => body.systemAlerts[key] === undefined,
  )
  if (missingSystemAlerts.length > 0) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'A full monitoring replacement must include every system alert.',
      missingSystemAlerts.map((key) => ({
        field: `systemAlerts.${key}`,
        message: `${key} is required.`,
      })),
    )
  }

  validatePatchShape({
    monitoring: body.monitoring,
    systemAlerts: body.systemAlerts,
  })

  const shipment = await findShipmentDocument(identifier)
  if (shipment.status !== 'draft' && shipment.status !== 'scheduled') {
    throw ApiError.conflict(
      'INVALID_STATE_TRANSITION',
      'Monitoring configuration can only be replaced before departure.',
      [{ field: 'status', message: 'Draft and scheduled shipments are editable.' }],
    )
  }

  shipment.monitoring = body.monitoring
  shipment.systemAlerts = body.systemAlerts

  const device = await currentDevice(shipment)

  validateShipmentConfiguration(shipment)
  validateMonitoringAvailability(shipment, device)

  appendTimeline(shipment, {
    title: 'Monitoring configuration replaced',
    description: 'The full monitoring and system-alert configuration was replaced.',
    tone: 'info',
  })

  await shipment.save()
  return shipment
}

async function scheduleShipment(identifier, input = {}) {
  const body = requirePlainBody(input ?? {})
  rejectUnknownKeys(body, ['deviceId', 'departure', 'arrival', 'deadline'])

  const shipment = await findShipmentDocument(identifier)
  assertStatus(shipment, 'draft', 'schedule')

  let device = await currentDevice(shipment)

  if (body.deviceId !== undefined) {
    device = await applyDeviceChange(shipment, body.deviceId)
  }

  if (body.departure !== undefined) {
    shipment.route.departure = parseBodyDate(body.departure, 'departure')
  }
  if (body.arrival !== undefined) {
    shipment.route.arrival = parseBodyDate(body.arrival, 'arrival')
  }
  if (body.deadline !== undefined) {
    shipment.route.deadline = parseBodyDate(body.deadline, 'deadline')
  }

  if (!device) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'A device is required before a shipment can be scheduled.',
      [{ field: 'deviceId', message: 'Assign an available device first.' }],
    )
  }

  await assertDeviceAvailable(device, {
    excludeShipmentId: shipment._id,
    requireOnline: true,
  })

  shipment.status = 'scheduled'

  validateRouteOrdering(shipment.route)
  validateShipmentConfiguration(shipment)
  validateMonitoringAvailability(shipment, device)

  appendTimeline(shipment, {
    title: 'Shipment scheduled',
    description: `Monitoring begins at departure with ${device.deviceId}.`,
    tone: 'info',
  })

  await saveShipment(shipment, device)
  return shipment
}

async function departShipment(identifier, input = {}) {
  const body = requirePlainBody(input ?? {})
  rejectUnknownKeys(body, ['at'])

  const shipment = await findShipmentDocument(identifier)
  assertStatus(shipment, 'scheduled', 'depart')

  const at = parseBodyDate(body.at, 'at', new Date())
  assertNotFuture(at, 'at')

  const departure = shipment.route?.departure
  if (!departure) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'The shipment has no planned departure time.',
      [{ field: 'route.departure', message: 'Set a departure time before departing.' }],
    )
  }

  if (at.getTime() < new Date(departure).getTime() - DEPARTURE_TOLERANCE_MS) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'A shipment cannot depart before its planned departure time.',
      [{ field: 'at', message: 'The departure time is earlier than route.departure.' }],
    )
  }

  shipment.status = 'in-transit'

  appendTimeline(shipment, {
    title: 'Departed',
    description: 'The shipment left its origin and monitoring is active.',
    tone: 'info',
    occurredAt: at,
  })

  await shipment.save()
  return shipment
}

async function completeShipment(identifier, input = {}) {
  const body = requirePlainBody(input ?? {})
  rejectUnknownKeys(body, ['completedAt', 'source', 'note'])

  const shipment = await findShipmentDocument(identifier)
  assertStatus(shipment, 'in-transit', 'complete')

  const completedAt = parseBodyDate(body.completedAt, 'completedAt', new Date())
  assertNotFuture(completedAt, 'completedAt')

  const departure = shipment.route?.departure
  if (departure && completedAt.getTime() < new Date(departure).getTime()) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'Completion cannot be before departure.',
      [{ field: 'completedAt', message: 'Completion must follow departure.' }],
    )
  }

  const source = body.source ?? 'operator'
  if (!COMPLETION_SOURCES.includes(source)) {
    badField('source', `source must be one of: ${COMPLETION_SOURCES.join(', ')}.`)
  }

  shipment.status = 'delivered'
  shipment.completedAt = completedAt
  shipment.completionSource = source
  shipment.route.progress = 100

  const note = typeof body.note === 'string' ? body.note.trim() : ''
  const description =
    source === 'delivery-event'
      ? 'Delivery recorded from a confirmed delivery event. Alerts keep their existing status and are not resolved automatically.'
      : 'Delivery recorded explicitly by an operator. Alerts keep their existing status and are not resolved automatically.'

  appendTimeline(shipment, {
    title:
      source === 'delivery-event'
        ? 'Delivery event confirmed'
        : 'Delivery confirmed by operator',
    description: note ? `${description} ${note}` : description,
    tone: 'ok',
    occurredAt: completedAt,
  })

  await shipment.save()
  return shipment
}

async function archiveShipment(identifier, input = {}) {
  const body = requirePlainBody(input ?? {})
  rejectUnknownKeys(body, ['archivedAt'])

  const shipment = await findShipmentDocument(identifier)
  assertStatus(shipment, 'delivered', 'archive')

  const archivedAt = parseBodyDate(body.archivedAt, 'archivedAt', new Date())
  assertNotFuture(archivedAt, 'archivedAt')

  if (shipment.completedAt && archivedAt.getTime() < new Date(shipment.completedAt).getTime()) {
    throw ApiError.unprocessable(
      'DOMAIN_RULE_VIOLATION',
      'Archive time cannot be before completion.',
      [{ field: 'archivedAt', message: 'Archive must follow completion.' }],
    )
  }

  shipment.status = 'archived'
  shipment.archivedAt = archivedAt

  appendTimeline(shipment, {
    title: 'Record archived',
    description:
      'Full record retained; no readings, alerts, incidents or timeline events were removed.',
    tone: 'muted',
    occurredAt: archivedAt,
  })

  await shipment.save()
  return shipment
}

module.exports = {
  updateShipment,
  replaceMonitoring,
  scheduleShipment,
  departShipment,
  completeShipment,
  archiveShipment,
}
