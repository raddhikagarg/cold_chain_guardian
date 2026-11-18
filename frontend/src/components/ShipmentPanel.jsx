import { TruckIcon, BatteryIcon, ThermometerIcon, ClockIcon } from './icons.jsx'
import { formatRange, getMonitoringRange, getShipmentMonitoringState } from '../utils/shipments.js'
import { getDeviceConnectionState } from '../utils/deviceState.js'
import './ShipmentPanel.css'

const DEPARTED_STATUSES = ['in-transit', 'warning', 'critical', 'delivered']

function formatTime(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Details panel for the shipment selected in the Overview dropdown.
 * Uses the shared shipment/device data; missing fields fall back to
 * readable placeholders rather than inventing values.
 */
function ShipmentPanel({ shipment, device }) {
  if (!shipment) {
    return (
      <section className="shipment">
        <header className="shipment__head">
          <div>
            <h2 className="shipment__title">Current Shipment</h2>
            <p className="shipment__id">No shipment selected</p>
          </div>
        </header>
        <p className="shipment__progress-label">
          Create a shipment to see its cargo, route and assigned device here.
        </p>
      </section>
    )
  }

  const { cargo, route, monitoring } = shipment
  const monitoringState = getShipmentMonitoringState(shipment)

  const departureTime = formatTime(route.departure)
  const arrivalTime = formatTime(route.arrival)
  const hasDeparted = DEPARTED_STATUSES.includes(shipment.status)
  const progress = Math.min(100, Math.max(0, route.progress ?? 0))

  const temperatureConfig = monitoring?.temperature
  const temperatureBand = !temperatureConfig
    ? '—'
    : temperatureConfig.available
      ? formatRange(getMonitoringRange(temperatureConfig), 'temperature')
      : 'Not fitted'

  const deviceConnectionState = device
    ? getDeviceConnectionState(device)
    : null
  const deviceLabel = !device
    ? 'unassigned'
    : deviceConnectionState === 'online'
      ? 'connected'
      : deviceConnectionState === 'stale'
        ? 'telemetry stale'
        : 'offline'

  return (
    <section className="shipment">
      <header className="shipment__head">
        <div>
          <h2 className="shipment__title">Current Shipment</h2>
          <p className="shipment__id">
            {shipment.id} · Device {deviceLabel}
          </p>
        </div>
        <span className={`shipment__status shipment__status--${monitoringState.tone}`}>
          <span className="shipment__status-dot" aria-hidden="true" />
          {monitoringState.label}
        </span>
      </header>

      <div className="shipment__grid">
        <dl className="shipment__details">
          <div className="shipment__detail">
            <dt>Cargo</dt>
            <dd>{cargo.produce || '—'}</dd>
          </div>
          <div className="shipment__detail">
            <dt>Carrier</dt>
            <dd className={route.carrier ? undefined : 'shipment__muted'}>
              {route.carrier || 'Not assigned'}
            </dd>
          </div>
          <div className="shipment__detail">
            <dt>Vehicle</dt>
            <dd className={route.vehicle ? undefined : 'shipment__muted'}>
              {route.vehicle || 'Not assigned'}
            </dd>
          </div>
          <div className="shipment__detail">
            <dt>Tracking device</dt>
            <dd>
              {shipment.deviceId ? (
                <>
                  {shipment.deviceId}
                  {device && (
                    <span className="shipment__muted"> · {device.firmware}</span>
                  )}
                </>
              ) : (
                <span className="shipment__muted">Unassigned</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="shipment__route">
          <div className="shipment__route-points">
            <div className="shipment__route-end">
              <span className="shipment__route-label">Origin</span>
              <strong>{route.origin || 'Not set'}</strong>
              <span className="shipment__route-time">
                {departureTime
                  ? `${hasDeparted ? 'Departed' : 'Departs'} ${departureTime}`
                  : 'Departure not scheduled'}
              </span>
            </div>
            <div className="shipment__route-end shipment__route-end--right">
              <span className="shipment__route-label">Destination</span>
              <strong>{route.destination || 'Not set'}</strong>
              <span className="shipment__route-time">
                {arrivalTime ? `ETA ${arrivalTime}` : 'ETA not set'}
              </span>
            </div>
          </div>

          <div
            className="shipment__track"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Shipment route progress"
          >
            <div className="shipment__track-fill" style={{ width: `${progress}%` }}>
              <span className="shipment__truck" aria-hidden="true">
                <TruckIcon size={15} />
              </span>
            </div>
          </div>

          <span className="shipment__progress-label">
            {progress}% of route complete
          </span>
        </div>
      </div>

      <footer className="shipment__stats">
        <div className="shipment__stat">
          <span className="shipment__stat-icon" aria-hidden="true">
            <ThermometerIcon size={15} />
          </span>
          <div>
            <span className="shipment__stat-label">Temperature warning band</span>
            <span className="shipment__stat-value">{temperatureBand}</span>
          </div>
        </div>
        <div className="shipment__stat">
          <span className="shipment__stat-icon" aria-hidden="true">
            <TruckIcon size={15} />
          </span>
          <div>
            <span className="shipment__stat-label">Route distance</span>
            <span className="shipment__stat-value">
              {route.distanceKm != null ? `${route.distanceKm} km` : '—'}
            </span>
          </div>
        </div>
        <div className="shipment__stat">
          <span className="shipment__stat-icon" aria-hidden="true">
            <ClockIcon size={15} />
          </span>
          <div>
            <span className="shipment__stat-label">Estimated arrival</span>
            <span className="shipment__stat-value">{arrivalTime ?? '—'}</span>
          </div>
        </div>
        <div className="shipment__stat">
          <span className="shipment__stat-icon" aria-hidden="true">
            <BatteryIcon size={15} />
          </span>
          <div>
            <span className="shipment__stat-label">Logger battery</span>
            <span className="shipment__stat-value">
              {device?.battery != null ? `${device.battery}%` : '—'}
            </span>
          </div>
        </div>
      </footer>
    </section>
  )
}

export default ShipmentPanel