const test = require('node:test')
const assert = require('node:assert/strict')

const {
  isWithinLateWindow,
  isRecordedAtWithinShipmentWindow,
} = require('../../src/services/readingService')

const NOW = new Date('2026-11-16T12:00:00.000Z')

test('the late window accepts exactly 24 hours after completion', () => {
  assert.equal(
    isWithinLateWindow(new Date('2026-11-15T12:00:00.000Z'), NOW),
    true,
  )
})

test('the late window rejects more than 24 hours after completion', () => {
  assert.equal(
    isWithinLateWindow(new Date('2026-11-15T11:59:59.000Z'), NOW),
    false,
  )
})

test('a future completion timestamp is not within the late window', () => {
  assert.equal(
    isWithinLateWindow(new Date('2026-11-16T12:01:00.000Z'), NOW),
    false,
  )
  assert.equal(isWithinLateWindow(null, NOW), false)
})

test('recordedAt must fall between departure and completion plus five minutes', () => {
  const shipment = {
    route: { departure: new Date('2026-11-16T08:00:00.000Z') },
    completedAt: new Date('2026-11-16T10:00:00.000Z'),
  }

  assert.equal(
    isRecordedAtWithinShipmentWindow(
      new Date('2026-11-16T08:00:00.000Z'),
      shipment,
    ),
    true,
  )
  assert.equal(
    isRecordedAtWithinShipmentWindow(
      new Date('2026-11-16T10:05:00.000Z'),
      shipment,
    ),
    true,
  )
  assert.equal(
    isRecordedAtWithinShipmentWindow(
      new Date('2026-11-16T10:05:00.001Z'),
      shipment,
    ),
    false,
  )
  assert.equal(
    isRecordedAtWithinShipmentWindow(
      new Date('2026-11-16T07:59:59.999Z'),
      shipment,
    ),
    false,
  )
})

test('a shipment without departure or completion is not eligible', () => {
  assert.equal(
    isRecordedAtWithinShipmentWindow(new Date(), {
      route: {},
      completedAt: new Date(),
    }),
    false,
  )
  assert.equal(
    isRecordedAtWithinShipmentWindow(new Date(), {
      route: { departure: new Date() },
      completedAt: null,
    }),
    false,
  )
})
