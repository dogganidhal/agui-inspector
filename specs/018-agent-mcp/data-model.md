# Data model: Headless sessions for tests and agents

Existing types (`Exchange`, `RawFrame`, `Finding`, `Run`, `SessionEnvelope`, `ConversationModel`, `ClientProfile`,
`JsonValue`) come from `packages/inspector/src/contracts.ts` and `core/projection` and do not change. The session file
format stays version 0.

## Session

One conversation with one target, in memory.

| Field | Meaning |
| --- | --- |
| target | A URL that passed feature 005's rules. Fixed for the session's life. |
| headers | Name and value pairs. Held in a closure of the `fetch` wrapper only. Not a field of any returned object. |
| runtime | `createRuntime` with its own store, the headless policy (R2), the profile, the clock and the ids. |
| surfaces | One `SurfaceSession` with the headless catalog (R3), fed from the store's activity frames. |
| timeoutMs | The step limit. |
| state | `open`, `closed`. A loaded session is always read-only and has no runtime. |

Transitions: `open` to `closed` on `close()` (stops capture, drops the wrapper and so the headers). A step on a closed
session rejects.

Validation: target and header rules of feature 005 when opening; interrupt and tool call ids must be pending; a surface
and component must exist for `a2ui.set` and `a2ui.fire`.

## Step

What a step returns once the session is idle or the limit passed.

| Field | Meaning |
| --- | --- |
| `idle` | True when no run is active and capture has ended. |
| `timedOut` | True when the limit passed and capture was stopped. |
| `waitingFor` | Interrupt and tool call ids still unanswered before a continuation can be sent. |
| `newFrames` | Count of frames recorded during the step. |
| `newFindings` | Findings recorded during the step. |
| `error` | The runtime's error text, when the step failed to send (refused target, non-2xx). Never holds a header value. |

## Pending

| Field | Meaning |
| --- | --- |
| `interrupts` | `{ id, reason?, message?, responseSchema? }` for each unanswered interrupt, with the reason and message the run declared. |
| `toolCalls` | `{ id, name, argumentsText, arguments? }` for each client tool call without a result; `arguments` when the text is valid JSON. |
| `notice` | The runtime's notice, such as the automatic-reply limit. |

## SurfaceView

A2UI v0.9 surface as the session holds it.

| Field | Meaning |
| --- | --- |
| `activityId` | The activity message that carries the surface. |
| `surfaceId` | From the stream. |
| `catalogId` | The catalog id the stream's `createSurface` named, an alias included. |
| `components` | `{ id, type, props }`. A `{ path }` binding reads from the data model; other values stay as sent, so reading never runs a function. |
| `dataModel` | The surface's data model. |
| `issues` | Problems the surface session reported: a refused `openUrl`, surface errors. |

## MCP session registry (milestone 3)

| Field | Meaning |
| --- | --- |
| id | Short random id returned by `open` or `load`. |
| session | A `Session` or a read-only one. |
| frame cursor | Opaque string for `frames` paging: the index of the next frame. |

Closing the registry (standard input closed) closes every session.

## Exit result (`run`)

| Code | Condition |
| --- | --- |
| 0 | Step idle, not timed out, no error, no findings. |
| 1 | Step error, or timed out. |
| 2 | Argument error, before any request. |
| 3 | Step idle, no error, at least one finding. |
