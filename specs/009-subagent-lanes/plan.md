# Implementation Plan: Subagent lanes and timeline

**Branch**: `gh-79-subagent-lanes` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/009-subagent-lanes/spec.md`, issue [#79](https://github.com/dogganidhal/agui-inspector/issues/79), and the 0.2.0 roadmap (item 7).

**Status**: Planning. Implementation starts after the maintainer approves the spec and this plan.

## Summary

Turn the 0.1.0 subagent marker into a lane, and add a subagent timeline above the transcript.

- A lane is one block per subagent invocation and run. It holds the subagent's header and every entry whose event carries
  that `subagentRunId`. Lanes nest by `parentSubagentRunId`. Parallel subagents get separate lanes, so interleaved events
  no longer mix.
- The timeline draws one chart per run that has subagents: a time axis, a row for the run, and a row for each lane,
  nested rows under their parent. Rows are buttons. Activating one jumps to the lane. A lane's header has the way back.

The projection does the grouping, because steps, chunk-opened messages and `MESSAGES_SNAPSHOT` all depend on where an
entry is added. It also records every lane in a flat list on the model, `subagents`, which a transcript replacement does
not shorten. One small function over that list, `timelineOf`, gives the timeline its rows. The waterfall of runs
(spec 011) can read the same list and call the same function.

The change is a view change. The recording, the session format and the network are untouched. The shared files get
small edits, and the new code is in new files.

## Technical Context

**Language/Version**: Strict TypeScript 7.0.2 with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`, React 19.3.0, Node 24 or newer.

**Primary Dependencies**: Existing exact-pinned packages only. No chart library, no SVG library: bars are positioned boxes.

**Storage**: None. Lane collapse, timeline selection and the row limit are React state. Nothing goes to browser storage, profiles, configuration or sessions.

**Testing**: `node --test` through the repository's esbuild runner (projection, derivation, `renderToStaticMarkup` for markup), and Playwright on Chromium: the conversation fixture page for views, keys and live behavior, and the whole app against `examples/reference-agent` for a live run, export and import.

**Target Platform**: The one static bundle: hosted, embedded and npm static assets. No mode-specific code.

**Project Type**: Static browser app, React views over framework-free core.

**Performance Goals**: SC-006 and SC-007. The frozen 5,000-frame workload still projects in under 500 ms. A 5,000-frame thread of 200 subagents, three levels deep, projects and builds its timeline in under 1 s. At least 95% of row jumps show the lane with focus in its header within 200 ms. The fixed workloads and the measurement are in [research.md](research.md) R12.

**Constraints**: Production bundle at most 2,000,000 bytes minified and 600,000 bytes gzipped (now 1,227,500 and 308,758, so there is room). Content security policy unchanged: scripts and styles from the page's own origin, no `eval`. Bar positions use the element style object, as the frames list does, which the policy allows. No new theme property or token. `tests/conversation/styles.test.ts` keeps checking the stylesheet. No request caused by rendering.

**Scale/Scope**: Two new view modules, one new core module, edits in the projection, the conversation view, one shared helper and one stylesheet, one reference-agent branch, tests, docs and one changeset. No change to `contracts.ts`, `src/app` or any format.

## Constitution Check

*GATE: passes before Phase 0 and after Phase 1 design (constitution 1.2.0).*

| Rule | Assessment and evidence |
| --- | --- |
| I: the wire comes first | Pass. The projection reads valid frames and writes nothing back. Frames, order, timing and chunk expansions are as before, and every lane entry keeps its frame references. A test hashes the recorded frames and the session export before and after projecting and rendering (SC-010). Positions on the timeline are labelled derived, and no raw index is invented. |
| II: the protocol, not a framework | Pass. Attribution uses the `subagentRunId` field that `@ag-ui/core` defines. No chat or chart framework. `src/core` and `contracts.ts` stay free of React. The new core module has plain data in and out. |
| III: generic core, application presets | Pass. Nothing server-specific. The reference-agent branch is a test fixture. |
| IV: local-only and credential privacy | Pass. Rendering makes no request and stores nothing. Names, ids, descriptions and results are shown as text. Exports are unchanged. |
| V: small and auditable | Pass. No dependency is added. One new core module and two view modules, no abstraction beyond what two consumers share. The waterfall boundary is one list and one function. |
| VI: every event type has a view | Pass. No event type is added or removed. Each event type that can carry `subagentRunId` and makes a conversation entry gets a fixture test that puts it in its lane. State events carry the field too and stay in the state view. Encrypted reasoning is untouched and not decoded. |
| Architecture: one static bundle, CSP | Pass. No inline style attribute in markup (the style object is set through the DOM API), no script, no `eval` (the test over `src` still passes). |
| Quality gates | Pass. Regression tests per FR-025, `npm run check:ci`, the bundle check (SC-011), and a docs test. The 50,000-frame, WCAG audit and format-version items in the constitution are 1.0.0 gates, and no 1.0.0 is planned. Keyboard use, native semantics and contrast are still built and tested here. |
| Release scope | Pass. Accepted 0.2.0 scope: issue #79, roadmap item 7. Only released features are used. Formats stay at version 0 with no change. |

No violation, so the complexity table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/009-subagent-lanes/
├── spec.md
├── plan.md              # this file
├── research.md          # decisions R1 to R14
├── data-model.md        # lane, segment, status, chart, row
├── quickstart.md        # how to see it and how to run each check
├── contracts/
│   └── lanes-and-timeline.md   # placement rules, derivation, markup, keys, texts, waterfall reuse
├── checklists/
│   └── requirements.md
└── tasks.md             # from /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/
├── src/core/projection/
│   ├── index.ts                      # EDIT: lanes (per-lane containers and step stacks), segment fields and status, model.subagents, RunEntry.axisMs, snapshot rules
│   └── subagents.ts                  # NEW: timelineOf(model) and the chart and row types
├── src/views/conversation/
│   ├── lanes.tsx                     # NEW: LaneBlock, status map, jump state and context, accessible names
│   ├── timeline.tsx                  # NEW: SubagentTimeline: charts, rows, keys, row limit
│   ├── index.tsx                     # EDIT, small: lane case, timeline above the entries, nav provider, StepBlock reveal, remove SubagentBlock
│   ├── shared.tsx                    # EDIT, small: Disclosure takes an optional reveal token
│   └── conversation.css              # EDIT: one block of .agui-lane-* and .agui-tl-* rules, replacing the .agui-conv-nest rules
└── tests/
    ├── conversation/lanes.test.ts            # NEW: projection: attribution, nesting, parallel, steps, chunks, statuses, gaps, snapshot
    ├── conversation/timeline.test.ts         # NEW: timelineOf: rows, order, offsets, axis, runs
    ├── conversation/lanes-view.test.tsx      # NEW: markup, names, statuses without color, row limit
    ├── conversation/lanes-workload.test.ts   # NEW: the 200-subagent thread
    ├── conversation/lanes-docs.test.ts       # NEW: the docs claims
    └── conversation/events.test.ts           # EDIT only if a 0.1.0 assertion on the marker needs the lane's new fields

examples/reference-agent/scenarios.ts          # EDIT: one exported request text and one case in interactiveResponse for nested and parallel subagents (not added to SCENARIOS)
tests/e2e/conversation/lanes.spec.ts           # NEW: fixture page: lanes, timeline, keyboard, contrast, live, snapshot, row limit
tests/e2e/conversation/lanes-app.spec.ts       # NEW: whole app against the reference agent: live run, export, import, no requests
tests/e2e/conversation/events.spec.ts          # EDIT only if the 0.1.0 marker assertions need the lane's markup

website/content/docs/event-views.mdx           # EDIT: the Subagents section becomes lanes and timeline, with the keys
website/content/docs/internals.mdx             # EDIT: the projection's subagents list and timelineOf, in the event views wiring
website/content/docs/inspection.mdx            # EDIT: lanes and the subagent timeline in the derived data list, and the timeline row in "Arriving from the conversation"
.changeset/<name>.md                           # NEW: minor for agui-inspector and agui-inspector-python
```

**Structure Decision**: One new core module next to the projection, because the derivation is data and the waterfall needs it. Two view modules in the existing conversation folder. The stylesheet stays one file because the stylesheet test, the app and the fixture pages load that one.

## Design

The detail is in [contracts/lanes-and-timeline.md](contracts/lanes-and-timeline.md) and [data-model.md](data-model.md). In short:

1. **Projection.** Each event is mapped to a lane: the invocation named by its `subagentRunId`, created on demand, or the parent's flow when it names none. `add` puts an entry into the container of that lane, which is the top of that lane's own step stack, or the lane's children. The step stack becomes one stack per lane. A `SUBAGENT_STARTED` creates the lane inside its parent's container when the parent started earlier in the run, and in the parent's flow otherwise. A lane is created once per run and invocation.
2. **Status and offsets.** The lane records its start offset, its first offset, its lifecycle lines and, when the run's frames are all read, its status and end offset. The status follows the latest lifecycle line, and falls back to Running, Stopped by you or No end event by the exchange's state, as the run header does.
3. **Shared list.** `model.subagents` holds every lane in start order, including the ones a `MESSAGES_SNAPSHOT` took out of the transcript. `timelineOf(model)` turns the list and the run entries into charts and rows, depth first, in plain data.
4. **Lanes view.** `LaneBlock` draws the header as a toggle button, with a "Show in timeline" button and frame references beside it, and the body only while open. The body shows the lifecycle lines, then the lane's children through the same entry renderer as the rest of the conversation.
5. **Timeline view.** `SubagentTimeline` draws each chart as a scroll box with an axis and a list of rows. A row is a button holding a label cell and a track cell with a positioned bar. One roving tab stop covers every row. The first 100 rows of a chart show, and one button shows the rest.
6. **Jumps.** The conversation view holds one small piece of state, the last jump request with a counter. A request to a lane lists the steps and lanes around it, which open on the counter, and the target focuses its toggle once mounted. A request to a row opens the timeline and the chart's full list when needed, then focuses the row.

## Phases

- **Phase 0**: [research.md](research.md), done.
- **Phase 1**: [data-model.md](data-model.md), [contracts/lanes-and-timeline.md](contracts/lanes-and-timeline.md), [quickstart.md](quickstart.md), done.
- **Phase 2**: `/speckit-tasks` writes [tasks.md](tasks.md). `/speckit-analyze` checks it. The maintainer reviews the spec and this plan before `/speckit-implement`.

## Risks

- Per-lane step stacks touch the heart of the projection. The existing projection tests for steps, chunks and snapshots stay as they are, and they must keep passing before any lane test is added. A thread without subagent frames must project as before: a test checks that it has no lane and an empty `subagents` list, and the 5,000-frame workload test keeps its entry and issue counts.
- Other #79 workers edit `views/conversation/index.tsx` and `conversation.css` at the same time (Markdown adds a toolbar and a stylesheet block). The edits here are a few lines in `index.tsx` and one block in the stylesheet. The orchestrator can rebase either order.
- The waterfall worker may want fields that this list lacks. The list carries every relationship, offset and status the spec names, and adding a field later is a small change.
- A running lane's bar grows with every frame, so the timeline re-renders often. It memoizes on the model, the model changes once per animation frame, and a chart renders at most 100 rows until asked. R12 measures it.
- The `ok`, `warn` and `err` tags may fall short of 4.5:1 against the light page at the small size the lanes use. The state history work measured 4.07:1 for `ok` at 11 px. T019 measures the painted colors. If a status word fails, it uses the neutral tag, and the status shows through the glyph, the bar and the word, which stay readable on their own.
- Frames from a lane whose start was missing fall back to "Start not received". If a real server sends many such frames by mistake, the developer sees one clearly labelled lane instead of a mixed transcript, which is the useful failure.
