// The state at a past point of a thread and what the change there did. Framework-free.
//
// The projection folds snapshots and deltas into the current state and lists every change, newest first. A point
// is a place in that list: index 0 is the newest change, the last index is the oldest, and one more index past it is
// the state the first run started from, when it carried one. Past states are not stored. They replay from the
// nearest anchor (a snapshot, a checkpoint the projection kept, or the starting state), with the same rule for a
// delta as the projection uses, so a past state cannot disagree with the current one. Nothing here is received data.
import type { JsonValue } from '../../contracts.ts';
import type { StateChange, StateModel } from './index.ts';
import { applyStateDelta } from './patch.ts';
import { diffStates, type Difference } from './state-diff.ts';

export interface PointDetail {
  /** The state after the point. Undefined when there is none yet. */
  readonly state: JsonValue | undefined;
  /** What the change did to the state. Absent for the starting state and for a first state. */
  readonly diff?: readonly Difference[];
  /** A snapshot with no earlier state to compare with: shown in full, with no diff. */
  readonly firstState: boolean;
  /** The change the point follows. Absent for the starting state. */
  readonly change?: StateChange;
}

/** The changes, plus the starting state when there is one and something came after it. */
export const pointCount = (model: StateModel): number => model.changes.length + (model.initial !== undefined && model.changes.length > 0 ? 1 : 0);

/** The state after the point at `index`. Replays at most the deltas since the nearest anchor and never changes the model. */
export function stateAfter(model: StateModel, index: number): JsonValue | undefined {
  const { changes } = model;
  if (index <= 0) return model.current;
  if (index >= changes.length) return model.initial;
  const newer: StateChange[] = [];
  let state = model.initial;
  for (let i = index; i < changes.length; i += 1) {
    const change = changes[i] as StateChange;
    if (change.type === 'STATE_SNAPSHOT') {
      state = change.snapshot;
      break;
    }
    if (change.checkpoint !== undefined) {
      state = change.checkpoint;
      break;
    }
    newer.push(change);
  }
  for (const change of newer.reverse()) {
    if (!change.applied) continue;
    const result = applyStateDelta(state, (change.operations ?? []) as never);
    if (result.ok) state = result.value;
  }
  return state;
}

/** The state after the point at `index` and the net differences the change made to the state before it. */
export function pointAt(model: StateModel, index: number): PointDetail {
  const change = model.changes[index];
  const state = stateAfter(model, index);
  if (change === undefined) return { state, firstState: false };
  const before = stateAfter(model, index + 1);
  if (before === undefined && change.type === 'STATE_SNAPSHOT') return { state, firstState: true, change };
  return { state, firstState: false, change, diff: diffStates(before ?? {}, state ?? {}) };
}
