const express = require('express')
const { getDatabaseStatus } = require('../config/db')

const router = express.Router()

/**
 * GET /api/health
 *
 * Reports the API and database state. 200 when MongoDB is connected and 503
 * when it is not, so monitoring tools can tell the difference between a
 * running server and a fully healthy service.
 */
router.get('/health', (req, res) => {
  const database = getDatabaseStatus()
  const connected = database === 'connected'

  res.status(connected ? 200 : 503).json({
    service: 'cold-chain-guardian-backend',
    server: 'running',
    status: connected ? 'ok' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  })
})

module.exports = router
