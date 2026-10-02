# Inspection evidence

`agui-inspector` is a working name. This page says what the inspector records from the wire and how
that differs from what it derives or reports about the transport. It covers the recorder
(`packages/inspector/src/core/recorder`), the frame reader (`src/core/frames`) and the session
store (`src/core/store`).

## What the recorder keeps

Every preparation request, conversation run request and raw submission becomes one exchange. The
recorder fills in:

| Field | Source |
| --- | --- |
| `kind`, `method`, `path`, optional run link | Told to the recorder by the caller. |
| `requestBody` | The exact text that was sent, whitespace and key order included. |
| `requestBodyJson` | The same text parsed, only when it is valid JSON. Absent otherwise. |
| `startedAt` | Wall-clock start, epoch milliseconds. |
| `status` | The response status, once a response exists. Absent for a transport failure. |
| `responseBody` | The response text, for an ordinary response or any non-2xx answer. |
| `elapsedMs` | Time from dispatch to the end of the exchange, on a monotonic clock. |
| `transport`, `transportError` | How the transport ended: `completed`, `transport-error` or `user-stopped`. |

An event stream is not stored as `responseBody`. Its bytes go to the frame reader as they arrive,
in chunks exactly as the network delivered them, each stamped with milliseconds since dispatch. The
recorder does not split them into frames and does not decide what any of them mean.

## What it never touches

The recorder reads no request headers and no response headers. It is not given a request object and
never copies one, so nothing about authentication can enter an exchange through it. It does not read
`Content-Type` either: the caller says whether an event stream is expected, and a server that
announces the wrong type changes nothing. The status is the one thing that matters beyond that. A
non-2xx answer to a run request is an error body, so it is kept as text and not read as events.

This does not decide how to treat a server that echoes a credential back in its body. That
conflict (G-07) is open, so response bytes are neither redacted nor singled out. Header isolation,
no header export and the export warning are required either way and are not affected.

## Captured, transport and derived evidence

Captured evidence is what crossed the wire: the request body, the status, the response body text,
and the event-stream bytes with their arrival offsets. It is never rewritten.

Transport status describes what the connection did and says nothing about the protocol. An exchange
can be `completed` while the run inside it ended in an error event, and a run that never sent a
terminal event can sit in an exchange the user stopped. Two kinds of finding come from the
recorder, both attached to the exchange:

- `transport`: the request failed before a response, or the connection failed mid-stream. The
  message is the error's name and message only.
- `capture`: the recorder's own output failed, for example because the sink threw. It is reported
  once, the client still receives its response, and the stream chunks stop at that point.

A user stop is not an error. The exchange becomes `user-stopped`, keeps the bytes already read, and
gets no finding. The recorder never creates a terminal event, a cancellation or an error event for a
stopped, failed or truncated stream. Missing-terminal findings and observed run outcomes come from
the frame reader and the store, which see the events.

Derived data, such as the client's conversation, state, and expanded chunk events, is outside the
recorder. It is labeled derived wherever it appears and never carries a raw frame index.

## How the client branch stays untouched

When a response arrives the recorder clones it before anything reads it. The clone is drained on its
own while the original goes straight back to the protocol client. The two branches read the same
bytes independently, so:

- a client that reads slowly does not delay recording, and a recorder that is behind does not
  delay the client;
- a client that rejects the stream, for example on a malformed frame or a sequence violation, does
  not stop recording, and the rest of the stream is still captured;
- the client gets the original `Response`, unread and unlocked.

Two limits come from the platform, not the recorder. The tee buffers for the slower branch without a
bound. The recorder reads promptly, so in practice it is the client branch that waits. And when a
connection fails or a run is aborted, bytes the platform had buffered but nobody had read yet are
discarded by the stream itself. The recorder keeps everything it read before that point.

Browsers hand the recorder's branch its own copy of each chunk. Some runtimes, such as Node 24, share
one buffer between both branches, so a client that overwrites a chunk it has read could alter the
recorder's view. The protocol client does not, and the recorder does not copy chunks to guard against it.

## Scenarios

`examples/reference-agent/recorder-fixtures.ts` holds deterministic scenarios, with no model and no
network. Each names the request the recorder is told about and the response bytes in arrival order.

| Scenario | What it exercises |
| --- | --- |
| `splitStream` | A valid run with LF, CRLF and CR delimiters cut into single bytes, so boundaries fall inside delimiters and multibyte characters. |
| `lfStream` | A valid LF-only run in uneven chunks, readable by the protocol client. |
| `coalescedStream` | The same run in one chunk. |
| `errorJsonBody` | A 422 JSON error answering a run request. |
| `errorTextBody` | A 503 plain-text error on a preparation request, split inside a multibyte character. |
| `transportFailure` | No response at all. |
| `midStreamFailure` | The connection drops after two events and half of a third. |
| `heldOpen` | Events, then silence until the user stops the run: no terminal event ever arrives. |
| `malformedThenValid` | Non-JSON, a schema-invalid event and an out-of-sequence event, followed by a valid ending. |

The tests in `packages/inspector/tests/recorder` run these through the recorder, trap header access
on the request and the response, and drive the protocol client through the failing streams.

## From bytes to frames

The recorder hands the frame reader the response bytes as they arrive. The reader decodes them as
streaming UTF-8 and splits them into blocks at blank lines. LF, CRLF and CR all end a line, in any
mix, and a CR at the very end of a chunk waits for the next byte to see whether an LF follows. Chunk
boundaries can fall anywhere, including inside a delimiter or a multibyte character; the frames come
out the same either way.

Each block becomes one frame, kept in arrival order with a zero-based `index` that counts every
frame in the exchange:

| Classification | What it is | Counts as an AG-UI frame |
| --- | --- | --- |
| `data` | A block with at least one `data` field. Several `data` lines are joined with a line feed. | Yes, even when the data is not JSON or not a valid event. |
| `control` | A comment (`: keepalive`), `event`, `id` or `retry` fields with no data, or a stray blank line. | No. |
| `partial` | Text left over when the stream ended before a closing blank line. SSE never dispatches it. | No. |

Every frame keeps `envelope`, the original text including every delimiter, so joining the envelopes
of an exchange gives back the decoded stream. `data` frames also keep `data`, the extracted value.
`offsetMs` is the offset of the chunk in which the envelope's last character arrived. A frame that
had to wait for a possible LF keeps the offset of the chunk that carried its final CR. Offsets never
decrease within an exchange, and a partial frame at the end carries the offset of the last chunk.
The retained-frame count in the 5,000-frame benchmark is the number of `data` frames.

Two limits of the text model: bytes that are not valid UTF-8 appear as U+FFFD in the envelope, since
a string cannot hold them, and a leading byte order mark stays in the envelope but is ignored when
the first field is read.

Control and partial frames are evidence of what the server sent. They get no event type, no parsed
value and no verdict, and the reader never turns them into an event.

## Verdicts and findings

For each `data` frame the reader first tries `JSON.parse`, then checks the parsed value with the
upstream `EventSchemas`. The result is two verdicts on the frame (`jsonVerdict`, `schemaVerdict`) and,
when something is wrong, one finding beside it:

| Case | `jsonVerdict` | `schemaVerdict` | Finding |
| --- | --- | --- | --- |
| Valid event | `valid` | `valid` | None. |
| Not JSON, including empty data | `invalid` | `not-applicable` | `json` |
| JSON object whose `type` is not one of the 31 baseline types | `valid` | `unknown-type` | `schema` |
| Known type with a wrong or missing field, or JSON that is not an object | `valid` | `invalid` | `schema` |

Findings are additive. The frame, its envelope, its data text and its parsed value are never
changed, repaired or dropped, and the parsed value keeps fields the schema does not know about.
Finding messages name the failing field and the kind of problem, not the received values. If the
validator itself throws, the frame is kept, marked `invalid`, and a finding says validation failed.

Sequence violations, such as a text message that never started, are not the reader's concern: the
events are individually valid, so the frames carry no finding. The protocol client reports them,
and the conversation layer attaches them to the run as `sequence` findings. They never stop the
reader or the recorder.

## Missing terminal events

When the stream ends, the reader checks whether it saw a `RUN_FINISHED` or `RUN_ERROR` frame that
passed the schema. If not, it adds one `terminal` finding. Things that do not satisfy it: a lookalike
that fails the schema (a `RUN_FINISHED` with no `runId`), text that mentions `RUN_FINISHED` but is not
JSON, and a valid `RUN_FINISHED` cut off before its closing blank line. This holds however the stream
ended: a clean close, a dropped connection or a user stop.

The finding attaches to the exchange's run when that run is already in the store, otherwise to the
exchange. The finding is all the reader produces. It writes no run outcome, so the outcome stays
`unknown` until something observes one, and it invents no `RUN_ERROR` or cancellation.

## The session store

`createSessionStore` holds exchanges, raw frames, runs, findings and derived entries for one capture,
in memory. Appends take effect at once. Subscribers are notified at most once per animation frame
(`requestAnimationFrame`, or a scheduler passed in) however many appends happened in between, so a
busy stream never waits for a view. The core imports no React; a test checks that.

Raw frames, findings and derived entries are separate records. A finding points at a frame, a run or
an exchange by id and changes none of them. A derived entry, such as an expanded chunk, lists the
raw frames it came from, is labeled `derived`, and never has a frame index; when the source cannot
be identified it says `ambiguous` instead of guessing. An exchange's transport state and a run's
observed outcome are stored and updated independently: a `completed` exchange can hold a run that
ended in `RUN_ERROR`, and a `user-stopped` one can hold a run that never reached a terminal event.

The store refuses a call that would break an invariant a later export or import relies on, and
changes nothing when it does: duplicate ids, a frame index that is not the next one in its exchange,
an offset that goes backwards, references to things that do not exist. The recorder reports such a
refusal as a `capture` finding, and the reader for that exchange stops so it does not add a
misleading terminal finding on top.

`createFrameSink(store)` connects the recorder to the store. Exchange updates and findings go
straight in, chunks go through a frame reader, and an exchange's reader ends before the store hears
that the exchange is over. Finding ids from the reader are derived from frame and exchange ids, so
they cannot collide with the recorder's `finding-N` ids.

## Protocol fixtures

`examples/reference-agent/protocol-fixtures.ts` holds the F05 scenarios, deterministic and offline.
They use the recorder's scenario shape, so the same bytes go through recorder, reader and store.

| Fixture | What it exercises |
| --- | --- |
| `eventFixtures` | One schema-valid event for each of the 31 baseline types. |
| `invalidCases` | Non-JSON, unknown type and schema-invalid data, with the verdicts expected. |
| `baselineRun` | Thirty of the types in one run, with LF, CRLF and CR delimiters, cut into 1, 7, 64 and 4096 byte chunks. |
| `runError` | The 31st type, `RUN_ERROR`, as a valid terminal. |
| `invalidFrames` | Valid frames around every invalid class, ending correctly. |
| `sequenceViolations` | Valid events in an invalid order, ending in `RUN_FINISHED`. |
| `controlEvidence` | Comments, field-only blocks and blank lines, between and inside data frames. |
| `missingTerminalScenarios` | A close after content, an empty stream, two lookalike terminals, a cut-off `RUN_FINISHED` and a cut inside a multibyte character. |

The 5,000-frame fixture from `tests/benchmarks` is played through recorder, reader and store in
`packages/inspector/tests/frames/workload.test.ts`. The test checks that exactly 5,000 `data` frames
come out, that each exchange's envelopes and data text hash to the manifest, that every frame's
type and byte sizes match its manifest row, that offsets match the chunk each frame ended in, and
that only the 100 invalid frames have findings.

G-07 (a server that echoes a credential in its body) is still open. Nothing here redacts, hashes or
singles out frame text, and the reader copies none of it into summaries or findings beyond an
identifier such as a message id.
