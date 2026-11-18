const mongoose = require('mongoose')

const { Schema } = mongoose

const {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_SOURCES,
  SYSTEM_ALERT_TYPES,
  ALERT_PARAMETERS,
} = require('../constants/enums')

/**
 * Alert model.
 *
 * Alerts are never resolved or deleted when a shipment is delivered or
 * archived. Status transitions belong to the future alert service.
 *
 * `alertCode` is optional. It uses a partial unique index restricted to string
 * values so many alerts can omit a code without colliding on null/''. The
 * setter normalises null/'' to `undefined`; clearing an existing code must use
 * `$unset`.
 */

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

const thresholdSnapshotSchema = new Schema(
  {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    maxOpenMinutes: { type: Number, default: null },
  },
  { _id: false },
)

const alertSchema = new Schema(
  {
    alertCode: {
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
        message: 'Alert code cannot be blank.',
      },
    },

    /*
     * Internal episode identity for one unresolved breach. A partial unique
     * index makes concurrent ingestion unable to create duplicate episodes.
     * Resolution unsets this value so a later breach can start a new episode.
     */
    episodeKey: {
      type: String,
      trim: true,
      default: undefined,
      set(value) {
        if (value === null || value === undefined) return undefined
        const text = String(value).trim()
        return text === '' ? undefined : text
      },
    },

    shipment: {
      type: Schema.Types.ObjectId,
      ref: 'Shipment',
      required: true,
    },
    device: {
      type: Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },

    source: {
      type: String,
      enum: ALERT_SOURCES,
      required: true,
    },
    systemType: {
      type: String,
      enum: SYSTEM_ALERT_TYPES,
      default: null,
      required: [
        function () {
          return this.source === 'system'
        },
        'System alerts require a system type.',
      ],
    },

    // Cargo alerts use a sensor id; device/system alerts use `device`.
    parameter: {
      type: String,
      enum: ALERT_PARAMETERS,
      required: true,
    },

    severity: {
      type: String,
      enum: ALERT_SEVERITIES,
      required: true,
    },

    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    // Reading value, open-door minutes or battery percent, depending on the
    // alert parameter.
    triggerValue: {
      type: Number,
      default: null,
      validate: {
        validator: (value) => value === null || isFiniteNumber(value),
        message: 'Trigger value must be a valid number.',
      },
    },
    threshold: { type: thresholdSnapshotSchema, default: null },
    peakValue: {
      type: Number,
      default: null,
      validate: {
        validator: (value) => value === null || isFiniteNumber(value),
        message: 'Peak value must be a valid number.',
      },
    },

    startedAt: { type: Date, required: true },
    acknowledgedAt: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          if (value === null || value === undefined) return true
          if (this.startedAt === null || this.startedAt === undefined) return true
          return value.getTime() >= this.startedAt.getTime()
        },
        message: 'Acknowledgement cannot be before the alert started.',
      },
    },
    recoveredAt: {
      type: Date,
      default: null,
      validate: {
        validator(value) {
          if (value === null || value === undefined) return true
          if (this.startedAt === null || this.startedAt === undefined) return true
          return value.getTime() >= this.startedAt.getTime()
        },
        message: 'Recovery cannot be before the alert started.',
      },
    },
    resolvedAt: {
      type: Date,
      default: null,
      required: [
        function () {
          return this.status === 'resolved'
        },
        'Resolved alerts require a resolution timestamp.',
      ],
      validate: {
        validator(value) {
          if (value === null || value === undefined) return true
          if (this.startedAt === null || this.startedAt === undefined) return true
          return value.getTime() >= this.startedAt.getTime()
        },
        message: 'Resolution cannot be before the alert started.',
      },
    },

    status: {
      type: String,
      enum: ALERT_STATUSES,
      default: 'active',
      required: true,
      validate: {
        validator(value) {
          if (this.resolvedAt === null || this.resolvedAt === undefined) {
            return true
          }
          return value === 'resolved'
        },
        message: 'A resolution timestamp requires the alert status to be resolved.',
      },
    },

    // Free text until authentication exists.
    resolutionNote: { type: String, trim: true, default: '' },
    resolvedBy: { type: String, trim: true, default: '' },

    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
)

alertSchema.index({ shipment: 1, status: 1, startedAt: -1 })
alertSchema.index({ status: 1, severity: 1, startedAt: -1 })
alertSchema.index({ device: 1, startedAt: -1 })

// Partial unique index: only string codes are indexed. Missing codes and
// explicit nulls are excluded.
alertSchema.index(
  { alertCode: 1 },
  {
    unique: true,
    name: 'alertCode_unique_string',
    partialFilterExpression: { alertCode: { $type: 'string' } },
  },
)

// Only unresolved episodes carry an episodeKey, so one condition can never
// produce two open alerts while resolved history is free to reuse the key.
alertSchema.index(
  { episodeKey: 1 },
  {
    unique: true,
    name: 'alert_episode_unique',
    partialFilterExpression: { episodeKey: { $type: 'string' } },
  },
)

module.exports = mongoose.models.Alert || mongoose.model('Alert', alertSchema)
