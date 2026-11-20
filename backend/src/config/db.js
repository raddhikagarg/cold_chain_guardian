const mongoose = require('mongoose')
const { MongoMemoryServer } = require('mongodb-memory-server')

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
 * - A missing URI or an explicit localhost URI uses an ephemeral in-memory
 *   MongoDB instance. This avoids ECONNREFUSED 127.0.0.1:27017 in Codespaces.
 * - A configured remote URI (for example MongoDB Atlas) is used as-is.
 * - If a remote URI fails, do not silently switch databases and lose writes.
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
        '[database] No reachable external MongoDB configured; starting ephemeral in-memory MongoDB for demo mode.',
      )
      memoryServer = await MongoMemoryServer.create()
      targetUri = memoryServer.getUri('cold-chain-guardian')
    }

    await mongoose.connect(targetUri, { serverSelectionTimeoutMS: 15000 })
    console.log(
      memoryServer
        ? '[database] In-memory MongoDB connected (demo data is temporary and resets on restart).'
        : '[database] MongoDB connected',
    )
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
