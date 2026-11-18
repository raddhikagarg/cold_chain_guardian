/**
 * Mock data for the Cold-Chain Guardian dashboard.
 * All of this is static / simulated — no backend or hardware yet.
 */

// Safe temperature range for the current cargo (°C)
export const SAFE_TEMP_RANGE = { min: 2, max: 8 }

// Temperature readings for the last 24 hours (30-minute intervals, newest last).
export const TEMPERATURE_SERIES = [
  3.4, 3.2, 3.1, 3.5, 3.8, 4.0, 4.1, 3.9, 3.7, 3.6, 3.8, 4.2,
  4.5, 4.8, 5.1, 5.0, 4.6, 4.3, 4.1, 4.4, 4.9, 5.4, 6.0, 6.6,
  7.4, 8.3, 9.1, 9.6, 9.2, 8.6, 7.9, 7.1, 6.4, 5.8, 5.2, 4.7,
  4.4, 4.2, 4.0, 3.9, 4.1, 4.3, 4.6, 4.9, 5.2, 5.0, 4.7, 4.2,
]

export const HUMIDITY = 62 // % RH

export const DEVICE_STATUS = {
  online: 12,
  total: 12,
  battery: 87, // current logger battery %
}

export const SHIPMENTS_SUMMARY = {
  inTransit: 4,
  loading: 1,
  delivered: 9,
}

export const CURRENT_SHIPMENT = {
  id: 'SHP-2481',
  produce: 'Frozen Vaccines (Pfizer)',
  carrier: 'ArcticLine Freight',
  vehicle: 'Reefer Truck · TR-092',
  origin: 'Chicago, IL',
  destination: 'Minneapolis, MN',
  departTime: '06:15',
  etaTime: '18:40',
  progress: 68, // % of route complete
  distanceKm: 572,
  tempRange: '2°C to 8°C',
  device: 'CL-7742',
  firmware: 'v2.4.1',
}

// Severity levels map to status colors: 'critical' | 'warning' | 'info'
export const RECENT_EVENTS = [
  {
    id: 1,
    type: 'Temperature Excursion',
    detail: 'Cargo temp reached 9.6°C for 14 min — outside safe range (2–8°C).',
    severity: 'critical',
    time: '4 min ago',
    device: 'CL-7742',
  },
  {
    id: 2,
    type: 'Door Opened',
    detail: 'Rear cargo door open for 95 seconds during rest stop.',
    severity: 'warning',
    time: '18 min ago',
    device: 'CL-7742',
  },
  {
    id: 3,
    type: 'Shock Detected',
    detail: 'Impact of 3.2 g recorded — possible rough handling at depot.',
    severity: 'warning',
    time: '42 min ago',
    device: 'CL-7742',
  },
  {
    id: 4,
    type: 'Geofence Entered',
    detail: 'Vehicle entered I-94 corridor checkpoint, ETA unchanged.',
    severity: 'info',
    time: '1 hr ago',
    device: 'CL-7742',
  },
  {
    id: 5,
    type: 'Temperature Normalized',
    detail: 'Cargo temp returned to 4.7°C within safe range.',
    severity: 'info',
    time: '1 hr ago',
    device: 'CL-7742',
  },
  {
    id: 6,
    type: 'Battery Low',
    detail: 'Sensor CL-7718 battery at 22% — replace within 48 hrs.',
    severity: 'warning',
    time: '2 hr ago',
    device: 'CL-7718',
  },
]
