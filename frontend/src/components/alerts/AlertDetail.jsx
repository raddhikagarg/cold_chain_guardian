import { useState } from 'react'
import StatusBadge from '../StatusBadge.jsx'
import ShipmentTimeline from '../shipments/ShipmentTimeline.jsx'
import { ArrowLeftIcon, AlertTriangleIcon } from '../icons.jsx'
import {
  SEVERITY_META,
  STATUS_META,
  formatAlertTime,
  formatDuration,
  getAlertCondition,
  getAlertDurationMs,
  getAlertParameterMeta,
  getConfiguredThreshold,
  getRelatedIncident,
  getRelatedTimelineEvents,
} from '../../utils/alerts.js'
import { getShipmentMonitoringState } from '../../utils/shipments.js'
import './AlertDetail.css'

function incidentTone(severity) {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warn'
  return 'info'
}

function InfoRow({ term, children }) {
  return (
    <div className="info-list__row">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function AlertDetail({
  alert,
  notice,
  onDismissNotice,
  onBack,
  onAcknowledge,
  onResolve,
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const shipment = alert.shipment
  const severity = SEVERITY_META[alert.severity] ?? { label: alert.severity, tone: 'info' }
  const status = STATUS_META[alert.status] ?? { label: alert.status, tone: 'muted' }
  const parameter = getAlertParameterMeta(alert)
  const threshold = getConfiguredThreshold(shipment, alert)
  const condition = getAlertCondition(alert)
  const incident = getRelatedIncident(shipment, alert)
  const timelineEvents = getRelatedTimelineEvents(shipment, alert)
  const monitoring = getShipmentMonitoringState(shipment)
  const duration = formatDuration(getAlertDurationMs(alert))

  const unresolved = alert.status !== 'resolved'
  const canAcknowledge = alert.status === 'active'
  const needsResolutionWarning = condition.key === 'ongoing'

  const handleResolve = () => {
    if (needsResolutionWarning) {
      setConfirmOpen(true)
      return
    }
    onResolve(alert)
  }

  return (
    <div className="alerts-page alert-detail">
      <button type="button" className="page-back" onClick={onBack}>
        <ArrowLeftIcon size={14} />
        Back to alerts
      </button>

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

      <div className="alert-detail__header">
        <div className="page-head__text">
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            {alert.demo && (
              <span className="mock-chip alert-detail__demo-chip">Demo history</span>
            )}
            {alert.id} · {alert.source === 'cargo' ? 'Cargo alert' : 'System alert'}
          </div>
          <h1 className="page-head__title">{alert.title}</h1>
          <p className="page-head__subtitle">
            {shipment.id} · {shipment.cargo?.produce ?? 'Unknown cargo'} ·{' '}
            {parameter.label}
          </p>
          <div className="alert-detail__badges">
            <StatusBadge tone={severity.tone}>{severity.label}</StatusBadge>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {unresolved && (
              <StatusBadge tone={condition.tone}>{condition.label}</StatusBadge>
            )}
          </div>
        </div>

        <div className="alert-detail__actions">
          {unresolved ? (
            <>
              {canAcknowledge && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => onAcknowledge(alert)}
                >
                  Acknowledge
                </button>
              )}
              <button
                type="button"
                className="btn alert-detail__resolve"
                onClick={handleResolve}
              >
                Resolve alert
              </button>
              <p className="alert-detail__actions-hint">
                Acknowledge confirms the alert has been seen. Resolve once the
                condition has recovered or the issue has been addressed.
              </p>
            </>
          ) : (
            <div className="alert-detail__resolved-note">
              <StatusBadge tone="ok" dot>
                Resolved
              </StatusBadge>
              {alert.resolvedAt && (
                <span>{formatAlertTime(alert.resolvedAt)}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {confirmOpen && unresolved && needsResolutionWarning && (
        <div className="alert-confirm" role="alertdialog" aria-labelledby="alert-confirm-title">
          <div>
            <strong id="alert-confirm-title">Resolve without a recorded recovery?</strong>
            <p>
              This alert&apos;s condition is still marked as ongoing. Resolve only if
              the issue has been addressed some other way.
            </p>
          </div>
          <div className="alert-confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn alert-confirm__resolve"
              onClick={() => {
                setConfirmOpen(false)
                onResolve(alert)
              }}
            >
              Resolve anyway
            </button>
          </div>
        </div>
      )}

      <div className="alert-detail__grid">
        <section className="panel alert-detail__wide">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Alert details</h2>
              <p className="panel__subtitle">Full description and ownership</p>
            </div>
            <StatusBadge tone={alert.source === 'cargo' ? 'info' : 'muted'}>
              {alert.source === 'cargo' ? 'Cargo-specific' : 'System & device'}
            </StatusBadge>
          </header>

          <p className="alert-detail__message">{alert.message}</p>

          <dl className="info-list">
            <InfoRow term="Alert ID">{alert.id}</InfoRow>
            <InfoRow term="Shipment">
              {shipment.id} · {shipment.cargo?.produce ?? 'Unknown cargo'}
            </InfoRow>
            <InfoRow term="Sensor / parameter">
              {parameter.label} · {parameter.model}
            </InfoRow>
            <InfoRow term="Current status">
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            </InfoRow>
            {alert.demo && (
              <InfoRow term="Record origin">
                Illustrative resolved alert added for this prototype
              </InfoRow>
            )}
          </dl>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Measured vs configured</h2>
              <p className="panel__subtitle">
                Readings are compared with this shipment&apos;s own limits
              </p>
            </div>
          </header>

          <div className="alert-measure">
            <div className="alert-measure__cell">
              <span className="alert-measure__label">Measured value</span>
              <span className="alert-measure__value">{alert.reading}</span>
            </div>
            <div className="alert-measure__cell">
              <span className="alert-measure__label">Alert condition</span>
              <span className="alert-measure__condition">{alert.threshold}</span>
            </div>
          </div>

          <dl className="info-list alert-detail__facts">
            <InfoRow term="Peak recorded">
              {alert.peakReading ?? 'Not recorded'}
            </InfoRow>
            {threshold.rows.map((row) => (
              <InfoRow key={row.label} term={row.label}>
                {row.value}
              </InfoRow>
            ))}
            {threshold.escalation && (
              <InfoRow term="Escalation">{threshold.escalation}</InfoRow>
            )}
          </dl>

          {!threshold.configured && (
            <p className="alert-detail__hint">
              No threshold is configured for this parameter on this shipment, so
              no comparison limit is shown.
            </p>
          )}
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Condition &amp; duration</h2>
              <p className="panel__subtitle">How long the alert has been tracked</p>
            </div>
          </header>

          <dl className="info-list">
            <InfoRow term="Condition">
              <StatusBadge tone={condition.tone}>{condition.label}</StatusBadge>
            </InfoRow>
            <InfoRow term="Started">{formatAlertTime(alert.startedAt)}</InfoRow>
            <InfoRow term="Recovered">
              {alert.recoveredAt ? formatAlertTime(alert.recoveredAt) : 'No recovery recorded'}
            </InfoRow>
            <InfoRow term="Duration">
              {duration}
              {unresolved && !alert.recoveredAt ? ' and counting' : ''}
            </InfoRow>
            <InfoRow term="Acknowledged">
              {alert.acknowledgedAt ? formatAlertTime(alert.acknowledgedAt) : 'Not acknowledged'}
            </InfoRow>
            <InfoRow term="Resolved">
              {alert.resolvedAt ? formatAlertTime(alert.resolvedAt) : 'Not resolved'}
            </InfoRow>
          </dl>

          <p className="alert-detail__hint">{condition.detail}</p>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Shipment &amp; sensor</h2>
              <p className="panel__subtitle">Where this alert came from</p>
            </div>
          </header>

          <dl className="info-list">
            <InfoRow term="Shipment">{shipment.id}</InfoRow>
            <InfoRow term="Cargo">{shipment.cargo?.produce ?? '—'}</InfoRow>
            <InfoRow term="Carrier">{shipment.route?.carrier || 'Not assigned'}</InfoRow>
            <InfoRow term="Vehicle">{shipment.route?.vehicle || 'Not assigned'}</InfoRow>
            <InfoRow term="Route">
              {shipment.route?.origin || '—'} → {shipment.route?.destination || '—'}
            </InfoRow>
            <InfoRow term="Device">{shipment.deviceId ?? 'Unassigned'}</InfoRow>
            <InfoRow term="Sensor">{parameter.model}</InfoRow>
            <InfoRow term="Monitoring">
              <StatusBadge tone={monitoring.tone}>{monitoring.label}</StatusBadge>
            </InfoRow>
          </dl>
        </section>

        <section className="panel">
          <header className="panel__head">
            <div>
              <h2 className="panel__title">Related incident</h2>
              <p className="panel__subtitle">From this shipment&apos;s incident log</p>
            </div>
          </header>

          {incident ? (
            <article className={`alert-incident alert-incident--${incidentTone(incident.severity)}`}>
              <div className="alert-incident__head">
                <AlertTriangleIcon size={14} />
                <strong>{incident.title}</strong>
                <StatusBadge
                  tone={incident.resolved ? 'ok' : incidentTone(incident.severity)}
                >
                  {incident.resolved ? 'Resolved' : 'Open'}
                </StatusBadge>
              </div>
              <p className="alert-incident__description">{incident.description}</p>
              <span className="alert-incident__meta">
                {formatAlertTime(incident.time)} · {incident.id}
              </span>
            </article>
          ) : (
            <div className="empty-state">
              <span className="empty-state__title">No related incident recorded</span>
              <span className="empty-state__hint">
                This alert has no matching entry in the shipment&apos;s incident
                log.
              </span>
            </div>
          )}
        </section>
      </div>

      <section className="panel">
        <header className="panel__head">
          <div>
            <h2 className="panel__title">Related events</h2>
            <p className="panel__subtitle">
              Shipment timeline entries around when the alert started or recovered
            </p>
          </div>
        </header>

        {timelineEvents.length > 0 ? (
          <ShipmentTimeline events={timelineEvents} />
        ) : (
          <div className="empty-state">
            <span className="empty-state__title">No timeline entries nearby</span>
            <span className="empty-state__hint">
              No shipment events were recorded within ten minutes of this alert.
            </span>
          </div>
        )}
      </section>
    </div>
  )
}

export default AlertDetail
