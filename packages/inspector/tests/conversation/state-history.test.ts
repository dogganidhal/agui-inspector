// The state at any past point and the diff of any change (specs/010-state-history, FR-005 to FR-009, SC-001, SC-002).
// Every point is checked against a fold written here, so a past state cannot drift from the rule the projection uses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonValue } from '../../src/contracts.ts';
import { projectConversation, type StateModel } from '../../src/core/projection/index.ts';
import { applyJsonPatch } from '../../src/core/projection/patch.ts';
import { pointAt, pointCount, stateAfter } from '../../src/core/projection/state-history.ts';
import { RUN_FINISHED, RUN_STARTED, sessionOf } from './support.ts';

type Script = { type: 'STATE_SNAPSHOT'; snapshot: JsonValue } | { type: 'STATE_DELTA'; delta: object[] };

const snapshot = (value: JsonValue): Script => ({ type: 'STATE_SNAPSHOT', snapshot: value });
const delta = (...ops: object[]): Script => ({ type: 'STATE_DELTA', delta: ops });

function modelOf(events: readonly Script[], state?: JsonValue): StateModel {
  const options = state === undefined ? {} : { input: { threadId: 't1', runId: 'r1', state } };
  return projectConversation(sessionOf([RUN_STARTED, ...events, RUN_FINISHED], options)).state;
}

/** The state after each event, oldest first, by the rule the spec states: a snapshot replaces, a delta patches or changes nothing. */
function fold(events: readonly Script[], start?: JsonValue): Array<JsonValue | undefined> {
  const states: Array<JsonValue | undefined> = [];
  let state = start;
  for (const event of events) {
    if (event.type === 'STATE_SNAPSHOT') state = event.snapshot;
    else {
      const result = applyJsonPatch(state ?? {}, event.delta as never);
      if (result.ok) state = result.value;
    }
    states.push(state);
  }
  return states;
}

/** `count` deltas that grow and edit a state, with a snapshot after each position in `snapshotsAt`. */
function longRun(count: number, snapshotsAt: readonly number[] = []): Script[] {
  const events: Script[] = [snapshot({ n: 0, items: [] })];
  for (let i = 1; i <= count; i += 1) {
    events.push(delta({ op: 'replace', path: '/n', value: i }, ...(i % 3 === 0 ? [{ op: 'add', path: '/items/-', value: `item ${i}` }] : [])));
    if (snapshotsAt.includes(i)) events.push(snapshot({ n: i * 1000, items: [`from snapshot ${i}`] }));
  }
  return events;
}

/** Every point of the history equals the independent fold, and the newest equals the current state. */
function assertEveryPoint(events: readonly Script[], start?: JsonValue): void {
  const model = modelOf(events, start);
  const expected = fold(events, start);
  assert.equal(model.changes.length, events.length);
  for (let index = 0; index < events.length; index += 1) {
    assert.deepEqual(stateAfter(model, index), expected[events.length - 1 - index], `point ${index} of ${events.length}`);
  }
  assert.deepEqual(stateAfter(model, 0), model.current, 'the newest point is the current state');
}

test('twenty deltas with two snapshots between them: every point equals the fold', () => {
  const events: Script[] = [snapshot({ round: 0, items: ['a'] })];
  for (let i = 1; i <= 20; i += 1) {
    events.push(delta({ op: 'replace', path: '/round', value: i }, { op: 'add', path: '/items/-', value: `i${i}` }));
    if (i === 7) events.push(snapshot({ round: 700, items: ['reset'], extra: { deep: [1, 2] } }));
    if (i === 14) events.push(snapshot({ round: 1400 }));
  }
  assert.equal(events.length, 23);
  assertEveryPoint(events);
});

test('a snapshot replaces the state, so a point after it has none of the earlier deltas', () => {
  const model = modelOf([snapshot({ a: 1 }), delta({ op: 'add', path: '/b', value: 2 }), snapshot({ c: 3 }), delta({ op: 'add', path: '/d', value: 4 })]);
  assert.deepEqual(stateAfter(model, 1), { c: 3 });
  assert.deepEqual(stateAfter(model, 2), { a: 1, b: 2 });
  assert.deepEqual(stateAfter(model, 0), { c: 3, d: 4 });
});

test('histories around the checkpoint spacing agree with the fold, with and without snapshots', () => {
  for (const count of [63, 64, 65, 127, 128, 130]) assertEveryPoint(longRun(count));
  assertEveryPoint(longRun(130, [40, 64, 100]));
  assertEveryPoint(longRun(130, [63, 65]), { seeded: true });
});

test('the projection keeps a checkpoint on every 64th delta since the last anchor, and a snapshot resets the count', () => {
  const marked = (events: readonly Script[]) => modelOf(events).changes.filter((change) => change.checkpoint !== undefined).length;
  assert.equal(marked(longRun(63)), 0);
  assert.equal(marked(longRun(64)), 1);
  assert.equal(marked(longRun(130)), 2);
  assert.equal(marked(longRun(130, [40])), 1, 'a snapshot at 40 restarts the count: one checkpoint 64 deltas later');
  const model = modelOf(longRun(64));
  assert.deepEqual(model.changes[0]?.checkpoint, model.current, 'a checkpoint is the state after that delta');
  assert.equal(modelOf([snapshot({ a: 1 })]).changes[0]?.checkpoint, undefined, 'a snapshot is its own anchor and needs none');
});

test('no checkpoint is kept while there is no state', () => {
  const failing = Array.from({ length: 70 }, () => delta({ op: 'remove', path: '/missing' }));
  const model = modelOf(failing);
  assert.equal(model.current, undefined);
  assert.equal(model.changes.some((change) => change.checkpoint !== undefined), false);
});

test('a delta that cannot be applied makes a point equal to the one before it, with an empty diff', () => {
  const model = modelOf([snapshot({ n: 1 }), delta({ op: 'replace', path: '/missing', value: 2 }), delta({ op: 'add', path: '/ok', value: true })]);
  const failed = pointAt(model, 1);
  assert.equal(failed.change?.applied, false);
  assert.deepEqual(failed.state, { n: 1 });
  assert.deepEqual(failed.diff, []);
  assert.deepEqual(pointAt(model, 2).state, { n: 1 });
  assert.deepEqual(pointAt(model, 0).diff, [{ kind: 'added', path: '/ok', after: true }]);
});

test('a first delta that fails with no state at all leaves no state, and says nothing changed', () => {
  const model = modelOf([delta({ op: 'replace', path: '/nope', value: 1 })]);
  const point = pointAt(model, 0);
  assert.equal(point.state, undefined);
  assert.equal(point.firstState, false);
  assert.deepEqual(point.diff, []);
});

test('the starting state is the oldest point, has no diff, and the oldest change is compared with it', () => {
  const model = modelOf([snapshot({ seeded: false, a: 1 }), delta({ op: 'add', path: '/b', value: 2 })], { seeded: true });
  assert.equal(pointCount(model), 3);
  const start = pointAt(model, 2);
  assert.deepEqual([start.change, start.state, start.diff, start.firstState], [undefined, { seeded: true }, undefined, false]);
  const oldest = pointAt(model, 1);
  assert.deepEqual(oldest.diff, [{ kind: 'changed', path: '/seeded', before: true, after: false }, { kind: 'added', path: '/a', after: 1 }]);
  assert.equal(oldest.firstState, false);
});

test('a first snapshot with no earlier state is a first state, shown in full with no diff', () => {
  const model = modelOf([snapshot({ a: 1 }), delta({ op: 'add', path: '/b', value: 2 })]);
  assert.equal(pointCount(model), 2, 'no starting state, so no extra point');
  const first = pointAt(model, 1);
  assert.deepEqual([first.firstState, first.diff, first.state], [true, undefined, { a: 1 }]);
  assert.deepEqual(pointAt(model, 0).diff, [{ kind: 'added', path: '/b', after: 2 }]);
});

test('a delta before any snapshot and without a starting state applies to an empty object and diffs against it', () => {
  const model = modelOf([delta({ op: 'add', path: '/a', value: 1 })]);
  const point = pointAt(model, 0);
  assert.deepEqual(point.state, { a: 1 });
  assert.deepEqual(point.diff, [{ kind: 'added', path: '/a', after: 1 }]);
});

test('a delta with no net effect has an empty diff and a point of its own', () => {
  const model = modelOf([snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 1 }), delta({ op: 'test', path: '/n', value: 1 })]);
  assert.deepEqual(pointAt(model, 1).diff, []);
  assert.deepEqual(pointAt(model, 0).diff, []);
  assert.equal(pointCount(model), 3);
});

test('a state with a starting state but no state event has no history to show', () => {
  const model = modelOf([], { seeded: true });
  assert.equal(pointCount(model), 0);
  assert.deepEqual(model.initial, { seeded: true });
});

test('the initial state is the first run input state and is absent without one', () => {
  assert.deepEqual(modelOf([snapshot({ a: 1 })], { seeded: true }).initial, { seeded: true });
  assert.equal('initial' in modelOf([snapshot({ a: 1 })]), false);
});

test('reading a point never changes the model', () => {
  const model = modelOf(longRun(130, [50]), { seeded: true });
  const before = JSON.stringify(model);
  for (let index = 0; index < pointCount(model); index += 1) pointAt(model, index);
  assert.equal(JSON.stringify(model), before);
});

test('the later runs of a thread continue the same history', () => {
  const events: Script[] = [snapshot({ a: 1 }), delta({ op: 'add', path: '/b', value: 2 })];
  const session = sessionOf([RUN_STARTED, ...events, RUN_FINISHED]);
  const model = projectConversation(session).state;
  assert.deepEqual(pointAt(model, 0).state, { a: 1, b: 2 });
  assert.equal(model.changes.every((change) => change.runId === 'r1'), true);
});
