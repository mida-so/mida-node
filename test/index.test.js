'use strict'
const test = require('node:test')
const assert = require('node:assert')

// Replace axios with a stub so tests never hit the network.
let handler = async () => ({ data: [] })
const calls = []
const axiosPath = require.resolve('axios')
require.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: (req) => {
    calls.push(req)
    return handler(req)
  }
}

const Mida = require('../index.js')

test('feature flags are cached per user and never leak across users', async () => {
  const mida = new Mida('pk')
  handler = async (req) => ({ data: req.data.user_id === 'alice' ? ['beta'] : ['other'] })

  await mida.onFeatureFlags('alice')
  await mida.onFeatureFlags('bob')

  assert.strictEqual(await mida.isFeatureEnabled('beta', 'alice'), true)
  assert.strictEqual(await mida.isFeatureEnabled('beta', 'bob'), false)
  assert.strictEqual(await mida.isFeatureEnabled('other', 'bob'), true)
  // A user whose flags were never loaded gets nothing.
  assert.strictEqual(await mida.isFeatureEnabled('beta', 'carol'), false)
  assert.strictEqual(await mida.isFeatureEnabled('beta'), false)
})

test('network errors (no response) reject instead of hanging', async () => {
  const mida = new Mida('pk')
  handler = async () => { throw new Error('connect ECONNREFUSED') }

  await assert.rejects(mida.getExperiment('exp', 'u1'), /ECONNREFUSED/)
  await assert.rejects(mida.setEvent('evt', 'u1'), /ECONNREFUSED/)
  await assert.rejects(mida.setAttribute('u1', { a: 1 }), /ECONNREFUSED/)
  await assert.rejects(mida.reloadFeatureFlags('u1'), /ECONNREFUSED/)
  await assert.rejects(mida.onFeatureFlags('u1'), /ECONNREFUSED/)
})

test('HTTP errors reject with the status text', async () => {
  const mida = new Mida('pk')
  handler = async () => { const e = new Error('x'); e.response = { statusText: 'Bad Request' }; throw e }
  await assert.rejects(mida.getExperiment('exp', 'u1'), /Bad Request/)
})

test('getExperiment resolves the version', async () => {
  const mida = new Mida('pk')
  handler = async () => ({ data: { version: 'Variant 1' } })
  assert.strictEqual(await mida.getExperiment('exp', 'u1'), 'Variant 1')
})
