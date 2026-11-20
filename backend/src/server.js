require('dotenv').config({ quiet: true })

const app = require('./app')
const { connectDatabase, disconnectDatabase } = require('./config/db')
const {
  startOfflineSweep,
  stopOfflineSweep,
} = require('./services/offlineSweep')

const PORT = Number(process.env.PORT) || 5000
const MONGODB_URI = process.env.MONGODB_URI

let server = null

async function start() {
  // Finish database startup (including demo seeding) before exposing the API.
  // This prevents the frontend's first /api/health request racing the DB boot.
  const connected = await connectDatabase(MONGODB_URI)
  if (connected) startOfflineSweep()

  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Cold-Chain Guardian API listening on port ${PORT}`)
  })
}

async function shutdown(signal) {
  console.log(`[server] Received ${signal}. Shutting down...`)
  await stopOfflineSweep()
  if (server) {
    await new Promise((resolve) => server.close(resolve))
  }
  await disconnectDatabase()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start().catch((error) => {
  console.error('[server] Startup failed:', error)
  process.exit(1)
})
