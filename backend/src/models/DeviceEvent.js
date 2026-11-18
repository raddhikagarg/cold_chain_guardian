const mongoose = require('mongoose')

const { Schema } = mongoose

const { SENSOR_IDS } = require('../constants/sensors')
const { DEVICE_EVENT_TYPES, ALERT_SEVERITIES } = require('../constants/enums')

/**
 * DeviceEvent model.
 *
 * Records device-level history: connectivity changes, sensor disconnection or
 * malfunction, power and self-test results, firmware and maintenance work, and
 * assignment/release activity.
 *
 * Device events never change `Shipment.healthStatus` directly.
 */

const deviceEventSchema = new Schema(
  {
    device: {
      type: Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
    },
    shipment: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      default: null,
    },

    type: {
      type: String,
      enum: DEVICE_EVENT_TYPES,
      required: true,
    },
    sensor: {
      type: String,
      enum: SENSOR_IDS,
      default: null,
    },
    severity: {
      type: String,
      enum: ALERT_SEVERITIES,
      default: 'info',
    },

    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },

    occurredAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
)

deviceEventSchema.index({ device: 1, occurredAt: -1 })
deviceEventSchema.index({ shipment: 1, occurredAt: -1 })
deviceEventSchema.index({ type: 1, occurredAt: -1 })

module.exports =
  mongoose.models.DeviceEvent ||
  mongoose.model('DeviceEvent', deviceEventSchema)
