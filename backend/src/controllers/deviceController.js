const { sendData, sendList } = require('../utils/apiResponse')
const {
  registerDevice,
  listDevices,
  getDeviceDetail,
  recordHeartbeat,
  recordSelfTest,
} = require('../services/deviceService')
const {
  createDeviceEvent,
  listDeviceEvents,
} = require('../services/deviceEventService')
const {
  listDeviceReadings,
} = require('../services/readingService')
const {
  getDeviceStatus,
  getSensorAvailability,
  getDeviceAvailability,
} = require('../services/deviceApiService')

async function register(req, res) {
  const device = await registerDevice(req.body)

  res.set('Location', `/api/devices/${encodeURIComponent(device.deviceId)}`)
  return sendData(res, device, 201)
}

async function list(req, res) {
  const { items, meta } = await listDevices(req.query)
  return sendList(res, items, meta)
}

async function get(req, res) {
  const device = await getDeviceDetail(req.params.deviceId)
  return sendData(res, device)
}

async function status(req, res) {
  const result = await getDeviceStatus(req.params.deviceId)
  return sendData(res, result)
}

async function sensors(req, res) {
  const result = await getSensorAvailability(req.params.deviceId)
  return sendData(res, result)
}


async function availability(req, res) {
  const result = await getDeviceAvailability(req.params.deviceId)
  return sendData(res, result)
}


async function heartbeat(req, res) {
  const device = await recordHeartbeat(req.params.deviceId, req.body ?? {})
  return sendData(res, device)
}

async function selfTest(req, res) {
  const device = await recordSelfTest(req.params.deviceId, req.body ?? {})
  return sendData(res, device)
}

async function createEvent(req, res) {
  const event = await createDeviceEvent(req.params.deviceId, req.body)

  res.set('Location', `/api/devices/${encodeURIComponent(req.params.deviceId)}/events`)
  return sendData(res, event, 201)
}

async function listEvents(req, res) {
  const { items, meta } = await listDeviceEvents(
    req.params.deviceId,
    req.query,
  )
  return sendList(res, items, meta)
}

async function listReadings(req, res) {
  const { items, meta } = await listDeviceReadings(
    req.params.deviceId,
    req.query,
  )
  return sendList(res, items, meta)
}

module.exports = {
  register,
  list,
  get,
  status,
  sensors,
  availability,
  heartbeat,
  selfTest,
  createEvent,
  listEvents,
  listReadings,
}
