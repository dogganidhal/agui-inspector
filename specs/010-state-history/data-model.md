# Data model: State history

Everything here is derived from the recorded frames. Nothing is stored, exported or sent. The recording and the
session file formats do not change.

## Projection additions

`StateModel` and `StateChange` in `core/projection/index.ts`.

| Type | Field | Meaning |
| --- | --- | --- |
| `StateModel` | `initial?: JsonValue` | The state the first run of the thread carried in its input. Absent when the input had none. Set once, where the projection seeds `current`. |
| `StateChange` | `checkpoint?: JsonValue` | The state after this change. Set on every 64th delta since the last anchor, and only when a state exists. It is a reference to the object the fold produced, not a copy. |

Unchanged: `StateModel.current`, `StateModel.changes` (newest first), and every other `StateChange` field
(`frameId`, `exchangeId`, `runId`, `offsetMs`, `type`, `snapshot`, `operations`, `applied`, `error`).

An anchor is any of: a `STATE_SNAPSHOT` change (its `snapshot` is the state after it), a delta with a
`checkpoint`, or the starting state.

## Point

A point is an index into the list the view shows. Index 0 is the newest change. Index `changes.length - 1` is the
oldest change. Index `changes.length` is the starting state, and exists only when `initial` is defined and
`changes` is not empty.

| Index | Point | State after the point |
| --- | --- | --- |
| 0 | The newest change | `current` |
| 1 to `n - 1` | An older change | Replayed from the nearest older anchor |
| `n` (when `initial` exists) | The starting state | `initial` |

The selection is not an index. It is `undefined` (follow the latest, which is index 0) or a `frameId`. The view
turns it into an index on each render. A `frameId` that is not in `changes` resolves to 0. The starting state has
the id `start`.

## Functions (core)

```ts
// patch.ts
applyStateDelta(state: JsonValue | undefined, operations: readonly JsonPatchOperation[]): PatchResult

// state-diff.ts
type Difference =
  | { kind: 'added'; path: string; after: JsonValue }
  | { kind: 'removed'; path: string; before: JsonValue }
  | { kind: 'changed'; path: string; before: JsonValue; after: JsonValue };
diffStates(before: JsonValue, after: JsonValue): Difference[]

// state-history.ts
stateAfter(model: StateModel, index: number): JsonValue | undefined
pointAt(model: StateModel, index: number): PointDetail
pointCount(model: StateModel): number

interface PointDetail {
  /** The state after the point. Undefined when there is none yet. */
  readonly state: JsonValue | undefined;
  /** The net differences from the state before. Absent for the starting state and for a first state. */
  readonly diff?: readonly Difference[];
  /** A snapshot with no earlier state: shown in full, with no diff. */
  readonly firstState: boolean;
  /** The change the point follows. Absent for the starting state. */
  readonly change?: StateChange;
}
```

## Rules

- A state never changes after it is produced. `stateAfter` returns objects from the projection or from the patch
  engine and the view never writes to them.
- `pointAt(model, 0).state` is `model.current`.
- For a change at index `i`, the state before it is `stateAfter(model, i + 1)`. For the oldest change that is
  `initial`, which may be absent.
- A delta with no state before it applies to `{}`. A snapshot with no state before it is a first state.
- A delta with `applied === false` leaves the state as it was. Its point has the same state as the point before it,
  and an empty diff.
- Differences are in document order: the keys of `before` in order, then the new keys of `after`; array
  positions in order.
- A path is a JSON Pointer. `~` is `~0` and `/` is `~1` in a key. The root is `''`.
- Two values with the same members in a different key order have no difference. Arrays compare by position.
- `stateAfter` applies at most 63 deltas.

## View state

| State | Where | Reset |
| --- | --- | --- |
| Selected `frameId` (or none) | `StateView` component, with its scope token | New thread, new store, or leaving the State tab |
| Open or closed disclosures, "Show more" counts | The component that renders the row | With the component |

Nothing is written to `localStorage`, `sessionStorage` or the store.

## Entry summary

A row's one-line summary comes from the change, with no replay:

| Change | Summary |
| --- | --- |
| Snapshot | `Replaced the state` |
| Delta, one operation | `<op> <path>` |
| Delta, several | `<op> <path> and <n> more` |
| Delta with no operations | `Empty delta` |
| Not applied | The summary above plus the "not applied" tag |
