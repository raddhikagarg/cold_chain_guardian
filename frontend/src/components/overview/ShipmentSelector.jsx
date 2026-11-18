import { getOperationalShipments } from '../../utils/history.js'
import { getStatusMeta } from '../../utils/shipments.js'
import './ShipmentSelector.css'

/**
 * Compact shipment picker for the Overview. Only operational shipments
 * (scheduled, in transit, warning or critical) are listed, so drafts and
 * completed/archived history records never appear here.
 */
function ShipmentSelector({ shipments, value, onChange }) {
  const operational = getOperationalShipments(shipments)
  const hasShipments = operational.length > 0

  return (
    <div className="overview-selector">
      <label className="overview-selector__label" htmlFor="overview-shipment-select">
        Viewing shipment
      </label>
      <select
        id="overview-shipment-select"
        className="overview-selector__select"
        value={hasShipments ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={!hasShipments}
      >
        {hasShipments ? (
          operational.map((shipment) => (
            <option key={shipment.id} value={shipment.id}>
              {shipment.id} · {shipment.cargo.produce} ·{' '}
              {getStatusMeta(shipment.status).label}
            </option>
          ))
        ) : (
          <option value="">No operational shipments</option>
        )}
      </select>
    </div>
  )
}

export default ShipmentSelector