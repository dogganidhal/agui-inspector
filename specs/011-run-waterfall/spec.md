# Feature Specification: Run waterfall

**Feature Branch**: `gh-79-run-waterfall`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Issue #79, "Add subagent lanes, state history, a run waterfall and Markdown rendering", the waterfall
only: a waterfall of runs, steps, messages and tool calls, with start and end over time, nested. The other three
views of the issue (subagent lanes and a timeline, state history, Markdown rendering) are separate specifications
and pull requests.

## Clarifications

### Session 2026-10-04

Nobody was available to answer, so each answer follows the recommended option, the issue, the 0.2.0 roadmap and
the constitution. None of them changes the 0.2.0 scope, needs a constitution amendment or adds a dependency.

- Q: Where does the waterfall live: as a tab of the Inspection view next to Frames and Raw request, or as a tab of
  the whole inspection pane next to State and Settings? A: A third tab of the Inspection view, in the order Frames,
  Waterfall, Raw request. The waterfall reads the same recording as the frames list and sends users to its frames,
  so it belongs with them. The app shell keeps its tabs, and the conversation view is not touched, which keeps the
  boundary with the subagent lanes and timeline of spec 009.
- Q: Does one time axis cover all runs of the thread, or does each run have its own? A: Each run has its own axis,
  starting when its request was sent. Runs are separated by the time the developer takes to answer, which would
  shrink every bar on a shared axis. A run's duration is written on its row, so runs stay comparable.
- Q: Does moving focus select a row, and what does Enter do? A: Moving focus selects the row, so the details area
  always shows the row with focus. Enter shows the row's first frame in the frames list. This follows the tree
  pattern and means one key per action.
- Q: When does a message or tool call that was built from chunk events end? A: Chunk events carry no end event. The
  row ends at its last chunk once the conversation has closed it (the next event of its lane, or the end of the run),
  by the same rule the conversation view uses for it. While that has not happened the row is open. In a run that
  stopped without a terminal event it stays open and says "no end seen".
- Q: In what order do run groups and rows appear? A: Run groups run newest first, as exchanges do in the frames list.
  Rows inside a run run in order of start, so reading down a run reads forward in time.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See when everything in a run started and ended (Priority: P1)

A developer debugging a slow or confusing agent run opens the waterfall. 0.1.0 lists frames with their offsets and
the conversation shows messages, tool calls and steps without any sense of time. To learn which tool call took 4
seconds, or whether two messages overlapped, the developer has to subtract offsets by hand. The waterfall draws each
run as rows on a time axis. A row is a run, a step, a message, a reasoning message, a tool call or a subagent run. Its
bar runs from when it started to when it ended, and its start, end and duration are written next to the bar.
Steps contain what happened inside them.

**Why this priority**: This is the view. Everything else in this feature makes it easier to use or more honest.

**Independent Test**: Record a run with three steps, several messages and several tool calls (some answered by the
server, one left for the client), open the waterfall, and compare every bar and every written time with the offsets of
the raw frames.

**Acceptance Scenarios**:

1. **Given** a recorded run, **When** the developer opens the waterfall, **Then** the run is a row with its step,
   message, tool call and subagent rows under it, in the order they started. Each row has a label, a kind, a bar on
   the run's time axis, and its start, end and duration as text.
2. **Given** a step that contains two messages and a tool call, **When** the waterfall shows the run, **Then** those
   three rows are nested under the step row, and the step's bar covers the time between its start and its end.
3. **Given** a tool call whose result came from the server, **When** its row shows, **Then** its bar shows three
   moments: when the call started, when its arguments were complete, and when its result arrived. The part
   between the end of the arguments and the result is drawn differently from the part that streamed the arguments.
4. **Given** a tool call that the application owes a result for, **When** its row shows, **Then** its bar ends where
   its arguments ended and the row says it is waiting for a result. When a later run carried the result, the row says
   the client answered it, without inventing a time for the answer.
5. **Given** two messages that streamed at the same time, **When** the waterfall shows them, **Then** their bars
   overlap on the time axis and neither hides the other.
6. **Given** a thread with several runs, **When** the developer opens the waterfall, **Then** every run of the thread
   has its own group with its own time axis, newest run first, and the newest run is open.
7. **Given** a very short row, **When** the waterfall draws it, **Then** it still has a visible mark and its exact
   duration is written as text.

---

### User Story 2 - See nested subagent runs (Priority: P1)

A developer works with an agent that delegates to subagents, and those subagents delegate in turn. The waterfall
nests every subagent run under the tool call that started it, or under the subagent run that started it, or under
the run. The steps, messages and tool calls that belong to a subagent run are nested under its row. Seeing the
delegation as a tree on a time axis shows which subagent was waiting for which, and how long each one took.

**Why this priority**: The issue names nested subagent runs as a case the tests must cover. Without this story the
waterfall flattens the part of the protocol that most needs a picture.

**Independent Test**: Record a run in which a tool call starts a subagent that starts a second subagent, with
messages and tool calls attributed to each, open the waterfall, and check the tree against the events.

**Acceptance Scenarios**:

1. **Given** a subagent started by a tool call of the run, **When** the waterfall shows the run, **Then** the
   subagent row is nested under that tool call's row and starts and ends inside the time the tool call was open,
   as the events say.
2. **Given** a subagent started by another subagent, **When** the waterfall shows the run, **Then** the inner
   subagent row is nested under the outer one, at any depth.
3. **Given** a message or tool call that carries a subagent's id, **When** the waterfall shows the run, **Then** its
   row is nested under that subagent's row and not under the step or run it happened to arrive in.
4. **Given** a subagent that finished with an error, or that was suspended and may be continued later, **When** its
   row shows, **Then** the row says so in words. A subagent continued in a later run has a row in each run it
   appears in.
5. **Given** a subagent whose parent is not in the recording, or whose parents point at each other, **When** the
   waterfall shows the run, **Then** the row is nested directly under the run and the waterfall still shows every
   row.

---

### User Story 3 - Read an unfinished run and follow a live one (Priority: P1)

A developer watches a run while it streams, or opens a recording of a run that never finished: the stream stopped,
the connection failed or the developer pressed Stop. The waterfall shows what the stream showed. A row whose end has
not been seen is drawn as open and says "running" while the run streams and "no end seen" after it stopped. The
waterfall never makes up an end.

**Why this priority**: The issue names an unfinished run as a case the tests must cover. A waterfall that invents
ends would hide exactly the runs a developer opens it for.

**Independent Test**: Stream a run into the page, watch the waterfall while frames arrive, then stop the stream
before the run ends and check every row. Then do the same on an imported recording of that run.

**Acceptance Scenarios**:

1. **Given** a run that is streaming, **When** frames arrive, **Then** the waterfall shows the new rows and extends
   the open bars without any action from the developer. Bars grow when frames arrive, not with the clock.
2. **Given** a run that is streaming, **When** a message or tool call ends, **Then** its bar closes and its end
   and duration appear.
3. **Given** a run whose stream ended without `RUN_FINISHED` or `RUN_ERROR`, **When** the waterfall shows it,
   **Then** the run row says how the stream ended (stopped by the user, a transport error or no terminal event),
   its bar runs to the last frame received and is drawn open, and every row without an end is marked "no end seen".
4. **Given** a run that ended with `RUN_FINISHED` whose message has no end event, **When** its row shows, **Then**
   the row is marked "no end seen" and is not given the run's end as its own.
5. **Given** a run that ended in an error, an interrupt or a cancellation, **When** its row shows, **Then** the row
   says which one, as the conversation does.
6. **Given** a live run and a selected row, **When** frames arrive, **Then** the selection and the rows the developer
   opened or closed stay as they were.

---

### User Story 4 - Use the waterfall from the keyboard (Priority: P1)

A developer who does not use a pointer moves through the rows, opens and closes the nested ones, reads a row's
details and goes to its frames, with the keyboard alone. A screen reader says what each row is, how it nests, when
it started and ended, and whether it is still open.

**Why this priority**: The issue requires every view to work from the keyboard.

**Independent Test**: With the pointer unused, open the waterfall, walk through every row of a nested run, close and
open a step, and show the frames of a tool call.

**Acceptance Scenarios**:

1. **Given** the waterfall, **When** the developer tabs into it, **Then** one row has focus, focus is visible, and
   one more Tab leaves the rows instead of stepping through every one of them.
2. **Given** a row with focus, **When** the developer presses the down or up arrow, **Then** focus moves to the next
   or previous visible row, and the details area shows that row. Home goes to the first row and End to the last.
3. **Given** a row with nested rows, **When** the developer presses the right arrow, **Then** it opens, and a second
   press moves to its first nested row. The left arrow closes it, or moves to its parent when it is closed or has no
   nested rows.
4. **Given** a row with focus, **When** the developer presses Enter, **Then** the frames list shows the first raw
   frame of that row, as other frame references do.
5. **Given** a screen reader, **When** focus moves to a row, **Then** it announces the kind, the label, the nesting
   level, the start, the end and the duration (or that the row is open), and whether the row is open or closed.
6. **Given** typing in the composer or another control, **When** the developer presses those keys, **Then** the
   waterfall does not react.

---

### User Story 5 - Read a row's details and go to its frames (Priority: P2)

The developer picks a row and sees what it is: its id and name, its start, end and duration, its status, how many
frames it was built from, and which frames bound it. One action shows those frames in the frames list, so the
numbers can be checked against the evidence.

**Why this priority**: Bars summarize. The developer must be able to trust them and check them against the wire.

**Independent Test**: Select a tool call row, compare its details with the frames list, follow the action, and check
that the first frame of the row is the one the frames list reveals.

**Acceptance Scenarios**:

1. **Given** a row, **When** the developer selects it, **Then** a details area shows its kind, id, name, status,
   start, end, duration and frame count, and says that its times are derived from the arrival times of frames.
2. **Given** the details of a row, **When** the developer follows its first-frame reference, **Then** the frames list
   opens on that raw frame, as other frame references do.
3. **Given** a run row, **When** the developer selects it, **Then** the details show the run id, the thread, the
   parent run when there is one, its status and the time before its first event arrived.

---

### User Story 6 - Read an imported session (Priority: P2)

The waterfall works on a session loaded from a file. It shows the same rows, nesting and times as the live capture
did, including for sessions exported by 0.1.0.

**Why this priority**: The issue requires every view to work on a live run and on an imported session. The behavior
follows from reading the recording, so it costs little once the other stories work.

**Independent Test**: Export a session from a live capture, reload, import it, and compare every row, bar and
written time.

**Acceptance Scenarios**:

1. **Given** a session exported from a live capture, **When** it is imported, **Then** the waterfall shows the same
   rows, nesting, bars and times as the live capture showed.
2. **Given** a session exported by 0.1.0, **When** it is imported, **Then** the waterfall shows it.
3. **Given** an imported session, **When** the developer uses the waterfall, **Then** the page keeps its
   "inspection only" notice and sends no request.
4. **Given** any use of the waterfall, **When** the developer then exports the session, **Then** the file is the same
   as one exported before.
5. **Given** the developer starts a new thread or selects another agent, **When** the waterfall updates, **Then** it
   shows the runs of the new thread, empty until it has one, with no selection left over.

### Edge Cases

- A conversation exchange that has no valid event yet, or failed before any frame, is still a run group. Its row
  says so and has no bar.
- A frame that is not valid JSON, not a known event or not schema-valid adds no row and does not move any bar. It
  keeps its finding and its place in the frames list.
- Rows of equal start order by the arrival order of their first frame.
- An event that points at something never started adds no row. The conversation already reports it as an issue.
- A step that is never finished, or an inner step still open when its outer step finishes, stays open like any row
  without an end. It is labelled and its bar runs to the latest frame of the run, even past the end of its parent.
- Preparation requests and raw requests are not runs, even when they return an event stream. They add no group.
- A run with many rows shows them all. Long labels are shortened with the full text in the details.
- The time before `RUN_STARTED` arrives (waiting for the first byte) is shown as empty space before the run's bar,
  because the axis starts when the request was sent, as it does for the frames list.
- Messages that were only carried in a run's input, or only restated by a messages snapshot, have no start or end
  frame and add no row. A message that a messages snapshot dropped from the transcript keeps its row, because it
  streamed.
- A tool call whose arguments are never completed ends open, like any row without an end.
- A message or tool call built from chunk events ends at its last chunk once the conversation has closed it, and is
  open until then.
- Network buffering can deliver several frames at once. The waterfall shows arrival times, and the details say so.
- A recording that ends in the middle of a run shows the run as the stream left it.
- Keys the waterfall uses must not take over typing in the composer or other controls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The inspection pane MUST offer a Waterfall view next to the frames list and the raw request. It MUST
  not change the frames list, the raw request or the conversation view.
- **FR-002**: The waterfall MUST show the runs of the current thread, newest first, as the conversation view does for
  its thread. Each run MUST be a group with its own time axis. The newest run MUST be open by default and an older
  run MUST be closed by default.
- **FR-003**: The time axis of a run MUST start when its request was sent and MUST run to the later of the run's
  latest frame and the exchange's elapsed time, in seconds, the same arrival offsets the frames list shows. The axis
  MUST be labelled.
- **FR-004**: The waterfall MUST have a row for the run, each step, each message, each reasoning message, each tool
  call and each subagent run of the run. Each row MUST show its kind, a label, a bar from its start to its end, and
  its start, end and duration as text.
- **FR-005**: The messages and tool calls shown MUST be the ones the conversation view shows for the thread that were
  built from received frames. A message or tool call that came only from a run's input has no arrival time and MUST
  add no row. A message that a messages snapshot only restates adds no row, because the snapshot does not start or end
  it. A message that a messages snapshot removed from the transcript MUST keep its row.
- **FR-006**: Rows MUST nest. A step MUST contain the rows that started inside it. A subagent run MUST nest under the
  tool call that started it when that call is in the run, else under the subagent run that started it, else under the
  run. A step, message, reasoning message or tool call that carries a subagent run's id MUST nest under that subagent
  run's row. Rows with the same parent MUST be ordered by start, then by arrival of their first frame. A missing or
  circular parent MUST put the row under the run, and every row MUST still show.
- **FR-007**: A tool call's bar MUST show when it started, when its arguments were complete and when its result
  arrived, with the wait for the result drawn differently from the arguments. A call left for the client MUST say
  "waiting for result" and end where its arguments ended. A call answered by a later run MUST say the client answered
  it and MUST NOT get a time for the answer.
- **FR-008**: A row whose end event has not been seen MUST be drawn open and labelled. While the run streams the label
  is "running" and the bar extends to the latest frame of the run. When the stream has stopped the label is "no end
  seen" and the bar extends to the latest frame of the run. The waterfall MUST NOT use a time it did not receive as a
  row's end.
- **FR-009**: A run row MUST show the run's status as the conversation view does: streaming, finished, interrupted,
  cancelled, error, stopped by the user, or no terminal event, with a transport error when there is one. A subagent
  row MUST say "error" or "suspended" when it ended that way.
- **FR-010**: The waterfall MUST update while a run streams without any action, and MUST keep the selection and the
  rows the developer opened or closed while it does. Bars MUST grow only when frames arrive.
- **FR-011**: The waterfall MUST work on an imported session and show what the live capture showed. It MUST NOT
  require a new field in a recording or session file, and it MUST work with files from 0.1.0.
- **FR-012**: The waterfall MUST read the recording only. It MUST NOT change the recording, MUST NOT send a request
  and MUST NOT write browser storage. Raw frames, their order and their timing stay as received. Every time it shows
  MUST be labelled as derived from arrival times and MUST NOT get a raw frame index of its own.
- **FR-013**: The developer MUST be able to select a row. The details area MUST show the row's kind, id, name,
  status, start, end, duration, frame count and the first and last frame, and the run's details MUST include its id,
  thread, parent run and the time before its first event. A reference to the first frame MUST show that frame in the
  frames list, as other frame references do.
- **FR-014**: The selection and the rows the developer opened or closed MUST survive a switch to another tab of the
  inspection pane and back. They MUST reset when the thread changes or the session is replaced.
- **FR-015**: Every action the pointer offers MUST work from the keyboard: move between rows, open and close a row,
  select a row, open or close a run group and show a row's frames. The rows MUST follow the tree pattern: one tab stop
  for the rows, the up and down arrows between visible rows, the right arrow to open or to step into a row, the left
  arrow to close or to step out, Home and End for the first and last row, and Enter to show the frames. Moving focus to a row
  MUST select it. Focus MUST be visible. The kind, label, nesting level, times and open or closed state MUST be available to assistive
  technology. The keys MUST be documented.
- **FR-016**: Meaning MUST NOT depend on color alone: kind, state and errors MUST show through words or shapes as
  well. Text and bars MUST keep WCAG 2.2 AA contrast in light and dark themes.
- **FR-017**: The waterfall MUST stay responsive with the 5,000-frame workload, during capture and after.
- **FR-018**: The change MUST add no runtime dependency unless the plan shows that no existing one and no platform
  capability does the job. It MUST keep the production bundle within the `check:bundle` limits, load no remote
  content and keep the content security policy as it is.
- **FR-019**: The docs MUST describe the waterfall: what a row is, how rows nest, how subagent runs nest, what an open
  row means, that times are arrival times, the keys, the live behavior and the imported behavior. The pages that
  describe the inspection pane MUST be updated in the same change.
- **FR-020**: The waterfall MUST work in every mode that serves the one static bundle: hosted, embedded and the npm
  static assets.

### Key Entities *(include if feature involves data)*

- **Run group**: One conversation run of the current thread, with its status, its time axis and its rows.
- **Time axis**: Arrival offsets in seconds from the moment the run's request was sent, as in the frames list.
- **Row**: A run, step, message, reasoning message, tool call or subagent run. It has a kind, a label, a start, an
  end or no end yet, a status, the frames it was built from and its children. Derived.
- **Bar**: The row's span on the axis. A tool call's bar has an arguments part and a wait-for-result part.
- **Open row**: A row whose end event has not been seen.
- **Details**: What the selected row is, its times and where its frames are.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a scripted run with at least three steps, four messages and three tool calls (server-answered and
  client-answered), the start, end and duration written for every row equal the arrival offsets of the raw frames
  that bound it, for 100% of rows.
- **SC-002**: For a scripted run with a subagent started by a tool call and a second subagent started by the first,
  with messages and tool calls attributed to each, every row nests under the parent the events name, for 100% of
  rows, and a malformed parent still leaves every row visible.
- **SC-003**: For a run whose stream stopped early, and for a run still streaming, no row gets an end that no frame
  carried, and every row without an end is labelled, for 100% of rows.
- **SC-004**: With the pointer unused, a developer opens the waterfall, reaches the deepest row of a nested run,
  closes and opens a step and shows a row's frames. Every action the pointer offers has a keyboard equivalent, which
  an end-to-end test checks.
- **SC-005**: During a live run, the waterfall shows each new row and each closed bar within one second of the frame
  that caused it, and a selected row stays selected, for 100% of updates in the test.
- **SC-006**: A session exported from a live capture and imported again shows the same rows, nesting and times, 100%.
  A session recorded by 0.1.0 imports and shows its waterfall.
- **SC-007**: After using the waterfall, the exported session is identical to one exported before. The page makes no
  request outside what the run itself made, and the network allowlist test still passes.
- **SC-008**: Over the 5,000-frame workload, opening the waterfall takes under 1 s, and at least 95% of keyboard
  moves between rows show the new details within 200 ms. The plan fixes the workload and the measurement before
  implementation, as the MVP did.
- **SC-009**: The production bundle stays within 2,000,000 bytes minified and 600,000 bytes gzipped.
- **SC-010**: Kind, open state and errors are distinguishable with color removed, in light and dark themes, which a
  test checks.
- **SC-011**: The docs pages that describe the inspection pane mention the waterfall, and the tests that read the
  docs pass.

## Assumptions

- This is one of four views of issue #79. Each has its own specification and pull request. This change keeps to the
  waterfall and to the shared files it must touch. Subagent lanes and a conversation timeline (spec 009) live in the
  conversation. The waterfall is its own view in the inspection pane and does not depend on them.
- The scope is 0.2.0 as the maintainer approved it. Session and recording formats stay at version 0. This feature
  adds no field to them.
- The waterfall shows the thread the conversation view shows. A run of another thread of the same session is not
  listed, as in the conversation.
- Times are the arrival offsets the recorder keeps with each frame: when the browser finished reading the frame, not
  when the server produced the event. The optional `timestamp` an event may carry is the producer's clock with no
  fixed unit, so it is not used.
- Each run has its own time axis, so a short run is as readable as a long one. Comparing runs on one shared scale is
  out of scope.
- The set of rows and their parents come from the projection that builds the conversation, including its subagent
  lanes (spec 009). The waterfall reuses that projection and does not add a second reading of the stream. Its one
  nesting rule of its own is that a subagent run sits under the tool call that started it.
- Out of scope: zooming and panning the axis, filtering or searching rows, exporting the waterfall, rows for state,
  activity, custom and raw events, a shared scale across runs, and any change to what is recorded.
