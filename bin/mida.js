#!/usr/bin/env node
'use strict'
/**
 * mida: set up Mida from a terminal or a coding agent.
 *
 *   mida init --email you@example.com --accept-terms    register, ask for the emailed code, save the keys
 *   mida register --email you@example.com --accept-terms   step 1 on its own (for agents with no prompt)
 *   mida claim --code 123456                            step 2 on its own
 *   mida snippet                                        the install tag for this project
 *   mida doctor [--wait]                                is the tag sending visitors?
 *   mida check <test_id>                                run the setup rules over a saved experiment
 *
 * It only talks to Mida's public V2 API. The API key is written to .env and never printed.
 */
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const axios = require('axios')
const version = require('../package.json').version

const HOSTS = { us: 'https://api-us.mida.so', eu: 'https://api-eu.mida.so' }
const TERMS_URL = 'https://www.mida.so/terms'
const CLAIM_FILE = path.join('.mida', 'claim.json')
const ENV_FILE = '.env'

class CliError extends Error {
  constructor(message, exitCode) {
    super(message)
    this.exitCode = exitCode === undefined ? 1 : exitCode
  }
}

// ── Arguments ────────────────────────────────────────────────────────────────
const BOOLEAN_FLAGS = ['accept-terms', 'json', 'wait', 'help', 'version']

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.indexOf('--') !== 0) { out._.push(arg); continue }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq)
    if (eq !== -1) { out[name] = arg.slice(eq + 1); continue }
    if (BOOLEAN_FLAGS.indexOf(name) !== -1) { out[name] = true; continue }
    const next = argv[i + 1]
    if (next === undefined || next.indexOf('--') === 0) throw new CliError(`--${name} needs a value`)
    out[name] = next
    i++
  }
  return out
}

// ── .env and .gitignore ──────────────────────────────────────────────────────
function readEnvFile(cwd) {
  const out = {}
  let text
  try { text = fs.readFileSync(path.join(cwd, ENV_FILE), 'utf8') } catch (e) { return out }
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) return
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  })
  return out
}

/** Sets keys in .env, replacing a line that already sets one and leaving every other line alone. */
function writeEnvFile(cwd, values) {
  const file = path.join(cwd, ENV_FILE)
  let lines = []
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/) } catch (e) { lines = [] }
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  const left = Object.assign({}, values)
  lines = lines.map(line => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)
    if (!m || left[m[1]] === undefined) return line
    const next = `${m[1]}=${left[m[1]]}`
    delete left[m[1]]
    return next
  })
  Object.keys(left).forEach(k => lines.push(`${k}=${left[k]}`))
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 })
}

/** Adds entries to .gitignore unless a line already covers them. Returns the entries it added. */
function ensureGitignored(cwd, entries) {
  const file = path.join(cwd, '.gitignore')
  let text = ''
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { text = '' }
  const have = text.split(/\r?\n/).map(l => l.trim())
  const covered = entry => have.some(l => l === entry || l === '/' + entry || l === entry.replace(/\/$/, '') || (entry === ENV_FILE && (l === '.env*' || l === '*.env')))
  const missing = entries.filter(e => !covered(e))
  if (!missing.length) return []
  fs.writeFileSync(file, text + (text && !/\n$/.test(text) ? '\n' : '') + missing.join('\n') + '\n')
  return missing
}

// ── API ──────────────────────────────────────────────────────────────────────
function hostFor(region, env) {
  if (env.MIDA_API_HOST) return String(env.MIDA_API_HOST).replace(/\/+$/, '')
  const r = String(region || 'us').toLowerCase()
  if (!HOSTS[r]) throw new CliError(`Unknown region "${region}". Use us or eu.`)
  return HOSTS[r]
}

async function request(method, url, opts) {
  opts = opts || {}
  const headers = { 'user-agent': `mida-cli/${version}` }
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`
  if (opts.body) headers['content-type'] = 'application/json'
  let res
  try {
    res = await axios({ method, url, data: opts.body, headers, timeout: 60000, validateStatus: () => true })
  } catch (err) {
    throw new CliError(`Could not reach Mida: ${err && err.message ? err.message : String(err)}`)
  }
  const data = res.data && typeof res.data === 'object' ? res.data : {}
  if (res.status >= 200 && res.status < 300) return data
  const e = new CliError(data.error || `Mida API returned ${res.status}`)
  e.status = res.status
  e.code = data.code
  throw e
}

/** Project credentials from the environment first, then .env in the working directory. */
function credentials(io) {
  const file = readEnvFile(io.cwd)
  const pick = name => io.env[name] || file[name]
  const apiKey = pick('MIDA_API_KEY')
  const projectKey = pick('MIDA_PROJECT_KEY')
  if (!apiKey || !projectKey) {
    throw new CliError('MIDA_API_KEY and MIDA_PROJECT_KEY are not set. Run `mida init --email you@example.com --accept-terms` first.')
  }
  const region = pick('MIDA_REGION') || 'us'
  return { apiKey, projectKey, region, base: `${hostFor(region, io.env)}/v2/project/${encodeURIComponent(projectKey)}` }
}

// ── Commands ─────────────────────────────────────────────────────────────────
async function cmdRegister(args, io) {
  if (!args.email) throw new CliError('Pass the email address to register: --email you@example.com')
  if (!args['accept-terms']) {
    throw new CliError(`Registering accepts the Mida terms (${TERMS_URL}) for that person. Ask them first, then pass --accept-terms.`)
  }
  const region = String(args.region || 'us').toLowerCase()
  const host = hostFor(region, io.env)
  const out = await request('POST', `${host}/v2/agent/register`, {
    body: { email: args.email, terms_accepted: true, name: args.name, client: args.client || 'mida-cli' }
  })
  const dir = path.join(io.cwd, path.dirname(CLAIM_FILE))
  if (!fs.existsSync(dir)) fs.mkdirSync(dir)
  fs.writeFileSync(path.join(io.cwd, CLAIM_FILE), JSON.stringify({ claim_token: out.claim_token, region, email: args.email }), { mode: 0o600 })
  ensureGitignored(io.cwd, ['.mida/'])
  if (args.json) return io.out(JSON.stringify({ registered: true, email: args.email, region, expires_in: out.expires_in }))
  io.out(`Mida emailed a 6-digit code to ${args.email}. It expires in 15 minutes.`)
  io.out('If nothing arrives in a few minutes, that address may already have a Mida account: create an API key at https://app.mida.so (Settings, API).')
  return out
}

async function cmdClaim(args, io) {
  const code = String(args.code || args._[1] || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(code)) throw new CliError('Pass the 6-digit code from the email: mida claim --code 123456')
  let claim
  try { claim = JSON.parse(fs.readFileSync(path.join(io.cwd, CLAIM_FILE), 'utf8')) } catch (e) {
    throw new CliError('No registration in progress here. Run `mida register --email you@example.com --accept-terms` first.')
  }
  let out
  try {
    out = await request('POST', `${hostFor(claim.region, io.env)}/v2/agent/claim`, { body: { claim_token: claim.claim_token, code } })
  } catch (err) {
    // A wrong code can be retried with the same claim; anything else has spent it.
    if (err.code !== 'wrong_code' && err.code !== 'rate_limited' && err.code !== 'claim_in_progress' && err.status) {
      try { fs.unlinkSync(path.join(io.cwd, CLAIM_FILE)) } catch (e) {}
    }
    throw err
  }
  writeEnvFile(io.cwd, { MIDA_API_KEY: out.api_key, MIDA_PROJECT_KEY: out.project_key, MIDA_REGION: out.region })
  const ignored = ensureGitignored(io.cwd, [ENV_FILE])
  try { fs.unlinkSync(path.join(io.cwd, CLAIM_FILE)) } catch (e) {}
  try { fs.rmdirSync(path.join(io.cwd, path.dirname(CLAIM_FILE))) } catch (e) {}
  if (args.json) {
    return io.out(JSON.stringify({ claimed: true, project_key: out.project_key, region: out.region, env_file: ENV_FILE, dashboard: out.dashboard }))
  }
  io.out(`Account created. Project key: ${out.project_key} (${out.region})`)
  io.out(`MIDA_API_KEY, MIDA_PROJECT_KEY and MIDA_REGION are saved in ${ENV_FILE}.` + (ignored.length ? ` ${ENV_FILE} was added to .gitignore.` : ''))
  if (out.dashboard && out.dashboard.sign_in) io.out(out.dashboard.sign_in)
  io.out('Next: `mida snippet` for the install tag, then `mida doctor --wait` once it is on the site.')
  return out
}

function ask(io, question) {
  if (io.prompt) return io.prompt(question)
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, answer => { rl.close(); resolve(answer) })
  })
}

async function cmdInit(args, io) {
  await cmdRegister(Object.assign({}, args, { json: false }), io)
  if (!io.interactive) {
    io.out('Ask the person for the code, then run: mida claim --code <6 digits>')
    return
  }
  for (;;) {
    const code = String(await ask(io, 'Code from the email: ')).trim()
    if (!code) throw new CliError('No code entered. Run `mida claim --code <6 digits>` when you have it.')
    try {
      return await cmdClaim(Object.assign({}, args, { code }), io)
    } catch (err) {
      if (err.code !== 'wrong_code' && !/6-digit/.test(err.message)) throw err
      io.out(err.message)
    }
  }
}

async function cmdSnippet(args, io) {
  const c = credentials(io)
  const out = await request('GET', `${c.base}/install-snippet`, { apiKey: c.apiKey })
  if (args.json) return io.out(JSON.stringify(out))
  io.out(out.tag)
  io.out('')
  io.out('Paste it inside <head>, as high as possible, exactly as shown. Do not defer it.')
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function cmdDoctor(args, io) {
  const c = credentials(io)
  const minutes = Math.max(1, Math.min(60, Number(args.timeout) || 10))
  const deadline = Date.now() + minutes * 60000
  let out
  for (;;) {
    out = await request('GET', `${c.base}/install-health`, { apiKey: c.apiKey })
    if (!args.wait || out.verdict !== 'not_installed' || Date.now() >= deadline) break
    if (!args.json) io.out('No visitor yet. Load a page on the site; checking again in 30 seconds.')
    await (io.sleep || sleep)(30000)
  }
  if (args.json) io.out(JSON.stringify(out))
  else {
    io.out(`Install health: ${out.verdict}`)
    io.out(`Visitors in the last 7 days: ${out.visitors_7d}`)
    if (out.next_action) io.out(out.next_action)
  }
  if (out.verdict === 'not_installed' || out.verdict === 'tag_not_running') throw new CliError('', 2)
}

async function cmdCheck(args, io) {
  const testId = String(args._[1] || args.test || '')
  if (!/^\d+$/.test(testId)) throw new CliError('Pass the experiment id: mida check 1234')
  const c = credentials(io)
  const out = await request('GET', `${c.base}/experiment/${testId}/pre-publish-check`, { apiKey: c.apiKey })
  if (args.json) io.out(JSON.stringify(out))
  else {
    io.out(out.ready ? `Experiment ${testId}: ready. ${out.passed} checks passed.` : `Experiment ${testId}: not ready. ${out.blockers.length} to fix before launch.`)
    out.blockers.forEach(b => io.out(`  FIX   [${b.step}] ${b.title}: ${b.detail}`))
    out.warnings.forEach(w => io.out(`  WARN  [${w.step}] ${w.title}: ${w.detail}`))
    if (out.not_covered) io.out(out.not_covered)
  }
  if (!out.ready) throw new CliError('', 2)
}

const HELP = `mida ${version}: set up Mida A/B testing from a terminal or a coding agent

  mida init --email <email> --accept-terms [--region us|eu] [--name <name>] [--client <agent>]
      Create a Mida account for that person. Mida emails them a 6-digit code; enter it when
      asked. The API key and project key are saved to .env.
  mida register --email <email> --accept-terms [--region us|eu]
  mida claim --code <6 digits>
      The same two steps on their own, for an agent that cannot answer a prompt.
  mida snippet            Print the install tag for this project.
  mida doctor [--wait]    Check that the tag is sending visitors. --wait polls for up to 10 minutes.
  mida check <test_id>    Run Mida's setup rules over a saved experiment before launching it.

  --json prints machine-readable output. Exit code 2 means the check ran and found a problem.
  --region eu for people and sites in the EU. An account cannot change region later.
  Registering accepts ${TERMS_URL} for that person: ask them before passing --accept-terms.`

const COMMANDS = { init: cmdInit, register: cmdRegister, claim: cmdClaim, snippet: cmdSnippet, doctor: cmdDoctor, check: cmdCheck }

/** Runs one command. Returns the process exit code; never throws. */
async function run(argv, io) {
  io = Object.assign({ cwd: process.cwd(), env: process.env, out: s => console.log(s), err: s => console.error(s), interactive: !!process.stdin.isTTY }, io || {})
  try {
    const args = parseArgs(argv)
    if (args.version) { io.out(version); return 0 }
    const name = args._[0]
    if (args.help || !name) { io.out(HELP); return 0 }
    if (!COMMANDS[name]) throw new CliError(`Unknown command "${name}". Run \`mida --help\`.`)
    await COMMANDS[name](args, io)
    return 0
  } catch (err) {
    if (err && err.message) io.err(err instanceof CliError ? err.message : `mida: ${err.message}`)
    return err instanceof CliError ? err.exitCode : 1
  }
}

module.exports = { run, parseArgs, readEnvFile, writeEnvFile, ensureGitignored }

if (require.main === module) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code })
}
