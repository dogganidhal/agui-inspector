// Spec 009 (the subagent timeline): `timelineOf` turns the projection's lanes and runs into charts and rows. The offsets
// are the offsets of the frames, the order is depth first, and a transcript replacement leaves a row where it was.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { projectConversation, type ConversationModel } from '../../src/core/projection/index.ts';
import { timelineOf } from '../../src/core/projection/subagents.ts';
import { harness, RUN_FINISHED, RUN_STARTED, sessionOf } from './support.ts';

const started = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_STARTED', subagentRunId: id, name: id, ...extra });
const finished = (id: string) => ({ type: 'SUBAGENT_FINISHED', subagentRunId: id });
const project = (events: ReadonlyArray<object>, live = false): ConversationModel => projectConversation(sessionOf(events, { live }));
const shape = (model: ConversationModel) => timelineOf(model).map((chart) => chart.rows.map((row) => [row.kind === 'run' ? 'run' : row.lane!.subagentRunId, row.depth]));

test('a chart exists only for a run that has lanes', () => {
  assert.deepEqual(timelineOf(project([RUN_STARTED, RUN_FINISHED])), []);
  assert.equal(timelineOf(project([RUN_STARTED, started('s'), finished('s'), RUN_FINISHED])).length, 1);
});

test('rows run depth first, siblings in the order they began, with the depth of their nesting', () => {
  const model = project([
    RUN_STARTED,
    started('a'),
    started('a1', { parentSubagentRunId: 'a' }),
    started('a1x', { parentSubagentRunId: 'a1' }),
    finished('a1x'),
    finished('a1'),
    started('a2', { parentSubagentRunId: 'a' }),
    finished('a2'),
    finished('a'),
    started('b'),
    finished('b'),
    RUN_FINISHED,
  ]);
  assert.deepEqual(shape(model), [[['run', 0], ['a', 1], ['a1', 2], ['a1x', 3], ['a2', 2], ['b', 1]]]);
});

test('a lane whose parent is not in the chart sits under the run', () => {
  const model = project([RUN_STARTED, started('x', { parentSubagentRunId: 'ghost' }), finished('x'), RUN_FINISHED]);
  assert.deepEqual(shape(model), [[['run', 0], ['x', 1]]]);
});

test('start and end of every row are the offsets of the frames', () => {
  const model = project([
    RUN_STARTED, // 10
    started('first'), // 20
    started('second'), // 30
    finished('first'), // 40
    started('third'), // 50
    finished('third'), // 60
    finished('second'), // 70
    RUN_FINISHED, // 80
  ]);
  const [chart] = timelineOf(model);
  assert.deepEqual(chart!.rows.map((row) => [row.startMs, row.endMs]), [[10, 80], [20, 40], [30, 70], [50, 60]]);
  assert.ok(chart!.rows[1]!.endMs > chart!.rows[2]!.startMs, 'overlapping subagents overlap on the axis');
  assert.ok(chart!.rows[3]!.startMs > chart!.rows[1]!.endMs, 'a later one starts after');
});

test('a lane with no start event starts at its first frame, and an open lane ends at the last valid frame', () => {
  const model = project([
    RUN_STARTED, // 10
    { type: 'CUSTOM', name: 'x', value: 1, subagentRunId: 'quiet' }, // 20
    started('open'), // 30
    { type: 'CUSTOM', name: 'y', value: 1, subagentRunId: 'open' }, // 40
  ], true);
  const [chart] = timelineOf(model);
  const rows = Object.fromEntries(chart!.rows.filter((row) => row.lane).map((row) => [row.lane!.subagentRunId, row]));
  assert.deepEqual([rows.quiet!.startMs, rows.quiet!.endMs], [20, 40], 'from its first frame to the last valid frame');
  assert.deepEqual([rows.open!.startMs, rows.open!.endMs], [30, 40]);
  for (const row of chart!.rows) assert.ok(row.endMs >= row.startMs);
});

test('each run has its own chart and axis', () => {
  const h = harness();
  for (const [id, run, elapsed] of [['ex1', 'r1', 500], ['ex2', 'r2', 2500]] as const) {
    h.open(id, { input: { threadId: 't1', runId: run } });
    h.push(id, { type: 'RUN_STARTED', threadId: 't1', runId: run }, 10);
    h.push(id, started('s1'), 20);
    h.push(id, finished('s1'), 30);
    h.push(id, { type: 'RUN_FINISHED', threadId: 't1', runId: run, outcome: { type: 'success' } }, 40);
    h.close(id, 'completed', elapsed);
  }
  const charts = timelineOf(projectConversation(h.session()));
  assert.deepEqual(charts.map((chart) => [chart.exchangeId, chart.axisMs, chart.rows.length]), [['ex1', 500, 2], ['ex2', 2500, 2]]);
  assert.deepEqual(charts.map((chart) => chart.run.runId), ['r1', 'r2']);
});

test('a messages snapshot takes an ended lane out of the transcript and its row stays', () => {
  const model = project([RUN_STARTED, started('s'), finished('s'), { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'x' }] }, RUN_FINISHED]);
  assert.equal(model.entries.some((entry) => entry.kind === 'subagent'), false);
  const [chart] = timelineOf(model);
  assert.equal(chart!.rows[1]!.lane!.inTranscript, false);
  assert.equal(chart!.rows.length, 2);
});

test('it does not change the model, and a deep thread does not use the call stack', () => {
  const events: object[] = [RUN_STARTED];
  const depth = 1000;
  for (let i = 0; i < depth; i += 1) events.push(started(`d${i}`, i > 0 ? { parentSubagentRunId: `d${i - 1}` } : {}));
  for (let i = depth - 1; i >= 0; i -= 1) events.push(finished(`d${i}`));
  events.push(RUN_FINISHED);
  const model = project(events);
  const before = model.subagents.map((lane) => [lane.id, lane.status, lane.endOffsetMs, lane.children.length]);
  const [chart] = timelineOf(model);
  assert.equal(chart!.rows.length, depth + 1);
  assert.equal(chart!.rows.at(-1)!.depth, depth);
  assert.deepEqual(model.subagents.map((lane) => [lane.id, lane.status, lane.endOffsetMs, lane.children.length]), before);
});

test('the module is plain data: it imports no React', () => {
  const source = readFileSync(path.join(process.cwd(), 'packages/inspector/src/core/projection/subagents.ts'), 'utf8');
  assert.doesNotMatch(source, /from 'react|from "react|react-dom/);
});
