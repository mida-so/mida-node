# Mida.so - Server-side A/B Testing

This is a server-side A/B testing code that allows you to integrate with the Mida A/B testing platform. The code is written in JavaScript and can be used in a Node.js environment.

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

To use the server-side A/B testing code, follow these steps:

1. Import the `Mida` class into your code:

```javascript
const Mida = require('mida-node');
```

2. Create an instance of the `Mida` class by providing your Mida project key:

```javascript
const mida = new Mida('YOUR_PROJECT_KEY');
```

3. Use the `getExperiment` method to retrieve the current version of an experiment for a user. You need to provide the experiment key and the distinct ID of the user:

```javascript
const experimentKey = 'EXPERIMENT_KEY';
const distinctId = 'USER_DISTINCT_ID';

mida.getExperiment(experimentKey, distinctId)
  .then(version => {
    // Handle the experiment version here
  })
  .catch(error => {
    // Handle the error here
  });
```

4. Use the `setEvent` method to log an event for a user. You need to provide the event name and the distinct ID of the user:

```javascript
const eventName = 'EVENT_NAME';
const distinctId = 'USER_DISTINCT_ID';

mida.setEvent(eventName, distinctId)
  .then(() => {
    // Event logged successfully
  })
  .catch(error => {
    // Handle the error here
  });
```

## API Reference

### `Mida(publicKey, options)`

- `publicKey`: (required) Your Mida project key.
- `options`: (optional) An object of additional options.

### `getExperiment(experimentKey, distinctId)`

- `experimentKey`: (required) The key of the experiment you want to get the version of.
- `distinctId`: (required) The distinct ID of the user.

Returns a Promise that resolves to the version of the experiment.

### `setEvent(eventName, distinctId)`

- `eventName`: (required) The name of the event you want to log.
- `distinctId`: (required) The distinct ID of the user.

Returns a Promise that resolves when the event is successfully logged.

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvement, please create a pull request.

## License

This code is open source and available under the MIT License.