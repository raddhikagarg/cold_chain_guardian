/**
 * Model registry.
 *
 * Requiring this module registers every Phase 2 model exactly once and exposes
 * them together for future services, routes and scripts.
 */

const Shipment = require('./Shipment')
const Device = require('./Device')
const SensorReading = require('./SensorReading')
const Alert = require('./Alert')
const DeviceEvent = require('./DeviceEvent')

module.exports = {
  Shipment,
  Device,
  SensorReading,
  Alert,
  DeviceEvent,
}
