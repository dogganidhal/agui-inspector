# Feature Specification: Client automation

**Feature Branch**: `gh-74-client-automation`

**Created**: 2026-10-04

**Status**: Approved by the maintainer on 2026-10-04 with one change: scripted interrupt payloads are in scope

**Input**: Issue [#74](https://github.com/dogganidhal/agui-inspector/issues/74), "Answer interrupts and client
tool calls automatically from the client profile". Item 2 of 9 in the 0.2.0 roadmap. Every interrupt and every client
tool call waits for a manual reply today, so testing the same flow again means answering the same prompts again. The
client profile gets a reply mode for interrupts (by hand, resolve or cancel) and an optional scripted result per client
tool. The inspector then continues the run the same way a manual reply does.

## Clarifications

### Session 2026-10-04

Nobody answers questions interactively in this workflow. The answers below were taken from the issue, the 0.2.0
roadmap, the constitution and the code, each one as the recommended option.

- Q: What does an automatic Resolve send as the answer? → A: The payload that the profile maps to the interrupt's
  reason, when it has one. Otherwise the answer the manual editor holds before the developer edits it, so the same as
  pressing Resolve unedited: the starting answer from the interrupt's response schema, or an empty object when there is
  no schema. The maintainer answered the open question on 2026-10-04: an automatic Resolve that can only send the
  starting answer, such as `approved: false`, is not useful, so the optional payload setting is part of 0.2.0.
- Q: How is a scripted payload matched and checked? → A: By the interrupt's `reason`, which is a required open string
  in the protocol, mirroring how a scripted tool result is matched by tool name. The payload is any JSON value except
  `null` (the protocol's run input schema refuses a `null` resume payload) and is sent exactly as written. It is not
  checked against the response schema. The manual editor's schema check only warns and never blocks, and the same holds
  here, with nothing to warn because nobody types the answer.
- Q: Is the automatic reply limit a profile setting? → A: No. It is fixed at 10 automatic continuations in a row. A
  configurable limit adds a field, a control and a validation rule for a safety net that a developer can pass by
  answering once by hand.
- Q: Do the automatic marks survive session export and import? → A: Yes. A recording is evidence, and a recording
  that hides which replies were automatic misleads a reader. The mark is an optional field of the recorded run, so
  version 0 session files without it still import.
- Q: What happens to a scripted result for a tool that the profile does not have? → A: It is rejected with a visible
  error that names the field, like any other bad profile content. Removing a tool in the profile panel removes its
  scripted result. A script that never matches because of a typo would fail silently otherwise.
- Q: Which settings apply when they change while replies wait or a run streams? → A: The settings in force when a run
  ends decide. A change never answers replies that already wait, so toggling a control never sends a request.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Answer interrupts without clicking (Priority: P1)

A developer tests an agent that asks for approval before it acts. The flow has to be repeated after every change to
the agent. The developer sets the profile to resolve interrupts, sends a message, and the run continues by itself as
soon as the agent interrupts. Setting the profile to cancel does the same for the cancel path.

**Why this priority**: Repeating one prompt by hand is the cost the issue names. Interrupts are the case with the most
steps, because a continuation can only start once every interrupt has an answer.

**Independent Test**: Against the reference agent, select the interrupt scenario, set the profile to resolve, send the
quick message, and compare the second request with the one a manual Resolve on every interrupt produces. Repeat with
cancel. Then give the `approval` reason a payload in the profile and check that the approval interrupt is answered with
exactly that payload.

**Acceptance Scenarios**:

1. **Given** a profile whose interrupt reply is resolve, **When** a run ends with interrupts, **Then** every
   interrupt is answered as pressing Resolve without editing would answer it, and the continuation starts without any
   action from the developer.
2. **Given** a profile whose interrupt reply is cancel, **When** a run ends with interrupts, **Then** every interrupt
   is cancelled with no payload, and the continuation starts without any action from the developer.
3. **Given** the same interrupts answered by hand with the same answers, **When** the two continuation inputs are
   compared, **Then** they match field for field, in the same order, apart from the identifiers every new run gets.
4. **Given** a profile that does not set an interrupt reply, or sets it to by hand, **When** a run ends with
   interrupts, **Then** nothing is answered and the run waits for the developer, as in 0.1.0.
5. **Given** a profile whose interrupt reply is resolve and that maps the reason `approval` to the payload
   `{"approved": true}`, **When** a run ends with an interrupt of reason `approval` and another of reason `input`,
   **Then** the first is resolved with exactly `{"approved": true}` and the second with its starting answer.
6. **Given** a payload that does not match the interrupt's response schema, **When** the interrupt is resolved
   automatically, **Then** the payload is sent as written, as the manual editor sends a wrong answer, and the run
   continues.

---

### User Story 2 - Answer client tool calls with a scripted result (Priority: P1)

A developer tests an agent that calls a client tool, for example `pick_color`. The developer writes a result for that
tool in the profile once. Each time the agent calls the tool, the inspector gives it that result and the run
continues.

**Why this priority**: It is the second half of the issue and has the same cost: one manual result per call, per test.

**Independent Test**: Against the reference agent, add the `pick_color` and `pick_size` tools to the profile with a
scripted result each, send the `tools` quick message, and compare the second request with the one the manual results
produce.

**Acceptance Scenarios**:

1. **Given** a run that ends with pending calls to tools that all have a scripted result, **When** the run ends,
   **Then** each call gets its tool's scripted text exactly as written, and the continuation starts without any action
   from the developer.
2. **Given** a run that ends with several pending calls, only some of which have a script, **When** the run ends,
   **Then** the scripted calls are answered, the others wait for the developer, and the continuation starts when the
   developer has answered the last one.
3. **Given** a tool without a scripted result, **When** the agent calls it, **Then** the call waits for a manual result
   as in 0.1.0.
4. **Given** the same results typed by hand, **When** the two continuation inputs are compared, **Then** they match
   field for field, in the same order, apart from the identifiers every new run gets.

---

### User Story 3 - See which replies were automatic (Priority: P1)

A developer reads a conversation and needs to know which answers they gave and which the inspector gave for them, so a
surprising agent reply is not blamed on a click that never happened.

**Why this priority**: An answer the developer did not give has to be visible as such. This is an acceptance criterion
of the issue.

**Independent Test**: Run the interrupt scenario once with the profile set to resolve and once by hand. Read the
conversation for both.

**Acceptance Scenarios**:

1. **Given** a continuation whose replies were all automatic, **When** the developer reads the conversation, **Then**
   each interrupt answer and each tool result is marked automatic.
2. **Given** a continuation with one scripted result and one result typed by hand, **When** the developer reads the
   conversation, **Then** only the scripted one is marked automatic.
3. **Given** a reply given by hand, **When** the developer reads the conversation, **Then** it carries no automatic
   mark.
4. **Given** a session with automatic replies, **When** it is exported and imported again, **Then** the same replies
   are marked. A session file written before this feature has no marks and still imports.
5. **Given** the wire, **When** an automatic reply is sent, **Then** the request carries nothing that tells the agent
   the reply was automatic.

---

### User Story 4 - Keep the setup in the client profile (Priority: P2)

A developer sets the automatic replies once. They stay after a reload, they can be exported with the rest of the
profile, and a teammate can import the file and get the same behavior.

**Why this priority**: The settings are only useful if they survive the session. The format work is small because the
settings are optional fields of the existing profile.

**Independent Test**: Set a reply mode, one interrupt payload and two scripted results, reload the page, export the
profile, import it into a fresh page, and compare the settings. Import a 0.1.0 profile file.

**Acceptance Scenarios**:

1. **Given** a profile with the new settings, **When** the page reloads, **Then** the settings are still in force.
2. **Given** a profile with the new settings, **When** the developer exports it and imports the file, **Then** the
   imported profile has the same settings, and the file's format version is still 0.
3. **Given** a profile file or a saved profile from 0.1.0, **When** it is loaded or imported, **Then** it is accepted
   and every reply stays by hand.
4. **Given** a profile file with an unknown reply mode, a scripted result that is not text, a scripted result for a
   tool the profile does not have, or an interrupt payload with an empty reason, **When** it is imported or loaded,
   **Then** a visible error says what is wrong and the profile in use does not change.
5. **Given** the profile panel, **When** the developer changes the reply mode, adds, changes or removes an interrupt
   payload, sets or clears a result, or removes a tool, **Then** the next run ending uses the new settings, and
   removing a tool removes its scripted result.

---

### User Story 5 - Stop a loop of automatic replies (Priority: P1)

A developer points the inspector at an agent that interrupts on every run, or calls a client tool on every run, with
automation on. The inspector must not send runs forever. It stops answering for the developer after a fixed number of
automatic continuations in a row, says so, and lets the developer carry on by hand.

**Why this priority**: Without a guard, one wrong agent turns a developer tool into a request loop against a real
server, possibly a paid model. The issue asks the spec to settle this.

**Independent Test**: Against a reference agent scenario that interrupts on every run, set the profile to resolve and
send its quick message. Count the runs.

**Acceptance Scenarios**:

1. **Given** automation is on and an agent that ends every run with an interrupt or a pending tool call, **When** the
   developer sends one message, **Then** the inspector sends the first run and 10 automatic continuations, and no
   more.
2. **Given** the limit was reached, **When** the next run's replies are owed, **Then** they wait for the developer like
   any manual reply, and a visible notice says that automatic replies paused after 10 in a row and that answering by
   hand continues the run.
3. **Given** the limit was reached and the developer then answers by hand and sends the continuation, **When** the
   following run ends with replies, **Then** automatic replies work again, for up to 10 more.
4. **Given** a developer who sends a message, answers by hand so that the continuation starts, sends the continuation
   by hand, acts on an A2UI surface, starts a new thread or selects another agent or target, **When** that happens,
   **Then** the count starts again from zero.
5. **Given** a chain of automatic continuations, **When** the developer presses Stop, **Then** the running request ends
   as Stop always does and no further automatic reply is sent. A run the developer stopped is never answered
   automatically.

---

### Edge Cases

- A profile that sets a reply mode while replies already wait: those replies stay by hand. Settings apply to runs that
  end afterwards.
- The developer changes the profile while a run streams: the settings in force when the run ends apply.
- A run that leaves interrupts, and a profile with a scripted result for some tool: interrupts follow the interrupt
  reply mode only. A run ends with interrupts or with pending tool calls, not both.
- A payload for a reason that no interrupt of the run has: it is not used. A payload while the interrupt reply is
  cancel or by hand: it is kept and not used, so switching the mode loses nothing. Cancel never sends a payload.
- A payload that is an empty object, a list, text, a number or `false`: it is sent as that JSON value, as typing it in
  the editor would send it. A payload that is `null` is refused when the profile loads, because the protocol's run input
  schema does not accept a `null` resume payload, so it could never be sent. A `null` inside an object is fine.
- Two interrupts with the same reason: both get that reason's payload.
- A pending tool call whose name the client never saw start has no name, so no script matches it and it waits by hand.
- A pending tool call whose arguments are not valid JSON still gets its scripted result. The script does not depend on
  the arguments.
- The agent calls a tool that is not in the profile: no script exists, so the call waits by hand.
- The continuation cannot be sent (refused target, failed preparation, connection error): the error is shown as for a
  manual continuation, the answers stay in place with their automatic marks, nothing is retried automatically, and the
  existing control to send the continuation again works.
- The profile is by hand for interrupts and scripted for tools, or the reverse: each kind follows its own setting.
- Two interrupts and a mode of resolve: both are answered, the continuation carries both in the order the run reported
  them, as a manual reply does.
- A scripted result that contains text that looks like JSON, a very long text, or characters outside ASCII: it is sent
  exactly as written.
- A new thread, a different agent or a different target while an automatic chain is waiting to start: the chain ends,
  as any pending reply is discarded today.
- An imported recording: nothing runs, so nothing is answered. The marks of the recorded session are shown as recorded.
- Hosted, embedded and public demo pages: the same settings and behavior, with the same network allowlist. No extra
  request is made beyond the continuation and its preparations.

## Requirements *(mandatory)*

### Functional Requirements

#### Settings and defaults

- **FR-001**: The client profile MUST have an optional interrupt reply setting with three values: by hand, resolve,
  cancel. A profile that does not set it means by hand.
- **FR-002**: The client profile MUST have an optional scripted result for each of its client tools, identified by the
  tool's name. A scripted result is nonempty text. A tool without one is answered by hand. It MUST also have an optional
  scripted payload for each interrupt reason, identified by the reason text. A payload is any JSON value except `null`.
- **FR-003**: Replying by hand MUST stay the default. A new profile, a default profile and a profile without the new
  settings MUST behave as in 0.1.0: the inspector answers nothing for the developer.
- **FR-004**: The profile panel MUST let the developer choose the interrupt reply setting, add, change or remove the
  scripted payload of an interrupt reason, and set, change or clear the scripted result of each client tool. A tool without a scripted result MUST still show that it is answered by hand.
  Removing a tool MUST remove its scripted result. The controls MUST have labels and work from the keyboard, like the
  other profile controls.

#### Answering

- **FR-005**: When a run ends with interrupts and the interrupt reply setting is resolve or cancel, the inspector MUST
  answer every interrupt of that run and send the continuation without any action from the developer. Resolve MUST
  answer each interrupt with the payload that the profile maps to the interrupt's reason when it has one, sent exactly
  as written and never checked against the response schema. Otherwise Resolve MUST answer with the answer its manual
  editor holds before editing (the starting answer taken from the interrupt's response schema). Cancel MUST send a
  cancellation with no payload and ignore the payloads.
- **FR-006**: When a run ends with pending client tool calls, the inspector MUST give each call that has a scripted
  result that text, matched by tool name. If every pending call is answered this way, it MUST send the continuation
  without any action from the developer. A call without a scripted result MUST wait for a manual result, and the
  continuation MUST start once the developer has answered the last one, as it does today.
- **FR-007**: The continuation an automatic reply sends MUST be the one the matching manual reply sends. Its run input
  MUST have the same fields in the same order, the same parent run, the same resume entries or tool messages, and the
  same preparations before it, as the developer's manual replies with the same answers produce. Only the identifiers
  every new run generates differ. The inspector MUST add nothing to the run input, the headers or the preparations to
  mark a reply as automatic.
- **FR-008**: The settings in force when a run ends MUST decide whether its replies are automatic. Changing a setting
  MUST NOT answer replies that already wait.
- **FR-009**: Every reply that waits MUST stay answerable by hand, whatever the settings: the unscripted calls of a
  mixed run, the replies of a paused chain, and the answers of a continuation that failed to send.
- **FR-010**: If an automatic continuation cannot be sent, the inspector MUST show the error as it does for a manual
  continuation, keep the answers in place with their marks, and not retry on its own. The existing control to send the
  continuation again MUST work.
- **FR-011**: An A2UI surface action is not a reply. Automation MUST NOT send or answer one.

#### Loop guard

- **FR-012**: The inspector MUST send at most 10 automatic continuations in a row. The count covers continuations sent
  without the developer doing anything in between. When a run ends with replies owed and the count is at the limit,
  those replies MUST wait for the developer and a visible notice MUST say that automatic replies paused after 10 in a
  row and that answering by hand continues the run.
- **FR-013**: The count MUST start again from zero when a run that the developer started is sent: a message, the
  continuation that the developer's own last answer or a press of the send control starts, or an A2UI action. It MUST
  also start again from zero when the developer starts a new thread or selects another agent or target.
- **FR-014**: The limit is fixed. It is not a profile setting.
- **FR-015**: Stop MUST end a chain of automatic continuations. An automatic reply MUST NOT follow a run the developer
  stopped.

#### Conversation and recording

- **FR-016**: The conversation MUST mark each interrupt answer and each tool result that the inspector gave
  automatically. A reply the developer gave MUST carry no mark, also when it travels in the same continuation as an
  automatic one. The marks MUST stay after the continuation is sent. The cards that show waiting replies MUST show the
  mark too, while they are visible.
- **FR-017**: The marks MUST be part of the recording. They MUST survive session export and import. A session file
  without them MUST still import, and its replies show as given by the developer. Frames, raw bytes and the recorded
  request bodies MUST NOT change.

#### Profile files and privacy

- **FR-018**: Saving a profile in the browser, exporting it and importing it MUST keep the new settings. The files
  MUST stay at format version 0, and the new fields MUST be optional, so every existing profile file keeps working.
- **FR-019**: A profile with an unknown reply mode, a scripted result that is not text or is empty, a scripted
  result for a tool the profile does not have, or a payload map that is not an object, has an empty reason or holds a
  value that is not JSON or is `null` MUST fail with a visible error that names the field. The profile in use
  MUST NOT change. This is the existing rule for a bad profile file.
- **FR-020**: The new settings MUST hold only the reply mode, the scripted payloads and the scripted texts. The profile still has no field for
  an authentication header or token. Credentials stay in memory only.

#### Documentation and tests

- **FR-021**: The pages that say the inspector never answers an interrupt, runs a tool or retries a request by itself
  MUST change in the same change: say what is automatic, what is not, the default, the limit and the marks. The
  profile format description MUST list the new optional fields.
- **FR-022**: Regression coverage MUST include unit tests for the settings, their validation, the equivalence of
  automatic and manual continuations and the limit, and end-to-end tests against the reference agent for resolve,
  cancel, a scripted tool result, a mixed run, the limit and the profile round trip. No end-to-end test uses a model or
  an outside service.

### Key Entities

- **Interrupt reply setting**: One of by hand, resolve or cancel, for the whole profile. Absent means by hand.
- **Scripted tool result**: The text a client tool's calls are answered with. It belongs to one tool of the profile,
  identified by the tool's name.
- **Scripted interrupt payload**: The JSON value that an automatic Resolve sends for interrupts of one reason. It is
  identified by the reason text and belongs to the profile.
- **Automatic reply mark**: A note on a recorded run that says which of its interrupt answers or tool results the
  inspector gave. It is inspector-side data, not part of the wire.
- **Automatic reply count**: The number of automatic continuations sent in a row. It lives in memory, belongs to the
  current thread and is not saved.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the interrupt reply set to resolve or cancel, a developer who sends one message gets the full
  interrupt round trip with zero further actions, and its continuation matches the manual one in every field except
  the generated identifiers (checked with a fixed identifier source).
- **SC-002**: With scripted results for every tool a run calls, a developer who sends one message gets the full tool
  round trip with zero further actions, and its continuation matches the manual one in the same way.
- **SC-003**: Every automatic reply is marked in the conversation, and no manual reply is. In a mixed continuation the
  marks match which replies were automatic, 100 percent of the time in the tests.
- **SC-004**: Against an agent that interrupts on every run, the inspector sends the first run plus exactly 10
  automatic continuations, then waits. The 11th owed reply is answered only by the developer.
- **SC-005**: A profile with the new settings round-trips through browser storage, export and import unchanged. Every
  profile file from 0.1.0 still loads with every reply by hand. The format version stays 0.
- **SC-006**: With a default profile, no run is ever started or answered by the inspector on its own initiative. The
  existing manual reply tests pass unchanged.
- **SC-007**: The network allowlist test still passes. An automatic reply sends only the continuation and its
  preparations.
- **SC-008**: With a payload mapped to a reason, the automatic Resolve continuation carries that payload, equal to the
  profile's JSON value by deep comparison, including when it does not match the response schema. Interrupts of other
  reasons carry their starting answer.

## Assumptions

- The inspector's 0.1.0 specification said that automatic and scripted answers were outside the MVP. The accepted 0.2.0
  roadmap puts them in scope. This specification replaces those sentences from 0.2.0 on, and the 0.1.0 specification
  stays as it was.
- Without a payload for its reason, Resolve uses the answer the manual editor holds before the developer edits it: the
  schema's `default`, `const` or first `enum` value, otherwise the empty value of each declared type, or an empty
  object when there is no schema.
- The reply setting applies to every interrupt of every run. Payloads are chosen by reason only. There are no rules by
  interrupt id, message or response schema.
- A scripted result is plain text sent exactly as written. It is not a template and does not read the call's arguments.
- A result for a tool is by tool name, because a profile already has at most one tool of a name. A payload is by
  reason text, which the protocol defines as an open string, so the profile cannot check a reason against a list.
- The settings in force when a run ends decide, because that is when the replies exist.
- 10 automatic continuations in a row is the limit. It is low enough to stop a runaway agent quickly and high enough
  for a tool sequence of a normal test. The developer can always answer by hand and carry on.
- The automatic reply count and the pending replies live in the runtime's memory only. Neither is saved.
- Scope stays with replies to interrupts and client tool calls. A2UI surface actions, delays, conditions on the
  arguments, a configurable limit and scripts for tools the profile does not declare are not part of this feature.
- The reference agent is the only server the end-to-end tests use. It may gain a scripted scenario that interrupts on
  every run, so the limit can be tested.
- Pages stay as they are: the same static bundle serves embedded, hosted and public demo modes.
