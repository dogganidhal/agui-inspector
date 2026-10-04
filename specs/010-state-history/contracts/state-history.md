# Contract: State history

What the feature exposes. It has no network interface and no file format. The contracts are the module API
(for the unit tests and for the docs page on internals), the view, and the keyboard map.

## Module API

See [data-model.md](../data-model.md) for the types. The three modules are framework-free: they import types
from `contracts.ts` and from `@ag-ui/core`, and nothing from React.

- `core/projection/patch.ts` exports `applyStateDelta`.
- `core/projection/state-diff.ts` exports `diffStates` and `Difference`.
- `core/projection/state-history.ts` exports `stateAfter`, `pointAt`, `pointCount` and `PointDetail`.
- `core/projection/index.ts` keeps its exports. `StateModel` gains `initial?` and `StateChange` gains
  `checkpoint?`. Both are optional, so a caller that builds a `StateModel` by hand stays valid.

## View

`StateView({ store, threadId?, onReveal? })` in `views/conversation/state.tsx`. The props do not change. It uses `StateDetail({ model, index, frames, newer })`, `PointList`, `summaryOf` and `selectedIndex` from `views/conversation/state-history.tsx`; `StateDetail` and `selectedIndex` are pure, so the tests render any point without state.
`app/index.tsx` and `views/conversation/index.tsx` are not edited.

Structure, top to bottom, with the markup the tests rely on:

| Part | Markup | Notes |
| --- | --- | --- |
| Heading | `<h2 id="state-heading">State</h2>` | As in 0.1.0 |
| Banner | `<div data-part="state-banner">` | Only for a past point. Says it is a past state, how many newer changes there are, and holds the "Back to latest" button. It is not a live region: the listbox announces each point, and a status region would speak the count at every key press. |
| Label | A line naming the point | Latest: "Current state", the change it comes from ("after STATE_DELTA") with its run, offset and frame reference button, and the note "Derived from the snapshots and deltas below. Sent as state in the next run." Past: "State after STATE_DELTA" with its run, offset and frame reference button. Starting: "Starting state" and the note that it is the state the first run sent. |
| Derived note | A line under the label | Says the state and the diff are derived from the recorded frames and not received (FR-010). On every point. |
| State | `CodeBlock`, `aria-label="Current state"` for the latest and `aria-label="State at the selected point"` for a past point | The full state after the point |
| Diff | `<ul aria-label="State diff" data-part="state-diff">` | Absent for the starting state. For a first state: "First state of the thread. Shown in full." For no differences: "No net change." |
| Difference | `<li data-kind="added \| removed \| changed">` | A neutral `line` tag with the sign (`+`, `-`, `~`) and the word, the path, the values. "was" and "now" label the two values of a change. A colored stripe repeats the kind. A value over 80 characters is shortened and opens in a disclosure. No difference shows "No net change." in place of the list. |
| Operations | `Disclosure` "Operations (n)", open by default, with the 0.1.0 `<ul aria-label="Delta operations">` | Deltas only. At most 100 shown, then "Show N more". Long values are shortened. |
| Finding | `Finding` kind "State delta" | A delta that was not applied, as in 0.1.0 |
| History | `<ul role="listbox" aria-label="State history" tabindex="0" aria-activedescendant>` | One tab stop |
| Row | `<li role="option" aria-selected id>` | Offset, family dot, type, run, frame number, summary, "not applied" tag. Text only. |

The 0.1.0 `aria-label` values `Current state` and `Delta operations` are kept, so tests and users who looked
for them still find them for the latest point.

## Keyboard map

| Where | Key | Action |
| --- | --- | --- |
| History list | Down arrow | Select the next older point |
| History list | Up arrow | Select the next newer point |
| History list | Home | Select the newest point (follow the latest) |
| History list | End | Select the oldest point |
| Banner | Enter or Space on "Back to latest" | Follow the latest, and move focus to the list |
| Detail | Tab | Frame reference, operations disclosure, long-value disclosures, "Show more" |
| Detail | Enter or Space on a disclosure, button | Activate, as native |

Arrow keys act only when the list has focus, so the composer and other inputs keep their keys.

## Docs contract

`website/content/docs/event-views.mdx`, section "State": the points, the diff and what it ignores, past-state
labelling, the keys, live and imported behavior. `website/content/docs/internals.mdx`: the three core modules and
the view parts, and the unchanged `StateView` props.
