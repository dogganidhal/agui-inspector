# Research: Run waterfall

Decisions taken before design, with the alternatives that lost. Measurements were made on 2026-10-04 on `main` at
`5c21caa`, on an Apple development machine, with Node 24.

## R1: Where the rows come from

Decision: run `projectConversation` and read its entries.

Rationale: The projection already settles what a message, a reasoning message, a tool call, a step and a subagent are,
how chunk events expand into them, which frames they came from (`entry.frames`) and which run they belong to
(`entry.exchangeId`). A waterfall that decided these things again would disagree with the conversation in odd cases,
and the issue asks views to reuse the recording and its projections. The projection runs in about 20 ms over 5,000
frames, and the conversation and state views already run it on every store update.

Alternatives:

- A new pass over the frames in `waterfall.ts`. It needs its own chunk-lane inference (`laneOfChunk`, `OpenChunk`,
  about 50 lines) and would drift from the conversation. Rejected.
- Add start and end offsets to the projection's entries. It is the tidiest data, but `core/projection/index.ts` is a
  file that the subagent lanes work may also change, and the entries already carry what is needed (frames, with their
  offsets). Rejected to keep the shared edit at zero. If 009 adds fields, the builder can use them.

## R2: A messages snapshot drops rows that streamed

Decision: pass the projection the session without its `MESSAGES_SNAPSHOT` frames.

Rationale: `MESSAGES_SNAPSHOT` replaces the transcript in the projection. That is the right view of a conversation
and the wrong view of a timeline, because a message that streamed for 3 seconds did take 3 seconds. Measured on the
frozen 5,000-frame workload (10 runs of one thread):

| Projection input | run | step | message | tool | reasoning | subagent |
| --- | --- | --- | --- | --- | --- | --- |
| The session as recorded | 10 | 40 | 2 | 0 | 0 | 0 |
| The session without `MESSAGES_SNAPSHOT` frames | 10 | 100 | 160 | 140 | 60 | 20 |

A snapshot also closes every open chunk lane. Without it the lane closes at the next event, which only changes when
a chunk-built row counts as closed, not its last chunk frame, which is its end.

Alternatives:

- Use the entries as they are and accept the loss. It would hide 98% of the workload's rows. Rejected.
- Make the projection keep dropped rows when asked. It touches `core/projection/index.ts`. Rejected as in R1.

## R3: Reading the frames of an entry

Decision: an entry's own-exchange frames give its timing. The first is the start. The end is a frame by event type.

Details:

- `entry.frames` can hold frames of a later exchange, because the projection keeps entries across the runs of a
  thread (a tool call started in run 1 whose result frame arrives in run 2). Offsets are per exchange, so the builder
  keeps only the frames whose `exchangeId` is the entry's own. A result frame in another exchange makes the row
  "answered in a later run", the same words as a result the client entered.
- Message end: a `TEXT_MESSAGE_END` frame. Chunk-built message: its last chunk once the projection has closed it
  (`live` is false) and the run did not stop without a terminal event. Reasoning: `REASONING_END` when the reasoning
  has a `REASONING_START`, else `REASONING_MESSAGE_END`, or the chunk rule.
- Tool call: arguments end at `TOOL_CALL_END` (or the chunk rule), result at `TOOL_CALL_RESULT` in the same exchange.
  A call with an end and no result in a run that has a terminal event ends at its arguments and says "waiting for
  result" when the projection marks it pending, else "no result". In a run without a terminal event it stays open.
- Step: `durationMs` is set by `STEP_FINISHED`. Without it the step is open.
- Run: the status says. `finished`, `interrupted`, `cancelled` and `error` have an end at start plus duration. The other
  three statuses are open.
- Subagent: `lines` of the entry, grouped by the exchange of their frame. A start line, a finish line or an error
  line in the run gives the row.

## R4: Subagent nesting

Decision: nest by structure and attribution, and refuse a cycle.

Facts from `@ag-ui/core` 1.0.1: every event may carry `subagentRunId` (the subagent invocation it belongs to, absent
means the parent agent produced it). `SUBAGENT_STARTED` carries its own `subagentRunId`, an optional
`parentSubagentRunId` (nested delegation) and an optional `parentToolCallId` (agents exposed to a model as tools).
`SUBAGENT_FINISHED` may end suspended, which is terminal for the stream and not for the subagent.

Spec 009 (PR #98, merged) made the projection attribute entries to subagent lanes. A `SubagentEntry` is one invocation in
one run. It holds the entries that carry its `subagentRunId` (steps it opened hold their own children, nested lanes are
children), and has `status`, `startOffsetMs`, `firstOffsetMs`, `endOffsetMs`, `continued`, `parentToolCallId`,
`parentMessageId` and `parentLaneId`. `ConversationModel.subagents` lists every lane, the same objects the entries hold.
The waterfall reads these and derives no subagent fact of its own. It does not use `timelineOf`, which has no rows for
steps, messages or tool calls.

What the waterfall adds is one rule: a subagent started by a tool call (`parentToolCallId`) sits under that call's row,
because a waterfall of tool calls should show a delegating call as holding the subagent run. The projection puts the
lane in the flow that held the call. The move is applied in arrival order and refused when the call is inside the lane's
own subtree, so malformed or circular parents leave the row where the projection put it.

A lane's `endOffsetMs` is the last frame of the exchange when no end event came, so the waterfall gives a lane an end only
when its status is `finished`, `suspended` or `error`.

Is the `MESSAGES_SNAPSHOT` filter still needed with lanes in the projection? Yes. Measured on 2026-10-04 on `main` with the
frozen workload, the session as recorded gives 10 runs, 40 steps, 2 messages, no tool calls and no subagent entries in
`entries` (the 20 lanes stay in `model.subagents`, without their children). Without the snapshot frames it gives 100 steps,
160 messages, 140 tool calls, 60 reasoning messages and 20 lanes. The lane rule keeps lanes in the list, not what they held.

## R5: Drawing

Decision: plain DOM and CSS. Each row is a grid of a label, a track and a duration. A bar is a `span` positioned in
the track with `left` and `width` in percent, set through the DOM style API. A tool call has two spans.

Rationale: The frames list already draws its timeline this way. A run has about 48 rows on the workload. Positioning
needs no layout engine. DOM text keeps the rows readable by assistive technology and by tests.

Alternatives:

- SVG or canvas. Text and focus handling need work, and bars would not be selectable in tests by role. Rejected.
- A chart or timeline library. It adds a runtime dependency, a row in `dependencies.mdx` and some weight to draw
  rectangles. The issue says no charting library unless the plan proves it is needed. It is not. Rejected.

CSP: `style-src 'self'` blocks style attributes in markup, not changes through the DOM style API. React uses the API
and `frames.tsx` already positions ticks this way, so this is not new.

## R6: Keyboard and screen readers

Decision: the ARIA tree pattern with a flat structure.

- `role="tree"` with an accessible name. Each row is `role="treeitem"` with `aria-level`, `aria-setsize`,
  `aria-posinset`, `aria-expanded` (only on rows with children) and `aria-selected`.
- Roving `tabindex`: the selected row, or the first row when there is no selection, has `tabindex="0"`. One Tab stop
  for the whole tree, so a developer does not tab through hundreds of rows.
- Selection follows focus. The details area is not a live region, because the item's own label already says
  everything, and a live region would repeat it on every key.
- Bars, tick labels and the dot are `aria-hidden`. The item's `aria-label` carries kind, label, start, end or open
  state, duration and tag text.

Alternatives:

- A listbox (as the state history uses). It has no nesting and no expanded state. Rejected.
- A treegrid. It adds a second axis of navigation (cells) for one text cell and a bar. Rejected.
- Buttons in a list. Every row is a Tab stop. Rejected.

Keys: Down, Up, Right, Left, Home, End and Enter, as the tree pattern defines them, with Enter showing the frames.
Keys act only while a row has focus, so the composer and other controls keep their keys.

## R7: Where the view lives

Decision: a third tab of the Inspection view (Frames, Waterfall, Raw request). State sits in `InspectionView`.

Rationale: The Inspection view owns the reveal request, which Enter and the frame references use. State held there
survives a tab switch like the frames list's filter does. The app shell keeps its tabs. Only the current thread has to
reach the view, which the State view already receives the same way.

Alternatives:

- A tab of the pane next to State and Settings. It edits `app/index.tsx` more and needs a second reveal path.
  Rejected.
- Inside the conversation. That is where 009 works, so it is excluded by the assignment. Rejected.

## R8: The reveal function

`InspectionView` applies a `reveal` prop in its render, with a `handled` marker so a remount does not replay it. The
waterfall needs the same effect from an event handler. The prop's block becomes a local function
`showEvidence(target)`. The render calls it for the prop (as today) and the waterfall's `onShowFrames` calls it
directly. Behavior of the prop path does not change, and the existing reveal tests stay as they are.

## R9: Workload and measurement

The 5,000-frame workload is the frozen benchmark fixture (`tests/benchmarks/generate.ts`, ten exchanges of 500
frames, one thread in the projection tests). Offsets are given by the test: a fixed step per frame, because the
benchmark sets none. Measured with this fixture:

| Measure | Result |
| --- | --- |
| Projection without `MESSAGES_SNAPSHOT` frames | 19.8 ms |
| Rows | 10 runs, 100 steps, 160 messages, 140 tool calls, 60 reasoning messages, 20 subagent runs |
| Rows per run | about 48 |

Targets (SC-008): build under 500 ms in Node (a 25-fold margin). In the browser, opening the tab under 1 s and 95% of
100 key moves under 200 ms, measured from the key event to the second animation frame after it, as the benchmark
profile defines a measurement. These are development measurements. They do not claim the headed-runner certification
of the MVP benchmark.

## R10: Test host and reference agent

Decision: a scripted fixture host for the keyboard, live and workload specs, and the production build with a scripted
target for the real-app spec. A new file `examples/reference-agent/delegation-run.ts` is a pure producer of one
nested delegation run (three steps, a reasoning message, a text message built from chunks, three tool calls of which
one is answered by the server and one is left for the client, a subagent started by a tool call and a second one
started by the first, with attributed messages and tool calls, and one subagent that ends with an error). Unit tests,
the fixture host and the real-app spec use it, so they read the same run.

Why not a new scenario in `scenarios.ts`: `SCENARIOS` also defines the demo's quick messages, and
`tests/demo/scenarios.test.ts` fixes their number and order. A demo scenario that shows the waterfall is a good
follow-up, but it changes the public demo and its docs, which is outside this issue.

The real-app spec serves the producer's events from its own small server with a pause between frames, like the
held-open server of `stop.spec.ts`, so bars have real width. The existing reference scenarios `tools` (client tool
calls left pending) and `never finishes` (a held-open stream) are used where they already say what the test needs.

## R11: Bundle

Baseline on `main`: `app.js` 1,188,612 bytes, `app.css` 37,765, total 1,227,500 minified and 308,758 gzipped, against
2,000,000 and 600,000. The new code is a builder of a few hundred lines, a view of a few hundred lines and a
stylesheet. The estimate was under 15 KB minified. Measured on 2026-10-04 against `20eb7c4`: +18,770 bytes minified (4,621 in CSS and 14,149 in JS) and +5,027 gzipped, with the tab and without subagent rows. That is 1.3% of the limit.
