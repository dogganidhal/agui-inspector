# Contract: session files with binary frames

The session format stays version 0. This feature adds optional fields and one finding kind. A file without them is
valid, and a session with no protobuf exchange exports with none of them. Code: `packages/inspector/src/core/
session-files/index.ts`.

## Fields

| Record | Field | Type | When written |
| --- | --- | --- | --- |
| Exchange | `encoding` | `"sse"` or `"protobuf"` | Only for `"protobuf"`. Import accepts both. |
| Frame | `bytes` | base64 text | Only on a frame of a protobuf exchange. |
| Finding | `kind` | adds `"binary"` | When such a finding exists. |

`bytes` is the frame's bytes exactly as received, length prefix included, in standard base64 with padding and no line
breaks. Export copies it from the store. Nothing is re-encoded, so import restores the same bytes.

```json
{
  "id": "exchange-1:frame-2",
  "exchangeId": "exchange-1",
  "index": 2,
  "classification": "data",
  "envelope": "",
  "bytes": "AAAAEwoRCgASAm0xGglhc3Npc3RhbnQ=",
  "offsetMs": 41.5,
  "eventType": "TEXT_MESSAGE_START",
  "summary": "TEXT_MESSAGE_START messageId=m1",
  "jsonVerdict": "not-applicable",
  "schemaVerdict": "valid",
  "parsed": { "type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant" },
  "provenance": "raw"
}
```

The `bytes` value is the real frame for this event: `00 00 00 13` (length 19) and then 19 bytes of protobuf.

## Import checks

All checks run on the whole file before anything is built. The error names the first problem.

| Check | Message names |
| --- | --- |
| `bytes` is a string, canonical base64 (decoding then encoding gives the same text) | the frame |
| A frame has `bytes` exactly when its exchange has `encoding: "protobuf"` | the frame and the exchange |
| A `control` frame has no `bytes` | the frame |
| A frame with `bytes` has `envelope` `""`, no `data`, and `jsonVerdict` `not-applicable` | the frame and the field |
| A `data` frame's bytes are one whole frame: at least four bytes, and the length prefix equals the rest | the frame |
| Decoding the frame's payload with the upstream decoder gives an event: `parsed` is present and equals it, and `eventType` is its `type` | the frame |
| Decoding throws `AGUIUnknownEventTypeError`: `schemaVerdict` is `unknown-type`, with no `parsed` and no `eventType` | the frame |
| Decoding throws another error: `schemaVerdict` is `not-applicable`, with no `parsed` and no `eventType` | the frame |
| `schemaVerdict` `valid` agrees with the schema check on `parsed` (as for server-sent events) | the frame, the schema problems |
| A `partial` frame has `parsed` absent and both verdicts `not-applicable` | the frame |
| Order, offsets, ids, `frameIds` and findings that name a frame | as today |
| A finding kind is one of the known kinds, now including `binary` | the finding |

A file that fails any check shows the error and changes nothing, as today. Import makes no request and runs no decoded
content.

## Compatibility

- A 0.1.0 file imports unchanged: no field it uses changed.
- A file with the new fields does not import in 0.1.0 (it rejects unknown fields). That direction is not a goal.
- The changelog of both packages says that the format is still version 0 and that the new fields are optional
  (constitution: pre-1.0 changes document migration; there is none to do).
- The page `recordings.mdx` documents the fields, the checks and the sensitive-data warning for binary frames.

## Privacy

No header is exported. The warning before export stays: raw frames can hold sensitive data. It now covers binary
frames, because their bytes are the received evidence, including any echoed credential. Nothing is redacted.
