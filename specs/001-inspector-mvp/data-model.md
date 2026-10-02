# Data model: inspector MVP

All persistent/exchange formats are pre-stable version 0. This is a design contract, not a
published version-1 schema. JSON means null, boolean, finite number, string, array, or an object
of JSON values; no executable content. Protocol fields use the pinned `@ag-ui/core` types rather
than locally redefined protocol schemas.

## Entities and relationships

| Entity | Fields and relationships | Validation/invariants |
| --- | --- | --- |
| Agent configuration | `id`, optional `name`, `url`, optional inline `capabilities` or capabilities URL, optional `preset`; configuration contains `agents[]` | Unique nonempty id; URL resolved according to mode and deployment policy; no credentials/header fields or URL userinfo |
| Preset | Variables keyed by name with default and text/JSON kind; ordered preparation method/path/body entries; forwarded properties; `messages: full \| turn`; quick-message strings | Full is default; undefined variables/invalid edited JSON fail visibly before dispatch; built-in threadId/runId/uuid cannot be redefined; no credential configuration |
| Client profile | Protocol version, tools with JSON Schemas, context, A2UI render/tool-injection switches, message mode, forwarded properties | Validate with protocol types where applicable; unique tool names; only these settings persist/export; token/header state is not a field |
| Inspection session | Version, session id, ordered exchanges, runs, raw frames, and separate derived inspection data | In memory until explicit export; no header fields; import is inspect-only; unknown version/invalid references fail visibly before replacing active session |
| Run | Thread/run/optional parent ids, recorded input, exchange id, start/end timing, observed protocol outcome/result, pending tool calls, interrupts, run findings | Protocol schema on ordinary input; no ordinary dispatch until preparation/reply barriers pass; run outcome is distinct from transport completion |
| Exchange | Id, kind (`preparation`, `conversation`, `raw`), optional run link, method, path, exact request-body text, optional parsed body, optional response status/body text, start time, elapsed duration, transport status/error, frames | Every dispatched request gets one; status may be absent for transport errors; header access/storage excluded; path contains no credential userinfo |
| Raw frame | Id, exchange id, zero-based arrival index, original envelope text, extracted data text, offset milliseconds, identifiable type, summary, JSON/schema verdict, findings; optional parsed JSON | Append-only arrival order; raw text unchanged; offsets monotonic/nonnegative; invalid/unknown values retained; SSE-only comment/control evidence explicitly distinguished from AG-UI data frames |
| Finding | Kind (`json`, `schema`, `sequence`, `terminal`, `transport`, `capture`, `projection`), message, frame or run reference | Findings never mutate evidence; client sequence errors attach to run; EOF missing observed RUN_FINISHED/RUN_ERROR adds terminal finding even after stop |
| Derived event/entry | Source raw-frame links where identifiable, derived provenance, protocol type, message/role or run/step/subagent marker, delta/argument/result/activity presentation | No derived event masquerades as a received frame; original chunks remain visible; ambiguous source attribution is marked rather than invented |
| State/activity snapshot | Current client state; activity id/type/content; message-snapshot replacement marker with added/removed messages | Apply valid updates via protocol client; preserve last valid state on projection error and show error; no historical state-navigation feature |
| Interrupt answer | Run/interrupt identity, response schema, draft JSON value, status (`unanswered`, `resolved`, `cancelled`) | Exact protocol resume-entry shape from upstream; all interrupts must be answered before continuation |
| Tool result | Run/tool-call identity, accumulated argument text, optional completed parsed arguments, draft/result message, status | Stream arguments as text, parse at completion; malformed complete arguments remain inspectable; all pending calls need manual results |
| A2UI action | `name`, `surfaceId`, `sourceComponentId`, JSON `context`, `timestamp` | Preserve supplied fields in forwardedProps.a2uiAction.userAction; timestamp from renderer/action source; new run goes through ordinary preparation |
| Volatile connection state | Selected target/agent, chosen auth-header name, entered token, active abort controller | Memory-only, not part of session/profile/config; default header Authorization; clear token on target change/reload; stop requests through explicit controller |

## State transitions

**Exchange transport:** created -> sending -> streaming or reading -> completed; alternatively
transport-error or user-stopped. Capture completion is tracked separately from the protocol client's
completion so schema/sequence errors cannot quietly discard remaining wire evidence.

**Run:** idle -> preparing -> running -> observed success/interruption/cancellation/error; a failed
preparation produces local failed-to-dispatch state with recorded preparation exchanges and no agent
request. EOF/user stop without a terminal event produces an unknown protocol outcome plus finding,
not a fabricated RUN_ERROR or cancellation. New thread creates new identifiers and clears current
conversation/state without rewriting the retained prior exchanges.

**Continuation:** waiting-for-interrupts or waiting-for-tool-results -> ready only when every required
answer/result exists -> preparing -> next run. Submitting a subset never starts it. Resolve and
Cancel are protocol resume answers, whereas Stop is a transport/user control. They must not share
an invented event implementation.

**Import:** reading -> validated -> inspect-only session, or visible import-error with the previous
session preserved. Validate the whole envelope, references, count/index/timing consistency and
header absence before committing state; importing never triggers preparation or run requests.

**Profile:** in-memory edit -> validated settings -> explicit save/export; reload/import restores
settings, not volatile auth. Invalid JSON, unsupported version, or invalid setting shape shows an
error and leaves the previous valid profile intact.

## Raw versus derived data

Copy/export of frames uses the original raw-frame records in arrival order. Conversation text is
plain text, not interpreted HTML/Markdown. Raw editor input preserves the user's exact JSON text
including whitespace and key order; parsed JSON is only a validation/inspection companion.
Client state, expanded chunks and calculated durations are labeled derived and cannot overwrite
received evidence. Authentication headers are injected only at the guarded transport boundary.

The server-echoed credential collision is unresolved [G-07](plan.md#open-decision-and-approval-gates).
This model neither authorizes redaction nor claims an absolute no-echo guarantee. Raw sensitive
payloads require the export warning regardless of that future decision.
