# Embedding in Starlette and FastAPI

`agui-inspector` is the approved package name and the project is MIT licensed. The Python package is private
and unpublished until the first release (see [distribution](distribution.md#python-release)). The package ships the prebuilt
inspector files and one helper, `mount_inspector`, that serves
them from an existing Starlette or FastAPI application. The host needs no Node toolchain, and
the helper downloads nothing at startup.

The helper adds a separate page to your server. That page makes its own requests to your agent URLs, so it records the
runs it starts. It does not attach to the agent your own frontend runs and does not see that agent's requests.
Watching a host application's `AbstractAgent` is the planned in-app mode (see the [roadmap](../ROADMAP.md#100-stable-target)),
which is not built.

## Enable it

```python
from agui_inspector import Agent, mount_inspector

mount_inspector(
    app,
    agents=[Agent(id="support", url="/agents/support/stream")],
    enabled=settings.debug,
    theme={"light": {"--agui-accent": "#2563eb"}, "dark": {"--agui-accent": "#93c5fd"}},
)
```

The `embedded` extra adds Starlette. FastAPI uses the same call because it is a Starlette application. The package
itself depends on no framework, so a host that never enables the inspector installs nothing extra. There is no
registry install yet: build the wheel from a checkout and install it with the extra, as
[Working from a source checkout](#working-from-a-source-checkout) shows.

| Argument | Meaning |
| --- | --- |
| `agents` | The agents the page lists. `Agent` needs `id` and `url`; `name`, `capabilities` and `preset` are optional and have the same meaning as in [configuration](configuration.md). Ids must be unique. |
| `enabled` | Defaults to `False`. A disabled call returns before it imports Starlette, registers a route or logs anything. |
| `path` | Where the page lives, default `/agui-inspector`. It must start with `/` and name a sub-path; a trailing `/` is ignored. |
| `theme` | Optional `{"light": {...}, "dark": {...}}`, either map optional, from the ten public `--agui-*` names to CSS values. It is written into `config.json` as given. See [Theming the embedded page](#theming-the-embedded-page). |

## Theming the embedded page

`theme` restyles the page for your application's brand: an accent, a radius, the fonts. The helper
does not look inside it. The page validates the map when it loads `config.json`, applies the part
for the current light or dark mode, and shows a visible "Configuration" warning for every name or
value it rejects. A rejected entry never stops the page or the agents from loading. A misspelled
property name, for example, gives a warning in the page and no change in appearance. The rules for
names and values, and what the page does with each kind of problem, are in
[configuration](configuration.md#theme); the properties are in [theming](theming.md).

Passing `theme` changes nothing else: the same routes, the same content security policy header, and
no extra request from the page. A host that serves the assets itself puts the same `theme` field in
its own `config.json`.

## Debug guard

Tie `enabled` to something that is off in production, such as `settings.debug`. The inspector is a
developer tool: it shows request bodies, raw frames and the host's agent list to anyone who can
reach the route. When it is enabled, the helper logs one warning through the `agui_inspector`
logger, for example `agui-inspector is enabled and mounted at /agui-inspector; disable it outside
development`. A warning that appears in a production log means the guard is wrong.

## Routes

With the default path the helper adds:

| Route | Response |
| --- | --- |
| `GET /agui-inspector` | A 307 redirect to `/agui-inspector/`, keeping the query string, so the page's relative script URL resolves. The `Location` includes the ASGI `root_path`, which holds the prefix of every enclosing mount: under `outer.mount("/api", app)` it is `/api/agui-inspector/`. |
| `GET /agui-inspector/` | The inspector page. |
| `GET /agui-inspector/config.json` | The version-0 configuration built from `agents` and `theme`: `{"version": 0, "agents": [...], "theme": {...}}`. Fields left as `None` are omitted, and so is `theme` when you pass none. The page reads it from beside itself, so a custom `path` works the same way. |
| `GET /agui-inspector/<file>` | A packaged asset, including nested ones. Anything else is a 404. |

Other methods are rejected. There are no session endpoints, no storage and no proxy for the agent:
the page talks to your agent URL directly, and a captured session never reaches the server.

Every response carries `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri
'none'`, the same policy as the page's own `<meta>` element. Scripts load from the page's origin
only and `eval` is not allowed. The helper reads assets through `importlib.resources`, rejects `..`
segments and backslashes, and serves only files under the packaged `static` directory.

## Authentication

The helper adds none. The inspector, its configuration and its assets sit behind whatever already
guards the rest of the application, and the page sends its requests to relative agent URLs on the
same origin, so the browser attaches the same credentials it already holds for your site. Configuration
never holds credentials: `Agent` has no field for them.

The page, `config.json`, the assets and the slash redirect all inherit these guards:

- Middleware on the application you pass to `mount_inspector`, or on any application that mounts it.
- A reverse proxy or gateway in front of the inspector path.
- On FastAPI, the application-level dependencies of the application you pass:
  `FastAPI(dependencies=[Depends(require_login)])`. On a FastAPI application the helper registers API
  routes, so those dependencies run for all four routes. The routes stay out of the OpenAPI schema.

One setup is not covered: a dependency on an application that mounts yours. FastAPI does not run an
enclosing application's dependencies for a mounted sub-application, so with
`outer = FastAPI(dependencies=[...])` and `outer.mount("/api", app)` the inspector in `app` is served
without that dependency running. Put the dependency on `app` itself, or guard with middleware on
`outer` or with the proxy. A plain Starlette application has no dependency system, so it needs
middleware or the proxy.

What the guard has to accept: a browser opens the inspector page with a plain navigation. That carries cookies and
cached HTTP Basic credentials, but it cannot carry a custom header. A guard that accepts only
`Authorization: Bearer <token>` therefore blocks the page itself, and typing a token into the page cannot help because
the page has not loaded. Guard the inspector paths with a session cookie, HTTP Basic or a proxy that adds the credential.
The agent routes behind that guard can still ask for a bearer token. The page's Authentication control sends one
header with each agent request: keep the header name `Authorization` and type the complete value, `Bearer <token>`, in
the Token field. See [the token](conversation.md#the-token).

`examples/fastapi/app.py` is a model-free host with HTTP Basic authentication on every route, checked in
middleware. It reads `EXAMPLE_USER` and `EXAMPLE_PASSWORD` from the environment, mounts the inspector
only when `EXAMPLE_DEBUG=1`, and streams one scripted run from `POST /agents/demo/stream`:

```sh
npm run package:python
EXAMPLE_USER=dev EXAMPLE_PASSWORD=choose-a-password EXAMPLE_DEBUG=1 \
  uv run --project packages/python --locked --extra embedded --group test \
  python examples/fastapi/app.py --port 8000
```

Open <http://127.0.0.1:8000/agui-inspector/>. The browser asks for that user and password, then the page lists Demo
agent. If port 8000 is taken, pass another `--port`.

## Serving the assets from another server

Any server that can serve static files can host the same inspector. `staticAssetsPath`, exported by
the npm package (`packages/inspector/src/static-path.js`), is the directory to serve. Put a
`config.json` next to its `index.html` and open the page. The npm package ships no CLI and no server
helper.

## Working from a source checkout

Nothing is on PyPI, so a checkout is how you run the package today. You need git, Node 24 or newer with npm, and
[uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/dogganidhal/agui-inspector.git
cd agui-inspector
npm ci --ignore-scripts
npm run package:python
```

The static files are not committed. A fresh checkout has no `src/agui_inspector/static` directory, and
`mount_inspector(enabled=True)` then raises an error that points at `npm run package:python`. That command builds the
assets, copies them into the package, writes `static.sha256` and runs `uv build`, which leaves a wheel and an sdist in
`packages/python/dist`. See [build provenance](build-provenance.md) for what it checks.

To see the page working, start the model-free example from [Authentication](#authentication). To use the package in
your own project, install the wheel with the extra. The file name carries the version:

```sh
pip install "/path/to/agui-inspector/packages/python/dist/agui_inspector-0.0.0-py3-none-any.whl[embedded]"
```

## Tests

| What | Command |
| --- | --- |
| Package, wheel and sdist | `npm run package:python` |
| Python tests | `uv sync --project packages/python --locked --extra embedded --group test`, then `uv run --project packages/python python -m unittest discover -s packages/python/tests` |
| Browser tests against the FastAPI example | `npm run test:e2e -- tests/e2e/python` |

`packages/python/.python-version` pins Python 3.10, the minimum, so CI and the default local run
exercise it. Run another version with `uv run --python 3.14 ...`; use a separate
`UV_PROJECT_ENVIRONMENT` so the two environments do not replace each other. The tests in
`test_distribution.py` and the browser tests need a built `packages/inspector/dist` and Node, and they fail
(they are not skipped) when either is missing.
