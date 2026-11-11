'use strict'
// Run with: npm test   (Node 18+, uses the built-in node:test runner)
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const Mida = require('..')

// A fake of the four Mida backend routes the SDK calls.
function fakeApi(handler) {
  const calls = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', async () => {
      let body = {}
      try { body = JSON.parse(raw) } catch (e) {}
      calls.push({ path: req.url, headers: req.headers, body })
      const out = await handler(req.url, body, req, res)
      if (out === undefined) return // handler took over the response
      const [status, payload] = out
      res.writeHead(status, { 'content-type': typeof payload === 'string' ? 'text/plain' : 'application/json' })
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const host = `http://127.0.0.1:${server.address().port}`
      resolve({ host, calls, close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r) }) })
    })
  })
}

test('getExperiment returns the variant and sends the expected request', async () => {
  const api = await fakeApi((path, body) => [200, { version: body.experiment_key === 'live' ? 'Variant 1' : null }])
  try {
    const mida = new Mida('pk', { host: api.host })
    assert.equal(await mida.getExperiment('live', 'user-1'), 'Variant 1')
    assert.equal(await mida.getExperiment('not-live', 'user-1'), null)
    const c = api.calls[0]
    assert.equal(c.path, '/experiment/query')
    assert.deepEqual(c.body, { key: 'pk', experiment_key: 'live', distinct_id: 'user-1' })
    assert.match(c.headers['user-agent'], /^mida-node\//)
  } finally { await api.close() }
})

test('numeric distinct IDs are sent as strings', async () => {
  const api = await fakeApi(() => [200, { version: 'Control' }])
  try {
    const mida = new Mida('pk', { host: api.host })
    await mida.getExperiment('k', 42)
    assert.equal(api.calls[0].body.distinct_id, '42')
  } finally { await api.close() }
})

test('HTTP errors reject with the status code', async () => {
  const api = await fakeApi(() => [500, 'Internal Server Error'])
  try {
    const mida = new Mida('pk', { host: api.host })
    await assert.rejects(mida.getExperiment('k', 'u'), err => err.status === 500)
    await assert.rejects(mida.setEvent('e', 'u'), err => err.status === 500)
  } finally { await api.close() }
})

test('network failures reject instead of hanging', async () => {
  const api = await fakeApi(() => [200, {}])
  const host = api.host
  await api.close()
  const mida = new Mida('pk', { host, timeout: 2000 })
  await assert.rejects(mida.getExperiment('k', 'u'), /request failed/)
  await assert.rejects(mida.isFeatureEnabled('f', 'u'), /request failed/)
})

test('timeouts reject instead of hanging', async () => {
  const api = await fakeApi(() => undefined) // never responds
  try {
    const mida = new Mida('pk', { host: api.host, timeout: 100 })
    const started = Date.now()
    await assert.rejects(mida.getExperiment('k', 'u'), /request failed/)
    assert.ok(Date.now() - started < 2000)
  } finally { await api.close() }
})

test('missing arguments throw before any request', async () => {
  const api = await fakeApi(() => [200, {}])
  try {
    const mida = new Mida('pk', { host: api.host })
    await assert.rejects(mida.getExperiment('', 'u'))
    await assert.rejects(mida.getExperiment('k'))
    await assert.rejects(mida.setEvent('', 'u'))
    await assert.rejects(mida.setAttribute('u'))
    await assert.rejects(mida.isFeatureEnabled(''))
    assert.equal(api.calls.length, 0)
    assert.throws(() => new Mida(''))
    assert.throws(() => new Mida('pk', { region: 'asia' }))
  } finally { await api.close() }
})

test('setEvent sends properties as a JSON string, including revenue', async () => {
  const api = await fakeApi(() => [200, 'OK'])
  try {
    const mida = new Mida('pk', { host: api.host })
    await mida.setEvent('Purchase', 'user-1', { revenue: 49.99, quantity: 1, currency: 'USD' })
    await mida.setEvent('signup', 'user-1')
    assert.equal(api.calls[0].path, '/experiment/event')
    assert.equal(api.calls[0].body.name, 'Purchase')
    assert.deepEqual(JSON.parse(api.calls[0].body.properties), { revenue: 49.99, quantity: 1, currency: 'USD' })
    assert.equal(api.calls[1].body.properties, '{}')
  } finally { await api.close() }
})

test('setAttribute posts to /track/:key and does not mutate the caller object', async () => {
  const api = await fakeApi(() => [200, 'OK'])
  try {
    const mida = new Mida('pk', { host: api.host })
    const attrs = { plan: 'pro' }
    await mida.setAttribute('user-1', attrs)
    assert.equal(api.calls[0].path, '/track/pk')
    assert.deepEqual(api.calls[0].body, { plan: 'pro', id: 'user-1' })
    assert.deepEqual(attrs, { plan: 'pro' })
  } finally { await api.close() }
})

test('feature flags read the { keys, flags } response', async () => {
  const api = await fakeApi((path, body) => body.user_id === 'beta'
    ? [200, { keys: ['new-checkout'], flags: { 'new-checkout': { enabled: true, type: 'json', payload: { color: 'red' } } } }]
    : [200, { keys: [], flags: {} }])
  try {
    const mida = new Mida('pk', { host: api.host })
    assert.equal(await mida.isFeatureEnabled('new-checkout', 'beta'), true)
    assert.equal(await mida.isFeatureEnabled('missing', 'beta'), false)
    assert.deepEqual(await mida.getFeatureFlags('beta'), ['new-checkout'])
    assert.deepEqual(await mida.getFeatureFlagPayload('new-checkout', 'beta'), { color: 'red' })
    assert.equal(await mida.getFeatureFlagPayload('missing', 'beta'), null)
    assert.equal(api.calls[0].path, '/feature-flag')
    assert.equal(api.calls[0].body.user_id, 'beta')
  } finally { await api.close() }
})

test('a bare array response is still accepted', async () => {
  const api = await fakeApi(() => [200, ['legacy-flag']])
  try {
    const mida = new Mida('pk', { host: api.host })
    assert.equal(await mida.isFeatureEnabled('legacy-flag', 'u'), true)
  } finally { await api.close() }
})

test('flags are cached per user, not shared across users', async () => {
  const api = await fakeApi((path, body) => [200, { keys: body.user_id === 'beta' ? ['f'] : [], flags: {} }])
  try {
    const mida = new Mida('pk', { host: api.host })
    assert.equal(await mida.isFeatureEnabled('f', 'beta'), true)
    assert.equal(await mida.isFeatureEnabled('f', 'other'), false)
    assert.equal(await mida.isFeatureEnabled('f', 'beta'), true)
    assert.equal(api.calls.length, 2, 'second beta lookup should come from cache')
  } finally { await api.close() }
})

test('flag cache expires after the TTL and can be disabled', async () => {
  let enabled = false
  const api = await fakeApi(() => [200, { keys: enabled ? ['f'] : [], flags: {} }])
  try {
    const mida = new Mida('pk', { host: api.host, featureFlagTTL: 50 })
    assert.equal(await mida.isFeatureEnabled('f', 'u'), false)
    enabled = true
    assert.equal(await mida.isFeatureEnabled('f', 'u'), false, 'within TTL: cached')
    await new Promise(r => setTimeout(r, 70))
    assert.equal(await mida.isFeatureEnabled('f', 'u'), true, 'after TTL: refetched')

    const noCache = new Mida('pk', { host: api.host, featureFlagTTL: 0 })
    await noCache.isFeatureEnabled('f', 'u')
    await noCache.isFeatureEnabled('f', 'u')
    assert.equal(noCache.featureFlagCache.size, 0)
  } finally { await api.close() }
})

test('flag cache is bounded', async () => {
  const api = await fakeApi(() => [200, { keys: [], flags: {} }])
  try {
    const mida = new Mida('pk', { host: api.host, maxCacheSize: 3 })
    for (const u of ['a', 'b', 'c', 'd', 'e']) await mida.isFeatureEnabled('f', u)
    assert.equal(mida.featureFlagCache.size, 3)
  } finally { await api.close() }
})

test('legacy flow: onFeatureFlags(id) then isFeatureEnabled(key) still works', async () => {
  const api = await fakeApi((path, body) => [200, { keys: body.user_id === 'beta' ? ['f'] : [], flags: {} }])
  try {
    const mida = new Mida('pk', { host: api.host })
    await mida.onFeatureFlags('beta')
    assert.equal(await mida.isFeatureEnabled('f'), true)
    assert.deepEqual(mida.cachedFeatureFlag(), ['f'])
    assert.equal(api.calls.length, 1)
  } finally { await api.close() }
})

test('concurrent users do not see each other\'s flags', async () => {
  const api = await fakeApi(async (path, body) => {
    await new Promise(r => setTimeout(r, Math.random() * 20))
    return [200, { keys: [`flag-${body.user_id}`], flags: {} }]
  })
  try {
    const mida = new Mida('pk', { host: api.host })
    const users = Array.from({ length: 30 }, (_, i) => `u${i}`)
    const results = await Promise.all(users.map(u => mida.isFeatureEnabled(`flag-${u}`, u)))
    assert.ok(results.every(Boolean))
  } finally { await api.close() }
})

test('region selects the API host', () => {
  assert.equal(new Mida('pk').host, 'https://api.mida.so')
  assert.equal(new Mida('pk', { region: 'eu' }).host, 'https://api-eu.mida.so')
  assert.equal(new Mida('pk', { region: 'EU' }).host, 'https://api-eu.mida.so')
  assert.equal(new Mida('pk', { host: 'http://localhost:1/' }).host, 'http://localhost:1')
})

// Runs against the real Mida API only when MIDA_PROJECT_KEY is set.
// Optional: MIDA_REGION, MIDA_EXPERIMENT_KEY (live server-side test), MIDA_EVENT_NAME.
test('live API', { skip: !process.env.MIDA_PROJECT_KEY && 'MIDA_PROJECT_KEY not set' }, async () => {
  const mida = new Mida(process.env.MIDA_PROJECT_KEY, { region: process.env.MIDA_REGION || 'us' })
  const prefix = process.env.MIDA_USER_PREFIX || 'mida-node-live'
  assert.equal(await mida.getExperiment('mida-sdk-nonexistent-key', `${prefix}-x`), null)
  assert.ok(Array.isArray(await mida.getFeatureFlags(`${prefix}-x`)))
  const expKey = process.env.MIDA_EXPERIMENT_KEY
  if (!expKey) return
  for (let i = 0; i < 10; i++) {
    const user = `${prefix}-${i}`
    const first = await mida.getExperiment(expKey, user)
    assert.ok(first, `${user} should be assigned`)
    assert.equal(await mida.getExperiment(expKey, user), first, 'assignment is sticky')
    if (i % 2 === 0 && process.env.MIDA_EVENT_NAME) {
      await mida.setEvent(process.env.MIDA_EVENT_NAME, user, { source: 'mida-node live test' })
    }
  }
})
