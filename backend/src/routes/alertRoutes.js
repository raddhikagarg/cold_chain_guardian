const express = require('express')
const alertController = require('../controllers/alertController')

const router = express.Router()

router.get('/', alertController.list)
router.get('/:alertId', alertController.get)
router.post('/:alertId/acknowledge', alertController.acknowledge)
router.post('/:alertId/resolve', alertController.resolve)

module.exports = router
