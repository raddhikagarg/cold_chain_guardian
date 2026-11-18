import { useEffect, useState } from 'react'
import MetricCard from '../components/MetricCard.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import HistoryDetail from '../components/history/HistoryDetail.jsx'
import {
  AlertTriangleIcon,
  BoxIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  LeafIcon,
  MapPinIcon,
  SearchIcon,
} from '../components/icons.jsx'
import { CARGO_CATEGORIES } from '../data/shipmentData.js'
import {
  HISTORY_DATE_OPTIONS,
  HISTORY_STATUS_OPTIONS,
  filterHistory,
  formatDeliveredAt,
  getCompletionInfo,
  getHistoryCarrierOptions,
  getHistoricalShipments,
  getShipmentRecordCounts,
  sortHistory,
  summarizeHistory,
} from '../utils/history.js'
import { getStatusMeta } from '../utils/shipments.js'
import '../components/shipments/ShipmentList.css'
import './HistoryPage.css'

function categoryLabel(id) {
  return CARGO_CATEGORIES.find((category) => category.id === id)?.label ?? id
}

function HistoryRow({ shipment, onSelect }) {
  const status = getStatusMeta(shipment.status)
  const completion = getCompletionInfo(shipment)
  const counts = getShipmentRecordCounts(shipment)

  return (
    <button
      type="button"
      className="shipment-row history-row"
      onClick={() => onSelect(shipment.id)}
      aria-label={`Open historical shipment ${shipment.id}, ${shipment.cargo.produce}`}
    >
      <span className="history-row__cell history-row__cell--identity">
        <span className="history-row__id">
          {shipment.id}
          {shipment.demo && (
            <span className="mock-chip history-row__demo">Demo</span>
          )}
        </span>
        <span className="shipment-row__produce">
          <LeafIcon size={13} />
          {shipment.cargo.produce}
        </span>
        <span className="shipment-row__category">
          {categoryLabel(shipment.cargo.category)} · {shipment.cargo.quantity}{' '}
          {shipment.cargo.unit}
        </span>
      </span>

      <span className="history-row__cell history-row__cell--route">
        <span className="shipment-row__route-line">
          <MapPinIcon size={12} />
          {shipment.route.origin}
        </span>
        <span className="shipment-row__route-dest">
          → {shipment.route.destination}
        </span>
        <span className="history-row__secondary">
          {shipment.route.carrier || 'Carrier not recorded'}
        </span>
      </span>

      <span className="history-row__cell history-row__cell--completion">
        <span className="history-row__primary">
          {formatDeliveredAt(shipment)}
        </span>
        <span className="history-row__secondary">
          {completion.sourceLabel}
        </span>
      </span>

      <span className="history-row__cell history-row__cell--records">
        <span className="history-row__primary">
          {counts.alerts} alerts
          {counts.openAlerts > 0 ? ` · ${counts.openAlerts} open` : ''}
        </span>
        <span className="history-row__secondary">
          {counts.incidents} incidents retained
        </span>
      </span>

      <span className="history-row__cell history-row__cell--status">
        <StatusBadge tone={status.tone} dot>
          {status.label}
        </StatusBadge>
      </span>

      <span className="shipment-row__chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  )
}

/**
 * History section: completed and archived shipments, with full retained
 * records. Delivery is never inferred from the planned arrival date; only an
 * explicit operator confirmation or confirmed delivery event creates history.
 */
function HistoryPage({ shipments, onArchiveShipment }) {
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [notice, setNotice] = useState(null)

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [carrierFilter, setCarrierFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState('all')

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedId])

  const history = getHistoricalShipments(shipments)
  const summary = summarizeHistory(history)
  const carrierOptions = getHistoryCarrierOptions(shipments)

  const recordTotals = history.reduce(
    (totals, shipment) => {
      const counts = getShipmentRecordCounts(shipment)
      totals.alerts += counts.alerts
      totals.openAlerts += counts.openAlerts
      totals.incidents += counts.incidents
      return totals
    },
    { alerts: 0, openAlerts: 0, incidents: 0 },
  )

  const selectedShipment =
    history.find((shipment) => shipment.id === selectedId) ?? null

  const filtered = sortHistory(
    filterHistory(history, {
      query,
      status: statusFilter,
      category: categoryFilter,
      carrier: carrierFilter,
      dateRange: dateFilter,
    }),
  )

  const hasFilters =
    query !== '' ||
    statusFilter !== 'all' ||
    categoryFilter !== 'all' ||
    carrierFilter !== 'all' ||
    dateFilter !== 'all'

  const resetFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setCarrierFilter('all')
    setDateFilter('all')
  }

  const handleArchive = (shipmentId) => {
    onArchiveShipment(shipmentId)
    setNotice({
      tone: 'success',
      text: `${shipmentId} archived. All readings, alerts, incidents and timeline events were retained.`,
    })
  }

  if (view === 'detail' && selectedShipment) {
    return (
      <HistoryDetail
        shipment={selectedShipment}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onArchive={handleArchive}
        onBack={() => {
          setView('list')
          setNotice(null)
        }}
      />
    )
  }

  return (
    <div className="history-page">
      <div className="page-head">
        <div className="page-head__text">
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            Audit &amp; retention
          </div>
          <h1 className="page-head__title">Shipment history</h1>
          <p className="page-head__subtitle">
            Completed and archived shipments with their full records. Delivery
            is recorded only through explicit operator confirmation or a
            confirmed delivery event — never inferred from the planned arrival
            date.
          </p>
        </div>
      </div>

      <section className="metrics" aria-label="History summary">
        <MetricCard
          label="Completed"
          value={summary.completed}
          icon={<CheckIcon size={18} />}
          tone="ok"
          status="Delivery confirmed"
          hint="Operator confirmation or delivery event"
        />
        <MetricCard
          label="Archived"
          value={summary.archived}
          icon={<ClockIcon size={18} />}
          tone="muted"
          status="Read-only"
          hint="Full records retained"
        />
        <MetricCard
          label="Open alerts retained"
          value={recordTotals.openAlerts}
          icon={<AlertTriangleIcon size={18} />}
          tone={recordTotals.openAlerts > 0 ? 'warn' : 'ok'}
          status="Not auto-resolved"
          hint={`${recordTotals.alerts} total alerts kept with records`}
        />
        <MetricCard
          label="Historical records"
          value={summary.total}
          icon={<BoxIcon size={18} />}
          tone="info"
          status="Retained"
          hint={`${recordTotals.incidents} incidents · nothing deleted`}
        />
      </section>

      <section className="panel shipment-list" aria-label="Historical shipments">
        <header className="shipment-list__head">
          <div>
            <h2 className="panel__title">Historical records</h2>
            <p className="panel__subtitle">
              {filtered.length} of {history.length} records shown
            </p>
          </div>

          <div className="shipment-list__filters">
            <label className="search-box">
              <SearchIcon size={15} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search ID, produce, batch, route"
                aria-label="Search historical shipments"
              />
            </label>

            <select
              className="filter-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter history by record status"
            >
              {HISTORY_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Filter history by cargo category"
            >
              <option value="all">All cargo</option>
              {CARGO_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={carrierFilter}
              onChange={(event) => setCarrierFilter(event.target.value)}
              aria-label="Filter history by carrier"
            >
              <option value="all">All carriers</option>
              {carrierOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value)}
              aria-label="Filter history by completion date"
            >
              {HISTORY_DATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="history-table">
          <div className="history-table__header" aria-hidden="true">
            <span>Shipment</span>
            <span>Route</span>
            <span>Completed</span>
            <span>Retained records</span>
            <span>Status</span>
            <span />
          </div>

          {filtered.map((shipment) => (
            <HistoryRow
              key={shipment.id}
              shipment={shipment}
              onSelect={(id) => {
                setSelectedId(id)
                setNotice(null)
                setView('detail')
              }}
            />
          ))}

          {filtered.length === 0 && (
            <div className="empty-state">
              <span className="empty-state__title">
                No historical records match those filters
              </span>
              <span className="empty-state__hint">
                Completed shipments appear here after an explicit delivery
                confirmation. Try a different search term or reset the filters.
              </span>
              {hasFilters && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={resetFilters}
                >
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>

        <p className="panel__footnote">
          Demo records are labelled. Charts on historical details are simulated
          historical readings, not actual recorded sensor data. Retention
          defaults are informational only — this prototype never deletes,
          expires or hides records automatically.
        </p>
      </section>
    </div>
  )
}

export default HistoryPage
