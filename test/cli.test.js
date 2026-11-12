'use strict'
// Run with: npm test   (Node 18+). The CLI against a fake of the Mida V2 routes it calls.
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const cli = require('../bin/mida.js')

function fakeApi(handler) {
  const calls = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = JSON.parse(raw) } catch (e) {}
      calls.push({ method: req.method, path: req.url, headers: req.headers, body })
      const [status, payload] = handler(req.method + ' ' + req.url, body)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    host: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r) })
  })))
}

function workspace(api, extra) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mida-cli-'))
  const out = []
  const err = []
  const io = Object.assign({ cwd, env: { MIDA_API_HOST: api.host }, out: s => out.push(s), err: s => err.push(s), interactive: false, sleep: async () => {} }, extra || {})
  return { cwd, out, err, io, read: f => fs.readFileSync(path.join(cwd, f), 'utf8'), exists: f => fs.existsSync(path.join(cwd, f)) }
}

const KEY = 'mk-v1-' + 'a'.repeat(48)
const claimOk = { success: true, api_key: KEY, project_key: 'projKey123', region: 'eu', dashboard: { url: 'https://eu.mida.so', sign_in: 'Set a password at https://eu.mida.so/forgot-password.' } }

test('register needs the email and the terms flag before anything is sent', async () => {
  const api = await fakeApi(() => [200, {}])
  const w = workspace(api)
  assert.equal(await cli.run(['register'], w.io), 1)
  assert.equal(await cli.run(['register', '--email', 'ada@acme.com'], w.io), 1)
  assert.match(w.err[1], /mida\.so\/terms/)
  assert.equal(api.calls.length, 0)
  await api.close()
})

test('register then claim: the key goes to .env, never to the terminal, and both files are gitignored', async () => {
  const api = await fakeApi((route, body) => {
    if (route === 'POST /v2/agent/register') return [200, { success: true, claim_token: 'c'.repeat(48), expires_in: 900 }]
    if (route === 'POST /v2/agent/claim') return body.code === '123456' ? [200, claimOk] : [400, { error: 'That code is not right. 4 tries left.', code: 'wrong_code' }]
    return [404, {}]
  })
  const w = workspace(api)
  fs.writeFileSync(path.join(w.cwd, '.env'), 'OTHER=1\nMIDA_API_KEY=old\n')
  assert.equal(await cli.run(['register', '--email', 'ada@acme.com', '--accept-terms', '--region', 'eu', '--client', 'Claude Code'], w.io), 0)
  assert.deepEqual(api.calls[0].body, { email: 'ada@acme.com', terms_accepted: true, client: 'Claude Code' })
  assert.equal(JSON.parse(w.read('.mida/claim.json')).region, 'eu')
  assert.match(w.read('.gitignore'), /^\.mida\/$/m)

  assert.equal(await cli.run(['claim', '--code', '000000'], w.io), 1)
  assert.ok(w.exists('.mida/claim.json'), 'a wrong code keeps the claim for another try')

  assert.equal(await cli.run(['claim', '--code', '123 456'], w.io), 0)
  assert.equal(w.read('.env'), `OTHER=1\nMIDA_API_KEY=${KEY}\nMIDA_PROJECT_KEY=projKey123\nMIDA_REGION=eu\n`)
  assert.match(w.read('.gitignore'), /^\.env$/m)
  assert.ok(!w.exists('.mida'), 'the claim is removed once used')
  assert.ok(w.out.concat(w.err).join('\n').indexOf(KEY) === -1, 'the API key is never printed')
  assert.match(w.out.join('\n'), /projKey123/)
  await api.close()
})

test('a spent claim is removed; an existing .gitignore entry is not duplicated', async () => {
  const api = await fakeApi((route) => (route === 'POST /v2/agent/register'
    ? [200, { success: true, claim_token: 'c'.repeat(48) }]
    : [410, { error: 'This claim has expired.', code: 'claim_expired' }]))
  const w = workspace(api)
  fs.writeFileSync(path.join(w.cwd, '.gitignore'), 'node_modules\n.mida\n.env*')
  await cli.run(['register', '--email', 'ada@acme.com', '--accept-terms'], w.io)
  assert.equal(w.read('.gitignore'), 'node_modules\n.mida\n.env*')
  assert.equal(await cli.run(['claim', '--code', '123456'], w.io), 1)
  assert.match(w.err[0], /expired/)
  assert.ok(!w.exists('.mida/claim.json'))
  assert.equal(await cli.run(['claim', '--code', '123456'], w.io), 1)
  assert.match(w.err[1], /No registration in progress/)
  await api.close()
})

test('init asks for the code on a terminal, retries a wrong one, and stops at register without one', async () => {
  const api = await fakeApi((route, body) => {
    if (route === 'POST /v2/agent/register') return [200, { success: true, claim_token: 'c'.repeat(48) }]
    return body.code === '123456' ? [200, claimOk] : [400, { error: 'That code is not right. 4 tries left.', code: 'wrong_code' }]
  })
  const answers = ['111111', '123456']
  const w = workspace(api, { interactive: true, prompt: async () => answers.shift() })
  assert.equal(await cli.run(['init', '--email', 'ada@acme.com', '--accept-terms'], w.io), 0)
  assert.equal(api.calls.filter(c => c.path === '/v2/agent/claim').length, 2)
  assert.match(w.read('.env'), /MIDA_PROJECT_KEY=projKey123/)

  const agent = workspace(api)
  assert.equal(await cli.run(['init', '--email', 'bob@acme.com', '--accept-terms'], agent.io), 0)
  assert.match(agent.out.join('\n'), /mida claim --code/)
  assert.ok(!agent.exists('.env'))
  await api.close()
})

test('snippet, doctor and check send the key from .env and report with exit codes', async () => {
  let health = 0
  const api = await fakeApi((route) => {
    if (route === 'GET /v2/project/projKey123/install-snippet') return [200, { success: true, tag: '<script async src="https://cdn-eu.mida.so/js/optimize.js?key=projKey123"></script>' }]
    if (route === 'GET /v2/project/projKey123/install-health') {
      health++
      return [200, health < 3 ? { verdict: 'not_installed', visitors_7d: 0, next_action: 'Install the tag.' } : { verdict: 'no_test_collecting', visitors_7d: 2, next_action: 'Launch a test.' }]
    }
    if (route === 'GET /v2/project/projKey123/experiment/77/pre-publish-check') {
      return [200, { ready: false, passed: 12, blockers: [{ step: 'Goal', title: 'Conversion goal', detail: 'No goal set.' }], warnings: [], not_covered: 'Does not load the page.' }]
    }
    return [401, { error: 'Your API key is wrong' }]
  })
  const w = workspace(api)
  assert.equal(await cli.run(['snippet'], w.io), 1)
  assert.match(w.err[0], /mida init/)
  fs.writeFileSync(path.join(w.cwd, '.env'), `MIDA_API_KEY="${KEY}"\nexport MIDA_PROJECT_KEY=projKey123\n`)

  assert.equal(await cli.run(['snippet'], w.io), 0)
  assert.match(w.out[0], /cdn-eu\.mida\.so\/js\/optimize\.js\?key=projKey123/)
  assert.equal(api.calls[0].headers.authorization, 'Bearer ' + KEY)

  assert.equal(await cli.run(['doctor'], w.io), 2)
  assert.equal(await cli.run(['doctor', '--wait'], w.io), 0)
  assert.equal(health, 3)

  assert.equal(await cli.run(['check', '77'], w.io), 2)
  assert.match(w.out.join('\n'), /FIX {3}\[Goal\] Conversion goal: No goal set\./)
  assert.equal(await cli.run(['check'], w.io), 1)
  assert.equal(await cli.run(['nope'], w.io), 1)
  assert.equal(await cli.run(['--help'], w.io), 0)
  await api.close()
})
