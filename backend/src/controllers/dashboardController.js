const { sendData } = require('../utils/apiResponse')
const { getDashboardOverview } = require('../services/dashboardService')

async function overview(req, res) {
  const { data, meta } = await getDashboardOverview(req.query)
  return sendData(res, data, 200, meta)
}

module.exports = {
  overview,
}
