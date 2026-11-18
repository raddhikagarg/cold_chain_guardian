import {
  ThermometerIcon,
  DoorIcon,
  ShockIcon,
  TruckIcon,
  CheckIcon,
  BatteryIcon,
  InfoIcon,
} from './icons.jsx'
import './EventsFeed.css'

const ICONS = {
  'Temperature Excursion': ThermometerIcon,
  'Temperature Normalized': CheckIcon,
  'Door Opened': DoorIcon,
  'Shock Detected': ShockIcon,
  'Geofence Entered': TruckIcon,
  'Battery Low': BatteryIcon,
}

const SEVERITY_LABEL = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}

/**
 * Recent events / alert feed for the active shipment.
 */
function EventsFeed({ events }) {
  const activeCount = events.filter((e) => e.severity !== 'info').length

  return (
    <section className="events">
      <header className="events__head">
        <div>
          <h2 className="events__title">Recent Events</h2>
          <p className="events__subtitle">Alerts and telemetry from this shipment</p>
        </div>
        <span className="events__count">{activeCount} active</span>
      </header>

      <ul className="events__list">
        {events.map((event) => {
          const Icon = ICONS[event.type] || InfoIcon
          return (
            <li
              key={event.id}
              className={`events__item events__item--${event.severity}`}
            >
              <span className="events__icon" aria-hidden="true">
                <Icon size={17} />
              </span>

              <div className="events__body">
                <div className="events__row">
                  <span className="events__type">{event.type}</span>
                  <span
                    className={`events__severity events__severity--${event.severity}`}
                  >
                    {SEVERITY_LABEL[event.severity]}
                  </span>
                </div>
                <p className="events__detail">{event.detail}</p>
                <div className="events__meta">
                  <span>{event.time}</span>
                  <span className="events__meta-sep">·</span>
                  <span>{event.device}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default EventsFeed
