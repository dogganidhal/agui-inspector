// The run waterfall builder (spec 011): the rows, nesting, times and open rows of a recorded thread, checked against the
// arrival offsets of the frames the reader recorded. Subagent runs are not covered here yet: they wait for the
// subagent projection of spec 009.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunAgentInput } from '@ag-ui/core';
import { buildWaterfall } from '../../src/core/projection/waterfall.ts';
import { harness } from '../conversation/support.ts';
import { delegation, flatten, playRun, rowOf, timed } from './waterfall-support.ts';

const RUN = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const DONE = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } };
const say = (messageId: string, delta = 'text') => [
  { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId, delta },
  { type: 'TEXT_MESSAGE_END', messageId },
];

/** One exchange of the given events (at 10 ms steps) and the waterfall of it. */
function run(events: ReadonlyArray<Record<string, unknown>>, options: Parameters<typeof playRun>[3] = {}) {
  const h = harness();
  playRun(h, 'ex1', timed(events), options);
  return buildWaterfall(h.session());
}

test('the delegation run has the rows, nesting and times of its frames', () => {
  const waterfall = buildWaterfall(delegation({ subagents: false }));
  assert.deepEqual(
    flatten(waterfall).map(({ kind, label, depth, startMs, endMs, open }) => [kind, label, depth, startMs, endMs, open]),
    [
      ['run', 'run1', 0, 100, 1800, false],
      ['step', 'plan', 1, 150, 460, false],
      ['reasoning', 'think-1', 2, 200, 310, false],
      ['message', 'assistant', 2, 350, 450, false],
      ['step', 'research', 1, 500, 1500, false],
      ['tool', 'search_documents', 2, 520, 1400, false],
      ['message', 'assistant', 2, 580, 1250, false],
      ['step', 'answer', 1, 1550, 1760, false],
      ['message', 'assistant', 2, 1600, 1650, false],
      ['tool', 'pick_color', 2, 1700, 1720, false],
    ],
  );
});

test('a tool call has its arguments end and its result time, and a call left for the client says it waits', () => {
  const waterfall = buildWaterfall(delegation({ subagents: false }));
  const search = rowOf(waterfall, 'tool', 'search_documents');
  assert.deepEqual([search.startMs, search.argsEndMs, search.resultMs, search.endMs], [520, 560, 1400, 1400]);
  assert.deepEqual(search.tags, []);
  const pick = rowOf(waterfall, 'tool', 'pick_color');
  assert.deepEqual([pick.startMs, pick.argsEndMs, pick.resultMs, pick.endMs], [1700, 1720, undefined, 1720]);
  assert.deepEqual(pick.tags, [{ text: 'waiting for result', variant: 'warn' }]);
  assert.equal(pick.open, false);
});

test('a message built from chunks ends at its last chunk once the next event closes it', () => {
  const waterfall = buildWaterfall(delegation({ subagents: false }));
  const answer = waterfall.runs[0]?.row.children[2]?.children[0];
  assert.equal(answer?.subject, 'm-answer');
  assert.deepEqual([answer?.startMs, answer?.endMs, answer?.frameCount], [1600, 1650, 2]);
});

test('messages that stream at once are siblings with overlapping spans', () => {
  const research = rowOf(buildWaterfall(delegation({ subagents: false })), 'step', 'research');
  const [search, note] = research.children;
  assert.equal(research.children.length, 2);
  assert.ok(search && note);
  assert.ok((note.startMs as number) < (search.endMs as number) && (search.startMs as number) < (note.endMs as number));
});

test('every row names its frames, and none gets an end that no frame carries', () => {
  const session = delegation({ subagents: false });
  assert.ok(session.frames.every((frame) => frame.schemaVerdict === 'valid'), 'every event of the script is schema-valid');
  const offsets = new Set(session.frames.map((frame) => frame.offsetMs));
  const byId = new Map(session.frames.map((frame) => [frame.id, frame]));
  const visit = (row: ReturnType<typeof rowOf>) => {
    for (const time of [row.startMs, row.endMs, row.argsEndMs, row.resultMs]) assert.ok(time === undefined || offsets.has(time), `${row.label} time ${time} is a frame offset`);
    if (row.firstFrame !== undefined) assert.equal(byId.get(row.firstFrame)?.offsetMs, row.startMs);
    row.children.forEach(visit);
  };
  buildWaterfall(session).runs.forEach((group) => visit(group.row));
});

test('three runs of one thread are three groups, newest first, each with its own axis', () => {
  const h = harness();
  playRun(h, 'ex1', timed([RUN, ...say('m1'), DONE]), { runId: 'r1', elapsedMs: 100 });
  playRun(h, 'ex2', timed([{ ...RUN, runId: 'r2' }, ...say('m2'), { ...DONE, runId: 'r2' }], 100), { runId: 'r2', elapsedMs: 900 });
  playRun(h, 'ex3', timed([{ ...RUN, runId: 'r3' }, { ...DONE, runId: 'r3' }], 5), { runId: 'r3' });
  const waterfall = buildWaterfall(h.session());
  assert.deepEqual(waterfall.runs.map((group) => group.exchangeId), ['ex3', 'ex2', 'ex1']);
  assert.deepEqual(waterfall.runs.map((group) => group.row.label), ['r3', 'r2', 'r1']);
  // The axis is the later of the last frame and the exchange's elapsed time, and at least 1.
  assert.deepEqual(waterfall.runs.map((group) => [group.latestMs, group.axisMs]), [[10, 10], [500, 900], [50, 100]]);
  assert.equal(waterfall.threadId, 't1');
});

test('other threads, preparation requests and raw requests are not runs, and an empty exchange is a group without a bar', () => {
  const h = harness();
  playRun(h, 'other', timed([{ ...RUN, threadId: 't2', runId: 'o1' }, { ...DONE, threadId: 't2', runId: 'o1' }]), { threadId: 't2', runId: 'o1' });
  playRun(h, 'prep', timed([RUN]), { kind: 'preparation' });
  playRun(h, 'raw', timed([RUN]), { kind: 'raw' });
  playRun(h, 'ex1', timed([RUN, ...say('m1'), DONE]), { runId: 'r1' });
  h.open('empty', { input: { threadId: 't1', runId: 'r-empty' }, transport: 'transport-error' });
  h.close('empty', 'transport-error');
  const waterfall = buildWaterfall(h.session(), 't1');
  assert.deepEqual(waterfall.runs.map((group) => group.exchangeId), ['empty', 'ex1']);
  const empty = waterfall.runs[0];
  assert.equal(empty?.row.startMs, undefined);
  assert.equal(empty?.row.endMs, undefined);
  assert.equal(empty?.row.frameCount, 0);
  assert.deepEqual(empty?.row.children, []);
  assert.equal(empty?.axisMs, 1);
  assert.equal(buildWaterfall(h.session(), 't2').runs.length, 1);
  assert.equal(buildWaterfall(h.session()).threadId, 't1', 'without a thread, the thread of the latest conversation exchange');
});

test('input-origin messages and a message restated by a snapshot add no row, and a message the snapshot dropped keeps its row', () => {
  const h = harness();
  const input = { messages: [{ id: 'u1', role: 'user', content: 'hello' }, { id: 'a0', role: 'assistant', content: '', toolCalls: [{ id: 'tc-old', type: 'function', function: { name: 'old', arguments: '{}' } }] }] } as unknown as Partial<RunAgentInput>;
  playRun(h, 'ex1', timed([RUN, ...say('m1'), { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'm9', role: 'assistant', content: 'restated' }] }, ...say('m2'), DONE]), { runId: 'r1', input });
  const labels = flatten(buildWaterfall(h.session())).map((row) => `${row.kind}:${row.label}`);
  assert.deepEqual(labels, ['run:r1', 'message:assistant', 'message:assistant']);
  const [, first, second] = flatten(buildWaterfall(h.session()));
  assert.deepEqual([first?.startMs, first?.endMs, second?.startMs, second?.endMs], [20, 40, 60, 80]);
});

test('a call answered by a later run says the client answered it, and a result streamed by a later run says so', () => {
  const h = harness();
  const call = (id: string) => [
    { type: 'TOOL_CALL_START', toolCallId: id, toolCallName: 'pick' },
    { type: 'TOOL_CALL_ARGS', toolCallId: id, delta: '{}' },
    { type: 'TOOL_CALL_END', toolCallId: id },
  ];
  playRun(h, 'ex1', timed([RUN, ...call('tc-a'), ...call('tc-b'), DONE]), { runId: 'r1' });
  const answer = { messages: [{ id: 'res-a', role: 'tool', toolCallId: 'tc-a', content: 'red' }] } as unknown as Partial<RunAgentInput>;
  playRun(h, 'ex2', timed([{ ...RUN, runId: 'r2' }, { type: 'TOOL_CALL_RESULT', toolCallId: 'tc-b', messageId: 'res-b', content: 'blue' }, { ...DONE, runId: 'r2' }]), { runId: 'r2', input: answer });
  const waterfall = buildWaterfall(h.session());
  const rows = waterfall.runs[1]?.row.children ?? [];
  assert.deepEqual(rows.map((row) => [row.subject, row.tags.map((tag) => tag.text), row.resultMs, row.endMs]), [
    ['tc-a', ['answered by the client'], undefined, 40],
    ['tc-b', ['answered in a later run'], undefined, 70],
  ]);
  assert.deepEqual(waterfall.runs[0]?.row.children, [], 'the run that carried the answers has no row for the calls of the first');
});

test('a row of one frame has equal start and end, and rows of equal start keep the arrival order of their first frame', () => {
  const waterfall = run([RUN, { type: 'STEP_STARTED', stepName: 'quick' }, { type: 'STEP_FINISHED', stepName: 'quick' }, DONE]);
  const quick = rowOf(waterfall, 'step', 'quick');
  assert.equal(quick.endMs, (quick.startMs as number) + 10, 'start and finish are different frames, 10 ms apart');
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  h.push('ex1', RUN, 10);
  for (const id of ['b', 'a', 'c']) h.push('ex1', { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }, 20);
  for (const id of ['b', 'a', 'c']) h.push('ex1', { type: 'TEXT_MESSAGE_END', messageId: id }, 20);
  h.push('ex1', DONE, 30);
  h.close('ex1');
  const rows = buildWaterfall(h.session()).runs[0]?.row.children ?? [];
  assert.deepEqual(rows.map((row) => [row.subject, row.startMs, row.endMs]), [['b', 20, 20], ['a', 20, 20], ['c', 20, 20]]);
});

test('the run status says how the run ended, with the conversation words and variants', () => {
  const tag = (events: ReadonlyArray<Record<string, unknown>>, options?: Parameters<typeof playRun>[3]) => run(events, options).runs[0]?.row.tags.map((entry) => `${entry.text}/${entry.variant}`);
  assert.deepEqual(tag([RUN, ...say('m1'), DONE]), ['Finished/ok']);
  assert.deepEqual(tag([RUN, { ...DONE, outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] } }]), ['Interrupted/accent']);
  assert.deepEqual(tag([RUN, { ...DONE, outcome: { type: 'cancelled' } }]), ['Cancelled/neutral']);
  assert.deepEqual(tag([RUN, { type: 'RUN_ERROR', message: 'boom', code: 'x' }]), ['Error/err']);
  assert.deepEqual(tag([RUN, ...say('m1')], { live: true, transport: 'streaming' }), ['Streaming/accent']);
  assert.deepEqual(tag([RUN, ...say('m1')], { transport: 'user-stopped' }), ['Stopped by you/warn']);
  assert.deepEqual(tag([RUN, ...say('m1')]), ['No terminal event/warn']);
});

test('a run that ended keeps its end, and the others are open', () => {
  const ended = (events: ReadonlyArray<Record<string, unknown>>) => run(events).runs[0]?.row;
  for (const outcome of [DONE, { ...DONE, outcome: { type: 'cancelled' } }, { type: 'RUN_ERROR', message: 'boom' }]) {
    const row = ended([RUN, ...say('m1'), outcome]);
    assert.equal(row?.open, false);
    assert.equal(row?.endMs, 50);
  }
  const open = ended([RUN, ...say('m1')]);
  assert.equal(open?.open, true);
  assert.equal(open?.endMs, undefined);
});

test('a streaming run has open rows that run to the latest frame, and a row closes when its end frame arrives', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  h.push('ex1', RUN, 10);
  h.push('ex1', { type: 'STEP_STARTED', stepName: 's' }, 20);
  h.push('ex1', { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, 30);
  h.push('ex1', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' }, 40);
  const before = buildWaterfall(h.session());
  assert.equal(before.runs[0]?.live, true);
  assert.equal(before.runs[0]?.latestMs, 40);
  assert.deepEqual(flatten(before).map((row) => [row.kind, row.open, row.endMs]), [['run', true, undefined], ['step', true, undefined], ['message', true, undefined]]);
  h.push('ex1', { type: 'TEXT_MESSAGE_END', messageId: 'm1' }, 50);
  const after = flatten(buildWaterfall(h.session()));
  assert.deepEqual(after.map((row) => [row.kind, row.open, row.endMs]), [['run', true, undefined], ['step', true, undefined], ['message', false, 50]]);
});

test('after the stream stopped, every row without an end frame stays open and gets no end', () => {
  const events = [
    RUN,
    { type: 'STEP_STARTED', stepName: 's' },
    { type: 'TEXT_MESSAGE_CHUNK', messageId: 'c1', role: 'assistant', delta: 'chunk' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 't' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"a":' },
  ];
  for (const transport of ['user-stopped', 'completed', 'transport-error'] as const) {
    const waterfall = run(events, { transport });
    const rows = flatten(waterfall);
    assert.equal(waterfall.runs[0]?.live, false);
    assert.deepEqual(rows.map((row) => [row.kind, row.open, row.endMs]), [['run', true, undefined], ['step', true, undefined], ['message', true, undefined], ['tool', true, undefined]], transport);
  }
  const h = harness();
  playRun(h, 'ex1', timed(events), { transport: 'transport-error' });
  h.store.updateExchange('ex1', { transportError: 'connection reset' });
  const failed = buildWaterfall(h.session()).runs[0]?.row;
  assert.deepEqual(failed?.tags.map((entry) => entry.text), ['No terminal event', 'connection error']);
  assert.deepEqual(failed?.facts.find((fact) => fact.name === 'Connection'), { name: 'Connection', value: 'connection reset' });
});

test('a finished run keeps a message without an end event open, a step left open by its outer step open, and a call with no end open', () => {
  const waterfall = run([
    RUN,
    { type: 'STEP_STARTED', stepName: 'outer' },
    { type: 'STEP_STARTED', stepName: 'inner' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' },
    { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'noend' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{' },
    { type: 'STEP_FINISHED', stepName: 'outer' },
    DONE,
  ]);
  const rows = Object.fromEntries(flatten(waterfall).map((row) => [row.label, row]));
  assert.equal(rows.r1?.open, false);
  assert.equal(rows.outer?.open, false);
  assert.equal(rows.inner?.open, true);
  assert.equal(rows.inner?.endMs, undefined);
  assert.equal(rows.assistant?.open, true, 'the run ended, the message did not');
  assert.equal(rows.assistant?.endMs, undefined);
  assert.equal(rows.noend?.open, true);
});

test('a client tool call left pending in a streaming run is open until the run says otherwise', () => {
  const live = run([RUN, { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'ask' }, { type: 'TOOL_CALL_END', toolCallId: 't1' }], { live: true, transport: 'streaming' });
  const ask = rowOf(live, 'tool', 'ask');
  assert.equal(ask.open, true);
  assert.deepEqual([ask.argsEndMs, ask.endMs], [30, undefined]);
  assert.deepEqual(ask.tags, []);
});

test('a session that is exported and imported builds the same waterfall', async () => {
  const { parseSession, restoreSession, serializeSession } = await import('../../src/core/session-files/index.ts');
  const session = delegation({ subagents: false });
  const result = parseSession(serializeSession(session));
  assert.ok(result.ok);
  assert.deepEqual(buildWaterfall(restoreSession(result.session).snapshot()), buildWaterfall(session));
});
