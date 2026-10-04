// Spec 009, SC-006: lanes and the timeline on the frozen 5,000-frame benchmark, and on a thread made for the case that
// lanes make worse if done wrong: 200 subagents, three levels deep, each with its own events. The conversation re-projects
// on every store notification, so both must stay cheap, keep every lane and never touch the raw frames.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { generateFixture } from '../../../../tests/benchmarks/generate.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { timelineOf } from '../../src/core/projection/subagents.ts';
import { harness } from './support.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** One run: `top` subagents, 4 under each, and 15 under each of those, spread over its 4: 20 lanes per `top`. Each lane has a start, 23 frames of its own and an end. */
function deepThread(top: number) {
  const h = harness();
  h.open('ex1', { input: { threadId: 't-lanes', runId: 'r1' } });
  let offset = 0;
  const push = (event: object) => h.push('ex1', event, (offset += 1));
  push({ type: 'RUN_STARTED', threadId: 't-lanes', runId: 'r1' });
  const ids: Array<[string, string | undefined]> = [];
  for (let a = 0; a < top; a += 1) {
    ids.push([`a${a}`, undefined]);
    for (let b = 0; b < 4; b += 1) {
      ids.push([`a${a}-b${b}`, `a${a}`]);
    }
    for (let c = 0; c < 15; c += 1) ids.push([`a${a}-c${c}`, `a${a}-b${c % 4}`]);
  }
  for (const [id, parent] of ids) push({ type: 'SUBAGENT_STARTED', subagentRunId: id, name: id, ...(parent !== undefined && { parentSubagentRunId: parent }) });
  for (const [id] of ids) {
    push({ type: 'STEP_STARTED', stepName: 'work', subagentRunId: id });
    push({ type: 'TEXT_MESSAGE_START', messageId: `m-${id}`, role: 'assistant', subagentRunId: id });
    for (let n = 0; n < 17; n += 1) push({ type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${id}`, delta: `word ${n} `, subagentRunId: id });
    push({ type: 'TEXT_MESSAGE_END', messageId: `m-${id}`, subagentRunId: id });
    push({ type: 'TOOL_CALL_START', toolCallId: `t-${id}`, toolCallName: 'look', subagentRunId: id });
    push({ type: 'TOOL_CALL_END', toolCallId: `t-${id}`, subagentRunId: id });
    push({ type: 'STEP_FINISHED', stepName: 'work', subagentRunId: id });
  }
  for (const [id] of [...ids].reverse()) push({ type: 'SUBAGENT_FINISHED', subagentRunId: id });
  push({ type: 'RUN_FINISHED', threadId: 't-lanes', runId: 'r1', outcome: { type: 'success' } });
  h.close('ex1', 'completed', offset + 10);
  return { session: h.session(), lanes: ids.length };
}

function measure(top: number) {
  const { session, lanes } = deepThread(top);
  const before = hash(session.frames);
  const started = performance.now();
  const model = projectConversation(session);
  const charts = timelineOf(model);
  const elapsed = performance.now() - started;
  assert.equal(hash(session.frames), before, 'the raw frames are exactly as the reader left them');
  return { session, model, charts, elapsed, lanes };
}

test('a 5,000-frame thread of 200 subagents, three levels deep, projects and builds its timeline in under a second', () => {
  const { session, model, charts, elapsed, lanes } = measure(10);
  console.log(`projection and timeline of ${session.frames.length} frames, ${lanes} lanes: ${elapsed.toFixed(1)} ms`);
  assert.equal(lanes, 200);
  assert.ok(session.frames.length >= 5000 && session.frames.length < 5100, `${session.frames.length} frames`);
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)} ms`);
  assert.equal(model.subagents.length, lanes);
  assert.deepEqual(model.issues, []);
  assert.equal(charts.length, 1);
  assert.equal(charts[0]!.rows.length, lanes + 1);
  assert.equal(Math.max(...charts[0]!.rows.map((row) => row.depth)), 3);
  for (const lane of model.subagents) {
    assert.equal(lane.status, 'finished');
    const messages = lane.children.flatMap((entry) => (entry.kind === 'step' ? entry.children : [entry])).filter((entry) => entry.kind === 'message');
    assert.equal(messages.length, 1, `${lane.subagentRunId} holds its own message`);
  }
});

test('the time grows with the frames, not faster', () => {
  measure(2); // warm up
  const small = measure(5);
  const large = measure(10);
  console.log(`${small.session.frames.length} frames: ${small.elapsed.toFixed(1)} ms, ${large.session.frames.length} frames: ${large.elapsed.toFixed(1)} ms`);
  assert.ok(large.session.frames.length > small.session.frames.length * 1.9);
  assert.ok(large.elapsed < Math.max(small.elapsed * 4, 50), `${large.elapsed.toFixed(1)} ms is more than linear against ${small.elapsed.toFixed(1)} ms`);
});

test('the frozen 5,000-frame benchmark still projects in under 500 ms and now has its subagent lanes', () => {
  const h = harness();
  for (const exchange of generateFixture()) {
    const id = `bench-${exchange.index}`;
    h.open(id, { input: { threadId: 'bench-thread', runId: exchange.runId } });
    for (const frame of exchange.frames) h.pushWire(id, frame.envelope, 0);
    h.close(id);
  }
  const session = h.session();
  const before = hash(session.frames);
  const started = performance.now();
  const model = projectConversation(session);
  const charts = timelineOf(model);
  const elapsed = performance.now() - started;
  console.log(`benchmark projection and timeline: ${elapsed.toFixed(1)} ms, ${model.subagents.length} lanes, ${charts.length} charts`);
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
  assert.equal(model.subagents.length, 20, 'one lane for each of the 20 SUBAGENT_STARTED events of the workload, in its own run');
  assert.equal(hash(session.frames), before);
});
