# Research: Subagent lanes and timeline

Decisions for [plan.md](plan.md). Each has the decision, the reason and the alternatives that fall short. Facts about the
code are from the repository at `main` (5c21caa) and about the protocol from the pinned `@ag-ui/core` 1.0.1.

## What the protocol says

- `SUBAGENT_STARTED` has `subagentRunId`, `name`, and optionally `description`, `parentSubagentRunId`,
  `parentToolCallId` and `parentMessageId`. In this event `subagentRunId` names the subagent itself.
- `SUBAGENT_FINISHED` has `subagentRunId`, an optional `result` and an optional `outcome`: `success`, or `suspended`
  with optional `interruptIds`. A missing outcome means success. It ends the subagent's segment of this run. A later run
  may continue a suspended invocation.
- `SUBAGENT_ERROR` has `subagentRunId`, `message` and an optional `code`. The run may go on, so it is not `RUN_ERROR`.
- Text message, tool call, step, reasoning, activity, custom, raw and state events, and the whole-message types, carry an
  optional `subagentRunId`. Absent means the parent agent produced the event. `RUN_*` events and `MESSAGES_SNAPSHOT` do
  not carry it.
- `subagentRunId` is opaque and names one invocation, not a reusable subagent. Two invocations of the same subagent
  have two ids.

## R1. Group in the projection, not in the view

**Decision.** `projectConversation` places each entry into its lane while it builds the entries. A lane gets a
`children` list, and the step stack becomes one stack per lane (the parent's flow is the lane `undefined`).

**Why.** Three behaviors depend on where an entry is added and cannot be repaired afterwards. Steps nest by a stack, so
an interleaved `STEP_FINISHED` from another lane would close the wrong step. Chunk lanes already key on
`subagentRunId`, and the entries they open must land in the same place. `MESSAGES_SNAPSHOT` keeps what is still arriving
inside steps, and lanes must follow the same rule. Building the grouping in the same pass keeps one source of truth and
costs one map lookup per frame.

**Rejected.** Tag each entry with its `subagentRunId` and regroup in the view: a step that holds entries of two lanes
cannot be split without rebuilding the step tree, and the snapshot rule would then live in two places. Only adding a
field: it leaves the transcript as hard to read as in 0.1.0.

## R2. One lane per invocation and run

**Decision.** Lanes are keyed by `subagentRunId` inside one run's exchange. A later run that names the same id gets
its own lane, marked as a continuation when an earlier run had one.

**Why.** The protocol says a finish event ends the invocation's segment of the run, and that a later run may continue
it. The 0.1.0 projection kept one marker per id for the whole thread, which pulled later work up into the first run.
Per-run lanes keep each run's transcript in its own section and let the timeline draw each segment on its own axis.

**Rejected.** One lane per id for the thread: it moves content out of the run where it arrived.

## R3. Status

**Decision.** `running`, `finished`, `suspended`, `error`, `stopped`, `no-end`. The latest lifecycle line of the lane in
the run decides: a finish with outcome `suspended` is `suspended`, any other finish is `finished`, an error line is
`error`. A lane whose latest line is a start, or that has none, is `running` while the exchange is live and the run has
no terminal event, `stopped` when the developer stopped the exchange, and `no-end` otherwise. Statuses are set after a
run's frames are read, because they depend on the exchange state.

**Why.** It mirrors the run header (`streaming`, `stopped`, `no-terminal`) and never invents an outcome, as the
projection's contract says. A lane whose parent run fails stays `no-end`: the run header carries the error.

**Rejected.** Marking a lane in a failed run as failed: no frame says so.

## R4. One shared derivation: `model.subagents` and `timelineOf`

**Decision.** The model gets `subagents`, a flat list of every lane in start order. A lane is a `SubagentEntry`, so the
list holds the same objects the transcript holds, plus the ones a `MESSAGES_SNAPSHOT` removed from it (they get
`inTranscript: false`). `core/projection/subagents.ts` exports `timelineOf(model)`, which returns one chart per run that
has lanes: the run, the axis length, and rows depth first.

**Why.** FR-020 asks for one derivation that survives a transcript replacement and that the waterfall can reuse. A list
of the real entries needs no second type and no copying. `timelineOf` is the only place that knows row order, depth and
bar offsets.

**The boundary with the waterfall (spec 011).** This feature owns lanes and the subagent timeline. The waterfall owns
bars for runs, steps, messages and tool calls. They share `model.subagents` (which run, which parent lane, which tool
call, start, end, status) and `RunEntry` (start and `axisMs`). The waterfall may call `timelineOf` for the subagent
rows or read the list and draw its own. Neither view imports the other.

**Rejected.** A function over `model.entries`: a snapshot drops ended lanes from the entries. A second projection pass:
it repeats the placement rules.

## R5. The axis

**Decision.** Each run entry gets `axisMs`, computed as the frames list's frame ticks compute their duration:
`max(exchange.elapsedMs ?? last frame offset, last frame offset, 1)`, over all frames of the exchange. A chart's axis runs
from 0 to `axisMs`. The run row spans `startOffsetMs` to `startOffsetMs + durationMs`. A lane that has not ended draws to
the offset of the last valid frame of the exchange.

**Why.** Frame offsets run from request dispatch, which is the origin the frames list uses. Using the same end means a
row lines up with the ticks of the same run in the frames list. The run entry already holds `startOffsetMs` and
`durationMs`.

**Rejected.** The optional event `timestamp`: the protocol leaves its unit open and says nothing computes with it. One
scale across runs: runs have separate clocks.

## R6. Draw bars with positioned boxes

**Decision.** A chart is a list. Each row has a label cell and a track cell. The bar is a `span` with `left` and `width`
as percentages, set through the element style object, as `views/inspection/frames.tsx` does for its frame ticks. The
end of the bar has a text glyph and a border style per status. The axis is a row of absolutely positioned labels with
the frames list's tick rule.

**Why.** The content security policy is `style-src 'self'`. Setting `element.style.left` is allowed, and the frames list
already ships it. A list of buttons gives focus, names and keys for free. SVG would need its own focus and text
handling for the same result. A chart library is a new dependency for a bar chart.

**Rejected.** An SVG chart, a canvas, a chart library, a CSS grid with computed columns (fractions of a millisecond do
not fit columns).

## R7. Keyboard

**Decision.** Rows are `button` elements in a roving tab stop that covers the whole timeline: the active row has
`tabindex=0` and the others `-1`. The timeline's `keydown` handler moves between visible rows on ArrowDown and ArrowUp,
Home and End, and leaves Enter and Space to the button. A lane's toggle is a `button` with `aria-expanded` and
`aria-controls`, and "Show in timeline" is a second button beside it. The chart box scrolls with `tabindex=0`.

**Why.** The state history spec uses the same arrows. A native button needs no extra key code. The lane header cannot be
a `<summary>` because it needs a second action next to the toggle, and interactive content inside a summary is not a
reliable pattern. Rows and lane toggles carry an `aria-label` that gives name, id, status, duration, start and parent
(FR-015), so nothing depends on indentation or color.

**Rejected.** `aria-activedescendant`: it moves focus without moving the browser's scroll, and it needs more tests. A
tab stop per row: a thread of 200 lanes would need 200 tabs.

## R8. Jumps

**Decision.** `ConversationView` keeps `{ target, path, nonce }` for the last jump to a lane and `{ row, nonce }` for the
last jump to a row, in a small context. `toLane(id)` finds the ids of the steps and lanes around the lane in the current
entries. Each of those opens when the counter changes, through an optional `reveal` token on the shared `Disclosure`
(steps and the timeline) or the lane's own state. The target focuses its toggle in a mount effect and scrolls with
`scrollIntoView({ block: 'nearest' })`. `toRow(id)` opens the timeline, shows all rows of the chart if the row is past
the limit, then focuses the row.

**Why.** It needs no DOM queries into content that is not rendered (collapsed bodies are not mounted, FR-006). The
counter makes a repeated request to the same target work, as `onReveal` requests do. A row whose lane left the
transcript calls `onReveal({ exchangeId, frameId })` for its start frame, which the page already wires.

**Rejected.** Hash links or `id` lookups: they fail on unmounted content. Lifting open state of every disclosure into
one store: more code than the jump needs.

## R9. A `MESSAGES_SNAPSHOT` and lanes

**Decision.** The existing rule for steps applies to lanes: a lane stays while it is still open (every lifecycle line is
a start, as in 0.1.0) or something inside it stays. Otherwise it goes with the replaced transcript. A lane that goes keeps
its place in `model.subagents` with `inTranscript: false`. An attributed event that arrives later for such a lane
puts the same lane object back into the current container with an empty `children` list, so the new events have a
lane and the header keeps its status and lifecycle lines.

**Why.** The snapshot replaces what the transcript shows, not what happened, so the timeline keeps its row. The jump from
that row falls back to the frames list.

**Rejected.** Dropping the lane from the list too: the timeline would forget real work. Keeping every lane through a
snapshot: it contradicts the 0.1.0 rule that a snapshot replaces the transcript.

## R10. What is not a lane

**Decision.** State events are attributed by the protocol but make no conversation entry, so they create no lane. Whole
messages from a run's input or a snapshot keep the 0.1.0 place even when they carry `subagentRunId`, and so does an
`Interrupt` that names one. Only events that make a conversation entry open a lane on their own (R11).

**Why.** Placing whole messages needs a rule for where in a replaced transcript a lane's messages go, and the issue does
not ask for it. The frame stays visible in the frames list with the field.

## R11. Events with an unknown lane and a parent that is not known

**Decision.** An attributed event whose invocation has no lane in this run creates one in the parent's flow, labelled
"Start not received", with no name, description or start offset. A `SUBAGENT_STARTED` whose `parentSubagentRunId` has no
lane yet in this run puts its lane in the parent's flow and the header says "Parent <id> not seen in this run". A start
that arrives after attributed events for the same invocation fills in the name and description and keeps the lane's
place. `parentLaneId` is set only when a lane is created by its own start event, so a lane never moves.

**Why.** The projection's rule is to report instead of inventing. A lane is not an invented fact: it groups frames that
name the id, and the header says what was missing. The alternative, one issue per frame, would flood a thread.

## R12. Performance workloads and the measurement

**Decision.**

- Workload A is the frozen 5,000-frame benchmark fixture (`tests/benchmarks`), which has 20 `SUBAGENT_STARTED`. The
  existing test keeps its limit of 500 ms for one projection.
- Workload B is generated in the new workload test: one run, about 5,000 frames, 200 subagents: 10 at the first level,
  40 under them and 150 under those, each with about 20 attributed frames, a start and an end. The test checks that one
  projection plus `timelineOf` take under 1 s, that `model.subagents` has 200 entries, and that it is linear: doubling
  the frames does not more than triple the time.
- SC-007 is measured in the browser over workload B on the fixture page: the page records the time between each
  `keydown` and the next `focusin` on a lane header over 20 jumps, and the test checks that the 95th percentile is under
  200 ms.

**Why.** The first workload guards the shipped baseline. The second is the case the spec names and the one lanes make
worse if done wrong: many lanes, deep. Timing inside the page avoids the noise of a test driver.

## R13. Styles

**Decision.** One block of `.agui-lane-*` and `.agui-tl-*` rules in `conversation.css`, replacing the `.agui-conv-nest`
rules, placed after the markers block. Spacing is a multiple of `--u`, colors, radii and fonts come from the tokens, no
custom property is declared, every class starts with `agui-`. The status shapes use borders and glyphs, so they need no
new token. Contrast of text and of bar borders against the page is checked with the theme tests' helper in light and
dark.

**Why.** The stylesheet test reads `conversation.css` alone, the app and both fixture pages import it by name, and a
second file would add three edits and a test. Nested lanes are told apart by a rail and by indentation of the border,
not by new colors.

## R14. Reference agent and tests

**Decision.** `scenarios.ts` exports one request text, `SUBAGENTS`, and `interactiveResponse` answers it with a scripted
run: a parent step, two parallel subagents with interleaved text and tool events, a third that starts inside the first,
one error, and a parent message that follows. It is not added to `SCENARIOS`, because the demo test requires the demo's
quick messages to equal `Object.values(SCENARIOS)`, and a new entry would add a demo example this spec does not ask
for. The whole-app spec types the text into the composer. The fixture page covers keys, live arrival and gaps by pushing
frames one at a time, as `events.spec.ts` does.

**Why.** FR-025 asks for a scripted scenario, and the issue says end-to-end tests run only against the reference agent.

## R15. Docs and release

**Decision.** `event-views.mdx` replaces its Subagents section with lanes, statuses, the timeline, the jumps and the
keys, and says what a lane does not hold. `internals.mdx` adds two sentences to the event views wiring about
`model.subagents` and `timelineOf`. `inspection.mdx` adds lanes and the subagent timeline to its derived data list and
the timeline row to the page's account of references into the frames list. A changeset marks `agui-inspector` and `agui-inspector-python` as minor, because the
wheel ships the same bundle. No new script, so `development.mdx` is unchanged. No new dependency, so
`dependencies.mdx` is unchanged.

## Open questions for the maintainer

None. Every question the spec raised was answered from the issue, the roadmap and the constitution (see the
clarifications in the spec).
