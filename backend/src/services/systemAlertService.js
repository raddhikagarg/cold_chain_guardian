const { Alert, Shipment } = require('../models')
const { OPERATIONAL_SHIPMENT_STATUSES } = require('../constants/enums')
const {
  DEVICE_STALE_AFTER_MINUTES,
  BATTERY_WARNING_PERCENT,
  BATTERY_CRITICAL_PERCENT,
} = require('../constants/deviceHealth')
const { SENSOR_CATALOG } = require('../constants/sensors')
const { deriveDeviceHealth } = require('../utils/deviceHealth')
const { severityRank } = require('./cargoEvaluation')
const {
  buildEpisodeKey,
  createAlertEpisode,
} = require('./alertEpisodeService')

/**
 * Independent system/device alert evaluation.
 *
 * These alerts are attached to the operational shipment that owns the device,
 * but they never read or update cargo health. Cargo evaluation likewise never
 * reads source:'system' alerts, keeping the two health domains independent.
 *
 * Conditions are synchronised rather than recreated:
 *   - one unresolved alert per condition (enforced by `episodeKey`)
 *   - severity may escalate, never downgrade
 *   - a recovered condition sets `recoveredAt` and is never auto-resolved
 */

const SYSTEM_TYPE_LABELS = Object.freeze({
  offline: 'Device connectivity',
  battery: 'Device battery',
  sensorFault: 'Sensor fault',
  selfTest: 'Sensor self-test',
})

function isEnabled(config, fallback = true) {
  return config?.enabled === undefined ? fallback : config.enabled === true
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function sensorLabel(sensorId) {
  return SENSOR_CATALOG[sensorId]?.label ?? sensorId
}

function offlineCondition({ config, health }) {
  if (!isEnabled(config)) return null

  const state = health.connection.state
  const ageMinutes = health.connection.ageMinutes

  // The agreed device-health floor is ten minutes. A longer configured delay
  // is respected, but the sweep never calls a device stale sooner than that.
  const configured = finiteNumber(config?.afterMinutes)
    ? config.afterMinutes
    : DEVICE_STALE_AFTER_MINUTES
  const afterMinutes = Math.max(configured, DEVICE_STALE_AFTER_MINUTES)

  const missingHeartbeat = ageMinutes === null
  const overdue = missingHeartbeat || ageMinutes > afterMinutes
  if (state === 'online' || !overdue) return null

  const severity = state === 'offline' ? 'critical' : 'warning'
  const ageText = missingHeartbeat
    ? 'no heartbeat has been received'
    : `last heartbeat was ${Number(ageMinutes).toFixed(1)} min ago`

  return {
    systemType: 'offline',
    parameter: 'device',
    severity,
    title: state === 'offline' ? 'Device offline' : 'Device heartbeat stale',
    message: `The assigned device is ${state === 'offline' ? 'offline' : 'stale'}: ${ageText}; the configured limit is ${afterMinutes} min.`,
    triggerValue: missingHeartbeat ? null : Number(ageMinutes.toFixed(2)),
    threshold: { min: null, max: afterMinutes, maxOpenMinutes: null },
    direction: 'max',
  }
}

function batteryCondition({ config, health }) {
  if (!isEnabled(config)) return null

  const level = health.battery.level
  if (!finiteNumber(level)) return null

  const configured = finiteNumber(config?.thresholdPercent)
    ? config.thresholdPercent
    : BATTERY_WARNING_PERCENT
  const warningAt = Math.min(configured, BATTERY_WARNING_PERCENT)
  const criticalAt = Math.min(configured, BATTERY_CRITICAL_PERCENT)

  if (level > warningAt) return null

  const severity = level <= criticalAt ? 'critical' : 'warning'
  return {
    systemType: 'battery',
    parameter: 'device',
    severity,
    title:
      severity === 'critical'
        ? 'Device battery critical'
        : 'Device battery low',
    message: `The assigned device battery is ${level}%, at or below the ${severity} threshold of ${severity === 'critical' ? criticalAt : warningAt}%.`,
    triggerValue: level,
    threshold: { min: null, max: warningAt, maxOpenMinutes: null },
    direction: 'min',
  }
}

function sensorFaultConditions({ config, health }) {
  if (!isEnabled(config)) return []

  return health.sensors
    .filter(
      (sensor) =>
        sensor.reportedStatus === 'fault' ||
        sensor.reportedStatus === 'degraded',
    )
    .map((sensor) => {
      const severity =
        sensor.reportedStatus === 'fault' ? 'critical' : 'warning'
      return {
        systemType: 'sensorFault',
        parameter: sensor.sensorId,
        severity,
        title: `${sensorLabel(sensor.sensorId)} ${
          severity === 'critical' ? 'fault' : 'degraded'
        }`,
        message: `The ${sensorLabel(sensor.sensorId)} sensor reports ${sensor.reportedStatus}${
          sensor.selfTestExpired ? ' and its self-test evidence has expired' : ''
        }.`,
        triggerValue: null,
        threshold: null,
        direction: null,
      }
    })
}

function selfTestCondition({ config, health }) {
  if (!isEnabled(config) || health.sensors.length === 0) return null

  const affected = health.sensors.filter(
    (sensor) =>
      sensor.reportedStatus === 'fault' ||
      sensor.reportedStatus === 'degraded' ||
      sensor.selfTestValid !== true,
  )
  if (affected.length === 0) return null

  const hasFault = affected.some(
    (sensor) => sensor.reportedStatus === 'fault',
  )
  const severity = hasFault ? 'critical' : 'warning'
  const labels = affected.map((sensor) => sensorLabel(sensor.sensorId)).join(', ')

  return {
    systemType: 'selfTest',
    parameter: 'device',
    severity,
    title: hasFault
      ? 'Sensor self-test failed'
      : 'Sensor self-test evidence expired or missing',
    message: `${labels} ${
      affected.length === 1 ? 'does' : 'do'
    } not have valid self-test evidence within the last ${health.selfTest.validForHours} hours.`,
    triggerValue: null,
    threshold: null,
    direction: null,
  }
}

/**
 * Pure condition builder. Exported for unit tests and reused by the sweep and
 * heartbeat/self-test paths so every surface evaluates the same rules.
 */
function buildSystemConditions(shipment, device, now = Date.now()) {
  if (!shipment || !device) return []
  if (!OPERATIONAL_SHIPMENT_STATUSES.includes(shipment.status)) return []

  const health = deriveDeviceHealth(device, now)
  const config = shipment.systemAlerts ?? {}

  return [
    offlineCondition({ config: config.offline, health }),
    batteryCondition({ config: config.battery, health }),
    ...sensorFaultConditions({ config: config.sensorFault, health }),
    selfTestCondition({ config: config.selfTest, health }),
  ].filter(Boolean)
}

function conditionMapKey(systemType, parameter) {
  return `${systemType}:${parameter}`
}

function peakFor(direction, existing, value) {
  if (!finiteNumber(value)) return existing ?? null
  if (existing === null || existing === undefined) return value
  if (direction === 'max') return Math.max(existing, value)
  if (direction === 'min') return Math.min(existing, value)
  return existing
}

function applyCondition(alert, condition, startedAt) {
  const escalated =
    severityRank(condition.severity) > severityRank(alert.severity)

  if (escalated) {
    alert.severity = condition.severity
    alert.title = condition.title
    alert.message = condition.message
  }

  alert.triggerValue = condition.triggerValue
  alert.peakValue = peakFor(
    condition.direction,
    alert.peakValue,
    condition.triggerValue,
  )
  alert.threshold = condition.threshold
  alert.recoveredAt = null
  alert.episodeKey = buildEpisodeKey(
    'system',
    alert.shipment,
    condition.systemType,
    condition.parameter,
  )
  alert.startedAt = alert.startedAt ?? startedAt

  return escalated
}

function enabledSystemTypes(systemAlerts = {}) {
  const types = []
  for (const type of ['offline', 'battery', 'sensorFault', 'selfTest']) {
    if (isEnabled(systemAlerts[type])) types.push(type)
  }
  return types
}

async function syncSystemAlerts(
  shipment,
  device,
  { now = new Date(), existingAlerts } = {},
) {
  if (!shipment || !device) {
    return { evaluated: false, created: [], escalated: [], recovered: [] }
  }
  if (!OPERATIONAL_SHIPMENT_STATUSES.includes(shipment.status)) {
    return { evaluated: false, created: [], escalated: [], recovered: [] }
  }

  const conditions = buildSystemConditions(shipment, device, now)
  const alerts =
    existingAlerts ??
    (await Alert.find({
      shipment: shipment._id,
      source: 'system',
      status: { $ne: 'resolved' },
    }))

  const byCondition = new Map()
  for (const alert of alerts) {
    byCondition.set(conditionMapKey(alert.systemType, alert.parameter), alert)
  }

  const created = []
  const escalated = []
  const recovered = []
  const conditionKeys = new Set()
  const startedAt = now instanceof Date ? now : new Date(now)

  for (const condition of conditions) {
    const key = conditionMapKey(condition.systemType, condition.parameter)
    conditionKeys.add(key)
    const existing = byCondition.get(key)

    if (existing) {
      const escalatedNow = applyCondition(existing, condition, startedAt)
      await existing.save()
      if (escalatedNow) {
        escalated.push({
          alertId: String(existing._id),
          systemType: condition.systemType,
          parameter: condition.parameter,
          severity: existing.severity,
        })
      }
      continue
    }

    const episodeKey = buildEpisodeKey(
      'system',
      shipment._id,
      condition.systemType,
      condition.parameter,
    )
    const { alert, created: wasCreated } = await createAlertEpisode({
      shipment: shipment._id,
      device: device._id,
      source: 'system',
      systemType: condition.systemType,
      parameter: condition.parameter,
      severity: condition.severity,
      title: condition.title,
      message: condition.message,
      triggerValue: condition.triggerValue,
      peakValue: condition.triggerValue,
      threshold: condition.threshold,
      startedAt,
      status: 'active',
      episodeKey,
    })

    if (wasCreated) {
      created.push({
        alertId: String(alert._id),
        systemType: condition.systemType,
        parameter: condition.parameter,
        severity: alert.severity,
      })
    } else {
      const escalatedNow = applyCondition(alert, condition, startedAt)
      await alert.save()
      if (escalatedNow) {
        escalated.push({
          alertId: String(alert._id),
          systemType: condition.systemType,
          parameter: condition.parameter,
          severity: alert.severity,
        })
      }
    }
  }

  const enabled = new Set(enabledSystemTypes(shipment.systemAlerts))
  for (const alert of alerts) {
    const key = conditionMapKey(alert.systemType, alert.parameter)
    if (conditionKeys.has(key)) continue
    if (!enabled.has(alert.systemType)) continue
    if (alert.recoveredAt) continue

    alert.recoveredAt = startedAt
    await alert.save()
    recovered.push({
      alertId: String(alert._id),
      systemType: alert.systemType,
      parameter: alert.parameter,
    })
  }

  return { evaluated: true, created, escalated, recovered }
}

async function evaluateSystemAlertsForShipment(shipment, device, now = new Date()) {
  return syncSystemAlerts(shipment, device, { now })
}

/**
 * Evaluate a device against its current operational shipment. Heartbeats,
 * self-test submissions and reading ingestion call this after persisting their
 * own evidence.
 */
async function evaluateSystemAlertsForDevice(device, now = new Date()) {
  if (!device?._id) return { evaluated: false, created: [], escalated: [], recovered: [] }

  const shipment = await Shipment.findOne({
    device: device._id,
    status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
  })

  if (!shipment) {
    return { evaluated: false, created: [], escalated: [], recovered: [] }
  }

  return syncSystemAlerts(shipment, device, { now })
}

/**
 * Bulk variant used by the offline sweep. One query loads every unresolved
 * system alert for the operational fleet, avoiding an N+1 lookup per shipment.
 */
async function evaluateSystemAlertsForEntries(entries, now = new Date()) {
  if (entries.length === 0) return []

  const shipmentIds = entries.map(({ shipment }) => shipment._id)
  const alerts = await Alert.find({
    shipment: { $in: shipmentIds },
    source: 'system',
    status: { $ne: 'resolved' },
  })

  const grouped = new Map()
  for (const alert of alerts) {
    const key = String(alert.shipment)
    const list = grouped.get(key) ?? []
    list.push(alert)
    grouped.set(key, list)
  }

  const results = []
  for (const { shipment, device } of entries) {
    const existingAlerts = grouped.get(String(shipment._id)) ?? []
    const result = await syncSystemAlerts(shipment, device, {
      now,
      existingAlerts,
    })
    results.push({ shipmentId: shipment.shipmentId, ...result })
  }

  return results
}

module.exports = {
  SYSTEM_TYPE_LABELS,
  buildSystemConditions,
  syncSystemAlerts,
  evaluateSystemAlertsForShipment,
  evaluateSystemAlertsForDevice,
  evaluateSystemAlertsForEntries,
  enabledSystemTypes,
}
