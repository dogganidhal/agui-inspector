<div align="center">

<img src="branding/icon.svg" alt="" width="72" height="72">

# agui-inspector

A developer tool for [AG-UI](https://docs.ag-ui.com) servers. Point it at an agent and see the wire.

[Try the playground](https://dogganidhal.github.io/agui-inspector/) · [Embed in Python](#embed-in-python) · [Documentation](#documentation) · [Roadmap](ROADMAP.md) · [Contributing](CONTRIBUTING.md)

[![Pages](https://github.com/dogganidhal/agui-inspector/actions/workflows/pages.yml/badge.svg)](https://github.com/dogganidhal/agui-inspector/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0a0a0a.svg)](LICENSE)
[![AG-UI 1.0](https://img.shields.io/badge/AG--UI-1.0-0a0a0a.svg)](https://docs.ag-ui.com)
[![A2UI v0.9](https://img.shields.io/badge/A2UI-v0.9-0a0a0a.svg)](docs/a2ui.md)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/run-dark.webp">
  <img alt="The inspector after an A2UI run: the deploy board the agent drew on the left, and on the right the run's ten frames, each with its arrival time and a passing check." src="docs/images/run-light.webp">
</picture>

agui-inspector shows every request it sends and every event that comes back, in order, with its timing, checked
against the protocol. It drives runs the way a client does, answering interrupts, tool calls and A2UI surfaces, and it
can send the requests no client would.

## Try the playground

Open the [public demo](https://dogganidhal.github.io/agui-inspector/). There is nothing to install. Pick an example
agent beside the endpoint and send one of its quick messages: a plain reply, interrupts, client tool calls, state
updates, a broken stream, seven A2UI stories and every baseline event type. The examples are scripted and answered by a
service worker inside the page, so no model or server is involved.

### Inspect your own server

Your browser sends the requests straight to your server. The inspector has no proxy and cannot get around a browser rule.

1. Allow the page's origin, `https://dogganidhal.github.io`, in your server's CORS settings. The
   [FastAPI example](docs/hosted.md#allow-the-page-in-your-own-server) is narrowly scoped and ready to copy. The same
   section explains the permission a browser may ask for before a public page reaches `localhost`.
2. Type the endpoint in the connection bar and press Use endpoint (or Enter). Typing alone changes nothing. For a local
   server use `http://localhost:<port>/...`, the form the inspector accepts in every browser. Remote servers need HTTPS.
3. If the server wants a token, open the authentication control after step 2, because changing the endpoint clears the
   token. Keep the header name `Authorization` and type the complete header value in the Token field, for example
   `Bearer <your-token>`. The inspector sends the value exactly as typed and adds no scheme.

The playground sends no cookies, so a token in that header is the only credential it can present. The
[public demo guide](docs/public-demo.md#your-own-server) covers the limits.

## Embed in Python

`mount_inspector` serves the inspector page from your Starlette or FastAPI app, on the same origin as your agents. The
Python package is private and unpublished, and so is the npm package. There is no registry install yet; build the
package from a source checkout.

### Run the example from a source checkout

You need git, Node 24 or newer with npm, and [uv](https://docs.astral.sh/uv/), which provides Python 3.10 or newer.

```sh
git clone https://github.com/dogganidhal/agui-inspector.git
cd agui-inspector
npm ci --ignore-scripts
npm run package:python
```

`npm run package:python` builds the page, copies it into the Python package and builds a wheel and an sdist into
`packages/python/dist`. Then start the model-free FastAPI example. Its routes sit behind HTTP Basic authentication, so
you choose the user and password:

```sh
EXAMPLE_USER=dev EXAMPLE_PASSWORD=choose-a-password EXAMPLE_DEBUG=1 \
  uv run --project packages/python --locked --extra embedded --group test \
  python examples/fastapi/app.py --port 8000
```

Open <http://127.0.0.1:8000/agui-inspector/> and sign in with that user and password. The page lists one agent, Demo
agent. Send any message to get one scripted run of five frames. If port 8000 is taken, pass another `--port` and change
the URL.

### Mount it in your own app

Install the wheel from `packages/python/dist` into your project's environment. Point the path at your checkout; the file
name carries the version:

```sh
pip install "/path/to/agui-inspector/packages/python/dist/agui_inspector-0.0.0-py3-none-any.whl[embedded]"
```

```python
from agui_inspector import Agent, mount_inspector

mount_inspector(
    app,
    agents=[Agent(id="support", url="/agents/support/stream")],
    enabled=settings.debug,
)
```

The page appears at `/agui-inspector/` and calls your agent routes on the same origin. `enabled` defaults to `False`.
Keep it tied to a debug setting: anyone who reaches the route sees request bodies and raw frames. See
[embedding](docs/embedding.md) and the [FastAPI example](examples/fastapi/app.py).

The mount adds no authentication. The page, its `config.json` and its assets sit behind the guards your app already
has: middleware, a reverse proxy or, on FastAPI, dependencies set on the app you pass to `mount_inspector`. Dependencies
on an enclosing app that mounts yours do not run for it. The guard has to accept what a browser sends when it opens a
page, such as a session cookie or HTTP Basic credentials. A bearer header cannot be attached to a page load. See
[authentication](docs/embedding.md#authentication).

### What the mount is

`mount_inspector` adds a separate page to your server. That page makes its own requests to your agent URLs, so it shows
the runs it starts. It does not see the runs your own frontend starts. Watching the `AbstractAgent` your frontend
already runs is the planned in-app mode, which is not built.

## Modes

| Mode | What it is | Status |
| --- | --- | --- |
| Hosted | A static page with a `hosting-config.json` that lists the origins it may reach. The public demo is one. | Available: [live demo](https://dogganidhal.github.io/agui-inspector/), or build the page from a checkout |
| Python | `mount_inspector` serves the page from a Starlette or FastAPI app, on the same origin as your agents. | Available from a source checkout |
| Static assets | `staticAssetsPath` points at the built page, for any other server to serve. | Available from a source checkout |
| CLI | A local command that serves the page and proxies to a target. | Planned for 1.0.0 |
| JS helpers | Express, Hono and Next.js route-handler integrations. | Planned for 1.0.0 |
| In-app | A custom element that watches an `AbstractAgent` your application already runs. | Planned for 1.0.0 |

## What it does

- Records each HTTP exchange and SSE frame exactly as it arrived, with its timing. Frames that are not JSON or that
  break the protocol stay in the list; nothing is dropped, repaired or reordered.
- Validates frames against the AG-UI schemas and event sequence rules, and marks each finding on its frame and run.
- Shows all 31 baseline event types in a filterable frames list with a timeline, a conversation view and a state view.
- Answers interrupts and client tool calls by hand, and draws A2UI v0.9 surfaces with the official renderer, sending
  their actions back to the agent.
- Sends raw JSON from an editor unchanged, including run inputs that fail the schema.
- Reads agents and presets (variables, preparation requests, forwarded properties) from a configuration file, and keeps
  client profiles in the browser with JSON import and export. Sessions export to a file and import again later.
- Restyles through ten public `--agui-*` CSS properties for light and dark mode, with no rebuild.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/issues-dark.webp">
  <img alt="A run with a broken frame: the unparsable bytes stay in the frames list at their position, the run shows a sequence error for a message that was never started, and the run still finishes." src="docs/images/issues-light.webp">
</picture>

## Host the page yourself

`npm run build` writes the page to `packages/inspector/dist`. Deploy that directory to any static host with a
`hosting-config.json` that names the agent origins the page may call, and optionally a `config.json` that lists your
agents. The page builds its content security policy from that file at startup and refuses every other destination. The
npm package that exports `staticAssetsPath` is private, so serve `packages/inspector/dist` from your checkout. See
[hosted](docs/hosted.md) and [configuration](docs/configuration.md).

## Privacy

- The page sends no telemetry and loads nothing from third parties. It talks to its own origin and the targets you
  configure.
- A token you type stays in memory. The inspector never writes it to storage, configuration, recordings or exports, and
  the recorder never reads headers.
- What a server sends is kept as sent, even when it echoes a credential. The export dialog warns that raw frames may hold
  sensitive data.
- Scripts load only from the page's origin, and `eval` is blocked by the content security policy.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Status

The 0.1.0 MVP is implemented on `main` and the public demo is live. Nothing is published to PyPI or npm. The
[current status](ROADMAP.md#current-status) in the roadmap lists what is still to be verified and what a first release
needs.

## Documentation

| Page | What it covers |
| --- | --- |
| [Public demo](docs/public-demo.md) | The example agents, their pacing, and pointing the demo at your own server. |
| [Embedding](docs/embedding.md) | `mount_inspector` for Starlette and FastAPI: arguments, routes, authentication. |
| [Hosted](docs/hosted.md) | Static deployment, `hosting-config.json` and the content security policy. |
| [Configuration](docs/configuration.md) | `config.json`, presets, client profiles and migrations. |
| [Connecting and driving runs](docs/conversation.md) | Endpoints, tokens, interrupts, tool results, raw submissions, Stop and New thread. |
| [Event views](docs/event-views.md) | How each of the 31 event types reaches the conversation and state views. |
| [Inspection](docs/inspection.md) | What the recorder keeps, how bytes become frames, and the findings it reports. |
| [A2UI surfaces](docs/a2ui.md) | Rendering `a2ui-surface` activities and sending their actions. |
| [Session recordings](docs/recordings.md) | The session file format and what to check before sharing one. |
| [Theming](docs/theming.md) | The `--agui-*` properties and the view primitives. |
| [Distribution](docs/distribution.md) | Release gates and how the Python release works. |
| [Build provenance](docs/build-provenance.md) | The checks that tie packaged assets to the build. |
| [Dependencies](docs/dependencies.md) | Why each dependency is there. |
| [Development](docs/development.md) | Every command, the CI gate and the benchmark. |

The [constitution](.specify/memory/constitution.md) holds the engineering rules, and [specs/](specs) holds the feature
specifications, plans and tasks.

## Development

You need Node 24 or newer, and [uv](https://docs.astral.sh/uv/) for the Python package.

```sh
npm ci --ignore-scripts            # lockfile install, no lifecycle scripts
npx playwright install chromium    # browser for end-to-end tests
npm run check:ci                   # the pull request gate
```

`npm run build` builds the page and `npm run package:python` builds the wheel and sdist into `packages/python/dist`.
[docs/development.md](docs/development.md) lists every command, and [CONTRIBUTING.md](CONTRIBUTING.md) explains how
to propose a change.

## License

[MIT](LICENSE), Copyright (c) 2026 Nidhal Dogga. Bundled dependencies are listed with their licenses in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

agui-inspector is an independent project. [AG-UI](https://github.com/ag-ui-protocol/ag-ui) and
[A2UI](https://a2ui.org) are open protocols maintained by their own projects.
