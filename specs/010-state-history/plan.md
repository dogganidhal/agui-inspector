# Implementation Plan: State history

**Branch**: `gh-79-state-history` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-state-history/spec.md`

## Summary

The State tab of 0.1.0 shows the current state and a list of every snapshot and delta with its operations. This
feature turns the list into a history. Each entry is a point. Selecting a point shows the full state after it and
the diff of that change. The newest point is the current state and is selected by default, so a live run keeps
working as before until the developer picks an older point.

The design adds almost nothing to the projection and nothing to the recording:

- The projection (`core/projection`) already folds snapshots and deltas into the current state and keeps every
  change in order. It gains two optional facts: the state the first run started from (`initial`), and a
  checkpoint (the state after the change) on every 64th delta since the last anchor. Both are references to
  objects the fold already produced, so they cost no copy.
- A new framework-free module `core/projection/state-history.ts` computes the state at any point by replaying at
  most 63 deltas from the nearest anchor (a snapshot, a checkpoint or the starting state). It uses the same patch
  engine and the same rule as the projection, from one shared function (`applyStateDelta` in `patch.ts`).
- A new framework-free module `core/projection/state-diff.ts` compares two JSON values and returns the added,
  removed and changed paths. It is about 40 lines and is the only new algorithm.
- The view (`views/conversation/state.tsx`, with the history parts in a new `state-history.tsx`) shows a list of
  points as a listbox with arrow-key navigation and a detail area for the selected point.

Nothing here writes to the store, sends a request or reads storage. Past states and diffs are computed from the
recorded frames each time and are never stored. No file format changes.

## Technical Context

**Language/Version**: Existing strict TypeScript (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), React 19,
Node 24 or newer.

**Primary Dependencies**: None added. The existing patch engine in `core/projection/patch.ts` and the existing
theme primitives (`Tag`, `Label`, `CodeBlock`, `Finding`, `Button`, `FamilyDot`) and view helpers (`Disclosure`,
`FrameRef`, `useProjection`) cover everything. The diff is a small function; a diff library would add a
dependency for 40 lines (see research.md, R3).

**Storage**: None. The selected point lives in component state and is lost when the State tab closes (spec
clarification 3). Nothing is written to browser storage, the store or a file.

**Testing**: `node --test` unit tests for the diff, the history and the projection additions, and for the view
through `renderToStaticMarkup`. Playwright against the existing conversation fixture host for the pointer and
keyboard flows, and against `examples/reference-agent` through the real app for live and imported sessions.

**Target Platform**: The one static bundle in every mode (hosted, embedded, npm static assets).

**Project Type**: Static browser app, `packages/inspector`.

**Performance Goals**: SC-004. At least 95% of point selections show state and diff within 200 ms, and the State
tab opens in under 1 s, on the fixed workload in research.md (R5): 5,000 frames, 4,950 deltas and 50 snapshots,
a state of about 3 KB.

**Constraints**: Production bundle at most 2,000,000 bytes minified and 600,000 bytes gzipped. Baseline on main
at `e400f85`: 1,227,500 and 308,758. Expected addition: under 10 KB minified. Measured at the end of implementation: +8,188 bytes minified and +2,404 gzipped (1,235,688 and 311,162 in total).

**Scale/Scope**: One view, three new source files (two in core, one in views), small edits to the projection,
the patch module, the State view, one stylesheet, the docs and the tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Constitution 1.2.0.

| Rule | Assessment |
| --- | --- |
| I: wire first | Pass. The history reads frames through the existing projection and changes none. Past states and diffs are labelled derived, carry no frame index and name their source frame. Invalid state frames still project to nothing and keep their finding. The protocol client's stream is untouched. |
| II: protocol, not a framework | Pass. State events are applied by the existing patch engine, in `core`, with no React. The view sits in `views`. No chat framework. |
| III: generic core | Pass. Nothing server-specific. |
| IV: local-only and credentials | Pass. No request, no storage, no logging. State values are shown as received, with no redaction, as for the current state today. |
| V: small and auditable | Pass. No dependency. One new algorithm of about 40 lines, with a test. No abstraction beyond the two functions the view needs. |
| VI: every event type has a view | Pass. `STATE_SNAPSHOT` and `STATE_DELTA` keep their frames-list views and fixture tests. The state view gains the history. `website/content/docs/event-views.mdx` changes in the same change. |
| Architecture: one bundle, CSP | Pass. No new script, no eval, no remote content. The stylesheet follows the conversation stylesheet tests (tokens only, `agui-` classes). |
| Quality gates | Pass. Regression tests for the diff, the history, the projection and the view. End-to-end tests run on the reference agent. No new script, so `development.mdx` needs no new row. |
| Release scope | Pass. Issue #79 is accepted 0.2.0 scope. Formats stay at version 0. Changesets for both packages. |

No violation. The Complexity Tracking table stays empty.

After Phase 1: unchanged. The design adds no dependency, no storage and no format field.

## Project Structure

### Documentation (this feature)

```text
specs/010-state-history/
├── spec.md
├── plan.md              # This file
├── research.md          # Decisions and measurements
├── data-model.md        # Point, diff and projection additions
├── quickstart.md        # How to check the feature by hand and by test
├── contracts/
│   └── state-history.md # Module API, view contract, keyboard map
├── checklists/requirements.md
└── tasks.md             # Written by /speckit-tasks
```

### Source Code (repository root)

```text
packages/inspector/
├── src/
│   ├── core/projection/
│   │   ├── patch.ts            # + applyStateDelta (the one rule for a state delta)
│   │   ├── state-diff.ts       # NEW: diffStates, Difference
│   │   ├── state-history.ts    # NEW: stateAfter, pointAt
│   │   └── index.ts            # StateModel.initial, StateChange.checkpoint, applyStateDelta in the fold
│   └── views/conversation/
│       ├── state.tsx           # StateView uses the history; SnapshotMarker unchanged
│       ├── state-history.tsx   # NEW: PointList, StateDetail, DiffList, summaryOf, selectedIndex
│       └── conversation.css    # classes for the list, the diff and the banner
└── tests/conversation/
    ├── state-diff.test.ts      # NEW
    ├── state-history.test.ts   # NEW
    ├── state.test.ts           # existing; updated for the new markup
    ├── patch.test.ts           # existing; two cases for applyStateDelta
    ├── docs.test.ts            # existing; two assertions for the history section
    └── state-workload.test.ts  # NEW: the 5,000-frame state workload
tests/e2e/
├── conversation/state-history.spec.ts  # NEW: pointer, keyboard, live (fixture host)
├── hosted/state-history.spec.ts        # NEW: export, import and no-request checks (real app)
└── hosted/evidence-contrast.spec.ts    # + the history's text in both themes
website/content/docs/
├── event-views.mdx             # State section rewritten
└── internals.mdx               # StateView and the new modules
.changeset/
└── <name>.md                   # minor, agui-inspector and agui-inspector-python
```

**Structure Decision**: The diff and the point math are pure functions of the projection's `StateModel`, so they
live in `core/projection` and have no React. The list, the detail and the diff rendering are React and live next
to the existing `state.tsx`. `StateView` keeps its props, so `app/index.tsx` does not change.

## Design decisions

The reasons and the alternatives are in [research.md](research.md). The short version:

1. **Points are changes, newest first.** The list keeps 0.1.0's order. The starting state, when the first run
   carried one, is the last (oldest) row. A new `initial` field on `StateModel` provides it.
2. **Past states are replayed, not stored.** Keeping the state after every change costs memory proportional to
   changes times state size. The projection stores a checkpoint every 64 deltas instead, and `stateAfter` replays
   at most 63 deltas. A snapshot is its own anchor.
3. **One rule for a delta.** `applyStateDelta(state, operations)` is `applyJsonPatch(state ?? {}, operations)`.
   The projection and the replay both call it, so a past state cannot drift from the current one. A test
   asserts that the newest point equals `current` and that every point equals an independent fold.
4. **The diff is the net effect between two states.** Object members are compared by key, so order is ignored.
   Arrays are compared by position. An added or removed value is one difference, not one per leaf. Subtrees
   deeper than 100 levels compare as whole values.
5. **The entry summary comes from the operations, and the diff from the states.** The summary is free for every
   row. The diff is built only for the selected point, so a 5,000-row list costs no replay.
6. **The list is a listbox.** One tab stop, `aria-activedescendant`, arrow keys follow the screen (down is older),
   Home is the newest, End is the oldest. Rows are plain text because an option cannot hold a button. The frame
   reference button sits in the detail, where the label is.
7. **Selection is a frame id, with "follow latest" as no selection.** Selecting the newest row, pressing Home
   and pressing "Back to latest" all clear the selection. A selection that no longer exists (new thread, new
   session) falls back to the latest point. A scope token resets it when the store or thread changes.
8. **Long values and large diffs are bounded.** A value over 80 characters shows shortened, in a native
   disclosure that holds the full value. A diff shows 100 differences and a "Show N more" button.

## Test plan

Spec scenario to test:

| Spec | Test |
| --- | --- |
| US1.1, FR-002, FR-003, SC-002 | `state-diff.test.ts`: add, remove, replace, move, copy, test, nested, arrays, key order, root, type change. Property-style loop: applying the diff to `before` gives `after` for every change of a generated delta sequence. |
| US1.4, US2.4, SC-001 | `state-history.test.ts`: 20 deltas with two snapshots between them. `stateAfter` of every index equals an independent fold. The newest equals `current`. |
| US1.5, FR-005 | `state-history.test.ts`: an unappliable delta makes a point equal to the one before, with an empty diff. A first delta that fails with no state gives no state. |
| US1.6, US2.5, FR-006 | `state-history.test.ts`: starting state is the oldest point with no diff. A first snapshot without a starting state is the first state. A first delta diffs against `{}`. |
| FR-009 | Checkpoint boundaries: histories of 63, 64, 65 and 130 deltas, with and without snapshots, all agree with the independent fold. |
| US2.1 to US2.3, FR-007, FR-008, FR-010 | `state.test.ts` (static markup, including the derived line) and `tests/e2e/conversation/state-history.spec.ts`: select by click, label says past state, "Back to latest". |
| US3, FR-015, SC-003 | `tests/e2e/conversation/state-history.spec.ts`: keyboard only. Tab to the list, arrows, Home, End, Back to latest by key, the disclosure and "Show more" by key, the frame reference button by key. |
| US4.1, US4.2, FR-011, SC-005 | `tests/e2e/conversation/state-history.spec.ts` on the fixture host: stream into the page, select a past row, push 100 more deltas, assert the same state and diff and "100 newer changes". |
| US4.3, FR-013, SC-006 | `tests/e2e/hosted/state-history.spec.ts` on the production build with a scripted agent: run, export, reload, import, compare every point. The exported file keeps the 0.1.0 format (same version and keys, no field for the history), so a 0.1.0 file imports the same way. |
| US4.5, FR-012 | Unit test for the scope reset; e2e: New thread empties the list. |
| FR-014, SC-007 | e2e: export before and after browsing is byte-identical; the existing network allowlist test still passes; no `localStorage` or `sessionStorage` writes while browsing. |
| FR-016 | Unit and e2e: a 200-character value is shortened and opens in full; a 250-difference snapshot shows 100 and "Show 150 more". |
| FR-004, SC-009 | `state.test.ts` (static markup): every difference carries its kind as a word and a sign in its text, so removing color loses nothing. The theme AA checks cover the tag colors in both themes. |
| FR-017, SC-004 | `state-workload.test.ts`: the R5 workload; 100 selections spread over the history, the 95th percentile under 200 ms; open (project, newest point) under 1 s. |
| FR-018, SC-010 | The docs tests that read `event-views.mdx` and `internals.mdx` pass, plus a test line that the History section names the keys. |
| FR-019, SC-008 | `npm run build && npm run check:bundle` in `check:ci`. No new dependency row. |

## Risks

- **Large states.** Replay cost is at most 63 patch applications, each a copy of the state. Measured on this
  machine: about 33 microseconds per application at 3 KB, 250 at 28 KB and 1.5 ms at 148 KB. At 148 KB a selection
  takes about 90 ms plus the diff. The projection itself already costs far more at that size, because it folds every
  change on each store update. If the projection ever stops doing that, the checkpoint spacing can grow.
- **Shared files.** `core/projection/index.ts` is shared with the subagent lanes work. The edits are three small
  hunks around the state fold (`initial`, `checkpoint`, `applyStateDelta`). A rebase conflict there is easy to
  resolve and does not touch the entries code.
- **Listbox semantics with a live list.** Rows are added while the listbox has focus. `aria-activedescendant`
  points at the selected row's id, which stays valid. The "newer changes" notice is a polite status region, not an
  announcement per change.
