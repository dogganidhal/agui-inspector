# Research: Headless sessions for tests and agents

**Feature**: [spec.md](spec.md) | **Date**: 2026-11-11, revised the same day

This file records how the scope was decided: the first question (does an agent need an MCP server?), the maintainer's
wider goal, the independent audit of the design, and the decisions that followed. The plan starts from section 4.

## 1. First question: what would an MCP server add?

The maintainer asked what an agent could do with an MCP server that it cannot already do with the command of feature
005, the launch link of feature 016, session file export and plain HTTP.

| Candidate tool | Without MCP | What MCP adds | Value |
| --- | --- | --- | --- |
| Build a 016 launch link and open it | Agent reads 016's docs, builds the URL, runs `open` | A typed schema that repeats a public format | Low |
| Run against a target, return frames and findings | Nothing outside the page gives the findings | The findings. A command gives them as well to an agent with a shell | High for the capability |
| Read the session the developer just recorded | Export session, then read the file | Reading the live page session, which needs a page-to-process channel and an amendment to principle IV | Low, high cost |
| Send a raw request | `curl` | Nothing, unless it also records and checks, which is the run above | None |

The first draft concluded: no MCP server, one command for a run without a browser, and a docs page.

## 2. The maintainer's goal

The maintainer then set a wider goal: "Playwright for AG-UI agents". Tests and coding agents load the inspector, drive
a session and make assertions on outcomes such as A2UI surfaces, activities, several messages in one run, interrupts,
tool calls and state. It must work for a project with the embedded inspector, such as a Python server with
`mount_inspector`, run locally and driven by the developer's coding agent.

That changes the first answer in one place. Driving a session step by step (answer an interrupt, fire an A2UI action,
read what changed) needs state that survives between calls: the thread, the pending interrupts, the headers. The runtime
holds that state in memory (`core/runtime/index.ts:245-262`), and nothing restores a runtime from a session file, so a
one-shot command cannot answer an interrupt it did not script in advance. A long-lived process can. For coding agents,
MCP is the usual way to talk to one.

The proposed design had three layers over one engine: the framework-free core run in Node as a headless session, an MCP
server over standard input and output, and a test API for CI. It put MCP before the test API.

## 3. Independent audit

A separate agent (Fable 5.2, read-only, asked to argue against the design) audited it on 2026-11-11. Its findings, with
the evidence it gave. The main code claims were spot-checked in this session.

**Usefulness.** Real but narrower than the pitch. What only this project gives outside a browser: rule findings, raw
frames with timing, and the inspector's client behavior (interrupt and tool continuation, automatic replies). Assertions
on messages, state and tool calls are already possible with `HttpAgent` from `@ag-ui/client` and a subscriber. A2UI is
the weakest part: headless gives the v0.9 data model only. Browser automation on the page with a launch link already
lets an agent drive and inspect, embedded mode included, slowly. The durable audience is tests in CI, which do not need
MCP.

**Order.** The layering is right; the order was wrong. The engine and a typed test API are the product: deterministic,
proven in CI, and needed by the conformance suite (#83). MCP first would shape the engine around tool calls with nothing
proving it in CI. MCP should be a thin adapter, last.

**Feasibility.** Better than assumed.

- The unit tests already run `createRuntime` under `node --test` with an injected `fetch`, interrupts and tool results
  included (`packages/inspector/tests/runtime/support.ts:160-170`, used by seven test files). Checked.
- The auditor bundled `core/runtime`, `store`, `projection` and `session-files` for Node 24.11.1 and ran them with the
  global `fetch` against `examples/reference-agent/server.ts`: five frames, one exchange, a projection of a run and two
  messages, and a session file that round-tripped through `serializeSession` and `parseSession`.
- The globals the core uses exist in Node 24: `crypto.randomUUID`, `performance.now`, `TextDecoder`, `structuredClone`.
  The store falls back to `setTimeout` for scheduling.

Blockers and rough edges it found:

- The A2UI catalog is React code in the views (`views/a2ui/catalog.tsx`), and `createSurfaceSession` requires a catalog
  (`core/a2ui/index.ts:61-68`, checked). A headless v0.9 model needs a catalog without React.
- v0.8 surfaces live inside the React renderer (`views/a2ui/v08.tsx`). No headless v0.8 model without new code.
- `lib/` is built by plain `tsc` (`scripts/build.mjs`), and `src/cli` and `src/server` import nothing from the core
  today. The core uses `.ts` import specifiers and `core/a2ui` uses extensionless ones. The build needs work.
- No "settled" signal: tests poll the exchanges (`support.ts:181-188`). The engine needs a real wait until idle.
- The transport's error text speaks of the browser and CORS (`core/runtime/transport.ts:189-191`), which is wrong in
  Node.
- `resolveTarget` needs a page origin (`transport.ts:126-141`). A headless policy needs a written rule, not a fake
  origin.

Not verified by the audit: an interrupt or A2UI round trip over real HTTP in Node (the Node reference server it used
plays the plain scenario), and whether `@a2ui/web_core` touches the DOM outside what the unit tests exercise.

**Embedded mode through its configuration.** Reading the embedded page's `config.json` to learn agents and presets is
half sound. The parser takes an injected `fetchText` (`core/config/index.ts`), but: the embedded page relies on the
host's cookies (`credentials: 'same-origin'` in the transport) and Node has no cookie jar; the configuration lists
plugin modules that the page imports, and importing them in Node would run remote code while skipping them makes runs
differ from the page; and the transport policy assumes a page origin.

**Risks.** Target-supplied frames, tool arguments and A2UI text go straight into the coding agent's context (prompt
injection). A session can echo a credential, principle IV forbids redaction, and every tool result goes to the agent's
model provider. A header in an MCP client's configuration file sits where the agent can read it. Tests against
model-backed agents flake unless assertions check structure. Two interfaces double docs, tests and error shapes. The
design lacked timeouts, result size limits, paging, concurrency, a plugin story and cookie authentication.

**Verdict.** Build smaller. Milestone 1: a headless session in `lib/` with send, interrupt, tool result, raw input,
reads of frames, findings, projection and state, a wait until idle, and save to a session file; tests against the
reference agent over real HTTP including the interactive scenarios; the one-shot command on top; no new dependency.
Then #83 on the engine. MCP third, as a hand-written adapter over standard input and output, once the engine's API has
survived #83. Defer configuration discovery, headless A2UI beyond v0.9 and the live bridge.

## 4. Decisions

The maintainer accepted the audit's order on 2026-11-11.

| Topic | Decision | Rationale | Alternatives rejected |
| --- | --- | --- | --- |
| MCP | Yes, as milestone 3, a thin layer over the engine | Step-by-step driving needs state kept between calls | MCP first: shapes the engine around tools, unproven in CI. No MCP: agents cannot answer interrupts interactively |
| Order | Engine and test API, then #83, then MCP | The audit's order; the engine is the product | MCP before the test API |
| One-shot command | In milestone 1, over the engine | Cheap; serves shell-only agents and non-JavaScript CI | Leave it out: Python projects would have no CI entry |
| Embedded mode | Target the agent endpoint by URL; headers from environment variables | Works for any server, no change to the Python package | Read `config.json` now: cookie auth and plugins have no answer |
| Engine location | Node, in the npm package's `lib/`; Python package unchanged | The constitution keeps the Python package free of a Node toolchain; porting the core to Python duplicates it | Engine in Python |
| A2UI | v0.9 surface model headless, with a catalog without React | Assertions on surfaces are part of the goal | v0.8 model (needs new code inside the renderer); rendered checks (need a browser) |
| Presets and plugins | Not headless in this feature | Preparation requests and plugin loading raise the policy and remote-code questions above | Import plugins in Node |
| Live page session | Out of scope; session files and 016 links are the hand-off | Needs a page-to-process channel, a CSP change and an amendment | A live bridge now |
| MCP transport code | Decide in the plan for milestone 3: the official SDK with an exact pin and a `dependencies.mdx` row, or a hand-written loop over standard input and output | The audit prefers the hand-written loop for auditability | Settled now without measuring the SDK's dependency tree |

## 5. Constitution check

| Principle | Check |
| --- | --- |
| I. The wire comes first | Same recorder and frame reader as the page; raw input sent unchanged with a finding; FR-009 tests equality with the page. |
| II. The protocol, not a framework | Runs go through `@ag-ui/client`; A2UI through `@a2ui/web_core`. No chat framework. |
| III. Generic core | No server-specific branch. Presets and plugins are left out, not special-cased. |
| IV. Local-only and credential privacy | No listener, no telemetry, requests only to named targets, headers in memory and absent from every output (FR-041). Three readings to state in the plan and confirm with the maintainer: "CLI mode MUST reach targets through its local proxy" is about the page in command mode, and a headless session is itself the client, like the relay; "entered tokens MUST be cleared on reload or target change" maps to the end of the session or process; "captured sessions MUST NOT be stored server-side" is not broken by files the developer's own process writes on their machine. If the maintainer reads any of these differently, an amendment comes first. |
| V. Small and auditable | Milestone 1 adds no dependency. Milestone 3 decides on the SDK with the measured cost. Milestones keep the MCP layer from shipping before the engine has a user. |
| VI. Every event type has a view | Views unchanged. Headless session files import into the page, where every event type has its view. |
| Architecture | New code in `lib/`, never in the page bundle. "Embedded requests MUST use the host's same-origin authentication" is about the embedded page; a headless session is not embedded mode and uses headers. Scope: needs a `ROADMAP.md` row and an issue. |

## 6. Roadmap fit

0.3.0 holds the conformance suite (#83), the Python reference agent (#82), replay (#84) and rule docs (#85). Milestone 1
belongs in 0.3.0 before #83, which then becomes a set of scenarios and expected findings on the engine. Where the MCP
server lands (0.3.0 or the release after) is the one open question in the spec. Either way `ROADMAP.md` gets a row and
an issue.

## 7. Spec 016

The launch link is in pull request #109, not merged on 2026-11-11. Its format: the URL fragment, `name=value` pairs with
the keys `v`, `agent`, `endpoint`, `var.<name>`, `context` and `forwardedProps`. It fills the composer and never sends a
message by itself, in every serving mode including embedded. Spec 018 refers to it only and repeats none of it.

## 8. Plan research (2026-11-12)

Checked in this worktree after `npm ci --ignore-scripts`.

### R1. Where the session lives and how it builds

- **Decision**: `packages/inspector/src/headless`, compiled with the command and the helpers by
  `tsc -p packages/inspector/tsconfig.server.json` into `lib/headless`. The core files it imports compile with it.
- **Rationale**: `tsconfig.server.json` already emits ES modules with `rewriteRelativeImportExtensions`. Ten relative
  imports in five `core/a2ui` files have no extension (`actions.ts`, `catalogs.ts`, `index.ts`, `lifecycle.ts`,
  `operations.ts`); Node cannot resolve them in emitted code, so they get `.ts`, which the rest of the core already
  uses. Nothing in `src/core` or `contracts.ts` imports React or `views/` (searched).
- **Alternatives**: bundle `lib/headless` with esbuild (a second build path for `lib/`); put the session in `src/core`
  (it is Node-side and owns process concerns such as files and timers).

### R2. Policy, headers and errors

- **Decision**: a headless session builds its policy as `{ mode: 'hosted', pageOrigin: <target origin>,
  allowedOrigins: [] }`, so `resolveTarget` allows the target and nothing else, and credentials are omitted. Headers go
  through a `fetch` wrapper that adds them to each request, as the command's relay adds them, so they never enter
  runtime state, the store or the recorder. The transport's network error stops naming the browser when no page is
  involved.
- **Rationale**: no change to `TransportPolicy` or `DeploymentMode`; the rule "a headless session's origin is its
  target's origin" is one line and testable. `setAuth` takes one header, and the command already accepts several per
  target.
- **Alternatives**: a third `DeploymentMode` (touches contracts and every mode check); `setAuth` per header (one only).

### R3. Headless A2UI v0.9

- **Decision**: a catalog built with `@a2ui/web_core`'s `Catalog` class from the basic catalog's component definitions
  (`TextApi`, `ButtonApi` and the others in `@a2ui/web_core/v0_9/basic_catalog`), with the same catalog ids and aliases
  as the page. Reads come from the surface model. Actions go through the surface model's `dispatchAction`, so an action
  is built the way the renderer builds it, then through `toA2uiAction` and `runtime.sendA2uiAction`.
- **Evidence**: `@a2ui/web_core/v0_9/basic_catalog` loads in Node 24 (a probe listed 18 components). `dispatchAction` is
  declared in `state/surface-model.d.ts` and `resolution/component-context.d.ts`. The basic catalog's components import
  Lit, which loaded in Node without a DOM in the probe; the spike confirms that rendering is never triggered.
- **Alternatives**: the page's React catalog (pulls React into `lib/`); a hand-made list of component names (would drift
  from the package's schemas).

### R4. Waiting until idle

- **Decision**: every action resolves when `runtime.send` (or the interrupt, tool result or action call) has resolved,
  which already covers automatic continuations, and then when `getState().capturing` is false, observed through
  `subscribe`. A time limit always applies (default 60 seconds); on expiry the session calls `runtime.stop()`, so capture
  ends `user-stopped`, and the step reports `timedOut: true`.
- **Rationale**: no polling, and the recorder's own end marker decides.

### R5. Command line

- **Decision**: the first positional argument selects the command: none serves the page as today, `run` runs once, `mcp`
  starts the MCP server. `test` and `replay` stay reserved for #83 and #84. Target and header parsing is shared.
- **Exit codes for `run`**: 0 no findings, 1 could not complete the run, 2 wrong arguments, 3 findings. 1 and 2 keep
  their meaning from feature 005.

### R6. MCP without the SDK

- **Decision**: a hand-written loop of newline-delimited JSON-RPC 2.0 over standard input and output. It handles
  `initialize`, `notifications/initialized`, `ping`, `tools/list` and `tools/call`, answers anything else with "method
  not found", and writes nothing but JSON-RPC to standard output. Protocol versions: it answers with the client's
  requested version when it supports it, otherwise with its latest supported one.
- **Rationale**: the server needs five methods. A loop of that size is easier to audit than a dependency tree, and the
  audit recommended it. No row in `dependencies.mdx` is needed.
- **Alternatives**: the official SDK, with an exact pin and a `dependencies.mdx` row. Reconsider if the server later
  needs resources, prompts, sampling or an HTTP transport.

### R7. Untrusted target content in tool results

- **Decision**: each tool result has two content blocks: the tool's own short text, then the data as JSON under a fixed
  heading that says it comes from the target and is not an instruction. The same data goes in `structuredContent`.
  Strings from the target are never put into the first block.
- **Rationale**: an agent can tell the server's own words from the target's. It does not stop injection; the docs page
  says so.

### R8. Tests

- **Decision**: unit tests run sessions against `createInteractiveServer` over real HTTP (interrupts, tool calls,
  A2UI, never-finishing streams, credential echo). Parity: the frames a session records equal `server.sent()` bytes, and
  findings match the expectations already in `examples/reference-agent/rule-fixtures.ts`. Header search: a synthetic
  value passed as a header is searched in every file written, standard output and error, and every tool result. One
  Playwright test imports a headless file into the page.
