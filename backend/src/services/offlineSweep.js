const mongoose = require('mongoose')

const { Device, Shipment } = require('../models')
const { OPERATIONAL_SHIPMENT_STATUSES } = require('../constants/enums')
const {
  evaluateSystemAlertsForEntries,
} = require('./systemAlertService')

/**
 * In-process offline sweep.
 *
 * The timer starts only after the database connection succeeds and is stopped
 * during shutdown. It deliberately does not mutate Shipment.healthStatus:
 * device connectivity is independent from cargo health.
 *
 * `runOfflineSweep` is also exported so operators/tests can invoke one sweep
 * deterministically without waiting for the 60-second interval.
 */

const DEFAULT_INTERVAL_MS = 60 * 1000

// A hard cap keeps one sweep bounded. The demo fleet is far below this; the
// flag makes truncation explicit rather than silent.
const MAX_SWEEP_SHIPMENTS = 10000

let timer = null
let inFlight = null
let started = false

function backgroundJobsDisabled() {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.DISABLE_BACKGROUND_JOBS === 'true'
  )
}

async function performSweep(now = new Date()) {
  if (mongoose.connection.readyState !== 1) {
    return {
      skipped: 'database-disconnected',
      shipments: 0,
      created: 0,
      escalated: 0,
      recovered: 0,
      truncated: false,
    }
  }

  const shipments = await Shipment.find({
    status: { $in: OPERATIONAL_SHIPMENT_STATUSES },
    device: { $ne: null },
  })
    .select('shipmentId status systemAlerts monitoring device')
    .limit(MAX_SWEEP_SHIPMENTS)
    .lean()

  if (shipments.length === 0) {
    return {
      skipped: null,
      shipments: 0,
      created: 0,
      escalated: 0,
      recovered: 0,
      truncated: false,
    }
  }

  const deviceIds = shipments.map((shipment) => shipment.device)
  const devices = await Device.find({ _id: { $in: deviceIds } })
    .select('deviceId name status battery lastSeenAt sensors sensorHealth')
    .lean()
  const byId = new Map(devices.map((device) => [String(device._id), device]))

  const entries = shipments
    .map((shipment) => ({
      shipment,
      device: byId.get(String(shipment.device)) ?? null,
    }))
    .filter((entry) => entry.device)

  const results = await evaluateSystemAlertsForEntries(entries, now)

  return {
    skipped: null,
    shipments: results.length,
    created: results.reduce((sum, result) => sum + result.created.length, 0),
    escalated: results.reduce(
      (sum, result) => sum + result.escalated.length,
      0,
    ),
    recovered: results.reduce(
      (sum, result) => sum + result.recovered.length,
      0,
    ),
    truncated: shipments.length >= MAX_SWEEP_SHIPMENTS,
    results,
  }
}

/**
 * Run exactly one sweep. Concurrent callers share the same in-flight promise,
 * so a slow database can never overlap two sweeps.
 */
function runOfflineSweep(now = new Date()) {
  if (inFlight) return inFlight

  inFlight = performSweep(now)
    .catch((error) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[offline-sweep] failed: ${error.message}`)
      }
      throw error
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

function startOfflineSweep(options = {}) {
  if (started) return false
  const force = options.force === true
  if (!force && backgroundJobsDisabled()) return false

  const intervalMs =
    Number.isInteger(options.intervalMs) && options.intervalMs > 0
      ? options.intervalMs
      : DEFAULT_INTERVAL_MS

  started = true
  timer = setInterval(() => {
    runOfflineSweep().catch(() => {
      // performSweep already logs outside tests; the timer must keep running.
    })
  }, intervalMs)

  if (typeof timer.unref === 'function') timer.unref()
  return true
}

async function stopOfflineSweep() {
  started = false
  if (timer) {
    clearInterval(timer)
    timer = null
  }

  if (inFlight) {
    try {
      await inFlight
    } catch {
      // A failed sweep must not block shutdown.
    }
  }
}

function isOfflineSweepRunning() {
  return started
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MAX_SWEEP_SHIPMENTS,
  runOfflineSweep,
  startOfflineSweep,
  stopOfflineSweep,
  isOfflineSweepRunning,
  backgroundJobsDisabled,
}
