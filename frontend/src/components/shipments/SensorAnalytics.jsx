import { useState } from 'react'
import SensorChart from '../SensorChart.jsx'
import StatusBadge from '../StatusBadge.jsx'
import { DEVICES, SENSOR_CATALOG, SENSOR_IDS } from '../../data/shipmentData.js'
import { getMockSensorSeries } from '../../data/sensorMock.js'
import {
  formatRange,
  formatSensorValue,
  getExpectedDoorState,
  getMonitoringRange,
  isMonitoringConfigured,
} from '../../utils/shipments.js'
import { isHistoricalShipment } from '../../utils/history.js'
import { getDeviceConnectionState } from '../../utils/deviceState.js'
import { SENSOR_ICONS } from './sensorIcons.jsx'

function exceedsBounds(value, bounds) {
  if (!bounds) return false
  if (Number.isFinite(bounds.min) && value < bounds.min) return true
  if (Number.isFinite(bounds.max) && value > bounds.max) return true
  return false
}

function getReadingState(meta, config, latest) {
  if (!config?.available) return { tone: 'muted', label: 'Sensor unavailable' }
  if (!config.enabled) return { tone: 'muted', label: 'Not monitored' }
  if (!isMonitoringConfigured(config)) {
    return { tone: 'warn', label: 'Needs configuration' }
  }
  if (!latest) return { tone: 'muted', label: 'Awaiting readings' }

  if (meta.kind === 'state') {
    const isOpen = latest.value === 1
    const expectedState = getExpectedDoorState(config)
    // Without an expected state, the historical default is a closed door.
    const abnormal = expectedState
      ? expectedState === 'open'
        ? !isOpen
        : isOpen
      : isOpen
    const current = isOpen ? 'Door open' : 'Door closed'
    return {
      tone: abnormal ? 'warn' : 'ok',
      label: abnormal ? `Unexpected: ${current.toLowerCase()}` : current,
    }
  }

  const value = latest.value
  if (exceedsBounds(value, config.critical)) {
    return { tone: 'critical', label: 'Critical range' }
  }
  if (exceedsBounds(value, getMonitoringRange(config))) {
    return { tone: 'warn', label: 'Warning range' }
  }
  return { tone: 'ok', label: 'Within range' }
}

/**
 * Works for every sensor type in the catalogue. Chart data currently comes
 * from getMockSensorSeries — swap that call for the ESP32 feed later.
 */
function SensorAnalytics({ shipment }) {
  const [activeSensor, setActiveSensor] = useState('temperature')

  const meta = SENSOR_CATALOG[activeSensor]
  const config = shipment.monitoring[activeSensor]
  const Icon = SENSOR_ICONS[activeSensor]
  const historical = isHistoricalShipment(shipment)
  const device = shipment.deviceId
    ? (DEVICES.find((item) => item.id === shipment.deviceId) ?? null)
    : null
  const deviceConnectionState = device
    ? getDeviceConnectionState(device)
    : null
  const deviceReadingsStale =
    !historical &&
    deviceConnectionState != null &&
    deviceConnectionState !== 'online'
  const series = config.available ? getMockSensorSeries(shipment, activeSensor) : []
  const latest = series.length > 0 ? series[series.length - 1] : null
  const state = getReadingState(meta, config, latest)
  const warningRange = getMonitoringRange(config)
  const expectedState = getExpectedDoorState(config)

  return (
    <section className="panel sensor-analytics">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Sensor analytics</h2>
          <p className="panel__subtitle">
            {historical
              ? 'Simulated 24 hours before recorded completion · readings every 30 min'
              : 'Last 24 hours · all six sensor types · readings every 30 min'}
          </p>
        </div>
        <StatusBadge tone={historical ? 'warn' : 'muted'}>
          {historical ? 'Simulated historical readings' : 'Demo telemetry'}
        </StatusBadge>
      </header>

      {deviceReadingsStale && (
        <div className="notice notice--warn">
          <span>
            <strong>
              Device telemetry is{' '}
              {deviceConnectionState === 'stale' ? 'stale' : 'offline'}.
            </strong>{' '}
            The latest readings may be out of date and are not evidence that
            the cargo is safe. Check the Devices page for {device?.id ?? 'the device'}.
          </span>
        </div>
      )}

      <div className="sensor-tabs" role="tablist" aria-label="Sensor type">
        {SENSOR_IDS.map((sensorId) => {
          const sensorConfig = shipment.monitoring[sensorId]
          const TabIcon = SENSOR_ICONS[sensorId]
          const indicator = !sensorConfig?.available
            ? 'off'
            : !sensorConfig.enabled
              ? 'paused'
              : isMonitoringConfigured(sensorConfig)
                ? 'ok'
                : 'warn'

          return (
            <button
              key={sensorId}
              type="button"
              role="tab"
              aria-selected={activeSensor === sensorId}
              className={`sensor-tabs__tab${
                activeSensor === sensorId ? ' sensor-tabs__tab--active' : ''
              }`}
              onClick={() => setActiveSensor(sensorId)}
            >
              <TabIcon size={14} />
              <span>{SENSOR_CATALOG[sensorId].label}</span>
              <span
                className={`sensor-tabs__dot sensor-tabs__dot--${indicator}`}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>

      <div className="sensor-panel" role="tabpanel">
        <div className="sensor-panel__head">
          <div className="sensor-panel__identity">
            <span
              className="sensor-panel__icon"
              style={{ color: meta.color }}
              aria-hidden="true"
            >
              <Icon size={19} />
            </span>
            <div>
              <h3>{meta.label}</h3>
              <span>{meta.model}</span>
            </div>
          </div>

          <div className="sensor-panel__readout">
            <span className="sensor-panel__value">
              {latest ? formatSensorValue(activeSensor, latest.value) : '—'}
            </span>
            <StatusBadge tone={state.tone} dot>
              {state.label}
            </StatusBadge>
          </div>
        </div>

        {!config.available ? (
          <div className="empty-state">
            <span className="empty-state__title">Sensor not available</span>
            <span className="empty-state__hint">
              The device assigned to this shipment does not have a{' '}
              {meta.label.toLowerCase()} sensor fitted. Monitoring for this
              parameter cannot start.
            </span>
          </div>
        ) : (
          <>
            <div className="sensor-panel__chips">
              {config.enabled && !isMonitoringConfigured(config) && (
                <span className="limit-chip limit-chip--warn">Needs configuration</span>
              )}

              {meta.kind === 'numeric' && warningRange && (
                <span className="limit-chip limit-chip--warn">
                  Warning: {formatRange(warningRange, activeSensor)}
                </span>
              )}
              {meta.kind === 'numeric' && config.critical && (
                <span className="limit-chip limit-chip--critical">
                  Critical: {formatRange(config.critical, activeSensor)}
                </span>
              )}

              {meta.kind === 'state' && expectedState && (
                <span className="limit-chip limit-chip--ok">
                  Expected state: {expectedState === 'open' ? 'Open' : 'Closed'}
                </span>
              )}
              {meta.kind === 'state' && config.warning?.maxOpenMinutes != null && (
                <span className="limit-chip limit-chip--warn">
                  Warning: unexpected state for more than{' '}
                  {config.warning.maxOpenMinutes} min
                </span>
              )}
              {meta.kind === 'state' && config.critical?.maxOpenMinutes != null && (
                <span className="limit-chip limit-chip--critical">
                  Critical: unexpected state for more than{' '}
                  {config.critical.maxOpenMinutes} min
                </span>
              )}

              {!config.enabled && (
                <span className="limit-chip">Monitoring disabled for this shipment</span>
              )}
            </div>

            <SensorChart
              series={series}
              meta={meta}
              config={config}
              historical={historical}
            />

            <p className="sensor-panel__note">
              {historical
                ? 'Simulated historical readings generated for this demo record — not actual recorded sensor data.'
                : 'Demonstration readings generated locally around the configured range. No ESP32 data is connected yet.'}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

export default SensorAnalytics