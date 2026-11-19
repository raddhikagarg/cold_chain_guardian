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
  onDepartShipment,
  onAssignDevice,
  onScheduleShipment,
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

  const handleSaved = async (shipment, savedAsDraft) => {
    try {
      await onCreateShipment(shipment)
      setSelectedId(shipment.id)
      setView('detail')
      setNotice(
        savedAsDraft
          ? `${shipment.id} saved as a draft. Assign a device and confirm monitoring requirements when ready.`
          : `${shipment.id} created successfully.`,
      )
    } catch (error) {
      setNotice(`Shipment was not saved: ${error.message}`)
    }
  }

  const handleAssignDevice = async (shipmentId, deviceId) => {
    try {
      await onAssignDevice(shipmentId, deviceId)
      setNotice(`Device ${deviceId} assigned to ${shipmentId}.`)
    } catch (error) {
      setNotice(`Device assignment failed: ${error.message}`)
    }
  }

  const handleScheduleShipment = async (shipmentId) => {
    try {
      await onScheduleShipment(shipmentId)
      setNotice(`${shipmentId} scheduled successfully.`)
    } catch (error) {
      setNotice(`Scheduling failed: ${error.message}`)
    }
  }

  const handleConfirmDelivery = async (shipmentId) => {
    try {
      await onConfirmDelivery?.(shipmentId)
      setNotice(`${shipmentId} delivery updated successfully. Existing alerts were not resolved automatically.`)
    } catch (error) {
      setNotice(`Delivery update failed: ${error.message}`)
    }
  }

  if (view === 'add') {
    return (
      <>
        {notice && <div className={`notice ${notice.startsWith('Shipment was not saved') ? 'notice--error' : 'notice--success'}`} role="status">{notice}</div>}
      <ShipmentForm
        shipments={shipments}
        devices={devices}
        onSaveDraft={(shipment) => handleSaved(shipment, true)}
        onCreate={(shipment) => handleSaved(shipment, false)}
        onCancel={() => setView('list')}
      />
      </>
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
        onDepartShipment={onDepartShipment}
        onAssignDevice={handleAssignDevice}
        onScheduleShipment={handleScheduleShipment}
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