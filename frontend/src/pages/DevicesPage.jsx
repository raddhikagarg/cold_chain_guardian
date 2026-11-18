import { useEffect, useMemo, useState } from 'react'
import MetricCard from '../components/MetricCard.jsx'
import DeviceList from '../components/devices/DeviceList.jsx'
import DeviceDetail from '../components/devices/DeviceDetail.jsx'
import {
  AlertTriangleIcon,
  CheckIcon,
  CpuIcon,
  InfoIcon,
} from '../components/icons.jsx'
import {
  filterDevices,
  getDeviceRegistry,
  sortDevices,
  summarizeDevices,
} from '../utils/devices.js'
import './DevicesPage.css'

const INITIAL_FILTERS = {
  query: '',
  connectivity: 'all',
  assignment: 'all',
  health: 'all',
}

/**
 * Devices section: a read-only fleet registry and device detail view.
 * Assignment continues to be derived from shipment state, and assignment
 * changes stay in the existing shipment creation flow.
 */
function DevicesPage({ devices, shipments, onOpenShipment }) {
  const [view, setView] = useState('list')
  const [selectedId, setSelectedId] = useState(null)
  const [filters, setFilters] = useState(INITIAL_FILTERS)

  // Keep the demo snapshot stable while the page is open so relative times
  // do not flicker between list and detail renders.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedId])

  const registry = useMemo(
    () => getDeviceRegistry(devices, shipments, now),
    [devices, shipments, now],
  )
  const summary = useMemo(() => summarizeDevices(registry), [registry])
  const visibleDevices = useMemo(
    () => sortDevices(filterDevices(registry, filters)),
    [registry, filters],
  )

  const selectedDevice =
    registry.find((device) => device.id === selectedId) ?? null

  const handleFilterChange = (key, value) => {
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  if (view === 'detail' && selectedDevice) {
    return (
      <DeviceDetail
        device={selectedDevice}
        shipments={shipments}
        now={now}
        onOpenShipment={onOpenShipment}
        onBack={() => {
          setView('list')
          setSelectedId(null)
        }}
      />
    )
  }

  return (
    <div className="devices-page">
      <div className="page-head">
        <div className="page-head__text">
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            Fleet operations
          </div>
          <h1 className="page-head__title">Device fleet</h1>
          <p className="page-head__subtitle">
            ESP32 registry covering connectivity, battery, sensor evidence and
            shipment assignment. Device health is tracked separately from cargo
            condition.
          </p>
        </div>
      </div>

      <div className="notice notice--info device-scope-note">
        <InfoIcon size={16} />
        <span>
          <strong>Device health is not cargo health.</strong> A healthy logger
          does not prove the cargo is healthy, and a device alert does not by
          itself indicate a cargo excursion. Cargo condition stays in Shipments
          and Alerts.
        </span>
      </div>

      <section className="metrics" aria-label="Device fleet summary">
        <MetricCard
          label="Reporting now"
          value={summary.online}
          unit={`/ ${summary.total}`}
          icon={<CpuIcon size={18} />}
          tone={summary.online === summary.total ? 'ok' : 'warn'}
          status="Fresh heartbeat"
          hint={`${summary.stale} stale · ${summary.offline} offline`}
        />
        <MetricCard
          label="Healthy devices"
          value={summary.healthy}
          icon={<CheckIcon size={18} />}
          tone={summary.healthy === summary.total ? 'ok' : 'info'}
          status="Verified evidence"
          hint={`${summary.sensorFitted} sensors fitted · self-tests within 24 hr`}
        />
        <MetricCard
          label="Need attention"
          value={summary.attention}
          icon={<AlertTriangleIcon size={18} />}
          tone={summary.attention > 0 ? 'critical' : 'ok'}
          status={summary.attention > 0 ? 'Review fleet' : 'All clear'}
          hint={`${summary.stale} stale · ${summary.offline} offline · low battery and sensor issues`}
        />
        <MetricCard
          label="Unassigned"
          value={summary.unassigned}
          icon={<CpuIcon size={18} />}
          tone="muted"
          status={`${summary.assigned} assigned`}
          hint="One device per active shipment"
        />
      </section>

      <DeviceList
        devices={visibleDevices}
        total={registry.length}
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={() => setFilters(INITIAL_FILTERS)}
        onSelect={(id) => {
          setSelectedId(id)
          setView('detail')
        }}
      />

      <p className="devices-page__demo-note">
        Fleet, hardware, connectivity and sensor evidence are simulated demo
        data for this prototype. No device is actually connected and no
        assignment is changed from this page.
      </p>
    </div>
  )
}

export default DevicesPage
