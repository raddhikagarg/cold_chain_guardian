const { Device, Shipment, SensorReading } = require('../models')

async function seedDemoData() {
  const shipmentId = 'SHP-2481'
  const deviceId = 'ESP32-DEMO-01'

  let device = await Device.findOne({ deviceId })
  if (!device) {
    device = await Device.create({
      deviceId,
      name: 'Guardian Demo Node',
      status: 'online',
      connectivity: 'Wi-Fi',
      signal: 'Strong',
      signalDbm: -52,
      battery: 92,
      firmware: 'demo-1.0',
      sensors: ['temperature', 'humidity', 'shock'],
      lastSeenAt: new Date(),
    })
  }

  let shipment = await Shipment.findOne({ shipmentId })
  if (!shipment) {
    const departure = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const arrival = new Date(Date.now() + 4 * 60 * 60 * 1000)
    shipment = await Shipment.create({
      shipmentId,
      status: 'in-transit',
      healthStatus: 'healthy',
      cargo: {
        category: 'fruits',
        produce: 'Vaccines (Demo Cargo)',
        quantity: 120,
        unit: 'boxes',
        batch: 'DEMO-BATCH-2481',
      },
      route: {
        origin: 'Delhi, India',
        destination: 'Jaipur, India',
        carrier: 'Cold Chain Demo Logistics',
        vehicle: 'Reefer Truck · DEMO-01',
        departure,
        arrival,
        progress: 42,
        distanceKm: 280,
      },
      device: device._id,
      isDemo: true,
      timeline: [{
        title: 'Demo shipment started',
        description: 'Generated sample shipment for dashboard demonstration.',
        tone: 'info',
        occurredAt: departure,
      }],
    })
  }

  // Enable the three sensors fitted to the demo device and provide visible
  // warning/critical bands. Apply this even when the shipment already exists.
  shipment.monitoring = {
    ...(shipment.monitoring?.toObject?.() || shipment.monitoring || {}),
    temperature: {
      available: true,
      enabled: true,
      warning: { min: 2, max: 8 },
      critical: { min: 0, max: 10 },
      escalationMinutes: 0,
    },
    humidity: {
      available: true,
      enabled: true,
      warning: { min: 55, max: 70 },
      critical: { min: 50, max: 80 },
      escalationMinutes: 0,
    },
    shock: {
      available: true,
      enabled: true,
      warning: { min: 0, max: 0.5 },
      critical: { min: 0, max: 1 },
      escalationMinutes: 0,
    },
  }
  shipment.markModified('monitoring')
  await shipment.save()

  const count = await SensorReading.countDocuments({ shipment: shipment._id })
  if (count === 0) {
    const now = Date.now()
    const readings = Array.from({ length: 24 }, (_, index) => {
      const recordedAt = new Date(now - (23 - index) * 5 * 60 * 1000)
      return {
        shipment: shipment._id,
        device: device._id,
        recordedAt,
        temperature: Number((4.1 + Math.sin(index / 3) * 0.8).toFixed(2)),
        humidity: Math.round(63 + Math.sin(index / 4) * 4),
        shock: Number((0.04 + Math.abs(Math.sin(index)) * 0.12).toFixed(3)),
      }
    })
    await SensorReading.insertMany(readings)
  }

  console.log('[database] Demo shipment SHP-2481 and sample readings are ready.')
}

module.exports = seedDemoData
