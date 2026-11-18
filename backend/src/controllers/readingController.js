const { sendData, sendList } = require('../utils/apiResponse')
const { ingestReading } = require('../services/readingService')
const {
  listShipmentReadings,
  listDeviceReadings,
  getReadingDetail,
} = require('../services/readingService')
const { presentReading } = require('../services/readingPresenter')

async function ingest(req, res) {
  const { reading, shipment, device, evaluation } = await ingestReading(
    req.params.deviceId,
    req.body,
  )

  const payload = {
    ...presentReading(reading, {
      shipmentId: shipment.shipmentId,
      deviceId: device.deviceId,
    }),
    evaluation,
  }

  res.set('Location', `/api/readings/${encodeURIComponent(String(reading._id))}`)
  return sendData(res, payload, 201)
}

async function listShipment(req, res) {
  const { items, meta } = await listShipmentReadings(
    req.params.shipmentId,
    req.query,
  )
  return sendList(res, items, meta)
}

async function listDevice(req, res) {
  const { items, meta } = await listDeviceReadings(
    req.params.deviceId,
    req.query,
  )
  return sendList(res, items, meta)
}

async function get(req, res) {
  const reading = await getReadingDetail(req.params.readingId)
  return sendData(res, reading)
}

module.exports = {
  ingest,
  listShipment,
  listDevice,
  get,
}
