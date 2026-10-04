---

description: "Task list for protobuf streams (issue #80, spec 013)"
---

# Tasks: Protobuf streams

**Input**: [spec](./spec.md), [plan](./plan.md), [research](./research.md), [data model](./data-model.md),
[contracts](./contracts/), [validation guide](./quickstart.md).

**Tests**: Required. The constitution says behavior changes have regression tests and that end-to-end tests use the
reference agent only. Test tasks come before the code they check, in the same story.

**Format**: `- [ ] Txxx [P] [USn] Description with file path`. `[P]` means the task touches different files from every
other open task in its phase and has no unfinished dependency. Paths are from the repository root.

**Order of work**: Phase 1 and 2 block everything. US1 and US2 are both P1. US1 can be tested through the scripted host
(`packages/inspector/tests/inspection/host.tsx`) with no Settings control, and US2 through the runtime with a fake
`fetch`. The full-app end-to-end test (T028) needs both. US3, US4 and US5 follow. Resumption (`connectAgent`) is out of
scope, issue #95.

## Phase 1: Setup

- [X] T001 Rebase before any code: `git fetch origin && git rebase origin/main`. Resolve conflicts and keep every
  feature that merged first. Then record in your notes which of these exist, because later tasks branch on them:
  `packages/inspector/src/core/rules/catalogue.ts` (issue #77 merged), interrupt or tool automation fields in
  `packages/inspector/src/core/profiles/index.ts` (issue #74 merged). Re-read `core/frames/index.ts`,
  `core/recorder/index.ts`, `core/session-files/index.ts` and `core/store/index.ts` as they are after the rebase before
  editing them.
- [X] T002 Add `"@ag-ui/proto": "1.0.1"` (exact, no range) to `dependencies` in `packages/inspector/package.json`. Run
  `npm install --package-lock-only --ignore-scripts` and check that `package-lock.json` changes only in the
  `packages/inspector` workspace entry. Run `npm ci --ignore-scripts`.
- [X] T003 [P] Add a row for `@ag-ui/proto` 1.0.1 to the runtime table in `website/content/docs/dependencies.mdx`. Purpose:
  decodes protobuf frames and gives the media type; it is already bundled through `@ag-ui/client`, which depends on
  exactly this version. Rejected alternative: a copy of the decoder, which would drift from the protocol. Run
  `npm run test:unit -- packages/inspector/tests/foundation/policy.test.ts`. Also check that
  `packages/inspector/THIRD_PARTY_NOTICES.txt` and the two package copies still equal the root file (the notice already
  lists `@ag-ui/proto@1.0.1` as bundled, so no change is expected).

## Phase 2: Foundation (blocks every story)

- [X] T004 In `packages/inspector/src/contracts.ts` add: `export type Encoding = 'sse' | 'protobuf'`;
  `ClientProfileSettings.encoding?: Encoding`; `Preset.encoding?: Encoding`; `ResponseKind` becomes
  `'sse' | 'protobuf' | 'response'`; `Exchange.encoding?: Encoding` (written only for `protobuf`, absent means server-sent
  events); `RawFrame.bytes?: string` (the frame's bytes exactly as received, length prefix included, canonical base64;
  for such a frame `envelope` is `''` and `data` is absent); `FindingKind` gains `'binary'`. Doc comments say what each
  field means. Update `packages/inspector/tests/foundation/contracts.test.ts` if it pins these unions.
- [X] T005 [P] Write `packages/inspector/tests/frames/bytes.test.ts` first, then `packages/inspector/src/core/frames/bytes.ts`
  with `toBase64(bytes: Uint8Array): string`, `fromBase64(text: string): Uint8Array | undefined` (undefined unless the
  text is canonical: decoding then encoding gives the same text), `byteCountOf(base64: string): number` and
  `hexDump(base64: string, limit: number): { text: string; shown: number; total: number }` (two lowercase hex digits per
  byte, one space between bytes, sixteen bytes per line). Tests: every byte value round trips; arrays above 64 KB do not
  overflow the stack; padding and non-canonical spellings are rejected; `hexDump` stops at the limit and reports shown and
  total.
- [X] T006 Write the failing cases in `packages/inspector/tests/frames/store.test.ts`, then change `appendFrame` in
  `packages/inspector/src/core/store/index.ts`. Invariant: `data` frame has exactly one of `data` and `bytes`; `partial`
  frame has no `data` and may have `bytes`; `control` frame has neither. The existing rules stay (unique ids, `index`
  equals the exchange's frame count, `offsetMs` never goes back). Update any existing test that quotes the old message.
- [X] T007 In `packages/inspector/src/core/frames/index.ts` extract the tail of `appendDataFrame` (the schema check with its
  try/catch, the verdicts, `terminalSeen`, and the findings) into one function that takes the base fields, the parsed
  value and the JSON verdict, so a second reader can call it. Behavior for server-sent events must not change:
  `npm run test:unit -- packages/inspector/tests/frames` passes untouched. If T001 found the rule catalogue merged, the
  extracted function is the one that runs its `compat` and `capability` checks.

## Phase 3: US1 Record and read a protobuf run (P1)

**Goal**: A protobuf stream from the reference agent records every frame as received and shows it decoded.

**Independent test**: Through the scripted host, play the reference agent's protobuf baseline run. Check the frame count,
order, offsets, types, summaries, decoded content and bytes, and the conversation derived from it.

- [X] T008 [P] [US1] Create `examples/reference-agent/protobuf.ts` (environment-neutral, erasable TypeScript, imports no
  Node, React or worker module): `frameProtobuf(event: object): Uint8Array` (four-byte big-endian length, then `encode`
  from `@ag-ui/proto`), `toProtobuf(response: ScenarioResponse): ScenarioResponse` (each chunk that is one `data: <json>`
  frame becomes one protobuf frame; `delaysMs`, `ending` and `pacing` stay; `contentType` becomes `AGUI_MEDIA_TYPE`; a
  chunk that is not one frame throws with a clear message) and `acceptsProtobuf(accept: string | undefined): boolean` (the
  value lists the media type, with `q` not 0). Do not import it from `scenarios.ts`, `pacing.ts` or anything in `demo/`.
- [X] T009 [US1] Create `examples/reference-agent/protobuf-fixtures.ts` with `protobufScenarios`, typed like
  `protocolScenarios` (`RecorderScenario`, request `responseKind: 'protobuf'`, `announcedContentType` the media type):
  `baselineRun` (the same 30 types and order as `baselineRun` in `protocol-fixtures.ts`, one frame per event, split into
  uneven chunks `[1, 7, 64, 4096]`), `runError`, `splitByByte` (the baseline cut into chunks of one byte), and
  `evenFrames` (one chunk per frame). Reuse `eventFixtures` and `baselineRunTypes`. Damaged scenarios are added in T029.
- [X] T010 [P] [US1] Write `packages/inspector/tests/frames/protobuf-reader.test.ts` for the success path. All 31 baseline
  fixtures as protobuf frames give the same `eventType`, `summary` and `parsed` as the same events through the SSE reader,
  with one test for each type, generated from `eventFixtures` (constitution principle VI: a dedicated fixture test per type).
  The baseline cut at every byte position and in uneven pieces gives the same frames, bytes and order (SC-004). A frame's
  `offsetMs` is that of the `push` that carried its last byte; several frames in one `push` share it; offsets never go
  back. A run through `createFrameSink` and a real store ends with the `terminal` finding absent for a valid run and
  present for a stream with no terminal event. A 5,000-frame protobuf session through the reader and a real store finishes within the bound that the existing workload test
  in `packages/inspector/tests/frames/workload.test.ts` uses for server-sent events (read that test first and reuse its helper
  and bound), and a 10 MB frame fed in 64 KB reads does not copy the whole buffer per read (assert on time, loosely, or on
  the number of copies if the implementation counts them). A reader whose output throws behaves like the SSE reader. `push` after `end`
  throws. The reference fixtures are read by `parseProtoStream` from `@ag-ui/client` (framing proof).
- [X] T011 [US1] Add `createProtobufFrameReader(output, exchangeId, options)` to `packages/inspector/src/core/frames/index.ts`
  with the same `FrameReader` interface. Keep a growing buffer of bytes not yet framed (do not copy the whole stream on
  each read). A frame is a four-byte big-endian length `L` then `L` bytes; when `4 + L` bytes are present, append a `data`
  frame with `bytes` (base64 of the whole frame, prefix included), `envelope: ''`, no `data`, `jsonVerdict:
  'not-applicable'`, the offset of this push, and the decoded event through the T007 tail (`decode` from `@ag-ui/proto` on
  the payload, `parsed` is `JSON.parse(JSON.stringify(event))`, `eventType` is its `type`, `summary` from the same
  summarizer). Frame ids are `<exchange id>:frame-<n>`. `end` adds the terminal finding as the SSE reader does. Failure
  paths are T033.
- [X] T012 [US1] In `createFrameSink` (same file) remember the exchanges that `appendExchange` passes with
  `encoding === 'protobuf'` and start `createProtobufFrameReader` for them; every other exchange keeps the SSE reader. In
  `packages/inspector/src/core/recorder/index.ts` change the streaming test to `request.responseKind !== 'response' &&
  response.ok` and add `...(request.responseKind === 'protobuf' && { encoding: 'protobuf' as const })` to the appended
  exchange. These are the only recorder edits.
- [X] T013 [P] [US1] Extend `packages/inspector/tests/recorder/recorder.test.ts`: a `protobuf` request records an exchange
  with `encoding: 'protobuf'` and passes the chunks to the sink as bytes; an `sse` request records no `encoding`; the
  response handed back is the original; no header is read (extend the existing check); stop and a dropped connection end
  as for SSE. Reuse `protobufScenarios` through `scenarioSend`.
- [X] T014 [P] [US1] Write `packages/inspector/tests/conversation/protobuf.test.ts`: the baseline protobuf run and the same
  events as SSE give the same projected conversation (messages, state, tool calls, interrupts), so decoded frames feed the
  views with no change (FR-008).
- [X] T015 [US1] Update `packages/inspector/src/views/inspection/model.ts`: `typeLabel` and `summarizeFrame` read `parsed`
  when present instead of `jsonVerdict`, and give `undecodable` or `unknown event` for a binary frame with no event;
  `frameMatches` searches the type and `JSON.stringify(parsed)` for a binary frame; `byteLength` of a binary frame comes
  from `byteCountOf(frame.bytes)`. Tests in `packages/inspector/tests/inspection/frames.test.ts` for decoded, unknown,
  undecodable and partial frames, the filter, and `hexDump` at the 4,096-byte limit with shown and total counts.
- [X] T016 [US1] Update `packages/inspector/src/views/inspection/frames.tsx` and
  `packages/inspector/src/views/inspection/inspection.css`: a `binary` tag in the frame row's summary cell (attribute
  `data-frame-binary`); the exchange row shows a `protobuf` tag when `exchange.encoding === 'protobuf'`; `FrameDetail` for a
  binary frame shows `Bytes · N B as received` (with how many bytes are not shown), the first 4,096 bytes as `hexDump`,
  `Decoded` as formatted JSON when `parsed` exists, the findings, and two copy buttons (`Copy bytes` gives all the bytes in the
  hex format, `Copy event` gives the event as JSON). `copyFramesJson` keeps working unchanged. Keep the existing
  accessibility rules (labels on buttons, `aria-expanded`).
- [X] T017 [US1] Let the scripted host and the e2e support server run protobuf: `packages/inspector/tests/inspection/host.tsx`
  `run(path, body?, encoding?)` passes `responseKind` from the encoding; `tests/e2e/inspection/support.ts` serves
  `protobufScenarios` from `/scenario/protobuf/<name>` (the prefix keeps `baselineRun` and `runError` from clashing with
  `protocolScenarios`) with each scenario's `announcedContentType`, and exposes them to `run` by that path.
- [X] T018 [US1] Add to `tests/e2e/inspection/frames.spec.ts`: run `protobuf` baseline; one frame per message the scenario
  wrote; the exchange shows the `protobuf` tag; rows show type, summary, offset and the `binary` tag; expanding a frame
  shows the decoded JSON and the hex text that starts with the four length bytes; a frame over 4,096 bytes says how many
  bytes are not shown; both copy buttons put the expected text on the clipboard; the filter finds a binary frame by type and
  by decoded content; concatenated recorded bytes equal the bytes written (SC-001). Call the allowlist check the other specs in the file call.

## Phase 4: US2 Choose the encoding (P1)

**Goal**: The inspector asks for the chosen encoding on every run request and raw submission, and the choice is a profile
setting with a preset default.

**Independent test**: Through the runtime with a fake `fetch`, read the `Accept` of each kind of request with protobuf and
with server-sent events chosen.

- [X] T019 [P] [US2] Profile. Tests first in `packages/inspector/tests/config/settings.test.ts`: `encoding` parses, exports (only
  when set), imports and persists; absent means the default; a value other than `"sse"` or `"protobuf"` fails with
  `profile.encoding must be "sse" or "protobuf"` and keeps the previous profile; a 0.1.0 profile file imports unchanged.
  Then `packages/inspector/src/core/profiles/index.ts`: add `'encoding'` to `SETTINGS`, validate it in
  `parseProfileSettings`, include it in the envelope only when set, and export `encodingFor(profile, presetEncoding): Encoding`
  (profile, then preset, then `'sse'`). If T001 found #74 merged, merge the three lists by hand.
- [X] T020 [P] [US2] Preset. Tests first in `packages/inspector/tests/config/settings.test.ts` (or the preset tests it holds): `preset.encoding`
  accepts the two values and rejects anything else naming the field; the configuration loader reports it like any invalid
  preset field. Then `packages/inspector/src/core/presets/index.ts`: add `'encoding'` to the keys `parsePreset` accepts and
  `encoding` to `PreparedPreset` (`preset?.encoding`, undefined when not set).
- [X] T021 [US2] Transport. Tests first in `packages/inspector/tests/runtime/transport.test.ts`: `responseKind: 'protobuf'` sends
  `Accept: application/vnd.ag-ui.event+proto` and nothing else; `'sse'` and `'response'` are as before. Then
  `packages/inspector/src/core/runtime/transport.ts`: `ACCEPT.protobuf` is `AGUI_MEDIA_TYPE` imported from `@ag-ui/proto`.
- [X] T022 [US2] Runtime. Tests first in `packages/inspector/tests/runtime/runtime.test.ts` and
  `packages/inspector/tests/runtime/line-endings.test.ts`: the `Accept` is the media type for a run, a continuation after
  interrupts or tool results, a surface action and a raw submission when protobuf is chosen, and `text/event-stream`
  otherwise; preparation requests keep the JSON `Accept`; every request body is identical with and without the setting;
  profile beats preset beats default; a change applies to the next request, the thread keeps its messages and state, and
  earlier exchanges keep their `encoding`; the token header is sent on a protobuf request through the transport only; the
  protocol client reads a protobuf stream whose text delta contains `\r\n` unharmed, which fails if the line-ending copy ran
  (the exemption test). Then `packages/inspector/src/core/runtime/index.ts`: compute the encoding with `encodingFor(settings.profile,
  prepared.value.encoding)` in `dispatch` and pass it to `execute`; use it as the `responseKind` of both the `record` call and
  `transport.send`; apply `canonicalizeLineEndings` only when the encoding is `'sse'`; in `sendRaw` use
  `encodingFor(options.settings().profile, agent?.preset?.encoding)` for the same two places. Update the comment in
  `packages/inspector/src/core/runtime/line-endings.ts` (the copy is for server-sent events only).
- [X] T023 [US2] Settings view. Tests first in `packages/inspector/tests/config/settings-view.test.tsx`: an `Encoding` row with a
  segmented control (`Preset default`, `Server-sent events`, `Protobuf`) whose hint shows the selected agent's preset default;
  choosing `Preset default` removes the field; a choice calls `onChangeProfile` with the field set. Then
  `packages/inspector/src/views/settings/index.tsx`, beside the `Message mode` row, built the same way.
- [X] T024 [P] [US2] Reference agent adapters. Tests first in `packages/inspector/tests/foundation/reference-agent.test.ts`:
  `POST /agent` on `server.ts` answers `application/vnd.ag-ui.event+proto` for `Accept: application/vnd.ag-ui.event+proto`
  and `text/event-stream` otherwise, and the protobuf body decodes (with `parseProtoStream` from `@ag-ui/client`) to the
  same events as the SSE body. Then `examples/reference-agent/server.ts` and `examples/reference-agent/interactive-scenarios.ts`:
  when the `Accept` header lists the media type, answer with `toProtobuf(response)` (after pacing, so delays line up); the
  producers see no header. In the interactive server record the `accept` value on each `RecordedRequest` and keep the bytes
  written per run response (`sent()` returns them), so end-to-end tests can compare. Do not touch `demo/`.
- [X] T025 [US2] Full-app end-to-end test `tests/e2e/runtime/protobuf.spec.ts`, using the runtime harness
  (`packages/inspector/tests/runtime/harness.tsx`) and `createInteractiveServer`. Set the profile encoding to protobuf, send a
  message: the server's recorded `accept` is the media type, the exchange has `encoding: 'protobuf'`, the frame count equals the
  messages written and the concatenated bytes equal what the server wrote (SC-001, SC-005). Repeat the `interrupt` and `tools`
  scenarios: the continuation after the answers also asks for protobuf and the conversation shows the replies. A preset
  default of protobuf is used until the profile says otherwise. Switching back to server-sent events gives an exchange with no
  `encoding`. Check the network allowlist in every test, as `interactive.spec.ts` does.
- [X] T026 [P] [US2] Prove the assembled app in `tests/e2e/hosted/protobuf.spec.ts` (its scripted agent in `tests/e2e/hosted/support.ts` answers by `Accept`):
  the `Encoding` control is reachable in two steps from the main page (open Settings, choose), the request asks for protobuf, the
  choice survives a reload through the saved profile, Preset default asks for server-sent events again, and an exported session
  imports back with the same bytes (SC-002, SC-007). This replaces a test in `tests/e2e/config/settings.spec.ts`, whose harness does
  not use the runtime.

## Phase 5: US3 Keep binary evidence in recordings (P2)

**Goal**: Export and import keep binary frames byte for byte.

**Independent test**: Record a protobuf run, export, import, compare bytes, decoded content, order and offsets.

- [X] T027 [US3] Tests first in `packages/inspector/tests/inspection/session.test.ts`. Round trip keeps every frame's `bytes`,
  order, `offsetMs`, decoded `parsed` and findings. An SSE-only session exports with none of `encoding` or `bytes`. A 0.1.0
  file imports. One failing file for each check of [contracts/recording-format.md](./contracts/recording-format.md): `bytes`
  not canonical base64; a frame with `bytes` in an exchange without `encoding: "protobuf"` and the reverse; `bytes` on a
  `control` frame; `envelope` not `""`, `data` present, or `jsonVerdict` not `not-applicable` on a binary frame; a `data` frame
  whose length prefix does not equal the rest; `parsed` that does not equal the decoded event; `eventType` that is not its
  type; `unknown-type` with a `parsed`; `not-applicable` for bytes that decode; a binary frame whose `index` or `offsetMs` breaks the
  order rules (US3 scenario 3); `schemaVerdict: "valid"` that the schema check
  rejects; a `partial` frame with `parsed`; finding kind `binary` accepted. Each error names the first problem and the file
  loads nothing. The export has no header. Then `packages/inspector/src/core/session-files/index.ts`: `frameOut` writes `bytes`,
  `exchangeOut` writes `encoding`, `FINDING_KINDS` gains `binary`, `checkExchange` and `checkFrame` accept the fields,
  `checkSession` cross-checks exchange and frames, and the import decoding uses `decode` and `AGUIUnknownEventTypeError` from
  `@ag-ui/proto` and `fromBase64` from T005. `restoreSession` needs no change beyond the store invariant of T006.
- [X] T028 [US3] Add to `tests/e2e/inspection/session.spec.ts`: run the protobuf baseline, export, check the dialog still warns that
  frames can hold sensitive data and that no header is exported, import the file into a fresh page, and compare every frame's
  bytes with the original (SC-002). A file with one byte changed in a frame's `bytes` is refused with an error that names the
  frame and loads nothing. Check the network allowlist as the other specs in the file do.

## Phase 6: US4 Damaged or unexpected binary is still evidence (P2)

**Goal**: Whatever arrives is kept and flagged. Nothing is dropped, repaired or reordered, and capture goes on.

**Independent test**: Run each damaged reference stream and check that every byte is in the recording with the expected finding.

- [X] T029 [US4] Add the damaged scenarios to `examples/reference-agent/protobuf-fixtures.ts`: `undecodablePayload` (a frame of garbage
  bytes between valid frames), `zeroLength` (a frame with length 0), `unknownEvent` (a frame whose envelope names a field this
  build does not know, for example the bytes `9a 06 02 08 01`, which `decode` rejects with `AGUIUnknownEventTypeError`),
  `invalidEvent` (a `RUN_FINISHED` encoded without `runId`, which decodes but fails the schema), `truncatedFrame` (the stream ends
  inside a frame), `oversizedLength` (valid frames, then a length prefix of 10 MB plus one and more bytes), and `answeredInSse` (the
  existing SSE baseline played for a `protobuf` request).
- [X] T030 [US4] Write the failing cases in `packages/inspector/tests/frames/protobuf-reader.test.ts` for each damaged scenario.
  Undecodable payload and zero length: `data` frame, no `parsed`, `schemaVerdict: 'not-applicable'`, `binary` finding. Unknown
  event: `data` frame, `schemaVerdict: 'unknown-type'`, no `eventType`, `schema` finding. Invalid event: `schema` finding. Truncated
  frame (including a cut inside the length prefix): one `partial` frame with the bytes and no finding of its own. Oversized length:
  frames before it unchanged; one `partial` frame holds every byte from that prefix to the end of the stream (check across several
  `push` calls) with a `binary` finding and the last read's offset. `answeredInSse`: the same, because `data: ` read as a length is far
  above the limit. A frame of exactly 10,485,760 bytes including the prefix is read as a frame. Messages never carry received values.
- [X] T031 [US4] Implement those paths in `createProtobufFrameReader` in `packages/inspector/src/core/frames/index.ts`: constant
  `MAX_FRAME_BYTES = 10 * 1024 * 1024` with a comment that it mirrors `parseProtoStream` in `@ag-ui/client` 1.0.1; `decode` outcomes of
  [contracts/binary-frames.md](./contracts/binary-frames.md) (returns an event, `AGUIUnknownEventTypeError`, any other error, an event that
  cannot be turned into JSON); `end` turns leftover bytes into one `partial` frame; after an unreadable length stop splitting and keep
  every later byte for one `partial` frame with a `binary` finding; summaries and messages as the contract lists them.
- [X] T032 [P] [US4] Add the pins to `packages/inspector/tests/foundation/compatibility.test.ts`, the way the line-ending pin is written. A
  frame of 10 MB including the prefix is accepted and one byte more is refused by `parseProtoStream`, and `MAX_FRAME_BYTES` equals that
  limit. The three client messages the inspector matches (`Failed to decode protocol buffer message`, `The binary stream ended mid-frame`,
  `Protobuf message size exceeded maximum limit`) are the ones the real client raises for the reference damaged streams. A response with
  `content-type` `application/vnd.ag-ui.event+proto; charset=utf-8` is read by the client as server-sent events, so the docs warning is true.
  An unknown event arm is dropped by the client with a warning while the inspector keeps it.
- [X] T033 [US4] `clientFailure` in `packages/inspector/src/core/runtime/index.ts`: return `{ kind: 'binary', message }` (clipped, no received
  values) for an `Error` whose message starts with one of the three client messages of T032, so the run gets a finding and no banner. Test in
  `packages/inspector/tests/runtime/runtime.test.ts`: a damaged protobuf run through the runtime gives the run a `binary` finding, keeps
  every recorded frame, and sets no `error` banner. If T001 found the rule catalogue merged, add the `binary` family and the rules
  `binary.undecodable-frame`, `binary.unreadable-stream` and `binary.client-failed` to `core/rules/catalogue.ts` in its grammar, give each
  finding its rule id, and add a fixture for each rule the way its catalogue test requires (a rule without a fixture fails the type check).
- [X] T034 [P] [US4] Recorder test in `packages/inspector/tests/recorder/recorder.test.ts`: a status outside 200 to 299 answer to a `protobuf`
  request keeps its body as text and records no frame (FR-011).
- [X] T035 [US4] End-to-end test in `tests/e2e/inspection/frames.spec.ts` (through `/scenario/<name>`): each damaged scenario shows every byte
  it sent, in order, with the expected finding label on the frame, the exchange ends in its real transport state, and capture continues after
  the damaged frame. For `answeredInSse` the finding text names the likely cause (a server that answers in another encoding). Stop in the
  middle of a frame keeps the received bytes as a `partial` frame. Check the network allowlist as the other specs in the file do.

## Phase 7: US5 Learn how to pick the encoding (P2)

**Goal**: The docs explain the choice, the request, the server side, the findings and the recordings. Short sentences, no em dashes, no
marketing, no bold labels.

**Independent test**: Follow only the new page to record a protobuf run from the reference agent.

- [X] T036 [US5] Create `website/content/docs/protobuf.mdx` ("Protobuf streams") and add `"protobuf"` to `website/content/docs/meta.json` after
  `"inspection"`. Cover: how to choose the encoding in Settings and in a preset (JSON example), what the inspector sends (the `Accept`
  header), what a server must send (the exact media type as `content-type` with no parameter, a four-byte big-endian length before each
  message, and that `EventEncoder` from `@ag-ui/encoder` does both), what frames, bytes and decoded events look like, the findings and what
  each means, how recordings keep the bytes, the limits (10 MB per frame, no detection from the response, a protobuf request names only the
  protobuf media type), and that resuming runs through `connectAgent` is not part of this release (issue #95). Link the page from the places
  of T037 to T039.
- [X] T037 [P] [US5] Edit `website/content/docs/runs.mdx` (the request headers row: `Accept` follows the encoding; the raw submissions section:
  they follow the encoding and send the typed body unchanged), `website/content/docs/configuration.mdx` (the client profile table gains
  `encoding`, optional, with its two values) and `website/content/docs/presets.mdx` (`encoding` as the default for one agent, the profile
  overrides it as it does the message mode).
- [X] T038 [P] [US5] Edit `website/content/docs/recordings.mdx` (the optional fields `encoding` and `bytes`, base64, the new import checks,
  the finding kind `binary`, version 0 unchanged, the sensitive-data warning covers binary frames), `website/content/docs/inspection.mdx`
  (the binary frame row and detail, the 4,096-byte hex view, the two copy buttons, the `protobuf` tag) and
  `website/content/docs/troubleshooting.mdx` (three entries: a content type with a parameter makes the client read server-sent events; an
  answer in the other encoding shows the unreadable-stream finding; an error status answer to a protobuf request is kept as text).
- [X] T039 [P] [US5] Edit `website/content/docs/internals.mdx` (the second reader, the shared judging step, the client reading the original
  response, the line-ending copy for server-sent events only, why the recorder reads no header), `website/content/docs/event-views.mdx` (one
  line: the same views over both encodings), `website/content/docs/index.mdx` and `website/content/docs/status.mdx` (server-sent events is no
  longer the only encoding; the AG-UI row) and `README.md` (the line that says frames are server-sent events). Re-read each file first, because
  issue #86 edits some of them.
- [X] T040 [US5] Run the `humanizer` skill on the new and changed docs text and fix what it finds. Check that no file in `website/content/docs`
  has an em dash from this change (`git diff -U0 -- website README.md | grep '^+' | grep -nP '\x{2014}'` prints nothing).

## Phase 8: Polish and gate

- [X] T041 Add `.changeset/protobuf-streams-npm.md` for `agui-inspector` (minor) and `.changeset/protobuf-streams-python.md` for
  `agui-inspector-python` (minor, the wheel ships the bundle). Text: protobuf streams are recorded and decoded; the encoding is a client
  profile setting with a preset default; profiles and session files gain optional fields and stay at version 0; nothing to migrate. Plain
  short sentences. Do not edit any version by hand.
- [X] T042 Run `npm run typecheck`, `npm run build` and `npm run check:bundle`. The bundle must stay within 2,000,000 bytes minified and
  600,000 gzipped (before this change 1,227,500 and 308,758). Build the demo with
  `node scripts/build-demo.mjs --outdir .build/protobuf-demo-check` and check that `grep -c 'vnd.ag-ui.event+proto'
  .build/protobuf-demo-check/service-worker.js` prints 0, because nothing under `demo/` imports `examples/reference-agent/protobuf.ts`.
  Delete the scratch directory afterwards.
- [X] T043 Run the targeted suites from [quickstart.md](./quickstart.md) (steps 2 and 3) with `--workers=2` for end-to-end, then
  `npm run check:ci`. Fix every failure. Note any check that cannot run on this machine.
- [X] T044 Run `/speckit-converge` if code and spec disagree, then `/ponytail:ponytail-review` on the diff and fix what it finds. Run the
  `humanizer` skill on the pull request body.
- [X] T045 Rebase on `origin/main` again, push with `--force-with-lease`, update the pull request body with
  `gh api -X PATCH repos/dogganidhal/agui-inspector/pulls/<n> -F body=@<file>`, run `gh pr ready <n>`, and end with the line
  `GATE PR-READY PR #<n>`.

## Dependencies and order

```text
T001 -> T002 -> T003 (parallel with T004)
T004 -> T005 (parallel with T006) ; T006 -> T007
Foundation done -> US1 and US2 can start together
US1: T008 and T009 -> T010 -> T011 -> T012 -> T013 and T014 (parallel) ; T015 -> T016 -> T017 -> T018
US2: T019, T020, T021 (parallel) -> T022 (needs T008 for the protobuf frames of its tests) -> T023 ; T024 (parallel with the others) -> T025 (needs US1 and US2) ; T026 after T023
US3: T027 -> T028 (T028 needs T017)
US4: T029 -> T030 -> T031 ; T032 and T034 (parallel) ; T033 needs T031 and T032 ; T035 needs T017 and T031
US5: T036 -> T037, T038, T039 (parallel) -> T040
Polish: T041 -> T042 -> T043 -> T044 -> T045
```

## Parallel examples

- After T007: T008 (reference agent module), T005's tests, T019 (profile), T020 (preset) and T021 (transport) touch different
  files.
- After T011 and T012: T013 (recorder tests), T014 (conversation test) and T015 (views model) are independent.
- T037, T038 and T039 are three docs groups with disjoint files.

## Implementation strategy

1. T001 to T007: the rebase, the dependency and the foundation. Stop and run `npm run test:unit` to prove the refactor changed nothing
   for server-sent events.
2. US1 and US2 together are the first shippable slice: a developer can choose protobuf and read the run. T025 is the proof.
3. US3 and US4 make it trustworthy (recordings and damaged streams). US5 makes it findable.
4. Do the polish tasks last, and run the whole gate once at the end.

## Scope guard

- No `connectAgent`, `connect()`, reconnection or resume work (issue #95).
- No detection of the encoding from the response, no fallback list in `Accept`.
- No demo example for protobuf. No edit to `ROADMAP.md` or to another feature's spec directory.
- No new dependency except `@ag-ui/proto` 1.0.1.
