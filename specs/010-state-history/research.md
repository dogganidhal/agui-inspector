# Research: State history

Decisions for [plan.md](plan.md). Each has the choice, the reason and what was rejected. Measurements were taken
on the development machine with Node 24 on 2026-10-04. They show the order of magnitude, not a benchmark result.

## R1. How to get the state at a past point

**Decision**: Replay from the nearest anchor. An anchor is a snapshot, a checkpoint or the starting state. The
projection records a checkpoint on every 64th delta since the last anchor, as a reference to the state it just
produced. `stateAfter(model, index)` walks to the nearest older anchor and applies at most 63 deltas.

**Why**: The patch engine copies the document on every delta and returns a new object. The projection never
changes a returned state, so keeping a reference is free and safe. Keeping one for every change would hold
changes times state size in memory. Replaying from the start on every selection would cost changes times state
size in time. Measured replay of 5,000 deltas: 164 ms at 3 KB, 1,256 ms at 28 KB and 7,285 ms at 148 KB. A
checkpoint every 64 deltas bounds a selection to 63 applications: 2 ms, 16 ms and 92 ms for the same sizes.

**Rejected**:

- A state per change, kept in the projection. Simple, but about 15 MB at 3 KB and 700 MB at 148 KB for 5,000
  changes.
- Replay from the start with a view-side cache keyed by frame id. A cold selection in the middle of a long run
  pays the full replay once, and the cache needs its own reset rules for threads and sessions.
- An in-place patch variant for replay. It would be faster, but it adds a second way to apply a patch to the
  engine. The spec asks for no second patch engine. Revisit if the projection itself moves to in-place patches.

## R2. One rule for a delta

**Decision**: Add `applyStateDelta(state, operations)` to `patch.ts`. It is `applyJsonPatch(state ?? {}, operations)`.
The projection fold and the replay both call it. A snapshot replaces the state in both places by assignment.

**Why**: The rule that a delta with no state applies to an empty object lives in one place. A test compares the
newest point with the projection's `current` and every point with an independent fold written in the test.

## R3. The diff

**Decision**: `diffStates(before, after)` in `core/projection/state-diff.ts`. Walk both values together:

- two objects: compare by key, in the order of `before` then new keys of `after`; recurse into shared keys;
- two arrays: compare by position; extra items of `before` are removed, extra items of `after` are added;
- anything else: equal when strictly equal, otherwise one `changed` difference at that path;
- a key only in `before` is `removed` and a key only in `after` is `added`, each with its value and without
  recursion into it;
- deeper than 100 levels, a subtree compares as one value, with an equality check that keeps its own stack (no recursion and no serialization), so no depth can overflow the call stack. A serializer is not safe here: `JSON.stringify` of a 5,000-level subtree overflowed the stack on the Linux CI runner.

Paths are JSON Pointers (RFC 6901), the same format as the paths in operations, so a reader can match a
difference to an operation. The root is the empty path.

**Why**: The spec asks for the net effect between two states, ignoring key order. A move shows as a removal and
an addition. A `test` operation and a replace with an equal value show as "No net change". Comparing arrays by
position is what JSON Patch does with indexes, and the docs say so. Detecting moves inside arrays would need a
heuristic and could mislead.

**Rejected**: A diff library (for example `jsondiffpatch` or `microdiff`). Each would be a new runtime dependency
with a pin, a row in `dependencies.mdx` and bundle cost, for a function of about 40 lines whose behavior we want to
control exactly (path format, array rule, no move detection). Deriving the diff from the operations. It would
describe what the agent asked for, which the operations list already does, and it cannot say "No net change".

## R4. Where the numbers come from for the list

**Decision**: Each row's summary comes from the operations: the first operation and the count of the rest, or
"Replaced the state" for a snapshot. The net diff is computed for the selected point only.

**Why**: A net diff for a row needs the states before and after it. For 5,000 rows that is a full fold with a
diff at each step on every store update, and it would double the work the projection already does on each frame
of a live run. With the operation summary the list costs nothing extra, and the diff and the state are built
when they are shown.

## R5. The fixed workload for SC-004

The spec leaves the workload to the plan, as the MVP did for its own limit.

**Decision**: 5,000 frames in one thread, generated in the test with no randomness: one run, 4,950
`STATE_DELTA` frames and 50 `STATE_SNAPSHOT` frames (one every 100 frames). The state has 50 keys, each an object
with an id, a name, three tags and a number, about 3.3 KB. Each delta is one `replace` of a number, with every
tenth delta carrying three operations (`add`, `replace`, `remove`). Offsets advance by 1 ms.

**Measure**: In `node --test`, with the real projection and history: project the session (the State tab's open
cost), then 100 selections at evenly spread indexes, each timed as `pointAt` (state and diff). Assert the 95th
percentile under 200 ms and the open under 1 s. The test prints the numbers, as `workload.test.ts` does. The
browser render of one selection is a few rows and one code block, and the e2e tests check that it happens
without a visible delay on a smaller history. The 28 KB and 148 KB figures in R1 are a stated limit, not a gate.

**Why unit level**: The cost that scales with the history is in the replay and the diff. The render is bounded by
the 100-difference cap and the 340 px code block height. A browser benchmark on shared machines would measure
the neighbors more than the code.

## R6. The keyboard model

**Decision**: The list is `role="listbox"` with one tab stop, `aria-activedescendant` on the selected option and
`aria-label="State history"`. Keys, handled on the listbox:

| Key | Action |
| --- | --- |
| Down arrow | Select the next older point |
| Up arrow | Select the next newer point |
| Home | Select the newest point, which follows the latest state |
| End | Select the oldest point |

"Back to latest" is a button in the banner, in the tab order after the list. Enter and Space on a row are not
needed because selection follows the arrow keys.

**Why**: A listbox is the standard single-select list pattern. It has one tab stop, so a 5,000-row history is
not 5,000 stops. The keys follow the screen, as the spec clarification fixes. Page Up and Page Down are left to
the browser, which scrolls the focused list.

**Consequence**: An option cannot contain interactive content. Rows are text. The frame reference button, the
operations disclosure and the "Show more" button are in the detail area, after the list in tab order.

**Layout**: The detail area comes first on the page and the list below it with its own scroll area of about 16
rows. The detail stays visible while the keys move the selection. Selecting scrolls the row into view with
`block: 'nearest'`.

## R7. Live behavior

**Decision**: The selection is `undefined` (follow the latest) or a frame id. `undefined` always resolves to
index 0. A frame id resolves to its index in the current list, so new changes push it down without changing
what is shown. The notice "N newer changes" uses that index. Selecting row 0 clears the selection.

**Why**: The projection rebuilds on each store update and gives new objects, so a stable identity is the frame
id, the same identity the rest of the page uses for evidence.

**Scope reset**: The component keeps `{ scope, id }` where `scope` is an object made with `useMemo` over the store
and the thread id. A stored id counts only if its scope is the current one. This resets the selection on a new
thread or a new store without an effect.

## R8. Rendering a long list

**Decision**: Render every row, as 0.1.0 does, with `React.memo` rows so a selection change re-renders two rows.
No windowing.

**Why**: A row is a few spans. The 5,000-row render is done once per store update, which the 0.1.0 list already
did with heavier rows (the operations inline). Windowing adds scroll math, breaks find in page and complicates
`aria-activedescendant`. If measurement during implementation shows a long first render, `content-visibility: auto`
on the rows is the first step, before any virtual list.

## R9. Long values and large diffs

**Decision**: Values are shown as compact JSON. Over 80 characters, the row shows the first 80 followed by an
ellipsis and sits inside a native `details` (the existing `Disclosure`), whose body has the full value in a
`CodeBlock`. A diff renders its first 100 differences and a "Show N more" button that renders the rest.

**Why**: It bounds the DOM per selection and uses the same disclosure the page already offers by keyboard.

## R10. The starting state

**Decision**: `StateModel.initial` is set where the projection seeds `current` from the first run's input. The
history shows it as the oldest row, labelled "Starting state", only when the thread has at least one change. A
thread with a starting state and no change keeps today's "No state events in this thread" message.

**Why**: The projection already makes this choice for the current state. Showing the point lets the oldest
change diff against it. Most clients send `state: {}`, and then the first snapshot diffs as additions against
`{}`, which reads well.

## R11. Reuse and shared files

Other workers edit `core/projection/index.ts` and the conversation view in parallel. This feature touches only the
state fold in the projection, `state.tsx`, a new `state-history.tsx`, and the stylesheet. `conversation/index.tsx`
and `app/index.tsx` stay unchanged because `StateView` keeps its props.
