# Contract: the rule catalogue

This is the list that `core/rules/catalogue.ts`, the fixtures, the docs page and the tests are all checked against. The
ids are a public contract (spec FR-004). The "short description" column is the text of the catalogue, and the docs page
may say more.

## Id grammar

```text
rule-id  = family "." problem
family   = "json" | "schema" | "sequence" | "terminal" | "transport" | "capture" | "compat" | "capability"
problem  = word *( "-" word )         ; lowercase ASCII, the first character a letter
pattern  = ^[a-z]+\.[a-z][a-z0-9]*(-[a-z0-9]+)*$
```

- The family of a finding's rule equals the finding's `kind`.
- An id is never renamed, reused for another meaning or removed. A rule that is no longer produced is withdrawn and stays
  listed. There is no withdrawn marker yet, because no rule is withdrawn.
- A split adds new ids and withdraws the old one. A merge is not allowed.
- Adding a rule or a family is not a breaking change.

## Rules

Subject is where the finding sits: a frame, a run or an exchange. A rule may have more than one.

### json and schema

| Id | Subject | Short description |
| --- | --- | --- |
| `json.invalid` | frame, run | The data is not valid JSON. |
| `schema.unknown-event-type` | frame | The event type is not in the supported baseline. |
| `schema.invalid-event` | frame, run | The data is JSON but not a valid AG-UI event. |
| `schema.check-failed` | frame | The inspector's schema check failed on this frame. The frame is kept and marked invalid. |

### sequence

Reported by the protocol client for the first violation of a run. Subject: run.

| Id | Short description |
| --- | --- |
| `sequence.first-event` | The stream starts with an event other than `RUN_STARTED` or `RUN_ERROR`. |
| `sequence.event-after-run-finished` | An event follows `RUN_FINISHED`. |
| `sequence.event-after-run-error` | An event follows `RUN_ERROR`. |
| `sequence.run-started-while-active` | `RUN_STARTED` arrives while a run is active. |
| `sequence.run-finished-while-open` | `RUN_FINISHED` arrives while a step, text message, reasoning span, reasoning message, tool call or subagent is open. |
| `sequence.text-message-already-open` | A text message starts with an id that is already open. |
| `sequence.text-message-not-open` | Content or an end arrives for a text message that is not open. |
| `sequence.tool-call-already-open` | A tool call starts with an id that is already open. |
| `sequence.tool-call-not-open` | Arguments or an end arrive for a tool call that is not open. |
| `sequence.step-already-open` | A step starts that is already open. |
| `sequence.step-not-open` | A step finishes that was not started. |
| `sequence.reasoning-span-already-open` | A reasoning span starts with an id that is already open. |
| `sequence.reasoning-span-not-open` | A reasoning span ends that is not open. |
| `sequence.reasoning-message-already-open` | A reasoning message starts with an id that is already open. |
| `sequence.reasoning-message-not-open` | Content or an end arrives for a reasoning message that is not open. |
| `sequence.subagent-already-active` | A subagent starts that is already active. |
| `sequence.subagent-id-reused` | A subagent starts with an id that already finished in this run. |
| `sequence.subagent-parent-unknown` | A subagent starts under a parent subagent that was never started. |
| `sequence.subagent-not-active` | A subagent finishes or fails that is not active. |
| `sequence.owner-mismatch` | An event continues or finishes something under a different subagent than the one that opened it. |
| `sequence.unclassified` | The client rejected the stream for a reason that no other sequence rule names. |

### terminal, transport and capture

| Id | Subject | Short description |
| --- | --- | --- |
| `terminal.missing` | run, exchange | The stream ended without a valid `RUN_FINISHED` or `RUN_ERROR`. |
| `transport.failed` | exchange | The request failed before a response, or the connection failed during the stream. |
| `capture.failed` | exchange | The inspector's recording failed. Reported once. |
| `capture.response-not-captured` | exchange | The response could not be copied for recording. |
| `capture.rule-check-failed` | frame | A rule check failed on this frame. The frame is kept. |

### compat

Subject: frame. The protocol client accepts each of these and upgrades it. At most one finding per rule per frame.

| Id | Short description |
| --- | --- |
| `compat.retired-event-type` | A retired `THINKING_*` event type. The client reads it as the matching `REASONING_*` event. |
| `compat.null-optional-field` | An optional field is `null`. The client reads it as absent. |
| `compat.legacy-binary-content` | A message holds a `binary` content part. The client converts it to a media part. |
| `compat.protocol-version-newer` | `RUN_STARTED` declares a protocol version newer than the client's. |
| `compat.protocol-version-unreadable` | `RUN_STARTED` declares a protocol version that is not written as `major.minor`. |

The fields and types behind these rules are in [research.md](../research.md), part 1.

### capability

Subject: frame. Fires only when the selected agent declares the flag as `false`.

| Id | The frame | The agent declares |
| --- | --- | --- |
| `capability.reasoning-unsupported` | A reasoning event: a `REASONING_*` type or a retired `THINKING_*` type | `reasoning.supported: false` |
| `capability.interrupt-unsupported` | `RUN_FINISHED` with `outcome.type` equal to `interrupt` | `humanInTheLoop.interrupts: false` |
| `capability.state-delta-unsupported` | `STATE_DELTA` | `state.deltas: false` |
| `capability.state-snapshot-unsupported` | `STATE_SNAPSHOT` | `state.snapshots: false` |

Short descriptions of the four: "A reasoning event came from an agent that declares reasoning as unsupported.", "An
interrupt outcome came from an agent that declares interrupts as unsupported.", "A state delta came from an agent that
declares state deltas as unsupported.", "A state snapshot came from an agent that declares state snapshots as
unsupported."

**Count**: 4 in `json` and `schema` together, 21 in `sequence`, 5 in `terminal`, `transport` and `capture` together, 5
in `compat` and 4 in `capability`. The total is 39.

## Sequence patterns

Matched in this order against the client's `AGUIError` message, before it is clipped. No match is
`sequence.unclassified`. The first column is the rule. Each pattern is anchored on the client 1.0.1 text; the sequence
test pins every one to the message that the real client raises for the rule's fixture.

| Rule | Pattern |
| --- | --- |
| `sequence.first-event` | `^First event must be 'RUN_STARTED'` |
| `sequence.event-after-run-finished` | `^Cannot send event type '[^']*': The run has already finished` |
| `sequence.event-after-run-error` | `^Cannot send event type '[^']*': The run has already errored` |
| `sequence.run-started-while-active` | `^Cannot send 'RUN_STARTED' while a run is still active` |
| `sequence.run-finished-while-open` | `^Cannot send 'RUN_FINISHED' while .+ are still active` |
| `sequence.owner-mismatch` | `does not match the (message\|tool call) '`, `does not match its parent message`, `that step is open under`, `is owned by '` |
| `sequence.text-message-already-open` | `^Cannot send 'TEXT_MESSAGE_START' event: A text message with ID` |
| `sequence.text-message-not-open` | `^Cannot send 'TEXT_MESSAGE_(CONTENT\|END)' event: No active text message` |
| `sequence.tool-call-already-open` | `^Cannot send 'TOOL_CALL_START' event: A tool call with ID` |
| `sequence.tool-call-not-open` | `^Cannot send 'TOOL_CALL_(ARGS\|END)' event: No active tool call` |
| `sequence.step-already-open` | `^Step ".*" is already active for 'STEP_STARTED'` |
| `sequence.step-not-open` | `^Cannot send 'STEP_FINISHED' for step ".*" that was not started` |
| `sequence.reasoning-span-already-open` | `^Cannot send 'REASONING_START' event: A reasoning span with ID` |
| `sequence.reasoning-span-not-open` | `^Cannot send 'REASONING_END' event: No active reasoning span` |
| `sequence.reasoning-message-already-open` | `^Cannot send 'REASONING_MESSAGE_START' event: A reasoning message with ID` |
| `sequence.reasoning-message-not-open` | `^Cannot send '(REASONING_MESSAGE_CONTENT\|REASONING_MESSAGE_END)' event: No active reasoning message` |
| `sequence.subagent-already-active` | `^Cannot send 'SUBAGENT_STARTED': subagent '.*' is already active` |
| `sequence.subagent-id-reused` | `^Cannot send 'SUBAGENT_STARTED': subagent '.*' has already finished in this run` |
| `sequence.subagent-parent-unknown` | `^Cannot send 'SUBAGENT_STARTED': parentSubagentRunId '.*' has not been started` |
| `sequence.subagent-not-active` | `^Cannot send '(SUBAGENT_FINISHED\|SUBAGENT_ERROR)': no active subagent found` |

The owner rule is checked before the lane rules because its messages also start with `Cannot send '…'`. The `\|` in a
cell is a plain `|` in the pattern.
