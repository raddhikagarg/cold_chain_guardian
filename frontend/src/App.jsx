import { useEffect, useState } from 'react'
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
  const [shipments, setShipments] = useState(INITIAL_SHIPMENTS)
  const [selectedShipmentId, setSelectedShipmentId] = useState(() =>
    getDefaultShipmentId(INITIAL_SHIPMENTS),
  )
  const [series, setSeries] = useState(TEMPERATURE_SERIES)
  const [humidity, setHumidity] = useState(HUMIDITY)
  const [lastUpdated, setLastUpdated] = useState(() => formatClock(new Date()))
  const [shipmentFocusId, setShipmentFocusId] = useState(null)

  // Cross-navigation from Device Details into the assigned shipment.
  const handleOpenShipment = (shipmentId) => {
    setShipmentFocusId(shipmentId)
    setActiveSection('shipments')
  }

  const handleCreateShipment = (shipment) => {
    setShipments((previous) =>
      previous.some((item) => item.id === shipment.id)
        ? previous
        : [shipment, ...previous],
    )
  }

  // Delivery is only recorded through an explicit operator action here.
  // Alerts keep their existing status — completion never resolves them.
  const handleConfirmDelivery = (shipmentId) => {
    setShipments((previous) =>
      previous.map((shipment) =>
        shipment.id === shipmentId
          ? completeShipment(shipment, { source: 'operator' })
          : shipment,
      ),
    )
  }

  // Archiving retains every part of the record; nothing is deleted.
  const handleArchiveShipment = (shipmentId) => {
    setShipments((previous) =>
      previous.map((shipment) =>
        shipment.id === shipmentId ? archiveShipment(shipment) : shipment,
      ),
    )
  }

  // Acknowledge and resolve stay separate actions; both update the alert that
  // lives on the shipment so every screen sees the same status.
  const handleAlertStatusChange = (shipmentId, alertId, status) => {
    const now = new Date().toISOString()
    setShipments((previous) =>
      previous.map((shipment) => {
        if (shipment.id !== shipmentId) return shipment
        return {
          ...shipment,
          alerts: (shipment.alerts ?? []).map((alert) =>
            alert.id === alertId
              ? {
                  ...alert,
                  status,
                  acknowledgedAt:
                    status === 'acknowledged' ? now : alert.acknowledgedAt,
                  resolvedAt: status === 'resolved' ? now : alert.resolvedAt,
                }
              : alert,
          ),
        }
      }),
    )
  }

  // Simulated live telemetry — purely mock, no backend or hardware involved.
  useEffect(() => {
    const interval = setInterval(() => {
      setSeries((previous) => {
        const latest = previous[previous.length - 1]
        const next = clamp(latest + (Math.random() * 0.7 - 0.35), 2.8, 7.6)
        return [...previous.slice(1), Number(next.toFixed(1))]
      })
      setHumidity((previous) => Math.round(clamp(previous + (Math.random() * 3 - 1.5), 58, 66)))
      setLastUpdated(formatClock(new Date()))
    }, 4000)

    return () => clearInterval(interval)
  }, [])

  const currentTemp = series[series.length - 1]
  const criticalAlerts = RECENT_EVENTS.filter((event) => event.severity === 'critical').length
  const warningAlerts = RECENT_EVENTS.filter((event) => event.severity === 'warning').length
  const activeAlerts = criticalAlerts + warningAlerts

  // Sidebar badge follows the real alert queue (active + acknowledged).
  const alertQueue = summarizeAlerts(getAllAlerts(shipments))

  // The Overview only works with operational shipments. Drafts and
  // completed/archived records are excluded from the selector and analytics.
  const operationalShipments = getOperationalShipments(shipments)
  const selectedShipment =
    operationalShipments.find(
      (shipment) => shipment.id === selectedShipmentId,
    ) ??
    operationalShipments[0] ??
    null

  const selectedDevice = selectedShipment?.deviceId
    ? (DEVICES.find((device) => device.id === selectedShipment.deviceId) ?? null)
    : null

  // The top bar follows the real fleet registry. Only fresh heartbeats count
  // as connected; stale and offline devices never inflate this number.
  const deviceSummary = summarizeDevices(
    getDeviceRegistry(DEVICES, shipments),
  )

  const tempHealthy = currentTemp >= SAFE_TEMP_RANGE.min && currentTemp <= SAFE_TEMP_RANGE.max
  const tempNearLimit =
    currentTemp > SAFE_TEMP_RANGE.max - 0.5 || currentTemp < SAFE_TEMP_RANGE.min + 0.5

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
                  value={currentTemp.toFixed(1)}
                  unit="°C"
                  icon={<ThermometerIcon size={18} />}
                  tone={!tempHealthy ? 'critical' : tempNearLimit ? 'warn' : 'ok'}
                  status={!tempHealthy ? 'Out of range' : tempNearLimit ? 'Near limit' : 'Healthy'}
                  hint={`Safe range ${SAFE_TEMP_RANGE.min}–${SAFE_TEMP_RANGE.max}°C`}
                />
                <MetricCard
                  label="Humidity"
                  value={humidity}
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
                  value="In Transit"
                  icon={<TruckIcon size={18} />}
                  tone="info"
                  status="On schedule"
                  hint={`${CURRENT_SHIPMENT.id} · ${CURRENT_SHIPMENT.progress}% complete`}
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
                <EventsFeed events={RECENT_EVENTS} />
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
              devices={DEVICES}
              onCreateShipment={handleCreateShipment}
              onConfirmDelivery={handleConfirmDelivery}
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
              devices={DEVICES}
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
