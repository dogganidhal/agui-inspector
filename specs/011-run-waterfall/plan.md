# Implementation Plan: Run waterfall

**Branch**: `gh-79-run-waterfall` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/011-run-waterfall/spec.md`

## Summary

0.1.0 shows a run as a list of frames with offsets and as a conversation without time. This feature adds a
Waterfall tab to the Inspection view. It draws every run of the current thread as nested rows on a time axis: the
run, its steps, messages, reasoning messages, tool calls and subagent runs. Each row has a bar from its start to its
end and its times in text. A row whose end has not been seen is drawn open. The rows are a tree you walk with the
arrow keys.

The design adds one core module, one view and almost no shared code:

- `core/projection/waterfall.ts` (new, framework-free) turns a session into run groups of rows. It does not read the
  stream a second time. It runs the existing conversation projection over the session without its
  `MESSAGES_SNAPSHOT` frames (a snapshot makes the projection drop streamed rows, which a timeline must keep), reads
  timing from the entries' frames, and takes subagent rows from the projection's lanes (`SubagentEntry`, spec 009),
  which already hold what a subagent run did and which lane it sits in.
- `views/inspection/waterfall-model.ts` (new, no React) flattens the rows that are visible and holds the key map of
  the tree, so both are unit-tested without a browser.
- `views/inspection/waterfall.tsx` and `waterfall.css` (new) draw the groups, the tree, the bars and the details.
  Bars are positioned with percentages in plain DOM and CSS, as the frames list's timeline is. No chart library.
- `views/inspection/index.tsx` gains the third tab and holds the waterfall's selection and open rows, so they
  survive a tab switch. Its reveal code becomes one function that the waterfall also calls (Enter on a row).
  `app/index.tsx` passes the current thread to the Inspection view, one line.

Nothing here writes to the store, sends a request or reads storage. Rows and times are computed from the recorded
frames on each store update and are never stored. No file format changes.

## Technical Context

**Language/Version**: Existing strict TypeScript (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), React 19, Node 24
or newer.

**Primary Dependencies**: None added. The conversation projection (`core/projection`), the theme primitives (`Tag`,
`Label`, `FamilyDot`, `Icon`, `Button`) and the formatting helpers of `views/inspection/model.ts` cover everything. A
chart library would add a dependency to draw rectangles that CSS draws (see research.md, R5).

**Storage**: None. Selection and open rows live in component state of the Inspection view and reset when the thread
changes or the store is replaced. Nothing goes to browser storage, the store or a file.

**Testing**: `node --test` unit tests for the row builder, the visible-row and key logic, the markup and the docs.
Playwright against a scripted fixture host (real frame reader and store, events from the reference agent package) for
the keyboard, live growth and the workload measurement, and against the production build for the real app: a run with
a held-open stream, export, import and the network allowlist.

**Target Platform**: The one static bundle in every mode (hosted, embedded, npm static assets).

**Project Type**: Static browser app, `packages/inspector`.

**Performance Goals**: SC-008. Over the frozen 5,000-frame workload (10 runs of one thread, 10 steps, 16 messages,
14 tool calls, 6 reasoning messages and 2 subagent runs per run), opening the tab takes under 1 s and at least 95% of
keyboard moves show the new details within 200 ms. Building the rows takes under 500 ms in Node, the budget the
projection test already holds (it takes about 20 ms on this machine).

**Constraints**: Production bundle at most 2,000,000 bytes minified and 600,000 bytes gzipped. Baseline on main at
`20eb7c4` (the base of this branch), measured on 2026-10-04: 1,238,710 and 312,106. The estimate was under 15 KB minified.
Measured with the tab, without subagent rows: 1,257,480 and 317,133, which is +18,770 bytes minified and +5,027 gzipped.

**Scale/Scope**: One tab, three new source files in `views/inspection` (model, view, stylesheet), one in
`core/projection`, small edits to the Inspection view and the app shell, two docs pages, one reference-agent file and
the tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution 1.2.0.

| Rule | Assessment |
| --- | --- |
| I: wire first | Pass. The waterfall reads frames through the existing projection and changes none. Rows and times are labelled derived, carry no frame index and name their first and last frame. A frame that is not valid adds no row and keeps its place and finding in the frames list. An end that no frame carried is never shown: such a row is open. The protocol client's stream is untouched. |
| II: protocol, not a framework | Pass. The rows come from the projection, which reads the events and the `subagentRunId` that `@ag-ui/core` defines. The builder is in `core` with no React. The view is in `views`. No chat framework. |
| III: generic core | Pass. Nothing server-specific. |
| IV: local-only and credentials | Pass. No request, no storage, no logging, no header. Row labels are text from received events and are shown as received. |
| V: small and auditable | Pass. No dependency. The builder reuses the projection and adds one tree-building pass. No abstraction beyond the two modules the view needs. |
| VI: every event type has a view | Pass. No event type changes its frames-list view or its fixture test. The waterfall adds a second view of run, step, text, tool, reasoning and subagent events. `event-views.mdx` points to it, `inspection.mdx` describes it. |
| Architecture: one bundle, CSP | Pass. No new script, no eval, no remote content, no inline style attribute in HTML. Positions are set through the DOM style API, as the frames timeline does under `style-src 'self'`. The stylesheet follows the same text tests as the others. |
| Quality gates | Pass. Regression tests for the builder, the keys, the markup, the docs and the stylesheet. End-to-end tests use scripted, model-free events from the reference agent package. No new npm script, so `development.mdx` needs no row. |
| Release scope | Pass. Issue #79 is accepted 0.2.0 scope. Formats stay at version 0. Changesets for both packages. |

No violation. The Complexity Tracking table stays empty.

After Phase 1: unchanged. The design adds no dependency, no storage and no format field.

## Project Structure

### Documentation (this feature)

```text
specs/011-run-waterfall/
├── spec.md
├── plan.md              # This file
├── research.md          # Decisions, alternatives and measurements
├── data-model.md        # Rows, run groups, visible rows, view state
├── quickstart.md        # How to check the feature by hand and by test
├── contracts/
│   └── waterfall.md     # Module API, markup contract, keyboard map
├── checklists/requirements.md
└── tasks.md             # Written by /speckit-tasks
```

### Source Code (repository root)

```text
packages/inspector/
├── src/
│   ├── core/projection/
│   │   └── waterfall.ts          # NEW: buildWaterfall, WaterfallRow, WaterfallRun
│   ├── views/inspection/
│   │   ├── waterfall-model.ts    # NEW: visibleRows, key map, axis ticks, labels
│   │   ├── waterfall.tsx         # NEW: WaterfallPanel (groups, tree, bars, details)
│   │   ├── waterfall.css         # NEW: classes agui-wf-*
│   │   └── index.tsx             # third tab, waterfall state, one reveal function
│   └── app/
│       └── index.tsx             # passes threadId to InspectionView
└── tests/
    ├── conversation/support.ts   # existing harness, reused
    └── inspection/
        ├── waterfall.test.ts          # NEW: row builder
        ├── waterfall-model.test.ts    # NEW: visible rows, keys, ticks
        ├── waterfall-view.test.tsx    # NEW: markup, roles, text alternatives
        ├── waterfall-workload.test.ts # NEW: the 5,000-frame workload
        ├── waterfall-styles.test.ts   # NEW: stylesheet text rules
        ├── waterfall-docs.test.ts     # NEW: the docs name the view and its keys
        └── waterfall-fixture.tsx      # NEW: scripted fixture host for the browser
examples/reference-agent/
└── delegation-run.ts                  # NEW: pure producer of a nested delegation run
tests/e2e/
├── inspection/waterfall.spec.ts       # NEW: keyboard, live, workload (fixture host)
└── hosted/waterfall.spec.ts           # NEW: real app, held-open run, export, import, no requests
website/content/docs/
├── inspection.mdx                     # Waterfall section
├── event-views.mdx                    # pointers under Steps and Subagents
└── internals.mdx                      # Waterfall wiring section
.changeset/
└── <name>.md                          # minor, agui-inspector and agui-inspector-python
```

**Structure Decision**: The rows are a pure function of the session, so they live in `core/projection` with no React.
Everything that depends on what is on screen (which rows are visible, the keys, the tick labels) is plain TypeScript
in `views/inspection/waterfall-model.ts`, next to `model.ts`, so unit tests reach it without a DOM. The view keeps
the pane's existing home: the Inspection view, which already owns the frames list, the reveal request and the
session controls.

## Design decisions

The reasons and the alternatives are in [research.md](research.md). The short version:

1. **Reuse the conversation projection, minus the transcript snapshots.** `projectConversation` already decides
   what a message, a tool call and a step are, including chunk expansion. `MESSAGES_SNAPSHOT` makes it drop rows
   that streamed earlier (on the 5,000-frame workload it keeps 2 of 160 messages and none of the 140 tool calls),
   which is right for a transcript and wrong for a timeline. The builder passes the session without those frames.
2. **Timing comes from frames, not from the entries' own fields.** An entry names its frames. The first frame of the
   entry in its own exchange is the start. The end is the frame that ends it by its event type, or none.
3. **An end is a frame or nothing.** A row with no end frame is open and extends to the latest frame of its run. It
   says "running" while the exchange streams and "no end seen" after. Chunk-built rows end at their last chunk once
   the projection has closed them.
4. **One axis per run, from dispatch.** 0 is when the request was sent, as in the frames list, and the axis ends at
   the later of the latest frame and the exchange's elapsed time, the same rule the frames timeline uses.
5. **Nesting is the projection's structure plus one rule.** A step holds what the projection put inside it, and a
   subagent lane holds the entries that carry its id and the lanes it started (`parentSubagentRunId`). The one rule
   added here: a subagent nests under the tool call named by `parentToolCallId` when that call is a row of the run. A
   move that would put a row inside its own subtree is refused, so the tree always holds every row.
6. **A subagent is a lane, which is a segment per run.** The projection makes one lane for each run in which a
   subagent appears, so a suspended subagent continued in a later run has two rows. A lane's status, start and end
   offsets and `continued` flag are the projection's. Only a lane that ended by an event (finished, suspended or error)
   has an end in the waterfall; the lane's end offset of an unfinished lane is the last frame, which is not an end.
7. **The tree pattern, flat.** `role="tree"` with one tab stop (roving `tabindex`), `aria-level`, `aria-expanded`,
   `aria-setsize` and `aria-posinset` on each `treeitem`. Selection follows focus. Enter shows the first frame.
   Bars and axes are `aria-hidden`; the item's `aria-label` carries kind, label, level, times and state.
8. **State lives above the tab.** The Inspection view holds the selected row id and the closed rows, keyed to the
   thread and the store, so a visit to the frames list and back keeps them and a new thread or import resets them.

## Test plan

Spec scenario to test:

| Spec | Test |
| --- | --- |
| US1.1 to US1.3, US1.5, FR-004, SC-001 | `waterfall.test.ts`: the reference agent's delegation run (three steps, five messages, three tool calls) with fixed offsets. Every row's start, end and duration equal the offsets of its bounding frames. A server-answered tool call has argument end and result time. Overlapping messages are siblings with overlapping spans. |
| US1.4, FR-007 | `waterfall.test.ts`: a call left for the client ends at its arguments and says it waits; a later run that carries the result turns the first row into "answered by the client" with no time. |
| US1.6, FR-002, FR-003 | `waterfall.test.ts`: three runs of one thread are three groups, newest first, each with its own axis length (the later of latest frame and elapsed time). A run of another thread, a preparation and a raw exchange add none. |
| US1.7 | `waterfall-view.test.tsx`: a zero-length row still has a bar element and its duration text. |
| US2.1 to US2.5, FR-006, SC-002 | `waterfall.test.ts`: a tool call starts subagent A, which starts B, with attributed messages and tool calls. Parents are as the events name them. A missing parent, a cycle (A under B under A) and an attribution to an unknown subagent leave every row under the run or its structural parent. A subagent finished with an error and one suspended carry their tag. A subagent continued in a second run has a row in each. |
| US3.1 to US3.4, FR-008, SC-003 | `waterfall.test.ts`: a streaming run, a run stopped by the user, a run with no terminal event and a finished run whose message has no end event. No open row has an end. The label is "running" for the live exchange and "no end seen" otherwise. A run that ended keeps its end. |
| US3.5, FR-009 | `waterfall.test.ts`: status words for finished, interrupted, cancelled, error, stopped and no terminal event, with a transport error. |
| US3.1, US3.6, FR-010, SC-005 | `tests/e2e/inspection/waterfall.spec.ts` on the fixture host: stream a run in steps, check each new row and each closed bar after the frame that causes it, keep a selection and a closed step while 100 more frames arrive. |
| US4, FR-015, SC-004 | `waterfall-model.test.ts`: every key of the map on a visible-row list (down, up, right on a closed row, right on an open row, left on an open row, left on a leaf, Home, End, Enter). `waterfall.spec.ts`: keyboard only, from Tab into the tree to the deepest row, close and open a step, Enter shows the frame in the frames list, typing in the composer does nothing. |
| US4.5, FR-015, FR-016 | `waterfall-view.test.tsx`: roles, `aria-level`, `aria-expanded`, `aria-selected`, one `tabindex="0"`, and an `aria-label` with kind, times and state, for every row kind. Kind words and state words are text in the markup, so removing color loses nothing (SC-010). |
| US5, FR-013 | `waterfall-view.test.tsx`: the details of each kind. `waterfall.spec.ts`: the first-frame reference opens that frame in the frames list (`aria-current` on it). |
| US6, FR-011, SC-006 | `tests/e2e/hosted/waterfall.spec.ts`: a run, export, reload, import, compare rows, nesting and times with the live capture. A session file shaped like 0.1.0 (existing fixture) imports and shows its waterfall. |
| US6.3 to US6.5, FR-012, FR-014, SC-007 | The same spec: export before and after use is byte-identical, no `localStorage` or `sessionStorage` write, the network allowlist test passes, a new thread empties the waterfall, selection and a closed step survive Frames and back. |
| FR-016, SC-010 | `waterfall.spec.ts`: text contrast of row text, tags and bars against the background in both themes at AA. |
| FR-017, SC-008 | `waterfall-workload.test.ts`: build over the workload under 500 ms and the counts of rows per kind. `waterfall.spec.ts`: open the tab and make 100 key moves over the workload, p95 under 200 ms, open under 1 s. |
| FR-018, SC-009 | `npm run build && npm run check:bundle` in `check:ci`. No dependency row. `waterfall-styles.test.ts`: tokens only, namespaced classes, nothing fetched. |
| FR-019, SC-011 | `waterfall-docs.test.ts` and the existing tests that read the docs. |

## Risks

- **Shared files.** `views/inspection/index.tsx` and `app/index.tsx` are small hunks (a tab, state, one prop, one
  function). The state history (010) edits `app/index.tsx` or the State tab, the Markdown work (012) edits the
  conversation, the subagent lanes (009) edit the conversation and may edit `core/projection/index.ts`. The waterfall
  touches none of those files except the one-line prop in `app/index.tsx`.
- **Subagent lanes.** The waterfall reads the lanes of spec 009 and derives no subagent fact itself (spec 009 merged as
  #98 before this was finished). If a field it reads changes there, `waterfall.ts` and its tests change with it.
- **Very large runs.** A single run with thousands of rows draws them all. The workload has about 48 rows per run, so
  this is not measured. If a recording proves otherwise, windowing the visible rows is a change inside
  `waterfall.tsx` and `visibleRows` and needs no change to the model.
- **Arrival times.** Buffering can bunch frames, so bars show when the browser read frames. The details and the docs
  say so. Using the producer's optional event timestamps is out of scope because their unit is not fixed.
- **Live layout.** The axis length grows with the latest frame, so open bars shorten visually as the run goes on.
  This is the intended behavior of a waterfall and is documented.
