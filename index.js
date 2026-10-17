'use strict'
const assert = require('assert')
const axios = require('axios')
const version = require('./package.json').version

// Always settle the promise: HTTP errors keep their status text as the message,
// network errors (timeouts, DNS, connection reset...) are passed through.
function toError(err) {
  if (err && err.response) return new Error(err.response.statusText)
  return err instanceof Error ? err : new Error(String(err))
}

class Mida {
  constructor(publicKey, options) {
    options = options || {}
    assert(publicKey, "You must pass your Mida project key")
    this.publicKey = publicKey
    this.host = 'https://api.mida.so'
    this.user_id = null
    this.enabled_features = []
    this.maxCacheSize = options.maxCacheSize || 50000
    this.featureFlagCache = new Map()
  }

  // A/B Testing methods
  getExperiment(experimentKey, distinctId) {
    assert(experimentKey, "You must pass your Mida experiment key")
    assert(distinctId || this.user_id, "You must pass your user distinct ID")
    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        experiment_key: experimentKey,
        distinct_id: distinctId || this.user_id
      }

      const headers = {}
      if (typeof window === 'undefined') {
        headers['user-agent'] = `mida-node/${version}`
      }

      const req = {
        method: 'POST',
        url: `${this.host}/experiment/query`,
        data,
        headers
      }
      axios(req)
        .then(result => {
          let json = result.data
          if (json.version) resolve(json.version)
          else resolve(null)
        })
        .catch((err) => reject(toError(err)))
    })
  }

  setEvent(eventName, distinctId, properties = {}) {
    assert(eventName, "You need to set an event name");
    assert(distinctId || this.user_id, "You must pass your user distinct ID");
    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        name: eventName,
        distinct_id: distinctId || this.user_id,
        properties: JSON.stringify(properties)
      };
  
      const headers = {};
      if (typeof window === 'undefined') {
        headers['user-agent'] = `mida-node/${version}`;
      }
  
      const req = {
        method: 'POST',
        url: `${this.host}/experiment/event`,
        data,
        headers
      };
      axios(req)
        .then(() => {
          resolve();
        })
        .catch((err) => reject(toError(err)));
    });
  }

  setAttribute(distinctId, properties = {}) {
    assert(distinctId || this.user_id, "You must pass your user distinct ID")
    assert(properties, "You must pass your user properties")
    return new Promise((resolve, reject) => {
      let data = properties

      data.id = distinctId || this.user_id

      const headers = {}
      if (typeof window === 'undefined') {
        headers['user-agent'] = `mida-node/${version}`
      }

      const req = {
        method: 'POST',
        url: `${this.host}/track/${this.publicKey}`,
        data,
        headers
      }
      axios(req)
        .then(() => {
          resolve()
        })
        .catch((err) => reject(toError(err)))
    })
  }

  // Flags are cached per user so one user's flags are never served to another.
  featureFlagCacheKey(distinctId) {
    return `${this.publicKey}:${distinctId || this.user_id}`
  }

  cachedFeatureFlag(distinctId = null) {
    const cacheKey = this.featureFlagCacheKey(distinctId)
    const cachedFeatures = this.featureFlagCache.get(cacheKey)
    if (cachedFeatures) return cachedFeatures
    return []
  }

  isFeatureEnabled(key, distinctId = null) {
    return new Promise((resolve) => {
      this.enabled_features = this.cachedFeatureFlag(distinctId)
      resolve(this.enabled_features.includes(key))
    })
  }

  onFeatureFlags(distinctId = null) {
    return this.reloadFeatureFlags(distinctId)
  }

  reloadFeatureFlags(distinctId = null) {
    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        user_id: distinctId || this.user_id
      }

      const headers = {}
      if (typeof window === 'undefined') {
        headers['user-agent'] = `mida-node/${version}`
      }

      const req = {
        method: 'POST',
        url: `${this.host}/feature-flag`,
        data,
        headers
      }
      axios(req)
        .then(result => {
          this.enabled_features = result.data
          const cacheKey = this.featureFlagCacheKey(distinctId)
          this.featureFlagCache.set(cacheKey, result.data)
      
          if (this.featureFlagCache.size > this.maxCacheSize) {
            const oldestKey = this.featureFlagCache.keys().next().value
            this.featureFlagCache.delete(oldestKey)
          }
          resolve()
        })
        .catch((err) => reject(toError(err)))
    })
  }
}

module.exports = Mida
