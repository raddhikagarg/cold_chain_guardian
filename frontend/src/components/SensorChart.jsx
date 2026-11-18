import './SensorChart.css'

const WIDTH = 840
const HEIGHT = 280
const PAD = { top: 18, right: 20, bottom: 34, left: 54 }

function formatAxisValue(value, meta) {
  if (meta.kind === 'state') return value === 1 ? 'Open' : 'Closed'
  return Number(value).toFixed(meta.decimals)
}

function buildStepPath(points) {
  let path = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i += 1) {
    path += ` H${points[i].x.toFixed(1)} V${points[i].y.toFixed(1)}`
  }
  return path
}

/**
 * Round a numeric domain outward to a "nice" step (1, 2, 5 × 10ⁿ) so the
 * Y-axis labels are readable values instead of arbitrary decimals.
 */
function niceScale(min, max, maxTicks = 6) {
  const span = max - min || 1
  const rough = span / Math.max(1, maxTicks - 1)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const residual = rough / magnitude
  const factor = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1
  const step = factor * magnitude
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
    step,
  }
}

/**
 * Generic sensor line/state chart. Supports all six sensor types through the
 * sensor metadata (numeric vs. door state) and draws the operator-configured
 * warning band, warning lines and critical thresholds when present.
 */
function SensorChart({ series, meta, config, historical = false }) {
  if (!series || series.length === 0) {
    return <div className="sensor-chart__empty">No readings available yet.</div>
  }

  const isState = meta.kind === 'state'
  const values = series.map((point) => point.value)
  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom

  let domainMin
  let domainMax
  let domainStep = null

  if (isState) {
    domainMin = -0.1
    domainMax = 1.1
  } else {
    const candidates = [...values]
    const ranges = [config?.warning ?? config?.acceptable, config?.critical]
    ranges.forEach((bounds) => {
      if (!bounds) return
      if (Number.isFinite(bounds.min)) candidates.push(bounds.min)
      if (Number.isFinite(bounds.max)) candidates.push(bounds.max)
    })
    let min = Math.min(...candidates)
    let max = Math.max(...candidates)
    if (min === max) {
      min -= 1
      max += 1
    }
    const padding = (max - min) * 0.18
    let low = min - padding
    const high = max + padding
    if (['shock', 'light', 'ethylene', 'humidity'].includes(meta.id)) {
      low = Math.max(0, low)
    }
    const scale = niceScale(low, high)
    domainMin = scale.min
    domainMax = scale.max
    domainStep = scale.step
  }

  const x = (index) =>
    PAD.left +
    (series.length > 1 ? (index / (series.length - 1)) * plotW : plotW / 2)
  const y = (value) =>
    PAD.top + ((domainMax - value) / (domainMax - domainMin)) * plotH

  const points = series.map((point, index) => ({
    x: x(index),
    y: y(point.value),
    value: point.value,
    timestamp: point.timestamp,
    index,
  }))

  const linePath = isState
    ? buildStepPath(points)
    : points
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`,
        )
        .join(' ')

  const areaPath = isState
    ? null
    : `${linePath} L${points[points.length - 1].x.toFixed(1)},${PAD.top + plotH} L${points[0].x.toFixed(1)},${PAD.top + plotH} Z`

  const warningBand = config?.warning ?? config?.acceptable
  const numericBand =
    !isState &&
    warningBand &&
    Number.isFinite(warningBand.min) &&
    Number.isFinite(warningBand.max)

  const gridValues = isState
    ? [0, 1]
    : Array.from(
        { length: Math.round((domainMax - domainMin) / domainStep) + 1 },
        (_, i) => Number((domainMin + i * domainStep).toFixed(6)),
      )

  const labelIndexes = Array.from({ length: 4 }, (_, i) =>
    Math.round((i * (series.length - 1)) / 3),
  )

  const expectedState = config?.expectedState ?? config?.acceptable?.state

  const isExcursion = (value) => {
    if (!warningBand) return false
    if (Number.isFinite(warningBand.min) && value < warningBand.min) return true
    if (Number.isFinite(warningBand.max) && value > warningBand.max) return true
    return false
  }

  const isStateExcursion = (value) => {
    const open = value === 1
    if (!expectedState) return open
    return expectedState === 'open' ? !open : open
  }

  const formatTimestamp = (timestamp) =>
    new Date(timestamp).toLocaleString(
      [],
      historical
        ? {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }
        : {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          },
    )

  const lineColor = meta.color

  return (
    <div className="sensor-chart">
      <svg
        className="sensor-chart__svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={
          historical
            ? `${meta.label} simulated historical readings for the 24 hours before completion.`
            : `${meta.label} readings over the last 24 hours.`
        }
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={`sensor-gradient-${meta.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.26" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {numericBand && (
          <rect
            x={PAD.left}
            y={y(warningBand.max)}
            width={plotW}
            height={Math.max(0, y(warningBand.min) - y(warningBand.max))}
            fill="rgba(52, 211, 153, 0.08)"
          />
        )}

        {gridValues.map((value, index) => (
          <g key={index}>
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
              className="sensor-chart__axis-text"
            >
              {isState ? (value < 0.5 ? 'Closed' : 'Open') : formatAxisValue(value, meta)}
            </text>
          </g>
        ))}

        {!isState && (
          <>
            {Number.isFinite(config?.warning?.min) && (
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(config.warning.min)}
                y2={y(config.warning.min)}
                stroke="#facc15"
                strokeOpacity="0.45"
                strokeDasharray="5 5"
                strokeWidth="1.1"
              />
            )}
            {Number.isFinite(config?.warning?.max) && (
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(config.warning.max)}
                y2={y(config.warning.max)}
                stroke="#facc15"
                strokeOpacity="0.45"
                strokeDasharray="5 5"
                strokeWidth="1.1"
              />
            )}
            {Number.isFinite(config?.critical?.min) && (
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(config.critical.min)}
                y2={y(config.critical.min)}
                stroke="#f87171"
                strokeOpacity="0.5"
                strokeDasharray="5 5"
                strokeWidth="1.1"
              />
            )}
            {Number.isFinite(config?.critical?.max) && (
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(config.critical.max)}
                y2={y(config.critical.max)}
                stroke="#f87171"
                strokeOpacity="0.5"
                strokeDasharray="5 5"
                strokeWidth="1.1"
              />
            )}
          </>
        )}

        {areaPath && <path d={areaPath} fill={`url(#sensor-gradient-${meta.id})`} />}
        <path
          d={linePath}
          fill="none"
          stroke={lineColor}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((point) => {
          const excursion = isState
            ? isStateExcursion(point.value)
            : isExcursion(point.value)
          if (!excursion && point.index % 6 !== 0) return null
          return (
            <circle
              key={point.index}
              cx={point.x}
              cy={point.y}
              r={excursion ? 4 : 2.4}
              fill={excursion ? '#f87171' : '#0f1a2e'}
              stroke={excursion ? '#fecaca' : lineColor}
              strokeWidth={excursion ? 1.8 : 1.4}
            >
              <title>
                {`${formatTimestamp(point.timestamp)} — ${
                  isState
                    ? point.value === 1
                      ? 'Open'
                      : 'Closed'
                    : `${point.value} ${meta.unit}`
                }`}
              </title>
            </circle>
          )
        })}

        {labelIndexes.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={HEIGHT - 10}
            textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}
            className="sensor-chart__axis-text"
          >
            {formatTimestamp(series[index].timestamp)}
          </text>
        ))}
      </svg>
    </div>
  )
}

export default SensorChart