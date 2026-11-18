import { useState } from 'react'
import MetricCard from '../MetricCard.jsx'
import StatusBadge from '../StatusBadge.jsx'
import {
  PlusIcon,
  SearchIcon,
  ChevronRightIcon,
  BoxIcon,
  TruckIcon,
  AlertTriangleIcon,
  BellIcon,
  LeafIcon,
  MapPinIcon,
  CpuIcon,
} from '../icons.jsx'
import { CARGO_CATEGORIES, SENSOR_IDS } from '../../data/shipmentData.js'
import {
  STATUS_FILTER_OPTIONS,
  getStatusMeta,
  isMonitoringConfigured,
  summarizeShipments,
} from '../../utils/shipments.js'
import './ShipmentList.css'

function categoryLabel(id) {
  return CARGO_CATEGORIES.find((category) => category.id === id)?.label ?? id
}

function needsConfiguration(shipment) {
  return SENSOR_IDS.some(
    (id) =>
      shipment.monitoring?.[id]?.enabled &&
      !isMonitoringConfigured(shipment.monitoring[id]),
  )
}

function ShipmentRow({ shipment, onSelect }) {
  const status = getStatusMeta(shipment.status)
  const progress = shipment.route?.progress ?? 0
  const unconfigured = needsConfiguration(shipment)

  return (
    <button
      type="button"
      className="shipment-row"
      onClick={() => onSelect(shipment.id)}
      aria-label={`Open shipment ${shipment.id}, ${shipment.cargo.produce}`}
    >
      <span className="shipment-row__cell shipment-row__cell--identity">
        <span className="shipment-row__id">{shipment.id}</span>
        <span className="shipment-row__produce">
          <LeafIcon size={13} />
          {shipment.cargo.produce}
        </span>
        <span className="shipment-row__category">
          {categoryLabel(shipment.cargo.category)} · {shipment.cargo.quantity}{' '}
          {shipment.cargo.unit}
        </span>
      </span>

      <span className="shipment-row__cell shipment-row__cell--route">
        <span className="shipment-row__route-line">
          <MapPinIcon size={12} />
          {shipment.route.origin}
        </span>
        <span className="shipment-row__route-dest">→ {shipment.route.destination}</span>
      </span>

      <span className="shipment-row__cell shipment-row__cell--device">
        <CpuIcon size={13} />
        {shipment.deviceId ?? <span className="shipment-row__muted">Unassigned</span>}
      </span>

      <span className="shipment-row__cell shipment-row__cell--progress">
        <span className="shipment-progress">
          <span
            className="shipment-progress__fill"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </span>
        <span className="shipment-progress__label">{progress}%</span>
      </span>

      <span className="shipment-row__cell shipment-row__cell--status">
        <StatusBadge tone={status.tone} dot>
          {status.label}
        </StatusBadge>
        {unconfigured && <StatusBadge tone="warn">Needs config</StatusBadge>}
      </span>

      <span className="shipment-row__chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  )
}

function ShipmentList({ shipments, onAdd, onSelect }) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  const summary = summarizeShipments(shipments)

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = shipments.filter((shipment) => {
    if (statusFilter !== 'all' && shipment.status !== statusFilter) return false
    if (categoryFilter !== 'all' && shipment.cargo.category !== categoryFilter) {
      return false
    }
    if (!normalizedQuery) return true
    const haystack = [
      shipment.id,
      shipment.cargo.produce,
      shipment.cargo.category,
      shipment.route.origin,
      shipment.route.destination,
      shipment.route.carrier,
      shipment.deviceId ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return haystack.includes(normalizedQuery)
  })

  const hasFilters =
    query !== '' || statusFilter !== 'all' || categoryFilter !== 'all'

  const resetFilters = () => {
    setQuery('')
    setStatusFilter('all')
    setCategoryFilter('all')
  }

  return (
    <div className="shipments-page">
      <div className="page-head">
        <div className="page-head__text">
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            Cold-chain operations
          </div>
          <h1 className="page-head__title">All Shipments</h1>
          <p className="page-head__subtitle">
            Fruits and vegetables moving through the cold chain. All records and
            monitoring limits in this prototype are demonstration data.
          </p>
        </div>

        <button type="button" className="btn btn--primary" onClick={onAdd}>
          <PlusIcon size={16} />
          Add Shipment
        </button>
      </div>

      <section className="metrics" aria-label="Shipment summary">
        <MetricCard
          label="Total Active"
          value={summary.totalActive}
          icon={<BoxIcon size={18} />}
          tone="info"
          status="In the pipeline"
          hint="Scheduled, transit, warning & critical"
        />
        <MetricCard
          label="In Transit"
          value={summary.inTransit}
          icon={<TruckIcon size={18} />}
          tone="ok"
          status="On the road"
          hint="No warning or critical alerts"
        />
        <MetricCard
          label="Warning"
          value={summary.warning}
          icon={<AlertTriangleIcon size={18} />}
          tone="warn"
          status="Review"
          hint="Configured warning thresholds crossed"
        />
        <MetricCard
          label="Critical"
          value={summary.critical}
          icon={<BellIcon size={18} />}
          tone="critical"
          status="Action needed"
          hint="Critical cargo or device alerts active"
        />
      </section>

      <section className="panel shipment-list" aria-label="Shipment list">
        <header className="shipment-list__head">
          <div>
            <h2 className="panel__title">Shipment list</h2>
            <p className="panel__subtitle">
              {filtered.length} of {shipments.length} shipments shown
            </p>
          </div>

          <div className="shipment-list__filters">
            <label className="search-box">
              <SearchIcon size={15} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search ID, produce, route"
                aria-label="Search shipments"
              />
            </label>

            <select
              className="filter-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter shipments by status"
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              aria-label="Filter shipments by cargo category"
            >
              <option value="all">All cargo</option>
              {CARGO_CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <div className="shipment-table">
          <div className="shipment-table__header" aria-hidden="true">
            <span>Shipment</span>
            <span>Route</span>
            <span>Device</span>
            <span>Progress</span>
            <span>Status</span>
            <span />
          </div>

          {filtered.map((shipment) => (
            <ShipmentRow
              key={shipment.id}
              shipment={shipment}
              onSelect={onSelect}
            />
          ))}

          {filtered.length === 0 && (
            <div className="empty-state">
              <span className="empty-state__title">No shipments match those filters</span>
              <span className="empty-state__hint">
                Try a different search term or reset the filters to see all
                demonstration shipments.
              </span>
              {hasFilters && (
                <button type="button" className="btn btn--ghost" onClick={resetFilters}>
                  Reset filters
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

export default ShipmentList