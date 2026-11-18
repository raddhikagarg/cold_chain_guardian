import StatusBadge from '../StatusBadge.jsx'
import { SENSOR_CATALOG, SENSOR_IDS } from '../../data/shipmentData.js'
import { SENSOR_ICONS } from './sensorIcons.jsx'

function selectionStatus(available, enabled) {
  if (!available) return { label: 'Sensor unavailable', tone: 'muted' }
  if (!enabled) return { label: 'Not selected', tone: 'muted' }
  return { label: 'Selected for monitoring', tone: 'info' }
}

/**
 * Section C — for every sensor type show:
 *   1. whether the sensor is available on the selected device, and
 *   2. whether the operator selected that parameter for monitoring.
 * These are deliberately separate states. Threshold values are configured in
 * the Cargo Conditions & Alert Thresholds section so this section only holds
 * availability and selection.
 */
function MonitoringRequirements({ monitoring, device, onChange }) {
  return (
    <div className="monitoring-grid">
      {SENSOR_IDS.map((sensorId) => {
        const meta = SENSOR_CATALOG[sensorId]
        const config = monitoring[sensorId]
        const Icon = SENSOR_ICONS[sensorId]
        const available = Boolean(device?.sensors?.includes(sensorId))
        const selected = available && config.enabled
        const status = selectionStatus(available, selected)

        return (
          <article
            key={sensorId}
            className={`monitoring-card${available ? '' : ' monitoring-card--unavailable'}`}
          >
            <header className="monitoring-card__head">
              <span
                className="monitoring-card__icon"
                style={{ color: meta.color }}
                aria-hidden="true"
              >
                <Icon size={17} />
              </span>
              <div className="monitoring-card__title">
                <h3>{meta.label}</h3>
                <span>{meta.model}</span>
              </div>
              <StatusBadge tone={status.tone} dot>
                {status.label}
              </StatusBadge>
            </header>

            <div className="monitoring-card__availability">
              <span className="monitoring-card__eyebrow">Sensor availability</span>
              <span className={`availability-text availability-text--${available ? 'ok' : 'off'}`}>
                {available
                  ? `Connected on ${device.id}`
                  : device
                    ? `Not connected on ${device.id}`
                    : 'Select a device to check availability'}
              </span>
            </div>

            <div className="monitoring-card__config">
              <span className="monitoring-card__eyebrow">Monitoring selection</span>
              <span className="monitoring-card__hint">
                {selected
                  ? 'Warning and critical thresholds for this parameter are configured in Cargo Conditions & Alert Thresholds.'
                  : 'Select this parameter to configure its cargo thresholds. A fitted sensor does not select it automatically.'}
              </span>
            </div>

            <label className="monitor-toggle">
              <input
                type="checkbox"
                checked={selected}
                disabled={!available}
                onChange={(event) =>
                  onChange(sensorId, { enabled: event.target.checked })
                }
              />
              <span>Monitor this parameter</span>
              {!available && (
                <span className="monitor-toggle__note">
                  {device ? 'Sensor not fitted' : 'No device selected'}
                </span>
              )}
            </label>
          </article>
        )
      })}
    </div>
  )
}

export default MonitoringRequirements
