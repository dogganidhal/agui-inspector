# Feature Specification: Clear the recording

**Feature Branch**: `worktree/clear-recorded-frames-6ce54d`

**Created**: 2026-11-11

**Status**: Implemented, in review

**Input**: Maintainer request: "a control that clears the recorded exchanges, frames and runs so the developer does not reload the page to start a fresh capture."

## Clarifications

### Session 2026-11-11

- Q: When does clearing ask for confirmation? → A: Only when the capture changed since it was last exported. A capture just exported, or one never changed since, clears in one action.
- Q: What does the control do while a request is still being sent or a response is still recorded? → A: It is unavailable and says to stop the run first. The developer presses Stop, then clears. No frame of a live stream is dropped.
- Q: What does the control do while an imported recording is open? → A: It closes the recording and empties the live capture too, so the page can send again without a reload.
- Q: Does clearing start a new thread? → A: Yes, exactly as New thread does. Otherwise the next run would carry a transcript the page no longer shows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a fresh capture without reloading (Priority: P1)

A developer tries an agent, looks at the frames, changes the server and wants to try again from a clean page. Today the only way to drop what was recorded is to reload the page, which also forgets the token, the typed endpoint and the variables. The developer presses one control instead. Every view is empty again, and the agent, endpoint, token, profile and variables are still set, so the next message goes out at once.

**Why this priority**: This is the whole feature.

**Independent Test**: Run two scenarios against the reference agent, clear, and check that the frames list, the waterfall, the conversation and the State view are empty, that the agent and token are unchanged, and that a new message records exchange and frames as on a fresh page.

**Acceptance Scenarios**:

1. **Given** a capture with exchanges, frames, runs and findings, **When** the developer clears it, **Then** the frames list, the waterfall, the conversation, the State view and every A2UI surface show nothing, as on a fresh page.
2. **Given** a cleared capture, **When** the developer sends a message, **Then** the request goes to the same target with the same token, profile and variables, and its exchange and frames are recorded as usual.
3. **Given** a cleared capture, **When** the developer exports the session, **Then** the file holds only what was recorded after the clear.
4. **Given** a capture, **When** the developer clears it, **Then** the conversation starts a new thread: new `threadId`, empty transcript and state, nothing waiting. The next run does not carry the cleared transcript.

---

### User Story 2 - A live run is never cut silently (Priority: P1)

A response is still streaming when the developer reaches for the control. Clearing now would drop frames of a stream that is still arriving, which the inspector never does. The control is not available while any request is still being sent or recorded, and it says why. Once the developer stops the run, or it ends, the control is available.

**Why this priority**: The constitution forbids dropping frames. Without this the feature breaks principle I.

**Independent Test**: Start a slow stream, check the control is unavailable with its reason, stop the run, check it becomes available and clears.

**Acceptance Scenarios**:

1. **Given** a request is being sent or its response is being recorded, **When** the developer looks at the control, **Then** it is unavailable and its description says to stop the run first.
2. **Given** that state, **When** the developer presses Stop and the recording ends, **Then** the control becomes available.
3. **Given** an empty capture, **When** the developer looks at the control, **Then** it is unavailable because there is nothing to clear.

---

### User Story 3 - Do not lose evidence by accident (Priority: P2)

The developer may clear by mistake after a long session. When the capture holds anything that was not exported, clearing asks first and says how much would be lost. A capture that was just exported clears in one action, so the usual loop (export, clear, try again) stays fast.

**Why this priority**: Clearing cannot be undone. The guard matters, but the feature works without it.

**Independent Test**: Record, clear, check the confirmation behavior; export, clear again, check the behavior after export.

**Acceptance Scenarios**:

1. **Given** a capture recorded since the last export (or never exported), **When** the developer presses Clear session, **Then** a confirmation names the exchanges and frames that would be lost and that clearing cannot be undone. Cancel keeps everything.
2. **Given** that confirmation, **When** the developer confirms, **Then** the capture is cleared.
3. **Given** a capture exported with no change since, **When** the developer presses Clear session, **Then** it clears at once, with no confirmation.
4. **Given** a capture exported and then extended by another run, **When** the developer presses Clear session, **Then** the confirmation is asked again.

---

### Edge Cases

- An imported recording is open: Clear session closes it and empties the live capture behind it, and the page can send again. The confirmation rule applies to the live capture, since the recording is already a file. The control is unavailable while the live capture is still recording, even unseen behind the recording.
- An interrupt or a client tool call is waiting for an answer: clearing drops it with the thread, as New thread does.
- A request is refused before it is sent (bad target, failed preparation): nothing is being recorded, so the control is available.
- The developer clears during a capture that the protocol client gave up on but the recorder still reads: still recording, so the control is unavailable.
- The developer selected a frame or opened rows in the waterfall: the selections go with the data.
- An error shown in the inspection pane about the cleared capture: it goes too.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The inspection pane MUST offer a control, next to Export session and Import session, whose accessible name is "Clear session".
- **FR-002**: Clearing MUST remove every exchange, frame, run, finding and derived entry of the capture. Every view built from them (frames list, waterfall, conversation, State view, A2UI surfaces, subagent lanes) MUST show what it shows on a fresh page.
- **FR-003**: Clearing MUST start a new thread exactly as New thread does: new `threadId`, empty transcript and state, no waiting interrupt or tool result, no paused automatic replies, no run error.
- **FR-004**: Clearing MUST keep the selected agent, the endpoint, the token, the client profile, the preset variables, the text in the composer and in the raw request editor.
- **FR-005**: The control MUST be unavailable while any request is being sent or any response is being recorded, with a description that says to stop the run first. Clearing MUST NOT drop, cut or reorder a frame of a stream still arriving.
- **FR-006**: The control MUST be unavailable when there is nothing to clear: an empty live capture and no imported recording open.
- **FR-007**: Clearing MUST ask for confirmation when the live capture changed since it was last exported, naming how many exchanges and frames would be lost. It MUST NOT ask when the live capture is empty or unchanged since its last export.
- **FR-008**: While an imported recording is open, clearing MUST close it and empty the live capture, after which the page sends requests again as on a fresh page.
- **FR-009**: After a clear, new exchanges, frames and runs MUST be recorded and exported with the same guarantees as on a fresh page: unique ids, arrival order, offsets that never go backwards, references that exist. An exported file after a clear MUST import.
- **FR-010**: Clearing MUST make no request and write nothing to storage.
- **FR-011**: The runs documentation MUST describe the control next to Stop and New thread.

### Key Entities

- **Capture**: what the page recorded since it loaded or was last cleared: exchanges, frames, runs, findings and derived entries.
- **Thread**: the conversation the next run continues. Clearing replaces it with a new one.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer goes from a populated capture to an empty one, with the target and token still set, in one action after an export and in two otherwise.
- **SC-002**: In every test run, no frame of a stream still arriving is lost: the control is unavailable for the whole time a response is recorded.
- **SC-003**: A session exported after a clear imports without error and holds only what was recorded after the clear.

## Assumptions

- The control sits in the inspection pane header with Export session and Import session, so the connection view, which spec 016 changes, stays as it is.
- "Clear session" matches the names of Export session and Import session.
- Clearing is not undoable. Export is the way to keep a capture.
- Ids keep counting after a clear, so a cleared id is never reused.
