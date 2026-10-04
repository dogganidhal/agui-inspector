// Spec 009 (subagent lanes): the projection puts each entry in the lane its event names, nests lanes by parent, gives
// each lane a status and offsets, and keeps every lane in `model.subagents` whatever the transcript still holds.
// Scripted sessions go through the real frame reader and store, so the checks run on genuine evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventFixtures } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { interactiveResponse, SUBAGENTS } from '../../../../examples/reference-agent/scenarios.ts';
import { projectConversation, type ConversationEntry, type ConversationModel, type MessageEntry, type StepEntry, type SubagentEntry, type ToolCallEntry } from '../../src/core/projection/index.ts';
import { harness, RUN_FINISHED, RUN_STARTED, sessionOf } from './support.ts';

const project = (events: ReadonlyArray<object | string>, options: { live?: boolean; transport?: 'user-stopped' } = {}): ConversationModel =>
  projectConversation(sessionOf(events, options));

const started = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_STARTED', subagentRunId: id, name: `agent-${id}`, ...extra });
const finished = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_FINISHED', subagentRunId: id, ...extra });
const inLane = (id: string, event: object) => ({ ...event, subagentRunId: id });
const kinds = (entries: readonly ConversationEntry[]) => entries.map((entry) => entry.kind);
const laneOf = (model: ConversationModel, id: string): SubagentEntry => {
  const found = model.subagents.find((lane) => lane.subagentRunId === id);
  assert.ok(found, `no lane for ${id}`);
  return found;
};
const textOf = (entry: ConversationEntry | undefined) => (entry as MessageEntry).text;

// ---- the new fields ----

test('the end of a run on the axis is its elapsed time or its last frame, and at least 1', () => {
  const live = project([RUN_STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }], { live: true });
  const run = live.entries.find((entry) => entry.kind === 'run');
  assert.equal(run?.kind === 'run' && run.axisMs, 20, 'a live exchange ends at its last frame');

  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  h.push('ex1', RUN_STARTED, 40);
  h.close('ex1', 'completed', 900);
  const done = projectConversation(h.session()).entries[0];
  assert.equal(done?.kind === 'run' && done.axisMs, 900, 'a finished exchange ends at its elapsed time');

  const empty = harness();
  empty.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  assert.equal((projectConversation(empty.session()).entries[0] as { axisMs: number }).axisMs, 1);
});

// ---- attribution ----

// One sequence per kind of entry an attributed event can make. Every type of the contract's table is in one.
const SEQUENCES: Array<{ name: string; events: object[]; entries: ConversationEntry['kind'][] }> = [
  { name: 'text message', events: [eventFixtures.TEXT_MESSAGE_START, eventFixtures.TEXT_MESSAGE_CONTENT, eventFixtures.TEXT_MESSAGE_END], entries: ['message'] },
  { name: 'text chunk', events: [eventFixtures.TEXT_MESSAGE_CHUNK], entries: ['message'] },
  { name: 'tool call and result', events: [eventFixtures.TOOL_CALL_START, eventFixtures.TOOL_CALL_ARGS, eventFixtures.TOOL_CALL_END, eventFixtures.TOOL_CALL_RESULT], entries: ['tool'] },
  { name: 'tool chunk', events: [eventFixtures.TOOL_CALL_CHUNK], entries: ['tool'] },
  { name: 'step', events: [eventFixtures.STEP_STARTED, eventFixtures.STEP_FINISHED], entries: ['step'] },
  {
    name: 'reasoning',
    events: [eventFixtures.REASONING_START, eventFixtures.REASONING_MESSAGE_START, eventFixtures.REASONING_MESSAGE_CONTENT, eventFixtures.REASONING_MESSAGE_END, eventFixtures.REASONING_END],
    entries: ['reasoning'],
  },
  { name: 'reasoning chunk', events: [eventFixtures.REASONING_MESSAGE_CHUNK], entries: ['reasoning'] },
  { name: 'encrypted value', events: [eventFixtures.REASONING_ENCRYPTED_VALUE], entries: ['encrypted'] },
  { name: 'activity', events: [eventFixtures.ACTIVITY_SNAPSHOT, eventFixtures.ACTIVITY_DELTA], entries: ['activity'] },
  { name: 'custom', events: [eventFixtures.CUSTOM], entries: ['custom'] },
  { name: 'raw', events: [eventFixtures.RAW], entries: ['raw'] },
];

const ATTRIBUTED_TYPES = [
  'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TEXT_MESSAGE_CHUNK',
  'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_CHUNK', 'TOOL_CALL_RESULT',
  'STEP_STARTED', 'STEP_FINISHED',
  'REASONING_START', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END', 'REASONING_MESSAGE_CHUNK', 'REASONING_END',
  'REASONING_ENCRYPTED_VALUE', 'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA', 'CUSTOM', 'RAW',
];

test('the sequences cover every event type that makes a conversation entry and can name a subagent', () => {
  const covered = new Set(SEQUENCES.flatMap((sequence) => sequence.events.map((event) => (event as { type: string }).type)));
  assert.deepEqual([...covered].sort(), [...ATTRIBUTED_TYPES].sort());
});

for (const { name, events, entries } of SEQUENCES) {
  test(`${name}: the entries of events that carry a subagentRunId are in its lane and nowhere else`, () => {
    const model = project([RUN_STARTED, started('s1'), ...events.map((event) => inLane('s1', event)), finished('s1'), RUN_FINISHED]);
    assert.deepEqual(kinds(model.entries), ['run', 'subagent'], 'nothing outside the lane');
    const lane = laneOf(model, 's1');
    assert.deepEqual(kinds(lane.children), entries);
    assert.equal(lane.status, 'finished');
    assert.deepEqual(model.issues, []);
  });
}

test('a state event that names a subagent makes no lane and no entry', () => {
  const model = project([RUN_STARTED, inLane('s1', eventFixtures.STATE_SNAPSHOT), inLane('s1', eventFixtures.STATE_DELTA), RUN_FINISHED]);
  assert.deepEqual(kinds(model.entries), ['run']);
  assert.deepEqual(model.subagents, []);
  assert.equal(model.state.changes.length, 2, 'the state view still has them');
});

test('an event with no subagentRunId stays in the parent flow while a lane is open', () => {
  const model = project([
    RUN_STARTED,
    started('s1'),
    { type: 'TEXT_MESSAGE_START', messageId: 'parent-1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_END', messageId: 'parent-1' },
    inLane('s1', { type: 'TEXT_MESSAGE_START', messageId: 'child-1', role: 'assistant' }),
    inLane('s1', { type: 'TEXT_MESSAGE_END', messageId: 'child-1' }),
    finished('s1'),
    RUN_FINISHED,
  ]);
  assert.deepEqual(kinds(model.entries), ['run', 'subagent', 'message']);
  assert.equal((model.entries[2] as MessageEntry).messageId, 'parent-1');
  assert.deepEqual(laneOf(model, 's1').children.map((entry) => (entry as MessageEntry).messageId), ['child-1']);
});

test('parallel subagents keep their own events in arrival order, and their steps close in their own lane', () => {
  const model = project([
    RUN_STARTED,
    started('a'),
    started('b'),
    inLane('a', { type: 'STEP_STARTED', stepName: 'plan' }),
    inLane('b', { type: 'STEP_STARTED', stepName: 'plan' }),
    inLane('a', { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }),
    inLane('b', { type: 'TEXT_MESSAGE_START', messageId: 'b1', role: 'assistant' }),
    inLane('a', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'one ' }),
    inLane('b', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'b1', delta: 'uno ' }),
    inLane('a', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'two' }),
    inLane('b', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'b1', delta: 'dos' }),
    inLane('b', { type: 'TEXT_MESSAGE_END', messageId: 'b1' }),
    inLane('a', { type: 'TEXT_MESSAGE_END', messageId: 'a1' }),
    inLane('b', { type: 'STEP_FINISHED', stepName: 'plan' }),
    inLane('a', { type: 'STEP_FINISHED', stepName: 'plan' }),
    finished('b'),
    finished('a'),
    RUN_FINISHED,
  ]);
  assert.deepEqual(kinds(model.entries), ['run', 'subagent', 'subagent']);
  for (const [id, text] of [['a', 'one two'], ['b', 'uno dos']] as const) {
    const lane = laneOf(model, id);
    assert.deepEqual(kinds(lane.children), ['step']);
    const step = lane.children[0] as StepEntry;
    assert.equal(step.live, false);
    assert.deepEqual(kinds(step.children), ['message']);
    assert.equal(textOf(step.children[0]), text);
  }
  assert.deepEqual(model.issues, []);
});

test('chunk events of two lanes open and continue their own messages and tool calls', () => {
  const model = project([
    RUN_STARTED,
    started('a'),
    started('b'),
    inLane('a', { type: 'TEXT_MESSAGE_CHUNK', messageId: 'a1', role: 'assistant', delta: 'alpha ' }),
    inLane('b', { type: 'TEXT_MESSAGE_CHUNK', messageId: 'b1', role: 'assistant', delta: 'beta ' }),
    inLane('a', { type: 'TEXT_MESSAGE_CHUNK', delta: 'again' }),
    inLane('b', { type: 'TOOL_CALL_CHUNK', toolCallId: 'tb', toolCallName: 'look', delta: '{}' }),
    finished('a'),
    finished('b'),
    RUN_FINISHED,
  ]);
  const a = laneOf(model, 'a');
  const b = laneOf(model, 'b');
  assert.deepEqual(kinds(a.children), ['message']);
  assert.equal(textOf(a.children[0]), 'alpha again');
  assert.deepEqual(kinds(b.children), ['message', 'tool']);
  assert.equal(textOf(b.children[0]), 'beta ');
  assert.equal((b.children[1] as ToolCallEntry).toolCallId, 'tb');
  assert.deepEqual(kinds(model.entries), ['run', 'subagent', 'subagent']);
});

test('lanes nest by parentSubagentRunId to any depth, each in the lane that started it', () => {
  const model = project([
    RUN_STARTED,
    started('root'),
    started('child', { parentSubagentRunId: 'root' }),
    started('leaf', { parentSubagentRunId: 'child' }),
    inLane('leaf', { type: 'CUSTOM', name: 'deep', value: 1 }),
    finished('leaf'),
    finished('child'),
    finished('root'),
    RUN_FINISHED,
  ]);
  const [root, child, leaf] = ['root', 'child', 'leaf'].map((id) => laneOf(model, id));
  assert.deepEqual(kinds(model.entries), ['run', 'subagent']);
  assert.deepEqual(root!.children, [child]);
  assert.deepEqual(child!.children, [leaf]);
  assert.deepEqual(kinds(leaf!.children), ['custom']);
  assert.equal(child!.parentLaneId, root!.id);
  assert.equal(leaf!.parentLaneId, child!.id);
  assert.equal(root!.parentLaneId, undefined);
  assert.deepEqual(model.subagents.map((lane) => lane.subagentRunId), ['root', 'child', 'leaf'], 'in the order they began');
});

test('a lane whose parent has no lane in the run sits under the run and still names the parent', () => {
  const model = project([RUN_STARTED, started('orphan', { parentSubagentRunId: 'ghost' }), finished('orphan'), RUN_FINISHED]);
  assert.deepEqual(kinds(model.entries), ['run', 'subagent']);
  const lane = laneOf(model, 'orphan');
  assert.equal(lane.parentLaneId, undefined);
  assert.equal(lane.parentSubagentRunId, 'ghost');
});

test('events and an end event with no start event make a lane without a start offset', () => {
  const model = project([
    RUN_STARTED,
    inLane('silent', { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }),
    inLane('silent', { type: 'TEXT_MESSAGE_END', messageId: 'm' }),
    finished('only-end'),
    RUN_FINISHED,
  ]);
  const silent = laneOf(model, 'silent');
  assert.equal(silent.startOffsetMs, undefined);
  assert.equal(silent.name, undefined);
  assert.equal(silent.firstOffsetMs, 20);
  assert.deepEqual(kinds(silent.children), ['message']);
  assert.deepEqual(silent.lines, [], 'no lifecycle line: no start was received');
  const onlyEnd = laneOf(model, 'only-end');
  assert.equal(onlyEnd.startOffsetMs, undefined);
  assert.deepEqual(onlyEnd.lines.map((line) => line.phase), ['finished']);
  assert.deepEqual(model.issues, []);
});

test('a lane started inside an open step sits in that step', () => {
  const model = project([RUN_STARTED, { type: 'STEP_STARTED', stepName: 'delegate' }, started('s1'), finished('s1'), { type: 'STEP_FINISHED', stepName: 'delegate' }, RUN_FINISHED]);
  const step = model.entries[1] as StepEntry;
  assert.deepEqual(kinds(step.children), ['subagent']);
});

test('a second start adds a lifecycle line and replaces the name, and events after the end stay in the lane', () => {
  const model = project([
    RUN_STARTED,
    started('s1', { description: 'first' }),
    started('s1', { name: 'renamed', parentToolCallId: 'tc9', parentMessageId: 'pm9' }),
    finished('s1', { result: { ok: true } }),
    inLane('s1', { type: 'CUSTOM', name: 'late', value: 2 }),
    RUN_FINISHED,
  ]);
  const lane = laneOf(model, 's1');
  assert.deepEqual(lane.lines.map((line) => line.phase), ['started', 'started', 'finished']);
  assert.deepEqual([lane.name, lane.description, lane.parentToolCallId, lane.parentMessageId], ['renamed', 'first', 'tc9', 'pm9']);
  assert.equal(lane.startOffsetMs, 20, 'the first start decides');
  assert.deepEqual(kinds(lane.children), ['custom']);
  assert.equal(lane.status, 'finished');
  assert.equal(model.subagents.length, 1);
});

test('frames that are not valid events add nothing to a lane', () => {
  const model = project([RUN_STARTED, started('s1'), 'not json at all', { type: 'NOT_AN_EVENT', subagentRunId: 's1' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never', subagentRunId: 5 }, finished('s1'), RUN_FINISHED]);
  assert.deepEqual(laneOf(model, 's1').children, []);
  assert.deepEqual(model.issues, []);
});

test('whole messages from a run input or a snapshot keep their 0.1.0 place even when they name a subagent', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1', messages: [{ id: 'u1', role: 'user', content: 'from input', subagentRunId: 's1' }] as never } });
  h.push('ex1', RUN_STARTED, 10);
  h.push('ex1', started('s1'), 20);
  h.push('ex1', { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'a1', role: 'assistant', content: 'from snapshot', subagentRunId: 's1' }] }, 30);
  h.push('ex1', finished('s1'), 40);
  h.push('ex1', RUN_FINISHED, 50);
  h.close('ex1');
  const model = projectConversation(h.session());
  const roots = model.entries.filter((entry) => entry.kind === 'message').map((entry) => (entry as MessageEntry).messageId);
  assert.deepEqual(roots, ['a1']);
  assert.deepEqual(laneOf(model, 's1').children, []);
});

// ---- status, offsets and runs ----

test('status follows the latest lifecycle line and falls back to the exchange', () => {
  const run = (events: object[], options: Parameters<typeof project>[1] = {}) => project([RUN_STARTED, ...events], options);

  assert.equal(laneOf(run([started('s'), finished('s'), RUN_FINISHED]), 's').status, 'finished');
  assert.equal(laneOf(run([started('s'), finished('s', { outcome: { type: 'suspended', interruptIds: ['i1', 'i2'] } }), RUN_FINISHED]), 's').status, 'suspended');
  assert.equal(laneOf(run([started('s'), { type: 'SUBAGENT_ERROR', subagentRunId: 's', message: 'boom', code: 'E1' }, RUN_FINISHED]), 's').status, 'error');
  assert.equal(laneOf(run([started('s')], { live: true }), 's').status, 'running', 'a live exchange with no end event');
  assert.equal(laneOf(run([started('s'), RUN_FINISHED], { live: true }), 's').status, 'no-end', 'a live exchange whose run already ended');
  assert.equal(laneOf(run([started('s')], { transport: 'user-stopped' }), 's').status, 'stopped');
  assert.equal(laneOf(run([started('s')]), 's').status, 'no-end', 'a finished exchange with no end event');
  assert.equal(laneOf(run([started('s'), finished('s'), started('s')], { live: true }), 's').status, 'running', 'a start after a finish makes it run again');

  const failed = run([started('s'), { type: 'RUN_ERROR', message: 'run failed' }]);
  assert.equal(laneOf(failed, 's').status, 'no-end', 'a failed run does not invent an outcome for its subagent');
  assert.equal((failed.entries[0] as { status: string }).status, 'error');
});

test('a suspended finish keeps its interrupt ids, an error keeps its message and code', () => {
  const model = project([
    RUN_STARTED,
    started('s'),
    finished('s', { outcome: { type: 'suspended', interruptIds: ['i1', 'i2'] } }),
    started('e'),
    { type: 'SUBAGENT_ERROR', subagentRunId: 'e', message: 'boom', code: 'E1' },
    RUN_FINISHED,
  ]);
  assert.deepEqual(laneOf(model, 's').lines[1], { phase: 'finished', frameId: laneOf(model, 's').lines[1]!.frameId, offsetMs: 30, outcome: 'suspended', interruptIds: ['i1', 'i2'] });
  const error = laneOf(model, 'e').lines[1]!;
  assert.deepEqual([error.phase, error.detail, error.code], ['error', 'boom', 'E1']);
});

test('start, end and first offsets are the offsets of the frames', () => {
  const model = project([
    RUN_STARTED, // 10
    started('s'), // 20
    inLane('s', { type: 'CUSTOM', name: 'x', value: 1 }), // 30
    finished('s'), // 40
    started('open'), // 50
    inLane('open', { type: 'CUSTOM', name: 'y', value: 1 }), // 60
  ], { live: true });
  const s = laneOf(model, 's');
  assert.deepEqual([s.startOffsetMs, s.firstOffsetMs, s.endOffsetMs], [20, 20, 40]);
  const open = laneOf(model, 'open');
  assert.deepEqual([open.startOffsetMs, open.endOffsetMs], [50, 60], 'an open lane ends at the last valid frame of the exchange');
});

test('a later run gets its own lane for the same invocation, marked as a continuation', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  h.push('ex1', RUN_STARTED, 10);
  h.push('ex1', started('s1'), 20);
  h.push('ex1', finished('s1', { outcome: { type: 'suspended' } }), 30);
  h.push('ex1', { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } }, 40);
  h.close('ex1');
  h.open('ex2', { input: { threadId: 't1', runId: 'r2' } });
  h.push('ex2', { type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, 10);
  h.push('ex2', started('s1'), 20);
  h.push('ex2', inLane('s1', { type: 'CUSTOM', name: 'resumed', value: 1 }), 30);
  h.push('ex2', finished('s1'), 40);
  h.push('ex2', { type: 'RUN_FINISHED', threadId: 't1', runId: 'r2', outcome: { type: 'success' } }, 50);
  h.close('ex2');
  const model = projectConversation(h.session());

  assert.deepEqual(model.subagents.map((lane) => [lane.exchangeId, lane.status, lane.continued]), [['ex1', 'suspended', false], ['ex2', 'finished', true]]);
  assert.deepEqual(kinds(model.entries), ['run', 'subagent', 'run', 'subagent']);
  assert.deepEqual(kinds(model.subagents[1]!.children), ['custom']);
  assert.deepEqual(model.subagents[0]!.children, [], 'the later work did not move up into the first run');
});

test('a thread with no subagent frames has no lane', () => {
  const model = project([RUN_STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, { type: 'TEXT_MESSAGE_END', messageId: 'm' }, RUN_FINISHED]);
  assert.deepEqual(model.subagents, []);
  assert.deepEqual(kinds(model.entries), ['run', 'message']);
});

// ---- a messages snapshot ----

test('an open lane keeps its place and its streaming message through a messages snapshot', () => {
  const model = project([
    RUN_STARTED,
    started('s1'),
    inLane('s1', { type: 'TEXT_MESSAGE_START', messageId: 'live', role: 'assistant' }),
    inLane('s1', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'live', delta: 'before ' }),
    inLane('s1', { type: 'CUSTOM', name: 'dropped', value: 1 }),
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] },
    inLane('s1', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'live', delta: 'after' }),
    inLane('s1', { type: 'TEXT_MESSAGE_END', messageId: 'live' }),
    finished('s1'),
    RUN_FINISHED,
  ]);
  assert.deepEqual(model.issues, []);
  const lane = laneOf(model, 's1');
  assert.equal(lane.inTranscript, true);
  assert.deepEqual(kinds(model.entries), ['run', 'snapshot', 'message', 'subagent']);
  assert.deepEqual(kinds(lane.children), ['message'], 'the custom marker went with the replaced transcript');
  assert.equal(textOf(lane.children[0]), 'before after');
});

test('an ended lane leaves the transcript but stays in the list, and a later event puts it back', () => {
  const events = [
    RUN_STARTED,
    started('s1'),
    inLane('s1', { type: 'CUSTOM', name: 'before', value: 1 }),
    finished('s1', { result: 'done' }),
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] },
  ];
  const gone = project(events, { live: true });
  assert.deepEqual(kinds(gone.entries), ['run', 'snapshot', 'message']);
  const lane = laneOf(gone, 's1');
  assert.equal(lane.inTranscript, false);
  assert.equal(lane.status, 'finished', 'the list keeps what happened');
  assert.deepEqual(lane.children, []);

  const back = project([...events, inLane('s1', { type: 'CUSTOM', name: 'after', value: 2 }), RUN_FINISHED]);
  const again = laneOf(back, 's1');
  assert.equal(again.inTranscript, true);
  assert.deepEqual(kinds(back.entries), ['run', 'snapshot', 'message', 'subagent']);
  assert.deepEqual(again.children.map((entry) => (entry as { name?: string }).name), ['after'], 'only the new entry');
  assert.deepEqual(again.lines.map((line) => line.phase), ['started', 'finished'], 'the header keeps its lifecycle');
  assert.deepEqual(back.issues, []);
  assert.equal(back.subagents.length, 1);
});

test('an ended lane with an open lane inside it stays in the transcript', () => {
  const model = project([
    RUN_STARTED,
    started('outer'),
    started('inner', { parentSubagentRunId: 'outer' }),
    finished('outer'),
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] },
    finished('inner'),
    RUN_FINISHED,
  ]);
  const outer = laneOf(model, 'outer');
  assert.equal(outer.inTranscript, true);
  assert.deepEqual(outer.children, [laneOf(model, 'inner')]);
});

test('the lanes of an earlier run leave the transcript with it, and keep their rows', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  h.push('ex1', RUN_STARTED, 10);
  h.push('ex1', started('s1'), 20);
  h.push('ex1', finished('s1'), 30);
  h.push('ex1', { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } }, 40);
  h.close('ex1');
  h.open('ex2', { input: { threadId: 't1', runId: 'r2' } });
  h.push('ex2', { type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, 10);
  h.push('ex2', { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] }, 20);
  h.close('ex2');
  const model = projectConversation(h.session());
  assert.equal(model.subagents.length, 1);
  assert.equal(model.subagents[0]!.inTranscript, false);
  assert.deepEqual(kinds(model.entries), ['run', 'run', 'snapshot', 'message']);
});

// ---- the reference agent's scripted run ----

test('the reference agent answers "subagents" with nested and parallel lanes, one of them failing', () => {
  const reply = interactiveResponse({ threadId: 't1', runId: 'r1', messages: [{ role: 'user', content: SUBAGENTS }] });
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  const decoder = new TextDecoder();
  reply.chunks.forEach((chunk, at) => h.pushWire('ex1', decoder.decode(chunk), (at + 1) * 10));
  h.close('ex1');
  const model = projectConversation(h.session());

  assert.deepEqual(model.issues, []);
  const byName: Record<string, SubagentEntry> = Object.fromEntries(model.subagents.map((lane) => [lane.name, lane]));
  assert.deepEqual(model.subagents.map((lane) => [lane.name, lane.status]), [['researcher', 'finished'], ['writer', 'error'], ['fact-checker', 'finished']]);
  assert.equal(byName['fact-checker']!.parentLaneId, byName['researcher']!.id);
  assert.deepEqual(byName['researcher']!.children.map((entry) => entry.kind), ['message', 'subagent']);
  assert.deepEqual(byName['writer']!.children.map((entry) => entry.kind), ['message']);
  assert.equal(textOf(byName['writer']!.children[0]), 'Drafting the summary. It stops before the end.');
  assert.equal(byName['researcher']!.parentToolCallId, 'tc-research-r1');
  assert.deepEqual(byName['fact-checker']!.children.map((entry) => entry.kind), ['tool']);
  assert.ok(byName['researcher']!.startOffsetMs! < byName['writer']!.endOffsetMs && byName['writer']!.startOffsetMs! < byName['researcher']!.endOffsetMs, 'researcher and writer overlap in time');
});
