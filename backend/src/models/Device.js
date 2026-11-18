const mongoose = require('mongoose')

const { Schema } = mongoose

const { SENSOR_IDS } = require('../constants/sensors')
const {
  DEVICE_STATUSES,
  SENSOR_HEALTH_STATUSES,
  OPERATIONAL_SHIPMENT_STATUSES,
} = require('../constants/enums')

/**
 * Device model.
 *
 * The device does not store `assignedShipment`. Assignment is a virtual over
 * operational shipments only (scheduled, in-transit), so drafts and completed
 * or archived history can never look like a live assignment.
 *
 * At most one operational shipment may use a device. That is a future service
 * invariant enforced inside a transaction by the assignment/scheduling
 * service, not a database hook in Phase 2.
 *
 * Device health is independent from `Shipment.healthStatus`. An unhealthy
 * device does not mark cargo unhealthy.
 */

const sensorHealthSchema = new Schema(
  {
    sensorId: {
      type: String,
      enum: SENSOR_IDS,
      required: true,
    },
    status: {
      type: String,
      enum: SENSOR_HEALTH_STATUSES,
      required: true,
    },
    lastSelfTestAt: { type: Date, default: null },
    note: { type: String, trim: true, default: '' },
  },
  { _id: false },
)

const hardwareSchema = new Schema(
  {
    board: { type: String, trim: true, default: '' },
    chip: { type: String, trim: true, default: '' },
    revision: { type: String, trim: true, default: '' },
    // Optional identity. Normalised to `undefined` so an unset or empty serial
    // is never stored as null/'' and never participates in the partial unique
    // index. Clearing an existing serial must use `$unset`.
    serial: {
      type: String,
      trim: true,
      default: undefined,
      set(value) {
        if (value === null || value === undefined) return undefined
        const text = String(value).trim()
        return text === '' ? undefined : text
      },
      validate: {
        validator: (value) => value === undefined || /\S/.test(value),
        message: 'Hardware serial cannot be blank.',
      },
    },
    mac: { type: String, trim: true, default: '' },
    installedAt: { type: Date, default: null },
    flash: { type: String, trim: true, default: '' },
    powerSource: { type: String, trim: true, default: '' },
  },
  { _id: false },
)

const deviceSchema = new Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: DEVICE_STATUSES,
      default: 'offline',
      required: true,
    },

    // Free-form labels kept as strings; the UI renders them directly.
    connectivity: { type: String, trim: true, default: 'Wi-Fi' },
    signal: { type: String, trim: true, default: '—' },
    signalDbm: {
      type: Number,
      default: null,
      min: [-120, 'Signal strength cannot be below -120 dBm.'],
      max: [0, 'Signal strength cannot be above 0 dBm.'],
    },
    battery: {
      type: Number,
      default: null,
      min: [0, 'Battery level cannot be below 0%.'],
      max: [100, 'Battery level cannot exceed 100%.'],
    },
    firmware: { type: String, trim: true, default: '' },

    sensors: {
      type: [{ type: String, enum: SENSOR_IDS }],
      default: [],
    },
    sensorHealth: { type: [sensorHealthSchema], default: [] },

    lastSeenAt: { type: Date, default: null },
    lastBootAt: { type: Date, default: null },

    hardware: { type: hardwareSchema, default: () => ({}) },
  },
  { timestamps: true },
)

/**
 * Live assignment. Populate explicitly; `.lean()` will not return virtuals.
 * Only scheduled and in-transit shipments count as assignments.
 */
deviceSchema.virtual('assignedShipment', {
  ref: 'Shipment',
  localField: '_id',
  foreignField: 'device',
  justOne: true,
  match: { status: { $in: OPERATIONAL_SHIPMENT_STATUSES } },
})

deviceSchema.set('toJSON', { virtuals: true })
deviceSchema.set('toObject', { virtuals: true })

deviceSchema.index({ status: 1 })
deviceSchema.index({ sensors: 1 })

// Partial unique index: only string serials are indexed. Missing serials and
// explicit nulls are excluded, so devices without a serial can coexist.
deviceSchema.index(
  { 'hardware.serial': 1 },
  {
    unique: true,
    name: 'hardware_serial_unique_string',
    partialFilterExpression: { 'hardware.serial': { $type: 'string' } },
  },
)

module.exports =
  mongoose.models.Device || mongoose.model('Device', deviceSchema)
