const { Alert, SensorReading, Shipment } = require('../models')
const { SENSOR_CATALOG, SENSOR_IDS } = require('../constants/sensors')
const { READING_EVIDENCE_FRESH_MINUTES, MINUTE_MS } = require('../constants/deviceHealth')
const { measurementFieldFor } = require('../validation/readingInput')
const {
  buildEpisodeKey,
  createAlertEpisode,
} = require('./alertEpisodeService')

/**
 * Cargo threshold evaluation and cargo-health derivation.
 *
 * Only eligible in-transit readings reach this module. Device/system alerts
 * (source: 'system') are never read here, so they can never affect cargo
 * health. Alerts are never resolved automatically and recovery only sets
 * `recoveredAt`.
 */

const SEVERITY_RANK = Object.freeze({ info: 0, warning: 1, critical: 2 })

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? 0
}

function isOutsideRange(value, bounds) {
  if (!bounds) return false
  const hasMin = bounds.min !== null && bounds.min !== undefined
  const hasMax = bounds.max !== null && bounds.max !== undefined
  return (hasMin && value < bounds.min) || (hasMax && value > bounds.max)
}

function directionFor(value, bounds) {
  if (bounds?.max !== null && bounds?.max !== undefined && value > bounds.max) {
    return 'above'
  }
  if (bounds?.min !== null && bounds?.min !== undefined && value < bounds.min) {
    return 'below'
  }
  return null
}

function durationMinutes(start, end) {
  if (!start || !end) return 0
  const startTime = new Date(start).getTime()
  const endTime = new Date(end).getTime()
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 0
  return Math.max(0, (endTime - startTime) / MINUTE_MS)
}

/**
 * Assess one numeric sensor reading.
 *
 * Returns `{ severity: null }` when the value is in range. Escalation time is
 * measured from the still-open alert's start, so a new warning is not
 * escalated by its own reading.
 */
function assessNumericSensor(sensorId, value, config = {}, context = {}) {
  const warning = config.warning ?? null
  const critical = config.critical ?? null

  if (isOutsideRange(value, critical)) {
    return {
      severity: 'critical',
      direction: directionFor(value, critical),
      bounds: critical,
    }
  }

  if (!isOutsideRange(value, warning)) {
    return { severity: null, direction: null, bounds: null }
  }

  let severity = 'warning'
  const escalationMinutes = config.escalationMinutes
  if (
    Number.isFinite(escalationMinutes) &&
    escalationMinutes >= 0 &&
    context.alertStartedAt &&
    context.recordedAt &&
    durationMinutes(context.alertStartedAt, context.recordedAt) >=
      escalationMinutes &&
    escalationMinutes > 0
  ) {
    severity = 'critical'
  }

  return {
    severity,
    direction: directionFor(value, warning),
    bounds: severity === 'critical' ? critical ?? warning : warning,
  }
}

/**
 * Assess a door reading. A door alert only starts once the unexpected state
 * has lasted at least the configured warning duration.
 */
function assessDoorSensor(config = {}, context = {}) {
  const expectedState = config.expectedState
  if (expectedState !== 'open' && expectedState !== 'closed') {
    return { severity: null, direction: null, bounds: null, openMinutes: 0 }
  }

  const observedState = context.observedOpen ? 'open' : 'closed'
  if (observedState === expectedState) {
    return { severity: null, direction: null, bounds: null, openMinutes: 0 }
  }

  const openMinutes = Math.max(0, Number(context.openMinutes) || 0)
  const warningMinutes = config.warning?.maxOpenMinutes
  const criticalMinutes = config.critical?.maxOpenMinutes

  if (
    Number.isFinite(criticalMinutes) &&
    criticalMinutes > 0 &&
    openMinutes >= criticalMinutes
  ) {
    return {
      severity: 'critical',
      direction: observedState,
      bounds: config.critical,
      openMinutes,
    }
  }

  if (
    Number.isFinite(warningMinutes) &&
    warningMinutes > 0 &&
    openMinutes >= warningMinutes
  ) {
    const escalationMinutes = Number.isFinite(config.escalationMinutes)
      ? config.escalationMinutes
      : 0
    const severity =
      escalationMinutes > 0 && openMinutes >= warningMinutes + escalationMinutes
        ? 'critical'
        : 'warning'

    return {
      severity,
      direction: observedState,
      bounds: severity === 'critical' ? config.critical ?? config.warning : config.warning,
      openMinutes,
    }
  }

  return { severity: null, direction: observedState, bounds: null, openMinutes }
}

/**
 * Derive cargo health from open CARGO alerts and reading evidence.
 *
 * - any open critical cargo alert -> critical
 * - any open warning cargo alert  -> warning
 * - every enabled sensor has fresh eligible evidence -> healthy
 * - otherwise unknown
 *
 * A recovered but unresolved alert still counts as open: resolution is a
 * deliberate operator action and never happens automatically.
 */
function deriveCargoHealth({ openAlerts = [], requiredSensors = [], evidencedSensors = [] }) {
  if (openAlerts.some((alert) => alert.severity === 'critical')) return 'critical'
  if (openAlerts.some((alert) => alert.severity === 'warning')) return 'warning'
  if (requiredSensors.length === 0) return 'unknown'

  const evidence = new Set(evidencedSensors)
  const complete = requiredSensors.every((sensorId) => evidence.has(sensorId))
  return complete ? 'healthy' : 'unknown'
}

function enabledSensorIds(monitoring = {}) {
  return SENSOR_IDS.filter((sensorId) => monitoring?.[sensorId]?.enabled === true)
}

function formatValue(value, sensorId) {
  const meta = SENSOR_CATALOG[sensorId]
  if (value === null || value === undefined) return String(value)
  if (!meta) return String(value)
  const decimals = Number.isInteger(meta.decimals) ? meta.decimals : 1
  return `${Number(value).toFixed(decimals)} ${meta.unit}`
}

function formatBounds(bounds, sensorId) {
  if (!bounds) return 'configured range'
  if (bounds.maxOpenMinutes !== null && bounds.maxOpenMinutes !== undefined) {
    return `${bounds.maxOpenMinutes} min`
  }
  const hasMin = bounds.min !== null && bounds.min !== undefined
  const hasMax = bounds.max !== null && bounds.max !== undefined
  if (hasMin && hasMax) {
    return `${formatValue(bounds.min, sensorId)} – ${formatValue(bounds.max, sensorId)}`
  }
  if (hasMax) return `≤ ${formatValue(bounds.max, sensorId)}`
  if (hasMin) return `≥ ${formatValue(bounds.min, sensorId)}`
  return 'configured range'
}

function buildAlertContent(sensorId, assessment, value, severity) {
  const meta = SENSOR_CATALOG[sensorId]
  const label = meta?.label ?? sensorId

  if (sensorId === 'door') {
    return {
      title: `${label} unexpected for ${severity === 'critical' ? 'a critical duration' : 'too long'}`,
      message: `${label} remained ${assessment.direction} for ${Number(assessment.openMinutes).toFixed(0)} min, beyond the ${severity} limit of ${formatBounds(assessment.bounds, sensorId)}.`,
    }
  }

  return {
    title: `${label} ${assessment.direction ?? 'out of'} range`,
    message: `${label} reading ${formatValue(value, sensorId)} breached the ${severity} limit (${formatBounds(assessment.bounds, sensorId)}).`,
  }
}

function thresholdSnapshot(assessment) {
  const bounds = assessment.bounds ?? {}
  return {
    min: bounds.min ?? null,
    max: bounds.max ?? null,
    maxOpenMinutes: bounds.maxOpenMinutes ?? null,
  }
}

function peakValueFor(existing, value, assessment) {
  if (existing === null || existing === undefined) return value
  if (assessment.direction === 'above') return Math.max(existing, value)
  if (assessment.direction === 'below') return Math.min(existing, value)
  return value
}

function applyBreachToAlert(existing, { assessment, triggerValue, content }) {
  const escalatedNow =
    severityRank(assessment.severity) > severityRank(existing.severity)

  existing.severity = escalatedNow ? assessment.severity : existing.severity
  existing.triggerValue = triggerValue
  existing.peakValue = peakValueFor(existing.peakValue, triggerValue, assessment)
  existing.threshold = thresholdSnapshot(assessment)
  existing.recoveredAt = null

  if (escalatedNow) {
    existing.title = content.title
    existing.message = content.message
  }

  return escalatedNow
}

async function doorOpenMinutes(shipment, reading) {
  const config = shipment.monitoring?.door ?? {}
  const expectedState = config.expectedState
  const expectedOpen = expectedState === 'open'
  const recordedAt = reading.recordedAt

  const anchor = await SensorReading.findOne({
    shipment: shipment._id,
    recordedAt: { $lte: recordedAt },
    doorOpen: expectedOpen,
    late: { $ne: true },
  })
    .sort({ recordedAt: -1 })
    .select('recordedAt')
    .lean()

  const since = anchor?.recordedAt ?? shipment.route?.departure ?? recordedAt
  return durationMinutes(since, recordedAt)
}

async function loadEvidencedSensors(shipmentId, requiredSensors, now) {
  const windowStart = new Date(
    new Date(now).getTime() - READING_EVIDENCE_FRESH_MINUTES * MINUTE_MS,
  )

  const checks = await Promise.all(
    requiredSensors.map(async (sensorId) => {
      const field = measurementFieldFor(sensorId)
      const exists = await SensorReading.exists({
        shipment: shipmentId,
        recordedAt: { $gte: windowStart },
        evaluationSkipped: { $ne: true },
        [field]: { $ne: null },
      })
      return exists ? sensorId : null
    }),
  )

  return checks.filter(Boolean)
}

async function assessCargoHealth(shipment, monitoring, now = new Date()) {
  const [openAlerts, requiredSensors] = await Promise.all([
    Alert.find({ shipment: shipment._id, source: 'cargo', status: { $ne: 'resolved' } })
      .select('severity')
      .lean(),
    Promise.resolve(enabledSensorIds(monitoring ?? shipment.monitoring)),
  ])

  const evidencedSensors = await loadEvidencedSensors(
    shipment._id,
    requiredSensors,
    now,
  )

  return deriveCargoHealth({
    openAlerts,
    requiredSensors,
    evidencedSensors,
  })
}

async function refreshCargoHealth(shipment, monitoring, now = new Date()) {
  const healthStatus = await assessCargoHealth(shipment, monitoring, now)

  // The lifecycle guard protects completed/archived history from a concurrent
  // ingestion finishing after delivery.
  await Shipment.updateOne(
    { _id: shipment._id, status: 'in-transit' },
    { $set: { healthStatus } },
  )

  return healthStatus
}

/**
 * Evaluate one eligible in-transit reading.
 *
 * One open cargo alert is kept per sensor episode. Critical evidence escalates
 * the existing alert instead of creating a duplicate. In-range evidence sets
 * `recoveredAt` but never resolves the alert.
 */
async function evaluateReading({ shipment, device, reading, now = new Date() }) {
  const monitoring = shipment.monitoring ?? {}
  const recordedAt = new Date(reading.recordedAt)
  const created = []
  const escalated = []
  const recovered = []

  for (const sensorId of enabledSensorIds(monitoring)) {
    const config = monitoring[sensorId] ?? {}
    const field = measurementFieldFor(sensorId)
    const value = reading[field]
    if (value === null || value === undefined) continue

    const existing = await Alert.findOne({
      shipment: shipment._id,
      source: 'cargo',
      parameter: sensorId,
      status: { $ne: 'resolved' },
    }).sort({ startedAt: -1 })

    let assessment
    if (sensorId === 'door') {
      const openMinutes = await doorOpenMinutes(shipment, reading)
      assessment = assessDoorSensor(config, {
        observedOpen: value === true,
        openMinutes,
      })
    } else {
      assessment = assessNumericSensor(sensorId, value, config, {
        alertStartedAt: existing?.startedAt ?? null,
        recordedAt,
      })
    }

    if (!assessment.severity) {
      if (existing && !existing.recoveredAt) {
        existing.recoveredAt = new Date(
          Math.max(recordedAt.getTime(), new Date(existing.startedAt).getTime()),
        )
        await existing.save()
        recovered.push({
          alertId: String(existing._id),
          parameter: sensorId,
        })
      }
      continue
    }

    const triggerValue = sensorId === 'door' ? Number(assessment.openMinutes.toFixed(2)) : value
    const content = buildAlertContent(
      sensorId,
      assessment,
      triggerValue,
      assessment.severity,
    )

    if (existing) {
      const escalatedNow = applyBreachToAlert(existing, {
        assessment,
        triggerValue,
        content,
      })

      if (escalatedNow) {
        escalated.push({
          alertId: String(existing._id),
          parameter: sensorId,
          severity: existing.severity,
        })
      }

      await existing.save()
      continue
    }

    const episodeKey = buildEpisodeKey(
      'cargo',
      shipment._id,
      'cargo',
      sensorId,
    )
    const { alert, created: wasCreated } = await createAlertEpisode({
      shipment: shipment._id,
      device: shipment.device ?? device?._id ?? null,
      source: 'cargo',
      parameter: sensorId,
      severity: assessment.severity,
      title: content.title,
      message: content.message,
      triggerValue,
      peakValue: triggerValue,
      threshold: thresholdSnapshot(assessment),
      startedAt: recordedAt,
      status: 'active',
      episodeKey,
    })

    if (!wasCreated) {
      // A concurrent reading opened the episode first. Apply this reading's
      // escalation to the winning document instead of inserting a duplicate.
      const escalatedNow = applyBreachToAlert(alert, {
        assessment,
        triggerValue,
        content,
      })
      if (escalatedNow) {
        escalated.push({
          alertId: String(alert._id),
          parameter: sensorId,
          severity: alert.severity,
        })
      }
      await alert.save()
      continue
    }

    created.push({
      alertId: String(alert._id),
      parameter: sensorId,
      severity: alert.severity,
    })
  }

  const cargoHealth = await refreshCargoHealth(shipment, monitoring, now)

  return {
    applied: true,
    skipReason: null,
    cargoHealth,
    alerts: { created, escalated, recovered },
  }
}

module.exports = {
  severityRank,
  isOutsideRange,
  assessNumericSensor,
  assessDoorSensor,
  deriveCargoHealth,
  enabledSensorIds,
  assessCargoHealth,
  refreshCargoHealth,
  evaluateReading,
  doorOpenMinutes,
}
