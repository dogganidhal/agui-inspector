# Feature Specification: Protobuf streams

**Feature Branch**: `gh-80-protobuf-and-resume`

**Created**: 2026-10-04

**Status**: Draft for review

**Input**: Issue [#80](https://github.com/dogganidhal/agui-inspector/issues/80), "Record protobuf streams"
(0.2.0 roadmap item 8). The inspector reads server-sent events only. A server that answers in the AG-UI
protobuf encoding cannot be inspected today. This feature lets a developer ask for that encoding, records
its binary frames as received and shows each one decoded. The issue first also covered resuming runs
through `connectAgent`. That part moved to issue [#95](https://github.com/dogganidhal/agui-inspector/issues/95)
and is out of scope here (see Clarifications and Assumptions).

**Source**: [0.2.0 roadmap](../../ROADMAP.md), item 8. The [constitution](../../.specify/memory/constitution.md)
governs this feature, mainly principle I (the wire comes first), II (the protocol, not a framework), IV
(local-only operation and credential privacy), V (small and auditable) and VI (every event type has a view).
It extends [MVP](../001-inspector-mvp/spec.md) FR-007 to FR-010 (recording and inspection) and FR-034
(recordings).

## Clarifications

### Session 2026-10-04

- Q: Does this feature include resuming runs through `connectAgent`? A: No. The maintainer narrowed issue
  #80 to the protobuf encoding and moved resumption to issue #95. `@ag-ui/client` 1.0.1 has no network
  contract for it. `HttpAgent` has no `connect()`, so `connectAgent` resolves with an empty result and sends
  no request. Upstream defines no HTTP request, no resume rule and no server behavior for it. The 0.2.0
  roadmap plans only features that AG-UI has already released, so resumption waits for an upstream
  contract. Details are under Assumptions.
- Q: Which finding kinds do problems in binary frames use? A: One new kind, `binary`, for bytes that cannot
  be decoded and for framing that no client reads. Other problems keep the kinds they have today. A decoded
  event that fails the event schema is a `schema` finding. An event from a later protocol is a `schema`
  finding for an unknown event type. A stream with no terminal event is a `terminal` finding. Issue #77
  gives every finding a rule id. The new rules join that catalogue when this feature rebases on it.
- Q: In what form does a session file keep a binary frame's bytes? A: As base64 text in one optional field
  of the frame. It is exact and adds a third to the size, where hexadecimal text would double it. The
  hexadecimal text in the frame detail is for reading and copying only.
- Q: What does the recorder do after a frame length that no client reads? A: It stops splitting the stream
  into frames. The limit is the 10 MB that the protocol client enforces (the frame size, length prefix
  included, above 10,485,760 bytes), so the inspector flags what the client fails on. Every byte from the frame's length prefix to the end of the stream is kept, in arrival
  order, as one raw frame of the kind that marks unfinished evidence, with a `binary` finding. An answer
  in the wrong encoding looks like this, because text read as a length is far above the limit.
- Q: How much of a large binary frame does the frame detail show? A: The decoded event in full, as for any
  frame, and the first 4,096 bytes as hexadecimal text, with the total count and the number of bytes not
  shown. Copy always gives all the bytes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record and read a protobuf run (Priority: P1)

A developer whose server answers in the protobuf encoding chooses that encoding, sends a message and
reads the run. Every binary frame is in the frames list in arrival order with its offset. Each frame shows
its event type and a summary, and expanding it shows the decoded event and the bytes as received. The
conversation view shows the reply, state, interrupts and tool calls as it does for a server-sent-events
run.

**Why this priority**: It is the whole value of the feature. Without it a protobuf server shows nothing
useful.

**Independent Test**: Start the reference agent, choose protobuf, send a message to its protobuf scenario
and compare the recorded frames with the frames the agent sent. Check count, order, types and bytes.

**Acceptance Scenarios**:

1. **Given** the reference agent's protobuf scenario and the protobuf encoding chosen, **When** the
   developer sends a message, **Then** the exchange lists one frame for each binary message the server
   sent, in arrival order, each with an offset from the start of the request, an event type and a
   summary.
2. **Given** a recorded protobuf frame, **When** the developer expands it, **Then** it shows the decoded
   event as formatted JSON and the received bytes as hexadecimal text with their count, and Copy gives
   either one.
3. **Given** a protobuf run that includes each of the 31 baseline event types, **When** it is recorded,
   **Then** each type appears with the same label, summary and decoded content as the same event received
   as server-sent events.
4. **Given** a protobuf stream that the network delivers cut at any byte, including inside the length
   prefix, or with several frames in one read, **When** it is recorded, **Then** the frames and their bytes
   are the same as when it is delivered whole, and a frame's offset is that of the read that completed it.
5. **Given** a protobuf run that ends without `RUN_FINISHED` or `RUN_ERROR`, **When** the stream ends,
   **Then** the run gets the same terminal-event finding as a server-sent-events run.
6. **Given** a protobuf run, **When** it finishes, **Then** the conversation, state, interrupts, tool calls
   and A2UI surfaces are derived from it as they are for a server-sent-events run, and the run outcome
   matches the terminal event.

---

### User Story 2 - Choose the encoding (Priority: P1)

A developer picks the encoding in Settings, and a configured agent can set a default for its server. The
choice is part of the client profile. The inspector then asks the server for that encoding on every run
request and every raw submission.

**Why this priority**: The server only answers in protobuf when the request asks for it. Without the
choice there is nothing to record.

**Independent Test**: Choose protobuf, send a message and a raw request, and read what the reference agent
received. Switch back to server-sent events and repeat.

**Acceptance Scenarios**:

1. **Given** a fresh inspector, **When** the developer sends a message, **Then** the request asks for
   server-sent events exactly as in 0.1.0.
2. **Given** the protobuf encoding chosen in Settings, **When** the developer sends a message, a
   continuation after interrupts or tool results, a surface action or a raw submission, **Then** each of
   those requests asks for the protobuf encoding and for nothing else, and its body is exactly what it
   would be without the choice.
3. **Given** a configured agent whose preset sets protobuf as its default, **When** the developer selects
   that agent and sets nothing else, **Then** its runs use protobuf. **When** the developer chooses an
   encoding in Settings, **Then** that choice wins over the preset.
4. **Given** a client profile with the encoding set, **When** it is exported and imported, **Then** the
   choice comes back. **Given** a profile file from 0.1.0 without the field, **Then** it imports and means
   server-sent events.
5. **Given** a profile or preset with an encoding value the inspector does not know, **When** it is
   imported or loaded, **Then** the developer sees an error that names the field and the accepted values,
   and the previous profile stays in use.
6. **Given** a conversation with earlier exchanges, **When** the developer changes the encoding, **Then**
   the next request uses it, the thread continues, and earlier exchanges keep the encoding they were read
   with.

---

### User Story 3 - Keep binary evidence in recordings (Priority: P2)

A developer exports a session that holds protobuf exchanges and opens it later or sends it to a colleague.
Every binary frame comes back with the same bytes, the same decoded content, the same order and the same
offsets.

**Why this priority**: Recordings are how a problem is shared and reproduced. A recording that changes the
bytes would hide bugs in the encoder.

**Independent Test**: Record a protobuf run, export the session, import the file and compare each frame's
bytes with the frame it came from.

**Acceptance Scenarios**:

1. **Given** a session with protobuf exchanges, **When** it is exported and imported, **Then** every binary
   frame has the bytes it had before, byte for byte, with the same decoded event, order, offset and
   findings.
2. **Given** a recording made by 0.1.0, **When** it is imported, **Then** it opens as before.
3. **Given** a recording file in which a frame's bytes do not decode to the event the file says they do, or
   in which a binary frame breaks the order and offset rules, **When** it is imported, **Then** the
   developer sees an error that names the first problem and nothing is loaded.
4. **Given** an export of a session with binary frames, **Then** it contains no headers, and the
   sensitive-data warning appears before it is saved, as for any export.

---

### User Story 4 - Damaged or unexpected binary is still evidence (Priority: P2)

A developer debugs a server whose protobuf output is wrong. Whatever arrives is kept and shown, with a
finding that says what is wrong. Capture does not stop and nothing is dropped or repaired.

**Why this priority**: Finding broken output is what an inspector is for. The protocol client stops or
drops such frames, so the recording is the only complete evidence.

**Independent Test**: Run the reference agent's damaged protobuf scenarios and check that the recording
holds every byte the agent sent, in order, with the expected findings.

**Acceptance Scenarios**:

1. **Given** a frame whose payload is not valid protobuf, **When** it is recorded, **Then** its bytes are
   kept, it has a finding that says it could not be decoded, and the frames after it are still recorded.
2. **Given** a frame for an event type that is not in the 31 baseline types (an event from a later
   protocol), **When** it is recorded, **Then** its bytes are kept and it has a finding that says the event
   is unknown. The protocol client drops such an event with a warning. The recording does not.
3. **Given** a frame that decodes but fails the event schema, **When** it is recorded, **Then** it has a
   schema finding, as a server-sent-events frame would.
4. **Given** a stream that ends in the middle of a frame, **When** it is recorded, **Then** the bytes that
   arrived are kept as one raw frame of unfinished evidence, as for a cut-off server-sent event, and the
   exchange still ends in its true transport state.
   **Given** a stream that states a frame larger than 10 MB (10,485,760 bytes, length prefix included),
   **Then** every byte from that length prefix to the end of the stream is kept as one raw frame with a
   `binary` finding, and the frames before it are unchanged. A frame of exactly 10,485,760 bytes is read as
   a frame.
5. **Given** a server that answers with server-sent events although protobuf was asked for, **When** the run
   is recorded, **Then** every received byte is kept and flagged as unreadable in the chosen encoding, with
   a finding that names the likely cause, and nothing is repaired.
6. **Given** an error answer (a status outside 200 to 299) to a protobuf request, **When** it is recorded,
   **Then** its body is kept as text, as it is for a server-sent-events request.

---

### User Story 5 - Learn how to pick the encoding (Priority: P2)

A developer reads the docs and learns how to choose the encoding in Settings and in a preset, what the
inspector sends, what a server must do to be inspected in protobuf, and how to read the findings.

**Why this priority**: Acceptance criterion 4 of the issue. A new option nobody can find or understand is
not shipped.

**Independent Test**: Follow only the docs page to record a protobuf run from the reference agent.

**Acceptance Scenarios**:

1. **Given** the docs, **When** a developer looks for protobuf, **Then** one page explains the choice in
   Settings, the default in a preset, the request the inspector sends, the response a server must send,
   and what the inspector shows for each finding in User Story 4.
2. **Given** the docs pages that list controls, settings, formats and dependencies, **Then** each names
   the encoding where it matters, and the repository's tests that check the docs still pass.

### Edge Cases

- A read ends inside the four-byte length prefix, or one read holds many frames.
- A frame states a length of zero, or a size above the 10 MB limit that the protocol client enforces
  (10,485,760 bytes, length prefix included).
  A length of zero is an empty message that cannot be decoded. It is a frame like any other.
- A frame is large. The frame detail shows the first 4,096 bytes and says how many are not shown.
- Stop is pressed in the middle of a frame.
- The server answers protobuf although server-sent events were asked for. The bytes are read as text, kept
  and flagged by the existing findings for text that is not valid JSON.
- The server sends a content type with a parameter, such as a charset, after the protobuf media type. The
  protocol client reads it as server-sent events and fails. The recording keeps the bytes and the run gets
  the client's failure as a finding. The docs name this cause.
- The encoding changes between two requests of one thread.
- A raw submission asks for protobuf. Its body is still sent exactly as typed.
- An imported older session has exchanges with no encoding field. They are read as server-sent events.
- An exported session is large. Binary frames take more space as text, and import still finishes with the
  same checks.
- The token header is set. It goes on protobuf requests through the same guarded transport and nowhere
  else.

## Requirements *(mandatory)*

### Functional Requirements

#### Choosing the encoding

- **FR-001**: The inspector MUST offer two encodings for a run, server-sent events and protobuf. The default
  MUST be server-sent events, and every behavior of 0.1.0 MUST stay the same when the choice is not made.
- **FR-002**: The choice MUST be a client-profile setting that Settings shows and the developer can change.
  It MUST be saved, exported and imported with the profile as an optional field. A profile without it MUST
  keep working and mean server-sent events. An unknown value MUST be a visible error that names the field
  and the accepted values, and the previous profile MUST stay in use.
- **FR-003**: A configured agent's preset MAY set a default encoding. A profile that sets one MUST win over
  the preset. An unknown value MUST be reported as any other invalid preset field is.
- **FR-004**: When protobuf is chosen, every conversation run request, continuation, surface action and raw
  submission MUST ask for the protobuf encoding and for no other encoding. When server-sent events are
  chosen they MUST ask exactly as in 0.1.0. Preparation requests and configuration loading MUST not change.
  The encoding MUST NOT change any request body.
- **FR-005**: A change of encoding MUST apply from the next request. It MUST NOT end the thread, and
  earlier exchanges MUST keep the encoding they were read with.

#### Recording and decoding

- **FR-006**: For a protobuf stream the recorder MUST keep each frame's bytes exactly as received, including
  its length prefix, in arrival order, with the offset of the read that completed the frame. This is the
  rule that server-sent-events frames follow (MVP FR-008).
- **FR-007**: Frames MUST be the same however the network divides the bytes into reads, and a frame MUST NOT
  be emitted before all its bytes have arrived.
- **FR-008**: Each complete frame MUST be decoded with the upstream protocol decoder and its result checked
  against the upstream event schema. The 31 baseline event types MUST decode to the same events as over
  server-sent events. Decoded events MUST feed the same conversation, state, interrupt, tool and A2UI views
  as server-sent-events frames do.
- **FR-009**: A frame that cannot be decoded, an event that is not in the baseline, an event that fails the
  schema, a frame larger than 10 MB (10,485,760 bytes, length prefix included) and a stream with no valid
  terminal event MUST each leave a finding on
  the frame or the exchange. A stream that ends inside a frame keeps the bytes as one raw frame of
  unfinished evidence. None of these MAY stop capture, and no byte MAY be dropped, repaired or reordered.
  Bytes that cannot be decoded and framing that no client reads use one new finding kind, `binary`. The
  other problems use the kinds they use for server-sent events (`schema`, `terminal`). After a frame larger
  than 10 MB the recorder MUST stop splitting the stream and keep every byte from that length prefix to
  the end of the stream, in arrival order, as one raw frame of unfinished evidence with a `binary`
  finding. The frames before it MUST NOT change.
- **FR-010**: The recorder MUST NOT read headers (MVP FR-007). The inspector reads a stream in the encoding
  that was chosen, not in the one a header names. An answer in the other encoding MUST be kept as received
  and flagged as unreadable in the chosen one.
- **FR-011**: An answer to a protobuf request with a status outside 200 to 299 MUST keep its body as text,
  as it does for a server-sent-events request.

#### The protocol client

- **FR-012**: The protocol client MUST read the bytes exactly as received. The rewriting of line endings that
  constitution principle I allows for server-sent events MUST NOT touch a protobuf stream, and nothing in
  the client's copy of it may differ. The recorder's copy MUST stay independent of what the client does.
- **FR-013**: A failure of the protocol client on a protobuf stream MUST appear as a finding on the run, as
  it does for server-sent events, and MUST NOT remove any recorded frame.

#### Views

- **FR-014**: A binary frame MUST show in the frames list with its event type, summary, offset and a mark
  that says it is binary. Its detail MUST show the decoded event as formatted JSON, the first 4,096
  received bytes as hexadecimal text with the total count and the number of bytes not shown, and its
  findings. Copy MUST give all the bytes as hexadecimal text, or the decoded event as JSON. The frame filter
  MUST match a binary frame by event type and by decoded content.
- **FR-015**: An exchange read as protobuf MUST show a `protobuf` mark. An exchange read as server-sent events
  shows no mark, as in 0.1.0.

#### Recordings

- **FR-016**: Session export MUST keep each binary frame's bytes as base64 text in one optional field of the
  frame, so that import restores them byte for byte. Decoded content, order, offsets and findings MUST
  round trip too (MVP
  FR-034). Export MUST contain no headers and MUST keep its sensitive-data warning (MVP FR-036, FR-039).
- **FR-017**: The session format MUST stay version 0. New fields MUST be optional. A recording from 0.1.0
  MUST import unchanged, and a session with no protobuf exchange MUST export with none of the new fields.
- **FR-018**: Import MUST check that a binary frame's bytes and its decoded content agree, and that binary
  frames follow the same order, offset and exchange rules as other frames. A file that fails any check MUST
  show an error that names the first problem and MUST NOT load (MVP FR-035).

#### Reference agent and tests

- **FR-019**: The reference agent MUST answer a protobuf request in the protobuf encoding and a
  server-sent-events request as it does now, and it MUST choose between them in the way a real server does,
  from what the request asks for. It MUST offer a complete protobuf run and damaged protobuf runs for the
  cases in User Story 4, including reads that cut frames at arbitrary bytes.
- **FR-020**: Every behavior above MUST have a regression test. End-to-end tests MUST run against the
  reference agent only. The 31 baseline types MUST each have a protobuf fixture test (constitution
  principle VI).

#### Documentation and compatibility

- **FR-021**: The docs MUST explain how to pick the encoding, what the inspector sends, what a server must
  send back, what the inspector shows for each finding, and how a recording keeps binary frames. They MUST
  say that protobuf resumption is not part of this release and point at issue #95.
- **FR-022**: The feature MUST add no network destination, telemetry or storage of credentials. The token
  MUST reach a protobuf request through the guarded transport only, as for any request.
- **FR-023**: The production bundle MUST stay inside the existing size limits (2 MB minified, 600 KB
  gzipped), and every new dependency MUST have an exact version, a lockfile entry and a row in the
  dependencies page.

### Key Entities

- **Encoding**: What a run asks the server to send and how its answer is read. Server-sent events or
  protobuf.
- **Binary frame**: One length-prefixed protobuf message as received. It keeps its raw bytes, arrival
  index and offset, and it has a decoded event when the bytes decode.
- **Exchange**: The existing request and its transport result. It now also says when it was read as
  protobuf.
- **Client profile**: The existing client settings. It gains the optional encoding.
- **Preset**: The existing per-agent settings. It gains an optional default encoding.
- **Recording**: The existing version-0 session file. Binary frames carry their bytes in a lossless text
  form.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the reference agent's protobuf run, the recorded frame count equals the number of
  messages the agent sent, and the frames' bytes concatenated equal the bytes the agent wrote, in 100% of
  runs.
- **SC-002**: A session with protobuf exchanges, exported and imported, gives frames whose bytes are
  identical to the originals in 100% of frames, with the same order and offsets.
- **SC-003**: All 31 baseline event types, sent as protobuf, show the same type, summary and decoded
  content as their server-sent-events counterparts.
- **SC-004**: Splitting the same protobuf stream at every byte position gives the same frames. No split
  changes a frame, its bytes or its offset rule.
- **SC-005**: The protocol client reads a protobuf run correctly even when a payload holds carriage return
  and line feed bytes, because it reads the original response and nothing rewrites it. The response the
  recorder hands back is the one it received, in every run.
- **SC-006**: Each damaged-stream case in User Story 4 leaves every received byte in the recording with a
  finding, and none stops capture.
- **SC-007**: A developer changes the encoding in at most two steps from the main page, and the docs page
  lets a developer new to the feature record a protobuf run from the reference agent without other help.
- **SC-008**: Every existing behavior test passes. The only existing tests that change are those that pin
  a type, a message or a list that this feature extends. Every 0.1.0 profile, configuration and recording
  still loads.

## Assumptions

- The default encoding stays server-sent events, so a developer who does nothing sees no difference.
- The choice lives in the client profile, because it is what the client declares it accepts, like the
  protocol version. A preset default exists because the adopter who embeds the inspector knows which
  encoding its own server speaks. This follows how the message mode works today.
- Raw submissions follow the same choice. A raw request exists to send what no client would, and a server
  that only speaks protobuf needs to be asked for it.
- A protobuf request names only the protobuf media type. The inspector must know how to read the answer
  and it does not read headers to find out, so it does not offer both encodings and let the server pick.
- The inspector does not detect the encoding from the response. Detection by header would need a header
  read, and detection by content would be a guess.
- Responsiveness for protobuf sessions is the same as for server-sent-events sessions, because views work
  from decoded frames. This release adds no separate benchmark for it.
- The public demo gets no protobuf example. The reference agent's Node server serves the protobuf
  scenarios to the end-to-end tests.
- Recordings stay JSON files. Protobuf is a way to read a stream, not a recording format.
- Memory limits for very large sessions are unchanged. A binary frame holds its bytes and its decoded event.

### Upstream facts this spec relies on

Checked on 2026-10-04 in `node_modules` and in the upstream source and docs, for `@ag-ui/client` 1.0.1.

- `@ag-ui/proto` 1.0.1 exists. `@ag-ui/client` 1.0.1 depends on exactly that version, and so does
  `@ag-ui/encoder` 1.0.1, which servers use to write events.
- The media type is `application/vnd.ag-ui.event+proto`.
- `HttpAgent.requestInit` sets `Accept: text/event-stream` and overrides any header of that name. A client
  that wants protobuf must change that request. The server side, `EventEncoder({ accept })`, chooses
  protobuf when the `Accept` value includes the media type.
- The client picks its parser from the response content type by strict equality with the media type. A
  content type with a parameter is read as server-sent events.
- A binary message is a four-byte big-endian unsigned length followed by that many bytes of protobuf. The
  client fails a stream whose frame states more than 10 MB, and fails a stream that ends inside a frame.
- The decoder, `decode(Uint8Array)`, returns an event. It throws `AGUIUnknownEventTypeError` for an event
  from a later protocol, which the client drops with a console warning.
- All 31 baseline fixtures of the repository encode and decode through `@ag-ui/proto` 1.0.1 to schema-valid
  events equal to the originals.

### Out of scope

- Resuming runs through `connectAgent`, moved to issue #95. In `@ag-ui/client` 1.0.1, `AbstractAgent.connect()`
  throws `AGUIConnectNotImplementedError` and `HttpAgent` does not override it. `connectAgent` catches that
  error and resolves with an empty result without sending a request. Upstream defines no request, no resume
  rule and no server behavior for it. Its docs say "The agent must implement `connect()` or this
  functionality must be provided by a framework like CopilotKit", and no upstream package implements it over
  HTTP. The 0.2.0 roadmap plans only features that upstream has released.
- A WebSocket or push transport, which the roadmap defers until upstream ships them.
- Reading the encoding from the response, and offering both encodings in one request.
- A protobuf example in the public demo.
- Changes to how rules and findings are catalogued, which issue #77 owns. This feature adds findings in the
  existing kinds and keeps its edits to the recorder focused.

### Dependencies

- `@ag-ui/proto` 1.0.1 becomes a direct dependency of the inspector, because it decodes frames. It is
  already in the lockfile through the client and is already in the bundle through the client.
- `@ag-ui/encoder` is not added. The reference agent writes protobuf with `@ag-ui/proto` and the length
  prefix, and the protocol client's own parser proves the framing in a test (plan, research 12). Any
  dependency added later gets an exact version, a lockfile entry and a row in the dependencies page.
- Issue #74 (client automation) also adds profile settings, and issue #77 (rule catalogue) changes
  recorder findings. Both are in flight, so changes to the profile and the recorder stay small and a
  rebase is expected.
