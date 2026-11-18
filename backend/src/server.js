require('dotenv').config({ quiet: true })

const app = require('./app')
const { connectDatabase, disconnectDatabase } = require('./config/db')
const {
  startOfflineSweep,
  stopOfflineSweep,
} = require('./services/offlineSweep')

const PORT = Number(process.env.PORT) || 5000
const MONGODB_URI = process.env.MONGODB_URI

// Start the HTTP server first so /api/health stays reachable even when
// MongoDB is unavailable. The connection state is reported by the route.
const server = app.listen(PORT, () => {
  console.log(`[server] Cold-Chain Guardian API listening on http://localhost:${PORT}`)
})

connectDatabase(MONGODB_URI).then((connected) => {
  if (connected) startOfflineSweep()
})

// Close the HTTP server, stop the sweep and release MongoDB when stopped.
async function shutdown(signal) {
  console.log(`[server] Received ${signal}. Shutting down...`)
  await stopOfflineSweep()
  server.close(async () => {
    await disconnectDatabase()
    process.exit(0)
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
