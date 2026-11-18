import { useEffect, useState } from 'react'
import ShipmentList from '../components/shipments/ShipmentList.jsx'
import ShipmentForm from '../components/shipments/ShipmentForm.jsx'
import ShipmentDetail from '../components/shipments/ShipmentDetail.jsx'
import './ShipmentsPage.css'

/**
 * The Shipments section owns three views: the list, the add form and the
 * detail view. Shipment records themselves live in App state so newly
 * created shipments survive navigation.
 */
function ShipmentsPage({
  shipments,
  devices,
  onCreateShipment,
  onConfirmDelivery,
  initialShipmentId = null,
  onInitialShipmentConsumed,
}) {
  const [view, setView] = useState(initialShipmentId ? 'detail' : 'list')
  const [selectedId, setSelectedId] = useState(initialShipmentId ?? null)
  const [notice, setNotice] = useState('')

  // A cross-navigation request from Devices opens that shipment directly.
  // Consuming it keeps later sidebar visits on the normal list view.
  useEffect(() => {
    if (!initialShipmentId) return
    onInitialShipmentConsumed?.()
  }, [initialShipmentId, onInitialShipmentConsumed])

  // Each view starts at the top of the page instead of inheriting the scroll
  // position from the list (which otherwise opens the form mid-page).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view, selectedId])

  const selectedShipment = shipments.find((shipment) => shipment.id === selectedId) ?? null

  const handleSaved = (shipment, savedAsDraft) => {
    onCreateShipment(shipment)
    setSelectedId(shipment.id)
    setView('detail')
    setNotice(
      savedAsDraft
        ? `${shipment.id} saved as a draft. Assign a device and confirm monitoring requirements when ready.`
        : `${shipment.id} created and scheduled${shipment.deviceId ? ` on ${shipment.deviceId}` : ''}.`,
    )
  }

  const handleConfirmDelivery = (shipmentId) => {
    onConfirmDelivery?.(shipmentId)
    setNotice(
      `${shipmentId} delivery confirmed and moved to shipment history. Existing alerts were not resolved automatically.`,
    )
  }

  if (view === 'add') {
    return (
      <ShipmentForm
        shipments={shipments}
        devices={devices}
        onSaveDraft={(shipment) => handleSaved(shipment, true)}
        onCreate={(shipment) => handleSaved(shipment, false)}
        onCancel={() => setView('list')}
      />
    )
  }

  if (view === 'detail' && selectedShipment) {
    return (
      <ShipmentDetail
        shipment={selectedShipment}
        devices={devices}
        notice={notice}
        onDismissNotice={() => setNotice('')}
        onConfirmDelivery={handleConfirmDelivery}
        onBack={() => {
          setView('list')
          setNotice('')
        }}
      />
    )
  }

  return (
    <ShipmentList
      shipments={shipments}
      onAdd={() => setView('add')}
      onSelect={(id) => {
        setSelectedId(id)
        setNotice('')
        setView('detail')
      }}
    />
  )
}

export default ShipmentsPage