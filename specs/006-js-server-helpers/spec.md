# Feature Specification: JavaScript server helpers

**Feature Branch**: `gh-76-js-server-helpers`

**Created**: 2026-10-04

**Status**: Draft for review.

**Input**: Issue [#76](https://github.com/dogganidhal/agui-inspector/issues/76), item 4 of the 0.2.0 roadmap. Embedded is
the primary mode, but only Python servers have a helper. A JavaScript server has to serve the static files and write
`config.json` by hand. Add helpers for Express, Hono and Next.js route handlers, shipped from the `agui-inspector` npm
package, that do what `mount_inspector` does for Starlette and FastAPI. The command line tool of issue
[#75](https://github.com/dogganidhal/agui-inspector/issues/75) (spec 005) is planned after this feature and will reuse
the same serving behavior.

## Clarifications

No maintainer was available, so the spec author answered each question from the issue, the 0.2.0 roadmap, the
constitution and the code, and took the recommended option.

### Session 2026-10-04

- Q: Next.js has no mount step, so when does the helper log its warning, and does it take a `path` argument? → A: It
  takes no `path`, because the route file's location sets the path. It logs the warning once per server process, when the
  route first serves a request, and names the path of that request (a `basePath` included). Logging at module load would
  also fire during `next build` and could not name the real path.
- Q: Where does a request for the bare mount path go, given that Next.js redirects `/agui-inspector/` back to
  `/agui-inspector` by default? → A: One rule for all three helpers: a 307 redirect, with the query kept, to the page's
  `index.html` under the mount path. The slash form also serves the page when the host lets it through. Redirecting to
  the slash form loops in default Next.js and fails behind any proxy that removes trailing slashes. A spike on
  Next.js 16.3.8 showed `/agui-inspector/index.html` is served in the default, `trailingSlash` and
  `skipTrailingSlashRedirect` configurations.
- Q: Do the helpers also ship as CommonJS? → A: No. They are ES modules with type definitions. A CommonJS host loads
  them with `require` on Node.js 22.12 or newer, or with a dynamic `import`. The documentation states Node.js 22.12 as
  the minimum for the helpers. The package gets no `engines` field here, because the static files do not need Node.js.
- Q: Which framework versions do the tests cover? → A: Express 4 and 5, Hono 4, and Next.js 15 and 16 route handlers.
  The plan lists the exact versions. Express and Hono are test dependencies with exact pins. Next.js is not a
  dependency: the handlers take a web-standard request and the route parameters, so tests call them directly, and a
  recorded run against a real Next.js application backs the claim.
- Q: Does the Express helper take only an application? → A: It takes anything with the application's `use` method, so a
  `Router` works as well. The mount path is relative to that router, and the redirect and the asset paths follow it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the inspector from an Express server (Priority: P1)

A developer with an AG-UI agent route in an Express application adds one call and a list of agents. They start the
server, open `/agui-inspector` in a browser and see their agents. They send a run to the agent and inspect it, with no
files copied and no `config.json` written by hand.

**Why this priority**: Express is the most common JavaScript server for AG-UI agents, and embedded use is the primary
mode. This is the smallest slice that proves the contract on a real framework.

**Independent Test**: Build a small Express application with the scripted reference agent and the helper enabled. Open
the page in a browser, check that the agent is listed, run it and check the recorded frames. Fetch the page and
`config.json` with a plain HTTP client and check the headers.

**Acceptance Scenarios**:

1. **Given** an Express application with the helper enabled and no `path`, **When** a browser opens `/agui-inspector`,
   **Then** it is redirected to the page under that path, the page loads and it lists the configured agents.
2. **Given** the same application, **When** the browser requests `/agui-inspector/config.json`, **Then** it receives the
   version 0 configuration built from the arguments.
3. **Given** the application mounts the helper with `path` set to `/tools/inspect`, **When** a browser opens
   `/tools/inspect`, **Then** the page loads from there and `/agui-inspector` is not served.
4. **Given** the helper is mounted on an Express `Router` that the application mounts under `/api`, **When** a browser
   opens `/api/agui-inspector`, **Then** the page and its files load from there.

---

### User Story 2 - Open the inspector from a Hono server (Priority: P1)

A developer with a Hono application does the same: one call, a list of agents, the page at `/agui-inspector`.

**Why this priority**: Hono is the second named framework. It also covers servers that run on a web-standard request
and response model, such as those on Bun, Deno or Node.

**Independent Test**: Build a small Hono application with the helper enabled, send it requests the way Hono's own test
client does, and run the page in a browser through a Node listener.

**Acceptance Scenarios**:

1. **Given** a Hono application with the helper enabled, **When** a browser opens `/agui-inspector`, **Then** the page
   loads and lists the configured agents.
2. **Given** a Hono application that mounts its routes under a base path such as `/api`, **When** a browser opens
   `/api/agui-inspector`, **Then** the page and its files load from there.

---

### User Story 3 - Open the inspector from a Next.js route handler (Priority: P1)

A developer with a Next.js application adds one route file that exports the helper's handlers. They open
`/agui-inspector` and see their agents. They do not change `next.config`, and their other pages keep working as before.

**Why this priority**: Next.js is the third named framework. It has no application object to mount on, so the helper
takes a different shape, and Next.js treats a trailing slash in its own way. Both need a test.

**Independent Test**: Call the exported handlers with web-standard requests for each route the page uses, with and
without the catch-all route parameters Next.js passes. Check the page, the configuration, the assets and the redirect
in the default Next.js configuration and in a configuration that sets `basePath`.

**Acceptance Scenarios**:

1. **Given** a route file at `app/agui-inspector/[[...path]]/route.ts` that exports the helper's handlers, **When** a
   browser opens `/agui-inspector` on a Next.js application with its default configuration, **Then** the page loads, its
   scripts and styles load, and it reads its configuration, with no redirect loop.
2. **Given** the helper is disabled, **When** any request reaches the route, **Then** the response is a not-found
   response with no inspector content, and nothing is logged. The route file stays, but nothing is served.
3. **Given** a Next.js application with a `basePath`, **When** a browser opens the page under that base path, **Then** it
   loads the same way.
4. **Given** the helper is enabled, **When** the route serves its first request, **Then** one warning is logged that
   names the path of that request, and no further warning follows.

---

### User Story 4 - Safe by default and guarded by the host (Priority: P1)

A developer enables the helper only in development. In production, nothing is mounted. When it is enabled, the server
logs a warning that names the path, so a log search shows whether it ever ran in production. The inspector uses the
host's own authentication, because the page is served from the same origin as the agent routes.

**Why this priority**: The inspector shows request bodies, raw frames and the agent list to anyone who can reach the
route. Safe defaults are the contract of the Python helper and of the constitution.

**Independent Test**: For each framework, mount the helper once with `enabled` false and once with `enabled` true. Count
routes added, log lines written and responses for every inspector path. Put the host's own authentication in front of
the application and request every inspector path with and without credentials.

**Acceptance Scenarios**:

1. **Given** `enabled` is false or left out, **When** the helper is called, **Then** no route is added, nothing is
   logged, and every path under the mount path gets the host's normal not-found response.
2. **Given** `enabled` is true, **When** the helper mounts (in Next.js, when the route first serves a request), **Then**
   exactly one warning is logged and it contains the mount path.
3. **Given** the host's authentication covers its routes, **When** a request without credentials asks for the page, its
   files, `config.json` or the slash redirect, **Then** the host's response is returned and no inspector content is
   served. The documentation states where the guard has to sit for each framework.
4. **Given** any inspector response (page, file, configuration, redirect, error), **When** its headers are read, **Then**
   it carries a content security policy that allows scripts from its own origin only and forbids `eval`.

---

### User Story 5 - Adopt the helpers without extra installs or a heavier page (Priority: P2)

A maintainer or adopter installs the package once and imports the helper for their framework. Installing the package
adds no web framework, the page bundle does not grow, and the documentation explains the three helpers next to the
Python one.

**Why this priority**: The roadmap wants helpers that stay small and auditable. This protects the other modes from
the new Node code.

**Independent Test**: Read the package manifest and the installed files, run the bundle budget check, and read the
documentation page.

**Acceptance Scenarios**:

1. **Given** the npm package, **When** a project installs it, **Then** no web framework is installed with it, and each
   helper works with the version of its framework that the host already has.
2. **Given** the built browser bundle, **When** it is searched for the helper code, **Then** none is found, and the
   budgets are unchanged.
3. **Given** a TypeScript project, **When** it imports a helper, **Then** the arguments are type checked.
4. **Given** the embedding page, **When** a reader looks for a JavaScript server, **Then** it documents the three
   helpers with their arguments, routes, debug guard, authentication and theming.

---

### Edge Cases

- Both `agents` and `path` are checked when the helper mounts, not on a request. A path that does not start with `/`, a
  path that is only `/`, an agent without an `id` or a `url`, and two agents with the same `id` stop startup with a
  message that names the problem. A trailing `/` on `path` is ignored.
- The page needs its files to load relative to its own URL. A request to the bare mount path, with or without a query
  string, is redirected to the page's `index.html` under that path, and the query string is kept. The redirect is
  relative, so it holds when the host sits under an outer prefix, behind a proxy that strips a prefix or removes
  trailing slashes, and in Next.js with any trailing slash setting.
- A request that tries to leave the packaged static directory fails with not found. That covers `..`, encoded `..`,
  encoded slashes, backslashes, empty segments and null bytes. Nothing outside the packaged files is ever read.
- A missing file under the mount path is a not-found response with the content security policy header, not a fall
  through to the page.
- A method other than GET and HEAD gets a method-not-allowed response. A HEAD request returns the same headers as GET
  and no body.
- Files are served with a content type the browser accepts for module scripts, styles and JSON. A wrong type for the
  main script stops the page.
- The packaged files are missing, for example in a source checkout that has not been built. Mounting an enabled helper
  fails with a message that names the build step. A disabled helper never looks for the files.
- Hosts that run without file system access, such as edge runtimes, cannot serve the page. The documentation says the
  helpers need the Node.js runtime. They do not try to work around it.
- `theme` is passed to `config.json` as given. The page decides what is valid and shows a warning for the rest, as it
  does for the Python helper.
- Host routing options (case sensitivity, strict trailing slashes, route prefixes) stay the host's. The helper does not
  change them.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `agui-inspector` npm package MUST provide one helper each for Express, Hono and Next.js route
  handlers. Each is imported from its own entry of the package, so a host loads only the helper for its own framework.
- **FR-002**: Each helper MUST follow the contract of the Python `mount_inspector`: the same arguments (`agents`,
  `enabled`, `path`, `theme`) with the same meaning, the default path `/agui-inspector`, the same path rules, and the same
  `config.json` content for the same arguments. Express and Hono mount on the host's application object. Express also
  accepts a `Router`, and the path is then relative to it. Next.js has no such object, so the helper takes `agents`,
  `enabled` and `theme`, with no `path` because the route file's location sets it, and returns the handlers for that
  route file.
- **FR-003**: A helper MUST mount nothing unless `enabled` is true. The default is false. A disabled helper MUST add no
  route, log nothing, read no packaged file and need no framework API. In Next.js, where the route file exists anyway, a
  disabled helper MUST answer every request with not found and no inspector content.
- **FR-004**: An enabled helper MUST log one warning when it mounts. The text MUST be
  `agui-inspector is enabled and mounted at <path>; disable it outside development`, with the mount path, as in the Python
  helper. In Next.js there is no mount step, so the warning is logged once per server process, when the route first
  serves a request, with the path of that request.
- **FR-005**: An enabled helper MUST serve, under its mount path: the page, `config.json`, and every packaged file
  including nested ones. A request for anything else under the path MUST be not found. A request for the bare path MUST
  get a 307 redirect, with the query kept, to the page's `index.html` under the mount path, so that the page's relative
  files resolve under the mount path. The slash form of the path MUST serve the page when the host lets the request
  through.
- **FR-006**: `config.json` MUST be the version 0 configuration built from the arguments: `version`, `agents` with only
  the fields that were given (`id`, `url`, `name`, `capabilities`, `preset`), and `theme` only when one was given.
  Values MUST reach the file unchanged. The helpers add no field of their own.
- **FR-007**: `agents` MUST have a nonempty unique `id` and a nonempty `url` for each entry. `path` MUST start with `/`
  and MUST NOT be `/` alone. A violation MUST stop startup with a message that names it, and nothing is mounted.
- **FR-008**: Every response of the helper, redirects and errors included, MUST carry
  `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'none'`, the policy of the page's own `<meta>`
  element and of the Python helper.
- **FR-009**: The helper MUST serve only files that belong to the packaged static directory and MUST refuse every
  attempt to leave it, in any encoding. Directory listings MUST NOT be served.
- **FR-010**: Only GET and HEAD MUST be served. Other methods MUST get a method-not-allowed response with an `Allow`
  header. In Next.js the framework answers methods the route file does not export, so the route exports only GET and
  HEAD. HEAD MUST return the headers of GET and no body.
- **FR-011**: The page MUST be served from the host's own origin and route tree. The helpers MUST add no authentication,
  no cookie, no session storage, no agent proxy and no request of their own. The host's middleware and guards apply to
  every inspector route. The documentation MUST say, per framework, where a guard has to sit so that it runs before the
  inspector routes.
- **FR-012**: The helpers MUST NOT require the host to change its framework configuration. In particular, a Next.js
  application with its default trailing slash setting MUST serve a working page, and the helper MUST NOT cause a redirect
  loop under any trailing slash setting. The one redirect rule in FR-005 serves all three helpers.
- **FR-013**: Installing the npm package MUST install no web framework. Each helper MUST work with the framework version
  the host has, within the versions the tests cover, which the documentation lists. The target is Express 4 and 5, Hono 4
  and Next.js 15 and 16 route handlers. Frameworks needed to test the helpers are development dependencies only, and
  Next.js is not one of them.
- **FR-014**: The three helpers MUST share one implementation of the contract, so they cannot drift apart, and that
  implementation MUST work without any of the three frameworks. It is an internal part of the package with a documented
  interface, so the command line tool of issue #75 can serve the same files and configuration without a second copy.
- **FR-015**: The helper code MUST NOT be part of the browser bundle. The bundle's content, its limits (2,000,000 bytes
  minified, 600,000 bytes gzipped) and the other modes MUST NOT change. The helper code MUST NOT import React, and MUST
  pass the repository's strict type check.
- **FR-016**: Each helper entry MUST ship as an ES module with type definitions, so a TypeScript project checks the
  arguments. There is no separate CommonJS build. The documentation MUST state Node.js 22.12 or newer as the minimum for
  the helpers and show how a CommonJS host loads them.
- **FR-017**: A helper MUST NOT enable anything the page does not already allow. It adds no field to the configuration
  format, and the page keeps its own validation of `theme` and of the rest of the file.
- **FR-018**: Tests for each framework MUST cover mounting, the disabled case, the startup warning and the content
  security policy. They MUST also cover the redirect, `config.json`, path traversal, methods, and the host's own guard.
  At least one end-to-end test MUST open the served page in a browser, see the agent and record a run against the
  scripted reference agent.
- **FR-019**: The documentation MUST describe the three helpers on the embedding page. That means the install, the call
  for each framework, the arguments, the routes, the debug guard, authentication, theming, and the Node.js runtime
  limit. The package README MUST stop saying that the package has no server helper. Every new development dependency
  MUST have its row on the dependencies page. A changeset MUST add a minor change for `agui-inspector`.

### Key Entities

- **Helper arguments**: `agents`, `enabled`, `path` and `theme`, as in the Python helper. The same set for Express and
  Hono. Next.js has no `path`, because the route file fixes it.
- **Agent entry**: `id` and `url` are required. `name`, `capabilities` and `preset` are optional. It means what it means
  in the configuration file.
- **Inspector configuration**: the version 0 `config.json` the helper writes from the arguments. The page reads it from
  its own directory.
- **Packaged static files**: the single built page, its scripts and styles, as shipped in the npm package and in the
  Python wheel. The helpers serve them unchanged.
- **Shared serving behavior**: the one implementation of routes, configuration, headers and file safety that the three
  helpers, and later the command line tool, use.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer enables the inspector in an Express, a Hono or a Next.js application with one import and one
  call or one route file, in under ten lines, and sees the configured agents at `/agui-inspector`. No static file is
  copied and no `config.json` is written.
- **SC-002**: With `enabled` false or left out, each framework adds zero routes and logs zero lines, and every path under
  the mount path returns the host's normal not-found response, or not found from the Next.js route.
- **SC-003**: With `enabled` true, each framework logs exactly one warning and it contains the mount path. In Next.js it
  is logged once, at the first request the route serves.
- **SC-004**: 100% of inspector responses carry the content security policy header, including redirects, not found and
  method not allowed. A page load makes zero requests outside its own origin and the configured agents.
- **SC-005**: For the same arguments, the parsed `config.json` of each JavaScript helper equals the one that
  `mount_inspector` serves, shown by fixtures taken from the Python tests.
- **SC-006**: Zero path traversal attempts from the test set (plain, encoded, backslash and null byte forms) return
  content from outside the packaged directory.
- **SC-007**: In a real browser, the page served by each helper (through a Node listener for Hono and Next.js) lists the
  agent and records a run against the scripted reference agent. Next.js passes in its default configuration.
- **SC-008**: The browser bundle contains no helper code and passes the size budgets unchanged. The package manifest adds
  zero runtime dependencies.
- **SC-009**: The embedding page documents all three helpers, and the existing documentation checks that read the docs
  pass.

## Assumptions

- The Python helper is the contract. Its arguments today are `agents`, `enabled`, `path` and `theme`. If another field,
  such as the branding of issue #73, reaches the Python helper before this feature merges, the JavaScript helpers carry
  it in the same way.
- The configuration format stays at version 0 and gains no field here.
- Only Node.js servers are in scope. Edge runtimes and servers without file system access are not. Hono applications
  that run on Node.js are in scope, and the same code works on other runtimes that have a file system.
- Next.js means the App Router with route handlers. The Pages Router and other frameworks (Fastify, Koa and so on) are
  not in scope. A host with another Node.js server can serve the assets by hand, as the documentation already says.
- The supported versions of each framework are the ones the tests cover: Express 4 and 5, Hono 4, and Next.js 15 and 16.
  The plan names the exact versions. If a version cannot be covered by a test, the documentation does not claim it.
- The helpers need Node.js 22.12 or newer. The package declares no `engines` field, because the static files alone work
  on older versions.
- The command line tool (#75) is not part of this feature. This feature only leaves it a clean interface to reuse.
- Publishing, tags and releases stay with the maintainer. The changeset only records the change.
- The helpers need the packaged files to exist. In a source checkout, `npm run build` creates them.
