const {
  DEVICE_STALE_AFTER_MINUTES,
  BATTERY_WARNING_PERCENT,
  BATTERY_CRITICAL_PERCENT,
  SELF_TEST_VALID_HOURS,
  HOUR_MS,
} = require('../constants/deviceHealth')
const {
  getDeviceConnectionState,
  getDeviceLastSeenAgeMinutes,
} = require('./deviceState')

/**
 * Pure device-health derivation.
 *
 * Device health is computed from live evidence and is never stored. It is
 * intentionally independent from cargo health:
 *
 *   - offline            -> critical (never healthy)
 *   - stale heartbeat    -> warning  (never healthy)
 *   - battery <= 10%     -> critical
 *   - battery <= 20%     -> warning
 *   - any sensor fault   -> critical
 *   - degraded / missing or expired self-test -> warning
 *   - online with fresh self-test evidence for every fitted sensor -> healthy
 *
 * A stale or offline device can never be reported as healthy.
 */

function toPlain(value) {
  if (value && typeof value.toObject === 'function') return value.toObject()
  return value
}

function toTimestamp(value) {
  if (value === null || value === undefined) return null
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function toIso(value) {
  const timestamp = toTimestamp(value)
  return timestamp === null ? null : new Date(timestamp).toISOString()
}

function deriveBatteryHealth(battery) {
  const level = typeof battery === 'number' && Number.isFinite(battery) ? battery : null

  let status = 'unknown'
  if (level !== null) {
    if (level <= BATTERY_CRITICAL_PERCENT) status = 'critical'
    else if (level <= BATTERY_WARNING_PERCENT) status = 'warning'
    else status = 'ok'
  }

  return {
    level,
    status,
    warningPercent: BATTERY_WARNING_PERCENT,
    criticalPercent: BATTERY_CRITICAL_PERCENT,
  }
}

function deriveSensorEvidence(device, now = Date.now()) {
  const plain = toPlain(device) ?? {}
  const reference = now instanceof Date ? now.getTime() : Number(now)
  const fitted = Array.isArray(plain.sensors) ? plain.sensors : []
  const entries = new Map(
    (plain.sensorHealth ?? []).map((entry) => {
      const item = toPlain(entry) ?? {}
      return [item.sensorId, item]
    }),
  )

  return fitted.map((sensorId) => {
    const entry = entries.get(sensorId) ?? null
    const lastSelfTestAt = entry?.lastSelfTestAt ?? null
    const testedAt = toTimestamp(lastSelfTestAt)
    const ageMs = testedAt === null ? null : reference - testedAt
    const selfTestValid =
      ageMs !== null && ageMs >= 0 && ageMs <= SELF_TEST_VALID_HOURS * HOUR_MS
    const reportedStatus = entry?.status ?? 'unknown'

    let status = reportedStatus
    if (entry && !selfTestValid && reportedStatus !== 'fault' && reportedStatus !== 'degraded') {
      status = 'expired'
    }
    if (!entry) status = 'unknown'

    return {
      sensorId,
      status,
      reportedStatus,
      selfTestValid,
      selfTestExpired: Boolean(lastSelfTestAt) && !selfTestValid,
      lastSelfTestAt: toIso(lastSelfTestAt),
      note: entry?.note ?? '',
    }
  })
}

function deriveDeviceHealth(device, now = Date.now()) {
  const plain = toPlain(device) ?? {}
  const reference = now instanceof Date ? now.getTime() : Number(now)
  const evaluatedAt = new Date(reference).toISOString()

  if (!plain || plain.status === undefined) {
    return {
      status: 'unknown',
      healthy: false,
      connection: {
        state: 'offline',
        staleAfterMinutes: DEVICE_STALE_AFTER_MINUTES,
        lastSeenAt: null,
        ageMinutes: null,
      },
      battery: deriveBatteryHealth(null),
      sensors: [],
      selfTest: {
        validForHours: SELF_TEST_VALID_HOURS,
        evaluatedAt,
      },
      evaluatedAt,
    }
  }

  const connectionState = getDeviceConnectionState(plain, reference)
  const ageMinutes = getDeviceLastSeenAgeMinutes(plain, reference)
  const battery = deriveBatteryHealth(plain.battery)
  const sensors = deriveSensorEvidence(plain, reference)

  let status = 'healthy'

  if (connectionState === 'offline') {
    status = 'critical'
  } else if (connectionState === 'stale') {
    status = 'warning'
  } else if (battery.status === 'critical') {
    status = 'critical'
  } else if (sensors.some((sensor) => sensor.status === 'fault')) {
    status = 'critical'
  } else if (battery.status === 'warning') {
    status = 'warning'
  } else if (
    sensors.some(
      (sensor) => sensor.status !== 'ok' || sensor.selfTestValid !== true,
    )
  ) {
    status = 'warning'
  }

  return {
    status,
    healthy: status === 'healthy' && connectionState === 'online',
    connection: {
      state: connectionState,
      staleAfterMinutes: DEVICE_STALE_AFTER_MINUTES,
      lastSeenAt: toIso(plain.lastSeenAt),
      ageMinutes: ageMinutes === null ? null : Number(ageMinutes.toFixed(2)),
    },
    battery,
    sensors,
    selfTest: {
      validForHours: SELF_TEST_VALID_HOURS,
      evaluatedAt,
    },
    evaluatedAt,
  }
}

module.exports = {
  deriveBatteryHealth,
  deriveSensorEvidence,
  deriveDeviceHealth,
  toIso,
}
