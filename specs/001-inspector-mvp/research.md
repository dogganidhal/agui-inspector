# Research: 0.1.0 inspector MVP

Date: 2026-10-02. Scope and authority: [spec](spec.md), [constitution](../../.specify/memory/constitution.md),
[roadmap](../../ROADMAP.md). `agui-inspector` is a working name, not a reserved package name.

## Protocol and renderer packages

- **Decision:** use exact runtime pins `@ag-ui/core@1.0.1`, `@ag-ui/client@1.0.1`,
  `@ag-ui/a2ui-middleware@0.0.11`, `@a2ui/react@0.12.0`, `@a2ui/web_core@0.12.0`,
  `react@19.3.0`, `react-dom@19.3.0`, and `zod@3.25.76`. Commit the complete npm lockfile.
- **Rationale:** public registry metadata and published declarations were inspected on this date.
  Core/client 1.0.1 implement protocol 1.0, including the 31-event baseline, `protocolVersion`,
  `parentRunId`, and `resume`. `HttpAgentConfig.fetch` provides the recorder injection point.
  A2UI package versions are not protocol versions: import the renderer/core `/v0_9` entry points.
  Middleware exposes `RENDER_A2UI_TOOL`; use its declaration for the optional tool rather than
  inventing a different schema or activating automatic tool replies.
- **Alternatives considered:** chat frameworks violate principle II; custom protocol schemas,
  renderers, and tool declarations duplicate the required upstream packages. The historical
  brief's `@a2ui/markdown-it` listing does not override the constitution's renderer requirements;
  conversation Markdown remains excluded. Do not add it as a separate runtime dependency.
- **Implementation check:** F01 must exercise the exact pinned imports, resume/cancel shapes,
  client fetch hook and sequence-error reporting, A2UI v0.9 action callback, and tool declaration
  together. A failed compatibility check is a visible blocker, not permission to downgrade the
  baseline. Renderer transitive networking must be checked in L05.
- **Sources:** [core registry](https://registry.npmjs.org/@ag-ui/core/1.0.1),
  [client registry](https://registry.npmjs.org/@ag-ui/client/1.0.1),
  [middleware registry](https://registry.npmjs.org/@ag-ui/a2ui-middleware/0.0.11),
  [React renderer registry](https://registry.npmjs.org/@a2ui/react/0.12.0),
  [renderer core registry](https://registry.npmjs.org/@a2ui/web_core/0.12.0).

## Recording and frame boundaries

- **Decision:** inject a fetch wrapper, clone the response promptly, and drain the recording
  branch independently while returning the original response to the client. The caller supplies
  the expected body kind (`sse` or ordinary response); the recorder never reads headers to infer it.
  Use streaming `TextDecoder` and an incremental SSE reader; retain original framed text separately
  from the SSE `data` value passed to JSON/schema validation.
- **Rationale:** `Response.clone()` tees the body without rewriting client bytes. LF, CRLF, and
  bare CR, multiline `data`, comments, split UTF-8, coalesced events, and EOF fragments need explicit
  tests. Ordinary error/preparation responses also need inspectable bodies.
- **Alternatives considered:** parsing the client's events loses malformed wire evidence;
  `EventSource` cannot send run POST bodies; full-buffer parsing loses streaming and timing.
- **Risk:** tee buffers for a slower branch without a bounded backlog. Drain promptly even if the
  client rejects malformed traffic; benchmark retained frames, and report capture failure visibly.
  Never drop frames or silently truncate to make the benchmark pass. Parser-boundary fragments
  are evidence, not fabricated protocol events.
- **Sources:** [Response.clone](https://developer.mozilla.org/en-US/docs/Web/API/Response/clone),
  [Streams tee](https://streams.spec.whatwg.org/#rs-tee),
  [SSE parsing](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream).

## Local security and hosted startup

- **Decision:** all scripts and assets are same-origin. An explicit deployment allowlist determines
  hosted `connect-src` before the application starts; arbitrary configuration cannot widen it.
  Validate URL destinations and redirects at the transport boundary, use `credentials: "omit"`
  for hosted requests, and permit embedded authentication only on the page's origin.
- **Rationale:** a static page cannot broaden a CSP safely after the user types a new endpoint.
  Self-hosters configure allowed destinations and reload/re-serve the page. Disallowed typed
  endpoints/config/capabilities/preparation URLs get a visible error, not a proxy.
- **Alternatives considered:** `connect-src *`, late permissive CSP, remote fonts/catalog fetches,
  a hosted proxy, and telemetry violate the approved privacy policy. A2UI uses bundled catalogs.
- **Unresolved:** server-echoed authentication credentials conflict with exact raw retention.
  [G-07](plan.md#open-decision-and-approval-gates) records the conflict and candidate interpretation;
  no exception or redaction policy was adopted.
- **Source:** [CSP guide](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP).

## Tooling and distribution

- **Decision:** Node 24 LTS, strict TypeScript, esbuild, npm workspaces, `node --test`, and Playwright.
  Development pins: `typescript@7.0.2`, `esbuild@0.28.2`, `@playwright/test@1.63.0`,
  `@types/react@19.3.0`, `@types/react-dom@19.3.0`; F01 selects an exact Node-24-compatible
  `@types/node` patch and records the runtime/tool versions. Runtime `zod` stays 3.25.76 to satisfy
  both core and renderer peers rather than selecting registry-latest Zod 4.
  Installation uses `npm ci --ignore-scripts`, with `.npmrc` enforcing disabled install scripts.
  Explicit development build and browser-install commands are not package-install lifecycle hooks.
- **Rationale:** tooling is constitution-mandated. esbuild's native optional platform package must
  remain installed; F01 proves the binary works without running postinstall. Do not solve this by
  globally re-enabling lifecycle scripts. `node --test` consumes TypeScript tests compiled by the
  explicit test-build command; no additional unit runner.
- **Alternatives considered:** framework build stacks and another test runner are unnecessary.
  Using package defaults without proving no-script builds risks an unbuildable scaffold.
- **Decision:** a new local Python package uses `uv`, Python >=3.10, standard-library tests and
  `importlib.resources`; Starlette is an optional embedding extra. FastAPI remains an integration
  test/example dependency, not an unconditional dependency. Include the already built static files
  as wheel/sdist package data, with a checksum comparison against npm's same asset directory.
- **Rationale:** this is our package design, not a dependency on an existing inspector or MCP
  package. The installed wheel must serve assets on a machine without Node.
- **Alternatives considered:** downloading assets at startup or building in the host violates the
  distribution/privacy requirements. Python must not read/store captured sessions server-side.
- **Sources:** [npm ignore-scripts](https://docs.npmjs.com/cli/v10/commands/npm-ci#ignore-scripts),
  [Python resources](https://docs.python.org/3.10/library/importlib.resources.html),
  [uv builds](https://docs.astral.sh/uv/guides/package/),
  [Playwright browser registry](https://registry.npmjs.org/playwright-core/1.63.0).

## Performance and coordination

- **Decision:** freeze the exact [5,000-frame profile](plan.md#fixed-5000-frame-benchmark) before
  implementation. Start with native lists, lazy raw expansion and animation-frame-batched store
  notifications. Add a small local windowing implementation only if this measured workload fails;
  do not preselect another runtime dependency.
- **Rationale:** the shipped renderer counts in the budget. The portable CI run proves workload
  integrity and records timing; only the specified physical runner can certify responsiveness.
- **Alternatives considered:** fabricated DOM timers, schema-only frame counts, a renderer-excluded
  budget, and throttled generic CI pretending to be the hardware profile do not prove SC-009.
- **Decision:** six chained W1 PRs and seven disjoint W2 PRs. W2 modules exercise their own public
  seams using scripted collaborators and frame fixtures; full-product acceptance runs on integrated
  main without adding W2 branch dependencies.
- **Unresolved:** a possible subsequent integration PR is [G-08](plan.md#open-decision-and-approval-gates),
  not an authorized third wave. All roadmap decisions remain named gates, not research choices.

## Views and theming

- **Decision:** style every view through plain CSS custom properties: ten public `--agui-*`
  properties that adopters override, and internal tokens derived from them with `color-mix()` and
  `oklch()`. F06 ships the tokens and a small set of React primitives built on native elements.
  Default fonts are system stacks. The full contract is in [design/design.md](design/design.md).
- **Rationale:** adopters can restyle a prebuilt bundle without a build step, which embedded and
  static hosts need. Custom properties inherit through shadow roots, so the 1.0.0 in-app element can
  reuse them. Nothing is added to the bundle budget or the dependency list. Building the primitives
  once, before W2, keeps seven parallel lanes from producing seven interfaces.
- **Alternatives considered:** a utility CSS framework or component library adds a build-time or
  runtime dependency for markup that native elements already cover. CSS-in-JS adds runtime cost and
  can conflict with the page's content security policy. Per-lane styling cannot stay consistent
  across disjoint owners. Loading fonts from a font CDN breaks FR-037.
- **Unresolved:** how hosts deliver overrides is [G-09](plan.md#open-decision-and-approval-gates).

## Phase 0 closure

Technical implementation choices are resolved above, subject to the concrete F01 compatibility
checks. G-01 through G-06 and G-09 are intentionally unchosen product decisions; G-07 and G-08 require the
user's G1 review before they can authorize conflicting behavior or extra work. This is a gated
design proposal, not a declaration that every implementation/release gate has passed.
