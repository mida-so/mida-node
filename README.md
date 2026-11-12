# Mida Node.js SDK

Server-side A/B testing and feature flags for Node.js, for use with [Mida](https://www.mida.so).

## Install

```bash
npm install mida-node
```

## Set up from the command line

No Mida account yet? The package includes a small CLI that creates one and saves the keys, for
you or for a coding agent working in your project.

```bash
npx mida-node init --email you@example.com --accept-terms
```

Mida emails you a 6-digit code. Enter it when asked, and the CLI writes `MIDA_API_KEY`,
`MIDA_PROJECT_KEY` and `MIDA_REGION` to `.env` (and adds `.env` to `.gitignore`). The API key is
never printed. `--accept-terms` accepts the [Mida terms](https://www.mida.so/terms). Add
`--region eu` for an EU account; an account cannot change region later.

An agent that cannot answer a prompt runs the two steps separately:

```bash
npx mida-node register --email you@example.com --accept-terms
npx mida-node claim --code 123456
```

| Command | What it does |
|---|---|
| `mida snippet` | Prints the install tag for the project (client-side testing) |
| `mida doctor [--wait]` | Checks that the tag is sending visitors. `--wait` polls for up to 10 minutes |
| `mida check <test_id>` | Runs Mida's setup rules over a saved experiment before you launch it |

Add `--json` for machine-readable output. Exit code 2 means the check ran and found a problem.
If you already have an account, create an API key in the dashboard (Settings, API) and set the
three variables yourself.

## Quick start

Create one client when your application starts and share it.

```javascript
const Mida = require('mida-node')

const mida = new Mida('YOUR_PROJECT_KEY') // Dashboard → Settings → API
const userId = 'user_42'

let variant = null
try {
  variant = await mida.getExperiment('YOUR_EXPERIMENT_KEY', userId)
} catch (err) {
  // Network or API error: show the original experience
}

if (variant === 'Variant 1') {
  // treatment
} else {
  // 'Control', or null when the user is not in the experiment
}

// When the user converts:
await mida.setEvent('signup_completed', userId)
```

EU accounts must select the EU region:

```javascript
const mida = new Mida('YOUR_PROJECT_KEY', { region: 'eu' })
```

## Methods

Every method returns a Promise. A failed request rejects with an `Error`; HTTP errors carry
`err.status`. Requests time out after 10 seconds.

### `getExperiment(experimentKey, distinctId)`

Resolves to the variant for this user: `'Control'`, `'Variant 1'`, `'Variant 2'`, and so on.
Resolves to `null` when the user is not in the experiment, which happens when the experiment is
not live or the key does not match one in the project. The assignment is sticky: the same
`distinctId` always gets the same variant.

### `setEvent(eventName, distinctId, properties)`

Records a conversion event. `eventName` must match the goal's event name in Mida, and
`distinctId` must be the same value passed to `getExperiment`. `properties` is optional.

```javascript
await mida.setEvent('Purchase', userId, { revenue: 99.99, quantity: 1, currency: 'USD' })
```

### `setAttribute(distinctId, attributes)`

Sets user attributes for targeting and segmentation.

```javascript
await mida.setAttribute(userId, { plan: 'pro', country: 'US' })
```

### `isFeatureEnabled(key, distinctId)`

Resolves to whether a feature flag is on for this user. Always pass `distinctId`, since flags
with a rollout percentage or user targeting differ per user.

```javascript
if (await mida.isFeatureEnabled('new-checkout', userId)) {
  // show new checkout
}
```

Flags are cached per user for 60 seconds. `getFeatureFlags(distinctId)` lists a user's enabled
flags, `getFeatureFlagPayload(key, distinctId)` returns a flag's payload, and
`reloadFeatureFlags(distinctId)` skips the cache.

## Options

| Option | Default | Purpose |
|---|---|---|
| `region` | `'us'` | `'eu'` for EU accounts |
| `timeout` | `10000` | Request timeout in milliseconds |
| `featureFlagTTL` | `60000` | Milliseconds a user's flags are cached; `0` disables caching |
| `maxCacheSize` | `50000` | Maximum number of users whose flags are cached |
| `host` | | Override the API host, for tests |

## Upgrading from 1.0

- `isFeatureEnabled` works now. Earlier versions misread the API response and threw
  `includes is not a function`.
- Flags are cached per user. Earlier versions shared one cache entry between all users.
- Network errors and timeouts reject. Earlier versions left the Promise pending forever.
- `isFeatureEnabled(key)` without a `distinctId` still uses the user from the last
  `onFeatureFlags(distinctId)` call, but passing `distinctId` is safer when one client serves
  many users.

## Tests

```bash
npm test
```

Needs Node 18 or later to run the tests; the SDK itself runs on Node 12 or later. To also run
against the real API, set `MIDA_PROJECT_KEY` (and `MIDA_REGION=eu` for EU accounts). Set
`MIDA_EXPERIMENT_KEY` to a live server-side experiment to check assignment, and
`MIDA_EVENT_NAME` to record its goal event.

## License

MIT
