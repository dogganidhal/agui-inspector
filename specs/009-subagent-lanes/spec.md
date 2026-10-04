# Feature Specification: Subagent lanes and timeline

**Feature Branch**: `gh-79-subagent-lanes`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Issue #79, "Add subagent lanes, state history, a run waterfall and Markdown rendering", subagent lanes in the
conversation and a timeline only. The other three views of the issue (state history, a waterfall of runs, Markdown
rendering) are separate specifications and pull requests.

## Clarifications

### Session 2026-10-04

Nobody was available to answer, so each answer follows the recommended option, the issue, the 0.2.0 roadmap and the
constitution. None of them changes the 0.2.0 scope, needs a constitution amendment or adds a dependency.

- Q: Is a lane open or collapsed when it first shows? A: Open, as a step is. The conversation is the place to read what
  a subagent did, and the timeline already gives the overview. A lane the developer collapses stays collapsed while
  the page shows it. A collapsed lane is not rendered, so its size costs nothing.
- Q: Is there one time scale for the whole thread, or one per run? A: One per run. Each chart has its own axis, from
  the request's offset 0 to the end of that run's exchange, the same origin and the same end as the frames list's
  frame ticks. Runs have separate clocks, so charts of different runs are never compared on one scale. The run's own row spans from its
  `RUN_STARTED` offset to its terminal event, or to the latest frame when it has none.
- Q: Can the timeline be collapsed, and what stops it from pushing the transcript off the screen? A: It is a
  disclosure, open when first shown, above the transcript. The chart box has a maximum height and scrolls inside
  itself. The scroll box can be reached and used with the keyboard. Leaving the page and coming back shows it open
  again, because nothing is stored.
- Q: In what order do rows appear, and what happens when "Show in timeline" targets a row that the 100-row limit
  hides? A: Depth first: each row is followed by its nested rows, and siblings are ordered by start offset. A hidden
  target first makes the chart show all its rows, then moves focus to the row.
- Q: What do the counts in a lane header cover, and where do the lifecycle events show? A: The counts cover what the
  lane holds directly: its messages, its tool calls and its nested subagents, not the descendants of those. The
  lifecycle events show at the top of the lane's body. A collapsed lane shows its header only.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow each subagent's work as a lane (Priority: P1)

A developer runs an agent that delegates to subagents, and some of those delegate again. 0.1.0 shows each subagent as
a small marker with its start and finish lines. The messages, reasoning, tool calls and steps a subagent produced sit
in the main flow, mixed with the parent's own and, when subagents run in parallel, with each other's. The developer
cannot tell who produced what without reading ids in the frames list. Now each subagent invocation is a lane: one
block with its header and everything it produced. A subagent started by another subagent sits inside the lane of its
parent.

**Why this priority**: Telling who produced what is the reason for the view. Nested and parallel runs are the cases
the issue names as hard to follow, and a lane needs nothing else to be useful.

**Independent Test**: Record a run with a parent agent, two subagents running in parallel with interleaved events, and
a subagent started by one of them. Open the conversation and check that every entry sits in the lane its event named.

**Acceptance Scenarios**:

1. **Given** a subagent whose events (text messages, reasoning, tool calls and their results, steps, activities,
   custom and raw events, with their chunk forms) carry its `subagentRunId`, **When** the developer opens the
   conversation, **Then** all the entries those events make show inside that subagent's lane, in arrival order, and
   none of them shows outside it.
2. **Given** events without a `subagentRunId` that arrive while a lane is open, **When** the conversation shows them,
   **Then** they stay in the parent's flow, outside the lane.
3. **Given** two subagents that run in parallel and whose events interleave, **When** the conversation shows them,
   **Then** each has its own lane holding only its own events, in the order they arrived.
4. **Given** a subagent that names another subagent as its parent and that parent started earlier in the same run,
   **When** the conversation shows them, **Then** the child's lane sits inside the parent's lane. Three or more levels
   nest the same way.
5. **Given** a lane, **When** the developer reads its header, **Then** the header shows the subagent's name, its
   invocation id, its description, its status, its start offset, its duration, the tool call that started it and how
   many messages, tool calls and nested subagents it holds directly. The lane's body starts with its lifecycle events,
   each with a frame reference as in 0.1.0.
6. **Given** a lane, **When** the developer collapses it, **Then** its body hides and its header keeps the status and
   the counts. Opening it again shows the body as it was.
7. **Given** a thread without subagents, **When** the developer opens the conversation, **Then** it looks as in 0.1.0.

---

### User Story 2 - See when subagents ran on a timeline (Priority: P1)

A developer wants to know when each subagent ran, which ones overlapped, which one the run waited for, and which one
failed. The timeline answers this at a glance. For each run that has subagents it draws a time axis with one row for
the run and one row for every subagent invocation, so parallel work overlaps on the axis and sequential work follows
on it.

**Why this priority**: Lanes say who did what. The timeline says when. Overlap and waiting are not visible in a
transcript, and the issue asks for both views.

**Independent Test**: Record a run in which two subagents overlap, a third starts after both finish, and one fails.
Compare every bar on the timeline with the offsets of the frames that started and ended it.

**Acceptance Scenarios**:

1. **Given** a thread with at least one subagent, **When** the developer opens the conversation, **Then** a subagent
   timeline shows above the transcript. For each run that has subagents it has a chart with a time axis, a row for the
   run and a row for each subagent invocation of that run. Nested subagents sit under their parent, indented.
2. **Given** a row, **When** the developer reads it, **Then** its bar starts at the offset of the frame that started
   the subagent and ends at the offset of the frame that ended it, and the row shows the subagent's name, its id, its
   status in words and its duration.
3. **Given** two subagents that run in parallel, **When** the timeline draws them, **Then** their bars overlap on the
   axis. Given two that run one after the other, their bars follow each other.
4. **Given** the statuses running, finished, suspended, error, stopped and no end event, **When** the timeline draws
   them, **Then** each status differs from the others by the shape of the bar's end and by its word, not by color
   alone.
5. **Given** a thread without subagents, **When** the developer opens the conversation, **Then** no timeline shows.
6. **Given** the timeline, **When** the developer reads its notes, **Then** it says that positions and durations are
   derived from the offsets at which frames arrived, and that the optional `timestamp` of an event is not used.
7. **Given** a row, **When** the developer activates it, **Then** the conversation scrolls to that subagent's lane,
   opens what hides it (a collapsed lane or step around it) and moves focus to the lane's header.
8. **Given** a lane's header, **When** the developer activates its "Show in timeline" action, **Then** the timeline
   scrolls to the lane's row and moves focus to it.

---

### User Story 3 - Use lanes and timeline from the keyboard (Priority: P1)

A developer who does not use a pointer finds a subagent on the timeline, jumps to its lane, collapses and opens lanes,
and goes back, with the keyboard alone. A screen reader says what each row and each lane is.

**Why this priority**: The issue requires every view to work from the keyboard.

**Independent Test**: With the pointer unused, load a thread with nested subagents, tab to the timeline, step through
its rows, jump to a lane three levels deep, collapse its parent, and return to the timeline.

**Acceptance Scenarios**:

1. **Given** the timeline, **When** the developer tabs into it, **Then** the rows are one tab stop. The down arrow
   moves to the next row, the up arrow to the previous one, Home to the first and End to the last. Focus is visible.
   Enter or Space jumps to the row's lane.
2. **Given** a lane, **When** the developer reaches its header with Tab, **Then** Enter or Space collapses or opens it,
   and Tab moves on to the actions in its header (frame references, "Show in timeline").
3. **Given** a row, **When** a screen reader reads it, **Then** it says the subagent's name and id, its status, its
   duration, its start offset and which subagent it is nested under. A lane's header says the same, so nesting never
   depends on indentation alone.
4. **Given** the keys of the timeline, **When** the developer types in the composer or another control, **Then** the
   keys do not take over what they type.
5. **Given** the keys, **When** the developer reads the docs, **Then** the docs list them.

---

### User Story 4 - See failed, suspended and unfinished subagents as they are (Priority: P2)

A subagent can fail, pause for outside input, be cut off with its run, or arrive with parts of its lifecycle missing.
The developer needs the lanes and the timeline to show exactly what the stream said, and to say what it did not say.

**Why this priority**: These are the cases in which a developer opens the inspector. They follow from the same
derivation as stories 1 and 2 but each needs its own wording.

**Independent Test**: Record runs in which a subagent fails, a subagent suspends and a later run continues it, a
subagent never ends, and a subagent's events arrive with no start event. Check the status, wording and bar of each.

**Acceptance Scenarios**:

1. **Given** a `SUBAGENT_ERROR`, **When** the lane and the row show, **Then** the status is "Error" with the message
   and the code, and the run keeps its own outcome. A failed subagent does not make the run fail.
2. **Given** a `SUBAGENT_FINISHED` with the outcome suspended, **When** the lane and the row show, **Then** the status
   is "Suspended", with the interrupt ids when it names some.
3. **Given** a later run that continues a subagent invocation an earlier run suspended, **When** the conversation
   shows it, **Then** the later run has its own lane for the invocation, labelled as a continuation of the earlier
   segment, and the timeline draws each run's segment on its own run's axis.
4. **Given** a subagent that has no end event when its run ends, **When** the lane and the row show, **Then** the
   status is "No end event", or "Stopped by you" when the developer stopped the run. No outcome is invented.
5. **Given** events that carry a `subagentRunId` for which no start event arrived, **When** the conversation shows
   them, **Then** they show in a lane labelled with the id and "Start not received", and the lane has no name,
   description or start offset.
6. **Given** a subagent that names a parent that has not started in the same run, **When** the conversation shows it,
   **Then** its lane sits under the run, labelled with the parent id and "Parent not seen in this run".
7. **Given** a lane with no events besides its lifecycle, **When** it shows, **Then** it says it holds no events.

---

### User Story 5 - Follow a live run and read an imported session (Priority: P2)

Lanes and timeline work while the agent is streaming and on a session loaded from a file. During a live run lanes
fill and bars grow as frames arrive. An imported session shows what the live capture showed, including sessions
exported by 0.1.0.

**Why this priority**: The issue requires every view to work in both cases. The behavior follows from the projection,
so it costs little once stories 1 to 4 work.

**Independent Test**: Stream a run with nested subagents into the page and watch the lanes and bars while it runs.
Then export the session, reload, import it and compare every lane and every bar.

**Acceptance Scenarios**:

1. **Given** a live run, **When** a subagent starts, **Then** its lane and its row appear without an action, with the
   status "Running". Its bar ends at the offset of the latest frame received.
2. **Given** a running subagent, **When** more frames arrive, **Then** its bar grows, and **When** its end event
   arrives, **Then** the status and the end of the bar change to match.
3. **Given** a session exported from a live capture, **When** it is imported, **Then** the conversation shows the same
   lanes and the same timeline as the live capture showed. A session exported by 0.1.0 that contains subagent events
   shows lanes and a timeline too.
4. **Given** an imported session, **When** the developer uses lanes and timeline, **Then** the page keeps its
   "inspection only" notice and sends no request.
5. **Given** the developer starts a new thread or selects another agent, **When** the conversation updates, **Then**
   it shows the lanes and timeline of the new thread, with nothing left over from the old one.
6. **Given** any use of lanes and timeline, **When** the developer exports the session, **Then** the file is the same
   as one exported before.

### Edge Cases

- A subagent that finishes before its parent's tool call result arrives is shown where its start event arrived. The
  lane does not move.
- Events that arrive after a subagent's end event but still carry its `subagentRunId` show in its lane. The status
  stays as the end event set it.
- A second start event for an invocation already started in the same run adds a lifecycle line to the same lane, and
  its name and description replace the earlier ones, as in 0.1.0.
- The latest lifecycle event of a lane in a run decides its status.
- A step a subagent opens and closes stays inside its lane, even while another lane's steps are open at the same time.
- A message, tool call or reasoning message that a chunk event opens belongs to the lane its chunk names, and the
  chunk frame stays in the frames list beside the expansion, as in 0.1.0.
- A `MESSAGES_SNAPSHOT` replaces the transcript as in 0.1.0. A lane still open keeps its place and its parts that are
  still arriving, as an open step does. A lane that has ended goes with the rest of the replaced transcript. The
  timeline keeps its row, because a snapshot replaces what the transcript shows and not what happened.
- A timeline row whose lane the transcript no longer holds says so, and its jump action shows the start frame in the
  frames list instead.
- Whole messages that arrive in a run's input or in a `MESSAGES_SNAPSHOT` keep the place they have in 0.1.0, even when
  the message names a `subagentRunId`.
- State events carry a `subagentRunId` too. They stay in the state view and are not in lanes.
- A frame that is not valid JSON, not a known event or not schema-valid projects to nothing, as in 0.1.0. It adds
  nothing to a lane or the timeline and keeps its finding and its place in the frames list.
- A subagent whose start and end are at the same offset, or a run with no duration, still has a visible bar and a
  readable axis.
- A very long name, id or description is shortened in the timeline with the full text one action away. The lane
  header shows it in full. All of it is shown as text, never as Markdown or HTML.
- A thread with many subagents, in the hundreds, keeps the page responsive. The timeline shows its first rows and
  offers the rest on request.
- A run that ends in an error while subagents are open leaves them as "No end event". The run header shows the error.
- A recording that ends in the middle of a run shows the lanes and bars it has. The last open lane is "Running" while
  the exchange is live and "No end event" once it is not.
- Reduced motion settings stop any animation of a running status, as for other running statuses.
- A narrow window shows lanes and timeline without scrolling the page sideways. A chart wider than the window scrolls
  inside its own box, which the keyboard can reach.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The conversation MUST show each subagent invocation of the current thread as a lane: one block holding
  the subagent's header and every entry its events produced. An entry belongs to the lane named by the
  `subagentRunId` of its event. An entry whose event has none belongs to the parent's flow, whatever lane is open.
- **FR-002**: Entries in a lane MUST keep the order in which their frames arrived. A lane MUST sit where its start
  event arrived: in the parent's flow, inside the step that was open there, or inside its parent's lane.
- **FR-003**: A lane whose subagent names a `parentSubagentRunId` that started earlier in the same run MUST sit inside
  the lane of that parent, at any depth. A lane whose parent is not known in the same run MUST sit under the run and
  say which parent it names.
- **FR-004**: Parallel subagents MUST NOT share a lane or interleave inside one. Steps, and messages, tool calls and
  reasoning that chunk events open, MUST be placed by the lane their event names, so interleaved lanes never close
  or continue each other's parts.
- **FR-005**: A lane's header MUST show the name, invocation id, description, status, start offset, duration, the
  spawning tool call and message when named, and counts of the messages, tool calls and nested subagents it holds
  directly. The lifecycle events MUST show at the top of the lane's body. Each lifecycle event keeps its frame
  reference, its offset, and its outcome, result, message or code as 0.1.0 showed them. Start offset and duration MUST
  be labelled as derived from arrival offsets.
- **FR-006**: A lane MUST be collapsible, and MUST be open when it first shows. A collapsed lane MUST keep its status
  and counts visible. Lane contents MUST NOT be rendered while collapsed, so that a lane of thousands of entries costs
  nothing until it is opened.
- **FR-007**: A lane's status MUST be one of Running, Finished, Suspended, Error, Stopped by you or No end event,
  decided by its latest lifecycle event in the run. It is Running only while no end event has arrived, the run has no
  terminal event and the exchange is still receiving. Without an end event otherwise, it is Stopped by you or No end
  event. The inspector MUST NOT invent an outcome that no frame carried.
- **FR-008**: A segment of an invocation in a later run MUST have its own lane in that run, labelled as a
  continuation when an earlier run holds a segment of the same invocation.
- **FR-009**: Events that carry a `subagentRunId` with no start event MUST show in a lane labelled "Start not
  received". The lane MUST NOT show a name, description or start offset it does not have.
- **FR-010**: The conversation MUST show a subagent timeline above the transcript when the thread has at least one
  subagent, and none otherwise. The timeline MUST be collapsible and open when first shown. For each run with
  subagents it MUST draw a chart with its own time axis, from offset 0, the same origin as the frames list, to the
  end of the run's exchange, which the frames list's frame ticks use too. Each chart MUST have a row for the run, spanning from its start to its terminal
  event or its latest frame, and a row for each subagent invocation of that run. Rows MUST run depth first: each row
  is followed by its nested rows, and siblings are ordered by start offset. The chart box MUST have a maximum height
  and scroll inside itself, reachable with the keyboard.
- **FR-011**: A bar MUST start at the offset of the frame that started the invocation in that run. It MUST end at the
  offset of its end event. A bar without an end event MUST end at the offset of the latest frame of the exchange. A
  segment that was started and has no start frame (FR-009) MUST start at its first event.
- **FR-012**: Each status MUST differ in the shape of the bar's end and in a word, so color is never the only signal.
  Text, bars and focus indicators MUST keep WCAG 2.2 AA contrast in light and dark themes. The timeline and the lanes
  MUST add no new theme property.
- **FR-013**: The timeline MUST say that positions and durations come from arrival offsets, MUST NOT use the optional
  `timestamp` of an event, and MUST label derived values as derived, as the 0.1.0 durations are.
- **FR-014**: Activating a timeline row MUST move the conversation to its lane, open every lane and step that hides it
  and move focus to the lane's header. Activating "Show in timeline" in a lane header MUST move to the lane's row and
  focus it. When the target row is hidden by the row limit (FR-016), the chart MUST first show all its rows. When the
  transcript no longer holds the lane, the row MUST say so, and its jump action MUST show the invocation's start frame
  in the frames list.
- **FR-015**: Every action the pointer offers MUST work from the keyboard: open and collapse a lane, step through the
  timeline rows, jump from a row to its lane and back, show more rows and follow a frame reference. The rows of a
  chart are one tab stop, with the down and up arrows, Home and End moving between them and Enter or Space jumping to
  the lane. Focus MUST be visible. Rows and lane headers MUST give their name, status, duration and parent to
  assistive technology. The keys MUST be documented, and MUST NOT take over typing in the composer or other controls.
- **FR-016**: A thread with a large number of subagents MUST NOT flood the timeline. A chart MUST show its first 100
  rows with the count of the rest and one action to show them. A long name, id or description MUST be shortened in a
  row with the full text available.
- **FR-017**: Lanes and timeline MUST work while a run streams. A new lane and a new row MUST appear without an
  action, a running bar MUST grow with the latest frame, and an end event MUST update the status and the end of the
  bar. Lane collapse state MUST survive these updates.
- **FR-018**: Lanes and timeline MUST work on an imported session and show what the live capture showed. They MUST NOT
  require a new field in a recording or a session file, and MUST work with files from 0.1.0.
- **FR-019**: Lanes and timeline are views. They MUST NOT change the recording, MUST NOT send a request and MUST NOT
  write browser storage. Raw frames, their order and their timing stay as received, and every event type keeps its
  frames-list view and its fixture test.
- **FR-020**: The relationships between runs and subagents (which run an invocation belongs to, which invocation or
  run it is nested under, which tool call started it, and its segments with start, end and status) MUST come from one
  small framework-free derivation in the projection, and both the lanes and the timeline MUST use it. It MUST not
  depend on what the transcript still holds, so a transcript replacement leaves it whole. It MUST be usable by another
  view, such as the waterfall of runs, without change.
- **FR-021**: Lanes and the timeline MUST keep the content security policy and the local-only rules: no `eval`, no
  remote content, no third-party request. Subagent names, ids, descriptions and results MUST be shown as text.
- **FR-022**: The view MUST work in every mode that serves the one static bundle: hosted, embedded and the npm static
  assets.
- **FR-023**: The change MUST add no runtime dependency unless the plan shows that no existing one and no platform
  feature does the job. It MUST keep the production bundle within the `check:bundle` limits.
- **FR-024**: The docs MUST describe lanes and the timeline: what a lane holds and how nesting works, the statuses,
  the bars and what the axis means, the jump actions, the keys, the live behavior and the imported behavior. The pages
  that describe event views and inspection MUST be updated in the same change.
- **FR-025**: Tests MUST cover nested subagents, parallel interleaved subagents, each kind of event a subagent can
  attribute, the statuses and the unseen-start and unseen-parent cases, a transcript replacement, a live run and an
  imported session, and the keyboard. End-to-end tests MUST run only against the reference agent, which gains a
  scripted scenario with nested subagents.

### Key Entities *(include if feature involves data)*

- **Subagent invocation**: One delegated piece of work, named by its `subagentRunId`. It has a name, a description,
  and optionally the subagent, tool call and message that started it.
- **Segment**: The part of an invocation inside one run. It begins at a start event and ends at a finish or error
  event, or at the end of the run. An invocation that a run suspends and a later run continues has two segments.
- **Lane**: The conversation's block for one segment, with its header and the entries its events produced. Lanes nest.
- **Timeline row**: The timeline's line for one segment, or for the run itself, drawn as a bar on the run's axis.
- **Status**: Running, Finished, Suspended, Error, Stopped by you or No end event. Derived from the frames.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a scripted run with three levels of nesting and two parallel subagents whose events interleave, 100%
  of the entries land in the lane their event named, and none lands in another lane or in the parent's flow.
- **SC-002**: For every lane whose parent started earlier in the same run, the lane sits inside its parent's lane, in
  100% of the cases of the scripted runs.
- **SC-003**: For every timeline bar, its start and its end equal the offsets of the frames that started and ended it
  (or, without an end event, of the latest frame), in 100% of the scripted runs.
- **SC-004**: With the pointer unused, a developer tabs to the timeline, steps from the first row to the last, jumps to
  a lane three levels deep, collapses its parent and returns to the timeline. Every action the pointer offers has a
  keyboard equivalent, which an end-to-end test checks.
- **SC-005**: Every one of the six statuses is distinguishable with color removed, in light and dark themes, which a
  test checks. Text contrast meets WCAG 2.2 AA in both themes.
- **SC-006**: Projecting the frozen 5,000-frame workload, which contains subagents, still takes under 500 ms. A
  5,000-frame thread of 200 subagents, three levels deep, projects and builds its timeline rows within 1 s. The plan
  fixes the workload and the measurement before implementation, as the MVP did.
- **SC-007**: At least 95% of row jumps show their lane, with focus in its header, within 200 ms of the input.
- **SC-008**: During a live run, a running subagent's status and bar change within 1 s of its end event arriving.
- **SC-009**: A session exported from a live capture and imported again shows the same lanes and the same bars, in
  100% of cases. A session exported by 0.1.0 with subagent events imports and shows lanes and a timeline.
- **SC-010**: After using lanes and the timeline, the exported session is identical to one exported before. The page
  makes no request outside what the run itself made, and the network allowlist test still passes.
- **SC-011**: The production bundle stays within 2,000,000 bytes minified and 600,000 bytes gzipped.
- **SC-012**: The docs pages that describe event views and inspection mention lanes and the timeline, and the tests
  that read the docs pass.

## Assumptions

- This is one of four views of issue #79. Each has its own specification and pull request. This change keeps to the
  conversation and to the shared files it must touch. State history (spec 010) and Markdown (spec 012) are separate.
- The waterfall of runs (spec 011) is a separate view of runs, steps, messages and tool calls. The timeline here is
  the time axis of subagent lanes and draws nothing but runs and subagent segments. The derivation in FR-020 is the
  one piece the two share.
- The scope is 0.2.0 as the maintainer approved it. Session and recording formats stay at version 0. This feature
  adds no field to them.
- The subagent events and the `subagentRunId` attribution are part of the released `@ag-ui/core` that the inspector
  pins, so they are in scope. Nothing here needs an unreleased protocol feature.
- The conversation is the conversation of the current thread, as in 0.1.0. Lanes and timeline follow it.
- Lanes group by the subagent that produced an entry. The frames list stays the record of arrival order, and the
  timeline shows the overlap. The conversation offers no flat arrival-order mode.
- Out of scope: lanes for whole messages from a run's input or a snapshot, a subagent filter in the frames list,
  zooming or panning the axis, comparing runs, exporting the timeline, and drawing messages, tool calls or steps as
  bars (the waterfall's job).
- The timeline sits in the conversation pane above the transcript. It adds no tab and no pane.
- The reference agent gains one scripted, model-free scenario with nested and parallel subagents, for the end-to-end
  tests.
