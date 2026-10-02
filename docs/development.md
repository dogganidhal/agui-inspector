# Development

`agui-inspector` is a working name. Nothing here publishes, tags or releases anything.

## Prerequisites

- Node 24 LTS or newer and npm. The scaffold was checked on Node 26.9.0 and npm 12.1.0; CI runs Node 24.
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
| `npm run check:ci` | Runs the pull request gate locally (see below). |
| `npm run check:ci -- --strict` | The same gate, but suites that are not introduced yet fail it. |

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

## Pull request checks

`.github/workflows/ci.yml` runs on `pull_request` only, with read-only repository access. It installs
with `npm ci --ignore-scripts`, then runs `npm run check:ci`, the same command you run locally. It
never publishes, tags or releases anything, and it uses no secrets. Every action is pinned to a full
commit SHA; bump a pin only after reading the new release.

`scripts/ci.mjs` runs these steps in order and stops at the first failure, which fails the gate:

| Step | Command | Runs when |
| --- | --- | --- |
| typecheck | `npm run typecheck` | Always. |
| unit tests | `npm run test:unit` | Always. |
| build | `npm run build` | Always. |
| bundle budget | `npm run check:bundle` | `scripts/bundle-budget.mjs` exists (slice F03). |
| end-to-end tests | `npm run test:e2e` | `tests/e2e` holds at least one `*.spec.ts`. |
| python tests | `uv sync --project packages/python --locked --extra embedded --group test`, then `uv run --project packages/python python -m unittest discover -s packages/python/tests` | `packages/python/pyproject.toml` exists. |

A suite that is not introduced yet is printed as `PENDING` with the reason. It has no command, so
it cannot report success, and the summary says that pending suites do not count as passing. Once a
suite exists the gate requires it: a Python package without a `test_*.py` file fails instead of
passing on an empty run, and a missing `check:bundle` script fails the budget step. The workflow
installs Chromium only when an end-to-end spec exists and installs `uv` only when the Python package
exists; both are explicit downloads, not install hooks.

## Integrated-MVP gate

The 0.1.0 MVP is accepted only when every suite above is introduced and passes together on the
integrated main branch. Run `npm run check:ci -- --strict` there: it behaves like the default gate
but exits non-zero while any suite is pending, so an absent bundle-budget check, an absent
end-to-end suite or an absent Python package blocks the release instead of being skipped. The
5,000-frame responsiveness check is not part of this gate. It needs the physical runner described in
the benchmark profile (slices F03 and L04), and the portable CI run cannot certify it. Publishing is
a separate, blocked step; see `docs/distribution.md`.

## What exists and what is still missing

This is the F01 scaffold plus the F02 gate. The views render "Not implemented" and every control is
disabled.

| Check | Status |
| --- | --- |
| Typecheck, foundation unit tests, build | Present. |
| CI workflow and `npm run check:ci` | Present (slice F02). Reports the suites below as pending. |
| Bundle-budget check (2 MB minified, 600 KB gzipped) | Missing (slice F03). |
| 5,000-frame benchmark fixture and measurement | Missing (slice F03, then L04). |
| End-to-end tests and network-allowlist checks | Missing; only the configuration exists. |
| Python package and tests | Missing (slice L06). |

The foundation tests prove that the pinned baseline works together: the 31 event types, the fetch
hook, sequence-error reporting while the recording branch keeps draining, resume and cancel entries,
the render tool, and the A2UI v0.9 processor and action shape. Rendering a surface in a real DOM is
not covered here: `A2uiSurface` does not support server rendering, and no DOM library is installed.
The A2UI slice covers it with Playwright.
