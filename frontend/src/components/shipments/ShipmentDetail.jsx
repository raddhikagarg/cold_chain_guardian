import { useState } from 'react'
import StatusBadge from '../StatusBadge.jsx'
import SensorAnalytics from './SensorAnalytics.jsx'
import ExposureSummary from './ExposureSummary.jsx'
import ShipmentTimelineCard from './ShipmentTimelineCard.jsx'
import {
  ArrowLeftIcon,
  WifiIcon,
  BatteryIcon,
  AlertTriangleIcon,
  CheckIcon,
  CpuIcon,
} from '../icons.jsx'
import {
  CARGO_CATEGORIES,
  SENSOR_CATALOG,
  SENSOR_IDS,
} from '../../data/shipmentData.js'
import { getMockSensorSeries } from '../../data/sensorMock.js'
import {
  formatDateTime,
  formatSensorValue,
  getShipmentMonitoringState,
  getStatusMeta,
  isMonitoringConfigured,
} from '../../utils/shipments.js'
import {
  canConfirmDelivery,
  getCompletionInfo,
} from '../../utils/history.js'
import { getDeviceConnectionState } from '../../utils/deviceState.js'
import { SENSOR_ICONS } from './sensorIcons.jsx'
import './ShipmentDetail.css'

function severityTone(severity) {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warn'
  return 'info'
}

function InfoRow({ term, children, muted = false }) {
  return (
    <div className="info-list__row">
      <dt>{term}</dt>
      <dd className={muted ? 'is-muted' : undefined}>{children}</dd>
    </div>
  )
}

function SensorMatrix({ shipment }) {
  return (
    <div className="sensor-matrix">
      <div className="sensor-matrix__head" aria-hidden="true">
        <span>Sensor</span>
        <span>Hardware</span>
        <span>Requirement</span>
      </div>
      {SENSOR_IDS.map((sensorId) => {
        const meta = SENSOR_CATALOG[sensorId]
        const config = shipment.monitoring[sensorId]
        const Icon = SENSOR_ICONS[sensorId]
        const configured = isMonitoringConfigured(config)

        return (
          <div className="sensor-matrix__row" key={sensorId}>
            <span className="sensor-matrix__name">
              <Icon size={14} style={{ color: meta.color }} />
              <span>
                {meta.label}
                <small>{meta.model}</small>
              </span>
            </span>
            <span>
              <StatusBadge tone={config.available ? 'ok' : 'muted'}>
                {config.available ? 'Available' : 'Not fitted'}
              </StatusBadge>
            </span>
            <span>
              {configured ? (
                <StatusBadge tone="ok">Configured</StatusBadge>
              ) : config.enabled ? (
                <StatusBadge tone="warn">Needs configuration</StatusBadge>
              ) : (
                <StatusBadge tone="muted">Not monitored</StatusBadge>
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function ShipmentDetail({
  shipment,
  devices,
  notice,
  onDismissNotice,
  onBack,
  onConfirmDelivery,
}) {
  const [confirmingDelivery, setConfirmingDelivery] = useState(false)

  const category =
    CARGO_CATEGORIES.find((item) => item.id === shipment.cargo.category)?.label ??
    shipment.cargo.category
  const status = getStatusMeta(shipment.status)
  const monitoringState = getShipmentMonitoringState(shipment)
  const device = devices.find((item) => item.id === shipment.deviceId) ?? null
  const deviceConnectionState = device
    ? getDeviceConnectionState(device)
    : null
  const deviceConnectionMeta =
    deviceConnectionState === 'online'
      ? { tone: 'ok', label: 'Online' }
      : deviceConnectionState === 'stale'
        ? { tone: 'warn', label: 'Telemetry stale' }
        : { tone: 'critical', label: 'Offline' }
  const completion = getCompletionInfo(shipment)
  const deliveryEligible = canConfirmDelivery(shipment)

  const activeAlerts = (shipment.alerts ?? []).filter(
    (alert) => alert.status !== 'resolved',
  )
  const incidents = shipment.incidents ?? []
  const progress = shipment.route?.progress ?? 0

  const readings = SENSOR_IDS.map((sensorId) => {
    const config = shipment.monitoring[sensorId]
    if (!config?.available) {
      return { sensorId, available: false, enabled: false, configured: false, value: null }
    }
    const series = getMockSensorSeries(shipment, sensorId)
    return {
      sensorId,
      available: true,
      enabled: config.enabled,
      configured: isMonitoringConfigured(config),
      value: series[series.length - 1].value,
    }
  })

  return (
    <div className="shipments-page">
      {notice && (
        <div className="notice notice--success">
          <span>{notice}</span>
          <button
            type="button"
            className="notice__dismiss"
            onClick={onDismissNotice}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}

      <div className="page-head">
        <div className="page-head__text">
          <button type="button" className="page-back" onClick={onBack}>
            <ArrowLeftIcon size={15} />
            Back to shipments
          </button>
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            {category}
          </div>
          <h1 className="page-head__title">
            {shipment.id} · {shipment.cargo.produce}
          </h1>
          <p className="page-head__subtitle">
            {shipment.cargo.quantity} {shipment.cargo.unit}
            {shipment.cargo.batch ? ` · Batch ${shipment.cargo.batch}` : ''}
            {shipment.route.carrier ? ` · ${shipment.route.carrier}` : ''}
          </p>
        </div>

        <div className="page-head__badges">
          <StatusBadge tone={monitoringState.tone} dot>
            {monitoringState.label}
          </StatusBadge>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
      </div>

      <div className={`monitor-banner monitor-banner--${monitoringState.tone}`}>
        <span className="monitor-banner__icon" aria-hidden="true">
          {monitoringState.tone === 'critical' ? (
            <AlertTriangleIcon size={18} />
          ) : (
            <CpuIcon size={18} />
          )}
        </span>
        <div className="monitor-banner__text">
          <strong>{monitoringState.label}</strong>
          <span>{monitoringState.detail}</span>
        </div>
        <span className="monitor-banner__meta">
          Device {device?.id ?? 'unassigned'}
        </span>
      </div>

      {completion.confirmed && (
        <div
          className={`monitor-banner${
            shipment.status === 'archived' ? '' : ' monitor-banner--ok'
          }`}
        >
          <span className="monitor-banner__icon" aria-hidden="true">
            <CheckIcon size={18} />
          </span>
          <div className="monitor-banner__text">
            <strong>
              {shipment.status === 'archived'
                ? 'Shipment archived'
                : 'Delivery confirmed'}
            </strong>
            <span>
              {formatDateTime(completion.completedAt)} · {completion.sourceLabel}
              {completion.archivedAt
                ? ` · Archived ${formatDateTime(completion.archivedAt)}`
                : ''}
            </span>
          </div>
          <span className="monitor-banner__meta">
            {shipment.status === 'archived'
              ? 'Retained in history'
              : 'In shipment history'}
          </span>
        </div>
      )}

      {deliveryEligible && onConfirmDelivery && (
        <section className="lifecycle-actions">
          <div className="lifecycle-actions__text">
            <strong>
              {confirmingDelivery
                ? `Confirm delivery for ${shipment.id}?`
                : 'Departed and delivered?'}
            </strong>
            <span>
              {confirmingDelivery
                ? 'This records delivery at the current time and moves the shipment to History. Existing alerts keep their current status — delivery does not resolve them automatically.'
                : 'Delivery is recorded only when you confirm it. The expected arrival date never completes a shipment automatically.'}
            </span>
          </div>
          {confirmingDelivery ? (
            <div className="lifecycle-actions__buttons">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setConfirmingDelivery(false)
                  onConfirmDelivery(shipment.id)
                }}
              >
                Confirm delivery
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setConfirmingDelivery(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmingDelivery(true)}
            >
              Confirm delivery
            </button>
          )}
        </section>
      )}

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Shipment information</h2>
              <p className="panel__subtitle">Cargo details stored with this shipment</p>
            </div>
          </header>
          <dl className="info-list">
            <InfoRow term="Shipment ID">{shipment.id}</InfoRow>
            <InfoRow term="Cargo category">{category}</InfoRow>
            <InfoRow term="Product">{shipment.cargo.produce}</InfoRow>
            <InfoRow term="Quantity">
              {shipment.cargo.quantity} {shipment.cargo.unit}
            </InfoRow>
            <InfoRow term="Batch / lot" muted={!shipment.cargo.batch}>
              {shipment.cargo.batch || 'Not provided'}
            </InfoRow>
            <InfoRow term="Created">{formatDateTime(shipment.createdAt)}</InfoRow>
            <InfoRow term="Shipment status">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </InfoRow>
          </dl>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Route &amp; schedule</h2>
              <p className="panel__subtitle">Origin, destination and delivery window</p>
            </div>
          </header>
          <dl className="info-list">
            <InfoRow term="Origin">{shipment.route.origin || '—'}</InfoRow>
            <InfoRow term="Destination">{shipment.route.destination || '—'}</InfoRow>
            <InfoRow term="Carrier" muted={!shipment.route.carrier}>
              {shipment.route.carrier || 'Not assigned'}
            </InfoRow>
            <InfoRow term="Vehicle" muted={!shipment.route.vehicle}>
              {shipment.route.vehicle || 'Not assigned'}
            </InfoRow>
            <InfoRow term="Planned departure">
              {formatDateTime(shipment.route.departure)}
            </InfoRow>
            <InfoRow term="Expected arrival">
              {formatDateTime(shipment.route.arrival)}
            </InfoRow>
            <InfoRow term="Delivery deadline" muted={!shipment.route.deadline}>
              {shipment.route.deadline
                ? formatDateTime(shipment.route.deadline)
                : 'Not set'}
            </InfoRow>
          </dl>

          <div className="detail-progress">
            <div className="detail-progress__labels">
              <span>Route progress</span>
              <span>{progress}%</span>
            </div>
            <div
              className="detail-progress__track"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Shipment route progress"
            >
              <span
                className="detail-progress__fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Assigned device</h2>
              <p className="panel__subtitle">
                Hardware availability is separate from configured requirements
              </p>
            </div>
            {device && (
              <StatusBadge tone={deviceConnectionMeta.tone} dot>
                {deviceConnectionMeta.label}
              </StatusBadge>
            )}
          </header>

          {device ? (
            <>
              <dl className="info-list device-info">
                <InfoRow term="Device">
                  <span className="mono">{device.id}</span> · {device.name}
                </InfoRow>
                <InfoRow term="Connectivity">
                  <WifiIcon size={13} /> {device.connectivity} · {device.signal} signal
                </InfoRow>
                <InfoRow term="Battery">
                  <BatteryIcon size={13} /> {device.battery}%
                </InfoRow>
                <InfoRow term="Firmware">{device.firmware}</InfoRow>
              </dl>
              <SensorMatrix shipment={shipment} />
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-state__title">No device assigned</span>
              <span className="empty-state__hint">
                This shipment is a draft. Assign an available ESP32 to start
                receiving sensor readings.
              </span>
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Current monitoring</h2>
              <p className="panel__subtitle">Latest demonstration readings</p>
            </div>
          </header>

          <div className="reading-grid">
            {readings.map((reading) => {
              const meta = SENSOR_CATALOG[reading.sensorId]
              const Icon = SENSOR_ICONS[reading.sensorId]
              return (
                <div
                  key={reading.sensorId}
                  className={`reading-tile${reading.available ? '' : ' reading-tile--off'}`}
                >
                  <span
                    className="reading-tile__icon"
                    style={{ color: meta.color }}
                    aria-hidden="true"
                  >
                    <Icon size={16} />
                  </span>
                  <span className="reading-tile__label">{meta.label}</span>
                  <span className="reading-tile__value">
                    {reading.available
                      ? formatSensorValue(reading.sensorId, reading.value)
                      : 'Not fitted'}
                  </span>
                  {reading.available && reading.enabled && !reading.configured && (
                    <StatusBadge tone="warn">Needs configuration</StatusBadge>
                  )}
                  {reading.available && !reading.enabled && (
                    <StatusBadge tone="muted">Not monitored</StatusBadge>
                  )}
                </div>
              )
            })}
          </div>

          <p className="panel__footnote">
            Values are generated mock telemetry around the configured warning
            range; they are not real sensor measurements yet.
          </p>
        </section>
      </div>

      <SensorAnalytics shipment={shipment} />

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Active alerts</h2>
              <p className="panel__subtitle">
                Cargo thresholds and system/device health
              </p>
            </div>
            <StatusBadge tone={activeAlerts.length > 0 ? 'critical' : 'ok'}>
              {activeAlerts.length} active
            </StatusBadge>
          </header>

          {activeAlerts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">No active alerts</span>
              <span className="empty-state__hint">
                Readings are within the configured limits for this shipment.
              </span>
            </div>
          ) : (
            <div className="alert-stack">
              {['cargo', 'system'].map((source) => {
                const sourceAlerts = activeAlerts.filter(
                  (alert) => alert.source === source,
                )
                if (sourceAlerts.length === 0) return null

                return (
                  <div className="alert-group" key={source}>
                    <div className="alert-group__title">
                      <span>
                        {source === 'cargo'
                          ? 'Cargo-specific alerts'
                          : 'System & device alerts'}
                      </span>
                      <StatusBadge tone={source === 'cargo' ? 'info' : 'muted'}>
                        {source === 'cargo' ? 'Cargo' : 'System'}
                      </StatusBadge>
                    </div>

                    {sourceAlerts.map((alert) => (
                      <article
                        key={alert.id}
                        className={`alert-card alert-card--${severityTone(alert.severity)}`}
                      >
                        <div className="alert-card__head">
                          <AlertTriangleIcon size={14} />
                          <strong>{alert.title}</strong>
                          <StatusBadge
                            tone={
                              alert.status === 'acknowledged' ? 'muted' : 'critical'
                            }
                          >
                            {alert.status === 'acknowledged'
                              ? 'Acknowledged'
                              : 'Active'}
                          </StatusBadge>
                        </div>
                        <p className="alert-card__message">{alert.message}</p>
                        <div className="alert-card__meta">
                          <span>Reading: {alert.reading}</span>
                          <span>{alert.threshold}</span>
                          <span>Since {formatDateTime(alert.startedAt)}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Incident history</h2>
              <p className="panel__subtitle">Chronological log for this shipment</p>
            </div>
            <StatusBadge tone="muted">{incidents.length} recorded</StatusBadge>
          </header>

          {incidents.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">No incidents recorded</span>
              <span className="empty-state__hint">
                Events such as excursions, door openings and shocks will appear
                here.
              </span>
            </div>
          ) : (
            <ul className="incident-list">
              {incidents.map((incident) => (
                <li
                  key={incident.id}
                  className={`incident incident--${severityTone(incident.severity)}`}
                >
                  <div className="incident__head">
                    <span className="incident__dot" aria-hidden="true" />
                    <strong>{incident.title}</strong>
                    <StatusBadge
                      tone={incident.resolved ? 'ok' : severityTone(incident.severity)}
                    >
                      {incident.resolved ? 'Resolved' : 'Open'}
                    </StatusBadge>
                  </div>
                  <p className="incident__description">{incident.description}</p>
                  <span className="incident__meta">
                    {formatDateTime(incident.time)} ·{' '}
                    {SENSOR_CATALOG[incident.parameter]?.label ?? 'Device'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ExposureSummary shipment={shipment} />

      <ShipmentTimelineCard events={shipment.timeline} />
    </div>
  )
}

export default ShipmentDetail