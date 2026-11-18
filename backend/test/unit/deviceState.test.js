const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getDeviceConnectionState,
  getDeviceLastSeenAgeMinutes,
} = require('../../src/utils/deviceState')

const NOW = new Date('2026-11-15T10:00:00.000Z')

test('fresh online heartbeat is online', () => {
  const device = {
    status: 'online',
    lastSeenAt: new Date('2026-11-15T09:55:00.000Z'),
  }
  assert.equal(getDeviceConnectionState(device, NOW), 'online')
})

test('old online heartbeat is stale', () => {
  const device = {
    status: 'online',
    lastSeenAt: new Date('2026-11-15T09:40:00.000Z'),
  }
  assert.equal(getDeviceConnectionState(device, NOW), 'stale')
})

test('missing heartbeat is stale, not online', () => {
  assert.equal(
    getDeviceConnectionState({ status: 'online', lastSeenAt: null }, NOW),
    'stale',
  )
})

test('offline status is offline even with a recent heartbeat', () => {
  assert.equal(
    getDeviceConnectionState(
      { status: 'offline', lastSeenAt: new Date('2026-11-15T09:59:00.000Z') },
      NOW,
    ),
    'offline',
  )
})

test('last-seen age is calculated in minutes', () => {
  assert.equal(
    getDeviceLastSeenAgeMinutes(
      { lastSeenAt: new Date('2026-11-15T09:50:00.000Z') },
      NOW,
    ),
    10,
  )
})
