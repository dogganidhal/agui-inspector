# Research: Protobuf streams

Every decision below was checked against the code at `5c21caa`, the pinned packages in `node_modules` (read from
their source maps) and the upstream docs on 2026-10-04. Nothing is left open. Issue
[#77](https://github.com/dogganidhal/agui-inspector/issues/77) (spec 007) and
[#74](https://github.com/dogganidhal/agui-inspector/issues/74) (client automation) are in flight, and the plan says
where each one touches this work.

## 1. What upstream does

**Decision**: Build on exactly these facts, and test each one that the inspector copies.

- `@ag-ui/proto` 1.0.1 is on npm. `@ag-ui/client` 1.0.1 and `@ag-ui/encoder` 1.0.1 depend on exactly that version. It
  exports `encode`, `decode`, `AGUI_MEDIA_TYPE` (`application/vnd.ag-ui.event+proto`) and `AGUIUnknownEventTypeError`.
- `HttpAgent.requestInit` sets `Accept: text/event-stream` after the configured headers, so it cannot be changed by a
  header setting. A server written with `EventEncoder({ accept })` answers in protobuf when the `Accept` value
  includes the media type.
- The client chooses its parser from the response `content-type` by strict equality with the media type. A value with
  a parameter, such as `; charset=utf-8`, is read as server-sent events.
- `parseProtoStream` reads a four-byte big-endian unsigned length and then that many bytes. It fails a frame when
  `4 + length` is above 10 MB, fails the stream if it ends inside a frame, and drops an event from a later protocol
  with a console warning. The 10 MB constant is not exported, so the inspector keeps its own copy and a test pins it.
- `decode(Uint8Array)` returns a plain event with JSON-safe values. It throws `AGUIUnknownEventTypeError` for an event
  from a later protocol and `Error("Invalid event")` for bytes it cannot read (empty, truncated, garbage).
- All 31 fixtures in `examples/reference-agent/protocol-fixtures.ts` encode and decode to schema-valid events equal to
  the originals (checked with a script on 2026-10-04). A decoded event with a timestamp, `rawEvent` and metadata is
  also JSON-clean (numbers, no `bigint`).
- `AbstractAgent.connectAgent` and the missing `HttpAgent.connect` are out of scope (issue #95). The spec records the
  evidence.

**Rationale**: The inspector must read what a real server sends, and the only authority for the framing and the event
shape is the pinned upstream code (constitution principle II).

## 2. How the encoding reaches the server

**Decision**: Extend `ResponseKind` from `'sse' | 'response'` to `'sse' | 'protobuf' | 'response'`. The guarded
transport turns it into the `Accept` header (`text/event-stream`, `AGUI_MEDIA_TYPE`, or the JSON and text list). The
runtime passes the kind of the chosen encoding for every conversation run, continuation, surface action and raw
submission. Preparation requests and configuration loading keep `'response'`.

The protocol client's own `Accept` is not involved. The runtime already gives `HttpAgent` a `fetch` that ignores
`init.headers` and calls the transport with its own kind, so `RunAgent.requestInit` stays as it is.

The request names only the protobuf media type. The inspector reads the answer in the chosen encoding and does not
read headers, so it cannot let the server pick.

**Rationale**: `ResponseKind` is already "the caller says what body to expect; nothing inspects Content-Type or any
header". A third value keeps that rule, keeps the recorder blind to headers (constitution principle IV, MVP FR-007) and
touches one map in the transport.

**Alternatives considered**:

- A header option on the transport request: lets the caller send any `Accept`, which breaks the rule that the
  transport owns that header.
- Listing both encodings in `Accept` and detecting the answer from `content-type`: needs a header read in or next to
  the recorder.
- Sniffing the first bytes (a real frame starts with `0x00` because the length stays under 16 MB): a heuristic that
  hides a server bug instead of showing it. The inspector shows the mismatch (decision 5).

## 3. Which reader gets the bytes

**Decision**: `RecordedRequest.responseKind` already reaches the recorder. When it is `'protobuf'` and the answer is
2xx, the recorder treats the body as a stream, as it does for `'sse'`, and writes `encoding: 'protobuf'` on the
exchange it appends. SSE exchanges write no `encoding`, so an SSE-only session exports exactly as before. The frame
sink remembers which exchanges are protobuf when `appendExchange` passes it, and starts a protobuf reader for them. A
missing `encoding` means server-sent events.

The recorder change is two lines: the streaming test (`responseKind !== 'response'`) and the `encoding` field.

**Rationale**: Smallest recorder edit, no header read, and the exchange carries what an import and the views need.
Issue #77 rewrites the recorder's `addFinding`, so keeping the edit this small keeps the rebase small.

**Alternatives considered**: A `readAs` argument on `appendChunk` (changes the sink interface and every test double);
a separate recorder for protobuf (duplicates the cancel, abort and failure logic).

## 4. What the client sees

**Decision**: `canonicalizeLineEndings` runs only on the SSE branch. The runtime applies it when the chosen encoding
is `'sse'` and returns the recorder's original response for `'protobuf'`. The recorder already hands the original
response to the client, so for protobuf the client reads the bytes as received.

A regression test sends a text delta with `\r\n` in it. In protobuf those are bytes inside a payload. If the
canonicalizer ran, it would drop the `LF`, shorten the payload below its length prefix and fail the stream.

The comment in `line-endings.ts` that says binary transports are out of scope changes. Constitution principle I needs
no amendment: its exception covers "CRLF and bare CR line endings" of an event stream, and nothing is rewritten for
protobuf.

**Alternatives considered**: Making the canonicalizer skip binary bodies by content (a header read or a guess).

## 5. Reading binary frames

**Decision**: A second reader, `createProtobufFrameReader`, in `core/frames/index.ts` next to the server-sent-events
reader. It has the same interface (`push(bytes, offsetMs)` and `end(subject)`), the same output, and it shares one
judging step with the first reader (decision 7).

It keeps one growing buffer of bytes it has not yet turned into frames. On each `push` it:

1. Reads the length at the buffer start when four bytes are there. When `4 + length` is above 10 MB it marks the
   stream unreadable and stops splitting.
2. Takes the frame when `4 + length` bytes are there, and gives it the offset of this `push`. A frame completes in the
   read that carries its last byte, so that offset is the rule that SSE frames follow too.
3. Repeats, then drops the consumed bytes from the buffer.

On `end`, bytes still in the buffer become one `partial` frame. The same happens after an unreadable length, with the
`binary` finding. Then the terminal finding is added when no valid terminal event was seen.

Each frame is decoded with `decode` on the bytes after the prefix. Outcomes:

| Bytes | Frame | Verdicts | Finding |
| --- | --- | --- | --- |
| Decode returns an event | `data`, `parsed` set, `eventType` set | json `not-applicable`, schema from the existing check | `schema` when the check fails |
| Decode throws `AGUIUnknownEventTypeError` | `data`, no `parsed`, no `eventType` | json `not-applicable`, schema `unknown-type` | `schema`: unknown event type |
| Decode throws anything else, or the message is empty | `data`, no `parsed` | json `not-applicable`, schema `not-applicable` | `binary`: undecodable |
| Stream ends inside a frame | `partial`, bytes kept | not applicable | none, like a cut-off SSE event |
| Frame larger than 10 MB | `partial`, the rest of the stream | not applicable | `binary`: unreadable |

`parsed` is `JSON.parse(JSON.stringify(event))`, so it is inert JSON like the SSE value. If that throws, the frame is
treated as undecodable. This cannot happen for the 31 baseline types.

The 10 MB limit mirrors the client so that the inspector flags what the client fails on. It is also what catches an
answer in the wrong encoding: the first four bytes of `data: ` read as a length are 1.7 GB.

**Rationale**: The reader judges and never edits (the existing header of `frames/index.ts`). A frame is kept
whatever its content, and the offset rule is the same one, so SC-004 can be tested by cutting at every byte.

**Alternatives considered**: A separate file for the reader (it needs `checkEvent`, the summary and the terminal set,
which are in `index.ts`, so a second file would import from the first and the first from the second); resynchronising
after a bad length (a binary stream has no marker to find the next frame); a hard memory cap on the buffer (the store
holds every byte anyway).

## 6. How a binary frame is stored

**Decision**: `RawFrame` gains one optional field, `bytes`: the frame's bytes exactly as received, length prefix
included, as base64 text. For a binary frame `envelope` is `''` and `data` is absent. Everything else keeps its
meaning: `parsed` is the decoded event, `eventType` and `summary` as for SSE, `jsonVerdict` is `not-applicable`.

The store invariant "a `data` frame has `data` text" becomes: a `data` frame has exactly one of `data` and `bytes`; a
`partial` frame may have `bytes`; a `control` frame has neither.

`Exchange` gains `encoding?: 'sse' | 'protobuf'` (written only for protobuf). `FindingKind` gains `binary`.

**Rationale**: `projection` reads only `classification`, `schemaVerdict` and `parsed`, so decoded events feed the
conversation, state, interrupt, tool and A2UI views with no change. Base64 is one text form that survives the store,
`JSON.stringify` (copy as JSON and export), React identity checks and import. A `Uint8Array` in the store would make
`copyFramesJson` print an object of numbers and would need a conversion at every boundary.

**Alternatives considered**:

- `data` holding the decoded JSON text: it would make derived text look like received text and break the rule that raw
  evidence stays distinguishable (principle I).
- Hexadecimal in the file: doubles the size where base64 adds a third (spec clarification 2).
- A new `BinaryFrame` type next to `RawFrame`: every consumer (store, projection, views, export, import) would switch
  on it.
- `envelope` optional: changes a required field that every reader assumes. An empty string for a frame that has no
  text envelope is the smaller change, and import checks it.

## 7. One judging step for both readers

**Decision**: Move the tail of `appendDataFrame` (the schema check with its try/catch, the verdicts, the terminal
tracking and the findings) into one function that both readers call with a parsed value. The binary reader adds only
the framing and the decode.

**Rationale**: Issue #77 adds `compat` and `capability` checks in exactly that tail. If the tail is shared, a protobuf
frame gets the same checks as an SSE frame with no second change. The rebase is done first (plan step 1), so the
refactor moves #77's version of the code.

**Alternatives considered**: Copying the tail into the binary reader (two copies of the code that #77 is changing).

## 8. Findings and the #77 catalogue

**Decision**: One new kind, `binary`, and these findings:

| Problem | Subject | Kind |
| --- | --- | --- |
| Bytes that cannot be decoded | frame | `binary` |
| A frame larger than 10 MB (the rest of the stream) | frame | `binary` |
| The protocol client could not read the stream (decode failed, the stream ended in a frame, a frame above the limit) | run | `binary` |
| Decoded event fails the schema | frame | `schema` |
| Event from a later protocol | frame | `schema` |
| No valid terminal event | run or exchange | `terminal` |

The run finding comes from the client's own errors. `clientFailure` in the runtime gets one more case that matches
the three messages of `parseProtoStream` (`Failed to decode protocol buffer message`, `The binary stream ended
mid-frame`, `Protobuf message size exceeded`). A compatibility test pins each message to the client that raises it, as
issue #77 does for sequence errors.

Issue #77 merged (as #94) before this feature, so each finding carries a rule id in that catalogue's grammar. The new
rows are `binary.undecodable-frame` (frame), `binary.unreadable-stream` (frame) and `binary.client-failed` (run), and
`binary` joins the list of families. The catalogue now has 42 rules, and `ruleFixtures` has a fixture for each new one: the
protobuf scenarios `undecodablePayload` and `oversizedLength` through the reader, and `undecodablePayload` through the
runtime and the real client. The other findings reuse existing rules: `schema.unknown-event-type`,
`schema.invalid-event` and `terminal.missing`. Because the reader's judging step is shared, a protobuf frame also gets the
`compat` and `capability` rules.

**Rationale**: Reusing `json` would say "not valid JSON" about bytes. Reusing `schema` for undecodable bytes would
mean the data is not a valid event, which hides that no event was read. `terminal` and `schema` already say the right
thing for the other cases.

## 9. Session files

**Decision**: Version stays 0. New optional fields: `exchange.encoding`, `frame.bytes`, and the finding kind
`binary`. Export writes them only when they apply, so an SSE-only session is byte-identical to today's. Import:

- `bytes` must be canonical base64 (decode then encode gives the same text).
- A frame has `bytes` exactly when its exchange has `encoding: 'protobuf'`, and then `envelope` is `''`, `data` is
  absent and `jsonVerdict` is `not-applicable`.
- A `data` frame's bytes are one whole frame (the length prefix equals the rest). Decoding them with the upstream
  decoder must give the stated result: an event equal to `parsed` (and `eventType` equal to its type), or an
  unknown-event error with `schemaVerdict: 'unknown-type'`, or another error with `schemaVerdict: 'not-applicable'`
  and no `parsed`. A `schemaVerdict` of `valid` must agree with the schema check, as it does for SSE.
- A `partial` frame with bytes has no `parsed` and `not-applicable` verdicts. A `control` frame has no bytes.
- The existing order, offset, id and exchange checks apply to binary frames unchanged.

**Rationale**: This is the rule of issue #42 (reject inconsistent recordings) applied to the new field: a file in which
the bytes and the decoded event disagree is rejected with a message that names the frame. It re-runs the same decoder
the reader used, so a valid export always imports.

**Alternatives considered**: Recomputing `parsed` on import and ignoring the file's value (hides an edited file);
trusting the file (the rule of #42 forbids it).

## 10. Views

**Decision**:

- `model.ts`: `typeLabel` and `summarizeFrame` read `parsed` when it is present rather than `jsonVerdict`, and say
  `undecodable` or `unknown event` for a binary frame that has no event. `frameMatches` searches the type and the
  decoded JSON text of a binary frame. A helper `hexDump(base64, limit)` gives the text, the shown count and the total.
  A `byteLength` of a binary frame comes from the base64 length.
- `frames.tsx`: a `binary` tag on the frame row's summary cell. The detail shows `Bytes · N B as received`, the first
  4,096 bytes as hexadecimal (sixteen per line, two digits per byte), and `Decoded` as formatted JSON. Two copy buttons
  give all the bytes in the same text format, or the event as JSON. The exchange row shows a `protobuf` tag when
  `exchange.encoding` is `protobuf`.
- `settings/index.tsx`: an `Encoding` row, a segmented control like `Message mode`, with `Preset default`,
  `Server-sent events` and `Protobuf`. It is two steps from the main page: open Settings and choose.

**Alternatives considered**: A new column for the encoding (the row grid is fixed and a tag in the summary cell needs no
new column).

## 11. Profile and preset

**Decision**: `ClientProfileSettings.encoding?: 'sse' | 'protobuf'` and `Preset.encoding?: 'sse' | 'protobuf'`. A
shared `encodingFor(profile, presetEncoding)` returns the profile's value, then the preset's, then `'sse'`. The
runtime calls it from `dispatch` (with the prepared preset) and from `sendRaw` (with the selected agent's preset). It
follows the `messageMode` precedent exactly: profile overrides preset.

Raw submissions use only the encoding from the profile and the preset. They still send the typed body unchanged and use
no other profile setting or preset.

Issue #74 adds more profile settings, so `SETTINGS`, `parseProfileSettings` and the envelope are three places that both
branches edit. The rebase is a list merge.

**Alternatives considered**: A profile-only setting (an adopter could not default their own server); a top-bar control
(the profile is already the place for what the client declares); a preset-only setting (a visitor could not try the
other encoding).

## 12. The reference agent

**Decision**:

- `examples/reference-agent/protobuf.ts` (new, environment-neutral): `frameProtobuf(event)` returns the four-byte
  big-endian length plus `encode(event)` from `@ag-ui/proto`; `toProtobuf(response)` converts a server-sent-events
  scenario response into a protobuf one, chunk for chunk, with its delays; `acceptsProtobuf(accept)`.
- The Node adapters choose by the request's `Accept` header, as `EventEncoder` does: `interactive-scenarios.ts`
  (used by the full-app end-to-end tests) and `server.ts` (the CLI fixture). The scenario producers still see no
  headers. Every interactive scenario (interrupts, tools, state, A2UI, slow, never finishes) is therefore available in
  protobuf, and the continuation after an interrupt or a tool result is tested through it too.
- `examples/reference-agent/protobuf-fixtures.ts` (new): recorder scenarios like the other fixture files. Complete runs
  (the 31 types, a failing run), cuts at every byte and in uneven pieces, and the damaged streams of user story 4.
  `tests/e2e/inspection/support.ts` serves them from `/scenario/<name>` with each scenario's announced content type.
- `@ag-ui/encoder` is not added. `encode` plus a four-byte prefix is six lines, and a unit test feeds the fixtures to
  the client's own `parseProtoStream`, which proves the framing against upstream.
- The demo service worker imports `scenarios.ts` and `pacing.ts` only, so the demo bundle does not contain the
  protobuf code. A check in `tests/demo/build.test.ts` is not added: nothing imports the module.

**Alternatives considered**: A separate `/agent-protobuf` route (tests the route, not the negotiation, and makes
`Accept` untested); adding the encoder (a new dependency for the same bytes).

## 13. Dependencies and bundle

**Decision**: `@ag-ui/proto` 1.0.1 becomes a direct dependency of `packages/inspector` (it already is in
`package-lock.json` through the client, and `THIRD_PARTY_NOTICES.txt` already lists it as bundled). The row in
`dependencies.mdx` says why: decoding the frames and the media type constant; the alternative that falls short is a
copy of the decoder, which would drift from the protocol. The bundle is 1,227,500 bytes minified and 308,758 gzipped
(limits 2,000,000 and 600,000), and the protobuf codec is already inside it because the client imports it, so the
change is not expected to move it. `npm run check:bundle` confirms.

`@ag-ui/proto` also declares `@protobuf-ts/protoc` as a dependency. It is installed already and lists as installed in
`THIRD_PARTY_NOTICES.txt`. Nothing changes.

## 14. Tests, docs and release

**Decision**: See the plan. In short: unit tests under `packages/inspector/tests` for the reader, the recorder, the
runtime, the profile and preset, the session files and the views model; end-to-end tests in `tests/e2e` against the
reference agent; a compatibility pin for the three upstream facts the inspector copies; docs in one new page and eight
edited ones; a changeset for `agui-inspector` and `agui-inspector-python` (the wheel ships the bundle).

## 15. Scope note for the maintainer

`ROADMAP.md` row 8 still says "The protobuf encoding and resumable runs through `connectAgent`". The maintainer narrowed
the issue and moved resumption to #95. The roadmap is outside this worker's remit, so the orchestrator changes the row.
