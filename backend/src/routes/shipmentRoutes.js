const express = require('express')
const shipmentController = require('../controllers/shipmentController')
const readingController = require('../controllers/readingController')

const router = express.Router()

router.post('/', shipmentController.create)
router.get('/', shipmentController.list)
router.get('/:shipmentId', shipmentController.get)
router.patch('/:shipmentId', shipmentController.update)
router.put('/:shipmentId/monitoring', shipmentController.putMonitoring)

router.post('/:shipmentId/schedule', shipmentController.schedule)
router.post('/:shipmentId/depart', shipmentController.depart)
router.post('/:shipmentId/complete', shipmentController.complete)
router.post('/:shipmentId/archive', shipmentController.archive)

router.get('/:shipmentId/device', shipmentController.getDeviceAssignment)
router.post('/:shipmentId/assign-device', shipmentController.assignDevice)
router.post('/:shipmentId/release-device', shipmentController.releaseDevice)

router.get('/:shipmentId/readings', readingController.listShipment)

module.exports = router
