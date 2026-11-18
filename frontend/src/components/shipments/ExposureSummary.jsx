import './ExposureSummary.css'

/**
 * Cumulative exposure card, shared by the Shipment Detail page and the
 * Overview. Values come from `shipment.exposure` (demo data for now).
 */
function ExposureSummary({ shipment }) {
  const exposure = shipment.exposure

  const exposureItems = [
    {
      label: 'Temperature out of range',
      value:
        exposure?.temperatureMinutesOutOfRange == null
          ? '—'
          : `${exposure.temperatureMinutesOutOfRange} min`,
      tone: exposure?.temperatureMinutesOutOfRange > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Humidity out of range',
      value:
        exposure?.humidityMinutesOutOfRange == null
          ? '—'
          : `${exposure.humidityMinutesOutOfRange} min`,
      tone: exposure?.humidityMinutesOutOfRange > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Shock events',
      value: exposure?.shockEvents == null ? '—' : String(exposure.shockEvents),
      tone: exposure?.shockEvents > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Peak shock',
      value: exposure?.peakShockG == null ? '—' : `${exposure.peakShockG} g`,
      tone: 'neutral',
    },
    {
      label: 'Door open total',
      value:
        exposure?.doorOpenSeconds == null ? '—' : `${exposure.doorOpenSeconds} s`,
      tone: exposure?.doorOpenSeconds > 60 ? 'warn' : 'neutral',
    },
    {
      label: 'Peak ethylene',
      value:
        exposure?.peakEthylenePpm == null ? '—' : `${exposure.peakEthylenePpm} ppm`,
      tone: 'neutral',
    },
    {
      label: 'Average light',
      value: exposure?.avgLightLux == null ? '—' : `${exposure.avgLightLux} lux`,
      tone: 'neutral',
    },
  ]

  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Cumulative exposure</h2>
          <p className="panel__subtitle">
            Totals across this shipment&apos;s recorded history (demo values)
          </p>
        </div>
      </header>

      <div className="exposure-grid">
        {exposureItems.map((item) => (
          <div key={item.label} className={`exposure-item exposure-item--${item.tone}`}>
            <span className="exposure-item__label">{item.label}</span>
            <span className="exposure-item__value">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default ExposureSummary