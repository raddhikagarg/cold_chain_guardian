import { useEffect, useState } from 'react'
import MetricCard from '../components/MetricCard.jsx'
import AlertList from '../components/alerts/AlertList.jsx'
import AlertDetail from '../components/alerts/AlertDetail.jsx'
import {
  AlertTriangleIcon,
  BellIcon,
  CheckIcon,
  InfoIcon,
} from '../components/icons.jsx'
import { getAllAlerts, summarizeAlerts } from '../utils/alerts.js'
import './AlertsPage.css'

/**
 * Alerts section: queue, filters and the alert detail view. Alert records
 * themselves live inside App's shipment state, so acknowledge/resolve
 * updates flow back to every screen that reads them.
 */
function AlertsPage({ shipments, onAlertStatusChange }) {
  const [view, setView] = useState('list')
  const [selectedAlertId, setSelectedAlertId] = useState(null)
  const [tab, setTab] = useState('active')
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedAlertId])

  const alerts = getAllAlerts(shipments)
  const summary = summarizeAlerts(alerts)
  const selectedAlert =
    alerts.find((alert) => alert.id === selectedAlertId) ?? null

  const handleAcknowledge = (alert) => {
    onAlertStatusChange(alert.shipment.id, alert.id, 'acknowledged')
    setNotice({
      tone: 'info',
      text: `${alert.id} acknowledged. This only records that the alert has been seen — it does not resolve the underlying condition.`,
    })
  }

  const handleResolve = (alert) => {
    onAlertStatusChange(alert.shipment.id, alert.id, 'resolved')
    setNotice({
      tone: 'success',
      text: `${alert.id} resolved and moved to alert history.`,
    })
    setTab('history')
  }

  if (view === 'detail' && selectedAlert) {
    return (
      <AlertDetail
        alert={selectedAlert}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onBack={() => {
          setView('list')
          setNotice(null)
        }}
        onAcknowledge={handleAcknowledge}
        onResolve={handleResolve}
      />
    )
  }

  return (
    <div className="alerts-page">
      <div className="page-head">
        <div className="page-head__text">
          <div className="page-head__eyebrow">
            <span className="mock-chip">Demo data</span>
            Cold-chain operations
          </div>
          <h1 className="page-head__title">Monitoring alerts</h1>
          <p className="page-head__subtitle">
            Monitor, acknowledge and resolve alerts across every shipment.
            Acknowledging records that an alert was seen — resolve it only once
            the condition has recovered or the issue has been addressed.
          </p>
        </div>
      </div>

      <section className="metrics" aria-label="Alert summary">
        <MetricCard
          label="Active alerts"
          value={summary.active}
          icon={<BellIcon size={18} />}
          tone="info"
          status="Open queue"
          hint="Active and acknowledged alerts"
        />
        <MetricCard
          label="Critical alerts"
          value={summary.critical}
          icon={<AlertTriangleIcon size={18} />}
          tone="critical"
          status="Action needed"
          hint="Unresolved critical thresholds"
        />
        <MetricCard
          label="Warning alerts"
          value={summary.warning}
          icon={<InfoIcon size={18} />}
          tone="warn"
          status="Review"
          hint="Unresolved warning thresholds"
        />
        <MetricCard
          label="Resolved alerts"
          value={summary.resolved}
          icon={<CheckIcon size={18} />}
          tone="ok"
          status="History"
          hint="Kept for audit — never deleted"
        />
      </section>

      <AlertList
        alerts={alerts}
        tab={tab}
        onTabChange={(nextTab) => {
          setTab(nextTab)
          setNotice(null)
        }}
        onSelect={(id) => {
          setSelectedAlertId(id)
          setNotice(null)
          setView('detail')
        }}
      />
    </div>
  )
}

export default AlertsPage
