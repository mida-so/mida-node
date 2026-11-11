'use strict'
const assert = require('assert')
const axios = require('axios')
const version = require('./package.json').version

const HOSTS = {
  us: 'https://api.mida.so',
  eu: 'https://api-eu.mida.so'
}

const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_FLAG_TTL_MS = 60000
const DEFAULT_MAX_CACHE_SIZE = 50000

// Turns any axios failure into an Error that always settles the caller's promise:
// HTTP errors carry the status code, network errors and timeouts carry the cause.
function toError(err) {
  if (err && err.response) {
    const e = new Error(`Mida API returned ${err.response.status}${err.response.statusText ? ' ' + err.response.statusText : ''}`)
    e.status = err.response.status
    return e
  }
  const e = new Error(`Mida API request failed: ${err && err.message ? err.message : String(err)}`)
  if (err && err.code) e.code = err.code
  e.cause = err
  return e
}

class Mida {
  /**
   * @param {string} publicKey Project key (Dashboard → Settings → API)
   * @param {object} [options]
   * @param {'us'|'eu'} [options.region='us'] Data region of the account. EU accounts must pass 'eu'.
   * @param {string} [options.host] Override the API host (takes precedence over region).
   * @param {number} [options.timeout=10000] Request timeout in milliseconds.
   * @param {number} [options.featureFlagTTL=60000] How long a user's flags are cached, in ms. 0 disables caching.
   * @param {number} [options.maxCacheSize=50000] Maximum number of users whose flags are cached.
   */
  constructor(publicKey, options) {
    options = options || {}
    assert(publicKey, 'You must pass your Mida project key')
    this.publicKey = publicKey

    const region = String(options.region || 'us').toLowerCase()
    assert(HOSTS[region] || options.host, `Unknown Mida region "${options.region}". Use 'us' or 'eu'.`)
    this.host = String(options.host || HOSTS[region]).replace(/\/+$/, '')

    this.timeout = options.timeout === undefined ? DEFAULT_TIMEOUT_MS : options.timeout
    this.featureFlagTTL = options.featureFlagTTL === undefined ? DEFAULT_FLAG_TTL_MS : options.featureFlagTTL
    this.maxCacheSize = options.maxCacheSize || DEFAULT_MAX_CACHE_SIZE

    this.user_id = null
    this.enabled_features = []
    this.featureFlagCache = new Map()
  }

  _post(path, data) {
    const headers = { 'content-type': 'application/json' }
    if (typeof window === 'undefined') {
      headers['user-agent'] = `mida-node/${version}`
    }
    return axios({
      method: 'POST',
      url: `${this.host}${path}`,
      data,
      headers,
      timeout: this.timeout
    }).then(res => res.data, err => { throw toError(err) })
  }

  // A/B Testing methods

  /**
   * Returns the variant assigned to the user ('Control', 'Variant 1', ...), or null when the
   * user is not in the experiment (not live, or unknown key).
   */
  async getExperiment(experimentKey, distinctId) {
    assert(experimentKey, 'You must pass your Mida experiment key')
    const id = distinctId || this.user_id
    assert(id, 'You must pass your user distinct ID')
    const json = await this._post('/experiment/query', {
      key: this.publicKey,
      experiment_key: experimentKey,
      distinct_id: String(id)
    })
    return json && json.version ? json.version : null
  }

  /**
   * Records an event. eventName must match the goal's event name in Mida. For revenue pass
   * properties { revenue, quantity, currency }.
   */
  async setEvent(eventName, distinctId, properties) {
    assert(eventName, 'You need to set an event name')
    const id = distinctId || this.user_id
    assert(id, 'You must pass your user distinct ID')
    await this._post('/experiment/event', {
      key: this.publicKey,
      name: eventName,
      distinct_id: String(id),
      properties: JSON.stringify(properties || {})
    })
  }

  /** Sets user attributes for targeting and segmentation. Does not modify `properties`. */
  async setAttribute(distinctId, properties) {
    const id = distinctId || this.user_id
    assert(id, 'You must pass your user distinct ID')
    assert(properties && typeof properties === 'object', 'You must pass your user properties')
    const data = Object.assign({}, properties, { id: String(id) })
    await this._post(`/track/${encodeURIComponent(this.publicKey)}`, data)
  }

  // Feature flag methods

  _cacheKey(distinctId) {
    return `${this.publicKey}:${distinctId == null ? '' : distinctId}`
  }

  _cached(distinctId) {
    if (!this.featureFlagTTL || this.featureFlagTTL <= 0) return null
    const entry = this.featureFlagCache.get(this._cacheKey(distinctId))
    if (!entry) return null
    if (Date.now() - entry.fetchedAt >= this.featureFlagTTL) return null
    return entry
  }

  async _flags(distinctId, force) {
    if (!force) {
      const hit = this._cached(distinctId)
      if (hit) return hit
    }
    const body = { key: this.publicKey }
    if (distinctId != null && distinctId !== '') body.user_id = String(distinctId)
    const json = await this._post('/feature-flag', body)

    // The API returns { keys: [...], flags: { key: { enabled, type, payload } } }.
    // Accept a bare array too, which older API versions returned.
    const keys = Array.isArray(json) ? json : (json && Array.isArray(json.keys) ? json.keys : [])
    const flags = (json && !Array.isArray(json) && json.flags && typeof json.flags === 'object') ? json.flags : {}
    const entry = { keys, flags, fetchedAt: Date.now() }

    if (this.featureFlagTTL > 0) {
      const cacheKey = this._cacheKey(distinctId)
      this.featureFlagCache.delete(cacheKey) // re-insert so Map order tracks recency
      this.featureFlagCache.set(cacheKey, entry)
      while (this.featureFlagCache.size > this.maxCacheSize) {
        this.featureFlagCache.delete(this.featureFlagCache.keys().next().value)
      }
    }
    return entry
  }

  /**
   * Whether the flag is enabled for the user. Pass distinctId; flags with a rollout percentage
   * or user targeting differ per user. Without distinctId it uses the user from the last
   * onFeatureFlags(distinctId) call, for compatibility with earlier versions.
   * A failed lookup rejects; catch it and treat the feature as off.
   */
  async isFeatureEnabled(key, distinctId) {
    assert(key, 'You must pass a feature flag key')
    const id = distinctId === undefined ? this.user_id : distinctId
    const entry = await this._flags(id, false)
    this.enabled_features = entry.keys
    return entry.keys.includes(key)
  }

  /** Keys of all flags enabled for the user. */
  async getFeatureFlags(distinctId) {
    const id = distinctId === undefined ? this.user_id : distinctId
    const entry = await this._flags(id, false)
    return entry.keys.slice()
  }

  /** The payload configured for a flag, or null when the flag is off or has none. */
  async getFeatureFlagPayload(key, distinctId) {
    assert(key, 'You must pass a feature flag key')
    const id = distinctId === undefined ? this.user_id : distinctId
    const entry = await this._flags(id, false)
    const flag = entry.flags[key]
    return flag && flag.payload !== undefined ? flag.payload : null
  }

  /** Fetches the user's flags again, bypassing the cache, and remembers the user. */
  async onFeatureFlags(distinctId = null) {
    await this.reloadFeatureFlags(distinctId)
  }

  async reloadFeatureFlags(distinctId = null) {
    if (distinctId != null) this.user_id = distinctId
    const entry = await this._flags(distinctId != null ? distinctId : this.user_id, true)
    this.enabled_features = entry.keys
  }

  // Kept for compatibility: the cached flag keys for the last user loaded.
  cachedFeatureFlag() {
    const entry = this._cached(this.user_id)
    return entry ? entry.keys : []
  }
}

module.exports = Mida
module.exports.Mida = Mida
module.exports.default = Mida
