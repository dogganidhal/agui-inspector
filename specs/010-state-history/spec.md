# Feature Specification: State history

**Feature Branch**: `gh-79-state-history`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Issue #79, "Add subagent lanes, state history, a run waterfall and Markdown rendering", state history
only: a diff per delta and a view of the state at any past point. The other three views of the issue (subagent
lanes and a timeline, a waterfall of runs, Markdown rendering) are separate specifications and pull requests.

## Clarifications

### Session 2026-10-04

Nobody was available to answer, so each answer follows the recommended option, the issue, the 0.2.0 roadmap and
the constitution. None of them changes the 0.2.0 scope, needs a constitution amendment or adds a dependency.

- Q: Does every entry in the list show its full diff, or only the selected point? A: Every entry shows a one-line
  summary of what it did: for a delta its first operation and how many more there are, for a snapshot that it
  replaced the state. The full diff, the operations and the full state show in a detail area for the selected
  point. A net diff needs the states before and after, so it is built for the selected point only. This keeps a
  5,000-change list light and reads the same with a pointer or a keyboard.
- Q: Which way does the list run, and what do "first" and "last" mean? A: The list stays newest first, as in
  0.1.0. The spec says "oldest" and "newest" instead of "first" and "last". The newest change is the latest point,
  which is the current state. The down arrow goes to an older change and the up arrow to a newer one. Home selects
  the newest point and End the oldest.
- Q: Does the selection survive leaving the State tab? A: No. The state view is mounted only while the tab is on
  screen, so leaving it and coming back selects the latest point. The selection also resets on a new thread and
  on a replaced session.
- Q: Does an unapplied delta make a point, and does the starting state have a diff? A: An unapplied delta makes a
  point whose state equals the point before it. The starting state is the oldest point. It has no earlier state,
  so it shows in full and has no diff.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what each state change did (Priority: P1)

A developer debugging an agent that shares state with its client watches `STATE_DELTA` and `STATE_SNAPSHOT`
events arrive. 0.1.0 lists each delta as its raw operations and shows only the current state. To learn what a
delta did, the developer has to apply it by hand. The state view now shows, for every change, a diff: the paths
that were added, removed or changed, with the values before and after.

**Why this priority**: Operations say what the agent asked for. The diff says what happened to the state. This
is the main reason for the view and it needs nothing else to be useful.

**Independent Test**: Record a run with a snapshot and several deltas (add, replace, remove, move, copy and
test operations), open the state view, and compare each change's diff with the states before and after it.

**Acceptance Scenarios**:

1. **Given** a run with a `STATE_SNAPSHOT` followed by deltas, **When** the developer opens the state view,
   **Then** every change shows a one-line summary of what it did, and selecting a change shows the full diff:
   each difference has a path, a kind (added, removed or changed) and the value before, after or both.
2. **Given** a diff, **When** the developer reads it in light or dark theme or with colors removed, **Then** the
   kind of each difference is still clear from its word and its sign, not from color alone.
3. **Given** a delta made of `move`, `copy` and `test` operations, **When** its diff shows, **Then** the diff
   lists the net effect on the state (a move is a removal at the old path and an addition at the new one), and a
   delta that leaves the state as it was says "No net change".
4. **Given** a `STATE_SNAPSHOT` that arrives after deltas, **When** its diff shows, **Then** it lists what the
   snapshot replaced, compared with the state just before it.
5. **Given** a delta that cannot be applied, **When** its entry shows, **Then** it is marked "not applied" with
   the reason, its diff is empty, and the state after it is the state before it, as in 0.1.0.
6. **Given** a change that is the first state of the thread and has no earlier state, **When** its entry shows,
   **Then** it is labelled as the first state and shows the state in full instead of a diff.
7. **Given** a selected delta, **When** the developer wants the operations the agent sent, **Then** they show
   with its diff, as 0.1.0 showed them on each entry.

---

### User Story 2 - View the state at any past point (Priority: P1)

The developer wants to know what the state looked like at some moment of the run, not only now. They pick any
change in the history. The view shows the full state after that change, together with its diff, and says clearly
that this is a past state. One action returns to the current state.

**Why this priority**: A diff explains one step. Reading the whole state at a step shows the context around it,
and is the only way to answer "what did the client hold when the agent made this call?".

**Independent Test**: Record a run with deltas and a snapshot in between, select each change in turn, and compare
the state shown with the state a client holds after receiving the events up to that change.

**Acceptance Scenarios**:

1. **Given** a history of several changes, **When** the developer selects one, **Then** the view shows the full
   state after that change, its diff, and a label with the change's type, run, offset and frame reference.
2. **Given** a past point is selected, **When** the view shows its state, **Then** the view says it is a past
   state, and it never presents that state as the one the next run will carry.
3. **Given** a past point is selected, **When** the developer returns to the latest point, **Then** the view shows
   the current state, labelled as before.
4. **Given** a snapshot between two groups of deltas, **When** the developer selects a point after the snapshot,
   **Then** the state has none of the earlier deltas except through the snapshot, and later deltas apply to the
   snapshot's state.
5. **Given** the first run of the thread carried an input state, **When** the developer opens the history,
   **Then** that starting state is the oldest point, shown in full without a diff, and the oldest change is
   compared with it.
6. **Given** a point, **When** the developer follows its frame reference, **Then** the frames list shows the raw
   frame that made the change, as for other frame references in the inspector.
7. **Given** a session with no state events, **When** the developer opens the state view, **Then** it says so, as
   in 0.1.0.

---

### User Story 3 - Move through the history from the keyboard (Priority: P1)

A developer who does not use a pointer picks points, steps from one change to the next and returns to the latest
state with the keyboard alone. A screen reader says which change is selected and whether it is a past state.

**Why this priority**: The issue requires every view to work from the keyboard.

**Independent Test**: With the pointer unused, open the state view, reach the history, step through every change
and back to the latest, and read the selected point's label.

**Acceptance Scenarios**:

1. **Given** the state view, **When** the developer tabs into the history, **Then** focus is visible. The down
   arrow selects an older point and the up arrow a newer one. Home selects the newest point, which is the latest
   state, and End the oldest. The documentation lists the keys.
2. **Given** a selection change by keyboard, **When** the selected point updates, **Then** the state and the diff
   update with it and the selection stays in view.
3. **Given** the history, **When** the developer uses only the keyboard, **Then** every action the pointer
   offers is available: select a point, show operations, open a long value, show more differences, follow a
   frame reference and return to the latest state.
4. **Given** a screen reader, **When** the selection changes, **Then** the new point's label is announced,
   including "past state" or "latest".

---

### User Story 4 - Follow a live run and read an imported session (Priority: P2)

The history works while the agent is still streaming and on a session loaded from a file. During a live run the
developer can stay at a past point while new changes arrive. An imported session shows the history the live
capture showed.

**Why this priority**: The issue requires every view to work in both cases. The behavior follows from the
projection, so it costs little once stories 1 to 3 work.

**Independent Test**: Stream a run into the page and, mid-run, select a past point and watch for 100 more
changes. Then export the session, reload, import it and compare every point.

**Acceptance Scenarios**:

1. **Given** the latest point is selected during a live run, **When** a change arrives, **Then** the history,
   the state and the diff show it without an action.
2. **Given** a past point is selected during a live run, **When** more changes arrive, **Then** the selection,
   the state and the diff stay as they were, the view says how many newer changes there are, and one action jumps
   to the latest.
3. **Given** a session exported from a live capture, **When** it is imported, **Then** the state view shows the
   same history, with the same states and diffs, as the live capture showed. This includes sessions exported by
   0.1.0.
4. **Given** an imported session, **When** the developer browses the history, **Then** the page keeps its
   "inspection only" notice and sends no request.
5. **Given** the developer starts a new thread or selects another agent, **When** the state view updates,
   **Then** it shows the history of the new thread, empty until it has state events, with no selection left over.
6. **Given** any use of the history, **When** the developer then exports the session, **Then** the file is the
   same as one exported before browsing.

### Edge Cases

- A delta before any snapshot and without a starting state applies to an empty object, as in 0.1.0, and its diff
  is against that empty object.
- A delta that cannot be applied still makes a point. Its state equals the state before it.
- Leaving the State tab and coming back selects the latest point.
- A snapshot or delta frame that is not valid JSON, not a known event or not schema-valid projects to nothing, as
  in 0.1.0. It adds no point, and it keeps its finding and its place in the frames list.
- The state can be any JSON value, not only an object. A snapshot that is an array, a string or `null` has a diff
  at the root path.
- Two states with the same members in a different key order have no difference. Arrays are compared position by
  position, so removing an early item shows the later items as changed. The diff says what changed in the state,
  not why.
- A delta whose operations leave the state unchanged, and a snapshot equal to the state before it, show "No net
  change". The point still exists.
- A very long string, a large object or a snapshot with hundreds of differences does not flood the view. Long
  values are shortened with the full value one action away, and a large diff shows its count and the first
  differences.
- State continues across the runs of a thread. Each point names its run. A later run's own input state does not
  reset the history, as in 0.1.0.
- A recording that ends in the middle of a run shows the history it has. The last point is the latest.
- The selected point cannot disappear while the page shows it, because the recording only grows. A new thread
  and an imported session replace the history, so the selection resets to the latest point.
- Keys the history uses must not take over typing in the composer or other controls.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The state view MUST list every valid state change of the current thread, newest first as in 0.1.0.
  Each entry shows its type, its run, its offset, its frame number and a one-line summary of what it did: for a
  delta its first operation and how many more there are, for a snapshot that it replaced the state.
- **FR-002**: For every change the view MUST be able to show a diff between the state before the change and the
  state after it, in the detail area of the selected point. Each difference has a path, a kind (added, removed or
  changed) and the values before and after that apply.
- **FR-003**: The diff MUST describe the net effect on the state, not the operations. It MUST ignore the order of
  object members and compare arrays by position. A change with no net effect MUST say "No net change".
- **FR-004**: The kind of a difference MUST show through a word and a sign as well as color. Text and signs MUST
  keep WCAG 2.2 AA contrast in light and dark themes.
- **FR-005**: A delta that cannot be applied MUST stay marked "not applied" with its reason, leave the state as it
  was and have an empty diff. The raw operations of each delta MUST stay available.
- **FR-006**: A change with no earlier state MUST be labelled as the first state and shown in full. When the first
  run of the thread carried an input state, that state MUST be the oldest point, shown in full without a diff,
  and the oldest change MUST be compared with it.
- **FR-007**: The developer MUST be able to select any point of the history, and the latest point MUST be
  selected by default. The view then MUST show, in a detail area, the full state after that point, the diff of
  that point, its operations when it is a delta and a label with its type, run, offset and frame reference.
- **FR-008**: A past state MUST be labelled as a past state. The view MUST NOT present it as the state the next
  run carries. The current state (the latest point) MUST stay labelled as in 0.1.0, and one action MUST return to
  it.
- **FR-009**: The state shown at every point MUST follow the same rules as the current state: snapshots replace
  the state, deltas apply in arrival order, a failed delta changes nothing. The state at the latest point MUST
  always equal the current state.
- **FR-010**: Past states and diffs are derived data. They MUST be labelled as derived, MUST NOT get a raw frame
  index of their own, and MUST name the frame they come from. That frame reference MUST show the raw frame in the
  frames list, as other frame references do.
- **FR-011**: The history MUST work while a run streams. The view MUST follow the latest point while the latest
  is selected. It MUST keep a selected past point, its state and its diff unchanged while newer changes arrive,
  say how many there are, and offer one action to jump to the latest.
- **FR-012**: The selection MUST belong to a change, not to a position in the list. It MUST reset to the latest
  point when the thread changes, the session is replaced or the State tab is left and opened again.
- **FR-013**: The history MUST work on an imported session and show what the live capture showed. It MUST NOT
  require a new field in a recording or session file, and it MUST work with files from 0.1.0.
- **FR-014**: Browsing the history MUST NOT change the recording, MUST NOT send a request and MUST NOT write
  browser storage. Raw frames, their order and their timing stay as received.
- **FR-015**: Every action the pointer offers MUST work from the keyboard: select a point, step to an older or a
  newer point, jump to the newest and the oldest point, return to the latest state, show the operations, open a
  shortened value, show more differences and follow a frame reference. The list runs newest first, so the down
  arrow goes to an older point, the up arrow to a newer one, Home to the newest and End to the oldest. Focus MUST
  be visible. The selected point's label MUST be announced to assistive technology. The keys MUST be documented.
- **FR-016**: A long value MUST be shortened, with the full value one action away. A diff with more than 100
  differences MUST show its count and the first 100, with the rest on request.
- **FR-017**: The view MUST stay responsive with the 5,000-frame workload in which most frames are state changes
  (SC-004), during capture and after.
- **FR-018**: The docs MUST describe the history: the points, the diff and what it ignores, the past-state label,
  the keys, the live behavior and the imported behavior. The pages that describe views and state MUST be updated
  in the same change.
- **FR-019**: The change MUST add no runtime dependency unless the plan shows that no existing one and no
  platform feature does the job. It MUST keep the production bundle within the `check:bundle` limits.
- **FR-020**: The view MUST work in every mode that serves the one static bundle: hosted, embedded and the npm
  static assets.

### Key Entities *(include if feature involves data)*

- **State change**: One valid `STATE_SNAPSHOT` or `STATE_DELTA` of the current thread, with the run it came from,
  its offset, its frame and whether it could be applied.
- **Point**: A place in the history. There is one after each state change, applied or not, and one before the
  oldest change when the first run carried an input state. The newest point is the latest point, and its state is
  the current state.
- **State at a point**: The full state after the point, built by the same rules as the current state. Derived.
- **Diff**: The differences between the state before a change and the state after it. Derived.
- **Difference**: One path with a kind (added, removed or changed) and the values before and after that apply.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a scripted run of at least 20 deltas with at least two snapshots between them, the state shown
  at every point equals the state a client holds after the events up to that point, for 100% of points.
- **SC-002**: For every change of that run, applying its diff to the state before gives the state after, for 100%
  of changes. A delta with no net effect shows "No net change".
- **SC-003**: With the pointer unused, a developer opens the state view, selects the oldest point, steps to the
  newest one and returns to the latest state. Every action the pointer offers has a keyboard equivalent, which an
  end-to-end test checks.
- **SC-004**: Over the 5,000-frame workload with state changes as most frames, at least 95% of point selections
  show the state and diff within 200 ms of the input. Opening the state view takes under 1 s. The plan fixes the
  workload and the measurement before implementation, as the MVP did.
- **SC-005**: During a live run, a selected past point shows the same state and diff after 100 further changes
  arrive, and the view reports 100 newer changes.
- **SC-006**: A session exported from a live capture and imported again shows the same state and diff at every
  point, 100%. A session recorded by 0.1.0 imports and shows its history.
- **SC-007**: After browsing the history, the exported session is identical to one exported before. The page
  makes no request outside what the run itself made, and the network allowlist test still passes.
- **SC-008**: The production bundle stays within 2,000,000 bytes minified and 600,000 bytes gzipped.
- **SC-009**: Every kind of difference is distinguishable with color removed, in light and dark themes, which a
  test checks.
- **SC-010**: The docs pages that describe views and state mention the history, and the tests that read the docs
  pass.

## Assumptions

- This is one of four views of issue #79. Each has its own specification and pull request. This change keeps to
  the state view and to the shared files it must touch.
- The scope is 0.2.0 as the maintainer approved it. Session and recording formats stay at version 0. This
  feature adds no field to them.
- The history is the history of the current thread, across its runs, as the state view of 0.1.0 shows it.
- A point is a place after a state change. The state at any frame is the state after the latest change at or
  before that frame, so choosing that change covers every frame. A separate "state at this frame" action in the
  frames list is not part of this feature.
- The diff compares JSON values. It does not infer moves, and it does not explain why a path changed.
- Out of scope: comparing two arbitrary points, searching or filtering the history, exporting diffs, and editing
  or replaying state.
- The history lives in the existing State tab of the inspection pane. It adds no tab and no pane. The
  conversation view is unchanged.
- The existing state projection already applies snapshots and deltas by RFC 6902. The history reuses it and does
  not add a second patch engine, as the issue requires.
