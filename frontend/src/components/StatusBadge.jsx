import './StatusBadge.css'

/**
 * Small status chip with a semantic tone:
 * ok | warn | critical | info | muted
 */
function StatusBadge({ tone = 'info', dot = false, children }) {
  return (
    <span className={`status-badge status-badge--${tone}`}>
      {dot && <span className="status-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

export default StatusBadge