# Mida.so - Server-side A/B Testing and Feature Flags
This is a server-side A/B testing and feature flags code that allows you to integrate with the Mida platform. The code is written in JavaScript and can be used in a Node.js environment.
## Prerequisites
Before using this code, make sure you have the following set up:
- Node.js installed on your machine
- A Mida.so account with project and experiment key
## Installation
1. Install the necessary dependencies by running the following command:
```
npm install mida-node
```
## Usage
To use the server-side A/B testing and feature flags code, follow these steps:
1. Import the `Mida` class into your code:
```javascript
const Mida = require('mida-node');
```
2. Create an instance of the `Mida` class by providing your Mida project key:
```javascript
const mida = new Mida('YOUR_PROJECT_KEY');
```
### A/B Testing
3. Use the `getExperiment` method to retrieve the current version of an experiment for a user. You need to provide the experiment key and the distinct ID of the user:
```javascript
const experimentKey = 'EXPERIMENT_KEY';
const distinctId = 'USER_DISTINCT_ID';
const version = await mida.getExperiment(experimentKey, distinctId);
if (version === 'Control') {
// Handle Control logic
}
if (version === 'Variant 1') {
// Handle Variant 1 logic
}
// Depending on how many variants you have created
if (version === 'Variant 2') {
// Handle Variant 2 logic
}
```
4. Use the `setEvent` method to log an event for a user. You need to provide the event name and the distinct ID of the user:
```javascript
const eventName = 'EVENT_NAME';
const distinctId = 'USER_DISTINCT_ID';
await mida.setEvent(eventName, distinctId)
```
### User Attributes
5. Use the `setAttribute` method to set user attributes for a specific user. You need to provide the distinct ID of the user and an object containing the attribute key-value pairs:
```javascript
const distinctId = 'USER_DISTINCT_ID';
const attributes = {
gender: 'male',
company_name: 'Apple Inc'
};
await mida.setAttribute(distinctId, attributes);
```
### Feature Flags
6. Use the `isFeatureEnabled` method to check if a feature flag is enabled for the current user:
```javascript
const featureFlagKey = 'FEATURE_FLAG_KEY';
const isEnabled = await mida.isFeatureEnabled(featureFlagKey);
if (isEnabled) {
// Feature flag is enabled, perform corresponding actions
} else {
// Feature flag is disabled, perform alternative actions
}
```
7. Use the `onFeatureFlags` method to reload the feature flags for the current user:
```javascript
await mida.onFeatureFlags();
```
## API Reference
### `Mida(projectKey, options)`
- `projectKey`: (required) Your Mida project key.
- `options`: (optional) An object of additional options.
### `getExperiment(experimentKey, distinctId)`
- `experimentKey`: (required) The key of the experiment you want to get the version of.
- `distinctId`: (required) The distinct ID of the user.
Returns a Promise that resolves to the version of the experiment.
### `setEvent(eventName, distinctId)`
- `eventName`: (required) The name of the event you want to log.
- `distinctId`: (required) The distinct ID of the user.
Returns a Promise that resolves when the event is successfully logged.
### `setAttribute(distinctId, properties)`
- `distinctId`: (required) The distinct ID of the user.
- `properties`: (required) An object containing the attribute key-value pairs.
Returns a Promise that resolves when the attributes are successfully set.
### `isFeatureEnabled(key)`
- `key`: (required) The key of the feature flag you want to check.
Returns a Promise that resolves to a boolean indicating whether the feature flag is enabled or not.
### `onFeatureFlags(distinctId)`
- `distinctId`: (optional) The distinct ID of the user.
Returns a Promise that resolves when the feature flags are successfully reloaded.
## Contributing
Contributions are welcome! If you find any issues or have suggestions for improvement, please create a pull request.
## License
This code is open source and available under the MIT License.
