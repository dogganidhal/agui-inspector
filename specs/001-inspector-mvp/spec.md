# Feature Specification: agui-inspector 0.1.0 MVP

**Feature Branch**: `ratify-project-constitution`

**Created**: 2026-10-02

**Status**: Draft

**Input**: Create the 0.1.0 MVP specification from the original product brief, using its section 10
as the scope boundary. Preserve all nine MVP acceptance criteria, trace requirements to their
sources, and leave architecture and tooling for the implementation plan.

**Source**: [Original product brief](../../docs/reference/product-brief.md), sections 1-10 and the
release boundaries in sections 11-13. This specification and its recorded clarifications define
the current MVP requirements. The [roadmap](../../ROADMAP.md) tracks releases; the
[constitution](../../.specify/memory/constitution.md) governs this feature.

This feature lets agent-server developers connect to an AG-UI endpoint, inspect its traffic, and
drive conversations through interrupts, client tool calls, and A2UI actions. It covers the hosted
page, Python embedding, and distributable static assets. All stories below are required for 0.1.0;
their priorities set implementation order, not optional release scope.

## Clarifications

### Session 2026-10-02

- Q: Which profile lifecycle belongs in 0.1.0? A: Browser persistence and JSON profile import/export
  are both included. Authentication credentials remain memory-only.
- Q: What defines responsiveness with 5,000 frames? A: At least 95% of filter changes and frame
  expansions must finish visibly within 200 ms during capture. The implementation plan fixes the
  benchmark browser, hardware, event mix, payload sizes, and arrival rate before implementation.
- Q: Must adopters be able to brand the inspector? A: Yes. Views take their colors, radii, spacing,
  and fonts from documented theme properties that a host can override without rebuilding (FR-041).
  How a host supplies its overrides is not decided for 0.1.0; the roadmap tracks it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect a live run (Priority: P1)

An agent-server developer connects to an endpoint and sees the requests, received frames,
conversation, and current state. Invalid traffic remains available for debugging.

**Why this priority**: Seeing the actual exchange is the inspector's primary use.

**Independent Test**: Point the hosted inspector at a scripted endpoint that permits its origin.
Exercise valid and invalid streams without presets, embedding, or imported recordings.

**Acceptance Scenarios**:

1. **Given** an accessible endpoint, **When** a developer starts a run, **Then** the inspector shows
   the exchange, every frame in arrival order with its timing and schema verdict, and the transcript.
2. **Given** non-JSON frames, unknown events, schema failures, or sequence violations, **When** the
   stream continues, **Then** the inspector keeps the original data, flags the relevant frame or
   run, and continues recording.
3. **Given** fixtures covering all 31 event types in the supported baseline, **When** they are
   received, **Then** every type has its required frame view and conversation presentation.
4. **Given** several recorded exchanges, **When** the developer filters by type, content, or issue,
   expands raw data, or copies an exchange's frames, **Then** the displayed and copied data matches
   the recording; exchanges appear newest first with the newest expanded initially.
5. **Given** a run containing 5,000 frames, **When** the developer uses inspection controls during
   capture, **Then** all frames remain available and interaction performance meets SC-009.
6. **Given** an active conversation, **When** the developer stops the run or starts a new thread,
   **Then** the requested control takes effect without inventing or rewriting received events.

---

### User Story 2 - Open the inspector beside an agent (Priority: P1)

A server developer enables the inspector in an existing application, opens its page, and uses the
host's configured agents and authentication. Other server stacks can serve the same static assets.

**Why this priority**: Embedded use is the primary distribution mode.

**Independent Test**: Mount the prebuilt distribution in minimal supported host applications with a
scripted agent. Check routes, configuration, authentication, and disabled behavior without a hosted
service or advanced conversation scenarios.

**Acceptance Scenarios**:

1. **Given** a supported host with embedding enabled, **When** its developer opens `/agui-inspector`,
   **Then** the page lists the configured agents and runs them on the host's origin and authentication.
2. **Given** embedding is disabled, **When** the host starts, **Then** no inspector routes are mounted.
   **Given** it is enabled, **When** the host starts, **Then** a warning identifies the mount path.
3. **Given** the Python distribution is installed on a host without a Node toolchain, **When** the
   inspector is enabled, **Then** its bundled assets are ready to serve without a frontend build.
4. **Given** another server can serve static files and adjacent configuration, **When** it serves the
   npm distribution's assets, **Then** the same inspector can connect to its configured agent.
5. **Given** a host stylesheet that overrides only the documented theme properties, **When** its
   developer opens the inspector in light or dark mode, **Then** every view uses the overridden
   colors, radii, spacing, and fonts.

---

### User Story 3 - Continue interactive conversations (Priority: P2)

A developer answers an interrupt or client tool call, or acts on an A2UI surface, and inspects the
next run to verify that the interaction reached the agent.

**Why this priority**: These round trips exercise protocol behavior that a read-only event log cannot.

**Independent Test**: Drive scripted interrupt, tool-call, and surface scenarios with a default
connection. Inspect continuation inputs without presets, embedding, or session import.

**Acceptance Scenarios**:

1. **Given** a run ends with interrupts, **When** the developer resolves or cancels them in place,
   **Then** the next run carries the answers through the protocol's resume mechanism only after all
   interrupts have answers.
2. **Given** a run leaves pending client tool calls, **When** the developer supplies every result,
   **Then** the next run includes the corresponding tool messages; no continuation starts early.
3. **Given** a tool call streams its arguments, **When** argument fragments arrive and the call
   completes, **Then** arguments are shown during streaming, parsed once complete, and shown with
   the result when received.
4. **Given** an enabled A2UI v0.9 surface, **When** the developer activates a control, **Then** a new
   run carries the documented action envelope and the recording exposes that input.

---

### User Story 4 - Configure agents and client behavior (Priority: P2)

A developer loads agent configuration, supplies application-specific preset values, and changes
the client profile to exercise the server's behavior.

**Why this priority**: Presets let developers inspect different applications without changing the core.

**Independent Test**: Use an endpoint that records preparation requests and run inputs. Compare the
observed inputs against preset values and profile settings without interactive replies or embedding.

**Acceptance Scenarios**:

1. **Given** a configuration with several agents, **When** the developer selects one, **Then** its
   endpoint, declared capabilities, and optional preset are used.
2. **Given** text and JSON preset variables, **When** a run begins, **Then** substitutions preserve
   JSON types for whole-value replacements and produce the configured preparation requests and
   forwarded properties.
3. **Given** ordered preparation requests, **When** a run begins, **Then** each preparation exchange
   is recorded in order. If one fails, the run fails visibly and the agent run request is not sent.
4. **Given** a client profile, **When** each setting changes, **Then** the next conversation run's
   recorded input reflects the selected protocol version, tools, context, A2UI options, message
   mode, and forwarded properties.
5. **Given** saved profile settings and an entered authentication token, **When** the page reloads,
   **Then** the profile settings remain available and the token has been cleared.
6. **Given** an exported profile, **When** it is imported, **Then** its settings are restored and
   govern the next conversation run; authentication credentials are absent from the file and
   browser-persisted profile.

---

### User Story 5 - Inspect state, send raw inputs, and exchange recordings (Priority: P2)

A developer examines state changes, sends a deliberately invalid run input, and exports a session
that can later be opened for inspection.

**Why this priority**: Negative inputs and portable recordings make failures reproducible.

**Independent Test**: Use a recorded session and an endpoint with known valid and invalid-input
responses. Check state, raw submission, and export/import without presets or interactive replies.

**Acceptance Scenarios**:

1. **Given** state snapshots and deltas, **When** they arrive, **Then** the current state and each
   delta's operations are inspectable, and the current state is carried into the next conversation
   run.
2. **Given** valid JSON that fails the run-input schema, **When** the developer sends it from the raw
   editor, **Then** it is flagged and sent unchanged outside the conversation; the server's answer
   appears in inspection, including error responses.
3. **Given** a recorded session, **When** it is exported and imported again, **Then** the same
   exchanges, frames, and run inputs are inspectable without headers or requests triggered by import.
   Export warns that payloads can contain sensitive data.
4. **Given** an invalid session file, **When** import is attempted, **Then** a visible error replaces
   any claim of successful import.

---

### Edge Cases

- Network chunks split event boundaries, multiple events arrive together, or message streams
  interleave: retain the received event order and content.
- A stream contains malformed JSON, an unknown type, an invalid event, or an invalid sequence:
  preserve the raw frame and keep validation findings separate from received data.
- A stream ends or the user stops it before a terminal event: keep the partial recording, distinguish
  transport or user-stop status from observed protocol outcomes, and do not fabricate terminal frames.
- Several interrupts or tool calls await replies: do not continue after only a subset is answered.
- A target changes after a token was entered: clear that token before using the new target.
- CORS, secure-context rules, or private-network checks block a hosted connection: expose the failure
  without introducing a proxy or bypass.
- A preset JSON value fills an entire template string: insert JSON, not its string representation.
- Preparation fails before a continuation: preserve the preparation exchanges and do not send that
  continuation's run input.
- Capabilities contradict observed events: show both in the MVP; capability-consistency diagnostics
  remain outside this release.
- A2UI rendering is disabled or an activity has another type: keep its data inspectable as JSON.
- Encrypted reasoning arrives: expose metadata and the raw value without decoding it.
- Malformed recordings produce import errors. Valid recordings may contain sensitive payloads;
  importing them must not execute recorded requests.

## Requirements *(mandatory)*

### Functional Requirements

Source numbers below refer to sections of the [original product brief](../../docs/reference/product-brief.md).
Its section 10 supplies the release baseline; the recorded clarifications resolve its ambiguities.

#### Availability and connection

- **FR-001**: One static bundle MUST support hosted use, embedding in Starlette and FastAPI, and
  serving from other servers. Embedded use MUST remain primary. The Python package MUST ship
  prebuilt assets requiring no Node toolchain; the npm package MUST expose the static assets and
  their location. (Sources: 5, 10.)
- **FR-002**: Embedded helpers MUST mount nothing unless explicitly enabled. The default page path
  MUST be `/agui-inspector`, with adjacent configuration. Enabling the inspector MUST produce a
  startup warning identifying its mount path. (Sources: 5, 6, 9.)
- **FR-003**: Users MUST be able to select a configured agent or enter an endpoint URL. Embedded
  endpoint URLs MAY be relative to the page's origin; hosted endpoint URLs MUST be absolute.
  (Sources: 6, 8.1.)
- **FR-004**: Users MUST be able to supply an in-memory token under a header name they choose,
  defaulting to `Authorization`. Reloading or changing targets MUST clear it. Embedded requests
  MUST use the host's same-origin authentication; hosted target requests MUST send no cookies.
  (Sources: 5, 8.1, 9.)
- **FR-005**: Hosted runs MUST connect directly from the browser to the target over HTTP/SSE,
  subject to the browser's CORS, secure-context, and private-network restrictions. Connection
  failures MUST be visible; the MVP MUST NOT introduce a proxy or bypass. (Sources: 5, 10.)
- **FR-006**: The page MUST read version-0 JSON configuration beside the embedded bundle or from a
  file or permitted URL loaded in hosted mode. Each agent MUST require only an id and endpoint URL;
  name, capabilities, and preset remain optional. Configuration MUST NOT contain credentials.
  (Sources: 6, 10.)

#### Recording and inspection

- **FR-007**: Every preparation request, conversation run request, and raw submission MUST be
  inspectable as an exchange with method, path, request body, response status when available, and
  duration. Server replies, including error responses, MUST remain available for inspection.
  The recorder MUST NOT read headers. (Sources: 7, 8.4, 10 acceptance criteria 1 and 6.)
- **FR-008**: Recording MUST retain every received frame unchanged and in arrival order, with raw
  text, offset from the request's start, type when identifiable, summary, and validation findings.
  Non-JSON and schema-invalid frames MUST remain inspectable. (Sources: 2, 7, 8.3.)
- **FR-009**: Each frame MUST be checked for valid JSON; parsed values MUST be checked against the
  protocol schema. Client-reported sequence violations MUST be attached to the run in the MVP.
  A stream ending without `RUN_FINISHED` or `RUN_ERROR` MUST receive a terminal-event finding.
  Validation MUST NOT stop capture, repair received data, or alter the stream delivered to the
  protocol client. (Sources: 2, 7, 10.)
- **FR-010**: Exchanges MUST appear newest first, initially expanding the newest. Users MUST be
  able to filter frames by type, content, and issues, inspect raw content, and copy an exchange's
  frames as JSON. (Source: 8.4.)
- **FR-011**: Users MUST be able to start a new thread, stop an active run, and send preset-provided
  one-click messages. These controls MUST NOT manufacture received protocol events. (Sources: 2, 8.2.)

#### Event and conversation views

- **FR-012**: All 31 event types in the AG-UI 1.x baseline enumerated in section 4 MUST have
  frames-list views. Conversation views MUST follow section 8.3's mapping, including uncommon
  event types. Every supported type MUST have a dedicated unit-test fixture.
  (Sources: 2, 4, 8.3, 10.)
- **FR-013**: The transcript MUST show user, assistant, tool, reasoning, activity, system, and
  developer entries. Text MUST appear as sent; optional Markdown rendering of conversation text
  is outside the MVP. (Sources: 8.2, 10.)
- **FR-014**: Run views MUST show run and parent identifiers, boundaries, durations, and outcomes:
  success with result and pending tool calls, interruption, cancellation, or error. (Sources: 4, 8.3.)
- **FR-015**: Steps MUST appear as collapsible groups with inspectable durations. (Source: 8.3.)
- **FR-016**: Text, reasoning, and tool arguments MUST appear as they stream. Tool arguments MUST
  be parsed once complete, with results shown when received. Individual deltas MUST remain
  inspectable. (Sources: 8.2, 8.3.)
- **FR-017**: Original chunk events MUST remain visible alongside their expanded events, clearly
  distinguished from client-derived data. (Source: 8.3.)
- **FR-018**: Encrypted reasoning MUST show subtype, entity, and size metadata, with its raw value
  available for inspection. It MUST NOT be decoded. (Source: 8.3.)
- **FR-019**: State snapshots and deltas MUST update the inspectable current state and expose delta
  operations. Message snapshots MUST replace the transcript with a visible marker and make added
  and removed messages inspectable. Historical state navigation is outside the MVP. (Sources: 8.3, 10.)
- **FR-020**: Activity views MUST update with received deltas. Enabled A2UI v0.9 surfaces MUST
  render; other activity types and surfaces with rendering disabled MUST remain inspectable as
  JSON. (Sources: 4, 8.3, 8.5, 10.)
- **FR-021**: Subagent starts, finishes, and errors MUST appear as nested markers under the parent
  run, linked through parent and subagent run identifiers. Dedicated lanes are outside the MVP.
  (Sources: 8.3, 10.)
- **FR-022**: Custom and raw events MUST show their name or source and value in the conversation
  and inspection views. (Source: 8.3.)

#### Replies, presets, and profiles

- **FR-023**: Interrupts MUST have in-place Resolve and Cancel controls and a payload editor
  prefilled from a supplied response schema. The next run MUST carry resume answers only after
  every interrupt has an answer. (Sources: 4, 8.2.)
- **FR-024**: Pending client tool calls MUST have manual result editors. The next run MUST start
  only after every pending call has a result and MUST include the corresponding tool messages.
  Automatic or scripted answers are outside the MVP. (Sources: 4, 8.2, 8.5, 10.)
- **FR-025**: An A2UI action MUST start a run with the documented action envelope, preserving its
  name, surface id, source component id, context, and timestamp. (Sources: 4, 8.2.)
- **FR-026**: Presets MUST support user-editable text or JSON variables with defaults and built-in
  thread id, run id, and UUID variables. String templates MUST substitute their values; a JSON
  variable occupying a whole string value MUST be inserted as JSON. (Source: 6.)
- **FR-027**: Presets MUST support full-transcript and current-turn-only message modes, defaulting
  to full transcript, and merge configured forwarded properties into each conversation run.
  (Source: 6.)
- **FR-028**: Preset preparation requests MUST run in declared order before each conversation run,
  including continuations, and be recorded as exchanges. Any preparation failure MUST visibly fail
  the run without sending its agent request. (Sources: 6, 7.)
- **FR-029**: Agent capabilities MUST be displayed by their eleven documented groups, from inline
  configuration or a configured capabilities URL. Discovery beyond those sources and checks for
  contradictions between declarations and events are outside the MVP. (Sources: 4, 6, 8.5, 10.)
- **FR-030**: The client profile MUST expose protocol version, client tools with their JSON
  Schemas, context entries, A2UI rendering versus JSON-only inspection, optional injection of the
  A2UI rendering tool, message mode, and forwarded properties. Tool replies remain manual.
  (Sources: 8.5, 10.)
- **FR-031**: Each client-profile control MUST change the next conversation run's input as
  described, and that input MUST be inspectable in its recorded exchange. Conversation inputs MUST
  follow the documented run-input contract, including thread/run identifiers, any parent link,
  current state, selected messages, tools, context, forwarded properties, and applicable resume
  answers. (Sources: 4, 8.5, 10.)
- **FR-032**: Users MUST be able to save profile settings in the browser across reloads and
  export/import them as JSON in 0.1.0. Both forms MUST preserve the settings and exclude
  authentication credentials. The format remains pre-stable; version-1 stability is deferred.
  (Sources: 8.5, 11; clarification 2026-10-02.)

#### Raw inputs, recordings, and privacy

- **FR-033**: The raw request editor MUST accept any JSON document, flag run-input schema
  violations without blocking submission, and send the supplied document unchanged outside the
  conversation. The target's reply MUST appear in inspection. (Sources: 8.4, 10.)
- **FR-034**: Sessions MUST export and import their exchanges, frames, and run inputs without
  headers. A same-version round trip MUST preserve the inspectable data, order, and timings.
  Import MUST only open a recording for inspection, not execute its requests. (Sources: 8.4, 10.)
- **FR-035**: Invalid session files MUST produce visible import errors and MUST NOT be presented
  as successfully loaded recordings. (Source: 8.4; assumption A-003.)
- **FR-036**: Authentication credentials MUST remain in memory only and MUST NOT enter
  configuration, recordings, inspection views, logs, or exports. (Sources: 2, 6, 8.1, 9.)
- **FR-037**: The inspector MUST send no telemetry, analytics, or third-party requests. Page
  requests MUST be limited to allowed targets and its own origin for assets and configuration.
  (Sources: 2, 9.)
- **FR-038**: The page MUST apply a content security policy allowing scripts only from its own
  origin and forbidding dynamic code evaluation. Hosted connection restrictions MUST be active at
  startup and limit connections to permitted destinations. (Sources: 5, 9.)
- **FR-039**: Session export MUST warn that raw frames can hold sensitive data. Captured sessions
  MUST NOT be stored server-side. (Sources: 8.4, 9.)
- **FR-040**: Published distributions MUST have verifiable build provenance and follow the
  publishing safeguards in section 9. The implementation plan MUST retain those safeguards.
  (Sources: 9, 12.)

#### Presentation

- **FR-041**: Views MUST take every color, radius, spacing step, and font from documented theme
  properties (CSS custom properties named `--agui-*`), with light and dark defaults that follow the
  browser's color-scheme preference. A stylesheet that overrides only those properties MUST restyle
  every view without rebuilding the bundle. Default fonts MUST be system font stacks or font files
  shipped in the bundle. How hosts supply overrides is an open decision.
  (Source: clarification 2026-10-02; [UI design](design/design.md).)

### Key Entities *(include if feature involves data)*

- **Agent configuration**: Agent id, optional name, endpoint, optional declared capabilities, and
  optional preset. It contains no credentials.
- **Preset**: Editable variables and defaults, preparation requests, forwarded properties,
  message-selection mode, and available quick messages.
- **Client profile**: Selected protocol version, tool declarations, context, A2UI options, and
  message/forwarded-property choices. Its persistence and exchange scope is defined by FR-032.
- **Inspection session**: Related runs, exchanges, and frames that can be inspected or exported.
  It is distinct from application-side sessions prepared by a preset.
- **Run**: Thread, run, and parent identifiers; input; timing; observed outcome; result; pending
  tool calls; and interrupts.
- **Exchange**: An outgoing request, its visible response or transport failure, duration, and
  received frames. It contains no headers.
- **Frame**: Raw received content, arrival position, relative timing, identifiable type, summary,
  and validation findings.
- **Conversation entry**: A role-tagged message, tool call/result, reasoning entry, activity, or
  marker derived from the event stream.
- **Reply or action**: An interrupt answer, tool result, or surface action associated with the
  relevant run and protocol identifiers.
- **State and activity**: The current state or activity content after snapshots and deltas;
  activities include A2UI surfaces.

## Success Criteria *(mandatory)*

### Measurable Outcomes

SC-001 to SC-009 preserve the nine numbered acceptance criteria in the original product brief's
section 10, with the recorded clarifications. SC-010 comes from the 2026-10-02 theming clarification.

- **SC-001**: Against an accessible, origin-permitting streaming endpoint, a developer can start a
  run, inspect every received frame with its offset and schema verdict, and see the transcript.
- **SC-002**: Each supported embedded integration serves `/agui-inspector`, lists configured
  agents, and runs them on the host's origin and authentication. Disabled embedding mounts no routes.
- **SC-003**: All 31 baseline event types have the required frame and conversation views, each
  covered by a dedicated unit-test fixture. A model-free reference agent covers every event family in
  end-to-end scenarios.
- **SC-004**: Reference scenarios complete an interrupt resolution, interrupt cancellation, pending
  tool reply, and A2UI action, with each continuation carrying the required next-run input.
- **SC-005**: Every MVP client-profile switch produces its specified change in the next run input,
  verified through the recording. Profile settings are preserved after reload and JSON export/import,
  with no authentication credentials in persistent data.
- **SC-006**: A schema-invalid JSON run input is flagged, sent unchanged from the raw editor, and
  followed by an inspectable server response.
- **SC-007**: Exporting and importing a session preserves its exchanges, frames, and run inputs,
  including order and timing, with zero headers in the exported file.
- **SC-008**: End-to-end scenarios make zero requests outside permitted targets and the page's own
  origin, emit no telemetry or analytics, and export no headers or authentication credentials.
- **SC-009**: Across the fixed 5,000-frame capture workload, every frame is retained and at least
  95% of filter changes and frame expansions finish visibly within 200 ms. Measure from user input
  until the filtered list or expanded frame content is rendered. The implementation plan MUST fix
  the benchmark browser, hardware, event mix, payload sizes, and arrival rate before implementation.
  The complete production client bundle MUST be at most 2 MB minified and 600 KB gzipped.
- **SC-010**: With only the documented theme properties overridden, every view renders with the
  overrides in light and dark modes, and the default build requests no fonts or other assets from
  outside its own origin.

## Assumptions

- **A-001**: The original brief's section 10 supplies the baseline; this specification and its
  recorded clarifications define accepted MVP scope. The constitution remains binding.
  Priorities do not remove required MVP behavior.
- **A-002**: Raw submissions bypass conversation and preset transformations. The supplied JSON is
  authoritative; presets prepare ordinary conversation runs and their continuations.
- **A-003**: Invalid imports and blocked connections report failure explicitly. They do not produce
  success-shaped empty recordings or bypass browser restrictions.
- **A-004**: Hosted configuration and capabilities URLs must obey the same allowed-target/own-origin
  policy as other requests. Loading a configuration does not grant a third-party network exception.
- **A-005**: Verification uses deterministic, model-free scenarios and synthetic payloads. Test
  framework choices and internal architecture belong in the implementation plan.
- **A-006**: The bundle budget includes the complete shipped client bundle and its renderer.
  Development fixtures and host-package files are not client bundle bytes.
- **A-007**: Public compatibility commitments, including supported hosts, transports, and A2UI v0.9,
  are requirements. Internal libraries, languages, module layout, and build tooling from sections
  7 and 12 must be carried into planning without silently changing existing decisions.

### Deferred scope and dependencies

- CLI/proxy mode, JS server helpers, and the in-app element are not part of 0.1.0.
- Binary and WebSocket transports, push notifications, reconnection, and resumable connections are
  deferred. The hosted MVP depends on a target that satisfies browser access requirements.
- Plugins, capability discovery beyond configured sources, capability-consistency checks, automatic
  replies, the conformance CLI, replay, and the full rule catalogue are deferred.
- Subagent lanes, state history, waterfalls, optional Markdown for conversation text, additional
  A2UI versions, and catalog aliases are deferred.
- Stable version-1 formats, the 50,000-frame target, on-demand A2UI loading, and the WCAG 2.2 AA
  release audit belong to 1.0.0. They do not replace the MVP's current acceptance criteria.
- How hosts supply theme overrides (a file next to the configuration, a configuration field, or
  host-page CSS) is undecided; the roadmap tracks it. FR-041 fixes only the properties.
- Final license and package-name decisions remain dependencies before publication. The
  [roadmap](../../ROADMAP.md#open-decisions) tracks these and the unresolved upstream placement,
  protocol discovery, and transport decisions originally recorded in section 13.

### Source traceability

`S10-ACn` means criterion `n` under the original product brief's section 10, "How 0.1.0 is accepted."
Story references use `USn.m` for story `n`, scenario `m`.

| Source criterion | Requirement coverage | Acceptance scenarios | Outcome |
| --- | --- | --- | --- |
| S10-AC1: hosted run inspection | FR-003, FR-005, FR-007 to FR-013 | US1.1, US1.2 | SC-001 |
| S10-AC2: embedded host integration | FR-001, FR-002, FR-004, FR-006 | US2.1 to US2.4 | SC-002 |
| S10-AC3: every event type | FR-012 to FR-022 | US1.3, US3.3 | SC-003 |
| S10-AC4: interactive round trips | FR-023 to FR-025 | US3.1 to US3.4 | SC-004 |
| S10-AC5: client-profile controls | FR-026 to FR-032 | US4.1 to US4.6 | SC-005 |
| S10-AC6: invalid raw input | FR-007, FR-033 | US5.2 | SC-006 |
| S10-AC7: session round trip | FR-034, FR-035, FR-039 | US5.3, US5.4 | SC-007 |
| S10-AC8: privacy and network bounds | FR-004, FR-007, FR-036 to FR-039 | US2.1, US5.3; network checks in SC-008 | SC-008 |
| S10-AC9: responsiveness and bundle budget | FR-008; SC-009 defines release limits | US1.5 | SC-009 |
| Clarification 2026-10-02: adopter theming (not in section 10) | FR-037, FR-041 | US2.5 | SC-010 |
