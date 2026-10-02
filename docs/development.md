# Development

`agui-inspector` is a working name. Nothing here publishes, tags or releases anything.

## Prerequisites

- Node 24 LTS or newer and npm. The scaffold was checked on Node 26.9.0 and npm 12.1.0 (slice F02 adds Node 24 to CI).
- A working tree with `npm ci --ignore-scripts`. Never run installs with lifecycle scripts enabled.
  esbuild and TypeScript ship their binaries as optional platform packages, so they work without scripts.

## Commands

Run from the repository root.

| Command | What it does |
| --- | --- |
| `npm ci --ignore-scripts` | Installs exactly what `package-lock.json` locks. |
| `npm run typecheck` | Strict type check of the repository tooling and of `packages/inspector` (sources and tests). |
| `npm run test:unit` | Compiles `*.test.ts(x)` with esbuild into `.build/tests`, then runs them with `node --test`. |
| `npm run test:unit -- packages/inspector/tests/foundation` | Same, limited to the given files or directories. No tests found is a failure. |
| `npm run build` | Writes `packages/inspector/dist` (`index.html` and `app.js`). `-- --outdir <dir>` builds elsewhere. |
| `npm run test:e2e` | Runs Playwright against `tests/e2e`. |

Playwright needs a browser: `npx playwright install chromium`. That is an explicit download, not part
of `npm ci`. There are no end-to-end tests yet, so `npm run test:e2e` currently fails with "No tests
found". That is correct: a missing suite must not count as passing.

## Reference agent

`node examples/reference-agent/server.ts --port 0 --allow-origin http://127.0.0.1:4173` starts a
model-free fixture server on 127.0.0.1 only and prints `{"url": ...}`. `POST /agent` streams one
deterministic run. It grants CORS to the single allowed origin, never sets credentials headers and
never echoes request headers. It needs no network and no model. Node strips the TypeScript types
itself, so the file uses only erasable syntax.

## npm static assets

`packages/inspector/src/static-path.js` exports `staticAssetsPath`, the absolute path of `dist`.
Another server can serve that directory next to a configuration file. The package ships no CLI and
no server helper.

## What exists and what is still missing

This is the F01 scaffold. The views render "Not implemented" and every control is disabled.

| Check | Status |
| --- | --- |
| Typecheck, foundation unit tests, build | Present. |
| CI workflow | Missing (slice F02). Not counted as passing. |
| Bundle-budget check (2 MB minified, 600 KB gzipped) | Missing (slice F03). |
| 5,000-frame benchmark fixture and measurement | Missing (slice F03, then L04). |
| End-to-end tests and network-allowlist checks | Missing; only the configuration exists. |
| Python package and tests | Missing (slice L06). |

The foundation tests prove that the pinned baseline works together: the 31 event types, the fetch
hook, sequence-error reporting while the recording branch keeps draining, resume and cancel entries,
the render tool, and the A2UI v0.9 processor and action shape. Rendering a surface in a real DOM is
not covered here: `A2uiSurface` does not support server rendering, and no DOM library is installed.
The A2UI slice covers it with Playwright.
