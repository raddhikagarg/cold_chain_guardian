import { formatDateTime } from '../../utils/shipments.js'
import './ShipmentTimeline.css'

/**
 * Vertical shipment timeline. `tone` is one of info | ok | warn | critical | muted.
 */
function ShipmentTimeline({ events }) {
  if (!events || events.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state__title">No timeline events yet</span>
      </div>
    )
  }

  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.id} className={`timeline__item timeline__item--${event.tone ?? 'info'}`}>
          <span className="timeline__dot" aria-hidden="true" />
          <div className="timeline__body">
            <span className="timeline__time">{formatDateTime(event.time)}</span>
            <h4 className="timeline__title">{event.title}</h4>
            {event.description && (
              <p className="timeline__description">{event.description}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default ShipmentTimeline