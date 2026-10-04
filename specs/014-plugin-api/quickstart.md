# Quickstart: validate the plugin API

Run from the repository root with Node 24 or newer and uv. Nothing here needs a model or an outside service.

## Prerequisites

```sh
npm ci --ignore-scripts
npx playwright install chromium
uv sync --project packages/python --locked --extra embedded --group test
```

## 1. The example plugin works against the reference agent

```sh
npm run test:e2e -- tests/e2e/plugins --workers=2
```

The spec serves `examples/plugin/plugin.js` from the page's own origin, lists it in `config.json`, and opens the page. It
checks, in order:

1. The footer says `1 plugin`, and no warning shows.
2. A message goes out. The preparation request and the run request reach the agent with `X-Example-Request`, and the
   value differs between them.
3. The run body holds `forwardedProps.examplePlugin`, and the recorded exchange and the run's input show the same body.
4. The reply carries a custom event `example.note` and an activity `example-plan`. Each shows as a card with the
   plugin's output, a frame reference and a Rendered/JSON switch. The JSON switch shows the content as received.
5. The exported session and the frames list are the same as a run without the plugin, except for the request body, and
   none of them holds the header's value.

## 2. Failures never stop the page

```sh
npm run test:unit -- packages/inspector/tests/plugins
npm run test:e2e -- tests/e2e/plugins/failures.spec.ts --workers=2
```

A page with one good plugin and plugins that: do not exist, are not JavaScript, are served as `text/plain`, have no default
function, throw while they register, never finish, redirect to another origin. Each is one "Plugin" warning, the good one
is active, the agents work, and a run goes out. Then hooks and providers that throw: the run is not sent, the line under the
composer says which plugin, and no exchange is recorded.

## 3. Same-origin only, same policy

```sh
npm run test:unit -- packages/inspector/tests/config/plugins.test.ts packages/inspector/tests/hosted/startup.test.ts
```

Every rejected address in FR-002 is one warning and no request. The content security policy text with and without
`plugins` is identical.

## 4. No header reaches a recording

```sh
npm run test:unit -- packages/inspector/tests/runtime/plugins.test.ts
```

The fake `fetch` sees the provider's unique value on the preparation, the run and the raw request. The store snapshot, the
serialized session and the runtime state do not contain it.

## 5. Every serving mode

```sh
npm run build
npm run test:e2e -- tests/e2e/plugins/modes.spec.ts --workers=2
npm run test:unit -- packages/inspector/tests/server
uv run --project packages/python python -m unittest discover -s packages/python/tests
```

The same plugin and the same configuration give the same page when the build is served hosted, embedded, by a generic
static server, by the Python helper and by the Express, Hono and Next.js helpers. A helper called without `plugins`
serves the `config.json` it served before.

## 6. The command (after feature 005 has merged)

```sh
npm run test:unit -- packages/inspector/tests/cli
npm run test:e2e -- tests/e2e/cli --workers=2
```

`--plugin ./sign.js` makes the plugin active and its header reaches the reference agent through the relay. A missing file
stops the command with exit code 2 before it listens.

## 7. The whole gate

```sh
npm run check:ci
```

Typecheck, unit tests, build, bundle budget (2,000,000 B minified, 600,000 B gzip), end-to-end tests and Python tests.
