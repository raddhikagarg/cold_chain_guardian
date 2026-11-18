import './TopBar.css'

/**
 * Top bar with the current section title and device connection status.
 */
function TopBar({ title, deviceStatus, lastUpdated }) {
  const allOnline = deviceStatus.online === deviceStatus.total

  return (
    <header className="topbar">
      <div className="topbar__titles">
        <h1 className="topbar__title">{title}</h1>
        {lastUpdated && (
          <span className="topbar__updated">Updated {lastUpdated}</span>
        )}
      </div>

      <div className="topbar__status">
        <span
          className={`topbar__status-dot${allOnline ? '' : ' topbar__status-dot--warn'}`}
          aria-hidden="true"
        />
        <span className="topbar__status-text">
          {deviceStatus.online}/{deviceStatus.total} devices connected
        </span>
        <span className="topbar__status-pill">Live</span>
      </div>
    </header>
  )
}

export default TopBar
