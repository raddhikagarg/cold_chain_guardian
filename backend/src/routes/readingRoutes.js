const express = require('express')
const readingController = require('../controllers/readingController')

const router = express.Router()

router.get('/:readingId', readingController.get)

module.exports = router
