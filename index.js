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

  setEvent(eventName, distinctId) {
    assert(eventName, "You need to set an event name")
    assert(distinctId || this.user_id, "You must pass your user distinct ID")
    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        name: eventName,
        distinct_id: distinctId || this.user_id
      }

      const headers = {}
      if (typeof window === 'undefined') {
        headers['user-agent'] = `mida-node/${version}`
      }

      const req = {
        method: 'POST',
        url: `${this.host}/experiment/event`,
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

  // Feature Flag methods
  async saveCachedFeaturesToDatabase(features) {
    const cacheKey = `${this.publicKey}:${this.user_id}`
    this.featureFlagCache.set(cacheKey, features)

    // If the cache size exceeds the maximum limit, remove the oldest entry
    if (this.featureFlagCache.size > this.maxCacheSize) {
      const oldestKey = this.featureFlagCache.keys().next().value
      this.featureFlagCache.delete(oldestKey)
    }
  }

  async getCachedFeaturesFromDatabase() {
    const cacheKey = `${this.publicKey}:${this.user_id}`
    return this.featureFlagCache.get(cacheKey)
  }

  async cachedFeatureFlag() {
    // Retrieve cached features from a database or file system
    const cachedFeatures = await getCachedFeaturesFromDatabase()
    if (cachedFeatures) {
      this.enabled_features = JSON.parse(cachedFeatures)
      return this.enabled_features
    }
    return []
  }

  async isFeatureEnabled(key) {
    this.enabled_features = await this.cachedFeatureFlag()
    return this.enabled_features.includes(key)
  }

  async onFeatureFlags(callback) {
    const cachedItems = (await this.cachedFeatureFlag()).length
    try {
      await this.reloadFeatureFlags()
      if (!cachedItems) callback()
    } catch (e) {
      console.error(e)
    }
    if (cachedItems) callback()
  }

  async reloadFeatureFlags() {
    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey
      }

      const headers = {}
      if (typeof window === 'undefined') {
        headers['user-agent'] = `mida-node/${version}`
      }

      const req = {
        method: 'POST',
        url: `${this.host}/feature-flag/query`,
        data,
        headers
      }
      axios(req)
        .then(async result => {
          this.enabled_features = result.data
          // Save enabled features to a database or file system
          await saveCachedFeaturesToDatabase(JSON.stringify(this.enabled_features))
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
