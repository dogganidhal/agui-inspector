# Tasks: JavaScript server helpers

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[public contract](contracts/public-api.md), [internal contract](contracts/internal-core.md),
[validation guide](quickstart.md).

**Format**: `- [ ] Txxx [P] [USn] description with file path`. `[P]` means the task touches files no other open task
touches and has no unfinished prerequisite. `[USn]` maps to a user story of the spec.

Tests are required (constitution: behavior changes need regression tests). Each test task comes before the code it
covers. Tests that need the page use a stand-in directory (`assetsDir`), so they run before the build. Browser tests run
against `examples/reference-agent` scenarios, never a model or an outside service.

Rules for every task: do not edit `ROADMAP.md` or another feature's spec directory, add no runtime dependency, write no
publish, tag or release step, and keep docs in short plain sentences with no em dashes.

## Phase 1: Setup

- [X] T001 Add the three development dependencies with exact pins to the root `package.json` (`express` `5.2.1`,
  `@types/express` `5.0.6`, `hono` `4.13.13`) and refresh `package-lock.json` with
  `npm install --ignore-scripts` (public registry only). Add one row each to `website/content/docs/dependencies.mdx`
  under development dependencies (purpose and the alternative that falls short, see research 10). The exact-version
  policy test stays as it is. Do not touch `THIRD_PARTY_NOTICES.txt` (development packages are not listed).
- [X] T002 [P] Create `packages/inspector/tsconfig.server.json` that extends `./tsconfig.json` with `noEmit` false,
  `outDir` `lib`, `rootDir` `src`, `declaration`, `stripInternal`, `rewriteRelativeImportExtensions`, and `include`
  `src/server/**/*` and `src/static-path.js`. Add `packages/inspector/lib/` to `.gitignore`. Add `"lib"` to `files` in
  `packages/inspector/package.json`. Leave `exports` alone: each helper task adds its own entry.
- [X] T003 [P] Change `packages/inspector/src/static-path.js` to
  `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')`, with a one-line comment that a bundler
  reads `new URL('<literal>', import.meta.url)` as an asset import (research 5). Update
  `packages/inspector/tests/foundation/static-path.test.ts`: keep the value test, and replace the "only the static path"
  test with one that checks `exports['.']` is still `./src/static-path.js` and the package has no `bin`.
- [X] T004 Add `buildServer()` to `scripts/build.mjs`: remove `packages/inspector/lib`, run
  `npm exec -- tsc -p packages/inspector/tsconfig.server.json`, then throw if any `exports` target of
  `packages/inspector/package.json` that points into `lib` does not exist. Call it from the command-line branch after
  `buildApp`, and say so in the file's header comment. `buildApp` itself and the `--outdir` option stay as they are.
  Depends on T002.

**Checkpoint**: `npm run typecheck` and the foundation tests pass. Nothing is served yet.

## Phase 2: Foundation (blocks every story)

The core, the bridge and the proof that the page bundle stays clean.

- [X] T005 [P] Write `packages/inspector/tests/server/core.test.ts` for the core. Build a temporary directory in a
  `before` hook with `index.html`, `hosting-config.json`, `app.js`, `assets/chunk.js` and a `secret.txt` outside it. Cover
  `createInspectorHandler` and `resolveMount` from the data model: the page at `''` with a path ending in `/`; the 307
  relative redirect for a bare path (`agui-inspector/index.html`, query kept, under `/api/agui-inspector` too);
  `config.json` for agents with all fields, only `id` and `url`, with and without `theme`, equal in parsed value to the
  fixtures of `packages/python/tests/test_embedding.py` (`test_config_is_version_zero_and_carries_only_declared_fields`
  and the theme tests) and with the key order `version`, `agents`, `theme`; a nested file; 404 for a missing file and for
  a directory; traversal (`..`, `.`, empty segment, `\`, null character, `a/../../secret.txt`) as 404; 405 with
  `Allow: GET, HEAD` for `POST`; `HEAD` with `Content-Length` and no body; content types for `html`, `js`, `css`,
  `json` and an unknown extension; the policy header on every one of these responses; `createInspectorHandler` throwing
  `the packaged inspector files are missing` for a directory without `index.html`; and `resolveMount`: `null` and no read
  for `enabled` of `false`, left out, `'false'` and `1`; the three messages of the public contract for a `path` without
  `/`, `path` of `/` or `//`, an empty or duplicate `id` and a missing `url`; trailing `/` dropped from `path`; check order
  (`path`, then `agents`, then the page); a disabled call with an invalid `path` does not throw.
- [X] T006 Implement `packages/inspector/src/server/core.ts` to make T005 pass, as written in
  [contracts/internal-core.md](contracts/internal-core.md) and the response rules of [data-model.md](data-model.md):
  `DEFAULT_PATH`, the option and agent types, `createInspectorHandler`, `resolveMount` and `warnMounted` (one
  `console.warn` of `agui-inspector is enabled and mounted at <mount>; disable it outside development`). The policy is
  `script-src 'self'; object-src 'none'; base-uri 'none'`. Import `staticAssetsPath` from `../static-path.js`. Build
  `config.json` once with `JSON.stringify({ version: 0, agents, theme })`. Reject an unsafe asset by segment and by
  checking that the resolved path lies inside the directory. Map `ENOENT`, `EISDIR` and `ENOTDIR` to 404 and rethrow
  other errors. Keep it to about 100 lines. Depends on T003, T005.
- [X] T007 [P] Write `packages/inspector/tests/server/node.test.ts` and implement `packages/inspector/src/server/node.ts`
  (`toRequest`, `sendResponse`, see the internal contract). Tests run a real `http.createServer` on port 0 and use
  `fetch`: `toRequest` carries the method and the path and query, prefers `originalUrl`, and ignores headers (a header
  that `Request` rejects does not throw) and body; `sendResponse` writes the status, every header and the whole body
  once, sends `Content-Length`, and sends no body for `HEAD`.
- [X] T008 [P] Write `packages/inspector/tests/server/bundle.test.ts`: call `buildApp` from `scripts/build.mjs` into a
  temporary directory and check from its metafile that no input lies under `packages/inspector/src/server`, that the
  output has no `is enabled and mounted at` text and no `node:http` or `node:fs` import, and that no file under
  `packages/inspector/src/server` imports React. This holds the FR-015 line.

**Checkpoint**: `npm run test:unit -- packages/inspector/tests/server` passes for the core, the bridge and the bundle.

## Phase 3: User Story 1 - Express (Priority: P1) MVP

**Goal**: one call in an Express application serves the inspector at `/agui-inspector`.

**Independent test**: Express 5 over a real `http` server in the unit tests, and the real page in Chromium.

- [X] T009 [US1] Write `packages/inspector/tests/server/express.test.ts` first, against Express 5 (`express`). Over a
  real server on port 0 check:
  the page after the redirect, `config.json` and a nested asset at `/agui-inspector`; the redirect target and that the
  query survives; a custom `path` (`/tools/inspect`, trailing `/` dropped) with `/agui-inspector` giving the host's own
  404; the helper on an Express `Router` that the application mounts at `/api`; a malformed `%` escape and
  `..%2f` as 404; `POST` as 405 with `Allow`; `HEAD`; and that `mountInspector` accepts a real `express()` and
  `express.Router()` under the repository's strict type check. Pass `assetsDir` from the stand-in directory of T005.
- [X] T010 [US1] Implement `packages/inspector/src/server/express.ts` (`mountInspector`, the structural `ExpressLike`,
  exported types) as in [contracts/public-api.md](contracts/public-api.md): `resolveMount`, then
  `app.use(<mount>, handler)` where the handler builds the asset from `req.url` (split, `decodeURIComponent` per
  segment, a failed decode is `..`), builds the request with `toRequest`, calls the core and `sendResponse`, passes errors
  to `next`, and finally `warnMounted(mount)`. Add the `./express` entry (`types` `./lib/server/express.d.ts`,
  `default` `./lib/server/express.js`) to `exports` in `packages/inspector/package.json`. Depends on T006, T007, T009.
- [X] T011 [US1] Add the browser host and spec. In `tests/e2e/js-helpers/hosts.ts` write `startExpressHost()`: an
  Express application on a free port with the reference agent's run route (reuse `referenceRunResponse` from
  `examples/reference-agent/scenarios.ts`) on the same origin and the helper imported from the source,
  `../../../packages/inspector/src/server/express.ts`, because `npm run typecheck` runs before the build and a
  `agui-inspector/express` import has no declarations yet (the built `lib` is covered by T022). The page comes from
  the real `packages/inspector/dist`. In `tests/e2e/js-helpers/embedding.spec.ts` open `/agui-inspector`, check the final URL ends in
  `/agui-inspector/index.html`, that the agent is listed, that a run records its frames, that `config.json` is served
  with the policy header, and that every request the page makes goes to the host's own origin (copy the allowlist
  check from `tests/e2e/python/embedding.spec.ts`). Depends on T010 and `npm run build`.

**Checkpoint**: `npm run test:unit -- packages/inspector/tests/server/express.test.ts` and
`npm run test:e2e -- tests/e2e/js-helpers/embedding.spec.ts --workers=2` pass. Story 1 stands alone.

## Phase 4: User Story 2 - Hono (Priority: P1)

**Goal**: one call in a Hono application, with or without a base path.

**Independent test**: `app.request` in the unit tests, the real page in Chromium behind a `node:http` bridge.

- [X] T012 [P] [US2] Write `packages/inspector/tests/server/hono.test.ts` with Hono's `app.request`: the page after
  the redirect, `config.json` and a nested asset; the slash form `/agui-inspector/` (for `strict: true` and `strict:
  false`), which Hono's own 404 must not answer; the redirect under `new Hono().basePath('/api')` and under
  `app.route('/api', sub)`; a custom `path`; an encoded traversal such as `..%2f..%2fsecret.txt` (404 with the policy header); `POST` as 405 with `Allow`; `HEAD`; and that
  `mountInspector` accepts a real `Hono` and a `Hono` with `basePath` under strict type checking.
- [X] T013 [US2] Implement `packages/inspector/src/server/hono.ts` (`mountInspector`, the structural `HonoLike`, exported
  types): `resolveMount`, `app.all(mount, ...)` and `app.all(`${mount}/:asset{.*}`, ...)` passing `c.req.raw` and
  the decoded parameter, then `warnMounted(mount)`. Add the `./hono` entry to `exports`. Depends on T006, T012.
- [X] T014 [US2] Extend `tests/e2e/js-helpers/hosts.ts` with `startHonoHost({ basePath })` (a `Hono` application behind
  a `node:http` server built from `toRequest` and `sendResponse`, serving the reference agent run route, with the helper
  imported from `../../../packages/inspector/src/server/hono.ts` as in T011) and add the
  Hono cases to `tests/e2e/js-helpers/embedding.spec.ts`: the page lists the agent and records a run at
  `/agui-inspector` and at `/api/agui-inspector`. Depends on T013 and T011.

**Checkpoint**: Hono tests pass. Stories 1 and 2 work together and apart.

## Phase 5: User Story 3 - Next.js (Priority: P1)

**Goal**: one route file in a Next.js application with its default configuration.

**Independent test**: the handlers called directly with web-standard requests, and a browser run against a host that
behaves like Next.js's router.

- [X] T015 [P] [US3] Write `packages/inspector/tests/server/next.test.ts` calling the handlers directly: `params` as a
  promise and as a plain object, with `path` undefined, empty and nested (`['assets', 'chunk.js']`); the bare path
  redirect; `GET` and `HEAD`; `config.json`; the policy header on every response; `inspectorRoute` throwing at call
  time for a missing page or bad agents when enabled; and that the exported handlers satisfy the shape Next.js
  expects, `export const { GET, HEAD } = inspectorRoute(...)`.
- [X] T016 [US3] Implement `packages/inspector/src/server/next.ts` (`inspectorRoute`, `InspectorRouteOptions`,
  the route context type) as in the public contract: no `path` argument; `enabled` not `true` gives `GET` and `HEAD`
  answering `404` with no read and no log; otherwise `resolveMount` with the default path (for the checks), the handler
  awaits `params`, joins `path` with `/` and calls the core. The first request logs `warnMounted` once with the mount path
  taken from the request URL by dropping the trailing empty segment and the `path` segments. Add the `./next` entry to
  `exports`. Depends on T006, T015.
- [X] T017 [US3] Extend `tests/e2e/js-helpers/hosts.ts` with `startNextHost({ basePath })`: a `node:http` server that
  behaves like the Next.js router in its default configuration for one route, `/<basePath>/agui-inspector/[[...path]]`:
  it answers a path with a trailing slash by a 308 to the same path without it (the behavior recorded in research 4),
  builds `params.path` from the segments after the route, calls the handlers of `../../../packages/inspector/src/server/next.ts`, and serves the
  reference agent run route. Add the cases to `tests/e2e/js-helpers/embedding.spec.ts`: the page loads, lists the agent
  and records a run, with no redirect loop, with and without a base path. Depends on T016 and T011.

**Checkpoint**: Next.js tests pass. All three helpers serve a real page in a browser.

## Phase 6: User Story 4 - Safe by default and guarded by the host (Priority: P1)

**Goal**: the same safety contract as the Python helper, shown on each framework.

**Independent test**: for each framework, a disabled and an enabled mount, the warning, the policy header and a host
guard in front of the routes.

- [X] T018 [P] [US4] Add to `packages/inspector/tests/server/express.test.ts`: `enabled` of `false`, left out and `'false'`
  add no route (the router's stack length, `app.router.stack`, is unchanged), log nothing, read nothing (a missing `assetsDir` does not throw)
  and give the host's 404 for the page, `config.json`, the slash form and the redirect path; `enabled: true` logs one
  `console.warn` (mocked with `node:test`) naming `/agui-inspector` and, for a custom path, that path; the policy header
  on every status the helper returns; a guard registered with `app.use` before the helper answers `401` for the page,
  `config.json`, a file and the redirect without credentials and lets the request through with them; a guard registered
  after the helper never runs (the documented ordering).
- [X] T019 [P] [US4] The same set in `packages/inspector/tests/server/hono.test.ts`: disabled adds no route
  (`app.routes` unchanged), no log, host 404; enabled logs once with the path (with `basePath`, the helper's path as
  given); a middleware registered with `app.use` before the helper guards all four routes; one registered after it does
  not run.
- [X] T020 [P] [US4] The same set in `packages/inspector/tests/server/next.test.ts`: a disabled route answers 404 with no
  inspector content, no log and no file read for every request; an enabled route logs once on the first request with
  the real path (`/agui-inspector`, `/tools/agui-inspector` for a `basePath` request, the same result for a first request
  for `config.json` and for a nested asset) and never again; the policy header on every response of the helper.
- [X] T021 [US4] Add `tests/e2e/js-helpers/guard.spec.ts` and the matching options in `tests/e2e/js-helpers/hosts.ts`:
  for each of the three hosts, started disabled, every inspector path is the host's 404 (Next.js: the route's 404);
  started enabled behind HTTP Basic authentication, a request without credentials gets `401` for the page, `config.json`,
  an asset and the redirect, and a browser with credentials loads the page and lists the agent. Depends on T011, T014,
  T017, T018, T019, T020.

**Checkpoint**: each framework passes the disabled, warning, policy and guard cases.

## Phase 7: User Story 5 - Adopt without extra installs or a heavier page (Priority: P2)

**Goal**: the package, its types and its documentation.

**Independent test**: the package tests after a build, and a read of the docs.

- [X] T022 [US5] Write `tests/e2e/js-helpers/package.spec.ts` against the built package (after `npm run build`):
  `exports` equals `.`, `./express`, `./hono` and `./next` with the `types` and `default` targets from the public
  contract, and every target exists; `dependencies` has no framework and `peerDependencies` is absent; each entry loads
  with a dynamic `import()` and with `require()` in a child `node` process, resolved through the package name; a
  TypeScript consumer (a temporary directory, `module` and `moduleResolution` `NodeNext`, `strict`) compiles the
  documented usage of each helper and fails for an agent without a `url`; `npm pack --workspace packages/inspector
  --dry-run --json` lists `lib/server/*.js`, `lib/server/*.d.ts` and `dist/*`, no `src/server` and no `tests`, and
  `lib/` has no `assetsDir` in its declarations. The TypeScript consumer lives under `.build/consumer` (ignored by git), so
  `node_modules/agui-inspector`, the workspace link, resolves through the package `exports`. A last case starts an Express
  server in a child process with `require('agui-inspector/express')` against the real `dist` and fetches the redirect,
  the page and `config.json`, so the shipped `lib` is shown to serve a page as well as to load. Depends on T010, T013, T016.
- [X] T023 [P] [US5] Rewrite the introduction and add the JavaScript sections of
  `website/content/docs/embedding.mdx` (see the plan for the structure). Keep every existing anchor of the page working,
  or update each link to it, and search `website/content/docs` and the READMEs for `embedding.mdx#`. Cover: the title and
  intro for both languages; install; one example per framework (Express, Hono, Next.js with the file path
  `app/agui-inspector/[[...path]]/route.ts`); the arguments table (no `path` for Next.js); the routes table with the
  redirect rule and why; the debug guard and the warning text, which names the path as passed to the helper (an outer `Router` or `basePath`
  prefix is not added), and that Next.js logs at the first request;
  authentication with the guard placement for each framework (Express and Hono register the guard before the helper,
  Next.js uses `middleware.ts` or `proxy.ts`); theming; CommonJS use and the Node.js 22.12 minimum; the Node.js runtime
  limit (no edge runtime); and the framework versions tested (Express 5.2, Hono 4.13, and Next.js 15.5 and
  16.3 by hand, see T027) and, for Express, that the helper is tested with Express 5 and needs only
  `app.use(path, handler)`. Say that the hosts differ from the Python page only where the table says so.
- [X] T024 [P] [US5] Fix the sentences that say the helpers are planned or missing: `website/content/docs/development.mdx`
  (the layout, that `npm run build` also writes `packages/inspector/lib`, and the "no CLI and no server helper" line),
  `website/content/docs/status.mdx` (the JS helpers row), `website/content/docs/index.mdx`, `README.md` and
  `packages/inspector/README.md`. Keep any 1.0.0 wording that issue #86 owns apart from these lines. Check
  `website/content/docs/internals.mdx` for a source tree listing and add `src/server` there if it exists.
- [X] T025 [P] [US5] Add `.changeset/js-server-helpers.md` with `'agui-inspector': minor` and a short plain note: the
  Express, Hono and Next.js helpers, the new `exports` entries, and that `staticAssetsPath` has the same value with a
  bundler-safe form. The Python package has no change, so it gets no changeset.

**Checkpoint**: `npm run test:e2e -- tests/e2e/js-helpers/package.spec.ts` passes and the docs read right.

## Phase 8: Polish and cross-cutting

- [X] T026 Run `npm run check:ci` (type check, unit tests, build, bundle budget, end-to-end tests, Python tests) and
  fix what fails. The bundle budget must be unchanged. While iterating, run only the helper specs with `--workers=2`.
- [X] T027 Run the real thing once and record it. Pack with `npm pack --workspace packages/inspector`, install the
  tarball into a scratch Next.js 15 and a Next.js 16 application with the default `next.config`, add the route file from
  the docs, and run `next dev` and `next build` then `next start` (Turbopack, and `--webpack` on 16). Check the page,
  `config.json`, a nested asset, a `basePath` run and the single warning. Repeat for a scratch Express 5 and Hono
  server. Write the versions and results into the "Verification of the built package" section that this task adds to
  `specs/006-js-server-helpers/research.md`, and keep T023's version list equal to it.
- [X] T028 If code and spec disagree, run `/speckit-converge` and write the missing work into this file. Run
  `/ponytail:ponytail-review` on the diff and fix its findings. Run the `humanizer` skill on every new docs text and on
  the pull request body.
- [X] T029 Rebase on `origin/main`, resolve conflicts (issue #86 edits the same docs pages, branding in issue #73 may add
  a field to the Python helper that these helpers must carry the same way), push with `--force-with-lease`, update the
  pull request body from `.github/PULL_REQUEST_TEMPLATE.md` through `gh api -X PATCH`, and mark it ready.

## Dependencies and order

```text
T001 ─┬─────────────────────────────────────────────┐
T002 ─┴─ T004                                        │
T003 ─────── T006 (needs T005) ─┬─ T010 (Express) ── T011 ─┬─ T014 ─┬─ T021
T005 ────────┘                  ├─ T013 (Hono)  ──────────┘        │
T007 ───────────────────────────┤  T016 (Next.js) ── T017 ─────────┘
T008 (any time after T004)      └─ tests T009 / T012 / T015 before each
T018 / T019 / T020 after T010 / T013 / T016 ── T021
T022 after T010, T013, T016;  T023 to T025 after the helpers exist
T026 to T029 last
```

Stories are independent after Phase 2: Express, Hono and Next.js do not use each other's files except the shared
`hosts.ts` and `embedding.spec.ts`, which later tasks extend in order (T011, T014, T017). Story 4 needs the three
helpers. Story 5's package test needs all three entries.

## Parallel opportunities

- Phase 1: T002 and T003 together, then T004. T001 any time.
- Phase 2: T005 with T007 and T008. T006 follows T005.
- After Phase 2: T009, T012 and T015 can be written at the same time. The three implementations (T010, T013, T016) touch
  different files, but each edits `exports` in `packages/inspector/package.json`, so merge those lines carefully.
- Phase 6: T018, T019 and T020 are different files.
- Phase 7: T023, T024 and T025 are different files.

## Implementation strategy

1. MVP: Phases 1 and 2, then Story 1 (Express). It proves the core, the bridge, the build step, the package entry and a
   real browser run.
2. Add Hono, then Next.js, each with its tests. The Next.js host fixture proves the redirect rule against the default
   trailing slash behavior.
3. Add the safety cases for all three (Story 4), then the package test and the docs (Story 5).
4. Finish with the full gate, the one real Next.js, Express and Hono run, review passes and the pull request.

## Notes

- The Next.js warning timing (spec clarification 1, research 13) is the one reading of the constitution for the reviewer.
- The core and the bridge are internal. Do not add them to `exports`. Issue #75 imports them by relative path.
- If a task needs a file this list does not name, record why in the pull request instead of widening scope silently.

## Implementation notes

What changed from the plan while the work was done. The spec, plan, research and contracts carry the same changes.

- Branding (issue #73) merged first, so the helpers take `brand` and write it after `theme`, as `mount_inspector` does
  (core test, browser test and docs row).
- `express4` and the policy-test change were cut by the maintainer: Express 5 only. T001 and T009 follow that.
- The browser hosts (T011, T014, T017) import the helpers from `src`, because `npm run typecheck` runs before the build.
  T022 covers the built `lib`.
- T027 found three fixes: the Next.js route context type is the promise form only, `package.json` has `typesVersions`
  for projects on the older `node` resolution, and Next.js strips the `basePath` from the URL a route handler gets, so
  the warning names the path without it. Each has a test. See research 14.
- The `ponytail:ponytail-review` pass merged `HandlerOptions` into `InspectorOptions`, cut the content types to the four
  the page uses, shared the test warning helper and dropped the guard for a missing Next.js context.
