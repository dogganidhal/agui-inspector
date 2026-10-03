<!--
Sync Impact Report
Version: 1.1.0 -> 1.2.0 (MINOR narrow exception to principle I).
Approval: project maintainer, 2026-10-03 (pull request #58 merged after the maintainer approved the exception).
Modified principle: I. The wire comes first (the protocol client's stream).
Affected sections: principle I; MVP FR-009; docs/inspection.md; docs/dependencies.md.
Added/removed sections: none.
Rationale: the pinned @ag-ui/client cuts events on two LF only, so a valid CRLF or CR stream fails in it and
the next request loses the assistant reply and the state (issue #49). Principle I allows the client's own
copy of an event stream to have its CRLF and CR line endings rewritten as LF. Nothing else may differ.
Compatibility impact: recorded bytes, frames, arrival order and findings unchanged; the exception ends when
the pinned client is bumped to the first release that contains ag-ui-protocol/ag-ui#2939.
Dependent artifacts: MVP FR-009; docs/inspection.md; docs/dependencies.md.
Historical MVP design/plan/contracts are not rewritten.
Follow-up: remove the exception and delete the copy (runtime/line-endings.ts) on that bump.
Deferred governance placeholders: none.
-->
# agui-inspector Constitution

## Core Principles

### I. The wire comes first

The inspector MUST keep every received frame in arrival order with raw content and timing,
including non-JSON frames, schema failures, and sequence violations. Validation MUST flag issues on
the relevant frame or run without dropping, repairing, reordering, or stopping capture. Recording
MUST leave the protocol client's stream untouched. The one exception is temporary: the client's own
copy of an event stream may have its CRLF and bare CR line endings rewritten as LF, because the pinned
`@ag-ui/client` cannot frame them. Nothing else about that copy may differ, and the recorded branch
keeps the bytes as received. The exception ends when the pinned client frames every line ending
itself. Raw evidence MUST stay distinguishable from
client-derived state and expanded chunk events. The raw request editor MUST flag invalid run inputs
and allow the supplied JSON to be sent unchanged.

### II. The protocol, not a framework

Protocol schemas and client behavior MUST use `@ag-ui/core` and `@ag-ui/client` against the AG-UI
baseline in the applicable feature specification. A2UI rendering MUST use A2UI's own renderer
packages, including `@a2ui/react` and `@a2ui/web_core`, for the release's supported versions. Chat
frameworks MUST NOT sit between the wire and inspection views. The recorder, frame reader, rule
checks, session store, and presets MUST stay framework-free TypeScript, separate from React views.

### III. Generic core, application presets

The core MUST NOT encode server-specific routes, identities, session preparation, or message
conventions. Application-specific behavior MUST use configuration and presets: variables,
preparation requests, forwarded properties, and full-transcript or turn-only messages. Preparation
requests MUST run in declared order, be recorded as exchanges, and explicitly fail the run on error.
Application-specific extensions beyond presets MUST follow the specified plugin scope and MUST NOT
add server-specific core branches.

### IV. Local-only operation and credential privacy

The inspector MUST NOT send telemetry, analytics, or third-party requests on its own initiative.
Page requests MUST go only to configured targets and the page's own origin for assets and
configuration by default. A hosted deployment MAY explicitly opt in, through deployer-controlled
startup configuration, to visitor-selected targets at any HTTPS origin and HTTP loopback origins
(localhost, 127.0.0.1, [::1], any port), subject to browser enforcement. This option MUST be off by
default, MUST NOT apply in embedded mode, and MUST be visibly disclosed on the page. Agent
configuration, imported profiles and target input MUST NOT enable it or widen startup policy.
The opt-in authorizes target requests initiated by visitor actions, including declared preparation
and capability requests; it MUST NOT authorize automatic external discovery or asset loads.
Scripts MUST remain same-origin only, dynamic code evaluation MUST remain forbidden, and hosted
target requests MUST NOT send cookies. Browser CORS, mixed-content and local-network restrictions
MUST NOT be bypassed; unsupported loopback forms MUST be documented without claiming support.
CLI mode MUST reach targets through its local proxy. Authentication credentials MUST stay in
memory only and MUST NOT be written by the inspector into configuration files, browser storage, recordings,
inspection views, logs, or exports. This guarantee covers credentials the inspector holds.
Bytes supplied by a target are evidence under principle I and MUST be retained unchanged, even
when they echo an entered credential; no redaction is permitted. Entered tokens
MUST be cleared on reload or target change. The recorder MUST NOT read headers; session exports
MUST contain no headers. Session exports MUST warn that raw frames may contain sensitive data.
Captured sessions MUST NOT be stored server-side.

### V. Small and auditable

Runtime dependencies MUST meet demonstrated needs, use exact version pins, and resolve through
committed lockfiles. Each addition MUST document its purpose and why existing dependencies or
platform capabilities do not suffice. Installation MUST NOT run package lifecycle scripts. Changes
MUST use the simplest design meeting approved requirements and MUST NOT include speculative
abstractions or unrelated functionality.

### VI. Every event type has a view

Every event type in the supported protocol baseline MUST have a frames-list view and, where the
applicable feature specification requires, a conversation view. Original chunk events MUST remain
visible alongside their expansions. Encrypted reasoning MUST NOT be decoded. Each supported type
MUST have a dedicated fixture test. Adding protocol support MUST update the corresponding views,
fixtures, and documentation together. Unrecognized or invalid frames MUST remain available for
raw inspection.

## Architecture and distribution constraints

- All modes MUST share one static bundle. Embedded mode is the primary integration. Python packages
  MUST ship the prebuilt bundle without requiring a Node toolchain on the host.
- Implementation MUST use strict TypeScript, React views, esbuild, `node --test`, and Playwright.
  Python packages MUST support Python 3.10 or newer, build with uv, and keep Starlette optional.
- Embedded helpers MUST mount nothing unless explicitly enabled. When enabled, they MUST log a
  startup warning with the mount path. The page's content security policy MUST allow scripts only
  from its own origin and forbid `eval`. Hosted mode MUST restrict `connect-src` to configured targets by
  default, or to the explicitly opted-in HTTPS and HTTP loopback boundary defined in principle IV.
  Browser limitations MUST NOT be worked around by permitting all HTTP destinations.
- Embedded requests MUST use the host's same-origin authentication; other modes MUST NOT send
  cookies. The CLI MUST bind only to localhost, proxy only to explicitly configured targets, and pass
  target bytes unchanged. In-app mode MUST observe the host's `AbstractAgent` without requests of
  its own.
- Release scope MUST follow `ROADMAP.md` and accepted feature specifications under `specs/`.
  Product 0.1.0 is the HTTP/SSE MVP with hosted and Python embedded modes plus the static bundle.
  Adding CLI, in-app mode, JS server helpers, other transports, plugins, or conformance tooling to
  the MVP MUST require an explicit scope revision. Open product decisions are tracked in `ROADMAP.md`.

## Development workflow and quality gates

- Implementation work MUST trace to a reviewed specification and the intended release's acceptance
  criteria. Plans MUST assess constitution compliance before implementation; tasks MUST cover
  behavior, validation, and directly related documentation. Requirement conflicts MUST be resolved
  explicitly.
- PR CI MUST include type checks, unit tests, builds, bundle-budget checks, end-to-end tests, and
  Python tests as corresponding packages are introduced. Missing validation infrastructure MUST be
  tracked as implementation work and MUST NOT count as a passing check.
- Behavior changes MUST have regression coverage. End-to-end scenarios MUST use a scripted,
  model-free reference agent. Tests MUST cover malformed and fragmented streams, missing terminal
  events, interrupt resolution and cancellation, client tool results, A2UI actions, profile
  switches, invalid raw inputs, and session export/import round trips. End-to-end tests MUST check
  the network allowlist; export tests MUST check header absence.
- Product 0.1.0 acceptance MUST test 5,000-frame sessions and enforce production bundle limits of
  2 MB minified and 600 KB gzipped. Product 1.0.0 acceptance MUST test 50,000-frame sessions, load the
  A2UI renderer on demand, and pass a WCAG 2.2 AA accessibility audit with keyboard navigation.
  Plans MUST define measurable responsiveness criteria for both workloads.
- Product 1.0.0 MUST run reference scenarios in all four modes and test every conformance rule with
  a violating case against Python and TypeScript reference agents. Config, session, profile, and
  plugin API formats MUST be published as version 1 with the specified JSON Schemas. Later
  incompatible format changes MUST wait for a product major release; pre-1.0 changes MUST document
  migration in the changelog.
- Releases MUST use semantic versioning and CI builds from tags, with npm provenance and PyPI
  trusted publishing.

## Governance

This constitution governs engineering decisions and review. `ROADMAP.md` tracks release scope,
status, and open decisions. Accepted feature specifications under `specs/` define product behavior
and acceptance criteria within these rules. `docs/reference/product-brief.md` preserves historical
source material and planning input; accepted feature specifications and approved amendments take
precedence over historical descriptions. Conflicting specifications, plans, tasks, or implementations
MUST be corrected or preceded by an approved amendment; silent exceptions are prohibited.

Amendments MUST document rationale, affected principles or sections, compatibility impact, and
migration or follow-up work. Project-maintainer approval MUST precede adoption. Amendments MUST
update version and last-amended date, preserve the ratification date, and check dependent artifacts
for conflicts. The constitution command MUST NOT change templates, commands, or application files.

Constitution versions MUST follow semantic versioning independently of product versions: MAJOR for
principle removals or backward-incompatible governance redefinitions; MINOR for new principles or
sections, or materially expanded guidance; PATCH for clarifications and other non-semantic
corrections. Constitution 1.0.0 was the initial adoption.

Every implementation plan and PR review MUST record a constitution compliance assessment. Before
approval, reviewers MUST check applicable protocol, privacy, dependency, coverage, and release gates
and identify unresolved violations. Requirement changes MUST update acceptance criteria and
documentation in the same change.

**Version**: 1.2.0 | **Ratified**: 2026-10-01 | **Last Amended**: 2026-10-03
