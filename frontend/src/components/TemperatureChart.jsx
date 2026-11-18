import './TemperatureChart.css'

const WIDTH = 840
const HEIGHT = 300
const PAD = { top: 18, right: 18, bottom: 34, left: 46 }
const DOMAIN_MIN = 0
const DOMAIN_MAX = 10

function timeLabel(index, totalPoints) {
  // Readings are 30 minutes apart; the newest point is "now".
  const minutesAgo = (totalPoints - 1 - index) * 30
  const date = new Date(Date.now() - minutesAgo * 60 * 1000)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * Temperature history line chart, rendered as inline SVG so no chart
 * dependency is required. Shows the safe band, the threshold lines and
 * highlights any readings outside the safe range.
 */
function TemperatureChart({ series, range }) {
  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const stepX = series.length > 1 ? plotW / (series.length - 1) : plotW

  const y = (value) =>
    PAD.top + ((DOMAIN_MAX - value) / (DOMAIN_MAX - DOMAIN_MIN)) * plotH
  const x = (index) => PAD.left + index * stepX

  const points = series.map((value, i) => ({ x: x(i), y: y(value), value, i }))
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${y(
    DOMAIN_MIN,
  )} L${points[0].x.toFixed(1)},${y(DOMAIN_MIN)} Z`

  const avg = series.reduce((sum, v) => sum + v, 0) / series.length
  const min = Math.min(...series)
  const max = Math.max(...series)

  // X-axis labels: about 7 evenly spaced marks across the 24-hour window
  const labelIndexes = [0, 8, 16, 24, 32, 40, series.length - 1]

  const gridValues = [0, 2, 4, 6, 8, 10]

  return (
    <section className="chart-card">
      <header className="chart-card__head">
        <div>
          <h2 className="chart-card__title">Temperature History</h2>
          <p className="chart-card__subtitle">Last 24 hours · readings every 30 min</p>
        </div>
        <div className="chart-card__legend" aria-hidden="true">
          <span className="chart-card__legend-item">
            <span className="chart-card__swatch chart-card__swatch--line" /> Cargo
          </span>
          <span className="chart-card__legend-item">
            <span className="chart-card__swatch chart-card__swatch--band" /> Safe range
          </span>
          <span className="chart-card__legend-item">
            <span className="chart-card__swatch chart-card__swatch--dash" /> Threshold
          </span>
        </div>
      </header>

      <div className="chart-card__stats">
        <span>
          Avg <strong>{avg.toFixed(1)}°C</strong>
        </span>
        <span>
          Min <strong>{min.toFixed(1)}°C</strong>
        </span>
        <span>
          Max <strong className={max > range.max ? 'chart-card__stat--alert' : ''}>{max.toFixed(1)}°C</strong>
        </span>
        <span className="chart-card__stats-note">Safe range {range.min}–{range.max}°C</span>
      </div>

      <svg
        className="chart-card__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Temperature history for the last 24 hours. Minimum ${min.toFixed(
          1,
        )}, maximum ${max.toFixed(1)} degrees Celsius.`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="tempArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Safe temperature band */}
        <rect
          x={PAD.left}
          y={y(range.max)}
          width={plotW}
          height={y(range.min) - y(range.max)}
          fill="rgba(34, 197, 94, 0.07)"
        />

        {/* Horizontal grid + y-axis labels */}
        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke="rgba(148, 163, 184, 0.1)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 10}
              y={y(value) + 4}
              textAnchor="end"
              className="chart-card__axis-text"
            >
              {value}°
            </text>
          </g>
        ))}

        {/* Thresholds */}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(range.max)}
          y2={y(range.max)}
          stroke="#ef4444"
          strokeOpacity="0.55"
          strokeWidth="1.2"
          strokeDasharray="5 5"
        />
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(range.min)}
          y2={y(range.min)}
          stroke="#38bdf8"
          strokeOpacity="0.55"
          strokeWidth="1.2"
          strokeDasharray="5 5"
        />
        <text
          x={WIDTH - PAD.right - 4}
          y={y(range.max) - 6}
          textAnchor="end"
          className="chart-card__threshold-label chart-card__threshold-label--max"
        >
          Upper limit {range.max}°C
        </text>
        <text
          x={WIDTH - PAD.right - 4}
          y={y(range.min) - 6}
          textAnchor="end"
          className="chart-card__threshold-label chart-card__threshold-label--min"
        >
          Lower limit {range.min}°C
        </text>

        {/* Area + line */}
        <path d={areaPath} fill="url(#tempArea)" />
        <path
          d={linePath}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Reading markers (every 4th for a clean look) + excursions */}
        {points.map((p) => {
          const excursion = p.value > range.max || p.value < range.min
          if (!excursion && p.i % 4 !== 0) return null
          return (
            <circle
              key={p.i}
              cx={p.x}
              cy={p.y}
              r={excursion ? 4.5 : 2.6}
              fill={excursion ? (p.value > range.max ? '#ef4444' : '#38bdf8') : '#0f1a2e'}
              stroke={excursion ? '#fecaca' : '#38bdf8'}
              strokeWidth={excursion ? 2 : 1.6}
            >
              <title>
                {timeLabel(p.i, series.length)} — {p.value.toFixed(1)}°C
              </title>
            </circle>
          )
        })}

        {/* X-axis labels */}
        {labelIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 10}
            textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
            className="chart-card__axis-text"
          >
            {timeLabel(index, series.length)}
          </text>
        ))}
      </svg>
    </section>
  )
}

export default TemperatureChart
