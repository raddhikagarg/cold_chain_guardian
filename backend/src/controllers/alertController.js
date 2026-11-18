const { sendData, sendList } = require('../utils/apiResponse')
const {
  listAlerts,
  getAlertDetail,
  acknowledgeAlert,
  resolveAlert,
} = require('../services/alertService')

async function list(req, res) {
  const { items, meta } = await listAlerts(req.query)
  return sendList(res, items, meta)
}

async function get(req, res) {
  const alert = await getAlertDetail(req.params.alertId)
  return sendData(res, alert)
}

async function acknowledge(req, res) {
  const alert = await acknowledgeAlert(req.params.alertId, req.body)
  return sendData(res, alert)
}

async function resolve(req, res) {
  const alert = await resolveAlert(req.params.alertId, req.body)
  return sendData(res, alert)
}

module.exports = {
  list,
  get,
  acknowledge,
  resolve,
}
