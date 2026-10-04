# Implementation Plan: JavaScript server helpers

**Branch**: `gh-76-js-server-helpers` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-js-server-helpers/spec.md`, with the clarifications of 2026-10-04.

## Summary

Add helpers for Express, Hono and Next.js route handlers to the `agui-inspector` npm package. Each does what
`mount_inspector` does for Starlette and FastAPI: mount nothing unless `enabled` is `true`, log a warning that names the
mount path, serve the page and `config.json` with the page's own content security policy, and write the configuration
from `agents` and `theme`.

The work is one framework-free core and thin adapters:

- `core.ts` builds a handler on web-standard `Request` and `Response`. It serves the page, `config.json` and the packaged
  files for an asset path the caller supplies, and it also holds the shared mount rules. The adapters work out the asset
  path with their own routing, so no prefix, `basePath` or proxy has to be known to the core.
- Hono and Next.js call the handler with the `Request` they already have. Express goes through a small `node:http`
  bridge (`node.ts`), which the command line tool of issue #75 will reuse with its own listener. The core and the bridge
  are the internal API described in [contracts/internal-core.md](contracts/internal-core.md). They are not exported
  from the package.
- One redirect rule (bare path to `index.html` under the mount) makes the page work in a default Next.js application,
  which redirects `/agui-inspector/` away.
- The helpers ship as ES modules with declarations, compiled by the `tsc` the repository already pins into `lib/`, and
  never enter the browser bundle. The package gains no runtime dependency.

Spikes on real Express 4 and 5, Hono and Next.js 15 and 16 shaped the design. [research.md](research.md) lists what each
proved, including one fix to `static-path.js` that Turbopack needs.

## Technical Context

**Language/Version**: Strict TypeScript 7.0.2 (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), Node.js 24 for the
repository and 22.12 or newer for adopters of the helpers. No React.

**Primary Dependencies**: None at runtime: `node:fs`, `node:path`, `node:url`, `node:http` and the web-standard
`Request`, `Response` and `URL`. Development only, exact pins, each with a row on the dependencies page: `express`
5.2.1, `@types/express` 5.0.6, `express4` (alias of `express` 4.22.3) and `hono` 4.13.13. No `next` and no Next.js types.

**Storage**: None. The page and its files are read from the package's `dist` directory on each request.

**Testing**: `node --test` through the esbuild runner for unit tests (real Express over `http`, Hono through
`app.request`, Next.js handlers called directly). Playwright for package shape and for a real browser against all three
helpers, with the scripted reference agent on the same origin.

**Target Platform**: Node.js servers. Edge runtimes and serverless file bundling are out of scope and documented.

**Project Type**: Library entries of an existing npm package. No new package, no new workspace.

**Performance Goals**: None beyond the page loading as fast as a static file server serves it: one file read per request,
no cache. This is a development tool.

**Constraints**: The browser bundle and its limits do not change (2,000,000 bytes minified, 600,000 gzip). Zero new
runtime dependencies. The helpers add no route, log or file read when disabled. Every response carries the policy header.

**Scale/Scope**: Five source files of about 200 lines in all, one build step, one `exports` change, 4 test files, 2
browser specs, one docs page rewrite and a handful of one-line docs fixes.

## Constitution Check

Constitution 1.2.0. The scope revision the constitution asks for (JS server helpers are outside the 0.1.0 MVP) is the
maintainer-approved 0.2.0 roadmap, issue #76 and this specification. `ROADMAP.md` on `main` still shows the 1.0.0
target until issue #86 merges, and this plan follows the approved text.

| Rule | Assessment and evidence |
| --- | --- |
| I: the wire comes first | Not touched. The helpers serve static files and read no frame, header or body. |
| II: the protocol, not a framework | The helpers are framework-free TypeScript with no React. The core runs without Express, Hono or Next.js, and the adapters import none of them. Nothing sits between the wire and the views. |
| III: generic core, application presets | No server-specific route or convention in the core. An application sets agents, theme and path through arguments. |
| IV: local-only operation, credential privacy | No telemetry, no third-party request, no cookie, no storage, no proxy. The helper reads no request header (the bridge copies method and URL only). `config.json` has no credential field. The page keeps the same-origin policy from `hosting-config.json`, which the helper serves unchanged, so an embedded page cannot widen it. |
| V: small and auditable | No runtime dependency. Four development dependencies, each with purpose and rejected alternative on the dependencies page. One core, one bridge, three thin entries, one existing compiler. The hidden `assetsDir` option and the `npm:` alias are the two costs, both explained in research. |
| VI: every event type has a view | Not touched. |
| Shared bundle and distribution | The one static bundle is served unchanged. The Python wheel and `dist` do not change. Helper code goes to `lib`, which the wheel never stages. |
| Embedded helpers | Mount nothing unless `enabled` is `true`. Warning with the mount path when enabled (Next.js: at the first request, the earliest moment the path is known, see research 13). Policy allows own-origin scripts only and forbids `eval`. |
| Embedded requests | The page is on the host's origin and route tree, so the host's authentication applies. The helpers add none. |
| Implementation tools | Strict TypeScript, esbuild for the page bundle, `node --test` and Playwright, as before. `tsc`, already pinned for the type check, also emits `lib`. |
| Quality gates | Type check, unit tests, build, bundle budget and end-to-end tests cover the change. The helper tests use the scripted reference agent and no outside service. No dynamic code: the existing source scan covers `src/server`. |
| Release | One minor changeset for `agui-inspector`. No version edit, tag or publish. |

Result: pass, with one reading to review (the Next.js warning timing). No amendment is needed and no principle is
worked around.

Post-design re-check: the design added `node.ts`, `lib/` and the `assetsDir` option after the first assessment. None
touches a principle. `lib/` is a build output like `dist`.

## Project Structure

### Documentation (this feature)

```text
specs/006-js-server-helpers/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── public-api.md        # the three helpers
│   └── internal-core.md     # the core and bridge the CLI will reuse
├── checklists/requirements.md
└── tasks.md                 # from /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/
├── package.json             # exports ./express ./hono ./next; files += lib
├── tsconfig.server.json     # emit config: src/server + static-path.js to lib/
├── src/
│   ├── static-path.js       # same value, no new URL(literal, import.meta.url)
│   └── server/
│       ├── core.ts          # createInspectorHandler, resolveMount, warnMounted, types
│       ├── node.ts          # toRequest, sendResponse (node:http bridge)
│       ├── express.ts       # mountInspector
│       ├── hono.ts          # mountInspector
│       └── next.ts          # inspectorRoute
├── lib/                     # build output, git-ignored, shipped
└── tests/server/
    ├── core.test.ts
    ├── express.test.ts      # Express 4 and 5
    ├── hono.test.ts
    ├── next.test.ts
    ├── node.test.ts
    ├── bundle.test.ts       # no helper code in the page bundle
    └── express4.d.ts        # types for the alias

scripts/build.mjs            # buildServer(): tsc, then check the exports targets exist
tests/e2e/js-helpers/
├── package.spec.ts          # lib through the package exports: import, require, types, npm pack, one served page
├── embedding.spec.ts        # real browser against the three helpers (hosts import src: typecheck runs before the build)
├── guard.spec.ts            # disabled and guarded hosts
└── hosts.ts                 # the three servers and the reference agent route
.gitignore                   # packages/inspector/lib/
.changeset/<name>.md         # agui-inspector: minor
website/content/docs/        # embedding, dependencies, development, status, index
README.md, packages/inspector/README.md
```

Existing tests that change: `packages/inspector/tests/foundation/static-path.test.ts` (the exports are no longer only the
static path) and `policy.test.ts` (accept `npm:name@x.y.z` aliases with an exact version).

**Structure Decision**: Server code gets its own directory and its own compile step because it ships as Node code, not
in the browser bundle. It stays in the existing package because the issue says to ship from `agui-inspector`, and the
CLI of issue #75 will live there too.

## Complexity Tracking

No constitution violation. The deviations below are the costs to review:

| Cost | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A second compile step (`tsc` to `lib/`) | Node refuses to strip types from installed packages | Shipping `.ts` fails at import. Hand-written JavaScript and `.d.ts` can drift. |
| `assetsDir` option, hidden from declarations | Unit tests run before the build and cannot use `dist` | Building the page in every test run costs seconds for no added coverage. |
| `express4` alias dependency and a loosened policy test | The spec promises Express 4 and 5 and claims only what a test covers | Express 5 only leaves the larger share of Express apps unverified. |
| Change to `static-path.js` | Turbopack refuses `new URL('../dist', import.meta.url)` in a bundled dependency | A `serverExternalPackages` setting in the host breaks "no host configuration change". |
