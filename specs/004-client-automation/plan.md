# Implementation Plan: Client automation

**Branch**: `gh-74-client-automation` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/004-client-automation/spec.md`, issue [#74](https://github.com/dogganidhal/agui-inspector/issues/74),
0.2.0 roadmap item 2.

## Summary

The client profile gets three optional settings: how interrupts are answered (`resolve` or `cancel`, absent means by
hand), a scripted payload per interrupt reason (a map from `Interrupt.reason` to a JSON value, used when Resolve is on),
and a scripted result per client tool (a map from tool name to text). When a run ends owing replies, the runtime asks a new
pure function, `automate`, which of them the profile answers. It answers those through the same state changes a manual
reply makes, and sends the continuation through the same builder and the same `dispatch` as `continueRun`. The run input
is therefore the manual one by construction, and nothing about it tells the agent the reply was automatic.

A fixed limit of 10 automatic continuations in a row guards against an agent that never stops asking. At the limit the
replies wait for the developer and a notice says why. Any developer action starts the count again.

The inspector records which replies it gave as one optional field on the recorded `Run`. The conversation shows it, and a
session export keeps it. No dependency is added, no format version changes, and the wire, the recorder and the protocol
client are not touched.

## Technical Context

**Language/Version**: Existing strict TypeScript 7.0.2 (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), React 19.3.0,
Node 24 or newer, Python 3.10 or newer for the wheel (no Python source change).

**Primary Dependencies**: Existing exact-pinned `@ag-ui/core` 1.0.1 and `@ag-ui/client` 1.0.1 (`buildResumeArray` through the
existing `resumeEntries`), `@a2ui/*` untouched. No new dependency, no row for `dependencies.mdx`.

**Storage**: The existing profile (browser storage key `agui-inspector.profile`, exported file) gains three optional keys.
The existing session file gains one optional key on `runs[]`. Both stay at version 0. The reply count and the pause flag
are memory only.

**Testing**: Existing `node --test` runner through esbuild, Playwright with Chromium against `examples/reference-agent`, the
bundle budget check. New unit tests under `packages/inspector/tests`, a new `tests/e2e/runtime/automation.spec.ts`,
additions to `tests/e2e/config/settings.spec.ts` and `tests/e2e/hosted/app.spec.ts`.

**Target Platform**: The one static bundle, so hosted, embedded (Python wheel, npm assets) and the public demo.

**Project Type**: Static browser app with a framework-free core and React views. No backend.

**Performance Goals**: None added. `automate` is linear in the number of waiting replies. The chain adds no work between
runs beyond the next request. The bundle stays inside 2,000,000 B minified and 600,000 B gzip (`check:bundle`); the change
adds a few hundred bytes.

**Constraints**: The continuation equals the manual one (FR-007). No new request type: an automatic reply sends the
continuation and its preparations, nothing else. No credential field.

**Scale/Scope**: One pull request. Eleven source files, about 150 lines of source, plus tests and docs. No new module.

## Constitution Check

Constitution 1.2.0. Pre-research and post-design assessments agree.

| Rule | Assessment |
| --- | --- |
| I. The wire comes first | Pass. No frame, no recorded byte, no order and no timing changes. The recorder and the protocol client's stream are untouched. The run input of an automatic continuation is built by the functions that build a manual one, and the mark never enters the request ([research R5](research.md)). |
| II. The protocol, not a framework | Pass. Resume entries still come from `buildResumeArray` through `resumeEntries`. The automation code is in `core/runtime` and `core/profiles`, with no React. The views only read `automatic` flags. |
| III. Generic core, application presets | Pass. Nothing is keyed to an agent, route or message convention. Scripts match the tool names the developer declared. The loop scenario lives in the reference agent. |
| IV. Local-only and credential privacy | Pass. No request type, origin or header is added. The new profile fields hold a mode and developer text, never a token or header. A scripted result or payload is saved with the profile like `context` and `forwardedProps`; the docs say not to put a secret in one. Exports still contain no headers. |
| V. Small and auditable | Pass. No dependency. One pure function, one constant, one loop in `dispatch`, optional fields. No new abstraction, no configurable limit, no rules engine. |
| VI. Every event type has a view | Pass. No protocol support changes. |
| Distribution | Pass. One bundle. Both packages ship it, so both get a minor changeset. |
| Release scope | Pass. Accepted 0.2.0 scope, issue #74. The 0.1.0 sentences "automatic or scripted answers are outside the MVP" (FR-024) and "tool replies remain manual" (FR-030) are replaced from 0.2.0 on by this spec, as its Assumptions say. The 0.1.0 spec is not edited. |
| Quality gates | Pass. Regression coverage is listed below. End-to-end tests use only the reference agent, and the interrupt resolution and cancellation, client tool results and session round trips the constitution requires are covered. The network allowlist check stays in every runtime e2e test. |
| Formats | Pass. Version 0 and optional fields, as the 0.2.0 decisions say. No migration step is needed. |

No violation, so the Complexity Tracking table stays empty.

`ROADMAP.md` is not edited here. Its 0.2.0 text arrives through issue #86, and the maintainer's rule is that this worker
does not touch it.

## Design in one page

1. `contracts.ts`: `ClientProfileSettings.interruptReply?`, `.interruptPayloads?`, `.toolResults?`; `InterruptAnswer.automatic?`,
   `ToolResultDraft.automatic?`; `AutomaticReplies`; `Run.automaticReplies?`.
2. `core/profiles/index.ts`: validate and copy the three fields in `parseProfileSettings`, plus four small edit helpers for the panel (`setInterruptReply`, `setInterruptPayload`, `setToolResult`, `removeTool`) that leave no empty map and remove a tool together with its script, carry them in `envelope`, update
   the comments that count seven settings.
3. `core/runtime/replies.ts`: `AUTOMATIC_REPLY_LIMIT`, `automate` (which also picks the payload for an interrupt's
   reason), `automaticReplies`.
4. `core/runtime/index.ts`: `dispatch` loop, `dispatchRun`, `automaticTurn`, a shared `continuation()` for `continueRun` and
   the chain, `streak` and `paused`, the notice text, `Run.automaticReplies` on write.
5. `core/session-files/index.ts`: `runOut` and `checkRun` accept `automaticReplies`.
6. `core/projection/index.ts`: the `Carried` item and `ToolResult.automatic`.
7. `views`: settings controls, the `Automatic` tags, the tool result label, the card footer.
8. `examples/reference-agent`: the `interrupt forever` scenario.

The sequence of one automatic round trip, for the interrupt scenario with `interruptReply: "resolve"`:

```text
developer sends "interrupt"                   dispatch(turn) -> dispatchRun -> execute
run 1 ends: outcome interrupt                 replies = repliesFor(...)             (2 unanswered, drafts seeded)
automaticTurn()                               automate(replies, profile) -> 2 resolved, automatic
                                              streak 0 < 10, nothing unanswered, continuation() -> turn
dispatchRun(turn, automatic)                  preparations, then run 2 (streak = 1), Run.automaticReplies written
run 2 ends: success                           replies = NO_REPLIES -> automaticTurn() returns none -> dispatch returns
```

## Project Structure

### Documentation (this feature)

```text
specs/004-client-automation/
  spec.md
  checklists/requirements.md
  plan.md
  research.md
  data-model.md
  contracts/automation.md
  quickstart.md
  tasks.md
```

### Source Code (repository root)

```text
packages/inspector/src/contracts.ts                       # fields and the AutomaticReplies type
packages/inspector/src/core/profiles/index.ts             # validation, export, import, comments
packages/inspector/src/core/runtime/replies.ts            # automate, automaticReplies, limit
packages/inspector/src/core/runtime/index.ts              # dispatch loop, streak, paused, notice, Run mark
packages/inspector/src/core/session-files/index.ts        # the optional run key
packages/inspector/src/core/projection/index.ts           # Carried item, ToolResult.automatic
packages/inspector/src/views/settings/index.tsx           # interrupt control, payload group, scripted result field
packages/inspector/src/views/connection/index.tsx         # Automatic tags, tool card footer
packages/inspector/src/views/conversation/index.tsx       # Result label
examples/reference-agent/scenarios.ts                     # INTERRUPT_FOREVER
examples/reference-agent/interactive-scenarios.ts         # re-export
packages/inspector/tests/runtime/{replies,automation}.test.ts, connection-view.test.tsx, docs.test.ts
packages/inspector/tests/config/{settings.test.ts,settings-view.test.tsx}
packages/inspector/tests/foundation/contracts.test.ts
packages/inspector/tests/conversation/{input.test.ts,automatic.test.tsx,support.ts}   # projection marks, the view, the harness option
packages/inspector/tests/inspection/session.test.ts       # round trip with marks
tests/demo/scenarios.test.ts                              # the new scenario, and SCENARIOS unchanged
tests/e2e/runtime/automation.spec.ts                      # new: resolve, cancel, payload, scripted, mixed, marks, limit
tests/e2e/runtime/{support.ts,interactive.spec.ts}        # the shared fixtures moved into support.ts, so both specs use them
tests/e2e/hosted/support.ts                               # an /interactive route that serves the reference agent's scenarios
tests/e2e/config/settings.spec.ts                         # panel controls, export, import, reload
tests/e2e/hosted/app.spec.ts                              # the real app reads the panel's setting
website/content/docs/{runs,configuration,recordings,event-views,internals,demo,demo-internals}.mdx
README.md                                                 # one clause
.changeset/                                               # two minor changesets
```

**Structure Decision**: Extend the files that already own each concern. No new module, no new directory, no new package. The
only new files are the e2e spec, the changesets and this directory.

## Test plan

| Layer | Cases |
| --- | --- |
| `replies.test.ts` (pure) | `automate`: resolve, cancel, none; the payload for a reason replaces the starting answer, is cloned, is not checked against the schema, is ignored by cancel, and a reason without a payload keeps the starting answer; reasons `constructor`, `toString`, `__proto__` match no payload; script match by name; no match for empty name or `constructor`, `toString`, `__proto__`; mixed batch; answered replies untouched; same object when nothing changes. `automaticReplies`: ids, undefined when empty. |
| `automation.test.ts` | Equality: automatic continuation body equals the manual one under a fixed identifier source, for interrupts (resolve, cancel) and tools, in full and turn message modes. Chain stops at 10 and sets the notice. The count resets on a message, a manual answer, a manual continuation, a surface action, a new thread and a target change. Pause clears. Stop ends the chain and a stopped run is not answered. Failed preparation leaves marked answers, sends nothing more, and the manual `continueRun` works. A profile change while waiting answers nothing. The profile in force at run end decides. `send` resolves after the chain. Default profile: nothing answered (the existing test stays). `Run.automaticReplies` written, absent for manual. A2UI action not automated. |
| `settings.test.ts` | Parse accepts 0.1.0 profiles, all three fields, `{}`; rejects bad mode, non-object, an empty reason, unknown tool, empty or non-text script, extra keys, credential-looking keys; a payload map is kept when the mode is cancel or absent; `null`, a list and an empty object are valid payloads. Export contains the fields only when set. Export then import equals. Save and load through storage. |
| `settings-view.test.tsx` | The segmented control, the payload group (add, edit, remove, invalid JSON not applied), the script field, clearing, removing a tool removes its script, labels. |
| `contracts.test.ts` | The envelope still has no volatile field. |
| Projection tests | `Carried` item, `ToolResult.automatic`, no mark without the field, ids that match nothing ignored. |
| `session.test.ts` | Export and import keep `automaticReplies`. A file without it imports. A malformed value is refused. |
| `connection-view.test.tsx` | `Automatic` tag on answered cards, the new footer. |
| `tests/demo/scenarios.test.ts` | `interrupt forever` interrupts on the first run and on a resume. `SCENARIOS` and the seven quick messages are unchanged. |
| `automation.spec.ts` (e2e, runtime harness) | Resolve and cancel: the recorded second request matches the manual one after identifiers are replaced. A payload for `approval` reaches the agent exactly, including one that misses the schema. Scripted results for both tools. A mixed run. `interrupt forever`: 11 runs, the notice, a manual answer continues. Stop in a chain. Marks in the conversation. Network allowlist. |
| `settings.spec.ts` (e2e) | Choose Resolve and write a script in the panel, export, reload, import, same settings. A 0.1.0 file loads. A bad file shows the error and keeps the profile. |
| `app.spec.ts` (e2e, real app) | The panel's Resolve reaches the next run through the app's wiring. |

## Risks

| Risk | Handling |
| --- | --- |
| A second code path drifts from the manual one. | One shared continuation builder and the same answer functions. An equality test in each message mode. |
| The agent names a tool `constructor` or `__proto__`. | `Object.hasOwn` lookup and a unit test ([research R3](research.md)). |
| A session or profile file written by this version is read by 0.1.0. | Not supported and not promised. 0.1.0 rejects unknown keys, as the existing format rules say. The 0.2.0 changelog mentions the new keys. |
| `automaticTurn` runs while the user pressed New thread. | `execute` only sets replies when its thread is still current, so nothing is owed and the chain ends. |
| The demo or its tests count scenarios. | The new scenario is outside `SCENARIOS` ([research R9](research.md)). A test pins the quick messages. |
| The docs claim "never answers automatically" in several places. | Task list names every page and the docs test is updated ([tasks.md](tasks.md)). |
