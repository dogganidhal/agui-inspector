# Feature Specification: Protocol rule catalogue

**Feature Branch**: `gh-77-protocol-rule-catalogue`

**Created**: 2026-10-04

**Status**: Draft for review

**Input**: [Issue #77](https://github.com/dogganidhal/agui-inspector/issues/77), item 5 of 0.2.0: give every
protocol check a stable rule id and a short description, make every finding name its rule, flag frames that
contradict the capabilities an agent declares, and cover the older event versions the protocol client accepts.
Checks never stop, repair or reorder the stream. The server suite (#83) and the rule pages (#85) of the next minor
build on these ids.

## Clarifications

### Session 2026-10-04

Nobody was available to answer, so each answer takes the recommended option and its reason. None of them changes
0.2.0 scope, needs a constitution amendment or adds a dependency, so no question goes to the maintainer.

- Q: Does a sequence finding sit on the run, as in 0.1.0, or on the frame where the violation happened? → A: On the
  run, as today. The protocol client reports no frame with its error, and picking one by counting events would be a
  guess. The rule id says which check failed. The exchange row already links to the run's frames.
- Q: Does a capability rule give one finding per contradicting frame or one per run? → A: One per frame. The issue says
  "flag frames", a frame tick in the timeline needs the finding on the frame, and a developer fixing the agent needs to
  see every frame, not only the first. A stream of 200 deltas from an agent that declares `state.deltas: false` gets 200
  findings.
- Q: Does `humanInTheLoop.supported: false` also trigger the interrupt rule, and `tools.supported: false` any rule? → A:
  No. A rule fires on the exact flag in its row of the table and on nothing else. The issue names the flags, and the
  upstream documentation describes `interrupts` as its own flag, so reading more into another flag would be the
  inspector's opinion, not the agent's declaration. A new rule can add that later without changing an id.
- Q: What does the frame row show, and how are the new kinds styled? → A: The frame row keeps its short kind tag, which
  is the kind of its first finding, because the row is narrow and 0.1.0 tests and docs name it. The frame's detail, an
  exchange and a run list every finding with its full rule id. `compat` and `capability` findings use the same warning
  styling as `sequence`, because the data is a valid or accepted event and a rule says it should not be there. The
  other kinds keep the error styling.
- Q: Does the catalogue need a "withdrawn" marker now? → A: No. No rule is withdrawn in this release, so a marker would
  be speculative. The policy in FR-004 stays: a withdrawn rule remains listed. The marker is added when the first rule
  is withdrawn. "Withdrawn" is about a rule the inspector stops producing. It is not the same as a retired event type,
  which is an older event shape such as `THINKING_START`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Know which rule a finding comes from (Priority: P1)

A developer inspects a run and sees a finding on a frame, a run or an exchange. The finding shows a rule id, such as
`sequence.text-message-not-open`, next to its message. The same id is in the docs with a short description and what to
check. The developer can look it up, link to it and mention it in a bug report. It does not change when the
inspector or its dependencies are updated.

**Why this priority**: Without an id, a finding is a sentence. Sentences get reworded, cannot be linked, and cannot
be counted. Every other part of this feature, and the next minor's server suite and rule pages, depends on the id.

**Independent Test**: Play one fixture for every rule through the recorder, the frame reader and the protocol client.
Check that each finding carries the id of the rule the fixture breaks, and that the id is in the catalogue and in the
docs. Export the session, import it and compare the ids. Import a session exported by 0.1.0.

**Acceptance Scenarios**:

1. **Given** a stream with a `TEXT_MESSAGE_CONTENT` for a message that never started, **When** the run ends, **Then**
   the run has one finding with the rule `sequence.text-message-not-open`, and the frames list shows the frame
   unchanged.
2. **Given** a frame whose data is not JSON, **When** the frame is read, **Then** it has a finding with the rule
   `json.invalid`, and its text is kept exactly as received.
3. **Given** any finding the inspector creates, **When** it is listed in a frame's detail, in an exchange or a run, or
   in an export, **Then** it shows its rule id.
4. **Given** a session exported by 0.1.0, which has findings without a rule id, **When** it is imported, **Then** it
   opens, its findings show as before without a rule id, and nothing is invented for them.
5. **Given** a session exported by this version, **When** it is imported, **Then** every finding keeps its rule id.

---

### User Story 2 - Catch frames that contradict the declared capabilities (Priority: P1)

A developer configures an agent with the capabilities it declares, inline or as a capabilities URL. When the agent
sends a frame that the declaration rules out, that frame gets a finding. An agent that declares
`reasoning.supported: false` and then streams a reasoning event gets `capability.reasoning-unsupported` on that
frame. The same holds for an interrupt outcome when `humanInTheLoop.interrupts` is `false`, and for a state delta when
`state.deltas` is `false`.

**Why this priority**: It is the new check the issue asks for. A declaration that the agent does not keep sends clients
down the wrong path, and the developer cannot see it in the schema or sequence checks.

**Independent Test**: For each of the four capability rules, play a stream that emits the event, once with the
capability declared `false`, once declared `true` and once not declared. Only the first gets a finding. Repeat with the
declaration given inline and given by URL.

**Acceptance Scenarios**:

1. **Given** an agent that declares `reasoning.supported: false`, **When** a `REASONING_START` frame arrives, **Then**
   that frame has a finding with the rule `capability.reasoning-unsupported`, and the stream is recorded and read as
   it would be without the finding.
2. **Given** an agent that declares `humanInTheLoop.interrupts: false`, **When** a `RUN_FINISHED` frame arrives with
   an interrupt outcome, **Then** that frame has a finding with the rule `capability.interrupt-unsupported`.
3. **Given** an agent that declares `state.deltas: false`, **When** a `STATE_DELTA` frame arrives, **Then** that
   frame has a finding with the rule `capability.state-delta-unsupported`.
4. **Given** an agent that declares `state.snapshots: false`, **When** a `STATE_SNAPSHOT` frame arrives, **Then**
   that frame has a finding with the rule `capability.state-snapshot-unsupported`.
5. **Given** an agent that does not declare a capability, **When** a frame of that kind arrives, **Then** there is no
   finding. An omitted capability means not declared, not unsupported.
6. **Given** an agent whose capabilities come from a URL that has not loaded, or failed to load, **When** its stream
   arrives, **Then** there are no capability findings and no new error. The settings view keeps showing the load
   failure as it does today.
7. **Given** the shipped reference agent and the public demo agents, **When** every scenario runs, **Then** there are
   no capability findings.

---

### User Story 3 - See the older event versions the client accepts (Priority: P2)

A developer inspects a server that still sends an older event shape. The pinned protocol client reads that shape,
upgrades it, prints a console warning and carries on. Today the inspector reports a plain schema finding on the same
frame, which is misleading: the client accepted it. With this feature, the frame gets a `compat` finding that names the
older shape and says what the client does with it. If the frame has another problem, that problem is reported too.

**Why this priority**: The issue asks for protocol version handling that covers the older versions the client accepts.
It makes the inspector agree with the client about which frames are acceptable, and it tells a developer which of
their frames a future client will stop accepting.

**Independent Test**: Play each older shape through the real protocol client and check that the run succeeds, then
through the frame reader and check the `compat` finding. Play a run whose `RUN_FINISHED` has `outcome: null` and check
that the missing-terminal finding does not appear. Play `RUN_STARTED` with a newer, an older and an unreadable
`protocolVersion`.

**Acceptance Scenarios**:

1. **Given** a frame `THINKING_START`, **When** it is read, **Then** it has a finding with the rule
   `compat.retired-event-type` and no `schema.unknown-event-type` finding. Its type and text are kept as received.
2. **Given** a `RUN_FINISHED` with `result: null`, **When** it is read, **Then** it has a finding with the rule
   `compat.null-optional-field`, no schema finding, and the run does not get a missing-terminal finding.
3. **Given** a `TOOL_CALL_START` with `parentMessageId: null` and no `toolCallName`, **When** it is read, **Then** it
   has a `compat.null-optional-field` finding and a `schema.invalid-event` finding that names only the missing
   `toolCallName`.
4. **Given** a `RUN_STARTED` with `protocolVersion: "2.0"`, **When** it is read, **Then** it has a finding with the
   rule `compat.protocol-version-newer`. With `"1.0.1"` or `"abc"` it has `compat.protocol-version-unreadable`. With
   `"0.9"`, with `"1.0"` or with no `protocolVersion` it has no finding.
5. **Given** a message with a legacy `binary` content part in a `MESSAGES_SNAPSHOT`, **When** it is read, **Then** it
   has a finding with the rule `compat.legacy-binary-content`.
6. **Given** an agent that declares `reasoning.supported: false` and a `THINKING_START` frame, **When** it is read,
   **Then** the frame has both `compat.retired-event-type` and `capability.reasoning-unsupported`.

---

### User Story 4 - Read the catalogue and build on it (Priority: P2)

A maintainer, a server author or the author of the next minor's conformance suite opens the docs and finds one page
that lists every rule: id, family, short description and what to check. The page states how ids are named and that they
do not change. A test fails when the page and the catalogue disagree.

**Why this priority**: The server suite (#83) needs one violating test per rule, and the rule pages (#85) need one
page per rule. Both start from this list. A list kept in two places drifts, so one test keeps them equal.

**Independent Test**: Read the rules page. Check that every catalogue id is on it, every id on it is in the catalogue,
and every id has a fixture.

**Acceptance Scenarios**:

1. **Given** the docs site, **When** a reader opens the rules page, **Then** it lists every rule of the catalogue,
   grouped by family, with its id and a short description, and it explains the naming scheme and the stability rule.
2. **Given** a contributor who adds a rule to the catalogue without a fixture or without a docs entry, **When** the
   unit tests run, **Then** they fail and name the rule.
3. **Given** the page "Read frames and findings", **When** a reader looks up the kinds of finding, **Then** the list
   includes `capability` and `compat` and points to the rules page.

---

### Edge Cases

- A frame can carry several findings. A `THINKING_START` frame from an agent that declares no reasoning has two, and
  a null field next to a missing field has two.
- The protocol client stops at the first sequence violation of a run. A run gets one `sequence` finding, for the first
  violation. Later violations in the same stream are not reported. The frames after it are still recorded and read.
- A client message that matches no sequence rule gets `sequence.unclassified`. The finding keeps the client's own
  words in its message. This is how a client upgrade that rewords or adds a check shows up without losing a finding.
- A frame whose data is not a JSON object (a number, `null`, an array, prose) has only the `json` or `schema` rule
  that applies. No capability or compat rule reads it.
- A capability rule reads the event type of any frame whose data is a JSON object, and for interrupts the outcome
  type, whether or not the rest of the event is valid. A `RUN_FINISHED` with an interrupt outcome and no `runId` has the
  schema finding and the capability finding.
- The declaration is read once, when the response stream starts. A capabilities URL that finishes loading during a
  stream does not change that stream's findings. The next run uses it.
- A raw request is judged like a run: its frames are read against the selected agent's declaration. A typed endpoint
  with no agent has no declaration. A preparation exchange has no event frames.
- An imported recording shows the findings it was exported with. Nothing is judged again on import, because a recording
  holds no declaration.
- A rule id from a newer version in an imported file is shown as it is. The importer checks that the id is well formed,
  not that the catalogue knows it.
- A user stop adds no finding of its own. It leaves the same findings it left in 0.1.0.
- A rule check that throws on one frame leaves the frame recorded and read, adds one `capture.rule-check-failed`
  finding to it, and the stream goes on.
- The reasoning rule counts `REASONING_ENCRYPTED_VALUE`, `REASONING_MESSAGE_CHUNK` and the retired `THINKING_*` types
  as reasoning events. A text-only reply from the same agent has no finding.

## Requirements *(mandatory)*

### Functional Requirements

**The catalogue and the ids**

- **FR-001**: The inspector MUST have a rule catalogue. Each rule has an id, a family and a short description. Every
  finding the inspector creates MUST name exactly one rule of the catalogue. The catalogue is the only list of rules:
  views, docs, fixtures and tests read it or are checked against it.
- **FR-002**: A rule id MUST be `<family>.<problem>`. The family is one of `json`, `schema`, `sequence`, `terminal`,
  `transport`, `capture`, `compat` and `capability`. The problem is lowercase ASCII letters and digits in words joined
  by single hyphens, and starts with a letter. The whole id matches `^[a-z]+\.[a-z][a-z0-9]*(-[a-z0-9]+)*$`. An id
  names the problem that was seen, not the package or the mechanism that saw it, so that a client upgrade does not
  rename it.
- **FR-003**: The family of a finding's rule MUST equal the finding's kind. The kinds `json`, `schema`, `sequence`,
  `terminal`, `transport` and `capture` keep their meaning and are produced by the same code paths as in 0.1.0. The
  kinds `compat` and `capability` are new. The kind `projection` stays valid for importing and has no rule, because
  nothing creates a finding of that kind.
- **FR-004**: Rule ids are a public contract. An id MUST NOT be renamed, reused for another meaning or removed. A rule
  that is no longer produced MUST stay in the catalogue and in the docs, marked withdrawn. No rule is withdrawn in this
  release, so the catalogue has no withdrawn marker yet. It is added when the first rule is withdrawn. A short
  description MAY be reworded when its meaning stays. A rule MUST NOT be split or merged in place: a split adds new ids
  and withdraws the old one. New rules and new families MAY be added in any release.
- **FR-005**: A finding MUST keep its kind, its message and its subject (a frame, a run or an exchange), and gain the
  rule id. A frame MAY have several findings. Messages MUST name fields and kinds of problem and never repeat received
  values, as in 0.1.0. A capability message names the event type and the declared capability, for example
  `reasoning.supported`.
- **FR-006**: The inspector MUST show the full rule id wherever it lists a finding in detail: in a frame's detail, on an
  exchange and on a run. A frame row keeps its short tag, which is the kind of its first finding. The frames list MUST
  still filter to frames that have findings. `compat` and `capability` findings MUST use the warning styling that
  `sequence` findings have. The other kinds keep the error styling.
- **FR-007**: A session export MUST carry each finding's rule id as an optional field `rule`. The format version stays
  0. An import MUST accept a finding without `rule` (a 0.1.0 export) and show it without a rule id. An import MUST
  accept a finding with a well-formed `rule` that the catalogue does not know. An import MUST reject a `rule` that is
  not a well-formed id, and a `rule` whose family differs from the finding's kind.

**Findings that exist today**

- **FR-008**: Every finding that 0.1.0 creates MUST get the rule in the table below. The kind, the subject and the
  message of these findings stay as they are, so a 0.1.0 reader sees the same finding plus an id.

| Rule | Today's finding |
| --- | --- |
| `json.invalid` | Frame data is not valid JSON. Also the protocol client's own JSON error, on the run. |
| `schema.unknown-event-type` | Frame data is JSON with a `type` outside the baseline. |
| `schema.invalid-event` | Frame data is JSON but not a valid event. Also the protocol client's rejection of a frame, on the run. |
| `schema.check-failed` | The inspector's own schema check threw. The frame is kept and marked invalid. |
| `terminal.missing` | The stream ended without a valid `RUN_FINISHED` or `RUN_ERROR`. |
| `transport.failed` | The request failed before a response, or the connection failed during the stream. |
| `capture.failed` | The inspector's recording failed. Reported once per exchange. |
| `capture.response-not-captured` | The response could not be copied for recording. |

**Sequence rules**

- **FR-009**: A finding that the protocol client reports for a stream it rejects (an `AGUIError`) MUST get one of the
  `sequence` rules below. The inspector maps the client's message to a rule. A message that no rule matches gets
  `sequence.unclassified`. The finding keeps the client's message in its own message, clipped as in 0.1.0. The finding
  goes on the run, as in 0.1.0, because the client reports no frame. The protocol client stays the only judge of
  sequence: the inspector does not run a second sequence check.

| Rule | The stream |
| --- | --- |
| `sequence.first-event` | Starts with an event other than `RUN_STARTED` or `RUN_ERROR`. |
| `sequence.event-after-run-finished` | Sends an event after `RUN_FINISHED`. |
| `sequence.event-after-run-error` | Sends an event after `RUN_ERROR`. |
| `sequence.run-started-while-active` | Sends `RUN_STARTED` while a run is active. |
| `sequence.run-finished-while-open` | Sends `RUN_FINISHED` while a step, text message, reasoning span, reasoning message, tool call or subagent is open. |
| `sequence.text-message-already-open` | Starts a text message whose id is already open. |
| `sequence.text-message-not-open` | Sends content or an end for a text message that is not open. |
| `sequence.tool-call-already-open` | Starts a tool call whose id is already open. |
| `sequence.tool-call-not-open` | Sends arguments or an end for a tool call that is not open. |
| `sequence.step-already-open` | Starts a step that is already open. |
| `sequence.step-not-open` | Finishes a step that was not started. |
| `sequence.reasoning-span-already-open` | Starts a reasoning span whose id is already open. |
| `sequence.reasoning-span-not-open` | Ends a reasoning span that is not open. |
| `sequence.reasoning-message-already-open` | Starts a reasoning message whose id is already open. |
| `sequence.reasoning-message-not-open` | Sends content or an end for a reasoning message that is not open. |
| `sequence.subagent-already-active` | Starts a subagent that is already active. |
| `sequence.subagent-id-reused` | Starts a subagent whose id already finished in this run. |
| `sequence.subagent-parent-unknown` | Starts a subagent whose parent subagent was never started. |
| `sequence.subagent-not-active` | Finishes or fails a subagent that is not active. |
| `sequence.owner-mismatch` | Continues or finishes something under a different subagent than the one that opened it. |
| `sequence.unclassified` | Is rejected by the client for a reason no other sequence rule names. |

**Capability rules**

- **FR-010**: The declared capabilities of a stream MUST be those of the agent selected when the stream starts, from
  the configuration, inline or from the capabilities URL, exactly as the settings view reads them today. When there are
  none (no agent, none declared, a URL not loaded yet or failed), capability rules MUST NOT produce findings or errors.
  The inspector MUST NOT fetch capabilities for this feature on its own initiative or by discovery.
- **FR-011**: A capability rule MUST fire only when the capability is declared `false`. A capability that is omitted or
  `true` MUST NOT produce a finding. The finding goes on the frame that contradicts the declaration, one per frame per
  rule, and names the event type and the capability. A stream of 200 such frames gets 200 findings. A rule fires on the
  exact flag in its row and on no other flag: `humanInTheLoop.supported: false` or `tools.supported: false` alone
  produces no finding.

| Rule | The frame | The agent declares |
| --- | --- | --- |
| `capability.reasoning-unsupported` | Any reasoning event: the `REASONING_*` types, or the retired `THINKING_*` types | `reasoning.supported: false` |
| `capability.interrupt-unsupported` | `RUN_FINISHED` with an interrupt outcome | `humanInTheLoop.interrupts: false` |
| `capability.state-delta-unsupported` | `STATE_DELTA` | `state.deltas: false` |
| `capability.state-snapshot-unsupported` | `STATE_SNAPSHOT` | `state.snapshots: false` |

- **FR-012**: A capability rule MUST read the event type of any frame whose data is a JSON object, after the compat
  upgrades below, whether or not the rest of the event is valid.

**Older event versions the client accepts**

- **FR-013**: The frame reader MUST apply to a copy of each JSON-object frame the same upgrades that the pinned
  protocol client applies before it handles an event. It MUST NOT change the frame, its text or its parsed value. When
  an upgrade applies, the frame gets the matching `compat` finding, once per rule per frame, however many fields were
  upgraded. Its message names the event type and the field.

| Rule | What the client accepts and does |
| --- | --- |
| `compat.retired-event-type` | `THINKING_START`, `THINKING_END`, `THINKING_TEXT_MESSAGE_START`, `THINKING_TEXT_MESSAGE_CONTENT` and `THINKING_TEXT_MESSAGE_END`. It converts them to `REASONING_START`, `REASONING_END`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT` and `REASONING_MESSAGE_END`, and drops `THINKING_START.title`. |
| `compat.null-optional-field` | `null` read as absent for `rawEvent` on any event, `result` and `outcome` on `RUN_FINISHED`, `result` on `SUBAGENT_FINISHED`, `parentMessageId` on `TOOL_CALL_START` and `TOOL_CALL_CHUNK`, and, inside `RUN_STARTED.input` and the messages of `MESSAGES_SNAPSHOT`: `forwardedProps`, `tools[].parameters`, `resume[].payload` and the `metadata` of media content parts. |
| `compat.legacy-binary-content` | A `binary` content part in a message of `RUN_STARTED.input` or `MESSAGES_SNAPSHOT`. It converts it to an image, audio, video or document part. |
| `compat.protocol-version-newer` | `RUN_STARTED.protocolVersion` newer than the protocol the client speaks (`1.0`), written as `major.minor`. The client warns and strips what it does not know. |
| `compat.protocol-version-unreadable` | A `protocolVersion` that is not written as `major.minor`, such as `1.0.1`, `1` or `abc`. The client warns and carries on. |

- **FR-014**: A frame that is valid after the upgrades MUST NOT get a schema finding, and its recorded verdicts stay
  those of the data as received. A frame that is still invalid after the upgrades MUST get `schema.invalid-event`,
  and its problems MUST describe the upgraded copy, so that a field the client already accepts is not named twice.
  A retired type that is invalid after conversion is `schema.invalid-event`, not `schema.unknown-event-type`.
- **FR-015**: A `RUN_FINISHED` or `RUN_ERROR` that is valid after the upgrades MUST count as a terminal event, so that a
  stream the client treats as finished does not get `terminal.missing`.
- **FR-016**: A `protocolVersion` that is absent, equal to the protocol version the client speaks, or older and written
  as `major.minor`, MUST NOT get a finding, as the client is silent for them.
- **FR-017**: The inspector MUST NOT add handling for the client's peer-ceiling downgrades, because the inspector's own
  client never sets a ceiling. The profile's `protocolVersion` setting keeps its meaning: it is sent, nothing more.

**Evidence and safety**

- **FR-018**: Rule checks MUST NOT stop, repair, drop, reorder or delay capture. The frames MUST stay exactly what
  was received: the envelopes joined in order equal the received bytes, each frame's parsed value equals the JSON parsed
  from its data, and frames, order and offsets are the same whether or not a declaration of capabilities is supplied.
  The upgrade of FR-013 works on a copy and never changes the frame or the object it was given. Nothing in this feature
  touches the protocol client's stream.
- **FR-019**: A rule check that throws MUST leave the frame recorded and read, MUST add one `capture.rule-check-failed`
  finding to it, and MUST NOT stop reading. That rule's family is `capture`.
- **FR-020**: This feature MUST NOT add a runtime dependency, a request, telemetry, storage or a header read. It MUST
  keep credentials out of findings.

**Fixtures, tests and docs**

- **FR-021**: Every rule MUST have a fixture that breaks it. A fixture is deterministic and model-free, and lives with
  the reference agent's fixtures, so that the conformance suite of the next minor can reuse it. For a rule about the
  inspector's own failure (`schema.check-failed`, `transport.failed`, `capture.failed`,
  `capture.response-not-captured`, `capture.rule-check-failed`, `sequence.unclassified`) the fixture is an injected
  failure.
- **FR-022**: A unit test MUST fail when a catalogue rule has no fixture, when a fixture has no rule, and when playing a
  fixture does not produce a finding with that rule id. Sequence and compat fixtures MUST also be played through the real
  protocol client, to show that the client rejects the sequence fixtures with the message the mapping expects, and
  accepts the compat fixtures. For every shape of FR-013, a test MUST show that the upgraded copy equals what the real
  client delivers for the same event, so that the inspector's view of the older shapes cannot drift from the client's.
- **FR-023**: A test MUST fail when an id appears in the docs and not in the catalogue, or the other way round.
- **FR-024**: A behavior test MUST cover each capability rule with the declaration `false`, `true` and omitted, and
  inline and by URL, and MUST cover that no shipped reference or demo scenario produces a capability finding.
- **FR-025**: The docs MUST list the rules on a rules page of the docs site, grouped by family: id, short description
  and what to check. The page MUST state the naming scheme and the stability rule. "Read frames and findings" MUST list
  the two new kinds and point to the rules page. The pages that describe the session file MUST describe the `rule`
  field. All docs follow the repository's writing rules.
- **FR-026**: The change MUST add a changeset for each package whose shipped behavior changes, and it is a minor change
  because it adds a feature. Formats stay at version 0 and the new field is optional.

### Key Entities

- **Rule**: An id, a family and a short description. It is the unit the next minor's server suite and
  rule pages build on.
- **Finding**: A judgement the inspector makes about a frame, a run or an exchange: a kind, a rule, a message and a
  subject. It sits beside the evidence and never changes it. A frame can have several.
- **Declared capabilities**: What the selected agent says it supports, from the configuration, inline or by URL. A
  declaration the agent did not make is not a claim that something is unsupported.
- **Compat upgrade**: A change the pinned protocol client makes to an older event shape before it handles the event.
  The inspector applies the same change to a copy to judge the frame, and reports that it applied.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the findings that the fixtures of all 39 rules produce carry a catalogue id, and each fixture
  produces a finding with exactly the id of the rule it breaks.
- **SC-002**: A developer who reads a finding can find its rule in the docs by id in one step, and 100% of catalogue
  ids are on the rules page.
- **SC-003**: The three capability examples of the issue produce a finding on the frame in every run of their
  fixtures, with the capability declared inline and by URL, and none when it is declared `true` or omitted.
- **SC-004**: For every fixture and for the 5,000-frame workload, the envelopes joined in order equal the received bytes,
  each parsed value equals the JSON parsed from its data, and no frame, offset or order differs between a capture read
  with a declaration of capabilities and one read without.
- **SC-005**: 0 capability findings across every scenario of the reference agent and the public demo agents.
- **SC-006**: Every session exported by 0.1.0 that opens today still opens, and every session exported by this version
  opens again with the same rule ids.
- **SC-007**: The existing 5,000-frame acceptance and responsiveness criteria pass unchanged, they also pass for a
  5,000-frame stream in which every frame has a capability finding, and the bundle stays within its budget.

## Assumptions

- Only the four capability rules above exist in this release. They are the three examples in the issue and the state
  snapshot rule beside the state delta rule, which the same group documents in the same words. Other flags (`tools`,
  `multiAgent`, `multimodal`, `output`, `execution`, `transport`, `identity`, `custom`) have no single event that
  contradicts them, or are not backed by upstream wording. The shipped `a2ui` demo agent declares
  `tools.supported: false`, which is a reason to wait. New rules are additive (FR-004).
- A finding names one rule. When one problem breaks two rules, such as a retired event from an agent that declares no
  reasoning, it gets two findings, one per rule.
- "As they do today" means capabilities are read from the selected agent's configuration, inline or by URL, through the
  same guarded transport and the same allowlist. The inspector does not discover capabilities, because protocol
  capability discovery waits for upstream (roadmap decision of 2026-10-04).
- Conversation views, projection issues (`ProjectionIssue`), the settings view and the profile stay as they are. A
  retired reasoning event is listed in the frames list with its finding and is not projected into the conversation,
  because only valid current events project.
- There is no severity. A finding is a finding, and the rule id says what it is.
- A rule cannot be turned off, tuned or extended in this release. Plugins are item 9 of 0.2.0 (#81).
- The server suite (#83) and the page per rule (#85) are next-minor work. This feature gives them the ids, the
  fixtures and the list.
- Formats stay at version 0 and the new `rule` field is optional, as the roadmap decided on 2026-10-04. A file written
  by this version, with a `rule` or a `capability` or `compat` kind, is not promised to open in 0.1.0, which rejects
  unknown fields and kinds. Files written by 0.1.0 open here. The changeset says so.
- The pinned `@ag-ui/core` and `@ag-ui/client` are 1.0.1. The mapping of client messages to sequence rules and the list
  of compat upgrades are written for that version and pinned by tests against the real client. A bump that changes
  either shows as a failing test or as `sequence.unclassified`, never as a missing finding.

## Upstream facts this spec relies on

Probed on 2026-10-04 by running `HttpAgent` from `@ag-ui/client` 1.0.1 against scripted streams, and by reading
`@ag-ui/core` 1.0.1. The full probe, with the stream used for each line, goes into `research.md` at the plan step.

- `PROTOCOL_VERSION` is `1.0`. `EventType` has the 31 baseline types and no `THINKING_*` type.
- Every run goes through a compatibility step in the client. It converts the five `THINKING_*` types to the
  `REASONING_*` types, drops `THINKING_START.title`, and turns the `null` fields of FR-013 into absent fields. It
  warns on the console for each and the run succeeds. The core schema rejects all of these shapes.
- `RUN_STARTED.protocolVersion`: absent, `1.0`, or older and written as `major.minor` (for example `0.9`) is silent.
  Newer written as `major.minor` (`2.0`) warns that unrecognised material will be stripped. Anything not written as
  `major.minor`, including `1.0.1` and `abc`, warns that the version cannot be interpreted. No case fails the run.
- The client drops a type it does not know from its own stream with a console warning, and strips fields it does not
  know. It does not report either as an error. The recorder keeps both unchanged.
- The client's peer-ceiling middleware (for servers at `0.0.39`, `0.0.45` and `0.0.57` or older) exists only when an
  agent class sets an older `maxProtocolVersion`. The inspector's class does not.
- The client checks the order of events and raises an `AGUIError` with free text and no code, for the first
  violation only. The `AGUIError`s the client has for a `null` optional field, a bad subagent outcome or a missing subagent field
  could not be reached in any probe, because the client parses the event with its schema first and raises a different
  error.
- The upstream `AgentCapabilities` documentation says that an omitted field means not declared, and that the
  `state.snapshots`, `state.deltas` and `humanInTheLoop.interrupts` flags describe the `STATE_SNAPSHOT` events, the
  `STATE_DELTA` events and a `RUN_FINISHED` with an interrupt outcome.
