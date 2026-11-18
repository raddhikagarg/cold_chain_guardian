import { useState } from 'react'
import FormSection from './FormSection.jsx'
import MonitoringRequirements from './MonitoringRequirements.jsx'
import DeviceAssignment from './DeviceAssignment.jsx'
import AlertConfiguration from './AlertConfiguration.jsx'
import { ArrowLeftIcon, PlusIcon } from '../icons.jsx'
import {
  CARGO_CATEGORIES,
  PRODUCE_OPTIONS,
  QUANTITY_UNITS,
  SENSOR_CATALOG,
  SENSOR_IDS,
  VEHICLE_TYPES,
} from '../../data/shipmentData.js'
import { generateShipmentId, getDeviceAvailability } from '../../utils/shipments.js'
import './ShipmentForm.css'

const isNumber = (value) =>
  value !== '' && value != null && Number.isFinite(Number(value))

const toNumberOrNull = (value) => {
  if (value === '' || value == null) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toBounds(minValue, maxValue) {
  const min = toNumberOrNull(minValue)
  const max = toNumberOrNull(maxValue)
  if (min == null && max == null) return null
  return {
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
  }
}

const hasValue = (value) => value !== '' && value != null

const NON_NEGATIVE_SENSORS = new Set(['humidity', 'shock', 'light', 'ethylene'])

/**
 * Validate the thresholds for every selected parameter. When a device is
 * assigned, only sensors fitted on that device are validated. Without a device
 * we still validate the operator's selections so threshold errors are not
 * silently skipped. Low-side limits may stay blank; warning and critical limits
 * must never overlap on the same side.
 */
function validateCargoThresholds(form, device) {
  const errors = []
  const enabledSensors = SENSOR_IDS.filter(
    (sensorId) =>
      form.monitoring[sensorId]?.enabled &&
      (!device || device.sensors?.includes(sensorId)),
  )

  enabledSensors.forEach((sensorId) => {
    const meta = SENSOR_CATALOG[sensorId]
    const config = form.monitoring[sensorId]

    if (meta.kind === 'state') {
      if (config.expectedState !== 'open' && config.expectedState !== 'closed') {
        errors.push(`Select the expected state for ${meta.label}.`)
      }

      const warningRaw = config.warningOpenMinutes
      const criticalRaw = config.criticalOpenMinutes
      const warning =
        hasValue(warningRaw) && isNumber(warningRaw)
          ? Number(warningRaw)
          : null
      const critical =
        hasValue(criticalRaw) && isNumber(criticalRaw)
          ? Number(criticalRaw)
          : null

      if (!hasValue(warningRaw)) {
        errors.push(`Enter a warning duration for ${meta.label}.`)
      } else if (warning == null || !Number.isInteger(warning) || warning <= 0) {
        errors.push(
          `${meta.label} warning duration must be a positive whole number of minutes.`,
        )
      }

      if (!hasValue(criticalRaw)) {
        errors.push(`Enter a critical duration for ${meta.label}.`)
      } else if (critical == null || !Number.isInteger(critical) || critical <= 0) {
        errors.push(
          `${meta.label} critical duration must be a positive whole number of minutes.`,
        )
      }

      if (warning != null && critical != null && critical <= warning) {
        errors.push(
          `${meta.label} critical duration must be longer than the warning duration.`,
        )
      }
      return
    }

    const thresholdFields = [
      ['Warning Low', config.warning.min],
      ['Warning High', config.warning.max],
      ['Critical Low', config.critical.min],
      ['Critical High', config.critical.max],
    ]

    thresholdFields.forEach(([label, value]) => {
      if (!hasValue(value)) return
      if (!isNumber(value)) {
        errors.push(`${label} for ${meta.label} must be a valid number.`)
        return
      }
      if (NON_NEGATIVE_SENSORS.has(sensorId) && Number(value) < 0) {
        errors.push(`${label} for ${meta.label} cannot be negative.`)
      }
      if (sensorId === 'humidity' && Number(value) > 100) {
        errors.push(`${label} for ${meta.label} cannot exceed 100%.`)
      }
    })

    if (!hasValue(config.warning.min) && !hasValue(config.warning.max)) {
      errors.push(
        `Enter at least one warning limit (Warning Low or Warning High) for ${meta.label}.`,
      )
    }

    const warningLow =
      hasValue(config.warning.min) && isNumber(config.warning.min)
        ? Number(config.warning.min)
        : null
    const warningHigh =
      hasValue(config.warning.max) && isNumber(config.warning.max)
        ? Number(config.warning.max)
        : null
    const criticalLow =
      hasValue(config.critical.min) && isNumber(config.critical.min)
        ? Number(config.critical.min)
        : null
    const criticalHigh =
      hasValue(config.critical.max) && isNumber(config.critical.max)
        ? Number(config.critical.max)
        : null

    if (warningLow != null && warningHigh != null && warningLow >= warningHigh) {
      errors.push(
        `${meta.label} Warning Low must be below Warning High.`,
      )
    }
    if (criticalLow != null && warningLow != null && criticalLow >= warningLow) {
      errors.push(
        `${meta.label} Critical Low must be below Warning Low.`,
      )
    }
    if (
      criticalHigh != null &&
      warningHigh != null &&
      criticalHigh <= warningHigh
    ) {
      errors.push(
        `${meta.label} Critical High must be above Warning High.`,
      )
    }
    if (criticalLow != null && criticalHigh != null && criticalLow >= criticalHigh) {
      errors.push(
        `${meta.label} Critical Low must be below Critical High.`,
      )
    }

    if (hasValue(config.escalationMinutes)) {
      if (
        !isNumber(config.escalationMinutes) ||
        Number(config.escalationMinutes) < 0
      ) {
        errors.push(
          `${meta.label} escalation time must be a non-negative number of minutes.`,
        )
      }
    }
  })

  return errors
}

function validateSystemAlerts(systemAlerts) {
  const errors = []

  if (systemAlerts.offline.enabled) {
    const value = systemAlerts.offline.afterMinutes
    if (!hasValue(value) || !isNumber(value) || Number(value) <= 0) {
      errors.push(
        'Enter an ESP32 offline delay greater than 0 minutes, or disable the offline alert.',
      )
    }
  }

  if (systemAlerts.battery.enabled) {
    const value = systemAlerts.battery.thresholdPercent
    if (
      !hasValue(value) ||
      !isNumber(value) ||
      Number(value) < 1 ||
      Number(value) > 100
    ) {
      errors.push(
        'Enter a low-battery threshold between 1% and 100%, or disable the low-battery alert.',
      )
    }
  }

  return errors
}

function createMonitoringState() {
  return Object.fromEntries(
    SENSOR_IDS.map((sensorId) => [
      sensorId,
      {
        // Nothing is monitored until the operator selects it. A fitted sensor
        // must never select a parameter on the operator's behalf.
        enabled: false,
        expectedState: '',
        warning: { min: '', max: '' },
        critical: { min: '', max: '' },
        warningOpenMinutes: '',
        criticalOpenMinutes: '',
        escalationMinutes: '',
      },
    ]),
  )
}

function createInitialForm(shipments) {
  return {
    id: generateShipmentId(shipments),
    category: 'fruits',
    produce: '',
    quantity: '',
    unit: 'kg',
    batch: '',
    origin: '',
    destination: '',
    carrier: '',
    vehicle: 'Reefer Truck',
    departure: '',
    arrival: '',
    deadline: '',
    deviceId: '',
    monitoring: createMonitoringState(),
    systemAlerts: {
      offline: { enabled: true, afterMinutes: '10' },
      battery: { enabled: true, thresholdPercent: '20' },
      sensorFault: { enabled: true },
      selfTest: { enabled: true },
    },
  }
}

function Field({ label, hint, required, children }) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  )
}

function buildMonitoring(form, device) {
  return Object.fromEntries(
    SENSOR_IDS.map((sensorId) => {
      const config = form.monitoring[sensorId]
      const available = Boolean(device?.sensors?.includes(sensorId))
      const enabled = available && config.enabled

      // Disabled parameters keep availability information only. Stale warning
      // or critical values must not be persisted as active configuration.
      if (!enabled) {
        return [
          sensorId,
          {
            available,
            enabled: false,
            expectedState: null,
            warning: null,
            critical: null,
            escalationMinutes: null,
          },
        ]
      }

      if (SENSOR_CATALOG[sensorId].kind === 'state') {
        const warningOpen = toNumberOrNull(config.warningOpenMinutes)
        const criticalOpen = toNumberOrNull(config.criticalOpenMinutes)
        return [
          sensorId,
          {
            available,
            enabled,
            expectedState: config.expectedState || null,
            warning: warningOpen != null ? { maxOpenMinutes: warningOpen } : null,
            critical: criticalOpen != null ? { maxOpenMinutes: criticalOpen } : null,
            escalationMinutes: 0,
          },
        ]
      }

      return [
        sensorId,
        {
          available,
          enabled,
          warning: toBounds(config.warning.min, config.warning.max),
          critical: toBounds(config.critical.min, config.critical.max),
          escalationMinutes: toNumberOrNull(config.escalationMinutes),
        },
      ]
    }),
  )
}

function buildSystemAlerts(systemAlerts) {
  return {
    offline: {
      enabled: Boolean(systemAlerts.offline.enabled),
      afterMinutes: toNumberOrNull(systemAlerts.offline.afterMinutes),
    },
    battery: {
      enabled: Boolean(systemAlerts.battery.enabled),
      thresholdPercent: toNumberOrNull(systemAlerts.battery.thresholdPercent),
    },
    sensorFault: { enabled: Boolean(systemAlerts.sensorFault.enabled) },
    selfTest: { enabled: Boolean(systemAlerts.selfTest?.enabled) },
  }
}

function buildShipment(form, status, device) {
  const now = new Date().toISOString()
  const draft = status === 'draft'

  return {
    id: form.id.trim(),
    status,
    cargo: {
      category: form.category,
      produce: form.produce,
      quantity: toNumberOrNull(form.quantity) ?? 0,
      unit: form.unit,
      batch: form.batch.trim(),
    },
    route: {
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      carrier: form.carrier.trim(),
      vehicle: form.vehicle,
      departure: form.departure,
      arrival: form.arrival,
      deadline: form.deadline,
      distanceKm: null,
      progress: 0,
    },
    monitoring: buildMonitoring(form, device),
    systemAlerts: buildSystemAlerts(form.systemAlerts),
    deviceId: device?.id ?? null,
    createdAt: now,
    alerts: [],
    incidents: [],
    timeline: [
      {
        id: 'TL-created',
        time: now,
        title: draft ? 'Draft created' : 'Shipment scheduled',
        description: draft
          ? 'Complete the requirements and assign a device when ready.'
          : `Monitoring begins at departure${device ? ` with ${device.id}` : ''}.`,
        tone: draft ? 'muted' : 'info',
      },
    ],
    exposure: {
      temperatureMinutesOutOfRange: 0,
      humidityMinutesOutOfRange: 0,
      shockEvents: 0,
      peakShockG: null,
      doorOpenSeconds: 0,
      peakEthylenePpm: null,
      avgLightLux: null,
    },
    mockProfile: {},
  }
}

function validateIdentity(form, shipments) {
  const errors = []
  const id = form.id.trim()
  if (!id) {
    errors.push('Shipment ID is required.')
  } else if (
    shipments.some(
      (shipment) => shipment.id.toLowerCase() === id.toLowerCase(),
    )
  ) {
    errors.push(`Shipment ID "${id}" is already in use.`)
  }
  return errors
}

function ShipmentForm({ shipments, devices, onCreate, onSaveDraft, onCancel }) {
  const [form, setForm] = useState(() => createInitialForm(shipments))
  const [errors, setErrors] = useState([])

  const devicesWithState = getDeviceAvailability(devices, shipments)
  const selectedDevice =
    devicesWithState.find((device) => device.id === form.deviceId) ?? null

  const updateField = (field) => (event) => {
    const value = event.target.value
    setForm((previous) => ({ ...previous, [field]: value }))
  }

  const handleCategoryChange = (event) => {
    const category = event.target.value
    setForm((previous) => ({ ...previous, category, produce: '' }))
  }

  const handleMonitoringChange = (sensorId, patch) => {
    setForm((previous) => ({
      ...previous,
      monitoring: {
        ...previous.monitoring,
        [sensorId]: { ...previous.monitoring[sensorId], ...patch },
      },
    }))
  }

  const handleSystemChange = (key, patch) => {
    setForm((previous) => ({
      ...previous,
      systemAlerts: {
        ...previous.systemAlerts,
        [key]: { ...previous.systemAlerts[key], ...patch },
      },
    }))
  }

  /**
   * Changing the assigned device can change which sensors are fitted. Clear any
   * selection that the new device cannot support so the checkbox, availability
   * label and cargo threshold card always agree with each other.
   */
  const handleDeviceChange = (deviceId) => {
    setForm((previous) => {
      const nextDevice = deviceId
        ? (devicesWithState.find((device) => device.id === deviceId) ?? null)
        : null
      const nextMonitoring = { ...previous.monitoring }

      SENSOR_IDS.forEach((sensorId) => {
        const available = Boolean(nextDevice?.sensors?.includes(sensorId))
        if (!available && nextMonitoring[sensorId].enabled) {
          nextMonitoring[sensorId] = {
            ...nextMonitoring[sensorId],
            enabled: false,
          }
        }
      })

      return { ...previous, deviceId, monitoring: nextMonitoring }
    })
  }

  const validateForCreate = () => {
    const validationErrors = validateIdentity(form, shipments)

    if (!form.produce) validationErrors.push('Select a specific fruit or vegetable.')
    if (!(Number(form.quantity) > 0)) {
      validationErrors.push('Enter a quantity greater than 0.')
    }
    if (!form.origin.trim()) validationErrors.push('Enter the origin location.')
    if (!form.destination.trim()) {
      validationErrors.push('Enter the destination location.')
    }
    if (!form.departure) validationErrors.push('Enter the planned departure time.')
    if (!form.arrival) validationErrors.push('Enter the expected arrival time.')
    if (form.departure && form.arrival && new Date(form.arrival) <= new Date(form.departure)) {
      validationErrors.push('Expected arrival must be after the planned departure.')
    }
    if (form.deadline && form.arrival && new Date(form.deadline) < new Date(form.arrival)) {
      validationErrors.push('Delivery deadline cannot be earlier than expected arrival.')
    }

    let assignedDevice = null
    if (!form.deviceId) {
      validationErrors.push(
        'Assign an available device to create the shipment, or save it as a draft.',
      )
    } else {
      assignedDevice =
        devicesWithState.find((item) => item.id === form.deviceId) ?? null
      if (!assignedDevice) {
        validationErrors.push('Select a valid device.')
      } else if (!assignedDevice.available) {
        validationErrors.push(
          `${assignedDevice.id} is no longer available. Choose another device or save as a draft.`,
        )
      }
    }

    if (assignedDevice) {
      const enabledSensors = SENSOR_IDS.filter(
        (sensorId) =>
          form.monitoring[sensorId].enabled &&
          assignedDevice.sensors.includes(sensorId),
      )
      if (enabledSensors.length === 0) {
        validationErrors.push('Enable at least one monitoring parameter.')
      }
    }

    // Validate cargo configuration even without a device so threshold mistakes
    // are surfaced instead of hidden behind the device-assignment error.
    validationErrors.push(...validateCargoThresholds(form, assignedDevice))

    validationErrors.push(...validateSystemAlerts(form.systemAlerts))

    return validationErrors
  }

  const handleCreate = (event) => {
    event.preventDefault()
    const validationErrors = validateForCreate()
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors([])
    onCreate(buildShipment(form, 'scheduled', selectedDevice))
  }

  const handleSaveDraft = () => {
    const validationErrors = validateIdentity(form, shipments)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors([])
    onSaveDraft(buildShipment(form, 'draft', selectedDevice))
  }

  const produceOptions = PRODUCE_OPTIONS[form.category] ?? []

  return (
    <div className="shipments-page">
      <div className="page-head">
        <div className="page-head__text">
          <button type="button" className="page-back" onClick={onCancel}>
            <ArrowLeftIcon size={15} />
            Back to shipments
          </button>
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            New cold-chain shipment
          </div>
          <h1 className="page-head__title">Add Shipment</h1>
          <p className="page-head__subtitle">
            Define the cargo, route and monitoring requirements. Fields marked{' '}
            <span className="field__required">*</span> are required to create an
            active shipment; drafts can be saved at any time.
          </p>
        </div>
      </div>

      <form className="shipment-form" onSubmit={handleCreate} noValidate>
        <FormSection
          step="A"
          title="Shipment information"
          description="Identify the consignment. The shipment ID is generated automatically but stays editable."
        >
          <div className="form-grid">
            <Field
              label="Shipment ID"
              required
              hint="Auto-generated — edit if your system uses another format."
            >
              <input
                type="text"
                className="field__input"
                value={form.id}
                onChange={updateField('id')}
                placeholder="SHP-0000"
              />
            </Field>

            <Field label="Cargo category">
              <select
                className="field__input"
                value={form.category}
                onChange={handleCategoryChange}
              >
                {CARGO_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Fruit or vegetable" required>
              <select
                className="field__input"
                value={form.produce}
                onChange={updateField('produce')}
              >
                <option value="">Select produce…</option>
                {produceOptions.map((produce) => (
                  <option key={produce} value={produce}>
                    {produce}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Quantity" required>
              <input
                type="number"
                min="0"
                step="any"
                className="field__input"
                value={form.quantity}
                onChange={updateField('quantity')}
                placeholder="e.g. 1200"
              />
            </Field>

            <Field label="Unit">
              <select
                className="field__input"
                value={form.unit}
                onChange={updateField('unit')}
              >
                {QUANTITY_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Batch / lot number" hint="Optional">
              <input
                type="text"
                className="field__input"
                value={form.batch}
                onChange={updateField('batch')}
                placeholder="e.g. LOT-2026-0001"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection
          step="B"
          title="Route and schedule"
          description="Where the shipment travels and when it must arrive."
        >
          <div className="form-grid">
            <Field label="Origin" required>
              <input
                type="text"
                className="field__input"
                value={form.origin}
                onChange={updateField('origin')}
                placeholder="City, region"
              />
            </Field>

            <Field label="Destination" required>
              <input
                type="text"
                className="field__input"
                value={form.destination}
                onChange={updateField('destination')}
                placeholder="City, region"
              />
            </Field>

            <Field label="Carrier">
              <input
                type="text"
                className="field__input"
                value={form.carrier}
                onChange={updateField('carrier')}
                placeholder="Carrier name"
              />
            </Field>

            <Field label="Vehicle / transport type">
              <select
                className="field__input"
                value={form.vehicle}
                onChange={updateField('vehicle')}
              >
                {VEHICLE_TYPES.map((vehicle) => (
                  <option key={vehicle} value={vehicle}>
                    {vehicle}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Planned departure" required>
              <input
                type="datetime-local"
                className="field__input"
                value={form.departure}
                onChange={updateField('departure')}
              />
            </Field>

            <Field label="Expected arrival" required>
              <input
                type="datetime-local"
                className="field__input"
                value={form.arrival}
                onChange={updateField('arrival')}
              />
            </Field>

            <Field label="Delivery deadline" hint="Optional">
              <input
                type="datetime-local"
                className="field__input"
                value={form.deadline}
                onChange={updateField('deadline')}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection
          step="C"
          title="Monitoring requirements"
          description="Select the parameters that matter for this shipment. Sensor availability only shows whether the assigned device has the sensor fitted — it does not select the parameter. Configure warning and critical cargo thresholds in Cargo Conditions & Alert Thresholds."
        >
          <MonitoringRequirements
            monitoring={form.monitoring}
            device={selectedDevice}
            onChange={handleMonitoringChange}
          />
        </FormSection>

        <FormSection
          step="D"
          title="Device assignment"
          description="Choose an online ESP32 that is not monitoring another active shipment. You may save a draft when no device is free."
        >
          <DeviceAssignment
            devices={devicesWithState}
            selectedId={form.deviceId}
            onSelect={handleDeviceChange}
          />
        </FormSection>

        <FormSection
          step="E"
          title="Cargo Conditions & Alert Thresholds"
          description="Warning and critical limits define when cargo conditions generate alerts. Only parameters selected for monitoring appear here. Hardware and connectivity alerts are configured separately from cargo thresholds."
        >
          <AlertConfiguration
            monitoring={form.monitoring}
            device={selectedDevice}
            systemAlerts={form.systemAlerts}
            onChange={handleMonitoringChange}
            onSystemChange={handleSystemChange}
          />
        </FormSection>

        {errors.length > 0 && (
          <div className="form-errors" role="alert">
            <strong>Please review the following:</strong>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-actions">
          <p className="form-actions__hint">
            Drafts do not reserve a device and are not counted as active
            shipments. This prototype stores everything in memory only.
          </p>
          <div className="form-actions__buttons">
            <button type="button" className="btn btn--ghost" onClick={handleSaveDraft}>
              Save as draft
            </button>
            <button type="submit" className="btn btn--primary">
              <PlusIcon size={16} />
              Create shipment
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

export default ShipmentForm