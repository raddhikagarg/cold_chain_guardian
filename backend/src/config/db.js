const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')
const seedDemoData = require('./demoSeed')

const CONNECTION_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
}

let memoryServer = null

function getDatabaseStatus() {
  return CONNECTION_STATES[mongoose.connection.readyState] || 'unknown'
}

/**
 * Development/demo behavior:
 * - Missing or localhost MongoDB URIs use an ephemeral in-memory database.
 * - A configured remote URI (for example MongoDB Atlas) is used as-is.
 * - A failed remote connection never silently switches databases.
 */
async function connectDatabase(uri) {
  const configuredUri = String(uri || '').trim()
  const isLocalUri =
    !configuredUri ||
    /^(mongodb|mongodb\+srv):\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(
      configuredUri,
    )

  try {
    let targetUri = configuredUri

    if (isLocalUri) {
      console.log(
        '[database] Using ephemeral in-memory MongoDB because no remote database is configured.',
      )
      memoryServer = await MongoMemoryServer.create()
      targetUri = memoryServer.getUri('cold-chain-guardian')
    }

    await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 15000 })

    if (memoryServer) {
      console.log(
        '[database] In-memory MongoDB connected; demo records will reset when the backend restarts.',
      )
      await seedDemoData()
    } else {
      console.log('[database] MongoDB connected')
    }

    return true
  } catch (error) {
    console.error(`[database] MongoDB connection failed: ${error.message}`)
    if (memoryServer) {
      await memoryServer.stop().catch(() => {})
      memoryServer = null
    }
    return false
  }
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close()
  }
  if (memoryServer) {
    await memoryServer.stop()
    memoryServer = null
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[database] MongoDB disconnected')
})

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
}
