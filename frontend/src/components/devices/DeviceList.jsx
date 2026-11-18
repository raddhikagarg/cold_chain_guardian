import StatusBadge from '../StatusBadge.jsx'
import {
  ChevronRightIcon,
  CpuIcon,
  SearchIcon,
  WifiIcon,
} from '../icons.jsx'
import {
  ASSIGNMENT_FILTER_OPTIONS,
  CONNECTIVITY_FILTER_OPTIONS,
  HEALTH_FILTER_OPTIONS,
} from '../../utils/devices.js'
import {
  formatRelativeMinutes,
  getBatteryState,
} from '../../utils/deviceState.js'
import { getStatusMeta } from '../../utils/shipments.js'

const CONNECTION_META = {
  online: { label: 'Online', tone: 'ok' },
  stale: { label: 'Stale', tone: 'warn' },
  offline: { label: 'Offline', tone: 'critical' },
}

function sensorSummary(device) {
  const { sensorIssueCount, connectionState } = device
  if (connectionState !== 'online') {
    return `${sensorIssueCount} unknown · last known retained`
  }
  if (sensorIssueCount > 0) {
    return `${sensorIssueCount} need attention`
  }
  return 'All self-tests verified'
}

function DeviceRow({ device, onSelect }) {
  const connection = CONNECTION_META[device.connectionState] ?? CONNECTION_META.offline
  const batteryState = getBatteryState(device.battery)
  const assignment = device.currentAssignment
  const assignmentStatus = assignment ? getStatusMeta(assignment.status) : null

  return (
    <button
      type="button"
      className="device-row"
      onClick={() => onSelect(device.id)}
      aria-label={`Open device ${device.id}, ${device.name}, ${device.health.label}`}
    >
      <span className="device-row__cell device-row__cell--identity">
        <span className="device-row__id">
          <CpuIcon size={13} />
          {device.id}
          {device.assignmentConflict && (
            <StatusBadge tone="critical">Conflict</StatusBadge>
          )}
        </span>
        <span className="device-row__name">{device.name}</span>
        <span className="device-row__serial mono">
          {device.hardware?.serial ?? 'Serial not recorded'}
        </span>
      </span>

      <span className="device-row__cell device-row__cell--health">
        <StatusBadge tone={device.health.tone} dot>
          {device.health.label}
        </StatusBadge>
        <span className="device-row__secondary device-row__secondary--clamp">
          {device.health.detail}
        </span>
      </span>

      <span className="device-row__cell device-row__cell--connectivity">
        <span className="device-row__primary">
          <span
            className={`connection-dot connection-dot--${connection.tone}`}
            aria-hidden="true"
          />
          {connection.label}
        </span>
        <span className="device-row__secondary">
          <WifiIcon size={12} /> {device.connectivity} · {device.signal}
        </span>
        <span className="device-row__secondary">
          Last seen {formatRelativeMinutes(device.lastSeenAgeMinutes)}
        </span>
      </span>

      <span className="device-row__cell device-row__cell--battery">
        <span className="device-row__primary">{device.battery}%</span>
        <span className="battery-meter" aria-hidden="true">
          <span
            className={`battery-meter__fill battery-meter__fill--${batteryState}`}
            style={{ width: `${Math.max(0, Math.min(100, device.battery))}%` }}
          />
        </span>
        <span className={`device-row__secondary battery-label battery-label--${batteryState}`}>
          {batteryState === 'low' || batteryState === 'critical'
            ? batteryState === 'critical'
              ? 'Critical'
              : 'Low battery'
            : 'Normal'}
        </span>
      </span>

      <span className="device-row__cell device-row__cell--assignment">
        {assignment ? (
          <>
            <span className="device-row__primary mono">{assignment.id}</span>
            <span className="device-row__secondary device-row__secondary--clamp">
              {assignment.cargo?.produce ?? 'Shipment'} ·{' '}
              {assignmentStatus?.label ?? assignment.status}
            </span>
          </>
        ) : (
          <>
            <span className="device-row__primary device-row__unassigned">
              Unassigned
            </span>
            <span className="device-row__secondary">
              {device.connectionState === 'online'
                ? 'Available for assignment'
                : device.connectionState === 'stale'
                  ? 'Stale — not assignable'
                  : 'Offline — not assignable'}
            </span>
          </>
        )}
      </span>

      <span className="device-row__cell device-row__cell--sensors">
        <span className="device-row__primary">
          {device.sensorFittedCount} fitted
        </span>
        <span
          className={`device-row__secondary${
            device.sensorIssueCount > 0 ? ' is-attention' : ''
          }`}
        >
          {sensorSummary(device)}
        </span>
      </span>

      <span className="shipment-row__chevron" aria-hidden="true">
        <ChevronRightIcon size={16} />
      </span>
    </button>
  )
}

function DeviceList({
  devices,
  total,
  filters,
  onFilterChange,
  onResetFilters,
  onSelect,
}) {
  const hasFilters =
    filters.query !== '' ||
    filters.connectivity !== 'all' ||
    filters.assignment !== 'all' ||
    filters.health !== 'all'

  return (
    <section className="panel device-list-panel" aria-label="ESP32 device registry">
      <header className="device-list__head">
        <div>
          <h2 className="panel__title">ESP32 registry</h2>
          <p className="panel__subtitle">
            {devices.length} of {total} devices shown · attention-first order
          </p>
        </div>

        <div className="device-list__filters">
          <label className="search-box">
            <SearchIcon size={15} />
            <input
              type="search"
              value={filters.query}
              onChange={(event) =>
                onFilterChange('query', event.target.value)
              }
              placeholder="Search ID, serial, MAC, shipment"
              aria-label="Search devices"
            />
          </label>

          <select
            className="filter-select"
            value={filters.connectivity}
            onChange={(event) =>
              onFilterChange('connectivity', event.target.value)
            }
            aria-label="Filter by connectivity"
          >
            {CONNECTIVITY_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={filters.assignment}
            onChange={(event) =>
              onFilterChange('assignment', event.target.value)
            }
            aria-label="Filter by assignment"
          >
            {ASSIGNMENT_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            className="filter-select"
            value={filters.health}
            onChange={(event) => onFilterChange('health', event.target.value)}
            aria-label="Filter by device health"
          >
            {HEALTH_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="device-table">
        <div className="device-table__header" aria-hidden="true">
          <span>Device</span>
          <span>Health</span>
          <span>Connectivity</span>
          <span>Battery</span>
          <span>Assignment</span>
          <span>Sensors</span>
          <span />
        </div>

        {devices.map((device) => (
          <DeviceRow key={device.id} device={device} onSelect={onSelect} />
        ))}

        {devices.length === 0 && (
          <div className="empty-state">
            <span className="empty-state__title">
              No devices match those filters
            </span>
            <span className="empty-state__hint">
              Try a different device ID, serial, MAC address or shipment ID.
              Offline and stale devices remain in the registry and are never
              hidden automatically.
            </span>
            {hasFilters && (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={onResetFilters}
              >
                Reset filters
              </button>
            )}
          </div>
        )}
      </div>

      <p className="panel__footnote">
        Demo fleet data — no device is actually connected. A fresh heartbeat is
        required for a device to count as connected, and a recent successful
        self-test is required before any sensor is shown as healthy. One device
        can only be assigned to one active shipment; assignment is changed from
        the shipment flow.
      </p>
    </section>
  )
}

export default DeviceList
