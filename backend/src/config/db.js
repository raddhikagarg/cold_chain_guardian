const mongoose = require('mongoose')

/**
 * Human-readable names for Mongoose's connection readyState values.
 * Exposed through the health endpoint so callers can see the real state.
 */
const CONNECTION_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
}

/** Return the current MongoDB connection state as a short string. */
function getDatabaseStatus() {
  return CONNECTION_STATES[mongoose.connection.readyState] || 'unknown'
}

/**
 * Connect to MongoDB using the URI from the environment.
 *
 * A failure is logged and reported as `false` rather than thrown, because the
 * API is allowed to keep running while the database is unavailable. Future
 * routes can rely on `getDatabaseStatus()` to report the real connection state.
 */
async function connectDatabase(uri) {
  if (!uri) {
    console.error(
      '[database] MONGODB_URI is not set. Starting without a database connection.',
    )
    return false
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 })
    console.log('[database] MongoDB connected')
    return true
  } catch (error) {
    console.error(`[database] MongoDB connection failed: ${error.message}`)
    return false
  }
}

/** Close the connection during a graceful shutdown. */
async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close()
  }
}

// Keep the logs honest if MongoDB drops after the initial connection.
mongoose.connection.on('disconnected', () => {
  console.warn('[database] MongoDB disconnected')
})

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
}
