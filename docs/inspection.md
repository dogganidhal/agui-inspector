# Inspection evidence

`agui-inspector` is a working name. This page says what the inspector records from the wire and how
that differs from what it derives or reports about the transport. It covers the recorder
(`packages/inspector/src/core/recorder`). The frame reader and the store add their own sections
when they land.

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
