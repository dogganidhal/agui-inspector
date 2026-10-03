# AGENTS.md

Instructions for coding agents working in this repository. Humans should start with [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

agui-inspector is a developer tool for AG-UI servers. It records every request and SSE frame as received, validates them
against the protocol, drives runs like a client (interrupts, client tools, A2UI v0.9 surfaces) and sends raw requests no
client would. One static bundle serves every mode: a hosted page, a Python helper for Starlette and FastAPI, and npm
static assets. A public demo runs on GitHub Pages. Nothing is published to npm or PyPI yet.

## Where things are

| Path | Contents |
| --- | --- |
| `packages/inspector/src/core` | Framework-free TypeScript: recorder, frame reader, session store, config, presets, profiles, runtime and transport, A2UI lifecycle. No React here. |
| `packages/inspector/src/views` | React views: connection, conversation, inspection, A2UI, settings, and the theme tokens and primitives. |
| `packages/inspector/src/app` | Page entry, startup and the content security policy (`security.ts`). |
| `packages/inspector/src/contracts.ts` | Shared types. Must not import React. |
| `packages/inspector/tests` | Unit tests (`*.test.ts(x)`), grouped by area. |
| `packages/python` | `agui_inspector.mount_inspector`, its tests and `uv.lock`. The static files are staged at build time, never committed. |
| `demo` | Public demo bootstrap and service worker. Kept out of the npm package and the wheel. |
| `examples/reference-agent` | Scripted, model-free AG-UI server and scenarios shared by tests and the demo. Erasable TypeScript only; Node runs it directly. |
| `examples/fastapi` | Embedded example host. |
| `tests/e2e` | Playwright specs. `tests/demo`, `tests/ci`, `tests/release` and `tests/benchmarks` hold unit tests for those areas. |
| `scripts` | Build, test runner, bundle budget, CI gate, Python packaging, changeset versioning. |
| `docs` | User and developer documentation. Several tests read these files. |
| `specs`, `.specify` | Spec Kit feature specs, plans and tasks, and the constitution at `.specify/memory/constitution.md`. |
| `branding` | The mark, the icon and the social preview. |

## Commands

Run from the repository root. Node 24 or newer; uv for Python.

```sh
npm ci --ignore-scripts                                   # install; never run lifecycle scripts
npm run typecheck                                         # strict tsc over tooling and packages/inspector
npm run test:unit                                         # esbuild-compiled node --test over packages/ and tests/
npm run test:unit -- packages/inspector/tests/frames      # limit to paths; no tests found is a failure
npm run build                                             # packages/inspector/dist
npm run check:bundle                                      # after build: 2,000,000 B minified, 600,000 B gzip
npm run test:e2e -- tests/e2e/inspection                  # Playwright, Chromium (npx playwright install chromium)
npm run package:python                                    # build, stage assets, uv build into packages/python/dist
npm run check:ci                                          # the full pull request gate; run before finishing
```

Python tests: `uv sync --project packages/python --locked --extra embedded --group test`, then
`uv run --project packages/python python -m unittest discover -s packages/python/tests`. They need a built
`packages/inspector/dist`.

## Rules

These come from the [constitution](.specify/memory/constitution.md). Read it before changing behavior.

- Keep the wire intact. Frames keep their raw bytes, arrival order and timing, including non-JSON and invalid frames.
  Never drop, repair or reorder them, and never touch the protocol client's own stream.
- Use `@ag-ui/core` and `@ag-ui/client` for protocol behavior, and `@a2ui/react` and `@a2ui/web_core` for A2UI. No chat
  framework between the wire and the views.
- Keep `src/core` and `contracts.ts` free of React. No `eval` or `new Function` anywhere under `src`; a test checks it.
- No server-specific routes or conventions in core. Application behavior goes through configuration and presets.
- No telemetry, analytics or third-party requests. Credentials stay in memory and never reach storage, configuration,
  recordings, views, logs or exports. The recorder never reads headers.
- Every one of the 31 baseline event types keeps a frames-list view and a fixture test. Changing protocol support
  updates views, fixtures and docs together.
- Dependencies: exact versions, committed lockfile, and a row in `docs/dependencies.md` with the purpose and the
  alternative that falls short (a test enforces it). Prefer the platform or an existing dependency.
- Behavior changes need a regression test. End-to-end tests run against `examples/reference-agent`, never a model or an
  outside service.
- Stay inside the scope in `ROADMAP.md` and the accepted spec under `specs/`. New capabilities go through Spec Kit
  (`.claude/skills/speckit-*`) first.

## Things tests check that are easy to miss

- `docs/development.md` must mention every root `npm run` script. Add a script, document it.
- `docs/event-views.md` maps each event type, and `docs/conversation.md` covers each control.
- The brand mark exists in four copies (`branding/mark.svg`, `branding/icon.svg`, `icons.mark` in
  `views/theme/primitives.tsx`, and the favicon data URI in both `index.html` files). Change all or none. Repo assets stay
  black and white; adopters recolor through `--agui-accent`.
- Workflows pin every action to a full commit SHA. `ci.yml` only checks, `pages.yml` only deploys the demo, and
  `release-python.yml` is the only publisher; tests fail if triggers or permissions widen.
- Python package versions move only through Changesets. A change to what the wheel does or ships adds a changeset
  (`npx changeset`, package `agui-inspector-python`). Never edit versions by hand.

## Style

- Strict TypeScript with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`. Match the code around you: small modules,
  plain functions, few comments that explain why.
- Docs are plain and specific: short sentences, no marketing, no em dashes. Update them in the same change as the code.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`). Pull requests fill
  in `.github/PULL_REQUEST_TEMPLATE.md`.
- Never publish, tag or release, and never change repository settings. Those belong to the maintainer.
