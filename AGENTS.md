# AGENTS.md

Instructions for coding agents working in this repository. Humans should start with [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

agui-inspector is a developer tool for AG-UI servers. It records every request and SSE frame as received, validates them
against the protocol, drives runs like a client (interrupts, client tools, A2UI v0.8 and v0.9 surfaces) and sends raw requests no
client would. One static bundle serves every mode: a hosted page, a Python helper for Starlette and FastAPI, helpers
for Express, Hono and Next.js, and npm static assets. A public demo runs on GitHub Pages. Both packages are on their
registries at 0.1.0: the Python package on PyPI and the npm package on npm.

## Development workflow

Spec Kit drives all development in this repository. The [constitution](.specify/memory/constitution.md) requires it:
implementation work must trace to a reviewed specification, and a plan must pass the constitution check before any code
is written. Do not start by editing code.

The skills are named `speckit-*`. They live in `.claude/skills` and `.github/skills`. In Claude Code you run them as
`/speckit-specify` and so on.

1. Look in `specs/` for a feature that already covers the work. A bug fix, an extension or a refactor of an existing
   feature belongs to that feature. Update its `spec.md`, `plan.md` and `tasks.md`. Start a new feature only when none
   fits.
2. `speckit-specify` creates `specs/NNN-name/spec.md` from a description. Write what users need and why. Leave the
   technology and the code out of the spec.
3. `speckit-clarify` asks short questions about gaps and writes the answers back into the spec. Settle every open
   question before you plan.
4. `speckit-plan` writes `plan.md` and the design files (research, data model, contracts, quickstart). Its constitution
   check must pass. If a principle blocks the work, do not work around it. The constitution changes only through
   `speckit-constitution`, and only with the maintainer's approval.
5. `speckit-tasks` writes `tasks.md`: small tasks in dependency order, with the files each one touches. Tasks cover the
   behavior, its tests and the docs that describe it.
6. `speckit-analyze` checks the spec, plan and tasks against each other and against the constitution. It changes no
   files. Fix every critical finding before you implement.
7. `speckit-implement` works through `tasks.md`. Then run `npm run check:ci`. If the code and the spec still disagree,
   run `speckit-converge` so the missing work is written down in `tasks.md` instead of being left out.

Show the maintainer the spec and the plan, and wait for approval before you implement. The repository's own workflow
(`.specify/workflows/speckit/workflow.yml`) has the same two review gates.

Keep the record in the spec directory, not in chat: decisions, clarifications and scope changes go into the feature's
files. The pull request links that directory. Update `ROADMAP.md` when release scope or status changes.

Typo, wording and formatting fixes, and the version pull request that Changesets opens, change no behavior and need no
spec. Everything else does, including small bug fixes.

## Where things are

| Path | Contents |
| --- | --- |
| `packages/inspector/src/core` | Framework-free TypeScript: recorder, frame reader, session store, config, presets, profiles, runtime and transport, A2UI lifecycle. No React here. |
| `packages/inspector/src/server` | Node-side code for the Express, Hono and Next.js helpers, one core and thin adapters. Compiled to `packages/inspector/lib` by `npm run build`, never in the browser bundle. No React, no framework import. |
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
| `website` | The docs site (Next.js static export with Fumadocs, its own lockfile, not a workspace). Pages are MDX in `website/content/docs`; several tests read them. `docs/` keeps only the frozen product brief and the README screenshots. |
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
- Dependencies: exact versions, committed lockfile, and a row in `website/content/docs/dependencies.mdx` with the purpose and the
  alternative that falls short (a test enforces it). Prefer the platform or an existing dependency.
- Behavior changes need a regression test. End-to-end tests run against `examples/reference-agent`, never a model or an
  outside service.
- Stay inside the scope in `ROADMAP.md` and the accepted spec under `specs/`. See the development workflow above.

## Things tests check that are easy to miss

- `website/content/docs/development.mdx` must mention every root `npm run` script. Add a script, document it.
- `website/content/docs/event-views.mdx` maps each event type, and `website/content/docs/runs.mdx` covers each control.
- The helper code in `packages/inspector/src/server` ships as compiled `lib/` and never enters the page bundle. Its
  `exports` entries must exist after `npm run build` (the build checks), and a test reads the page bundle for it.
- The brand mark exists in four copies (`branding/mark.svg`, `branding/icon.svg`, `icons.mark` in
  `views/theme/primitives.tsx`, and the favicon data URI in both `index.html` files). Change all or none. Repo assets stay
  black and white; adopters recolor through `--agui-accent`.
- Workflows pin every action to a full commit SHA. `ci.yml` only checks, `pages.yml` only deploys the demo and the docs site, and
  `release.yml` is the only publisher, to PyPI and npm; tests fail if triggers or permissions widen.
- Python and npm package versions move only through Changesets, each package on its own. A change to what the wheel or
  the npm package does or ships adds a changeset (`npx changeset`): `agui-inspector-python` for the wheel,
  `agui-inspector` for the npm package, and both for an inspector change. Never edit versions by hand.

## Style

- Strict TypeScript with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`. Match the code around you: small modules,
  plain functions, few comments that explain why.
- Docs are plain and specific: short sentences, no marketing, no em dashes. Update them in the same change as the code.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `chore:`). Pull requests fill
  in `.github/PULL_REQUEST_TEMPLATE.md`.
- Never publish, tag or release, and never change repository settings. Those belong to the maintainer.
