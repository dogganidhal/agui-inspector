# Public demo

The public demo is the hosted inspector on GitHub Pages, at <https://dogganidhal.github.io/agui-inspector/>. A visitor can
try it two ways: run one of the scripted examples that ship with the page, or type the URL of their own server. It is a
companion to the 0.1.0 MVP. Nothing is published to npm or PyPI, and no tag or release is involved.

The page is deployed by `.github/workflows/pages.yml` on every push to `main`.

## The examples run in your browser

The examples are not a real model or server. A service worker (`service-worker.js`, next to the page) answers a few fixed
routes under `/agui-inspector/__demo__/` with ordinary HTTP responses. The page's own `fetch`, recorder and frame reader
handle those responses exactly as they handle a real server's, so the Frames, Raw request and State views, Stop, interrupts
and tool replies behave the same way. No model, account or network call is involved, and the page makes no request to any
third party.

The answers come from `examples/reference-agent/scenarios.ts`, the same module the Node reference agent uses for its
fixtures. The events in the browser and in the Node tests cannot drift apart.

### Pacing

The interactive and A2UI agents answer at the speed of a model, not in one burst. The service worker runs each answer through
`examples/reference-agent/pacing.ts` before it hands it to the page:

- `RUN_STARTED` goes out at once. The first event after it waits 300 to 900 ms, the way a model reads a request.
- Text, reasoning and tool-call arguments arrive as many small deltas, 20 to 60 ms apart. Text is cut into words. Arguments are
  cut a few characters at a time.
- A new message, step or tool call waits 150 to 400 ms. A tool result waits 400 to 900 ms after its call. A state or surface
  update waits 250 to 600 ms.

A plain reply takes about 0.7 seconds and the other scenarios up to about 1.2. Pacing changes chunking and timing only. The event types come in the same order, and
the deltas of a message join back into the original text, so the frames list shows five word-sized deltas where the unpaced
scenario had one. A delta that has no start event, as in the `broken` scenario, stays the one frame it was, so pacing adds
nothing to the damage. The `slow` scenario still streams "Thinking about it" and then stays open until you press Stop.

The pauses come from a hash of each chunk's position, with no clock and no `Math.random`, so a run takes the same time on every
visit. The protocol examples are exempt. Their bytes are the point (uneven chunks, mixed delimiters), so they reach the page
unchanged and without pauses.

Stop works at any moment of a paced run. It ends the pause the worker is in, drops every frame not yet sent and releases the
response. No closing frame is made up, and nothing arrives afterwards.

The layer belongs to the adapter, so any scenario that returns a `ScenarioResponse` is paced without knowing about it. The
Node reference agent stays at wire speed, which keeps tests fast and their frame counts exact. A test that wants the demo's
behavior passes a profile: `createInteractiveServer({ pace: NATURAL_PACE })`.

| Agent | Quick messages | What it shows |
| --- | --- | --- |
| Interactive scenarios | `Hello there`, `interrupt`, `tools`, `slow`, `state`, `broken` | A plain reply; two interrupts to resolve or cancel; two tool calls that need results; a response held open until you press Stop; state snapshot and delta; a run with a broken frame in the middle. Each message first sends the preparation requests (a session `PUT` and a warm-up `POST`) the preset declares. All of them stream with the pacing described below. |
| A2UI form | `Show the order form` | A form surface. Edit the note and press Send note: the action goes out in a new run and the surface changes in place. |
| Protocol baseline | `Run the baseline protocol example` | 30 of the 31 event types, mixed line delimiters, split into uneven chunks. Not paced. |
| Protocol run error | `Run the failing example` | `RUN_STARTED` then `RUN_ERROR`, the 31st type. |

Choose an agent from the Agent selector beside the endpoint (Settings has the same choice). The first one, Interactive scenarios, is selected at start. The page says in plain text, above
the inspector, that the examples are scripted and run inside the page, and links the
[embedding guide](https://github.com/dogganidhal/agui-inspector/blob/main/docs/embedding.md). The link is ordinary navigation;
the page does not fetch it.

### What the worker does and does not do

- It answers only same-origin requests under the page's own directory, on the six routes in `demo/service-worker.ts`. A
  `GET` where a `POST` is expected gets a 405, a bad JSON body a 400, a missing `threadId` or `runId` a 422, and any other
  path under `__demo__/` a 404 with a JSON body. Everything else (assets, navigation, other paths on the site, other origins,
  your own server) goes to the browser untouched.
- It reads a request's method, URL and body. It does not read headers or cookies, forward anything, or write to a cache, a
  database or storage. Its only timers are the pauses between the chunks of a paced answer. Pressing Stop cancels the response,
  whether it is pausing, streaming or held open, and releases it; no closing frame is made up.
- It takes control of the page without a reload. The page registers it, waits for it to say its name and version, and only
  then shows the examples.

## Your own server

The public page sets `allowVisitorTargets` in its `hosting-config.json`, so a visitor can type any HTTPS endpoint, or plain
HTTP to `localhost` or `127.0.0.1`, with no allowlist and no approval prompt from the inspector. The footer says so:
`requests to this origin, HTTPS targets and supported local servers (use localhost; browser CORS and local-network rules
apply) · no telemetry · headers never recorded`. The page is not a proxy. Your browser sends the request straight to your
server, with no cookies, and the token you type stays in memory and goes out only under the header you choose.

- **CORS.** Your server has to allow the page's origin, `https://dogganidhal.github.io`. A refusal is shown as the failure it
  is; the inspector does not work around it.
- **Local servers.** Use `http://localhost:<port>`. `http://127.0.0.1:<port>` is also accepted. IPv6 (`http://[::1]:…`) is
  refused: browsers do not agree on how a content security policy names it. Your browser may also ask permission before a
  public page reaches a local address. That prompt is the browser's, not the inspector's, and the inspector cannot answer it.
- **Mixed content.** Plain HTTP to anything but those two local hosts is refused before a request is made.
- **What is recorded.** Frames and bodies are kept as your server sent them. If a server repeats a credential you typed, the
  copy in the recording is unchanged, and the export dialog warns you before it writes a file. See
  [recordings](recordings.md).

The policy is explained in [hosted](hosted.md#visitor-chosen-targets). It is off unless a deployment's `hosting-config.json`
turns it on, and an embedded page rejects it.

## When the examples are unavailable

The page prepares the examples for at most 10 seconds. If the browser has no service workers, the page is not a secure
context, the registration is refused, the worker does not take control, or it does not answer in time, the status line says
which, and the same inspector opens with no example agents. You can still type your own server's URL and import a recording.
No example request is sent, and nothing is faked in its place.

To try again, reload the page. A reload clears the current session, so use Export session first if you want to keep it. If the
worker is replaced while you are using the page, the status line says the examples may stop answering. Nothing is reloaded or
resent for you.

A worker from an earlier visit can be left in control. The page asks the browser for a newer one, and if the one in control
is an older version that cannot be replaced, the status line says so and the examples stay off.

## Build and preview

```sh
npm ci --ignore-scripts
node scripts/build-demo.mjs --outdir .build/public-demo --base-path /agui-inspector/
node scripts/bundle-budget.mjs --dir .build/public-demo
```

`scripts/build-demo.mjs` reuses the ordinary app build, so `app.js` and `app.css` are the same bytes as in
`packages/inspector/dist`. It adds the demo's page, `bootstrap.js`, `demo.css`, `service-worker.js`, the hosting file and the
examples' configuration, `examples.json`, to a directory of its own under `.build`. The output holds no `config.json`: the
bootstrap names `examples.json` only after the worker is ready, so an unavailable start asks for `config.json`, gets a 404 and
starts with no agents. The build never writes to the package's `dist`.

The examples' URLs are written into `examples.json` as absolute URLs: a hosted page refuses an endpoint that is not one. They
are `--origin` plus `--base-path` in front of each endpoint and preparation path, and nothing else in the file changes.
Option values are checked: `--origin` is one HTTPS origin (or `http` to `localhost` or `127.0.0.1`) with no path, credentials,
query or fragment; `--base-path` is `/` or `/name/`; `--outdir` is a directory of its own under `.build`. Anything else fails
before a file is written.

**Build for the origin you serve from.** The worker answers only requests to its own origin. If the build names a different
origin than the one serving the page, the examples' requests leave the page for that other origin and never reach the worker.
The default origin is the Pages site above, so the command above builds the deployable artifact. The Pages workflow passes
the site's own origin and base path instead, so a fork deploys under its own address. To preview locally, build for the
origin you will use and serve the directory under the sub-path:

```sh
node scripts/build-demo.mjs --outdir .build/public-demo --origin http://127.0.0.1:4173
mkdir -p .build/preview && rm -rf .build/preview/agui-inspector && cp -R .build/public-demo .build/preview/agui-inspector
python3 -m http.server 4173 --bind 127.0.0.1 --directory .build/preview
```

Then open <http://127.0.0.1:4173/agui-inspector/>. Service workers need a secure context, and loopback is one.

## The ordinary packages hold none of this

The npm package, the Python wheel and the sdist ship `packages/inspector/dist` and nothing from `demo/`. A demo build does not
touch that directory. These checks fail if a worker, the bootstrap, the examples' file or a registration shows up in any of
them:

- `tests/demo/build.test.ts` builds the ordinary app before and after a demo build and compares every byte, packs an ordinary
  package with `npm pack --ignore-scripts` into a directory it owns, and looks inside.
- `packages/python/tests/test_distribution.py` does the same on the real npm archive, wheel and sdist after the package build.
- Both the demo's complete asset set and the ordinary set are measured against the 2,000,000 minified byte and 600,000 gzip
  byte limits, counting every file.

## Deployment, and who authorizes it

`.github/workflows/pages.yml` runs for `main` only: on a push to `main`, or by hand, in which case both jobs refuse any
other branch. Pull requests never run it, and `.github/workflows/ci.yml` has no Pages permission.

1. The build job has read access (`contents: read`, plus `pages: read` to learn the site's origin and base path). It installs
   with `npm ci --ignore-scripts`, builds the demo, checks the budget and the isolation tests, and uploads only
   `.build/public-demo`.
2. The deploy job needs the build job, holds only `pages: write` and `id-token: write`, runs in the `github-pages`
   environment, and reports the page URL. Deployments are serialized and an active one is never cancelled.

Every action is pinned to a commit SHA. The Pages actions and the pins are recorded in the pull request that introduced the
workflow. A pin changes only after someone reads the new release.

The workflow does not turn Pages on, and no step in it can. The maintainer chose the GitHub Actions source and limited the
`github-pages` environment to `main` on 2026-10-02. Without that, the configure step fails and nothing deploys. The workflow
publishes no package and creates no tag or release.

## What is not covered here

- The physical responsiveness check at 5,000 frames (SC-009) stays with the maintainer. The demo build adds no frame-count
  change.
- Numeric loopback addresses were checked in Chromium and Safari only; the Firefox column in [hosted](hosted.md#browser-check)
  is still open.
