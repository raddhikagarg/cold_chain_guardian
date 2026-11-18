/**
 * Shared enum values for the database models.
 *
 * Values come from the existing frontend domain model so the API can stay
 * compatible. `Shipment.status` is lifecycle only; cargo health lives in
 * `Shipment.healthStatus`.
 */

const { SENSOR_IDS } = require('./sensors')

// Lifecycle. The stored value is `delivered`; the UI labels it "Completed".
const SHIPMENT_LIFECYCLE_STATUSES = Object.freeze([
  'draft',
  'scheduled',
  'in-transit',
  'delivered',
  'archived',
])

// Shipment statuses that reserve a device. Drafts, delivered and archived
// shipments never reserve hardware.
const OPERATIONAL_SHIPMENT_STATUSES = Object.freeze(['scheduled', 'in-transit'])

// Cargo health, kept separate from lifecycle and from device health.
const SHIPMENT_HEALTH_STATUSES = Object.freeze([
  'unknown',
  'healthy',
  'warning',
  'critical',
])

const SHIPMENT_TIMELINE_TONES = Object.freeze([
  'info',
  'ok',
  'warn',
  'critical',
  'muted',
])

const COMPLETION_SOURCES = Object.freeze(['operator', 'delivery-event'])

const CARGO_CATEGORIES = Object.freeze(['fruits', 'vegetables'])

const QUANTITY_UNITS = Object.freeze([
  'kg',
  'crates',
  'pallets',
  'boxes',
  'tons',
])

const ALERT_SEVERITIES = Object.freeze(['critical', 'warning', 'info'])

const ALERT_STATUSES = Object.freeze(['active', 'acknowledged', 'resolved'])

const ALERT_SOURCES = Object.freeze(['cargo', 'system'])

const SYSTEM_ALERT_TYPES = Object.freeze([
  'offline',
  'battery',
  'sensorFault',
  'selfTest',
])

// Cargo alerts use a sensor id; device/system alerts use `device`.
const ALERT_PARAMETERS = Object.freeze([...SENSOR_IDS, 'device'])

const DEVICE_STATUSES = Object.freeze(['online', 'offline'])

const SENSOR_HEALTH_STATUSES = Object.freeze(['ok', 'degraded', 'fault'])

const DEVICE_EVENT_TYPES = Object.freeze([
  'connectivity',
  'sensor',
  'power',
  'firmware',
  'maintenance',
  'selfTest',
  'assignment',
  'release',
  'other',
])

module.exports = {
  SHIPMENT_LIFECYCLE_STATUSES,
  OPERATIONAL_SHIPMENT_STATUSES,
  SHIPMENT_HEALTH_STATUSES,
  SHIPMENT_TIMELINE_TONES,
  COMPLETION_SOURCES,
  CARGO_CATEGORIES,
  QUANTITY_UNITS,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_SOURCES,
  SYSTEM_ALERT_TYPES,
  ALERT_PARAMETERS,
  DEVICE_STATUSES,
  SENSOR_HEALTH_STATUSES,
  DEVICE_EVENT_TYPES,
}
