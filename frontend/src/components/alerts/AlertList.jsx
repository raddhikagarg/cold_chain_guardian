import { useState } from 'react'
import StatusBadge from '../StatusBadge.jsx'
import {
  AlertTriangleIcon,
  InfoIcon,
  SearchIcon,
  ChevronRightIcon,
} from '../icons.jsx'
import { SENSOR_ICONS } from '../shipments/sensorIcons.jsx'
import {
  ALERT_HISTORY_NOTE,
  SEVERITY_META,
  STATUS_META,
  filterAlerts,
  formatAlertTime,
  getAlertParameterMeta,
  getDurationLabel,
  getParameterOptions,
  getShipmentOptions,
  sortAlerts,
  summarizeAlerts,
} from '../../utils/alerts.js'
import './AlertList.css'

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'All open statuses' },
  { value: 'active', label: 'Active' },
  { value: 'acknowledged', label: 'Acknowledged' },
]

function AlertIcon({ alert }) {
  const SensorIcon = SENSOR_ICONS[alert.parameter]
  if (SensorIcon) return <SensorIcon size={17} />
  if (alert.severity === 'info') return <InfoIcon size={17} />
  return <AlertTriangleIcon size={17} />
}

function AlertRow({ alert, onSelect }) {
  const severity = SEVERITY_META[alert.severity] ?? { label: alert.severity, tone: 'info' }
  const status = STATUS_META[alert.status] ?? { label: alert.status, tone: 'muted' }
  const parameter = getAlertParameterMeta(alert)

  return (
    <button
      type="button"
      className={`alert-row alert-row--${alert.severity}`}
      onClick={() => onSelect(alert.id)}
      aria-label={`Open alert ${alert.id}: ${alert.title}`}
    >
      <span className="alert-row__icon" aria-hidden="true">
        <AlertIcon alert={alert} />
      </span>

      <span className="alert-row__body">
        <span className="alert-row__title-line">
          <span className="alert-row__title">{alert.title}</span>
          <StatusBadge tone={severity.tone}>{severity.label}</StatusBadge>
          {alert.demo && (
            <span
              className="alert-row__demo"
              title="Illustrative resolved alert added for this prototype"
            >
              Demo history
            </span>
          )}
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </span>

        <span className="alert-row__sub">
          <span className="alert-row__shipment">
            {alert.shipment.id} · {alert.shipment.cargo?.produce ?? 'Unknown cargo'}
          </span>
          <span className="alert-row__sep" aria-hidden="true">
            ·
          </span>
          <span>{parameter.label}</span>
          <span className="alert-row__sep" aria-hidden="true">
            ·
          </span>
          <span className="alert-row__reading">{alert.reading}</span>
        </span>

        <span className="alert-row__meta">
          <span>{alert.threshold}</span>
          <span className="alert-row__sep" aria-hidden="true">
            ·
          </span>
          <span>Since {formatAlertTime(alert.startedAt)}</span>
          <span className="alert-row__sep" aria-hidden="true">
            ·
          </span>
          <span>{getDurationLabel(alert)}</span>
        </span>
      </span>

      <span className="alert-row__chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  )
}

function AlertList({ alerts, tab, onTabChange, onSelect }) {
  const [query, setQuery] = useState('')
  const [severity, setSeverity] = useState('all')
  const [shipmentId, setShipmentId] = useState('all')
  const [parameter, setParameter] = useState('all')
  const [status, setStatus] = useState('all')

  const summary = summarizeAlerts(alerts)
  const shipmentOptions = getShipmentOptions(alerts)
  const parameterOptions = getParameterOptions(alerts)

  const scoped = alerts.filter((alert) =>
    tab === 'history' ? alert.status === 'resolved' : alert.status !== 'resolved',
  )
  const filtered = sortAlerts(
    filterAlerts(alerts, { tab, query, severity, shipmentId, parameter, status }),
    tab,
  )

  const hasFilters =
    query !== '' ||
    severity !== 'all' ||
    shipmentId !== 'all' ||
    parameter !== 'all' ||
    status !== 'all'

  const resetFilters = () => {
    setQuery('')
    setSeverity('all')
    setShipmentId('all')
    setParameter('all')
    setStatus('all')
  }

  const handleTabChange = (nextTab) => {
    setStatus('all')
    onTabChange(nextTab)
  }

  const showHistoryNote = tab === 'history' && alerts.some((alert) => alert.demo)

  return (
    <section className="panel alert-list" aria-label="Alert queue">
      <header className="alert-list__head">
        <div className="alert-list__heading">
          <h2 className="panel__title">Alert queue</h2>
          <p className="panel__subtitle">
            Thresholds come from each shipment&apos;s configured monitoring ranges
          </p>
        </div>

        <div className="alert-tabs" role="tablist" aria-label="Alert views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'active'}
            className={`alert-tabs__tab${tab === 'active' ? ' alert-tabs__tab--active' : ''}`}
            onClick={() => handleTabChange('active')}
          >
            Active queue
            <span className="alert-tabs__count">{summary.active}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            className={`alert-tabs__tab${tab === 'history' ? ' alert-tabs__tab--active' : ''}`}
            onClick={() => handleTabChange('history')}
          >
            History
            <span className="alert-tabs__count">{summary.resolved}</span>
          </button>
        </div>
      </header>

      <div className="alert-list__filters">
        <label className="search-box">
          <SearchIcon size={15} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, shipment, sensor"
            aria-label="Search alerts"
          />
        </label>

        <select
          className="filter-select"
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          aria-label="Filter alerts by severity"
        >
          <option value="all">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <select
          className="filter-select"
          value={shipmentId}
          onChange={(event) => setShipmentId(event.target.value)}
          aria-label="Filter alerts by shipment"
        >
          <option value="all">All shipments</option>
          {shipmentOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="filter-select"
          value={parameter}
          onChange={(event) => setParameter(event.target.value)}
          aria-label="Filter alerts by sensor or parameter"
        >
          <option value="all">All sensors</option>
          {parameterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {tab === 'active' && (
          <select
            className="filter-select"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter alerts by status"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}

        {hasFilters && (
          <button type="button" className="btn btn--quiet" onClick={resetFilters}>
            Reset filters
          </button>
        )}
      </div>

      <div className="alert-list__count">
        {filtered.length} of {scoped.length}{' '}
        {tab === 'history' ? 'resolved alerts' : 'open alerts'} shown
      </div>

      {showHistoryNote && <p className="alert-list__note">{ALERT_HISTORY_NOTE}</p>}

      <div className="alert-list__rows">
        {filtered.map((alert) => (
          <AlertRow key={alert.id} alert={alert} onSelect={onSelect} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <span className="empty-state__title">
            {tab === 'history'
              ? hasFilters
                ? 'No resolved alerts match those filters'
                : 'No resolved alerts yet'
              : hasFilters
                ? 'No alerts match those filters'
                : 'No active alerts'}
          </span>
          <span className="empty-state__hint">
            {tab === 'history'
              ? 'Alerts stay here after they are resolved so the history remains complete.'
              : hasFilters
                ? 'Try a different search term or reset the filters.'
                : 'Every monitored reading is within its configured range.'}
          </span>
          {hasFilters && (
            <button type="button" className="btn btn--ghost" onClick={resetFilters}>
              Reset filters
            </button>
          )}
        </div>
      )}
    </section>
  )
}

export default AlertList
