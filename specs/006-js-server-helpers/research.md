# Research: JavaScript server helpers

Evidence comes from spikes run on 2026-10-04 in a scratch directory outside the repository: a prototype of the core and
the three helpers, packed with `npm pack`, installed into a Next.js application as a tarball (so it sits in
`node_modules` like a real install), and run against real Express 4 and 5, Hono and Next.js. Express 4 was a spike
only: the maintainer cut it from the tests (decision 10). The spikes are not part of
the change. The decisions below say what they proved.

## 1. Where the Node code lives and how it ships

Decision: write the helpers in TypeScript under `packages/inspector/src/server/`, compile them with `tsc` into
`packages/inspector/lib/` (JavaScript and `.d.ts`), and ship `lib` in the npm package. `npm run build` does both builds.
`lib` is git-ignored like `dist`.

Rationale:

- Node does not strip types from files under `node_modules`, so TypeScript sources cannot ship as they are.
- The repository already pins TypeScript 7.0.2. Spike result: it emits JavaScript and declarations in one pass, and
  `rewriteRelativeImportExtensions` turns the `./core.ts` imports the repository uses into `./core.js`. No new tool.
- `rootDir` is `src`, so `lib/` mirrors `src/`. The compiled `lib/server/*.js` sits at the same depth below the package
  root as the source, and `lib/static-path.js` is the compiled copy of `src/static-path.js`.
- Declarations keep the `./core.ts` specifiers. A consumer on TypeScript 5.8 (`moduleResolution` `NodeNext`) and one on
  7.0.2 both type check them, and a wrong argument is an error.
- `stripInternal` removes the `assetsDir` option from the declarations (see decision 6).

Alternatives considered:

- Hand-written JavaScript with JSDoc and hand-written `.d.ts`: two files to keep equal, and nothing checks them against
  each other.
- esbuild for the JavaScript plus `tsc` for declarations: two tools for what one does.
- Ship `src/server/*.ts` and let Node strip types: refused by Node for installed packages.
- A new package for the helpers: the issue says to ship from `agui-inspector`.

## 2. The npm package surface

Decision: `exports` gains `./express`, `./hono` and `./next`, each with `types` and `default`. The `.` export stays
`./src/static-path.js`. `files` gains `lib`. The core is not exported. The command line tool of issue #75 lives in the
same package and imports `src/server/core.ts` by relative path.

Rationale: a host imports one helper and loads nothing else. The core stays free to change until the CLI exists. The
package stays ES module only: Node.js 22.12 and newer can `require()` an ES module that has no top-level `await`, which
a package test checks for each entry. Keeping one format avoids a dual package and its two copies of the core.

Alternatives considered: a public `./server` export for the core (a public API nobody asked for); a CommonJS build
(clarified as not needed).

## 3. The core takes a request and an asset path

Decision: the core is `createInspectorHandler(options)`, which returns `(request: Request, asset: string) =>
Promise<Response>`. `asset` is the decoded path below the mount: `''` for the mount itself, `config.json`,
`app.js`, `assets/x.js`. The core knows nothing about the mount path. The adapters work out `asset` with their own
framework's routing. `resolveMount(options)` in the same file does what the three helpers share: the `enabled` gate,
the path and agent checks, and the warning text.

Rationale: a core that matched the mount path itself would have to know every outer prefix (an Express `Router` under
`/api`, Hono `basePath` or `route`, a Next.js `basePath`, a proxy that strips a prefix). Each framework already knows
where its route ends and the asset begins:

| Framework | Source of `asset` | Decoded by |
| --- | --- | --- |
| Express | `req.url` below `app.use(path, ...)`, a path relative to the mount | the adapter, per segment |
| Hono | the `:asset{.*}` route parameter | Hono |
| Next.js | the `[[...path]]` route parameter, joined with `/` | Next.js |

Spike results: all three give the right `asset` for the page, `config.json` and nested files, behind an Express `Router`
at `/api`, a Hono `basePath('/api')` and a Next.js `basePath: '/tools'`. `{.*}` also matches the empty asset, so the
slash form `/agui-inspector/` is routed in both Hono strict modes. The pattern `:asset{.+}` did not, and returned Hono's
own 404 without the policy header.

The core still reads the request URL for two things: whether the path ends in `/` (to tell the bare mount from its
slash form, since both have an empty `asset`) and the query string for the redirect.

Alternatives considered: a core with a `path` option (breaks under every prefix above); one adapter shape taking raw
URLs (each framework decodes differently, so a double decode or a missing decode would sit in the safety check).

## 4. One redirect rule

Decision: the bare mount path answers `307` with a relative `Location`: the last path segment plus `/index.html`, and the
query string. For `/api/agui-inspector?x=1` it is `agui-inspector/index.html?x=1`. The slash form serves the page.

Spike result on Next.js 16.3.8 (`next dev`):

| Setting | `/agui-inspector` | `/agui-inspector/` | `/agui-inspector/index.html` |
| --- | --- | --- | --- |
| default | reaches the route | 308 back to `/agui-inspector` | reaches the route |
| `trailingSlash: true` | 308 to `/agui-inspector/` | reaches the route | reaches the route |
| `skipTrailingSlashRedirect: true` | reaches the route | reaches the route | reaches the route |

By default the page cannot live at `/agui-inspector/`, and the page needs a URL whose directory is the mount, because
`./app.js`, `hosting-config.json` and `config.json` are relative to `document.baseURI`. A redirect to the slash form
would loop. `/agui-inspector/index.html` is the one URL that works under all three settings, with no change to the
host's `next.config`. The relative `Location` also survives any prefix. The core never builds an absolute URL.

Alternatives considered: redirect to the slash form for Express and Hono and to `index.html` for Next.js only (two
rules, a core option and double the tests, for an address bar that looks nicer); require `trailingSlash: true` (changes
every page of the host); rewrite the page to absolute URLs (changes the shared bundle, and `base-uri 'none'` forbids
`<base>`).

## 5. Locating the packaged files under a bundler

Decision: `src/static-path.js` computes its value with `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..',
'dist')` instead of `fileURLToPath(new URL('../dist', import.meta.url))`. The value is the same. The core imports it.

Spike result: Turbopack (the default in Next.js 16) fails the first form at build and at run time with `Module not found:
Can't resolve '../dist'`, because it reads `new URL('<literal>', import.meta.url)` as an asset import and the target is
a directory. The second form works in `next dev` and `next build` with Turbopack and with `--webpack`, on Next.js 15.5
and 16.3.8, and with a `basePath`. Next.js bundles `node_modules` packages in route handlers, so a host that uses
Next.js hits this unless the code avoids the pattern. The existing test of `staticAssetsPath` keeps passing. A Next.js
host that runs the helper imports `staticAssetsPath` no differently, so the fix also helps them.

Alternatives considered: tell Next.js hosts to add `serverExternalPackages: ['agui-inspector']` (a change to the host's
configuration, which FR-012 rules out); resolve the directory with `require.resolve` (bundlers rewrite it too).

## 6. Test access to a stand-in directory

Decision: `InspectorOptions` has an optional `assetsDir`, marked `@internal` and removed from the declarations by
`stripInternal`. The unit tests pass a small temporary directory, as the Python tests patch `_assets_root`.

Rationale: `npm run check:ci` runs the unit tests before the build, so they cannot rely on `packages/inspector/dist`.
Patching an imported ES module is not possible without an experimental flag. A hidden option is the smallest hook.

Alternatives considered: build the page into a temporary directory in every test run (seconds per run, for no extra
coverage); an environment variable (global state that a host could set by accident).

## 7. Node.js bridge for Express

Decision: `src/server/node.ts` has two functions: `toRequest(message)` builds a `Request` from a `node:http` message
(method and URL only), and `sendResponse(response, serverResponse)` writes a `Response` to a `ServerResponse`. The
Express adapter uses both. The browser tests use them to put the Hono and Next.js handlers behind a `node:http` server.
The CLI of issue #75 will use them for its own listener.

The bridge reads no headers and no body. The inspector needs neither, and `Request` rejects some header values that a
raw message can carry. Bodies are small and read whole, so `sendResponse` writes one buffer, which also gives a plain
`Content-Length` and lets Node drop the body of a HEAD reply itself.

Express specifics, checked on Express 5.2.1 and on a `Router` under `/api` (the spike gave the same results on Express
4.22.3, which no test covers): inside `app.use(path, ...)`,
`req.url` is relative to the mount and `req.originalUrl` is what the client sent. The slash test and the redirect use
`originalUrl`; the asset comes from `req.url`. A path that fails `decodeURIComponent` is not found.

## 8. Framework typing without a framework dependency

Decision: each helper takes a minimal structural type, not the framework's own: `{ use(path, handler) }` for Express
and `{ all(path, handler) }` for Hono. The package declares no dependency or peer dependency on any of the three.

Spike result: real Express 4 and 5 applications (the tests keep 5), an Express `Router`, a Hono application and a Hono application with
`basePath` are all assignable to those types under `strict`, using `@types/express` and Hono's own types. The type check
for Next.js (`next build` runs it) accepts the route handlers' types. A wrong argument (an agent without a `url`) is a
type error.

Alternatives considered: `import type { Hono } from 'hono'` (needs the peer for every user, and Hono's generic
parameters make the type fragile); `any` (no checking).

## 9. Hono routes

Decision: `app.all(path, ...)` for the bare path and `app.all(`${path}/:asset{.*}`, ...)` for the rest. `all`, not `get`,
so a `POST` reaches the core and gets a 405 with an `Allow` header instead of Hono's plain 404.

## 10. Which framework versions are tested

Decision: Express 5.2.1 and Hono 4.13.13. Next.js is not a dependency. The Next.js handlers are called directly by the unit tests, with `params` as a promise (Next.js 15 and 16)
and as a plain object (the 14 shape), and the spikes above ran them in Next.js 15.5.27 and 16.3.8.

Rationale: the frameworks differ at the edges (routing, decoding, trailing slashes), so each one the docs name gets a
real test. `next` is large, has its own build, and the handler takes only a `Request` and `params`. A one-time run in a
real application backs the claim, and the claim is stated in the docs with the versions it was run on. If a version is
not tested, the docs do not claim it. For Express the docs say the helper is tested with Express 5 and needs only
`app.use(path, handler)`.

Alternatives considered:

- Express 4 as well, through an `npm:express@4` alias. The maintainer cut it: it needs an `npm:` alias, an exception to
  the exact-version policy test and one more dependency row, for a version the adapter touches only through
  `app.use(path, handler)`.
- `next` as a dev dependency with a real server in the browser tests (a second framework build in CI for a handler that
  is a plain function).


## 11. Tests

Decision, by layer:

- Unit tests in `packages/inspector/tests/server/` (compiled by esbuild, run by `node --test`): the core (routes,
  redirect, config, CSP, methods, traversal, content types, errors), the mount rules (arguments, disabled, warning),
  each helper with its real framework (Express over a real `http` server on a free port, Hono through `app.request`,
  Next.js by calling the handlers), and that the browser bundle has no server code (a build with a metafile).
- Package and browser tests in `tests/e2e/js-helpers/`: the built `lib` through the package's own exports (an ESM
  `import`, a CommonJS `require`, a TypeScript consumer type check, and `npm pack --dry-run` contents), then a real
  browser against all three helpers behind `node:http` servers, with the scripted reference agent on the same origin.

The page needs `lib`, so the browser tests run after the build, as the Python ones do. The unit tests use the stand-in
directory and run before it.

## 12. Documentation

Decision: `embedding.mdx` keeps its Python sections and their anchors and gains JavaScript sections. The title and
introduction cover both languages. `development.mdx`, `dependencies.mdx`, `status.mdx`, `index.mdx`, the root README and
the package README stop saying the helpers are planned. No page claims a framework version the tests do not cover.

## 13. Constitution reading

The constitution says an enabled helper logs "a startup warning with the mount path". Express and Hono mount when the
helper is called, so they log then. Next.js has no mount step: it loads a route module on the first request for that
route (spike: `next start` printed nothing before the first request), and only a request tells the helper its path, a
`basePath` included. The Next.js helper logs once at that point, the earliest moment the real path is known. This is a
reading of the principle, recorded in the spec's clarifications. It needs no amendment, and the pull request flags it
for review.

## Open items

None that block the plan. The pull request lists the Next.js warning timing as a decision for the reviewer.
