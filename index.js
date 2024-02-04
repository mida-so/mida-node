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
  }

  getExperiment(experimentId, distinctId) {
    assert(experimentId, "You must pass your Mida experiment ID")
    assert(distinctId || this.user_id, "You must pass your user distinct ID")

    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        test_id: experimentId,
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
}

module.exports = Mida
