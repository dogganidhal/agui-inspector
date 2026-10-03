# Event views: conversation and state

How the 31 AG-UI event types reach the conversation and state views, and which of what you see was
received and which was derived. The frames list shows every type exactly as received; see
[inspection.md](inspection.md) for that.

## Received and derived

The recorder and frame reader keep **raw frames**: the text that crossed the wire, in arrival order,
with its offset. Nothing in these views changes them.

The conversation and state views show **derived** data. A projection reads the session and builds it
from frames that are valid events. Every entry lists the frames it came from, and anything the client
or the projection computed carries that mark in the interface:

| Derived item | How it is marked |
| --- | --- |
| Durations of runs and steps | Offset of the closing frame minus the opening frame. A tooltip says "Derived from frame offsets, not received". |
| Parsed tool arguments | Shown once the call completes; until then the raw fragments show. The fragments stay inspectable. |
| Expanded chunk events | Stored as derived entries with the chunk frame as their source. The chunk itself stays in the frames list, and the message, tool call or reasoning it opened carries a dashed `from …_CHUNK` tag. |
| Current state | Snapshots and deltas applied in order. See [State](#state). |
| The transcript | Entries built from events, plus the messages carried in each run's recorded input. |

Frames that are not valid events (not JSON, unknown type, failed schema) add nothing here. They keep
their finding in the frames list. If a valid event refers to something that never started, for
example `TEXT_MESSAGE_CONTENT` for an unknown message, the conversation lists it under "Not shown"
with its frame position. The projection never invents the missing start.

## Event mapping

| Family | Event types | Conversation | Inspection |
| --- | --- | --- | --- |
| Run | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR` | A run header: run id, `← parent` id, duration, outcome tag, result, pending tool calls, interrupt count, error message | Frames list; run boundaries |
| Steps | `STEP_STARTED`, `STEP_FINISHED` | A collapsible group with the step name and duration. Events between the two belong to it | Frames list |
| Text | `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` | A message entry that grows as deltas arrive, with a caret while it streams. Each delta is listed under the message | Frames list |
| Text chunks | `TEXT_MESSAGE_CHUNK` | The same entry, tagged `from TEXT_MESSAGE_CHUNK` | The chunk as received, and its derived expansion |
| Tool calls | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT` | A card: name, client or server tool, call id, streamed arguments, parsed arguments once complete, the result | Frames list |
| Tool chunks | `TOOL_CALL_CHUNK` | The same card, tagged `from TOOL_CALL_CHUNK` | The chunk as received, and its derived expansion |
| Reasoning | `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_END` | A collapsible entry, open while it streams | Frames list |
| Reasoning chunks | `REASONING_MESSAGE_CHUNK` | The same entry, tagged `from REASONING_MESSAGE_CHUNK` | The chunk as received, and its derived expansion |
| Encrypted reasoning | `REASONING_ENCRYPTED_VALUE` | A marker with subtype, entity id and size in bytes, and "not decoded". The value is not on the page | The raw value, in the frames list |
| State | `STATE_SNAPSHOT`, `STATE_DELTA` | None | The state view |
| Messages snapshot | `MESSAGES_SNAPSHOT` | A divider, "Transcript replaced by MESSAGES_SNAPSHOT", with added and removed counts | The lists of added and removed messages |
| Activities | `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` | A card with the activity type and the content, updated by each delta | Frames list |
| Subagents | `SUBAGENT_STARTED`, `SUBAGENT_FINISHED`, `SUBAGENT_ERROR` | One dashed marker per subagent, nested under its parent run, with a line for each start, finish or error | Frames list |
| Extension | `CUSTOM`, `RAW` | A marker with the name or source, and the value | Frames list |

Events with no card of their own (`*_END`, `STEP_FINISHED`, `ACTIVITY_DELTA`, `REASONING_END`) close
or update the entry they belong to. `STATE_SNAPSHOT` and `STATE_DELTA` are inspection-only: the
conversation shows nothing for them.

### Plain text

Conversation text is rendered as text. HTML does not run and Markdown is not interpreted, so
`**bold**` and `<img>` appear as typed. Optional Markdown rendering is outside 0.1.0.

### Runs

Each conversation exchange gets a run header, even before its first frame arrives. The outcome comes
from the terminal event:

| Tag | Source |
| --- | --- |
| Streaming | No terminal event yet, and the exchange is still open |
| Finished | `RUN_FINISHED` with a success outcome, or none |
| Interrupted | `RUN_FINISHED` with an interrupt outcome |
| Cancelled | `RUN_FINISHED` with a cancelled outcome |
| Error | `RUN_ERROR` |
| Stopped by you | The exchange ended by a user stop. This is transport status, not a protocol outcome |
| No terminal event | The stream ended without `RUN_FINISHED` or `RUN_ERROR`. No outcome is shown, and none is made up |

A success outcome names its pending tool calls. When it names none, the pending calls are the ones
the run started and never answered, as the protocol defines. Those cards read "Pending result".

A run's recorded input adds the user's turn to the transcript, plus a line saying what it carried:
resume answers, a tool result, or an A2UI action. Messages already shown (by id) are not repeated
when a run resends the full transcript. A result the user entered for a pending call joins the
original card and names the run that carried it.

### Chunks

A chunk expands the way the protocol client expands it. A chunk with a new id opens a message, tool
call or reasoning message; chunks without an id continue the open one. The next explicit event of
the same kind of lane, or the end of the run, closes it. `RAW`, activity events and `SUBAGENT_STARTED`
do not close anything.

Each expansion is a derived entry (`derivation: chunk-expansion`) whose `sources` is the chunk frame.
The closing event has no frame of its own, so its attribution is `ambiguous` and its source is the
last chunk of the stream. Entry ids are stable, so `publishChunkExpansions(store)` can run after every
store change and append only what is new. The assembly should call it so the frames list can show each
expansion under its chunk.

### Message snapshots

`MESSAGES_SNAPSHOT` replaces the transcript. The protocol client merges a snapshot into its messages;
the inspector replaces instead, because its job is to show what the snapshot did (FR-019). The
divider lists the messages the snapshot added and the ones it left out, with their text. What is
still arriving is kept: a streaming message, an open step or subagent, and an activity the snapshot
does not restate stay in place, so later deltas still find them. Run headers also stay.

### State

The current state is what the next run carries. It starts from the first run's recorded input state,
then applies each `STATE_SNAPSHOT` (replace) and `STATE_DELTA` (JSON Patch, RFC 6902) in order. The
state view lists every snapshot and delta, newest first, with its run, offset and one line per
operation.

A delta that cannot be applied is shown as "not applied" with the reason. The state stays at the last
valid value and the frame stays in the frames list. A new thread starts from its own state; earlier
exchanges stay in the session but are not part of the current conversation. The views show the thread
the assembly names with `threadId` (the runtime's), even before that thread has an exchange. Without
one they show the thread of the latest conversation exchange.

## Wiring it in

```tsx
import { ConversationView } from 'views/conversation/index';
import { StateView } from 'views/conversation/state';
import { publishChunkExpansions } from 'core/projection/index';
```

- `ConversationView` takes the frozen `ConversationViewProps`. It reads the store and renders
  outcomes and pending states. It offers no interrupt, tool-result or composer controls: those are
  the connection lane's. Its optional `renderActivity(entry)` prop lets the assembly draw an
  activity's content, for example an A2UI surface, inside the card. The card gets a Rendered and JSON
  switch when it returns something.
- `StateView` takes `{ store }` and an optional `threadId`, with the same meaning as on `ConversationView`.
- Neither module imports a stylesheet, so importing them never changes what the build emits. The
  assembly loads `views/theme/index.ts` and `views/conversation/conversation.css`. The stylesheet
  uses the theme tokens only (`--agui-*` and the tokens derived from them) and defines none.
- The views read the store with `useSyncExternalStore`, so they follow its animation-frame batching.

Entries are built from raw frames alone. The projection does not depend on the client's callbacks,
which means it also works on an imported recording. It follows the client's reducer rules for text,
tool calls, chunks and state.

## Tests

```sh
npm run test:unit -- packages/inspector/tests/conversation
npm run test:e2e -- tests/e2e/conversation
```

`events.test.ts` has one case per event type and fails to compile if one is missing.
`workload.test.ts` projects the frozen 5,000-frame workload. The browser spec streams events into a
fixture host (`packages/inspector/tests/conversation/fixture.tsx`) and checks live text,
interleaving, every family's presentation, opaque encrypted reasoning, plain-text safety, token-only
styling in both color schemes, and zero requests outside the page's origin.
