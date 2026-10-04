// SC-004 (specs/010-state-history, research R5): the state history over 5,000 frames that are almost all state
// changes. Opening the State tab projects the session and shows the newest point. Selecting a point reads its
// state and diff. Both must stay quick, and neither may touch the raw frames.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { JsonValue } from '../../src/contracts.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { pointAt, pointCount } from '../../src/core/projection/state-history.ts';
import { RUN_FINISHED, RUN_STARTED, harness } from './support.ts';

const KEYS = 50;
const FRAMES = 5000;

/** About 3.3 KB: 50 members, each an object with an id, a name, three tags and a number. */
const baseState = (): JsonValue =>
  Object.fromEntries(Array.from({ length: KEYS }, (_, i) => [`key${i}`, { id: i, name: `item ${i}`, tags: ['a', 'b', 'c'], value: i * 1.5 }]));

function play(snapshotEvery: number) {
  const h = harness();
  h.open('bench', { input: { threadId: 't1', runId: 'r1' } });
  h.push('bench', RUN_STARTED, 0);
  const changes = FRAMES - 2;
  for (let i = 0; i < changes; i += 1) {
    if (i % snapshotEvery === 0) h.push('bench', { type: 'STATE_SNAPSHOT', snapshot: baseState() }, i);
    else if (i % 10 === 0) h.push('bench', { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/tmp', value: i }, { op: 'replace', path: `/key${i % KEYS}/value`, value: i }, { op: 'remove', path: '/tmp' }] }, i);
    else h.push('bench', { type: 'STATE_DELTA', delta: [{ op: 'replace', path: `/key${i % KEYS}/value`, value: i }] }, i);
  }
  h.push('bench', RUN_FINISHED, FRAMES);
  h.close('bench');
  return h.session();
}

// Without snapshots only the checkpoints keep a replay short, so that is the case that matters.
for (const [label, snapshotEvery] of [['with a snapshot every 100 frames', 100], ['with one snapshot and then deltas only', Number.POSITIVE_INFINITY]] as const) {
  test(`opening the state history and selecting a point stay quick over 5,000 frames of state changes, ${label}`, () => run(snapshotEvery));
}

function run(snapshotEvery: number): void {
  const session = play(snapshotEvery);
  assert.equal(session.frames.length, FRAMES);
  const rawHash = () => createHash('sha256').update(JSON.stringify(session.frames)).digest('hex');
  const before = rawHash();

  const opened = performance.now();
  const model = projectConversation(session);
  const newest = pointAt(model.state, 0);
  const openMs = performance.now() - opened;
  const count = pointCount(model.state);
  assert.equal(model.state.changes.length, FRAMES - 2);
  assert.ok(newest.diff !== undefined && newest.state !== undefined);

  const timings: number[] = [];
  for (let n = 0; n < 100; n += 1) {
    const index = Math.floor((n * (count - 1)) / 99);
    const started = performance.now();
    const point = pointAt(model.state, index);
    timings.push(performance.now() - started);
    assert.ok(point.state !== undefined, `point ${index} has a state`);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[94] as number;
  console.log(`state history over ${FRAMES} frames (snapshot every ${snapshotEvery}): open ${openMs.toFixed(1)} ms, selection p95 ${p95.toFixed(2)} ms, worst ${(timings[99] as number).toFixed(2)} ms`);

  assert.ok(openMs < 1000, `opening took ${openMs.toFixed(0)} ms`);
  assert.ok(p95 < 200, `the 95th percentile of a selection was ${p95.toFixed(0)} ms`);
  assert.equal(rawHash(), before, 'the raw frames are exactly as the reader left them');
}
