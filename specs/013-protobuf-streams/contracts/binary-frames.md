# Contract: reading binary frames

How the recorder and the frame reader turn a protobuf answer into frames. The reader is
`createProtobufFrameReader` in `packages/inspector/src/core/frames/index.ts`. The unit tests in
`packages/inspector/tests/frames/` check every row.

## The request

For a conversation run, a continuation, a surface action or a raw submission with encoding `protobuf`, the guarded
transport sends `Accept: application/vnd.ag-ui.event+proto` and no other media type. The body is unchanged. With
encoding `sse` the `Accept` is `text/event-stream`, as in 0.1.0. A preparation request keeps its JSON `Accept`.

## The answer

The recorder treats a 2xx answer to a `protobuf` request as a stream and copies its chunks to the sink as they arrive.
Any other status is an error body kept as text. No header is read. The exchange is appended with `encoding: 'protobuf'`.

## Framing

A frame is a four-byte big-endian unsigned length `L` followed by `L` bytes.

| Situation | Result |
| --- | --- |
| Four bytes are present and `4 + L` is at most 10,485,760 | The frame is complete when `4 + L` bytes are present. It is appended in the `push` that brought the last byte, with that `push`'s `offsetMs`. |
| `4 + L` is above 10,485,760 | The reader stops splitting. Every byte from this length prefix to the end of the stream is kept for one `partial` frame. |
| `L` is 0 | A complete frame of four bytes. It cannot be decoded, so it is a `data` frame with a `binary` finding. |
| Reads cut a frame anywhere, or hold several frames | The frames, their bytes and their order are the same as for one read. |
| The stream ends with bytes that are not a whole frame | One `partial` frame holds them. No finding of its own. |
| The stream ends after an unreadable length | One `partial` frame holds the rest, with a `binary` finding. Its offset is the last read's. |
| No valid `RUN_FINISHED` or `RUN_ERROR` was seen | One `terminal` finding on the run, or on the exchange when no run exists, as for server-sent events. |

Frame ids are `<exchange id>:frame-<n>` and `index` counts frames in the exchange from 0, as for server-sent events.

## Decoding

The bytes after the prefix go to `decode` from `@ag-ui/proto`.

| Decode | `classification` | `eventType`, `parsed` | `jsonVerdict` | `schemaVerdict` | Finding |
| --- | --- | --- | --- | --- | --- |
| Returns an event | `data` | its type, the event as JSON | `not-applicable` | `valid` or `invalid` from the existing check | `schema` when invalid |
| Throws `AGUIUnknownEventTypeError` | `data` | none | `not-applicable` | `unknown-type` | `schema`: unknown event type, not in the supported baseline |
| Throws another error | `data` | none | `not-applicable` | `not-applicable` | `binary`: not a decodable protobuf event |
| The event cannot be turned into JSON | as for another error | | | | |

A frame's `summary` is the SSE summary of its event (`summarize`), or `Not a decodable protobuf event · <n> bytes`, or
`Event from a later protocol (not decoded) · <n> bytes`, or, for a partial frame,
`Incomplete frame at the end of the stream (never dispatched)` or
`Bytes that cannot be read as length-prefixed frames · <n> bytes`.

## Findings

| Message | Kind | Subject |
| --- | --- | --- |
| `The bytes are not a valid protobuf event, so no event could be read` | `binary` | frame |
| `The stream states a frame larger than 10 MB, which no client reads. The rest of the stream is kept as raw bytes. A server that answers in another encoding than the one chosen looks like this` | `binary` | frame |
| `The protocol client could not read the binary stream: <the client's own words, clipped>` | `binary` | run |

Messages never carry received values. Findings never stop capture.

## What does not change

- The recorder reads no header and invents no frame, event or outcome, including when a run is stopped.
- The protocol client reads the original response. The line-ending copy (`canonicalizeLineEndings`) is applied to
  `sse` runs only.
- Client-derived entries (`derived`) keep their own provenance and never carry a frame index.
