# Research: Protocol rule catalogue

All facts below were probed on 2026-10-04 against `@ag-ui/core` 1.0.1 and `@ag-ui/client` 1.0.1 as pinned in this
repository. The probes ran `HttpAgent` with a stub `fetch` that returns a fixed event stream, and read the result
through `onEvent` and `onRunFailed`, with `console.warn` captured. The schema column is `EventSchemas.safeParse` from
`@ag-ui/core/schemas`. The tests of this feature repeat every probe, so a client bump that changes one fails a test.

## Part 1. What the client accepts from older versions

### How the client gets there

`HttpAgent.runAgent` runs the stream through the agent's own middleware, then through `CompatibilityBoundary`, which
the client always appends as the innermost middleware. After that come `enforceEvents` (drops unrecognised types with a
console warning, strips unknown fields, parses with the event schema), `verifyEvents` (the sequence check) and the
state apply step. The boundary is exported and documented in the client typings as "the always-on pre-1.0
compatibility boundary". Its documented list matches the probes below.

Separate from the boundary, three version-gated middleware (`BackwardCompatibility_0_0_39`, `_0_0_45`, `_0_0_57`) are
installed only when an agent class overrides `maxProtocolVersion` with a version at or below the number. The
inspector's `RunAgent` extends `HttpAgent` and does not override it, so the ceiling is the client's own version and
none of the three is installed. They need no rule.

### Shapes the boundary upgrades

Each stream is `RUN_STARTED`, the event shown, then `RUN_FINISHED` unless the table says otherwise. "Client" is what
`runAgent` did. Every row printed a `[ag-ui][compat]` warning and none failed the run.

| Shape | Schema | Client |
| --- | --- | --- |
| `THINKING_START` with `title`, `THINKING_TEXT_MESSAGE_START`, `THINKING_TEXT_MESSAGE_CONTENT` with `delta`, `THINKING_TEXT_MESSAGE_END`, `THINKING_END` | all invalid (`invalid_union` on `type`) | Delivered `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_END`. Ids are minted by the client. The `title` is dropped with a second warning. |
| `RUN_FINISHED` with `result: null` | invalid (`result: custom`) | Delivered as finished. |
| `RUN_FINISHED` with `outcome: null` | invalid (`outcome: custom`) | Delivered as finished. |
| `RUN_STARTED` with `rawEvent: null` | invalid (`rawEvent: custom`) | Delivered. |
| `TOOL_CALL_START` with `parentMessageId: null` | invalid (`invalid_type`) | Delivered. |
| `TOOL_CALL_CHUNK` with `parentMessageId: null` | invalid (`invalid_type`) | Delivered. |
| `SUBAGENT_FINISHED` with `result: null` | invalid (`result: custom`) | Delivered. |
| `RUN_STARTED.input` with `forwardedProps: null`, `tools[].parameters: null`, `resume[].payload: null`, or `metadata: null` on an image part | invalid (`input.forwardedProps: custom`, `input.tools.0.parameters: custom`) | Each delivered with the field absent. |
| A `binary` content part in a message of `MESSAGES_SNAPSHOT` or `RUN_STARTED.input` | invalid (`messages.0.content: invalid_union`) | Delivered as an `image`, `audio`, `video` or `document` part chosen from the MIME type, with `data` or `url` as the `source` and `filename` as `metadata.filename`. A `binary` part with only an `id` cannot be converted: the client warns, then strips the part from its own copy. That is not an upgrade, so it gets no `compat` rule and stays a schema failure. |
| `metadata: null` on an image part of `MESSAGES_SNAPSHOT` | invalid (`messages.0.content: invalid_union`) | Delivered with the field absent. |

Every row was played through `HttpAgent`. The mirror's test repeats them, and fails if a row is wrong in either
direction.

A `THINKING_*` continuation with no opener gets a minted id from the client, and the client then fails the run with
`sequence.reasoning-message-not-open`. The mirror needs no state for this. It gives every converted event a fixed
placeholder `messageId` so that the schema can judge the rest of the event, and the run's own finding reports the
missing opener.

Not upgraded, and rejected by the client (so they stay `schema.invalid-event`): `metadata: null` on an event,
`subagentRunId: null` anywhere, a string `outcome`, a float `timestamp`. The client raises a `ZodError` for each.

### Shapes that look old and are fine

- `RUN_FINISHED` with no `outcome`: valid in the schema and delivered. No finding.
- `TEXT_MESSAGE_START` without `role`: valid in the schema. No finding.
- Unknown fields on an event (for example `future: 1` on `CUSTOM`): the schema accepts them, the client strips them
  with a console warning. No finding, as in 0.1.0. The parsed value in the recording keeps them.
- A type the baseline does not know (`FUTURE_EVENT`): the client drops it from its own stream with a warning. It is not
  an error for the client. The recorder keeps it. It stays `schema.unknown-event-type`.

### `RUN_STARTED.protocolVersion`

The client reads it in a subscriber on `onRunStartedEvent`. `PROTOCOL_VERSION` is `1.0`.

| Declared | Client output | Rule |
| --- | --- | --- |
| absent | silent | none |
| `1.0` | silent | none |
| `0.9` | silent (older, `major.minor`) | none |
| `2.0` | warns "speaks protocol 2.0; this client speaks 1.0. Unrecognised material will be stripped" | `compat.protocol-version-newer` |
| `abc` | warns "cannot interpret" | `compat.protocol-version-unreadable` |
| `1.0.1` | warns "cannot interpret" (not `major.minor`) | `compat.protocol-version-unreadable` |

The client's pattern is `^\d+\.\d+$`, its test for newer is a version compare. The inspector compares the two integers
and adds no dependency. Nothing fails the run in any case.

## Part 2. What the client's sequence check rejects

Probed one stream each: `RUN_STARTED`, the violating events, `RUN_FINISHED`. Every row is an `AGUIError` raised
through `onRunFailed`, and the client ends the run at the first one. The message is the text up to the first full stop
or colon of the client's own wording. Ids are replaced by `…`.

| Rule | Message the client raised |
| --- | --- |
| `sequence.first-event` | `First event must be 'RUN_STARTED'` |
| `sequence.event-after-run-finished` | `Cannot send event type 'CUSTOM': The run has already finished with 'RUN_FINISHED'. …` |
| `sequence.event-after-run-error` | `Cannot send event type 'CUSTOM': The run has already errored with 'RUN_ERROR'. …` |
| `sequence.run-started-while-active` | `Cannot send 'RUN_STARTED' while a run is still active. …` |
| `sequence.run-finished-while-open` | `Cannot send 'RUN_FINISHED' while text messages are still active: …`, and the same with `tool calls`, `steps`, `reasoning spans`, `reasoning messages`, `subagents` |
| `sequence.text-message-already-open` | `Cannot send 'TEXT_MESSAGE_START' event: A text message with ID '…' is already in progress. …` |
| `sequence.text-message-not-open` | `Cannot send 'TEXT_MESSAGE_CONTENT' event: No active text message found with ID '…'. …`, and the same for `TEXT_MESSAGE_END` |
| `sequence.tool-call-already-open` | `Cannot send 'TOOL_CALL_START' event: A tool call with ID '…' is already in progress. …` |
| `sequence.tool-call-not-open` | `Cannot send 'TOOL_CALL_ARGS' event: No active tool call found with ID '…'. …`, and the same for `TOOL_CALL_END` |
| `sequence.step-already-open` | `Step "…" is already active for 'STEP_STARTED'` |
| `sequence.step-not-open` | `Cannot send 'STEP_FINISHED' for step "…" that was not started` |
| `sequence.reasoning-span-already-open` | `Cannot send 'REASONING_START' event: A reasoning span with ID '…' is already in progress. …` |
| `sequence.reasoning-span-not-open` | `Cannot send 'REASONING_END' event: No active reasoning span found with ID '…'. …` |
| `sequence.reasoning-message-already-open` | `Cannot send 'REASONING_MESSAGE_START' event: A reasoning message with ID '…' is already in progress. …` |
| `sequence.reasoning-message-not-open` | `Cannot send 'REASONING_MESSAGE_CONTENT' event: No active reasoning message found with ID '…'. …`, and the same for `REASONING_MESSAGE_END` |
| `sequence.subagent-already-active` | `Cannot send 'SUBAGENT_STARTED': subagent '…' is already active. …` |
| `sequence.subagent-id-reused` | `Cannot send 'SUBAGENT_STARTED': subagent '…' has already finished in this run. …` |
| `sequence.subagent-parent-unknown` | `Cannot send 'SUBAGENT_STARTED': parentSubagentRunId '…' has not been started in this run.` |
| `sequence.subagent-not-active` | `Cannot send 'SUBAGENT_FINISHED': no active subagent found with ID '…'. …`, and the same for `SUBAGENT_ERROR` |
| `sequence.owner-mismatch` | `Cannot send 'TEXT_MESSAGE_CONTENT': subagentRunId '…' does not match the message '…' opener's subagent '…'.`; `Cannot send 'STEP_FINISHED' for step "…" attributed to …: that step is open under …`; `Cannot send 'TOOL_CALL_START': subagentRunId '…' does not match its parent message '…' owner '…'. …`; `… tool call '…' is owned by '…' but its parent message …` |

### Client errors that no stream reaches

The client source also raises an `AGUIError` for `subagentRunId: null`, for `null` in `description`,
`parentSubagentRunId`, `parentToolCallId`, `parentMessageId`, `outcome`, `code` and `outcome.interruptIds` of the
subagent events, for a subagent outcome type other than `success` or `suspended`, for a non-string entry in
`outcome.interruptIds`, for `SUBAGENT_STARTED` without `subagentRunId` or `name`, and for `SUBAGENT_FINISHED` or
`SUBAGENT_ERROR` without `subagentRunId` or `message`. Every probe of these raised a `ZodError` from the schema parse
that runs before verification (`expected string, received null`, `received undefined`), or was accepted. The client's
text for them is dead code behind its own schema. They get no rule. If a client release makes one reachable, it lands
in `sequence.unclassified`, and the sequence test fails on the new message.

### Other client errors that are not run findings

`HttpAgent.runAgent` also throws before the run for a thread with unanswered interrupts ("Thread has N pending
interrupt(s) not addressed by resume", "Interrupt … expired"). They never reach `onRunFailed`, so 0.1.0 creates no
finding for them, and neither does this feature. The runtime already refuses to start such a run.

### Other client errors that are run findings

| Error | 0.1.0 kind | Rule |
| --- | --- | --- |
| `SyntaxError` (data is not JSON) | json | `json.invalid` |
| `ZodError` (an event fails the schema after the client's strip) | schema | `schema.invalid-event` |
| `AGUIError` | sequence | by pattern, else `sequence.unclassified` |

## Part 3. Decisions

### 1. The id grammar and the families

**Decision**: `<family>.<problem>`, matching `^[a-z]+\.[a-z][a-z0-9]*(-[a-z0-9]+)*$`. The family is the finding's kind:
`json`, `schema`, `sequence`, `terminal`, `transport`, `capture`, plus the new `compat` and `capability`.

**Rationale**: The kind already exists in the format, the views and the docs. An id that starts with it needs no extra
field to group by, reads in a log line, and gives the rule pages (#85) a path (`/docs/rules/<family>/<problem>` or a
page per family). A readable slug beats `AGUI0042`: it needs no lookup. The family, not the observer, comes first, so a
rule survives the client changing how it reports the same problem.

**Alternatives**: Numeric ids: opaque, and every reader needs the table. Family independent of kind: two taxonomies to
keep equal. Observer first (`client.…`, `reader.…`): renames when the observer changes.

### 2. Sequence rules: granularity and mapping

**Decision**: One rule for each invariant the client checks, split by lane (text message, tool call, step, reasoning
span, reasoning message, subagent) where the violation is lane specific, and one rule for "`RUN_FINISHED` while
something is open". 20 rules plus `sequence.unclassified`. The inspector maps the client's `AGUIError` text with an
ordered table of anchored patterns. It adds no sequence engine of its own.

**Rationale**: The constitution makes the client the protocol authority, and the 0.1.0 reader says that sequence is
the client's to report. A second engine would disagree with the client sooner or later. The client's errors have no
code, so text is the only handle. The patterns are anchored on the client's fixed phrasing, a test pins each one to a
real error, and the fallback means a reworded error shows as `unclassified`, never as no finding. Lane split follows
how the client tracks state, so a rule id means one invariant.

**Alternatives**: One `sequence.violation` rule: no value. One rule per message variant (about 40): the same invariant
twice, and splitting `…-not-open` into content and end adds rules without adding meaning. Matching by the client's
event type and a regex on its remaining text: no better than one anchored regex.

### 3. Where capability rules run, and what they read

**Decision**: In the frame reader, when it reads the frame. The reader gets the declaration once, when the stream
starts, from a provider that the runtime sets. The rules read the event type of the upgraded copy and, for
`RUN_FINISHED`, `outcome.type`.

**Rationale**: Findings then land in the same store, with the same subject, in the same order as every other finding,
and they export and import with the session. An imported recording holds no declaration, so it could not be judged
again anyway. Reading the declaration once keeps a stream's findings stable.

**Alternatives**: A pass over the store after the run: it needs the declaration at that time, creates findings late
and out of order, and has to deduplicate. Judging in the view: not exported, not testable without a browser. A
declaration read per frame: one stream could flip halfway.

### 4. The compat upgrade: mirror the boundary, do not call it

**Decision**: `upgradeFrame` mirrors the client's `CompatibilityBoundary` on a copy, in about 60 lines, and a test
requires that its output equals what the real client delivers for every shape of the table above.

**Rationale**: Constitution II says client behavior comes from `@ag-ui/client`. The boundary is exported, so calling it
was the first idea. It does not work well: its per-event method is private. The only public entry is
`run(input, next)`, which needs an rxjs `Observable` for `next`, and `rxjs` is a dependency of the client, not of the
inspector (a new direct pin and a docs row for one call). It prints a `console.warn` for every upgrade, which in a
browser tab would repeat the client's warnings for each frame, once more. It mints ids for `THINKING_*` events that
would then appear in messages. And it returns only the new event, so the inspector would have to diff to learn which
rule applied. The mirror has none of these costs. Its risk is drift, and the test is aimed at exactly that.

**Alternatives**: Call `CompatibilityBoundary` with an added `rxjs` dependency and a suppressed `console.warn`: more
moving parts than the code it replaces. Do not upgrade, and keep reporting `schema` for frames that the client accepts:
fails the issue's request and keeps the misleading finding.

### 5. The schema verdict and the terminal check

**Decision**: `schemaVerdict` and `jsonVerdict` stay the verdict of the data as received. The schema finding and
`terminalSeen` come from the upgraded copy.

**Rationale**: The frame record is evidence, and the received shape is what the baseline schema says about it. The
finding says what is actionable, and a frame that the client accepts is not a schema failure. A `RUN_FINISHED` with
`outcome: null` finishes the run in the client, so it must end the terminal check.

### 6. Several findings per frame, and the ids

**Decision**: The first finding of a frame keeps `<frame id>:finding`. Later ones are `<frame id>:finding-2`, `-3`.

**Rationale**: Ids are opaque and unique. Keeping the first one stable means 0.1.0 sessions and tests that name it keep
working.

**Alternatives**: `<frame id>:<rule id>`: stable per rule and readable, but it changes the one existing id and ties an
id to a catalogue entry that an imported file may not have.

### 7. `rule` is optional in the type and in the file

**Decision**: `Finding.rule?: RuleId` where `RuleId` is a `string`. Code that creates findings takes the narrower
`CatalogueRuleId`, and a test proves that every finding created in every fixture has one. The importer accepts a
missing `rule`, and a well-formed `rule` of the right family that the catalogue does not know.

**Rationale**: 0.1.0 files have no rule, and the roadmap says new fields are optional and existing files keep working.
Inventing a rule for an old finding from its message would be a guess. A well-formed id of an unknown rule comes from a
newer version, which should still open.

### 8. The capability rule set

**Decision**: Four rules: reasoning, interrupt, state delta, state snapshot, each on one exact flag.

**Rationale**: The three are the issue's. The snapshot rule is the same group, the same wording and the same kind of
event as the delta rule. A flag that implies more than one event (`tools.supported`, `multiAgent.supported`,
`humanInTheLoop.supported`) or that no event contradicts (`multimodal`, `output`, `execution`, `transport`) is left for
a later release, where adding a rule changes no id. The shipped `a2ui` demo agent declares `tools.supported: false`,
so a tools rule would need a decision about that agent first.

### 9. Presentation

**Decision**: The frame row keeps its kind tag. Detail, exchange and run findings show the full rule id after the label,
in a `code` element. `compat` and `capability` use the warning variant like `sequence`.

**Rationale**: The row is narrow and the 0.1.0 docs and tests name the tag. The data behind those two kinds is valid
or accepted, as for `sequence`, so error styling would overstate it.

### 10. How the end-to-end check runs

**Decision**: One Playwright spec on the existing hosted harness (the production page, a `config.json`, scripted
agents), with one more scripted agent path whose events come from `rule-fixtures.ts`.

**Rationale**: It exercises the real wiring from configuration through the app to the reader and the view, which unit
tests cannot reach, and it needs no new server. The compat and sequence rules are fully covered by the unit and
fixture tests against the real client.

## Open questions

None for the maintainer. No decision changes 0.2.0 scope, needs a constitution amendment or adds a dependency.
