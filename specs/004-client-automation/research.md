# Research: Client automation

Each decision traces to the code as it is on `main` (0.1.0 plus the unreleased fixes) and to [spec.md](spec.md). No
unknown is left open and no dependency is added.

## R1. Where automation runs

Decision: in the runtime (`core/runtime/index.ts`), at the one place that knows a run has ended and what it owes. The
pure part, "what does this profile answer for these replies", lives in `core/runtime/replies.ts` next to the manual
answer functions.

Why: `execute` already ends with `replies = repliesFor(recordId, outcome, current.messages)`. `continueRun` already turns
answered replies into the continuation through `resumeEntries`, `toolMessages` and `dispatch`. An automatic reply that
uses the same two functions (`answerPending`, `submitTool`, then the same continuation builder) gets the same run input
as a manual reply by construction. A second code path that builds its own input would need its own proof of equality.

Alternatives rejected:

- A React effect in the app that watches `state.interrupts` and calls `runtime.answerInterrupt`. It would put protocol
  behavior in a view, make the chain depend on render timing, and break the "framework-free core" rule. Embedded and
  demo pages share the app, but tests of the core would not cover it.
- A new `automate` option on `Runtime`. The runtime already reads the profile at the moment it builds a run
  (`options.settings()`), so the host owns the setting and the runtime needs no new entry point.

## R2. Shape of the settings in the profile

Decision: two optional top-level fields on the profile, next to the existing seven.

- `interruptReply`: `"resolve"` or `"cancel"`. Absent means by hand.
- `toolResults`: an object from tool name to nonempty text. Absent means by hand.

Why: the profile is flat today (`protocolVersion`, `tools`, `context`, `renderA2ui`, `injectA2uiTool`, `messageMode`,
`forwardedProps`). `messageMode` is the precedent for an optional enum where absence is the default and the control's
"default" choice removes the key. An exported profile never says "by hand", so one state has one representation, and a
0.1.0 file is a valid new file.

The script is not a field of the tool entry. `composeRunInput` sends `profile.tools` as `tools` in every run input, so a
field on the tool would reach the wire and break "the next input is the one a manual reply sends". A separate map keeps
`tools` byte for byte what it is today.

Alternatives rejected:

- `interruptReply: "manual"` as a third file value. Two spellings for the default, and a hand-edited file could set both
  `"manual"` and an absent key. `messageMode` does not do this either.
- One nested `automation` object. It adds a level for two fields and a new key list to validate.
- Rules by interrupt id, reason or tool arguments. Not in the issue (spec, out of scope).

## R3. How the scripts are looked up

Decision: by `Object.hasOwn(toolResults, call.toolName)`, never by `toolResults[name]`.

Why: the tool name comes from the agent's stream. A name such as `constructor`, `toString` or `__proto__` would find a
function or the prototype on a plain object and the "script" would be a non-string. Validation already makes the keys
tool names of the profile, and `Object.hasOwn` makes the lookup match only those. A call with an empty name (the client
never saw it start) matches nothing, because validation rejects empty keys.

## R4. Validation of the new fields

Decision, in `parseProfileSettings`, so the settings panel, import, load and the saved profile all share one check:

- `interruptReply` is absent, `"resolve"` or `"cancel"`. Anything else fails with `profile.interruptReply must be "resolve" or "cancel"`.
- `toolResults` is absent or a JSON object. Each key must be the name of a tool in the same profile. Each value must be a
  nonempty string. Errors name the field, as `profile.toolResults.pick_color must be nonempty text`.
- An empty `toolResults` object is accepted and dropped from the parsed value. The panel removes the key when the last
  script is cleared, so export and import stay a round trip, and a file with `{}` does not make a second spelling.
- Both fields are copied by the same explicit destructuring that copies the others, so `unexpectedKey` still rejects
  every other key. Credential-looking keys stay rejected.

Why strict about unknown tool names: a typo (`pick_colour`) would otherwise never match and fail silently, which is the
worst failure for a tool that exists to repeat a test.

## R5. The marks

Decision: the marks live on the recorded `Run`, as one optional field,
`automaticReplies: { interruptIds: string[]; toolCallIds: string[] }`, present only when at least one id is in it. While
replies still wait, `InterruptAnswer` and `ToolResultDraft` carry `automatic?: true`, which the cards read.

Why: the request body cannot carry the mark (FR-007), and the conversation is projected from the recorded request body and
the frames. The runtime is the only place that knows which answers it gave, and `Run` is already the inspector's own
record about a run (`input`, `outcome`, ids). The projection already builds `runOf` from `session.runs`. A session file
already has a strict key list for `runs`, so the change is one optional key, one `record` call and two `stringList`
calls, and files without it still import. Formats stay at version 0 as the 0.2.0 decisions say.

Where the mark shows:

- The run entry of the continuation: one `Carried` item, `automatic · i-approve, i-contact`, for interrupt answers. The
  existing item `resume · 2 answers` stays as it is, so nothing that reads it changes.
- The tool card whose result a script gave: the label `Result · entered by you` becomes `Result · automatic`. Today a
  result carried by an input message is always labelled "entered by you", which would be false for a script.
- The reply cards while they show: a small tag `Automatic` on an answered interrupt card and on a tool card whose result
  entered by a script.

Alternatives rejected:

- Deriving the mark from the profile at projection time. The profile can change after the run, and an imported recording
  has no profile.
- A marker in `forwardedProps` or a header. It would change the input the agent receives. It would also break FR-007.
- A new store collection. `Run` already exists, is exported and imported, and is keyed by exchange.

## R6. The loop guard

Decision: a fixed limit of 10 automatic continuations in a row (`AUTOMATIC_REPLY_LIMIT`), counted in the runtime as
`streak`. A run the developer starts (message, manual continuation, surface action) sets `streak` to 0 when it is sent.
A run the inspector starts adds 1. `newThread` and a target change set it to 0. When a run ends with replies that the
profile would answer and `streak` is already 10, nothing is answered, a `paused` flag is set, and the existing `notice`
gains a sentence. `paused` clears when the next run is sent, on a new thread and on a target change.

Why 10: the reference scenarios take 1 or 2 continuations, a realistic client-tool sequence a handful. A runaway agent
costs 10 requests, not a bill. The developer passes the limit with one manual answer, which resets the count.

Why fixed: a configurable limit adds a profile field, a control and a validation rule for a safety net with a one-click
exit. It can become a field later without breaking a file (spec, clarification).

Why the count is in memory: it describes the live conversation. It is not part of any file and not shown outside the
notice.

Why it counts at the point the run is sent: a continuation that fails before it is sent (refused target, failed
preparation) cost no request to the agent and must not use up the limit. The developer's retry resets it anyway.

Alternatives rejected:

- Detecting a repeat (same interrupt id or same tool arguments twice). A real agent may repeat an interrupt on purpose, and
  a looping one can change the id every time (the reference scenario does). A count is the only rule that is
  independent of the agent's content.
- A time window or rate. It adds a clock and a tuning knob. The count is exact and testable.
- Refusing the setting for an agent. The core knows nothing about agents (principle III).

## R6a. Stop

Decision: `dispatchRun` reports that a run was sent and finished without being aborted. The chain continues only on `true`.
Stop calls `abort()` on the active controller, so the run in flight reports `false` and the chain ends. The run itself
ends the way Stop always ends it (no terminal event is made up).

Why: no new state and no new control. The same abort signal that already ends the request ends the chain.

## R7. The chain and the `send()` promise

Decision: `dispatch` becomes a short loop around the existing body (renamed `dispatchRun`). Each pass sends one run and
then asks `automaticTurn()` for the next one. `send`, `continueRun`, `answerInterrupt`, `submitToolResult` and
`sendA2uiAction` still `await dispatch(...)`, so they resolve when the run and every automatic continuation after it have
ended. The doc comment of `Runtime.send` says so.

Why: every caller that waits for "the run has ended" (tests, the app's `sending` wrapper) keeps working, and no caller
needs to know about automation. `running` goes false and true again with no `await` between, so no other event can start
a run in the gap.

Alternative rejected: recursion from inside `dispatchRun`. It would keep `running` true across the chain but nest the
`finally` blocks and make the limit harder to read.

## R8. The settings controls

Decision, in `views/settings/index.tsx`, with the existing primitives and no new component library:

- A segmented control "Interrupt replies" with "By hand" (default), "Resolve" and "Cancel", like "Messages". The change
  goes through the existing `commit`, which validates the whole profile first.
- In "Client tools", each tool row replaces its fixed hint `answered by hand` with the real state and gets a text area
  labelled `Scripted result for <tool>`. It uses the draft pattern of `TextSetting` and `JsonSetting`. Typing sets the
  script, clearing removes it. The remove-tool button also removes the tool's script, in the same `commit`.

Why a text area: a tool message content is free text and may span lines, so a single-line field would make some results
impossible to type.

## R9. The reference agent

Decision: one new scenario for the loop test, `interrupt forever`, that is not part of `SCENARIOS` and not a demo quick
message. It always ends with an interrupt whose id contains the run id, also on a resume. It is exported separately and
documented in the page that lists the reference agent's scenarios.

Why not in `SCENARIOS`: the demo shows `Object.values(SCENARIOS)` as its quick messages and the demo tests and docs fix that
list at seven. A scenario that exists only to be a test double would change the public demo. The resume branch has to
come after this check, otherwise the continuation would be answered with `Resumed with ...` and the loop would end.

The scenario depends on the full-transcript message mode, which is the reference agent preset's default: it finds the
scenario name in the last user message of the transcript. In turn-only mode the continuation carries no user message and
the loop ends, which the docs of the scenario say.

## R10. What stays as it is

- `RunAgentInput`, `composeRunInput`, `resumeEntries`, `toolMessages` and the recorder: unchanged.
- The manual cards and their behavior, except the two additions in R5 and the footer sentence below.
- The connection card footer says "Nothing is answered for you." That stays true by default and is wrong in a mixed run.
  It becomes "Calls without a scripted result wait for you." The one test that matches the old sentence changes with it.
- The A2UI action path and `sendRaw`: not replies, not automated.
- `ROADMAP.md`: the maintainer's 0.2.0 roadmap arrives with #86. This work does not edit it.
