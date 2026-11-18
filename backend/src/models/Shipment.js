const mongoose = require('mongoose')

const { Schema } = mongoose

const { SENSOR_IDS, SENSOR_CATALOG } = require('../constants/sensors')
const {
  SHIPMENT_LIFECYCLE_STATUSES,
  SHIPMENT_HEALTH_STATUSES,
  SHIPMENT_TIMELINE_TONES,
  COMPLETION_SOURCES,
  CARGO_CATEGORIES,
  QUANTITY_UNITS,
} = require('../constants/enums')

/**
 * Shipment model.
 *
 * `status` is lifecycle only. Cargo health lives in `healthStatus` so the two
 * concerns can never be confused in storage. New shipments start with
 * `healthStatus: 'unknown'`; only a future assessment service may promote that
 * to `healthy`, `warning` or `critical`:
 *
 *   - unknown  - not enough monitoring evidence to judge cargo health.
 *   - healthy  - at least one enabled sensor has readings covering the
 *                monitored period, no unresolved warning/critical alerts
 *                exist and no configured threshold is exceeded.
 *   - warning  - at least one unresolved warning alert and no unresolved
 *                critical alert.
 *   - critical - at least one unresolved critical alert or a current critical
 *                threshold breach.
 *
 * Device health never influences this field. Completing or archiving a
 * shipment never resets `healthStatus`, never resolves alerts and never
 * deletes readings or events. The last assessed health is preserved for
 * reporting.
 *
 * API compatibility projection (future implementation, not part of Phase 2)
 * ---------------------------------------------------------------------------
 * The existing frontend treats `warning` and `critical` as shipment statuses.
 * The API layer will therefore return:
 *
 *   {
 *     lifecycleStatus: 'in-transit',
 *     healthStatus: 'critical',
 *     displayStatus: 'critical'
 *   }
 *
 * Rules:
 *   1. displayStatus = status for draft, scheduled, delivered and archived.
 *   2. For in-transit shipments:
 *        healthStatus 'critical' -> displayStatus 'critical'
 *        healthStatus 'warning'  -> displayStatus 'warning'
 *        healthStatus 'unknown' or 'healthy' -> displayStatus 'in-transit'
 *   3. lifecycleStatus and healthStatus are always returned so consumers can
 *      distinguish real lifecycle from health-derived display state.
 *   4. A future adapter may map displayStatus onto the legacy `status` key.
 *
 * No frontend file is modified by the model layer.
 */

const COMPLETION_REQUIRED_STATUSES = ['delivered', 'archived']
const ARCHIVE_STATUS = 'archived'

// Sensors that reject negative thresholds. Temperature legitimately supports
// negative values, so it is not in this list.
const NON_NEGATIVE_SENSOR_IDS = new Set(['humidity', 'shock', 'light', 'ethylene'])

function requiredUnlessDraft() {
  return this.ownerDocument()?.status !== 'draft'
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeIntegerOrNull(value) {
  return (
    value === null ||
    value === undefined ||
    (Number.isInteger(value) && value >= 0)
  )
}

function createThresholdBoundPath(sensorId) {
  return {
    type: Number,
    default: null,
    validate: {
      validator(value) {
        if (value === null || value === undefined) return true
        if (!isFiniteNumber(value)) return false
        if (sensorId === 'humidity') return value >= 0 && value <= 100
        if (NON_NEGATIVE_SENSOR_IDS.has(sensorId)) return value >= 0
        return true
      },
      message: (props) =>
        `${SENSOR_CATALOG[sensorId].label} threshold ${props.value} is outside the allowed range.`,
    },
  }
}

/**
 * Warning or critical range for a numeric sensor. Both bounds are optional
 * individually: a range may have only a lower bound, only an upper bound, or
 * both. The reusable helper in `validation/monitoring.js` owns the cross-field
 * ordering rules.
 */
function createNumericThresholdSchema(sensorId) {
  return new Schema(
    {
      min: createThresholdBoundPath(sensorId),
      max: createThresholdBoundPath(sensorId),
    },
    { _id: false },
  )
}

function createDoorThresholdSchema() {
  return new Schema(
    {
      maxOpenMinutes: {
        type: Number,
        default: null,
        validate: {
          validator: (value) =>
            value === null ||
            value === undefined ||
            (Number.isInteger(value) && value > 0),
          message:
            'Door duration must be a positive whole number of minutes.',
        },
      },
    },
    { _id: false },
  )
}

function createNumericMonitorSchema(sensorId) {
  return new Schema(
    {
      available: { type: Boolean, default: false },
      enabled: { type: Boolean, default: false },
      warning: {
        type: createNumericThresholdSchema(sensorId),
        default: null,
      },
      critical: {
        type: createNumericThresholdSchema(sensorId),
        default: null,
      },
      escalationMinutes: {
        type: Number,
        default: null,
        validate: {
          validator: isNonNegativeIntegerOrNull,
          message:
            'Escalation time must be a non-negative whole number of minutes.',
        },
      },
    },
    { _id: false },
  )
}

function createDoorMonitorSchema() {
  return new Schema(
    {
      available: { type: Boolean, default: false },
      enabled: { type: Boolean, default: false },
      expectedState: {
        type: String,
        enum: ['open', 'closed'],
        default: null,
      },
      warning: {
        type: createDoorThresholdSchema(),
        default: null,
      },
      critical: {
        type: createDoorThresholdSchema(),
        default: null,
      },
      escalationMinutes: {
        type: Number,
        default: 0,
        validate: {
          validator: isNonNegativeIntegerOrNull,
          message:
            'Escalation time must be a non-negative whole number of minutes.',
        },
      },
    },
    { _id: false },
  )
}

function createMonitoringSchema() {
  const paths = {}

  SENSOR_IDS.forEach((sensorId) => {
    paths[sensorId] = {
      type:
        SENSOR_CATALOG[sensorId].kind === 'state'
          ? createDoorMonitorSchema()
          : createNumericMonitorSchema(sensorId),
      default: () => ({}),
    }
  })

  return new Schema(paths, { _id: false })
}

const offlineAlertSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    afterMinutes: {
      type: Number,
      default: 10,
      validate: {
        validator(value) {
          return !this.enabled || (isFiniteNumber(value) && value > 0)
        },
        message:
          'Offline delay must be greater than 0 minutes while the alert is enabled.',
      },
    },
  },
  { _id: false },
)

const batteryAlertSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    thresholdPercent: {
      type: Number,
      default: 20,
      validate: {
        validator(value) {
          return (
            !this.enabled ||
            (isFiniteNumber(value) && value >= 0 && value <= 100)
          )
        },
        message:
          'Battery threshold must be between 0 and 100% while the alert is enabled.',
      },
    },
  },
  { _id: false },
)

const toggleAlertSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
)

const systemAlertsSchema = new Schema(
  {
    offline: { type: offlineAlertSchema, default: () => ({}) },
    battery: { type: batteryAlertSchema, default: () => ({}) },
    sensorFault: { type: toggleAlertSchema, default: () => ({}) },
    selfTest: { type: toggleAlertSchema, default: () => ({}) },
  },
  { _id: false },
)

const cargoSchema = new Schema(
  {
    category: {
      type: String,
      enum: CARGO_CATEGORIES,
      required: [requiredUnlessDraft, 'Cargo category is required.'],
    },
    produce: {
      type: String,
      trim: true,
      default: '',
      required: [requiredUnlessDraft, 'Produce name is required.'],
    },
    quantity: {
      type: Number,
      default: 0,
      min: [0, 'Cargo quantity cannot be negative.'],
      validate: {
        validator: (value) => value === null || isFiniteNumber(value),
        message: 'Cargo quantity must be a valid number.',
      },
    },
    unit: {
      type: String,
      enum: QUANTITY_UNITS,
      default: 'kg',
      required: [requiredUnlessDraft, 'Quantity unit is required.'],
    },
    batch: { type: String, trim: true, default: '' },
  },
  { _id: false },
)

const routeSchema = new Schema(
  {
    origin: {
      type: String,
      trim: true,
      default: '',
      required: [requiredUnlessDraft, 'Route origin is required.'],
    },
    destination: {
      type: String,
      trim: true,
      default: '',
      required: [requiredUnlessDraft, 'Route destination is required.'],
    },
    carrier: { type: String, trim: true, default: '' },
    // Free-form on purpose: the UI prints values such as
    // "Reefer Truck · TR-104".
    vehicle: { type: String, trim: true, default: '' },
    departure: {
      type: Date,
      default: null,
      required: [requiredUnlessDraft, 'Departure time is required.'],
    },
    arrival: {
      type: Date,
      default: null,
      required: [requiredUnlessDraft, 'Arrival time is required.'],
      validate: {
        validator(value) {
          if (value === null || value === undefined) return true
          if (this.departure === null || this.departure === undefined) return true
          return value.getTime() >= this.departure.getTime()
        },
        message: 'Arrival cannot be before departure.',
      },
    },
    deadline: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          if (value === null || value === undefined) return true
          if (this.arrival === null || this.arrival === undefined) return true
          return value.getTime() >= this.arrival.getTime()
        },
        message: 'Deadline cannot be before arrival.',
      },
    },
    distanceKm: {
      type: Number,
      default: null,
      min: [0, 'Route distance cannot be negative.'],
      validate: {
        validator: (value) => value === null || isFiniteNumber(value),
        message: 'Route distance must be a valid number.',
      },
    },
    progress: {
      type: Number,
      default: 0,
      min: [0, 'Route progress cannot be below 0%.'],
      max: [100, 'Route progress cannot exceed 100%.'],
    },
  },
  { _id: false },
)

const timelineEventSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    tone: {
      type: String,
      enum: SHIPMENT_TIMELINE_TONES,
      default: 'info',
    },
    occurredAt: { type: Date, required: true },
  },
  { _id: false },
)

const shipmentSchema = new Schema(
  {
    shipmentId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: [1, 'Shipment id cannot be empty.'],
      maxlength: [40, 'Shipment id cannot exceed 40 characters.'],
    },

    // Lifecycle only. Never stores cargo health.
    status: {
      type: String,
      enum: SHIPMENT_LIFECYCLE_STATUSES,
      default: 'draft',
      required: true,
    },

    // Cargo health only. Starts unknown until a service supplies evidence.
    healthStatus: {
      type: String,
      enum: SHIPMENT_HEALTH_STATUSES,
      default: 'unknown',
      required: true,
    },

    cargo: { type: cargoSchema, default: () => ({}), required: true },
    route: { type: routeSchema, default: () => ({}), required: true },

    // Cross-field monitoring rules (enabled/available, threshold ordering,
    // door durations) live in validation/monitoring.js. Services call those
    // pure helpers before saving; the schema intentionally has no hooks.
    monitoring: {
      type: createMonitoringSchema(),
      default: () => ({}),
      required: true,
    },
    systemAlerts: {
      type: systemAlertsSchema,
      default: () => ({}),
      required: true,
    },

    // Retained after delivery/archive so history keeps its device reference.
    device: {
      type: Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
      required: [
        function () {
          return COMPLETION_REQUIRED_STATUSES.includes(this.status)
        },
        'Completion time is required for delivered or archived shipments.',
      ],
    },
    archivedAt: {
      type: Date,
      default: null,
      required: [
        function () {
          return this.status === ARCHIVE_STATUS
        },
        'Archive time is required for archived shipments.',
      ],
    },
    completionSource: {
      type: String,
      enum: COMPLETION_SOURCES,
      default: null,
    },

    timeline: { type: [timelineEventSchema], default: [] },

    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
)

shipmentSchema.index({ status: 1, createdAt: -1 })
shipmentSchema.index({ healthStatus: 1, createdAt: -1 })
shipmentSchema.index({ device: 1, status: 1 })
shipmentSchema.index({ 'cargo.category': 1 })

/*
 * At most one operational shipment (scheduled or in-transit) may reserve a
 * device. Drafts, delivered and archived history are excluded so the same
 * hardware can be reused after delivery while history keeps its reference.
 *
 * The service layer still performs a friendly pre-check, but this index is the
 * authoritative concurrency guard: two simultaneous assignments race on the
 * same key and the loser receives a 409 DEVICE_BUSY conflict.
 */
shipmentSchema.index(
  { device: 1 },
  {
    unique: true,
    name: 'operational_device_unique',
    partialFilterExpression: {
      status: { $in: ['scheduled', 'in-transit'] },
      device: { $type: 'objectId' },
    },
  },
)

module.exports =
  mongoose.models.Shipment || mongoose.model('Shipment', shipmentSchema)
