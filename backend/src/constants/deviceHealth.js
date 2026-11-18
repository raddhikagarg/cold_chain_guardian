/**
 * Shared device-health and reading-ingestion thresholds.
 *
 * These values are the agreed Phase 3 limits. They live in one place so the
 * device health derivation, heartbeat processing and reading ingestion can
 * never disagree about freshness.
 *
 * Device health is independent from cargo health.
 */

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

// A heartbeat older than ten minutes makes an online device "stale".
const DEVICE_STALE_AFTER_MINUTES = 10

// Battery evidence thresholds. A missing battery value is unknown, never
// healthy or critical.
const BATTERY_WARNING_PERCENT = 20
const BATTERY_CRITICAL_PERCENT = 10

// A sensor self-test result is only evidence for 24 hours.
const SELF_TEST_VALID_HOURS = 24

// Readings recorded more than five minutes ahead of the server clock are
// rejected with HTTP 422.
const READING_FUTURE_TOLERANCE_MS = 5 * MINUTE_MS

// Historical readings are accepted for 24 hours after completion.
const LATE_READING_WINDOW_HOURS = 24

// A historical reading may be recorded up to five minutes after completion.
const LATE_RECORDING_TOLERANCE_MS = 5 * MINUTE_MS

// An in-order reading older than this many minutes is still stored, but is
// flagged stale and excluded from cargo evaluation.
const READING_STALE_AFTER_MINUTES = 10

// Cargo health needs reading evidence for every enabled sensor within this
// rolling window.
const READING_EVIDENCE_FRESH_MINUTES = 15

// Completed statuses that qualify for the explicit late-reading path.
const COMPLETED_SHIPMENT_STATUSES = Object.freeze(['delivered', 'archived'])

module.exports = {
  MINUTE_MS,
  HOUR_MS,
  DEVICE_STALE_AFTER_MINUTES,
  BATTERY_WARNING_PERCENT,
  BATTERY_CRITICAL_PERCENT,
  SELF_TEST_VALID_HOURS,
  READING_FUTURE_TOLERANCE_MS,
  LATE_READING_WINDOW_HOURS,
  LATE_RECORDING_TOLERANCE_MS,
  READING_STALE_AFTER_MINUTES,
  READING_EVIDENCE_FRESH_MINUTES,
  COMPLETED_SHIPMENT_STATUSES,
}
