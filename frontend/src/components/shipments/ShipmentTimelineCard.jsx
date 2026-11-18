import ShipmentTimeline from './ShipmentTimeline.jsx'

/**
 * Panel wrapper around the shared timeline, so the Shipment Detail page and
 * the Overview render exactly the same card.
 */
function ShipmentTimelineCard({ events }) {
  return (
    <section className="panel">
      <header className="panel__head">
        <div>
          <h2 className="panel__title">Shipment timeline</h2>
          <p className="panel__subtitle">
            Creation, departure, alerts and delivery milestones
          </p>
        </div>
      </header>
      <ShipmentTimeline events={events} />
    </section>
  )
}

export default ShipmentTimelineCard