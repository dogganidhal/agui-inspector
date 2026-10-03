# Embedding in Starlette and FastAPI

`agui-inspector` is the approved package name and the project is MIT licensed. The Python package is private
and unpublished until the first release (see [distribution](distribution.md#python-release)). The package ships the prebuilt
inspector files and one helper, `mount_inspector`, that serves
them from an existing Starlette or FastAPI application. The host needs no Node toolchain, and
the helper downloads nothing at startup.

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

Install with the `embedded` extra, which adds Starlette (`pip install "agui-inspector[embedded]"`).
FastAPI uses the same call because it is a Starlette application. The package itself depends on no
framework, so a host that never enables the inspector installs nothing extra.

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
| `GET /agui-inspector` | A 307 redirect to `/agui-inspector/`, keeping the query string, so the page's relative script URL resolves. |
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

The helper adds none. The inspector, its configuration and its assets sit behind whatever
middleware, dependency or reverse proxy already guards the rest of the application, and the page
sends its requests to relative agent URLs on the same origin, so the browser attaches the same
credentials it already holds for your site. Configuration never holds credentials: `Agent` has no
field for them.

`examples/fastapi/app.py` is a model-free host with HTTP Basic authentication on every route. It
reads `EXAMPLE_USER` and `EXAMPLE_PASSWORD` from the environment, mounts the inspector only when
`EXAMPLE_DEBUG=1`, and streams one scripted run from `POST /agents/demo/stream`:

```sh
npm run build && npm run package:python
EXAMPLE_USER=dev EXAMPLE_PASSWORD=... EXAMPLE_DEBUG=1 \
  uv run --project packages/python --locked --extra embedded --group test \
  python examples/fastapi/app.py --port 8000
```

## Serving the assets from another server

Any server that can serve static files can host the same inspector. `staticAssetsPath`, exported by
the npm package (`packages/inspector/src/static-path.js`), is the directory to serve. Put a
`config.json` next to its `index.html` and open the page. The npm package ships no CLI and no server
helper.

## Working from a source checkout

The static files are not committed. A fresh checkout has no `src/agui_inspector/static` directory,
and `mount_inspector(enabled=True)` then raises an error that points at `npm run package:python`.
That command builds the assets, copies them into the package, writes `static.sha256` and runs
`uv build`. See [build provenance](build-provenance.md) for what it checks.

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
