import {
  SnowflakeIcon,
  TruckIcon,
  BellIcon,
  ClockIcon,
  CpuIcon,
} from './icons.jsx'
import './Sidebar.css'

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview', icon: <SnowflakeIcon size={18} /> },
  { id: 'shipments', label: 'Shipments', icon: <TruckIcon size={18} /> },
  { id: 'alerts', label: 'Alerts', icon: <BellIcon size={18} /> },
  { id: 'history', label: 'History', icon: <ClockIcon size={18} /> },
  { id: 'devices', label: 'Devices', icon: <CpuIcon size={18} /> },
]

function Sidebar({ activeSection, onNavigate, alertCount }) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">
          <SnowflakeIcon size={22} />
        </span>
        <div className="sidebar__brand-text">
          <span className="sidebar__name">Cold-Chain</span>
          <span className="sidebar__tagline">Guardian</span>
        </div>
      </div>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`sidebar__item${activeSection === item.id ? ' sidebar__item--active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar__item-icon">{item.icon}</span>
            <span className="sidebar__item-label">{item.label}</span>
            {item.id === 'alerts' && alertCount > 0 && (
              <span className="sidebar__badge">{alertCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__footer-label">Mock data mode</div>
        <div className="sidebar__footer-value">Backend pending</div>
      </div>
    </aside>
  )
}

export default Sidebar
