const express = require('express')
const deviceController = require('../controllers/deviceController')
const readingController = require('../controllers/readingController')

const router = express.Router()

router.post('/', deviceController.register)
router.get('/', deviceController.list)
router.get('/:deviceId', deviceController.get)

router.post('/:deviceId/heartbeat', deviceController.heartbeat)
router.post('/:deviceId/self-test', deviceController.selfTest)

router.get('/:deviceId/events', deviceController.listEvents)
router.post('/:deviceId/events', deviceController.createEvent)

router.get('/:deviceId/readings', deviceController.listReadings)
router.post('/:deviceId/readings', readingController.ingest)

module.exports = router

