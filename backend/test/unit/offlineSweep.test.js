const test = require('node:test')
const assert = require('node:assert/strict')

const {
  backgroundJobsDisabled,
  isOfflineSweepRunning,
  runOfflineSweep,
  startOfflineSweep,
  stopOfflineSweep,
} = require('../../src/services/offlineSweep')

function withEnv(key, value, run) {
  const previous = process.env[key]
  if (value === undefined) delete process.env[key]
  else process.env[key] = value

  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
}

test('background jobs are disabled in tests or by explicit flag', () => {
  withEnv('NODE_ENV', 'test', () => {
    assert.equal(backgroundJobsDisabled(), true)
  })

  withEnv('NODE_ENV', 'development', () => {
    withEnv('DISABLE_BACKGROUND_JOBS', 'true', () => {
      assert.equal(backgroundJobsDisabled(), true)
    })

    withEnv('DISABLE_BACKGROUND_JOBS', undefined, () => {
      assert.equal(backgroundJobsDisabled(), false)
    })
  })
})

test('the sweep does not start when background jobs are disabled', () => {
  withEnv('NODE_ENV', 'test', () => {
    assert.equal(startOfflineSweep(), false)
    assert.equal(isOfflineSweepRunning(), false)
  })
})

test('the sweep starts once, refuses a second start and stops cleanly', async () => {
  withEnv('NODE_ENV', 'development', () => {
    withEnv('DISABLE_BACKGROUND_JOBS', undefined, () => {
      assert.equal(
        startOfflineSweep({ force: true, intervalMs: 60 * 60 * 1000 }),
        true,
      )
      assert.equal(isOfflineSweepRunning(), true)
      assert.equal(
        startOfflineSweep({ force: true, intervalMs: 60 * 60 * 1000 }),
        false,
      )
    })
  })

  await stopOfflineSweep()
  assert.equal(isOfflineSweepRunning(), false)
})

test('a sweep without a database connection is skipped safely', async () => {
  const result = await runOfflineSweep()

  assert.equal(result.skipped, 'database-disconnected')
  assert.equal(result.created, 0)
})

test('concurrent sweep requests share one in-flight execution', async () => {
  const first = runOfflineSweep()
  const second = runOfflineSweep()

  assert.equal(first, second)
  await first
})
