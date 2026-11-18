import StatusBadge from '../StatusBadge.jsx'
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  BatteryIcon,
  CheckIcon,
  ClockIcon,
  CpuIcon,
  InfoIcon,
  WifiIcon,
} from '../icons.jsx'
import { SENSOR_ICONS } from '../shipments/sensorIcons.jsx'
import {
  formatDurationMinutes,
  formatRelativeMinutes,
  getBatteryState,
  sensorStatusLabel,
  sensorStatusTone,
} from '../../utils/deviceState.js'
import {
  getConnectivityHistory,
  getDeviceEventFeed,
} from '../../utils/devices.js'
import { formatDateTime, getStatusMeta } from '../../utils/shipments.js'
import '../shipments/ShipmentDetail.css'
import './DeviceDetail.css'

const CONNECTION_META = {
  online: { label: 'Online', tone: 'ok' },
  stale: { label: 'Telemetry stale', tone: 'warn' },
  offline: { label: 'Offline', tone: 'critical' },
}

const BATTERY_LABEL = {
  normal: 'Normal',
  low: 'Low',
  critical: 'Critical',
  unknown: 'Unknown',
}

const EVENT_SOURCE_LABEL = {
  device: 'Device',
  alert: 'System alert',
  lifecycle: 'Assignment',
}

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

function HealthIcon({ tone, size = 18 }) {
  if (tone === 'ok') return <CheckIcon size={size} />
  if (tone === 'info') return <InfoIcon size={size} />
  return <AlertTriangleIcon size={size} />
}

function DeviceDetail({ device, shipments, now, onBack, onOpenShipment }) {
  const connection =
    CONNECTION_META[device.connectionState] ?? CONNECTION_META.offline
  const batteryState = getBatteryState(device.battery)
  const assignment = device.currentAssignment
  const assignmentStatus = assignment ? getStatusMeta(assignment.status) : null
  const lastReleasedAt =
    device.lastAssignment?.completedAt ??
    device.lastAssignment?.archivedAt ??
    device.lastAssignment?.route?.arrival ??
    null

  const connectivityHistory = getConnectivityHistory(device, shipments, now)
  const deviceEvents = getDeviceEventFeed(device, shipments, now)
  const visibleConnectivity = connectivityHistory.slice(0, 8)
  const visibleEvents = deviceEvents.slice(0, 12)

  return (
    <div className="devices-page">
      <div className="page-head">
        <div className="page-head__text">
          <button type="button" className="page-back" onClick={onBack}>
            <ArrowLeftIcon size={15} />
            Back to devices
          </button>
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo device</span>
            {connection.label}
          </div>
          <h1 className="page-head__title">
            {device.id} · {device.name}
          </h1>
          <p className="page-head__subtitle">
            {device.hardware?.board ?? 'ESP32'} · Firmware {device.firmware} ·{' '}
            {device.connectivity}
            {device.hardware?.serial
              ? ` · Serial ${device.hardware.serial}`
              : ''}
          </p>
        </div>

        <div className="page-head__badges">
          <StatusBadge tone={connection.tone} dot>
            {connection.label}
          </StatusBadge>
          <StatusBadge tone={device.health.tone} dot>
            {device.health.label}
          </StatusBadge>
          <StatusBadge tone={assignment ? 'info' : 'muted'}>
            {assignment ? `Assigned · ${assignment.id}` : 'Unassigned'}
          </StatusBadge>
        </div>
      </div>

      <div className={`monitor-banner monitor-banner--${device.health.tone}`}>
        <span className="monitor-banner__icon" aria-hidden="true">
          <HealthIcon tone={device.health.tone} />
        </span>
        <div className="monitor-banner__text">
          <strong>{device.health.label}</strong>
          <span>{device.health.detail}</span>
          {device.health.issues.length > 1 && (
            <span>
              Also: {device.health.issues.slice(1).map((issue) => issue.label).join(' · ')}
            </span>
          )}
        </div>
        <span className="monitor-banner__meta">
          Last seen {formatRelativeMinutes(device.lastSeenAgeMinutes)}
        </span>
      </div>

      <div className="notice notice--info device-scope-note">
        <InfoIcon size={16} />
        <span>
          <strong>Device health is not cargo health.</strong> This page covers
          the ESP32, its sensors, power and connectivity. Cargo excursions and
          shipment-level alerts remain in Shipments and Alerts.
        </span>
      </div>

      {device.assignmentConflict && (
        <div className="notice notice--warn">
          <span>
            <strong>Assignment conflict detected.</strong> More than one active
            shipment references this device. The fleet rule is one device per
            active shipment; review the shipment records.
          </span>
        </div>
      )}

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Assignment</h2>
              <p className="panel__subtitle">
                Derived from active shipment records
              </p>
            </div>
            {assignment && (
              <StatusBadge tone={assignmentStatus?.tone ?? 'info'}>
                {assignmentStatus?.label ?? assignment.status}
              </StatusBadge>
            )}
          </header>

          {assignment ? (
            <>
              <dl className="info-list">
                <InfoRow term="Shipment">
                  <span className="mono">{assignment.id}</span>
                </InfoRow>
                <InfoRow term="Product">
                  {assignment.cargo?.produce ?? 'Not recorded'}
                </InfoRow>
                <InfoRow term="Route">
                  {assignment.route?.origin ?? '—'} →{' '}
                  {assignment.route?.destination ?? '—'}
                </InfoRow>
                <InfoRow term="Carrier">
                  {assignment.route?.carrier || 'Not assigned'}
                </InfoRow>
                <InfoRow term="Assigned">
                  {formatDateTime(
                    assignment.route?.departure ?? assignment.createdAt,
                  )}
                </InfoRow>
                <InfoRow term="Shipment status">
                  <StatusBadge tone={assignmentStatus?.tone ?? 'info'}>
                    {assignmentStatus?.label ?? assignment.status}
                  </StatusBadge>
                </InfoRow>
              </dl>

              <div className="device-assignment-link">
                <p>
                  One device can only monitor one active shipment. Reassign it
                  from the shipment flow, not from this read-only view.
                </p>
                {onOpenShipment && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => onOpenShipment(assignment.id)}
                  >
                    Open shipment
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-state__title">Unassigned</span>
              <span className="empty-state__hint">
                {device.connectionState === 'online'
                  ? 'No active shipment references this device. It is available for assignment from the shipment creation flow.'
                  : 'No active shipment references this device. It cannot be assigned until it reports a fresh heartbeat.'}
              </span>
            </div>
          )}

          {device.lastAssignment && (
            <div className="device-assignment-history">
              <span className="device-assignment-history__label">
                Last assignment
              </span>
              <span>
                <span className="mono">{device.lastAssignment.id}</span> ·{' '}
                {device.lastAssignment.cargo?.produce ?? 'Shipment'} ·{' '}
                {getStatusMeta(device.lastAssignment.status).label}
              </span>
              {lastReleasedAt && (
                <span className="device-assignment-history__meta">
                  Released {formatDateTime(lastReleasedAt)}
                </span>
              )}
            </div>
          )}
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Hardware</h2>
              <p className="panel__subtitle">
                Physical device identity and inventory
              </p>
            </div>
            <CpuIcon size={18} />
          </header>
          <dl className="info-list">
            <InfoRow term="Device ID">
              <span className="mono">{device.id}</span>
            </InfoRow>
            <InfoRow term="Board">
              {device.hardware?.board ?? 'Not recorded'}
            </InfoRow>
            <InfoRow term="Chip">
              {device.hardware?.chip ?? 'Not recorded'}
            </InfoRow>
            <InfoRow term="Revision">
              {device.hardware?.revision ?? 'Not recorded'}
            </InfoRow>
            <InfoRow term="Serial">
              <span className="mono">
                {device.hardware?.serial ?? 'Not recorded'}
              </span>
            </InfoRow>
            <InfoRow term="MAC address">
              <span className="mono">
                {device.hardware?.mac ?? 'Not recorded'}
              </span>
            </InfoRow>
            <InfoRow term="Firmware">{device.firmware}</InfoRow>
            <InfoRow term="Flash storage">
              {device.hardware?.flash ?? 'Not recorded'}
            </InfoRow>
            <InfoRow term="Installed">
              {device.hardware?.installedAt
                ? formatDateTime(device.hardware.installedAt)
                : 'Not recorded'}
            </InfoRow>
            <InfoRow term="Power source">
              {device.hardware?.powerSource ?? 'Not recorded'}
            </InfoRow>
          </dl>
        </section>
      </div>

      <section className="panel" aria-label="Installed sensor inventory">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">Installed sensor inventory</h2>
            <p className="panel__subtitle">
              Current health requires a fresh heartbeat and a self-test within
              24 hours
            </p>
          </div>
          <StatusBadge tone={device.sensorIssueCount > 0 ? 'warn' : 'muted'}>
            {device.sensorFittedCount} fitted ·{' '}
            {device.sensorIssueCount} not currently verified
          </StatusBadge>
        </header>

        <div className="device-sensor-table">
          <div className="device-sensor-table__header" aria-hidden="true">
            <span>Sensor</span>
            <span>Model</span>
            <span>Current status</span>
            <span>Last self-test</span>
            <span>Evidence / note</span>
          </div>

          {device.sensorEntries.map((sensor) => {
            const Icon = SENSOR_ICONS[sensor.id]
            return (
              <div className="device-sensor-row" key={sensor.id}>
                <span className="device-sensor-row__sensor">
                  <span
                    className="device-sensor-row__icon"
                    style={{ color: sensor.color }}
                    aria-hidden="true"
                  >
                    {Icon ? <Icon size={16} /> : <CpuIcon size={16} />}
                  </span>
                  <span>
                    <strong>{sensor.label}</strong>
                    <span className="device-sensor-row__model-inline">
                      {sensor.model}
                    </span>
                  </span>
                </span>

                <span className="device-sensor-row__model">
                  {sensor.model}
                </span>

                <span className="device-sensor-row__status">
                  <StatusBadge tone={sensorStatusTone(sensor.currentStatus)}>
                    {sensorStatusLabel(sensor.currentStatus)}
                  </StatusBadge>
                  {sensor.currentStatus === 'unknown' && (
                    <span className="device-sensor-row__last-known">
                      Last known: {sensorStatusLabel(sensor.lastKnownStatus)}
                    </span>
                  )}
                </span>

                <span className="device-sensor-row__time">
                  <span>
                    {sensor.selfTestMinutesAgo == null
                      ? 'No evidence'
                      : formatRelativeMinutes(sensor.selfTestMinutesAgo)}
                  </span>
                  {sensor.lastSelfTestAt != null && (
                    <span className="device-sensor-row__time-absolute">
                      {formatDateTime(sensor.lastSelfTestAt)}
                    </span>
                  )}
                </span>

                <span className="device-sensor-row__note">{sensor.note}</span>
              </div>
            )
          })}
        </div>

        <p className="panel__footnote">
          Missing or unverified sensor evidence is shown as Unknown, never
          Healthy. For offline or stale devices, the last-known status is kept
          separately and is not presented as current.
        </p>
      </section>

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Connectivity &amp; power</h2>
              <p className="panel__subtitle">
                Current link quality and device power state
              </p>
            </div>
            <WifiIcon size={18} />
          </header>
          <dl className="info-list">
            <InfoRow term="Connection state">
              <StatusBadge tone={connection.tone} dot>
                {connection.label}
              </StatusBadge>
            </InfoRow>
            <InfoRow term="Network">{device.connectivity}</InfoRow>
            <InfoRow term="Signal">
              {device.signal}
              {device.signalDbm != null ? ` · ${device.signalDbm} dBm` : ''}
            </InfoRow>
            <InfoRow term="Last heartbeat">
              {formatRelativeMinutes(device.lastSeenAgeMinutes)} ·{' '}
              {formatDateTime(device.lastSeen)}
            </InfoRow>
            <InfoRow term="Last boot">
              {device.lastBootMinutesAgo == null
                ? 'Not recorded'
                : `${formatDurationMinutes(device.lastBootMinutesAgo)} ago`}
            </InfoRow>
            <InfoRow term="Battery">
              <span className="device-battery-value">
                <BatteryIcon size={14} /> {device.battery}% ·{' '}
                {BATTERY_LABEL[batteryState]}
              </span>
            </InfoRow>
            <InfoRow term="Power source">
              {device.hardware?.powerSource ?? 'Not recorded'}
            </InfoRow>
          </dl>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Connectivity history</h2>
              <p className="panel__subtitle">
                Heartbeats, outages and reconnects
              </p>
            </div>
            <ClockIcon size={18} />
          </header>

          {visibleConnectivity.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">
                No connectivity history recorded
              </span>
              <span className="empty-state__hint">
                This demo device has no heartbeat or outage events yet.
              </span>
            </div>
          ) : (
            <ul className="connectivity-list">
              {visibleConnectivity.map((entry, index) => (
                <li
                  className={`connectivity-event connectivity-event--${entry.state}`}
                  key={`${entry.at}-${entry.state}-${index}`}
                >
                  <span className="connectivity-event__dot" aria-hidden="true" />
                  <div className="connectivity-event__body">
                    <div className="connectivity-event__head">
                      <strong>
                        {entry.state === 'online'
                          ? 'Online heartbeat'
                          : entry.state === 'stale'
                            ? 'Heartbeat stale'
                            : 'Connection lost'}
                      </strong>
                      {entry.shipmentId && (
                        <StatusBadge tone="muted">{entry.shipmentId}</StatusBadge>
                      )}
                      <span className="connectivity-event__time">
                        {formatRelativeMinutes(entry.ageMinutes)} ·{' '}
                        {formatDateTime(entry.at)}
                      </span>
                    </div>
                    <p>{entry.note}</p>
                    <span className="connectivity-event__meta">
                      Signal {entry.signal || '—'}
                      {entry.durationMinutes != null
                        ? ` · ${formatDurationMinutes(entry.durationMinutes)}`
                        : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {connectivityHistory.length > visibleConnectivity.length && (
            <p className="panel__footnote">
              Showing the latest {visibleConnectivity.length} of{' '}
              {connectivityHistory.length} connectivity events.
            </p>
          )}
        </section>
      </div>

      <section className="panel" aria-label="Recent device events">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">Recent device events</h2>
            <p className="panel__subtitle">
              Firmware, maintenance, assignment and system-alert history
            </p>
          </div>
          <StatusBadge tone="muted">{deviceEvents.length} recorded</StatusBadge>
        </header>

        {visibleEvents.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__title">No device events recorded</span>
            <span className="empty-state__hint">
              This demo device has no firmware, maintenance or device-alert
              history yet.
            </span>
          </div>
        ) : (
          <ul className="device-event-list">
            {visibleEvents.map((event, index) => (
              <li
                className={`device-event device-event--${severityTone(
                  event.severity,
                )}`}
                key={`${event.at}-${event.title}-${index}`}
              >
                <span className="device-event__dot" aria-hidden="true" />
                <div className="device-event__body">
                  <div className="device-event__head">
                    <strong>{event.title}</strong>
                    {event.shipmentId && (
                      <StatusBadge tone="muted">{event.shipmentId}</StatusBadge>
                    )}
                    {event.status && (
                      <StatusBadge
                        tone={event.status === 'resolved' ? 'ok' : 'warn'}
                      >
                        {event.status}
                      </StatusBadge>
                    )}
                  </div>
                  <p>{event.detail}</p>
                  <span className="device-event__meta">
                    {EVENT_SOURCE_LABEL[event.source] ?? 'Device'} ·{' '}
                    {formatRelativeMinutes(event.ageMinutes)} ·{' '}
                    {formatDateTime(event.at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {deviceEvents.length > visibleEvents.length && (
          <p className="panel__footnote">
            Showing the latest {visibleEvents.length} of {deviceEvents.length}{' '}
            device events.
          </p>
        )}

        <p className="panel__footnote">
          Device events describe hardware and connectivity. Cargo threshold
          alerts remain in the shipment and alert views.
        </p>
      </section>
    </div>
  )
}

export default DeviceDetail
