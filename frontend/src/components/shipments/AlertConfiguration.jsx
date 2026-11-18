import StatusBadge from '../StatusBadge.jsx'
import { SENSOR_IDS, SENSOR_CATALOG } from '../../data/shipmentData.js'
import { SENSOR_ICONS } from './sensorIcons.jsx'

function ThresholdInput({
  label,
  value,
  onChange,
  suffix,
  placeholder = '—',
  min,
  step = 'any',
}) {
  return (
    <label className="threshold-field">
      <span>{label}</span>
      <span className="threshold-field__control">
        <input
          type="number"
          className="field__input field__input--compact"
          step={step}
          min={min}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix && <span className="threshold-field__suffix">{suffix}</span>}
      </span>
    </label>
  )
}

/**
 * Cargo thresholds are only shown for parameters the operator selected in
 * Monitoring Requirements and that are fitted on the assigned device. Numeric
 * parameters use warning/critical low/high limits; door status uses an expected
 * state and warning/critical durations. System and device alerts stay separate
 * from cargo conditions.
 */
function AlertConfiguration({
  monitoring,
  device,
  systemAlerts,
  onChange,
  onSystemChange,
}) {
  const enabledSensors = SENSOR_IDS.filter(
    (id) =>
      monitoring[id]?.enabled && Boolean(device?.sensors?.includes(id)),
  )

  const updateBound = (sensorId, group, key, value) => {
    onChange(sensorId, {
      [group]: { ...monitoring[sensorId][group], [key]: value },
    })
  }

  return (
    <div className="alert-config">
      <div className="notice notice--info">
        <span>
          <strong>Cargo conditions</strong> compare readings against the warning
          and critical limits you enter here. <strong>System &amp; device alerts</strong>{' '}
          come from the ESP32, its sensors and connectivity — they are not cargo
          thresholds. No limits are pre-filled because safe conditions depend on
          the product and your validated requirements.
        </span>
      </div>

      <div className="alert-config__group">
        <div className="alert-config__group-head">
          <h3>Cargo conditions</h3>
          <StatusBadge tone="info">Cargo</StatusBadge>
        </div>
        <p className="alert-config__hint">
          Only parameters selected in Monitoring Requirements are shown. Enter
          the limits that define a warning and a critical cargo condition. Leave
          a low-side field blank when it is not relevant; any critical limit you
          set must sit outside the warning limit on the same side.
        </p>

        {enabledSensors.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__title">
              {device ? 'No monitoring parameters selected' : 'No device assigned'}
            </span>
            <span className="empty-state__hint">
              {device
                ? 'Select parameters in Monitoring Requirements to configure their warning and critical thresholds.'
                : 'Assign a device in Device assignment, then select the parameters to monitor. Threshold configuration appears here for fitted sensors only.'}
            </span>
          </div>
        ) : (
          <div className="alert-policy-grid">
            {enabledSensors.map((sensorId) => {
              const meta = SENSOR_CATALOG[sensorId]
              const config = monitoring[sensorId]
              const Icon = SENSOR_ICONS[sensorId]
              const isState = meta.kind === 'state'

              return (
                <article className="alert-policy" key={sensorId}>
                  <header className="alert-policy__head">
                    <span style={{ color: meta.color }} aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <strong>{meta.label}</strong>
                    <span className="alert-policy__unit">
                      {isState ? 'Open / Closed' : meta.unit}
                    </span>
                  </header>

                  {isState ? (
                    <>
                      <div className="alert-policy__fields alert-policy__fields--state">
                        <label className="threshold-field threshold-field--full">
                          <span>Expected state</span>
                          <select
                            className="field__input field__input--compact"
                            value={config.expectedState}
                            onChange={(event) =>
                              onChange(sensorId, {
                                expectedState: event.target.value,
                              })
                            }
                          >
                            <option value="">Select expected state…</option>
                            <option value="closed">Closed</option>
                            <option value="open">Open</option>
                          </select>
                        </label>
                        <ThresholdInput
                          label="Warning duration"
                          value={config.warningOpenMinutes}
                          onChange={(value) =>
                            onChange(sensorId, { warningOpenMinutes: value })
                          }
                          suffix="min"
                          min="1"
                          step="1"
                        />
                        <ThresholdInput
                          label="Critical duration"
                          value={config.criticalOpenMinutes}
                          onChange={(value) =>
                            onChange(sensorId, { criticalOpenMinutes: value })
                          }
                          suffix="min"
                          min="1"
                          step="1"
                        />
                      </div>
                      <p className="alert-policy__note">
                        Durations are in minutes and apply while the door remains
                        in the unexpected state.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="alert-policy__fields">
                        <ThresholdInput
                          label="Warning Low"
                          value={config.warning.min}
                          onChange={(value) =>
                            updateBound(sensorId, 'warning', 'min', value)
                          }
                          suffix={meta.unit}
                        />
                        <ThresholdInput
                          label="Warning High"
                          value={config.warning.max}
                          onChange={(value) =>
                            updateBound(sensorId, 'warning', 'max', value)
                          }
                          suffix={meta.unit}
                        />
                        <ThresholdInput
                          label="Critical Low"
                          value={config.critical.min}
                          onChange={(value) =>
                            updateBound(sensorId, 'critical', 'min', value)
                          }
                          suffix={meta.unit}
                        />
                        <ThresholdInput
                          label="Critical High"
                          value={config.critical.max}
                          onChange={(value) =>
                            updateBound(sensorId, 'critical', 'max', value)
                          }
                          suffix={meta.unit}
                        />
                      </div>
                      <ThresholdInput
                        label="Escalate to critical after"
                        value={config.escalationMinutes}
                        onChange={(value) =>
                          onChange(sensorId, { escalationMinutes: value })
                        }
                        suffix="min"
                        min="0"
                        step="1"
                      />
                    </>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>

      <div className="alert-config__group">
        <div className="alert-config__group-head">
          <h3>System &amp; device alerts</h3>
          <StatusBadge tone="muted">System</StatusBadge>
        </div>
        <p className="alert-config__hint">
          Operational health alerts for the assigned ESP32. These apply to the
          hardware and connection, not the produce, and are never compared
          against cargo warning or critical thresholds.
        </p>

        <div className="system-alert-list">
          <label className="system-alert">
            <input
              type="checkbox"
              checked={systemAlerts.offline.enabled}
              onChange={(event) =>
                onSystemChange('offline', { enabled: event.target.checked })
              }
            />
            <span className="system-alert__label">
              ESP32 offline / missing heartbeat
            </span>
            <span className="system-alert__config">
              alert after
              <input
                type="number"
                min="1"
                step="1"
                className="field__input field__input--compact"
                value={systemAlerts.offline.afterMinutes}
                disabled={!systemAlerts.offline.enabled}
                onChange={(event) =>
                  onSystemChange('offline', { afterMinutes: event.target.value })
                }
              />
              min
            </span>
          </label>

          <label className="system-alert">
            <input
              type="checkbox"
              checked={systemAlerts.battery.enabled}
              onChange={(event) =>
                onSystemChange('battery', { enabled: event.target.checked })
              }
            />
            <span className="system-alert__label">Low battery</span>
            <span className="system-alert__config">
              alert below
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                className="field__input field__input--compact"
                value={systemAlerts.battery.thresholdPercent}
                disabled={!systemAlerts.battery.enabled}
                onChange={(event) =>
                  onSystemChange('battery', {
                    thresholdPercent: event.target.value,
                  })
                }
              />
              %
            </span>
          </label>

          <label className="system-alert">
            <input
              type="checkbox"
              checked={systemAlerts.sensorFault.enabled}
              onChange={(event) =>
                onSystemChange('sensorFault', { enabled: event.target.checked })
              }
            />
            <span className="system-alert__label">
              Sensor disconnected or malfunctioning
            </span>
            <span className="system-alert__config">
              notify when a sensor stops reporting
            </span>
          </label>

          <label className="system-alert">
            <input
              type="checkbox"
              checked={Boolean(systemAlerts.selfTest?.enabled)}
              onChange={(event) =>
                onSystemChange('selfTest', { enabled: event.target.checked })
              }
            />
            <span className="system-alert__label">Failed sensor self-test</span>
            <span className="system-alert__config">
              notify when a sensor self-test fails
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}

export default AlertConfiguration
