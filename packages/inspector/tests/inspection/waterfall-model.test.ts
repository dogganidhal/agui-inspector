// The waterfall's view logic without a DOM (spec 011): which rows are visible, what each key of the tree does, the
// ticks of an axis and the text a screen reader gets for a row.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWaterfall } from '../../src/core/projection/waterfall.ts';
import { axisTicks, rowLabel, treeKey, visibleRows, type VisibleRow } from '../../src/views/inspection/waterfall-model.ts';
import { harness } from '../conversation/support.ts';
import { delegation, flatten, playRun, timed } from './waterfall-support.ts';

const NONE = new Set<string>();
const CHOICES = new Map<string, boolean>();
const waterfall = buildWaterfall(delegation({ subagents: false }));
const labels = (rows: readonly VisibleRow[]) => rows.map((visible) => `${visible.depth}:${visible.row.kind}:${visible.row.label}`);

/** Three runs of one thread, newest last in time. */
function threeRuns() {
  const h = harness();
  for (const n of [1, 2, 3]) {
    const ids = { threadId: 't1', runId: `r${n}` };
    playRun(h, `ex${n}`, timed([{ type: 'RUN_STARTED', ...ids }, { type: 'STEP_STARTED', stepName: `s${n}` }, { type: 'STEP_FINISHED', stepName: `s${n}` }, { type: 'RUN_FINISHED', ...ids, outcome: { type: 'success' } }]), { runId: `r${n}` });
  }
  return buildWaterfall(h.session());
}

test('the newest run is open and an older run is closed unless chosen, and any other row is open unless closed', () => {
  const rows = visibleRows(threeRuns(), NONE, CHOICES);
  assert.deepEqual(labels(rows), ['0:run:r3', '1:step:s3', '0:run:r2', '0:run:r1']);
  assert.deepEqual(rows.map((row) => [row.posInSet, row.setSize, row.expandable, row.expanded]), [[1, 3, true, true], [1, 1, false, false], [2, 3, true, false], [3, 3, true, false]]);
  const chosen = visibleRows(threeRuns(), NONE, new Map([['ex1:run', true], ['ex3:run', false]]));
  assert.deepEqual(labels(chosen), ['0:run:r3', '0:run:r2', '0:run:r1', '1:step:s1']);
});

test('a closed row hides its subtree, and each row knows its parent, level and place among its siblings', () => {
  const all = visibleRows(waterfall, NONE, CHOICES);
  assert.deepEqual(labels(all), [
    '0:run:run1', '1:step:plan', '2:reasoning:think-1', '2:message:assistant', '1:step:research', '2:tool:search_documents', '2:message:assistant', '1:step:answer', '2:message:assistant', '2:tool:pick_color',
  ]);
  assert.deepEqual(all.map((row) => row.parentIndex), [undefined, 0, 1, 1, 0, 4, 4, 0, 7, 7]);
  assert.deepEqual(all.map((row) => [row.posInSet, row.setSize]).slice(1, 5), [[1, 3], [1, 2], [2, 2], [2, 3]]);
  const research = all[4]?.row.id as string;
  assert.deepEqual(labels(visibleRows(waterfall, new Set([research]), CHOICES)), ['0:run:run1', '1:step:plan', '2:reasoning:think-1', '2:message:assistant', '1:step:research', '1:step:answer', '2:message:assistant', '2:tool:pick_color']);
});

test('every key of the tree does what the pattern says', () => {
  const rows = visibleRows(waterfall, new Set([waterfall.runs[0]?.row.children[1]?.id as string]), CHOICES);
  // 0 run, 1 plan (open), 2 reasoning, 3 text, 4 research (closed), 5 answer (open), 6 text, 7 tool
  assert.equal(rows.length, 8);
  assert.deepEqual(treeKey(rows, 0, 'ArrowDown'), { type: 'focus', index: 1 });
  assert.deepEqual(treeKey(rows, 7, 'ArrowDown'), { type: 'none' }, 'no wrap past the last row');
  assert.deepEqual(treeKey(rows, 0, 'ArrowUp'), { type: 'none' });
  assert.deepEqual(treeKey(rows, 3, 'ArrowUp'), { type: 'focus', index: 2 });
  assert.deepEqual(treeKey(rows, 4, 'ArrowRight'), { type: 'toggle', id: rows[4]?.row.id, open: true }, 'right on a closed row opens it');
  assert.deepEqual(treeKey(rows, 1, 'ArrowRight'), { type: 'focus', index: 2 }, 'right on an open row steps to its first child');
  assert.deepEqual(treeKey(rows, 2, 'ArrowRight'), { type: 'none' }, 'right on a leaf does nothing');
  assert.deepEqual(treeKey(rows, 1, 'ArrowLeft'), { type: 'toggle', id: rows[1]?.row.id, open: false }, 'left on an open row closes it');
  assert.deepEqual(treeKey(rows, 4, 'ArrowLeft'), { type: 'focus', index: 0 }, 'left on a closed row steps to its parent');
  assert.deepEqual(treeKey(rows, 3, 'ArrowLeft'), { type: 'focus', index: 1 }, 'left on a leaf steps to its parent');
  assert.deepEqual(treeKey(rows, 0, 'ArrowLeft'), { type: 'toggle', id: rows[0]?.row.id, open: false }, 'left on an open run closes it');
  const closedRun = visibleRows(waterfall, NONE, new Map([[waterfall.runs[0]?.row.id as string, false]]));
  assert.deepEqual(treeKey(closedRun, 0, 'ArrowLeft'), { type: 'none' }, 'a closed run has no parent');
  assert.deepEqual(treeKey(rows, 5, 'Home'), { type: 'focus', index: 0 });
  assert.deepEqual(treeKey(rows, 0, 'Home'), { type: 'none' });
  assert.deepEqual(treeKey(rows, 2, 'End'), { type: 'focus', index: 7 });
  assert.deepEqual(treeKey(rows, 6, 'Enter'), { type: 'show', index: 6 });
  assert.deepEqual(treeKey([], 0, 'ArrowDown'), { type: 'none' });
  assert.deepEqual(treeKey(rows, 99, 'Enter'), { type: 'none' });
});

test('the axis has round ticks, at most eight, none that would touch the end label', () => {
  assert.deepEqual(axisTicks(300).map((tick) => tick.label), ['50 ms', '100 ms', '150 ms', '200 ms']);
  assert.deepEqual(axisTicks(1200).map((tick) => tick.label), ['200 ms', '400 ms', '600 ms', '800 ms']);
  assert.deepEqual(axisTicks(14_000).map((tick) => tick.label), ['2 s', '4 s', '6 s', '8 s', '10 s']);
  assert.deepEqual(axisTicks(180_000).map((tick) => tick.label), ['30 s', '60 s', '90 s', '120 s']);
  for (const axis of [1, 10, 999, 5000, 61_000, 7_200_000]) assert.ok(axisTicks(axis).length <= 8, `${axis} ms`);
  assert.deepEqual(axisTicks(1), []);
});

test('the last whole-second tick of a 6.82 s axis is left out, so it does not run into the end label', () => {
  assert.deepEqual(axisTicks(6820).map((tick) => tick.label), ['1 s', '2 s', '3 s', '4 s', '5 s']);
});

test('the label of a row says kind, label, level, times and state', () => {
  const rows = visibleRows(waterfall, NONE, CHOICES);
  assert.equal(rowLabel(rows[5] as VisibleRow), 'tool, search_documents, level 3, started +0.520, ended +1.400, 880 ms');
  assert.equal(rowLabel(rows[9] as VisibleRow), 'tool, pick_color, level 3, started +1.700, ended +1.720, 20 ms, waiting for result');
  assert.equal(rowLabel(rows[1] as VisibleRow), 'step, plan, level 2, started +0.150, ended +0.460, 310 ms, open');
  const closed = visibleRows(waterfall, new Set([rows[1]?.row.id as string]), CHOICES);
  assert.match(rowLabel(closed[1] as VisibleRow), /, closed$/);
  assert.equal(rowLabel(rows[3] as VisibleRow), 'text, assistant, level 3, started +0.350, ended +0.450, 100 ms');
  assert.match(rowLabel(rows[0] as VisibleRow), /^run, run1, level 1, started \+0\.100, ended \+1\.800, 1\.70 s, Finished, open$/);
});

test('an open row says running while the exchange streams and no end seen after, with how long it was seen', () => {
  const frames = [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' }, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' }];
  for (const [options, word] of [[{ live: true, transport: 'streaming' as const }, 'running'], [{ transport: 'user-stopped' as const }, 'no end seen']] as const) {
    const h = harness();
    playRun(h, 'ex1', timed(frames), options);
    const rows = visibleRows(buildWaterfall(h.session()), NONE, CHOICES);
    assert.equal(rowLabel(rows[1] as VisibleRow), `text, assistant, level 2, started +0.020, ${word}, seen for 10 ms`);
  }
  const h = harness();
  h.open('empty', { input: { threadId: 't1', runId: 'r0' } });
  h.close('empty', 'transport-error');
  assert.equal(rowLabel(visibleRows(buildWaterfall(h.session()), NONE, CHOICES)[0] as VisibleRow), 'run, r0, level 1, no end seen, No terminal event');
});

test('flatten lists the same rows as the visible list when everything is open', () => {
  const open = visibleRows(waterfall, NONE, CHOICES).map((row) => row.row.id);
  assert.deepEqual(open, flatten(waterfall).map((row) => row.id));
});
