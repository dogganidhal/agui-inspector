# Feature Specification: Public demo

**Feature Branch**: `mvp/w4-p00-plan-public-demo`

**Created**: 2026-10-02

**Status**: Draft for review; maintainer product decisions approved 2026-10-02.

**Input**: Deploy a GitHub Pages instance for trying model-free examples or a visitor's own
server without an endpoint approval prompt, and link existing embedding documentation.
Package publishing, tags, releases, JS helpers and CLI are excluded.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Try the inspector without running a server (Priority: P1)

A visitor opens the public demo, chooses a clearly labelled browser-local example, sends a
suggested message and inspects the actual request and streamed response. Examples demonstrate
conversation, interruptions, tools, state, malformed evidence and A2UI surfaces/actions.

**Why this priority**: A public demo is useful only if a new visitor can try it immediately
without credentials, a model, an account or a local server.

**Independent Test**: Open a fresh browser at the demo sub-path, run each example using the
regular inspector controls, compare captured bytes to the reference scenarios, and verify
that no external server is contacted.

**Acceptance Scenarios**:

1. **Given** a fresh supported browser with no existing demo setup, **When** the visitor opens
   the demo, **Then** the page visibly prepares examples, enables them only when ready, and
   permits a first run without a manual reload or deployment action.
2. **Given** ready examples, **When** the visitor selects plain, interrupt, tools, slow, state
   or broken and sends its quick message, **Then** the normal recorder captures the request
   and response; interruption resolve/cancel, all-tool replies, stop, state changes and
   malformed-frame inspection behave as on a real server.
3. **Given** the A2UI example, **When** the visitor edits and submits its form, **Then** the
   action is recorded in a new run and the example returns the corresponding updated surface.
4. **Given** the protocol examples, **When** baseline and run-error are exercised, **Then**
   all 31 supported event types appear as original frames; mixed delimiters, fragmentation
   and invalid evidence remain inspectable without repair.
5. **Given** blocked or unsupported browser-local examples, **When** the page loads, **Then**
   the page reports why examples are unavailable and retains own-server and import/inspection
   functions rather than silently pretending example endpoints work.

### User Story 2 - Inspect my own endpoint on the public page (Priority: P1)

A visitor types an endpoint URL and optionally an in-memory token, then starts a run without
a deployer allowlist or per-endpoint approval prompt. The page explains its network boundary
and browser restrictions; it does not act as a proxy.

**Why this priority**: Many users will use the hosted inspector directly rather than embed it.

**Independent Test**: Use a CORS-permitting HTTPS endpoint not named in deployment configuration,
then a local endpoint addressed as localhost; confirm successful recording and no cookies.
Use forbidden destinations and verify refusal before a target request.

**Acceptance Scenarios**:

1. **Given** the public deployment's explicit visitor-target opt-in, **When** the visitor enters
   a previously unlisted HTTPS endpoint, **Then** the inspector sends the user-started run
   without an approval prompt, with no cookies and no server-side proxy.
2. **Given** a browser-compatible localhost endpoint at an arbitrary port, **When** the visitor
   starts a run, **Then** the same transport records it; CORS or browser local-network failures
   are shown explicitly, never bypassed.
3. **Given** an ordinary hosted or embedded deployment, **When** a profile, agent config or
   endpoint attempts to enable the option, **Then** the fixed startup policy is unchanged;
   the default allowlist behavior and embedded same-origin authentication remain intact.
4. **Given** a public page, **When** the visitor views the footer, **Then** it accurately states
   the HTTPS/local-server boundary, no telemetry and header-recording privacy, rather than
   claiming requests go only to the page's origin.
5. **Given** a target that echoes an entered credential, **When** the run is recorded and
   exported, **Then** target evidence remains unchanged with the sensitive-data warning,
   while inspector-held credentials never enter persisted configuration, recorded headers or
   inspector-generated exports; the token may still be sent in its designated authentication header.

### User Story 3 - Operate the demo and find embedding guidance (Priority: P2)

The maintainer gets a reproducible static demo deployment from main, separate from the
ordinary npm/Python assets. Visitors can follow the demo's link to existing embedding docs.

**Why this priority**: An isolated, maintainable deployment avoids changing integrations
that already work in the 0.1.0 MVP.

**Independent Test**: Build both distributions, inspect artifact contents and limits, preview
the demo under `/agui-inspector/`, and review workflow triggers/permissions without deploying.

**Acceptance Scenarios**:

1. **Given** all W3 prerequisites have merged and Pages has been authorized by the maintainer,
   **When** main changes, **Then** the demo workflow builds validated static artifacts and
   deploys only those artifacts with least-privilege Pages permissions.
2. **Given** an ordinary static/npm/Python build, **When** its assets are inspected, **Then**
   it contains no demo worker, demo examples or worker registration.
3. **Given** the public page under the repository sub-path, **When** the visitor selects an
   example or follows the embedding link, **Then** local routes stay under that sub-path and
   the documentation link opens the existing repository embedding guide as explicit navigation.

### Edge Cases

- First visit, existing controller, stale worker, worker installation failure, activation timeout
  and browser storage restrictions must not strand the inspector or issue example POSTs to Pages.
- A stop before or during the held-open slow response preserves partial evidence, closes the
  producer and creates no artificial terminal frame. The same holds for a stop during a paced run,
  in a pause or mid-stream: nothing more is sent afterwards.
- Worker route ownership is exact: unrelated page assets, other repository paths, external URLs
  and visitor endpoints are never replaced, cached or proxied.
- Invalid JSON/missing run identifiers get an inspectable error response, not a successful stream.
- Non-loopback HTTP, URL credentials, unsupported schemes and redirects remain forbidden under
  the visitor-target policy. Browser support for numeric loopback addresses varies; no IPv6
  support is advertised without proof.
- Example configuration is resolved under the Pages sub-path, including preparation routes;
  user-entered URLs and existing normal deployment URL semantics are not silently rewritten.
- A2UI external assets/catalogs remain blocked even with broad HTTPS target connections enabled.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The public demo MUST serve the existing hosted inspector from the repository's
  GitHub Pages sub-path, with no model, backend server or account needed for examples.
- **FR-002**: Browser-local example endpoints MUST supply actual HTTP responses and SSE bytes
  to the unchanged guarded transport, recorder and frame reader; no in-app fake transport,
  synthetic store injection or preloaded recording may substitute for a run.
- **FR-003**: Examples MUST reuse deterministic reference scenarios, with one environment-neutral
  source for behavior shared by browser examples and Node fixtures; existing Node fixture wire
  behavior, routes, status codes and test controls MUST be preserved.
- **FR-004**: Example configuration MUST expose named interactive, A2UI and baseline-protocol
  agents with presets and quick messages covering plain, interrupt, tools, slow, state, broken,
  A2UI actions and all 31 baseline event types.
- **FR-005**: On first load the demo MUST enable example dispatch only after examples are ready,
  without requiring manual reload; readiness/failure MUST be visible and bounded by a 10-second
  activation wait, after which own-server use and inspection remain available.
- **FR-006**: Example handling MUST be confined to exact same-origin routes under the deployment
  sub-path, MUST NOT intercept visitor endpoints or unrelated assets, and MUST NOT persist
  request bodies, credentials, sessions or responses in worker storage.
- **FR-007**: Hosted deployments MUST have an explicit deployer-controlled startup option for
  visitor-selected HTTPS and loopback HTTP endpoints, off by default; embedded mode MUST reject
  this option. Configurations, profiles and typed endpoints MUST NOT enable or widen it.
- **FR-008**: The public deployment MUST enable that option and accept previously unlisted HTTPS
  origins and browser-supported HTTP loopback endpoints on any port without endpoint approval
  prompts. It MUST NOT permit non-loopback HTTP, unsupported schemes, URL credentials or redirects.
  Fixed allowed-origin entries MUST NOT widen this opted-in boundary; invalid combinations fail
  visibly at startup. Normal default-off deployments retain their existing fixed-origin behavior.
  The intended loopback set is localhost, 127.0.0.1 and [::1]; browser limitations MUST be explicit,
  localhost is the documented local-server URL, and [::1] support MUST NOT be claimed without proof.
- **FR-009**: Startup CSP and the guarded transport MUST enforce the same chosen network boundary
  before target traffic. No all-HTTP CSP fallback is permitted for unsupported loopback syntax.
  The page MUST disclose this policy and preserve same-origin-only scripts and no eval.
- **FR-010**: There MUST be no telemetry, analytics, automatic third-party requests, remote example
  services, remote fonts/catalogs or server-side session storage. Visitor actions may initiate
  requests to their selected target and declared preparations/capabilities, not external discovery.
- **FR-011**: Hosted target requests MUST send no cookies; inspector-held credentials MUST remain
  memory-only and clear on target change/reload. Recordings/exports MUST omit headers, retain
  target-supplied bytes unchanged and preserve sensitive-data warnings. Browser CORS, mixed-content
  and local-network permissions MUST be surfaced without circumvention; browser prompts are not
  inspector endpoint-approval prompts.
- **FR-012**: Demo initialization, example assets and service-worker registration MUST be present
  only in a separate demo build; ordinary static assets, npm assets and Python wheels MUST NOT
  contain or register a service worker. The shared inspector app MUST remain the existing app.
- **FR-013**: Both the ordinary bundle and the complete demo asset set MUST remain within the
  existing 2,000,000-byte minified and 600,000-byte gzip budgets, counting every shipped asset.
  Existing 5,000-frame acceptance and responsiveness criteria MUST remain unchanged.
- **FR-014**: A main-only GitHub Actions workflow MUST validate and build the demo, upload its
  artifact and deploy through SHA-pinned Pages actions with minimum job permissions; PRs MUST
  validate but never deploy. Pages settings/authorization and actual deployment are separate gates.
- **FR-015**: The demo MUST visibly link existing embedding documentation and distinguish
  browser-local scripted examples from a visitor's real endpoint without changing the MVP theme.
- **FR-016**: Failure of browser-local examples MUST leave own-server and recording-inspection
  functions usable with a visible explanation, and MUST NOT use a fake-transport fallback.
- **FR-017**: Implementation MUST wait for main after W3 D01/D02/D03 merges, use at most three
  implementation slices with disjoint owned paths and at most one unmerged-parent stacking level.
  Publishing workflows, npm/PyPI publication, tags, releases, JS server helpers and CLI are excluded.
- **FR-018**: Scripted example answers MUST stream the way a model does: a think latency before the
  first event after the run starts, text, reasoning and tool-call arguments as many small deltas at
  token-like intervals, and short pauses before a new step, a tool result and a state or surface
  update. One environment-neutral pacing layer MUST apply this where the example adapter serves a
  response, so a scenario needs no edits and a later scenario is paced automatically. Pacing MUST be
  deterministic (no random source), MUST keep event types and order and the text each delta stream
  joins to, MUST leave byte-exact wire fixtures (baseline, run-error, malformed frames and
  fragments) as produced, and MUST let Stop cancel promptly. Node fixture servers MUST answer at wire
  speed unless a test opts in.

### Key Entities

- **Hosting policy**: Startup-only deployer selection of embedded/hosted mode, fixed allowed
  origins and the explicit hosted visitor-target option; separate from agent configuration.
- **Example agent**: Named browser-local endpoint, scenario selection, capabilities, preset and
  quick messages; uses the same agent configuration format as real endpoints.
- **Example response**: Status, response type, exact byte sequence/chunks and close/hold behavior
  produced by a shared deterministic scenario, with streamed deltas cut into pieces and a pause
  before each chunk by the pacing layer (FR-018); captured as ordinary request/response evidence.
- **Demo readiness**: Preparing, controlled/ready or unavailable status, with reason and reload guidance;
  transient page state, not credentials or a stored session.
- **Demo artifact**: The shared inspector app plus demo-only bootstrap, worker and configuration;
  distinct from packaged static assets.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a fresh supported browser, the first plain example run succeeds without manual
  reload or an external server, and examples become ready or visibly unavailable within 10 seconds.
- **SC-002**: All six interactive scenarios, interrupt resolve/cancel, all-tool replies, slow stop
  and the A2UI action round trip match reference request/response evidence, as paced; baseline/run-error
  examples collectively retain all 31 original event types.
- **SC-003**: A previously unlisted HTTPS target and a browser-compatible localhost target run
  without inspector approval prompts; forbidden destinations make zero target requests and all
  hosted target requests carry zero cookies.
- **SC-004**: Fresh example-only use causes zero third-party network requests and persists zero
  credentials, request bodies or sessions outside the existing user-controlled export flow.
- **SC-005**: The standard distributions contain zero demo worker/registration assets; both asset
  sets meet the inherited bundle limits and retain the MVP 5,000-frame acceptance.
- **SC-006**: Every example/config/asset route works under `/agui-inspector/`; unsupported examples
  show a reason while own-server use/import remain available, and the embedding link is reachable.
- **SC-007**: A validated main artifact is deployable through the Pages workflow, with zero PR
  deployments or package publications; actual Pages enablement is authorized separately.
- **SC-008**: A plain example run lasts more than half a second and its reply arrives in several
  text deltas; Stop during a paced run releases the worker and no frame arrives afterwards.

## Assumptions

- Maintainer decisions in the dispatch are fixed; the coordinator confirmed the recorded design
  and strict loopback compatibility gate on 2026-10-02, without broad HTTP fallback.
- GitHub Pages supplies static files over HTTPS. Supported example browsers provide service workers
  and readable streaming responses; unsupported browsers retain non-example inspector functions.
- CORS and browser local-network permissions are controlled by the visitor's server/browser.
  "Any server" means any permitted destination, not bypassing server or browser restrictions.
- `http://localhost:<port>` is the documented portable local form. Numeric loopback support
  requires browser proof; Chromium IPv4 is to be re-proven, other browsers checked manually,
  and IPv6 remains an unclaimed compatibility gate.
- Existing static/npm assets and Python embedding already cover self-hosting; this feature adds
  a public-demo companion to 0.1.0, not package publication or a new integration API.
- All implementation slices wait for merged W3; the planning PR itself can be reviewed now.
