const mongoose = require('mongoose')

const { Schema } = mongoose

/**
 * SensorReading model.
 *
 * One document per complete sample. Units are defined once in
 * `constants/sensors.js`; readings never repeat them.
 *
 * Multiple packets may legitimately share the same `recordedAt`, so there is
 * deliberately no unique `{ device, recordedAt }` index. Readings are retained
 * forever: no TTL index is defined.
 */

const MEASUREMENT_FIELDS = [
  'temperature',
  'humidity',
  'shock',
  'light',
  'ethylene',
  'doorOpen',
]

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function numericMeasurement(min, max, message) {
  const path = {
    type: Number,
    validate: {
      validator: (value) => value === undefined || value === null || isFiniteNumber(value),
      message: 'Measurement must be a valid number.',
    },
  }

  if (min !== undefined) {
    path.min = [min, message]
  }
  if (max !== undefined) {
    path.max = [max, message]
  }

  return path
}

function hasAtLeastOneMeasurement() {
  return MEASUREMENT_FIELDS.some((field) => {
    const value = this[field]
    return value !== undefined && value !== null
  })
}

const sensorReadingSchema = new Schema(
  {
    shipment: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    device: {
      type: Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },

    // Device timestamp. Not unique: duplicate timestamps are legitimate.
    recordedAt: {
      type: Date,
      required: true,
      validate: {
        validator: hasAtLeastOneMeasurement,
        message: 'A sensor reading needs at least one measurement value.',
      },
    },

    temperature: numericMeasurement(),
    humidity: numericMeasurement(0, 100, 'Humidity must be between 0 and 100%.'),
    shock: numericMeasurement(0, undefined, 'Shock cannot be negative.'),
    light: numericMeasurement(0, undefined, 'Light intensity cannot be negative.'),
    ethylene: numericMeasurement(0, undefined, 'Ethylene cannot be negative.'),

    // true means the cargo door is open.
    doorOpen: { type: Boolean },

    /*
     * Ingestion flags. These are derived by the reading service, never
     * supplied by a device:
     *
     *   late             - accepted through the historical late-reading path
     *                      for a completed or archived shipment.
     *   lateReason       - why the historical path was used.
     *   outOfOrder       - recordedAt predates a reading already stored for
     *                      the same shipment.
     *   stale            - received long after the device timestamp.
     *   evaluationSkipped - cargo threshold evaluation must not run.
     *   skipReason       - machine-readable reason for the skip.
     */
    late: { type: Boolean, default: false },
    lateReason: {
      type: String,
      enum: ['completed-shipment', null],
      default: null,
    },
    outOfOrder: { type: Boolean, default: false },
    stale: { type: Boolean, default: false },
    evaluationSkipped: { type: Boolean, default: false },
    skipReason: {
      type: String,
      enum: ['late-completed-shipment', 'out-of-order', 'stale', 'pre-departure', null],
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

sensorReadingSchema.index({ shipment: 1, recordedAt: -1 })
sensorReadingSchema.index({ device: 1, recordedAt: -1 })
sensorReadingSchema.index({ shipment: 1, evaluationSkipped: 1, recordedAt: -1 })

module.exports =
  mongoose.models.SensorReading ||
  mongoose.model('SensorReading', sensorReadingSchema)
