import './MetricCard.css'

/**
 * Single KPI tile. `tone` controls the accent color:
 * 'ok' (green) | 'warn' (yellow) | 'critical' (red) | 'info' (blue)
 */
function MetricCard({ label, value, unit, icon, tone = 'info', status, hint }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__head">
        <span className="metric-card__label">{label}</span>
        <span className="metric-card__icon" aria-hidden="true">
          {icon}
        </span>
      </div>

      <div className="metric-card__readout">
        <span className="metric-card__value">{value}</span>
        {unit && <span className="metric-card__unit">{unit}</span>}
      </div>

      <div className="metric-card__foot">
        {status && <span className="metric-card__status">{status}</span>}
        {hint && <span className="metric-card__hint">{hint}</span>}
      </div>
    </article>
  )
}

export default MetricCard
