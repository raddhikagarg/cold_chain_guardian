const test = require('node:test')
const assert = require('node:assert/strict')

const app = require('../../src/app')

async function withServer(run) {
  const server = app.listen(0)
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })

  const { port } = server.address()

  try {
    return await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options)
  const text = await response.text()
  let body = null
  if (text.length > 0) body = JSON.parse(text)
  return { response, body }
}

test('GET /api/health keeps the Phase 1 shape', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/health')

    assert.equal(response.status, 503)
    assert.deepEqual(Object.keys(body).sort(), [
      'database',
      'server',
      'service',
      'status',
      'timestamp',
    ])
    assert.equal(body.service, 'cold-chain-guardian-backend')
    assert.equal(body.server, 'running')
    assert.equal(body.status, 'degraded')
    assert.equal(body.database, 'disconnected')
    assert.equal('data' in body, false)
    assert.equal('error' in body, false)
    assert.equal(Number.isNaN(Date.parse(body.timestamp)), false)
  })
})

test('unknown routes return the shared 404 envelope', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/does-not-exist')

    assert.equal(response.status, 404)
    assert.deepEqual(Object.keys(body), ['error'])
    assert.equal(body.error.code, 'RESOURCE_NOT_FOUND')
    assert.match(body.error.message, /was not found/)
    assert.equal('details' in body.error, false)
  })
})

test('malformed JSON returns a 400 validation envelope', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/shipments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"status":',
    })

    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.equal(body.error.message, 'Request body must be valid JSON.')
  })
})

test('invalid pagination is rejected before touching the database', async () => {
  await withServer(async (baseUrl) => {
    for (const query of ['page=0', 'limit=101', 'limit=abc']) {
      const { response, body } = await requestJson(
        baseUrl,
        `/api/shipments?${query}`,
      )

      assert.equal(response.status, 400)
      assert.equal(body.error.code, 'INVALID_QUERY')
      assert.equal(body.error.details.length, 1)
    }
  })
})

test('unknown sort fields are rejected', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(
      baseUrl,
      '/api/shipments?sort=secret:asc',
    )

    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'INVALID_QUERY')
  })
})

test('unknown create fields are rejected without a database', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/shipments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ healthStatus: 'critical' }),
    })

    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.equal(body.error.details[0].field, 'body')
    assert.match(body.error.details[0].message, /unsupported field: healthStatus/)
  })
})

test('invalid create status is rejected', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(baseUrl, '/api/shipments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in-transit' }),
    })

    assert.equal(response.status, 400)
    assert.equal(body.error.details[0].field, 'status')
  })
})

test('empty patches and unknown patch fields are rejected', async () => {
  await withServer(async (baseUrl) => {
    const empty = await requestJson(baseUrl, '/api/shipments/SHP-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(empty.response.status, 400)
    assert.equal(empty.body.error.code, 'VALIDATION_ERROR')

    const unknown = await requestJson(baseUrl, '/api/shipments/SHP-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'delivered' }),
    })
    assert.equal(unknown.response.status, 400)
    assert.equal(unknown.body.error.details[0].field, 'body')
  })
})

test('monitoring replacement validates the body before lookup', async () => {
  await withServer(async (baseUrl) => {
    const { response, body } = await requestJson(
      baseUrl,
      '/api/shipments/SHP-1/monitoring',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ monitoring: {} }),
      },
    )

    assert.equal(response.status, 400)
    assert.equal(body.error.code, 'VALIDATION_ERROR')
    assert.equal(body.error.details[0].field, 'systemAlerts')
  })
})

test('lifecycle endpoints reject unknown body fields before lookup', async () => {
  await withServer(async (baseUrl) => {
    for (const action of ['schedule', 'depart', 'complete', 'archive']) {
      const { response, body } = await requestJson(
        baseUrl,
        `/api/shipments/SHP-1/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ unexpected: true }),
        },
      )

      assert.equal(response.status, 400)
      assert.equal(body.error.code, 'VALIDATION_ERROR')
      assert.equal(body.error.details[0].field, 'body')
    }
  })
})

test('device registration validates its body before touching the database', async () => {
  await withServer(async (baseUrl) => {
    const unknown = await requestJson(baseUrl, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'CCG-1', name: 'One', lastSeenAt: new Date() }),
    })
    assert.equal(unknown.response.status, 400)
    assert.equal(unknown.body.error.code, 'VALIDATION_ERROR')
    assert.equal(unknown.body.error.details[0].field, 'body')

    const invalid = await requestJson(baseUrl, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: 'CCG-1', name: 'One', battery: 120 }),
    })
    assert.equal(invalid.response.status, 400)
    assert.equal(invalid.body.error.details[0].field, 'battery')

    const missing = await requestJson(baseUrl, '/api/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(missing.response.status, 400)
  })
})

test('device listing and reading queries reject invalid pagination', async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      '/api/devices?limit=101',
      '/api/devices/demo/readings?limit=501',
      '/api/shipments/SHP-1/readings?limit=501',
      '/api/devices/demo/events?type=bogus',
      '/api/devices/demo/readings?from=not-a-date',
    ]) {
      const { response, body } = await requestJson(baseUrl, path)
      assert.equal(response.status, 400)
      assert.equal(body.error.code, 'INVALID_QUERY')
    }
  })
})

test('heartbeat, self-test and event bodies are validated before lookup', async () => {
  await withServer(async (baseUrl) => {
    const heartbeat = await requestJson(
      baseUrl,
      '/api/devices/demo/heartbeat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ battery: 101 }),
      },
    )
    assert.equal(heartbeat.response.status, 400)
    assert.equal(heartbeat.body.error.details[0].field, 'battery')

    const selfTest = await requestJson(
      baseUrl,
      '/api/devices/demo/self-test',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ results: [{ sensorId: 'temperature', status: 'broken' }] }),
      },
    )
    assert.equal(selfTest.response.status, 400)
    assert.equal(selfTest.body.error.code, 'VALIDATION_ERROR')

    const event = await requestJson(baseUrl, '/api/devices/demo/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'explode', title: 'No' }),
    })
    assert.equal(event.response.status, 400)
    assert.equal(event.body.error.details[0].field, 'type')
  })
})

test('reading ingestion rejects identifiers and future timestamps before lookup', async () => {
  await withServer(async (baseUrl) => {
    const sample = await requestJson(
      baseUrl,
      '/api/devices/demo/readings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordedAt: new Date().toISOString(),
          temperature: 4,
          sampleId: 'abc',
        }),
      },
    )
    assert.equal(sample.response.status, 400)
    assert.equal(sample.body.error.code, 'VALIDATION_ERROR')
    assert.equal(sample.body.error.details[0].field, 'sampleId')

    const future = await requestJson(
      baseUrl,
      '/api/devices/demo/readings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordedAt: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
          temperature: 4,
        }),
      },
    )
    assert.equal(future.response.status, 422)
    assert.equal(future.body.error.code, 'FUTURE_TIMESTAMP')

    const empty = await requestJson(
      baseUrl,
      '/api/devices/demo/readings',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recordedAt: new Date().toISOString() }),
      },
    )
    assert.equal(empty.response.status, 400)
    assert.equal(empty.body.error.code, 'VALIDATION_ERROR')
  })
})

test('device assignment validates its body before lookup', async () => {
  await withServer(async (baseUrl) => {
    const empty = await requestJson(
      baseUrl,
      '/api/shipments/SHP-1/assign-device',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      },
    )
    assert.equal(empty.response.status, 400)
    assert.equal(empty.body.error.details[0].field, 'deviceId')

    const unknown = await requestJson(
      baseUrl,
      '/api/shipments/SHP-1/assign-device',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId: 'CCG-1', unexpected: true }),
      },
    )
    assert.equal(unknown.response.status, 400)
    assert.equal(unknown.body.error.details[0].field, 'body')
  })
})

test('alert and dashboard endpoints validate input before touching the database', async () => {
  await withServer(async (baseUrl) => {
    const invalidStatus = await requestJson(
      baseUrl,
      '/api/alerts?status=not-a-status',
    )
    assert.equal(invalidStatus.response.status, 400)
    assert.equal(invalidStatus.body.error.code, 'INVALID_QUERY')
    assert.deepEqual(Object.keys(invalidStatus.body), ['error'])

    const repeatedParam = await requestJson(
      baseUrl,
      '/api/dashboard/overview?shipmentId=SHP-1&shipmentId=SHP-2',
    )
    assert.equal(repeatedParam.response.status, 400)
    assert.equal(repeatedParam.body.error.code, 'INVALID_QUERY')

    const unknownBodyField = await requestJson(
      baseUrl,
      '/api/alerts/AL-1/acknowledge',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'not supported' }),
      },
    )
    assert.equal(unknownBodyField.response.status, 400)
    assert.equal(unknownBodyField.body.error.code, 'VALIDATION_ERROR')

    const longNote = await requestJson(
      baseUrl,
      '/api/alerts/AL-1/resolve',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolutionNote: 'x'.repeat(1001) }),
      },
    )
    assert.equal(longNote.response.status, 400)
    assert.equal(longNote.body.error.code, 'VALIDATION_ERROR')
  })
})
