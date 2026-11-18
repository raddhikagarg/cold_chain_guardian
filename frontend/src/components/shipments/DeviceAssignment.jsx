import StatusBadge from '../StatusBadge.jsx'
import { CpuIcon, WifiIcon, BatteryIcon } from '../icons.jsx'
import { SENSOR_CATALOG, SENSOR_IDS } from '../../data/shipmentData.js'
import {
  formatDurationMinutes,
  getDeviceConnectionState,
} from '../../utils/deviceState.js'

function connectionBadge(device) {
  const state =
    device.connectionState ??
    getDeviceConnectionState(device, Date.now())
  if (state === 'online') {
    return { tone: 'ok', label: 'Online', dot: true }
  }
  if (state === 'stale') {
    return { tone: 'warn', label: 'Stale', dot: true }
  }
  return { tone: 'critical', label: 'Offline', dot: true }
}

/**
 * Section D — choose an ESP32 that is online and not assigned to another
 * active shipment. Connected sensors and connectivity are shown per device.
 */
function DeviceAssignment({ devices, selectedId, onSelect }) {
  const availableCount = devices.filter((device) => device.available).length

  return (
    <div className="device-assignment">
      <div className="device-assignment__summary">
        <span>
          {availableCount} of {devices.length} devices available for assignment
        </span>
        <span className="device-assignment__rules">
          One device can only monitor one active shipment at a time.
        </span>
      </div>

      <div className="device-list">
        {devices.map((device) => {
          const busy = Boolean(device.assignedShipmentId)
          const disabled = !device.available
          const selected = selectedId === device.id
          const connection = connectionBadge(device)

          return (
            <label
              key={device.id}
              className={`device-option${selected ? ' device-option--selected' : ''}${
                disabled ? ' device-option--disabled' : ''
              }`}
            >
              <input
                type="radio"
                name="shipment-device"
                value={device.id}
                checked={selected}
                disabled={disabled}
                onChange={() => onSelect(device.id)}
                className="device-option__radio"
              />

              <span className="device-option__body">
                <span className="device-option__head">
                  <CpuIcon size={16} />
                  <strong>{device.id}</strong>
                  <span className="device-option__name">{device.name}</span>
                  {busy ? (
                    <StatusBadge tone="warn">In use · {device.assignedShipmentId}</StatusBadge>
                  ) : (
                    <StatusBadge tone={connection.tone} dot={connection.dot}>
                      {connection.label}
                    </StatusBadge>
                  )}
                </span>

                <span className="device-option__meta">
                  <span>
                    <WifiIcon size={13} /> {device.connectivity} · {device.signal} signal
                  </span>
                  <span>
                    <BatteryIcon size={13} /> Battery {device.battery}%
                  </span>
                  <span>FW {device.firmware}</span>
                </span>

                <span className="device-option__sensors">
                  {SENSOR_IDS.map((sensorId) => {
                    const fitted = device.sensors.includes(sensorId)
                    return (
                      <span
                        key={sensorId}
                        className={`sensor-tag${fitted ? '' : ' sensor-tag--off'}`}
                      >
                        {SENSOR_CATALOG[sensorId].label}
                      </span>
                    )
                  })}
                </span>

                {busy && (
                  <span className="device-option__reason">
                    Unavailable until {device.assignedShipmentId} is delivered.
                  </span>
                )}
                {!busy && device.connectionState === 'stale' && (
                  <span className="device-option__reason">
                    No heartbeat for{' '}
                    {formatDurationMinutes(device.lastSeenMinutesAgo)}. Stale
                    devices cannot be assigned until they report again.
                  </span>
                )}
                {!busy && !device.online && device.connectionState !== 'stale' && (
                  <span className="device-option__reason">
                    Offline devices cannot be assigned.
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>

      {availableCount === 0 && (
        <div className="notice notice--warn">
          <span>
            No devices are currently available. You can save this shipment as a
            draft and assign a device later — draft shipments do not reserve a
            device.
          </span>
        </div>
      )}

      {selectedId && (
        <button
          type="button"
          className="btn btn--quiet device-assignment__clear"
          onClick={() => onSelect('')}
        >
          Clear device selection
        </button>
      )}
    </div>
  )
}

export default DeviceAssignment