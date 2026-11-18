/**
 * Sensor catalog shared by the database models, validation helpers and
 * future APIs.
 *
 * This mirrors the frontend catalog (frontend/src/data/shipmentData.js) so the
 * six monitoring parameters keep the same identifiers, units and display
 * precision. Units live here only; reading documents do not repeat them.
 */

const SENSOR_IDS = Object.freeze([
  'temperature',
  'humidity',
  'shock',
  'light',
  'door',
  'ethylene',
])

const SENSOR_CATALOG = Object.freeze({
  temperature: Object.freeze({
    id: 'temperature',
    label: 'Temperature',
    model: 'DS18B20',
    unit: '°C',
    kind: 'numeric',
    decimals: 1,
  }),
  humidity: Object.freeze({
    id: 'humidity',
    label: 'Humidity',
    model: 'SHT31',
    unit: '% RH',
    kind: 'numeric',
    decimals: 0,
  }),
  shock: Object.freeze({
    id: 'shock',
    label: 'Shock / Vibration',
    model: 'MPU6050',
    unit: 'g',
    kind: 'numeric',
    decimals: 2,
  }),
  light: Object.freeze({
    id: 'light',
    label: 'Light Intensity',
    model: 'BH1750',
    unit: 'lux',
    kind: 'numeric',
    decimals: 0,
  }),
  door: Object.freeze({
    id: 'door',
    label: 'Door Status',
    model: 'Reed switch',
    unit: 'state',
    kind: 'state',
    decimals: null,
  }),
  ethylene: Object.freeze({
    id: 'ethylene',
    label: 'Ethylene',
    model: 'Ethylene sensor (model TBD)',
    unit: 'ppm',
    kind: 'numeric',
    decimals: 1,
  }),
})

const NUMERIC_SENSOR_IDS = Object.freeze(
  SENSOR_IDS.filter((sensorId) => SENSOR_CATALOG[sensorId].kind === 'numeric'),
)

const STATE_SENSOR_IDS = Object.freeze(
  SENSOR_IDS.filter((sensorId) => SENSOR_CATALOG[sensorId].kind === 'state'),
)

module.exports = {
  SENSOR_IDS,
  SENSOR_CATALOG,
  NUMERIC_SENSOR_IDS,
  STATE_SENSOR_IDS,
}
