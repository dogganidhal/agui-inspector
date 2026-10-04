# Data model: Protobuf streams

Nothing new is stored on a server. All persisted formats stay at version 0, and every new field is optional, so a
0.1.0 profile, configuration or session still loads. The types are in `packages/inspector/src/contracts.ts`; the
rules for each file are in [contracts/](./contracts/).

## Encoding

`type Encoding = 'sse' | 'protobuf'`. What a run asks the server to send, and how its answer is read.

| Where | Field | Rule |
| --- | --- | --- |
| Client profile | `encoding?: Encoding` | Absent means "use the preset's default". Saved, exported and imported with the profile. |
| Preset | `encoding?: Encoding` | The default for one configured agent. Absent means `sse`. |
| Effective value | `encodingFor(profile, presetEncoding)` | Profile, then preset, then `sse`. Computed for each request, never stored. |

## ResponseKind

`'sse' | 'protobuf' | 'response'` (was `'sse' | 'response'`). The caller says what body to expect. The guarded
transport maps it to the `Accept` header, and nothing reads a response header.

| Kind | `Accept` | Who uses it |
| --- | --- | --- |
| `sse` | `text/event-stream` | Conversation runs and raw submissions with encoding `sse`. |
| `protobuf` | `application/vnd.ag-ui.event+proto` | The same requests with encoding `protobuf`. |
| `response` | `application/json, text/plain;q=0.9, */*;q=0.1` | Preparation requests, configuration and capability loading. |

## Exchange

Gains `encoding?: Encoding`. The recorder writes it only when the request's kind is `protobuf`. Absent means the
exchange was read as server-sent events (and, for a preparation, that it was not a stream). An import accepts both
values.

## RawFrame

Gains `bytes?: string`.

| Field | Server-sent events frame | Binary frame (`bytes` set) |
| --- | --- | --- |
| `classification` | `data`, `control`, `partial` | `data` (a whole frame), `partial` (cut off, or unreadable rest of the stream) |
| `envelope` | The original text | `''` |
| `data` | The extracted data text | Absent |
| `bytes` | Absent | The frame's bytes as received, length prefix included, canonical base64 |
| `jsonVerdict` | `valid`, `invalid`, `not-applicable` | `not-applicable` |
| `schemaVerdict` | As today | `valid` or `invalid` when decoded; `unknown-type` for an event from a later protocol; `not-applicable` when undecodable or partial |
| `parsed` | The JSON value | The decoded event as JSON; absent when not decoded |
| `eventType` | When identifiable | The decoded event's type; absent when not decoded |
| `summary` | The reader's one line | The same one line from the decoded event, or a fixed text when there is no event |
| `offsetMs` | The read that completed the envelope | The read that carried the frame's last byte |

A binary frame appears only in an exchange whose `encoding` is `protobuf`, and every frame of such an exchange has
`bytes`.

### Store invariant

| Classification | `data` | `bytes` |
| --- | --- | --- |
| `data` | exactly one of the two | exactly one of the two |
| `partial` | absent | optional |
| `control` | absent | absent |

The existing rules stay: ids are unique, `index` equals the number of frames the exchange already has, and `offsetMs`
never goes back.

## Finding

`FindingKind` gains `binary`. Messages name fields and kinds of problem, never received values.

| Problem | Subject | Kind |
| --- | --- | --- |
| Bytes that cannot be decoded | frame | `binary` |
| A frame larger than 10 MB, and the rest of the stream | frame | `binary` |
| The protocol client could not read the stream | run | `binary` |
| Decoded event fails the schema | frame | `schema` |
| Event from a later protocol | frame | `schema` |
| No valid terminal event | run or exchange | `terminal` |

A frame has at most one finding of its own, as for server-sent events (id `<frame id>:finding`).

## Binary reader state

One reader per protobuf exchange, created when the sink first sees the exchange.

```text
reading  --push: whole frame in buffer-->  reading            (frame appended, offset of this push)
reading  --push: frame above 10 MB-->      unreadable         (no more splitting)
reading  --end-->                          ended              (buffer left: one partial frame; terminal finding if none seen)
unreadable --push-->                       unreadable         (bytes added to the rest)
unreadable --end-->                        ended              (one partial frame with a binary finding; terminal finding)
ended    --end-->                          ended              (nothing)
```

`push` after `end` is an error, as for the server-sent-events reader. The reader keeps no more than the bytes it has not
yet turned into a frame, plus the frames it has handed to the store.

## Session file

Optional fields only; see [contracts/recording-format.md](./contracts/recording-format.md). A session with no protobuf
exchange exports with no new field.
