import { useState } from 'react'
import StatusBadge from '../StatusBadge.jsx'
import SensorAnalytics from '../shipments/SensorAnalytics.jsx'
import ExposureSummary from '../shipments/ExposureSummary.jsx'
import ShipmentTimelineCard from '../shipments/ShipmentTimelineCard.jsx'
import {
  ArrowLeftIcon,
  AlertTriangleIcon,
  CheckIcon,
  ClockIcon,
} from '../icons.jsx'
import { CARGO_CATEGORIES, SENSOR_CATALOG } from '../../data/shipmentData.js'
import { formatDateTime, getStatusMeta } from '../../utils/shipments.js'
import {
  RETENTION_DEFAULTS,
  RETENTION_NOTE,
  canArchiveShipment,
  formatJourneyDuration,
  getCompletionInfo,
  getLifecycleLabel,
  getShipmentRecordCounts,
  isArchivedShipment,
} from '../../utils/history.js'
import '../shipments/ShipmentDetail.css'
import './HistoryDetail.css'

const ALERT_STATUS_META = {
  active: { label: 'Active', tone: 'critical' },
  acknowledged: { label: 'Acknowledged', tone: 'warn' },
  resolved: { label: 'Resolved', tone: 'ok' },
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

/**
 * Read-only historical record view. Shows the full retained record: every
 * alert (resolved or not), incidents, timeline events and clearly labelled
 * simulated historical readings. The archive action never deletes data.
 */
function HistoryDetail({
  shipment,
  notice,
  onDismissNotice,
  onBack,
  onArchive,
}) {
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  const status = getStatusMeta(shipment.status)
  const completion = getCompletionInfo(shipment)
  const counts = getShipmentRecordCounts(shipment)
  const archived = isArchivedShipment(shipment)
  const archiveEligible = canArchiveShipment(shipment)
  const category =
    CARGO_CATEGORIES.find((item) => item.id === shipment.cargo.category)?.label ??
    shipment.cargo.category

  const alerts = shipment.alerts ?? []
  const incidents = shipment.incidents ?? []
  const unresolvedAlerts = alerts.filter((alert) => alert.status !== 'resolved')
  const progress = shipment.route?.progress ?? 0

  const handleArchive = () => {
    setConfirmingArchive(false)
    onArchive(shipment.id)
  }

  return (
    <div className="history-page">
      {notice && (
        <div className={`notice notice--${notice.tone}`}>
          <span>{notice.text}</span>
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
            Back to history
          </button>
          <div className="page-head__eyebrow">
            {shipment.demo && <span className="mock-chip">Demo record</span>}
            {getLifecycleLabel(shipment.status)}
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
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <StatusBadge tone="muted">
            {counts.alerts} alerts · {counts.incidents} incidents retained
          </StatusBadge>
        </div>
      </div>

      <div
        className={`monitor-banner${
          archived ? '' : ' monitor-banner--ok'
        }`}
      >
        <span className="monitor-banner__icon" aria-hidden="true">
          {archived ? <ClockIcon size={18} /> : <CheckIcon size={18} />}
        </span>
        <div className="monitor-banner__text">
          <strong>
            {archived ? 'Archived shipment record' : 'Completed shipment'}
          </strong>
          <span>
            {formatDateTime(completion.completedAt)} · {completion.sourceLabel}
            {' · '}
            {formatJourneyDuration(shipment)} journey
          </span>
          {completion.archivedAt && (
            <span>Archived {formatDateTime(completion.archivedAt)}</span>
          )}
        </div>
        <span className="monitor-banner__meta">
          {archived ? 'Read-only record' : 'Retained in history'}
        </span>
      </div>

      {shipment.demo && (
        <div className="notice notice--info history-detail__demo">
          <span className="mock-chip">Demo record</span>
          <span>
            Historical demo data. The sensor charts are simulated historical
            readings generated for this prototype — they are not actual
            recorded sensor data. Every alert, incident, timeline event and
            reading stays attached when the record is archived.
          </span>
        </div>
      )}

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Shipment information</h2>
              <p className="panel__subtitle">
                Cargo and completion details retained with this record
              </p>
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
            <InfoRow term="Device">
              <span className="mono">{shipment.deviceId ?? 'Unassigned'}</span>
            </InfoRow>
            <InfoRow term="Created">{formatDateTime(shipment.createdAt)}</InfoRow>
            <InfoRow term="Shipment status">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </InfoRow>
            <InfoRow term="Delivery recorded">
              {formatDateTime(completion.completedAt)}
            </InfoRow>
            <InfoRow term="Completion source">
              {completion.sourceLabel}
            </InfoRow>
            {completion.archivedAt && (
              <InfoRow term="Archived">
                {formatDateTime(completion.archivedAt)}
              </InfoRow>
            )}
          </dl>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Route &amp; schedule</h2>
              <p className="panel__subtitle">
                Planned route details are kept for audit
              </p>
            </div>
          </header>
          <dl className="info-list">
            <InfoRow term="Origin">{shipment.route.origin || '—'}</InfoRow>
            <InfoRow term="Destination">
              {shipment.route.destination || '—'}
            </InfoRow>
            <InfoRow term="Carrier" muted={!shipment.route.carrier}>
              {shipment.route.carrier || 'Not assigned'}
            </InfoRow>
            <InfoRow term="Vehicle" muted={!shipment.route.vehicle}>
              {shipment.route.vehicle || 'Not assigned'}
            </InfoRow>
            <InfoRow term="Planned departure">
              {formatDateTime(shipment.route.departure)}
            </InfoRow>
            <InfoRow term="Planned arrival">
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
              aria-label="Recorded route progress"
            >
              <span
                className="detail-progress__fill"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        </section>
      </div>

      <SensorAnalytics shipment={shipment} />

      <ExposureSummary shipment={shipment} />

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Alerts retained</h2>
              <p className="panel__subtitle">
                All alerts stay attached after delivery and archiving
              </p>
            </div>
            <StatusBadge tone={unresolvedAlerts.length > 0 ? 'critical' : 'ok'}>
              {unresolvedAlerts.length} unresolved ·{' '}
              {alerts.length - unresolvedAlerts.length} resolved
            </StatusBadge>
          </header>

          {alerts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">No alerts recorded</span>
              <span className="empty-state__hint">
                This shipment completed without any cargo or system alerts.
              </span>
            </div>
          ) : (
            <div className="alert-stack">
              {['cargo', 'system'].map((source) => {
                const sourceAlerts = alerts.filter(
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

                    {sourceAlerts.map((alert) => {
                      const alertStatus =
                        ALERT_STATUS_META[alert.status] ??
                        ALERT_STATUS_META.active
                      return (
                        <article
                          key={alert.id}
                          className={`alert-card alert-card--${severityTone(
                            alert.severity,
                          )}`}
                        >
                          <div className="alert-card__head">
                            <AlertTriangleIcon size={14} />
                            <span className="mono">{alert.id}</span>
                            <strong>{alert.title}</strong>
                            {alert.demo && (
                              <span className="mock-chip">Demo history</span>
                            )}
                            <StatusBadge tone={alertStatus.tone}>
                              {alertStatus.label}
                            </StatusBadge>
                          </div>
                          <p className="alert-card__message">{alert.message}</p>
                          <div className="alert-card__meta">
                            <span>Reading: {alert.reading}</span>
                            <span>{alert.threshold}</span>
                            <span>
                              Started {formatDateTime(alert.startedAt)}
                            </span>
                            {alert.recoveredAt && (
                              <span>
                                Recovered {formatDateTime(alert.recoveredAt)}
                              </span>
                            )}
                            {alert.resolvedAt && (
                              <span>
                                Resolved {formatDateTime(alert.resolvedAt)}
                              </span>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}

          <p className="panel__footnote">
            Confirming delivery never resolves alerts automatically. An
            unresolved alert stays in the alert queue until an operator
            resolves it.
          </p>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Incident history</h2>
              <p className="panel__subtitle">
                Chronological log retained with this record
              </p>
            </div>
            <StatusBadge tone="muted">
              {incidents.length} recorded
            </StatusBadge>
          </header>

          {incidents.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__title">No incidents recorded</span>
              <span className="empty-state__hint">
                No excursions, door openings or shocks were logged for this
                shipment.
              </span>
            </div>
          ) : (
            <ul className="incident-list">
              {incidents.map((incident) => (
                <li
                  key={incident.id}
                  className={`incident incident--${severityTone(
                    incident.severity,
                  )}`}
                >
                  <div className="incident__head">
                    <span className="incident__dot" aria-hidden="true" />
                    <strong>{incident.title}</strong>
                    <StatusBadge
                      tone={
                        incident.resolved
                          ? 'ok'
                          : severityTone(incident.severity)
                      }
                    >
                      {incident.resolved ? 'Resolved' : 'Open'}
                    </StatusBadge>
                  </div>
                  <p className="incident__description">
                    {incident.description}
                  </p>
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

      <ShipmentTimelineCard events={shipment.timeline} />

      <div className="detail-grid detail-grid--split">
        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Retention</h2>
              <p className="panel__subtitle">
                Informational defaults, not deletion rules
              </p>
            </div>
          </header>
          <dl className="info-list">
            {RETENTION_DEFAULTS.map((item) => (
              <InfoRow key={item.label} term={item.label}>
                {item.value}
              </InfoRow>
            ))}
          </dl>
          <p className="panel__footnote">{RETENTION_NOTE}</p>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Lifecycle actions</h2>
              <p className="panel__subtitle">
                Archiving keeps the complete record
              </p>
            </div>
          </header>

          {archiveEligible ? (
            <>
              <p className="history-actions__copy">
                Archiving moves this completed shipment to the Archived view.
                Readings, alerts, incidents and timeline events are all
                retained — nothing is deleted.
              </p>

              {confirmingArchive ? (
                <div className="history-actions__confirm">
                  <p>
                    <strong>Archive {shipment.id}?</strong> The record becomes
                    read-only in History, but every alert, incident, timeline
                    event and reading stays available.
                  </p>
                  <div className="lifecycle-actions__buttons">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={handleArchive}
                    >
                      Confirm archive
                    </button>
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={() => setConfirmingArchive(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setConfirmingArchive(true)}
                >
                  Archive shipment
                </button>
              )}
            </>
          ) : archived ? (
            <div className="empty-state">
              <span className="empty-state__title">Archived — read-only</span>
              <span className="empty-state__hint">
                This record is retained in full. Archived records cannot be
                edited in this prototype.
              </span>
            </div>
          ) : (
            <p className="history-actions__copy">
              Only completed shipments can be archived.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

export default HistoryDetail
