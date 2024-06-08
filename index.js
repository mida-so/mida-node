'use strict'
const assert = require('assert')
const axios = require('axios')
const version = require('./package.json').version

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
        .catch((err) => {
          if (err.response) {
            const error = new Error(err.response.statusText)
            reject(error)
          }
        })
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
        .catch((err) => {
          if (err.response) {
            const error = new Error(err.response.statusText);
            reject(error);
          }
        });
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
        .catch((err) => {
          if (err.response) {
            const error = new Error(err.response.statusText)
            reject(error)
          }
        })
    })
  }

  cachedFeatureFlag() {
    const cacheKey = `${this.publicKey}:${this.user_id}`
    const cachedFeatures = this.featureFlagCache.get(cacheKey)
    if (cachedFeatures) return cachedFeatures
    return []
  }

  isFeatureEnabled(key) {
    return new Promise((resolve) => {
      this.enabled_features = this.cachedFeatureFlag()
      resolve(this.enabled_features.includes(key))
    })
  }

  onFeatureFlags(distinctId = null) {
    return new Promise(async (resolve, reject) => {
      const cachedItems = this.cachedFeatureFlag().length
      try {
        await this.reloadFeatureFlags(distinctId)
        if (!cachedItems) resolve()
      } catch (e) {
        reject(e)
      }
      if (cachedItems) resolve()
    })
  }

  reloadFeatureFlags(distinctId = null) {
    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        user_id: distinctId
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
          const cacheKey = `${this.publicKey}:${this.user_id}`
          this.featureFlagCache.set(cacheKey, result.data)
      
          if (this.featureFlagCache.size > this.maxCacheSize) {
            const oldestKey = this.featureFlagCache.keys().next().value
            this.featureFlagCache.delete(oldestKey)
          }
          resolve()
        })
        .catch((err) => {
          if (err.response) {
            const error = new Error(err.response.statusText)
            reject(error)
          }
        })
    })
  }
}

module.exports = Mida
