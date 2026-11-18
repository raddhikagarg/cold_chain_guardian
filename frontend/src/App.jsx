import { useEffect, useState } from 'react'
import { api, fromApiShipment, fromApiDevice } from './utils/api.js'
import Sidebar from './components/Sidebar.jsx'
import TopBar from './components/TopBar.jsx'
import MetricCard from './components/MetricCard.jsx'
import EventsFeed from './components/EventsFeed.jsx'
import ShipmentPanel from './components/ShipmentPanel.jsx'
import {
  SnowflakeIcon,
  ThermometerIcon,
  DropletIcon,
  BellIcon,
  TruckIcon,
  ClockIcon,
  CpuIcon,
} from './components/icons.jsx'
import ShipmentsPage from './pages/ShipmentsPage.jsx'
import AlertsPage from './pages/AlertsPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import DevicesPage from './pages/DevicesPage.jsx'
import ShipmentSelector from './components/overview/ShipmentSelector.jsx'
import SensorAnalytics from './components/shipments/SensorAnalytics.jsx'
import ExposureSummary from './components/shipments/ExposureSummary.jsx'
import ShipmentTimelineCard from './components/shipments/ShipmentTimelineCard.jsx'
import { isActiveStatus } from './utils/shipments.js'
import { getAllAlerts, summarizeAlerts } from './utils/alerts.js'
import {
  getDeviceRegistry,
  summarizeDevices,
} from './utils/devices.js'
import {
  archiveShipment,
  completeShipment,
  getOperationalShipments,
} from './utils/history.js'
import {
  TEMPERATURE_SERIES,
  SAFE_TEMP_RANGE,
  HUMIDITY,
  CURRENT_SHIPMENT,
  RECENT_EVENTS,
} from './data/mockData.js'
import { INITIAL_SHIPMENTS, DEVICES } from './data/shipmentData.js'
import './App.css'

const SECTIONS = {
  overview: {
    title: 'Overview',
    icon: SnowflakeIcon,
    description: 'Live cold-chain conditions for the active shipment.',
  },
  shipments: {
    title: 'Shipments',
    icon: TruckIcon,
    description: 'Fleet-wide shipment tracking, routes and cargo profiles.',
  },
  alerts: {
    title: 'Alerts',
    icon: BellIcon,
    description: 'Full alert queue with acknowledge and escalation workflows.',
  },
  history: {
    title: 'History',
    icon: ClockIcon,
    description:
      'Completed and archived shipments with their full retained records.',
  },
  devices: {
    title: 'Devices',
    icon: CpuIcon,
    description: 'Sensor fleet health, firmware and battery status.',
  },
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function formatClock(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * Prefer an in-transit shipment, then any other active shipment, then the
 * first record available. Matches the selector's "sensible default" rule.
 */
function getDefaultShipmentId(shipments) {
  const preferred =
    shipments.find((shipment) => shipment.status === 'in-transit') ??
    shipments.find((shipment) => isActiveStatus(shipment.status))
  return preferred?.id ?? shipments[0]?.id ?? ''
}

function App() {
  const [activeSection, setActiveSection] = useState('overview')
  const [shipments, setShipments] = useState([])
  const [devices, setDevices] = useState([])
  const [apiError, setApiError] = useState('')
  const [apiReady, setApiReady] = useState(false)
  const [demoTelemetryEnabled, setDemoTelemetryEnabled] = useState(false)
  const [selectedShipmentId, setSelectedShipmentId] = useState('')
  const [series, setSeries] = useState([])
  const [humidity, setHumidity] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(() => formatClock(new Date()))
  const [shipmentFocusId, setShipmentFocusId] = useState(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const [shipmentRows, deviceRows] = await Promise.all([api.shipments(), api.devices()])
        if (!alive) return
        const normalized = shipmentRows.map(fromApiShipment)
        setShipments(normalized)
        setDevices(deviceRows.map(fromApiDevice))
        setSelectedShipmentId(getDefaultShipmentId(normalized))
        setApiError('')
      } catch (error) {
        if (alive) setApiError(error.message || 'Could not connect to backend. Check API server and MongoDB.')
      } finally {
        if (alive) setApiReady(true)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  // Cross-navigation from Device Details into the assigned shipment.
  const handleOpenShipment = (shipmentId) => {
    setShipmentFocusId(shipmentId)
    setActiveSection('shipments')
  }

  const handleCreateShipment = async (shipment) => {
    try { const response = await api.createShipment({ shipmentId: shipment.id, status: shipment.status, cargo: shipment.cargo, route: shipment.route, monitoring: shipment.monitoring, systemAlerts: shipment.systemAlerts, deviceId: shipment.deviceId }); const normalized = fromApiShipment(response); setShipments(previous => previous.some(item => item.id === normalized.id) ? previous : [normalized, ...previous]); setApiError('') } catch (error) { setApiError(error.message); throw error }
  }

  // Delivery is only recorded through an explicit operator action here.
  // Alerts keep their existing status — completion never resolves them.
  const handleDepartShipment = async (shipmentId) => { try { const updated = fromApiShipment(await api.depart(shipmentId)); setShipments(prev => prev.map(s => s.id === shipmentId ? updated : s)); setApiError('') } catch (error) { setApiError(error.message) } }

  const handleConfirmDelivery = async (shipmentId) => {
    try { const updated = fromApiShipment(await api.complete(shipmentId)); setShipments(previous => previous.map(s => s.id === shipmentId ? updated : s)); setApiError('') } catch (error) { setApiError(error.message); throw error }
  }

  // Archiving retains every part of the record; nothing is deleted.
  const handleArchiveShipment = async (shipmentId) => {
    try { const updated = fromApiShipment(await api.archive(shipmentId)); setShipments(previous => previous.map(s => s.id === shipmentId ? updated : s)); setApiError('') } catch (error) { setApiError(error.message) }
  }

  // Acknowledge and resolve stay separate actions; both update the alert that
  // lives on the shipment so every screen sees the same status.
  const handleAlertStatusChange = async (shipmentId, alertId, status) => {
    try {
      if (status === 'acknowledged') await api.acknowledgeAlert(alertId)
      else if (status === 'resolved') await api.resolveAlert(alertId)
      const updated = fromApiShipment(await api.shipment(shipmentId))
      setShipments(previous => previous.map(s => s.id === shipmentId ? updated : s))
      setApiError('')
    } catch (error) { setApiError(error.message); throw error }
  }

  // Demo telemetry is deliberately labeled simulated; it uses the same backend ingestion endpoint as the ESP32.
  useEffect(() => {
    if (!apiReady || !demoTelemetryEnabled) return
    const interval = setInterval(() => {
      const active = shipments.find(s => s.lifecycleStatus === 'in-transit' && s.deviceId)
      if (active) api.readings(active.deviceId, { shipmentId: active.id, recordedAt: new Date().toISOString(), temperature: Number((3.5 + Math.random() * 2).toFixed(1)), humidity: Math.round(60 + Math.random() * 8), shock: Number((Math.random() * 0.4).toFixed(2)), light: Math.round(Math.random() * 20), ethylene: Number((Math.random() * 0.8).toFixed(2)), doorOpen: false }).then(() => api.shipment(active.id)).then(async raw => { raw.readings = await api.shipmentReadings(active.id).catch(() => []); const fresh = fromApiShipment(raw); setShipments(prev => prev.map(s => s.id === active.id ? fresh : s)); setSeries(prev => [...prev.slice(1), fresh.latestReading?.temperature ?? prev[prev.length - 1]]); setHumidity(fresh.latestReading?.humidity ?? humidity); api.devices().then(rows => setDevices(rows.map(fromApiDevice))).catch(() => {}) }).catch(error => setApiError('Demo telemetry: ' + error.message))
      setLastUpdated(formatClock(new Date()))
    }, 5000)

    return () => clearInterval(interval)
  }, [apiReady, demoTelemetryEnabled, shipments])


  // Alert counters are calculated from backend shipment alert records only.
  const alertQueue = summarizeAlerts(getAllAlerts(shipments))
  const criticalAlerts = alertQueue.critical
  const warningAlerts = alertQueue.warning
  const activeAlerts = alertQueue.active

  // The Overview only works with operational shipments. Drafts and
  // completed/archived records are excluded from the selector and analytics.
  const operationalShipments = getOperationalShipments(shipments)
  const selectedShipment =
    operationalShipments.find(
      (shipment) => shipment.id === selectedShipmentId,
    ) ??
    operationalShipments[0] ??
    null
  const latestReading = selectedShipment?.latestReading ?? selectedShipment?.readings?.at(-1) ?? null
  const currentTemp = latestReading?.temperature ?? series[series.length - 1] ?? null
  const currentHumidity = latestReading?.humidity ?? humidity

  const selectedDevice = selectedShipment?.deviceId
    ? (devices.find((device) => device.id === selectedShipment.deviceId) ?? null)
    : null

  // The top bar follows the real fleet registry. Only fresh heartbeats count
  // as connected; stale and offline devices never inflate this number.
  const deviceSummary = summarizeDevices(
    getDeviceRegistry(devices, shipments),
  )

  const tempHealthy = currentTemp != null && currentTemp >= SAFE_TEMP_RANGE.min && currentTemp <= SAFE_TEMP_RANGE.max
  const tempNearLimit = currentTemp != null && (currentTemp > SAFE_TEMP_RANGE.max - 0.5 || currentTemp < SAFE_TEMP_RANGE.min + 0.5)

  const section = SECTIONS[activeSection]

  return (
    <div className="app">
      <Sidebar
        activeSection={activeSection}
        onNavigate={setActiveSection}
        alertCount={alertQueue.active}
      />

      <div className="app__main">
        <TopBar
          title={section.title}
          deviceStatus={{
            online: deviceSummary.online,
            total: deviceSummary.total,
          }}
          lastUpdated={lastUpdated}
        />

        <main className="app__content">
          {apiError && <div className="notice notice--error" role="alert">Backend: {apiError}</div>}
          {!apiReady && <div className="notice notice--info">Connecting to backend APIs…</div>}
          <div className="notice notice--info" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span>Telemetry mode: <strong>{demoTelemetryEnabled ? 'SIMULATION ON' : 'SIMULATION OFF'}</strong> — generated samples are not physical sensor data.</span>
            <button type="button" onClick={() => setDemoTelemetryEnabled(value => !value)} disabled={!apiReady}>
              {demoTelemetryEnabled ? 'Stop simulation' : 'Start simulation'}
            </button>
          </div>
          {activeSection === 'overview' && (
            <>
              <ShipmentSelector
                shipments={operationalShipments}
                value={selectedShipment?.id ?? ''}
                onChange={setSelectedShipmentId}
              />

              <section className="metrics" aria-label="Key metrics">
                <MetricCard
                  label="Current Temperature"
                  value={currentTemp == null ? '—' : currentTemp.toFixed(1)}
                  unit="°C"
                  icon={<ThermometerIcon size={18} />}
                  tone={!tempHealthy ? 'critical' : tempNearLimit ? 'warn' : 'ok'}
                  status={!tempHealthy ? 'Out of range' : tempNearLimit ? 'Near limit' : 'Healthy'}
                  hint={`Safe range ${SAFE_TEMP_RANGE.min}–${SAFE_TEMP_RANGE.max}°C`}
                />
                <MetricCard
                  label="Humidity"
                  value={currentHumidity ?? '—'}
                  unit="% RH"
                  icon={<DropletIcon size={18} />}
                  tone="ok"
                  status="Normal"
                  hint="Target 55–70%"
                />
                <MetricCard
                  label="Active Alerts"
                  value={activeAlerts}
                  icon={<BellIcon size={18} />}
                  tone="critical"
                  status="Action needed"
                  hint={`${criticalAlerts} critical · ${warningAlerts} warnings`}
                />
                <MetricCard
                  label="Shipment Status"
                  value={selectedShipment?.status ?? 'No shipment'}
                  icon={<TruckIcon size={18} />}
                  tone="info"
                  status="On schedule"
                  hint={selectedShipment ? `${selectedShipment.id} · route progress not GPS verified` : 'Select or create an operational shipment'}
                />
              </section>

              <div className="dashboard-grid">
                {selectedShipment ? (
                  <SensorAnalytics shipment={selectedShipment} />
                ) : (
                  <section className="panel">
                    <div className="empty-state">
                      <span className="empty-state__title">No shipment selected</span>
                      <span className="empty-state__hint">
                        Create a shipment from the Shipments page to see sensor
                        analytics, cumulative exposure and the timeline here.
                      </span>
                    </div>
                  </section>
                )}
                <EventsFeed events={getAllAlerts(shipments).map(alert => ({ id: alert.id, type: alert.parameter || alert.systemType || 'Alert', detail: alert.message || alert.display?.message || `${alert.severity || 'Alert'} condition recorded`, severity: alert.severity || 'warning', time: alert.startedAt ? new Date(alert.startedAt).toLocaleString() : 'Time unavailable', device: alert.shipment?.deviceId || 'Device unavailable' }))} />
              </div>

              <ShipmentPanel shipment={selectedShipment} device={selectedDevice} />

              {selectedShipment && (
                <>
                  <ExposureSummary shipment={selectedShipment} />
                  <ShipmentTimelineCard events={selectedShipment.timeline} />
                </>
              )}
            </>
          )}

          {activeSection === 'shipments' && (
            <ShipmentsPage
              shipments={shipments}
              devices={devices}
              onCreateShipment={handleCreateShipment}
              onConfirmDelivery={handleConfirmDelivery}
              onDepartShipment={handleDepartShipment}
              initialShipmentId={shipmentFocusId}
              onInitialShipmentConsumed={() => setShipmentFocusId(null)}
            />
          )}

          {activeSection === 'alerts' && (
            <AlertsPage
              shipments={shipments}
              onAlertStatusChange={handleAlertStatusChange}
            />
          )}

          {activeSection === 'history' && (
            <HistoryPage
              shipments={shipments}
              onArchiveShipment={handleArchiveShipment}
            />
          )}

          {activeSection === 'devices' && (
            <DevicesPage
              devices={devices}
              shipments={shipments}
              onOpenShipment={handleOpenShipment}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
