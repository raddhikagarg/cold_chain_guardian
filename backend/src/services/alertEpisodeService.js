const { Alert } = require('../models')

/**
 * Shared alert-episode helpers.
 *
 * Every unresolved alert owns an `episodeKey`. The partial unique index on
 * that field is the concurrency guard: two simultaneous evaluations may both
 * decide to create an alert, but only one insert succeeds. The loser reloads
 * the winner and applies its update to that document instead of creating a
 * duplicate.
 */

function buildEpisodeKey(source, shipmentId, type, parameter) {
  return `${source}:${String(shipmentId)}:${type}:${parameter}`
}

function isEpisodeConflict(error) {
  return (
    error?.code === 11000 &&
    Boolean(
      error.keyPattern?.episodeKey ||
        error.keyValue?.episodeKey ||
        /alert_episode_unique/.test(String(error.message ?? '')),
    )
  )
}

/**
 * Create one alert episode. Returns `{ alert, created }`; a concurrent insert
 * returns the existing document with `created: false`.
 */
async function createAlertEpisode(payload) {
  try {
    return { alert: await Alert.create(payload), created: true }
  } catch (error) {
    if (!isEpisodeConflict(error)) throw error

    const existing = await Alert.findOne({ episodeKey: payload.episodeKey })
    if (!existing) throw error
    return { alert: existing, created: false }
  }
}

/** Resolution releases the key so a future breach can open a new episode. */
function resolutionUpdate() {
  return { $unset: { episodeKey: 1 } }
}

module.exports = {
  buildEpisodeKey,
  isEpisodeConflict,
  createAlertEpisode,
  resolutionUpdate,
}
