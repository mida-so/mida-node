'use strict'

const assert = require('assert')
const axios = require('axios')
const version = require('./package.json').version

class Mida {
  constructor(publicKey, options) {
    options = options || {}

    assert(publicKey, "You must pass your Mida project's api key.")

    this.publicKey = publicKey
    this.host = 'https://api.mida.so'
  }

  getExperiment(experimentId, distinctId) {
    assert(experimentId, "You must pass your Mida experiment ID.")
    assert(distinctId, "You must pass your user distinct ID.")

    return new Promise((resolve, reject) => {
      const data = {
        key: this.publicKey,
        test_id: experimentId,
        unique_id: distinctId
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
}

module.exports = Mida
