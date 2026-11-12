# Implementation Plan: Headless sessions for tests and agents

**Branch**: `worktree/inspector-mcp-for-agents-326ea2` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/018-agent-mcp/spec.md`, accepted by the maintainer on 2026-11-12.

## Summary

Run the framework-free core in Node as a headless session, and put three thin surfaces on it: a test library
(`agui-inspector/testing`), a one-shot command (`agui-inspector run`) and an MCP server (`agui-inspector mcp`, standard
input and output). The session is `createRuntime` with its own store, a policy whose origin is the target, a `fetch`
that adds the developer's headers, a wait until idle, a headless A2UI v0.9 catalog built from `@a2ui/web_core`, and the
existing projections and session files. No new dependency: the MCP server speaks JSON-RPC over standard input and output
with a small hand-written loop. Everything compiles to `packages/inspector/lib` and never enters the page bundle.
Milestone 1 is the session, the library and `run`. Milestone 2 is the conformance suite (#83), specified on its own.
Milestone 3 is `mcp`. All three ship in 0.3.0.

## Technical Context

**Language/Version**: TypeScript (strict, `erasableSyntaxOnly`), compiled by `tsc -p packages/inspector/tsconfig.server.json`
to ES modules for Node 24 or newer.

**Primary Dependencies**: existing only: `@ag-ui/client` 1.0.1, `@ag-ui/core` 1.0.1, `@ag-ui/proto` 1.0.1,
`@a2ui/web_core` 0.12.0. Node built-ins (`node:readline`, `node:fs`, `node:assert`, `node:util`). No MCP SDK
([research.md](research.md), R6).

**Storage**: none. Sessions live in memory. Files are written only when the caller asks (`save`, `--out`).

**Testing**: `node --test` through `npm run test:unit` against `examples/reference-agent` over real HTTP
(`createInteractiveServer`, `examples/reference-agent/server.ts`). One end-to-end check that imports a headless session
file into the page (Playwright).

**Target Platform**: Node 24 or newer on the developer's machine and in CI.

**Project Type**: library entry plus two commands of the existing CLI, in the existing npm package.

**Performance Goals**: a headless run against the reference agent takes at most one second longer than the scenario
takes to stream (SC-006). A 5,000-frame session reads and saves without paging problems.

**Constraints**: loopback or explicit targets only; no listening socket; no telemetry; header values never in any output
(FR-041); raw frames byte for byte (FR-008); nothing new in the page bundle; no new dependency.

**Scale/Scope**: one target per session, several sessions per process, one conversation thread per session.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle or rule | Before design | After design |
| --- | --- | --- |
| I. The wire comes first | Same recorder, frame reader and session format as the page | Pass. The session uses `createRuntime` unchanged; `sendRaw` sends text unchanged; parity test against `server.sent()` bytes (FR-009). |
| II. The protocol, not a framework | `@ag-ui/client` for runs, `@a2ui/web_core` for A2UI | Pass. The headless catalog is built from `@a2ui/web_core`'s own component definitions (R3). |
| III. Generic core, application presets | No server-specific code | Pass. Presets and plugins are not used headless; nothing in core branches on headless. |
| IV. Local-only operation and credential privacy | Needs three readings confirmed | Pass with the readings below, which the maintainer confirms by approving this plan. |
| V. Small and auditable | No new dependency | Pass. Hand-written MCP loop instead of the SDK (R6). |
| VI. Every event type has a view | Views unchanged | Pass. Headless files import into the page. |
| One static bundle | New code outside the page | Pass. `src/headless` and the new commands compile to `lib/`; a test reads the page bundle for them (FR-040). |
| Python package without Node | Python package unchanged | Pass. |
| CLI binds localhost, relays unchanged | `run` and `mcp` listen on nothing | Pass. |
| Scope through `ROADMAP.md` | Not listed yet | Pass after this plan adds the 0.3.0 row. |

Readings of principle IV (from [research.md](research.md), section 5), confirmed with the approval of this plan:

1. "CLI mode MUST reach targets through its local proxy" governs the page served by the command. A headless session has
   no page; the process is the client, as the relay is.
2. "Entered tokens MUST be cleared on reload or target change" maps to: headers live as long as the session (library) or
   the process (`run`, `mcp`), and a session's target never changes.
3. "Captured sessions MUST NOT be stored server-side" is not broken by a file that the developer's own process writes on
   their own machine when asked.

"Embedded requests MUST use the host's same-origin authentication" governs the embedded page. A headless session is not
embedded mode and sends headers the developer gives it.

## Project Structure

### Documentation (this feature)

```text
specs/018-agent-mcp/
├── spec.md
├── research.md          # scope history, audit, decisions, plan research (section 8)
├── plan.md              # this file
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── testing-api.md   # agui-inspector/testing
│   ├── run-command.md   # agui-inspector run
│   └── mcp-server.md    # agui-inspector mcp
├── checklists/requirements.md
└── tasks.md             # next step: speckit-tasks
```

### Source Code (repository root)

```text
packages/inspector/
├── src/
│   ├── core/a2ui/*.ts            # changed: relative imports get their .ts extension (10 imports, 5 files), so tsc output runs in Node
│   ├── core/runtime/transport.ts # changed: the network error names no browser when no page is involved
│   ├── headless/                 # new, Node side, never in the page bundle
│   │   ├── session.ts            # openSession, loadSession: runtime + store + policy + header fetch + wait
│   │   ├── a2ui.ts               # headless v0.9 catalog and surface reads, set value, fire action
│   │   ├── assert.ts             # structural assertions (node:assert errors)
│   │   └── index.ts              # the agui-inspector/testing entry
│   └── cli/
│       ├── args.ts               # changed: first positional selects serve (none), run or mcp
│       ├── main.ts / run.ts      # changed: dispatch to the command
│       ├── once.ts               # new: agui-inspector run
│       ├── mcp.ts                # new: tools over sessions
│       └── jsonrpc.ts            # new: newline-delimited JSON-RPC 2.0 over stdio
├── tsconfig.server.json          # changed: include src/headless
├── package.json                  # changed: "./testing" export
└── tests/
    ├── headless/                 # session, a2ui, assertions, parity, header search
    └── cli/                      # run and mcp, header search, exit codes
website/content/docs/
├── tests-and-agents.mdx          # new page (FR-042), listed in meta.json
└── cli.mdx                       # run and mcp
ROADMAP.md, AGENTS.md             # 0.3.0 row; src/headless row in "Where things are"
.changeset/*.md                   # agui-inspector (npm) only
```

**Structure Decision**: a new `src/headless` folder beside `src/server` and `src/cli`, because the session is Node-side
code that both the library and the commands use, and `src/core` must stay free of Node-only and process concerns. The
commands stay in `src/cli`. Nothing is added to `src/core` except the two small fixes above.

## Milestones and slices

Milestone 1 (0.3.0, before #83)

1. Spike: interrupt, tool result and A2UI action round trips over real HTTP in Node against `createInteractiveServer`,
   plus a `tsc` build of `src/headless` that runs from `lib/`. Settles R1 to R4 in code before the rest.
2. Session: open, send, raw, interrupts, tool results, stop, wait, reads, save, load, fixed clock and ids.
3. Headless A2UI: catalog, surfaces, set value, fire action.
4. Assertions and the `./testing` export.
5. `agui-inspector run`, exit codes, header search across outputs.
6. Parity test for every reference scenario; end-to-end import of a headless file into the page.
7. Docs page, `cli.mdx`, AGENTS.md row, changeset.

Milestone 2: #83 on the session, in its own spec.

Milestone 3 (0.3.0)

8. JSON-RPC loop over stdio.
9. Tools, paging and size limits, untrusted-content envelope, several sessions.
10. Scripted MCP client test (no model), header search across tool results, docs.

## Complexity Tracking

No violations to justify.
