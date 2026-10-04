# Tasks: State history

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[contract](contracts/state-history.md), [validation guide](quickstart.md).

**Format**: `- [ ] Txxx [P] [USn] Description with file path`. `[P]` means the task touches different files from
the other `[P]` tasks of its phase and can run alongside them. `[USn]` maps to the user stories of the spec.

**Tests**: Required. The constitution asks for regression coverage and the spec lists the cases. Each phase writes
its tests with its code.

**Scope guard**: Touch only the files named here. `core/projection/index.ts` is shared with other #79 work, so keep
its edits to the three hunks in T003. Do not edit `ROADMAP.md`, other specs, `app/index.tsx` or
`conversation/index.tsx`.

## Phase 1: Setup

- [x] T001 Confirm the baseline on the rebased branch: `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/conversation` and `npm run build && npm run check:bundle` pass. Note the bundle totals (main at `e400f85`: 1,227,500 minified, 308,758 gzipped) in the PR body for the later comparison. No file changes.

## Phase 2: Foundation (core, blocks every story)

**Goal**: The state at any point and the diff of any change, as pure functions over the projection, with no React.

- [x] T002 Add `applyStateDelta(state: JsonValue | undefined, operations: readonly JsonPatchOperation[]): PatchResult` to `packages/inspector/src/core/projection/patch.ts` as `applyJsonPatch(state ?? {}, operations)`, with a comment that it is the one rule for a state delta. Add two cases to `packages/inspector/tests/conversation/patch.test.ts`: no state applies to `{}`, and a failing delta returns the error and leaves the input unchanged.
- [x] T003 Edit the state fold in `packages/inspector/src/core/projection/index.ts`, three hunks only: (a) add `initial?: JsonValue` to `StateModel` and set it where the first exchange seeds `state.current` from `input.state`, returned only when defined; (b) add `checkpoint?: JsonValue` to `StateChange` and set it on every 64th delta since the last anchor (a snapshot resets the count), only when `state.current` is defined, as a reference and not a copy; (c) replace `applyJsonPatch(state.current ?? {}, ...)` with `applyStateDelta(state.current, ...)`. Existing behavior and the `changes` order (newest first) stay as they are. Extend `packages/inspector/tests/conversation/state.test.ts` (projection cases only): `initial` is the first run's input state and is absent without one; later runs do not change it; a checkpoint appears on the 64th delta, resets after a snapshot, is absent when no state exists, and `current` and `changes` are unchanged for the existing cases.
- [x] T004 [P] Create `packages/inspector/src/core/projection/state-diff.ts` with `Difference` and `diffStates(before, after)` as in the data model: objects by key in the order of `before` then new keys of `after`, arrays by position, an added or removed value is one difference without recursion, JSON Pointer paths with `~0` and `~1` escapes and `''` for the root, key order ignored, a subtree deeper than 100 levels compared as one value by an iterative equality check, with no recursion and no `JSON.stringify`. Create `packages/inspector/tests/conversation/state-diff.test.ts`: add, remove, replace, nested, array append, array removal at the head (later items change by position), type change (object to array, value to `null`), root replace, key order only (no difference), equal values (empty), keys that need escaping (`a/b`, `a~b`), `__proto__` as a key, depth over 100, and a generated loop (fixed seed) where applying the diff to `before` with a test-local applier gives `after` for 200 random pairs (SC-002).
- [x] T005 Create `packages/inspector/src/core/projection/state-history.ts` with `stateAfter(model, index)`, `pointAt(model, index)`, `pointCount(model)` and `PointDetail` as in the data model: index 0 returns `model.current`, index `changes.length` returns `model.initial`, otherwise walk to the nearest older anchor (a snapshot, a delta with `checkpoint`, or `initial`) and apply the later deltas with `applyStateDelta`, skipping deltas with `applied === false`, at most 63 applications; `pointAt` returns the state, the diff against `stateAfter(model, index + 1)` (before is `{}` for a delta with no earlier state), `firstState: true` with no diff for a snapshot with no earlier state, and no diff for the starting state. Depends on T002, T003, T004. Create `packages/inspector/tests/conversation/state-history.test.ts`: 20 deltas with two snapshots between them, every index equals an independent fold written in the test and index 0 equals `current` (SC-001); histories of 63, 64, 65 and 130 deltas with and without snapshots agree with the fold (checkpoint boundaries); an unappliable delta makes a point equal to the one before with an empty diff; a first delta that fails with no state gives no state; the starting state is the oldest point with no diff and the oldest change diffs against it; a first snapshot with no starting state is a first state; a delta before any snapshot diffs against `{}`; `pointCount` counts the starting state only when `initial` exists and there is a change; no call changes the model (deep-frozen input).
- [x] T006 [P] Create `packages/inspector/tests/conversation/state-workload.test.ts` for the fixed workload of research R5 (5,000 frames in one thread: 4,950 deltas, 50 snapshots, about 3.3 KB of state, deterministic): time `projectConversation`, then 100 evenly spread `pointAt` calls. Assert the open under 1,000 ms and the 95th percentile of a selection under 200 ms, print both numbers like `workload.test.ts` does, and assert the raw frames are unchanged by hashing them before and after. Depends on T005.

**Checkpoint**: `npm run test:unit -- packages/inspector/tests/conversation` passes. The core is complete and no view changed yet.

## Phase 3: User Story 1, see what each state change did (P1)

**Goal**: Each row says what its change did, and the detail area shows the diff, the operations and the full state
for the latest point.

**Independent test**: Render the State view over a scripted run and read each row and the latest point's diff with
the static-markup tests. Selection, keys and live behavior come in the next phases.

- [x] T007 [US1] Create `packages/inspector/src/views/conversation/state-history.tsx` with `summaryOf(change)` (the table in the data model: `Replaced the state`, `<op> <path>`, `<op> <path> and <n> more`, `Empty delta`) and `DiffList({ diff })`: a `ul` with `aria-label="State diff"`, one `li` per difference with `data-kind`, the sign (`+`, `-`, `~`), the kind as a word inside a `Tag` (variants ok, err and warn, which the theme tests already check for AA contrast in both themes, so no color of its own), the path in mono, and the values (`was` and `now` for a change). A value over 80 characters shows the first 80 and an ellipsis inside the existing `Disclosure`, whose body is a `CodeBlock` of the full value. More than 100 differences render the first 100 and a `Button` "Show N more" that renders the rest. An empty diff says "No net change."
- [x] T008 [US1] In the same file add `PointList({ model, selectedId, onSelect })`: `ul role="listbox" aria-label="State history"` with one `li role="option"` per point, newest first, the starting state last when `pointCount` includes it. A row shows the offset, the `FamilyDot`, the type (or "Starting state"), the run id, `frame #n` as plain text, `summaryOf` and the "not applied" tag. Rows are `React.memo` components that take `selected`, `id` and `onSelect`, so a selection change re-renders two rows. Clicking a row calls `onSelect`. No interactive content inside an option.
- [x] T009 [US1] Add the classes for the diff, the rows, the selected row (`aria-selected`), the list focus ring and the banner to `packages/inspector/src/views/conversation/conversation.css`, with tokens only, `agui-conv-` names, spacing in `--u` multiples and no hex colors (the conversation stylesheet tests stay green). The listbox has its own scroll area of about 16 rows.
- [x] T010 [US1] Rework `StateView` in `packages/inspector/src/views/conversation/state.tsx` and export `StateDetail({ model, index, frames, newer })` from `state-history.tsx` (a pure render of one point). For the latest point it renders: the label and the `Current state` code block as in 0.1.0 (keep both `aria-label` values and the sentence "Sent as state in the next run"), a line saying the state and diff are derived from the recorded frames and not received (FR-010), the diff, an "Operations" `Disclosure` with the 0.1.0 `ul aria-label="Delta operations"` for a delta, and the `Finding` for a delta that was not applied. A first state says "First state of the thread. Shown in full." with no diff. `StateView` shows `StateDetail` at index 0 and the `PointList` below it, and drops the 0.1.0 `Change` list. Keep "No state events in this thread." and `SnapshotMarker` untouched. Depends on T005, T007, T008.
- [x] T011 [US1] Update `packages/inspector/tests/conversation/state.test.ts` for the new markup and add, with `renderToStaticMarkup`: each difference carries its kind as a word and a sign in its text (FR-004, SC-009); a delta made of add, replace, remove, move, copy and test operations shows the net differences; a delta with no net effect says "No net change."; a snapshot after deltas shows what it replaced; a 200-character value is shortened and its disclosure holds the full value; a 250-difference snapshot shows 100 differences and "Show 150 more"; every row has its summary text; the operations list and the "not applied" finding show for the right deltas; the derived line is present; the `Current state` and `Delta operations` labels are unchanged for the latest point. Run `npm run test:unit -- packages/inspector/tests/conversation`.

**Checkpoint**: Opening the State tab shows each row's summary and the latest point's diff. US1 passes on its own.

## Phase 4: User Story 2, view the state at any past point (P1)

**Goal**: Selecting a row shows the state and diff after that change, labelled as past, with a way back.

**Independent test**: Render every index with `StateDetail` and compare the state with an independent fold, then select rows with the pointer in the browser.

- [x] T012 [US2] Extend `StateDetail` in `packages/inspector/src/views/conversation/state-history.tsx` to any index, and add `selectedIndex(model, id)` (pure: `undefined`, the newest change's id or an unknown id give 0, a known id gives its position, `'start'` gives the starting state's index). For an older index render the banner (`role="status"`, `data-part="state-banner"`) that says it is a past state, after which change, how many newer changes there are (the `newer` prop, which equals the index), and holds a "Back to latest" `Button`; the label names the type, run and offset with the `FrameRef` button; the code block is `aria-label="State at the selected point"`; the sentence "Sent as state in the next run" does not appear. The starting state shows "Starting state" and the run that carried it, in full, with no diff. Depends on T010.
- [x] T013 [US2] In `packages/inspector/src/views/conversation/state.tsx` add the selection as component state `{ scope, id }`, where `scope` comes from `useMemo(() => ({}), [store, threadId])` so a new store or thread resets it. Pass `selectedId`, `onSelect` and the resolved index to the list and the detail. Selecting the newest row, "Back to latest" and an id that no longer exists all give index 0, and the first two clear the selection. Leaving the tab unmounts the view, which resets the selection (clarification 3). Depends on T012.
- [x] T014 [US2] Add tests to `packages/inspector/tests/conversation/state.test.ts` with `renderToStaticMarkup`: index 0 has no banner and keeps the "Sent as state in the next run" sentence; an older index shows the banner, the "past state" wording, the right state and diff, a "Back to latest" button and never that sentence; the starting-state index shows "Starting state" in full with no diff; a snapshot between delta groups gives the right state after it; `selectedIndex` maps an unknown id to 0 and a known id to its position, which grows as newer changes arrive. Pointer selection and the thread reset are covered in the e2e specs (T016, T017).

**Checkpoint**: A developer can pick any row and read its state and diff, and return to the latest. US2 passes.

## Phase 5: User Story 3, move through the history from the keyboard (P1)

**Goal**: The history is operable with the keyboard alone and is announced.

**Independent test**: A Playwright test that never uses the pointer.

- [x] T015 [US3] In `PointList` (`packages/inspector/src/views/conversation/state-history.tsx`) add `tabIndex={0}`, `aria-activedescendant` set to the selected row's id, and an `onKeyDown` handler: Down selects the next older point, Up the next newer, Home the newest (which clears the selection), End the oldest; each calls `preventDefault`, and nothing happens at the ends. The selected row scrolls into view with `block: 'nearest'` through an effect guarded for environments without `scrollIntoView`. Arrow keys act only while the list has focus. Each row's accessible name is its text, so a selection is announced, and the banner is a polite status region (not one announcement per live change).
- [x] T016 [US3] Make the conversation fixture host (`packages/inspector/tests/conversation/fixture.tsx`) pass an `onReveal` to `StateView` that records the target on `window.__conversation.revealed`, and add a way to push many events in one call if the existing `push` is too slow for 100 events. Create `tests/e2e/conversation/state-history.spec.ts` with the keyboard flow: stream a snapshot and several deltas, press Tab until the listbox has focus (assert visible focus and `aria-activedescendant`), Down changes the state and diff and shows the banner, Up and Home return, End selects the oldest, "Back to latest" works with Enter and Space, a long value's disclosure opens with Enter, "Show more" opens with Enter, and the frame reference button records the reveal target. No pointer call in this test (SC-003, FR-015). Also assert that arrow keys typed in another input on the page leave the selection alone, and add a pointer test that clicking a row selects it.

**Checkpoint**: Every pointer action has a keyboard equivalent. US3 passes.

## Phase 6: User Story 4, follow a live run and read an imported session (P2)

**Goal**: The history holds on a live run and on an imported session.

**Independent test**: The live cases on the fixture host and the export and import cases through the real app.

- [x] T017 [US4] Add the live cases to `tests/e2e/conversation/state-history.spec.ts`: with the latest point selected, a pushed delta appears at the top and the state and diff update without an action (US4.1); select a past row, push 100 more deltas, assert the same state and diff text, the status "100 newer changes", and that "Back to latest" jumps to the newest (SC-005, US4.2); a new `threadId` empties the history with no selection left (US4.5); leaving and reopening the State view selects the latest point.
- [x] T018 [US4] Create `tests/e2e/hosted/state-history.spec.ts` through the real app (the production build, as the other hosted specs run it), with a scripted `/state-history` scenario added to `tests/e2e/hosted/support.ts` (the `inspection` host shows no State tab, and the reference agent's `state` scenario has too few changes): send, record every point's state text, press Export session, read the file, reload, import it, and compare every point (SC-006). The exported file is the 0.1.0 format: assert its version and its session keys, and that it has no field for the history (FR-013). Assert the "Imported recording: inspection only" notice stays, the export before and after browsing is byte-identical, no `localStorage` or `sessionStorage` write happens while browsing, and the page makes no request while browsing, using `expectAllowlisted` (SC-007, FR-014).

**Checkpoint**: US4 passes. All four stories pass.

## Phase 7: Polish and cross-cutting

- [x] T019 [P] Rewrite the "State" section of `website/content/docs/event-views.mdx`: the points and their order, the starting state, the diff and what it ignores (key order) and how it treats arrays (by position), the past-state label and "Back to latest", the keys (Down, Up, Home, End), live behavior (a past point stays while newer changes arrive, with a count), imported sessions, the long-value and 100-difference limits, the note that a very large state with thousands of deltas takes longer to reach a point, and that nothing is stored. Plain short sentences, no em dashes, no bold labels. Run the `humanizer` skill on the new text. Keep every event type name the docs test looks for. Add two assertions to `packages/inspector/tests/conversation/docs.test.ts`: the page has a State history section, and it names the keys Home, End and the arrow keys.
- [x] T020 [P] Update `website/content/docs/internals.mdx`: the three core modules and what they export, the `StateModel` additions, the view parts, and that `StateView` keeps its props. Mention nothing that a test of the docs would reject.
- [x] T021 [P] Add a changeset in `.changeset/` that bumps `agui-inspector` and `agui-inspector-python` by minor, with one plain sentence: the State tab now shows a history with a diff for each change and the state at any past point. Hand-written is fine.
- [x] T022 Run `npm run typecheck`, `npm run test:unit`, `npm run test:e2e -- tests/e2e/conversation tests/e2e/inspection --workers=2`, `npm run build && npm run check:bundle` and then `npm run check:ci`. Record the bundle totals against T001 in the PR body. Fix every failure at its cause. No new dependency, so `dependencies.mdx` stays as it is.
- [x] T023 Run `/speckit-converge` if the code and the spec disagree, then `/ponytail:ponytail-review` on the diff and fix what it finds, then run the `humanizer` skill on the PR body. Re-run T022 after fixes.

## Implementation notes

Where the code differs from the task text above. Each is a decision taken while building, kept here so the spec
directory stays the record.

- The projection tests (`initial`, `checkpoint`) are in `state-history.test.ts`, with the history they serve, not in `state.test.ts` (T003).
- `tests/e2e/conversation/site.ts` holds the fixture host's server and helpers for the new spec. `events.spec.ts` keeps its own copy, so a shared file stays untouched.
- The workload test (T006) runs twice: with a snapshot every 100 frames, and with one snapshot and then deltas only, which is the case that depends on checkpoints.
- Operation values are shortened like diff values (T007), because an operation can carry a value as long as any diff value.
- The operations disclosure is open by default and lists at most 100 operations, like the diff (T010).
- The frame reference button shows on the latest point too, so the current state names the change that made it (T010). The 0.1.0 references test expects a frame reference on the state view.
- The banner is not a live region (T012, T015). A status region would speak the count at every arrow key press. The listbox already announces each point.
- A diff kind is a neutral `line` tag with the word and the sign, and a colored stripe repeats it (T007, T009). The green `ok` tag measured 4.07:1 in the light theme at 11 px, under AA.
- `tests/e2e/hosted/evidence-contrast.spec.ts` gains a test that measures the history's text in both themes (FR-004).
- The reference agent's `state` scenario has one snapshot and one delta, so the app-level spec uses the hosted harness's scripted agent instead.

## Dependencies and order

- Phase 2 first. Inside it: T002, T003 and T004 touch different files and can go together. T005 needs all three. T006 needs T005.
- Phase 3 needs Phase 2. Inside it: T007 and T009 are independent, T008 needs T007, T010 needs T005, T007 and T008, T011 needs T010.
- Phase 4 needs T010. T012 comes before T013, and T014 needs both.
- Phase 5 needs Phase 4 (T015 changes `PointList`, which T008 created, and the selection from T013). T016 needs T015.
- Phase 6 needs Phase 5. T017 shares a spec file with T016, so it follows it. T018 is a separate spec file and can go alongside T017.
- Phase 7: T019, T020 and T021 are independent of each other and can be written once the behavior is settled. T022 and T023 come last.

## Parallel example

```text
T002  patch.ts + patch.test.ts
T003  projection/index.ts + state.test.ts (projection cases)
T004  state-diff.ts + state-diff.test.ts
```

## Implementation strategy

- Minimum shippable slice: Phases 2, 3 and 4. They give the diff and the state at any past point with the pointer.
  The issue also requires the keyboard and live behavior, so the PR is not done before Phases 5 and 6.
- Keep each phase green before the next. `npm run test:unit -- packages/inspector/tests/conversation` is the fast
  loop. Run the e2e spec with `--workers=2` while other workers share the machine.
- If a task needs a file this list does not name, stop and record the reason in the PR body instead of widening the
  change silently.
