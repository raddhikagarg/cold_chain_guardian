const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const { Shipment } = require('../../src/models')
const {
  validateCreateShape,
  validatePatchShape,
  assertInTransitRoutePatch,
  validateRouteOrdering,
  validateShipmentConfiguration,
  validateMonitoringAvailability,
} = require('../../src/validation/shipmentInput')

const VALID_DEVICE = {
  sensors: ['temperature', 'humidity', 'shock', 'light', 'door', 'ethylene'],
}

function assertBadRequest(run) {
  assert.throws(run, (error) => {
    assert.equal(error.name, 'ApiError')
    assert.equal(error.statusCode, 400)
    assert.equal(error.code, 'VALIDATION_ERROR')
    return true
  })
}

function assertDomainViolation(run, field) {
  assert.throws(run, (error) => {
    assert.equal(error.name, 'ApiError')
    assert.equal(error.statusCode, 422)
    assert.equal(error.code, 'DOMAIN_RULE_VIOLATION')
    if (field) {
      assert.equal(error.details[0].field, field)
    }
    return true
  })
}

test('validateCreateShape accepts a minimal draft and a scheduled shape', () => {
  assert.doesNotThrow(() => validateCreateShape({}))
  assert.doesNotThrow(() =>
    validateCreateShape({ status: 'scheduled', cargo: {}, route: {} }),
  )
})

test('validateCreateShape rejects unknown top-level fields', () => {
  assertBadRequest(() => validateCreateShape({ healthStatus: 'critical' }))
  assertBadRequest(() => validateCreateShape({ status: 'in-transit' }))
  assertBadRequest(() => validateCreateShape({ shipmentId: '   ' }))
  assertBadRequest(() => validateCreateShape({ shipmentId: 'x'.repeat(41) }))
  assertBadRequest(() => validateCreateShape({ isDemo: 'yes' }))
  assertBadRequest(() => validateCreateShape({ deviceId: 42 }))
})

test('validateCreateShape rejects unknown nested fields', () => {
  assertBadRequest(() => validateCreateShape({ cargo: { weight: 10 } }))
  assertBadRequest(() => validateCreateShape({ route: { driver: 'A' } }))
  assertBadRequest(() =>
    validateCreateShape({ monitoring: { temperature: { unknown: 1 } } }),
  )
  assertBadRequest(() =>
    validateCreateShape({ monitoring: { pressure: { enabled: true } } }),
  )
  assertBadRequest(() =>
    validateCreateShape({ systemAlerts: { theft: { enabled: true } } }),
  )
})

test('validateCreateShape accepts a full body', () => {
  assert.doesNotThrow(() =>
    validateCreateShape({
      shipmentId: 'SHP-CUSTOM-1',
      status: 'scheduled',
      cargo: { category: 'fruits', produce: 'Mango', quantity: 10, unit: 'kg' },
      route: {
        origin: 'Nashik',
        destination: 'Pune',
        carrier: 'ColdMove',
        vehicle: 'TR-104',
        departure: '2026-11-15T08:00:00.000Z',
        arrival: '2026-11-15T14:00:00.000Z',
        deadline: '2026-11-15T16:00:00.000Z',
        distanceKm: 210,
        progress: 0,
      },
      monitoring: {
        temperature: {
          available: true,
          enabled: true,
          warning: { max: 8 },
          critical: { max: 10 },
          escalationMinutes: 0,
        },
        door: {
          available: true,
          enabled: false,
          expectedState: null,
          warning: null,
          critical: null,
          escalationMinutes: 0,
        },
      },
      systemAlerts: { offline: { enabled: true, afterMinutes: 10 } },
      deviceId: 'CCG-ESP32-01',
      isDemo: false,
    }),
  )
})

test('validatePatchShape requires at least one editable field', () => {
  assertBadRequest(() => validatePatchShape({}))
  assertBadRequest(() => validatePatchShape({ status: 'delivered' }))
  assert.doesNotThrow(() => validatePatchShape({ cargo: { produce: 'Apple' } }))
  assert.doesNotThrow(() => validatePatchShape({ deviceId: null }))
})

test('assertInTransitRoutePatch allows only progress metadata', () => {
  assert.doesNotThrow(() =>
    assertInTransitRoutePatch({ carrier: 'New', vehicle: 'TR-9', progress: 60 }),
  )
  assertBadRequest(() =>
    assertInTransitRoutePatch({ progress: 60, origin: 'Elsewhere' }),
  )
  assertBadRequest(() => assertInTransitRoutePatch({ departure: null }))
})

test('validateRouteOrdering accepts ordered dates and partial dates', () => {
  const departure = new Date('2026-11-16T06:00:00.000Z')
  const arrival = new Date('2026-11-16T12:00:00.000Z')
  const deadline = new Date('2026-11-16T15:00:00.000Z')

  assert.doesNotThrow(() =>
    validateRouteOrdering({ departure, arrival, deadline }),
  )
  assert.doesNotThrow(() => validateRouteOrdering({ departure }))
  assert.doesNotThrow(() => validateRouteOrdering({}))
})

test('validateRouteOrdering rejects arrival before departure', () => {
  assert.throws(
    () =>
      validateRouteOrdering({
        departure: '2026-11-16T12:00:00.000Z',
        arrival: '2026-11-16T06:00:00.000Z',
      }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.equal(error.code, 'DOMAIN_RULE_VIOLATION')
      assert.equal(error.details[0].field, 'route.arrival')
      return true
    },
  )
})

test('validateRouteOrdering rejects deadline before arrival', () => {
  assert.throws(
    () =>
      validateRouteOrdering({
        departure: '2026-11-16T06:00:00.000Z',
        arrival: '2026-11-16T12:00:00.000Z',
        deadline: '2026-11-16T09:00:00.000Z',
      }),
    (error) => {
      assert.equal(error.statusCode, 422)
      assert.equal(error.code, 'DOMAIN_RULE_VIOLATION')
      assert.equal(error.details[0].field, 'route.deadline')
      return true
    },
  )
})

test('validateRouteOrdering reports both ordering errors', () => {
  assert.throws(
    () =>
      validateRouteOrdering({
        departure: '2026-11-16T12:00:00.000Z',
        arrival: '2026-11-16T06:00:00.000Z',
        deadline: '2026-11-16T05:00:00.000Z',
      }),
    (error) => {
      assert.equal(error.details.length, 2)
      return true
    },
  )
})

function buildShipment(overrides = {}) {
  return new Shipment({
    shipmentId: 'SHP-TEST-1',
    ...overrides,
  })
}

test('validateShipmentConfiguration accepts an untouched draft', () => {
  assert.doesNotThrow(() => validateShipmentConfiguration(buildShipment()))
})

test('validateShipmentConfiguration requires a device when scheduled', () => {
  assertDomainViolation(
    () => validateShipmentConfiguration(buildShipment({ status: 'scheduled' })),
    'configuration',
  )
})

test('validateShipmentConfiguration requires an enabled sensor when scheduled', () => {
  assertDomainViolation(
    () =>
      validateShipmentConfiguration(
        buildShipment({
          status: 'scheduled',
          device: new mongoose.Types.ObjectId(),
        }),
      ),
    'configuration',
  )
})

test('validateShipmentConfiguration rejects ordered thresholds', () => {
  assertDomainViolation(
    () =>
      validateShipmentConfiguration(
        buildShipment({
          status: 'scheduled',
          device: new mongoose.Types.ObjectId(),
          monitoring: {
            temperature: {
              available: true,
              enabled: true,
              warning: { min: 2, max: 8 },
              critical: { min: 3, max: 7 },
              escalationMinutes: 0,
            },
          },
        }),
      ),
    'configuration',
  )
})

test('validateShipmentConfiguration accepts a valid scheduled configuration', () => {
  assert.doesNotThrow(() =>
    validateShipmentConfiguration(
      buildShipment({
        status: 'scheduled',
        device: new mongoose.Types.ObjectId(),
        monitoring: {
          temperature: {
            available: true,
            enabled: true,
            warning: { min: 2, max: 8 },
            critical: { min: 0, max: 10 },
            escalationMinutes: 0,
          },
        },
      }),
    ),
  )
})

test('validateMonitoringAvailability rejects sensors the device lacks', () => {
  const shipment = {
    monitoring: {
      temperature: { available: true, enabled: true },
      ethylene: { available: true, enabled: false },
    },
  }

  assertDomainViolation(
    () =>
      validateMonitoringAvailability(shipment, {
        sensors: ['temperature'],
      }),
    'monitoring',
  )
})

test('validateMonitoringAvailability allows fitted or disabled sensors', () => {
  const shipment = {
    monitoring: {
      temperature: { available: true, enabled: true },
      ethylene: { available: false, enabled: false },
      door: { available: false, enabled: false },
    },
  }

  assert.doesNotThrow(() =>
    validateMonitoringAvailability(shipment, VALID_DEVICE),
  )
})
