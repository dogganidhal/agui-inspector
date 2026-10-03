// L03 T029 (FR-012 to FR-022, constitution VI): one dedicated conversation-mapping case per baseline
// event type, run against the F05 fixtures through the real frame reader and store. Types that only
// belong to inspection map to no conversation entry. A type with no case here fails to compile.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventType } from '@ag-ui/core';
import { eventFixtures } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import type { InspectionSession } from '../../src/contracts.ts';
import {
  projectConversation,
  type ActivityEntry,
  type ConversationEntry,
  type ConversationModel,
  type IssueEntry,
  type MessageEntry,
  type ReasoningEntry,
  type RunEntry,
  type StepEntry,
  type SubagentEntry,
  type ToolCallEntry,
} from '../../src/core/projection/index.ts';
import { harness, RUN_FINISHED, RUN_STARTED, sessionOf, type Harness } from './support.ts';

type Type = keyof typeof EventType;
const fixture = <T extends Type>(type: T) => eventFixtures[type];

function project(events: ReadonlyArray<object | string>, live = false): { model: ConversationModel; session: InspectionSession } {
  const session = sessionOf(events, { live });
  return { model: projectConversation(session), session };
}

/** The first entry of `kind`, anywhere in the tree, typed. */
function find<K extends ConversationEntry['kind']>(entries: readonly ConversationEntry[], kind: K): Extract<ConversationEntry, { kind: K }> {
  for (const entry of entries) {
    if (entry.kind === kind) return entry as Extract<ConversationEntry, { kind: K }>;
    if (entry.kind === 'step') {
      const inner = entry.children.find((child) => child.kind === kind);
      if (inner) return inner as Extract<ConversationEntry, { kind: K }>;
    }
  }
  assert.fail(`no ${kind} entry in ${entries.map((entry) => entry.kind).join(', ')}`);
}
const kinds = (entries: readonly ConversationEntry[]) => entries.map((entry) => entry.kind);
const frameIdAt = (session: InspectionSession, type: string, nth = 0) => session.frames.filter((frame) => frame.eventType === type)[nth]!.id;

const textStart = { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' };
const toolStart = fixture('TOOL_CALL_START');
const reasoningStart = fixture('REASONING_START');
const reasoningMessageStart = fixture('REASONING_MESSAGE_START');

const cases: Record<Type, () => void> = {
  RUN_STARTED() {
    const { model } = project([fixture('RUN_STARTED')], true);
    const run = find(model.entries, 'run');
    assert.equal(run.threadId, 't-proto');
    assert.equal(run.runId, 'r-proto');
    assert.equal(run.status, 'streaming');
    assert.deepEqual(kinds(model.entries), ['run']);
  },
  RUN_FINISHED() {
    const { model } = project([RUN_STARTED, fixture('RUN_FINISHED')]);
    const run = find(model.entries, 'run');
    assert.equal(run.status, 'finished');
    assert.deepEqual(run.result, { summary: 'héllo wörld, 你好 🙂' });
    assert.equal(run.durationMs, 10, 'derived from the two frame offsets');
  },
  RUN_ERROR() {
    const { model } = project([RUN_STARTED, fixture('RUN_ERROR')]);
    const run = find(model.entries, 'run');
    assert.equal(run.status, 'error');
    assert.deepEqual(run.error, { message: 'synthetic failure', code: 'synthetic_error' });
  },
  STEP_STARTED() {
    const { model } = project([RUN_STARTED, fixture('STEP_STARTED'), textStart], true);
    const step = find(model.entries, 'step');
    assert.equal(step.stepName, 'plan');
    assert.equal(step.live, true);
    assert.deepEqual(kinds(step.children), ['message'], 'events inside the step belong to its group');
  },
  STEP_FINISHED() {
    const { model } = project([RUN_STARTED, fixture('STEP_STARTED'), fixture('STEP_FINISHED'), textStart]);
    const step = find(model.entries, 'step');
    assert.equal(step.live, false);
    assert.equal(step.durationMs, 10);
    assert.deepEqual(kinds(model.entries), ['run', 'step', 'message'], 'later events fall outside the finished step');
  },
  TEXT_MESSAGE_START() {
    const { model, session } = project([RUN_STARTED, fixture('TEXT_MESSAGE_START')], true);
    const message = find(model.entries, 'message');
    assert.deepEqual([message.messageId, message.role, message.text, message.live, message.origin, message.fromChunk], ['m1', 'assistant', '', true, 'stream', false]);
    assert.deepEqual(message.frames, [frameIdAt(session, 'TEXT_MESSAGE_START')]);
  },
  TEXT_MESSAGE_CONTENT() {
    const { model, session } = project([RUN_STARTED, textStart, fixture('TEXT_MESSAGE_CONTENT')], true);
    const message = find(model.entries, 'message');
    assert.equal(message.text, 'héllo wörld, 你好 🙂');
    assert.deepEqual(message.deltas.map((delta) => [delta.frameId, delta.offsetMs, delta.text]), [[frameIdAt(session, 'TEXT_MESSAGE_CONTENT'), 30, 'héllo wörld, 你好 🙂']], 'each delta stays inspectable');
  },
  TEXT_MESSAGE_END() {
    const { model } = project([RUN_STARTED, textStart, fixture('TEXT_MESSAGE_END')], true);
    assert.equal(find(model.entries, 'message').live, false);
  },
  TEXT_MESSAGE_CHUNK() {
    const { model, session } = project([RUN_STARTED, fixture('TEXT_MESSAGE_CHUNK'), RUN_FINISHED]);
    const message = find(model.entries, 'message');
    assert.deepEqual([message.messageId, message.role, message.text, message.fromChunk, message.live], ['m2', 'assistant', 'héllo wörld, 你好 🙂', true, false]);
    const chunk = frameIdAt(session, 'TEXT_MESSAGE_CHUNK');
    assert.deepEqual(model.derived.map((entry) => [entry.eventType, entry.derivation, entry.provenance, entry.attribution, entry.sources]), [
      ['TEXT_MESSAGE_START', 'chunk-expansion', 'derived', 'identified', [chunk]],
      ['TEXT_MESSAGE_CONTENT', 'chunk-expansion', 'derived', 'identified', [chunk]],
      ['TEXT_MESSAGE_END', 'chunk-expansion', 'derived', 'ambiguous', [chunk]],
    ]);
    assert.equal(session.frames.filter((frame) => frame.eventType === 'TEXT_MESSAGE_CHUNK').length, 1, 'the original chunk stays in the raw evidence');
  },
  TOOL_CALL_START() {
    const { model } = project([RUN_STARTED, toolStart], true);
    const tool = find(model.entries, 'tool');
    assert.deepEqual([tool.toolCallId, tool.name, tool.parentMessageId, tool.argsText, tool.argsComplete, tool.live], ['tc1', 'search_documents', 'm1', '', false, true]);
  },
  TOOL_CALL_ARGS() {
    const { model } = project([RUN_STARTED, toolStart, fixture('TOOL_CALL_ARGS')], true);
    const tool = find(model.entries, 'tool');
    assert.equal(tool.argsText, '{"query":"synthetic"}', 'raw fragments show while streaming');
    assert.equal(tool.argsParsed, undefined, 'not parsed before the call completes');
    assert.equal(tool.argsDeltas.length, 1);
  },
  TOOL_CALL_END() {
    const { model } = project([RUN_STARTED, toolStart, fixture('TOOL_CALL_ARGS'), fixture('TOOL_CALL_END')], true);
    const tool = find(model.entries, 'tool');
    assert.deepEqual(tool.argsParsed, { query: 'synthetic' });
    assert.equal(tool.argsComplete, true);
    assert.equal(tool.live, false);
  },
  TOOL_CALL_CHUNK() {
    const { model, session } = project([RUN_STARTED, fixture('TOOL_CALL_CHUNK'), RUN_FINISHED]);
    const tool = find(model.entries, 'tool');
    assert.deepEqual([tool.toolCallId, tool.name, tool.fromChunk, tool.argsText], ['tc2', 'fetch_resource', true, '{"resource":"synthetic"}']);
    assert.deepEqual(tool.argsParsed, { resource: 'synthetic' });
    const chunk = frameIdAt(session, 'TOOL_CALL_CHUNK');
    assert.deepEqual(model.derived.map((entry) => [entry.eventType, entry.attribution, entry.sources]), [
      ['TOOL_CALL_START', 'identified', [chunk]],
      ['TOOL_CALL_ARGS', 'identified', [chunk]],
      ['TOOL_CALL_END', 'ambiguous', [chunk]],
    ]);
  },
  TOOL_CALL_RESULT() {
    const { model } = project([RUN_STARTED, toolStart, fixture('TOOL_CALL_ARGS'), fixture('TOOL_CALL_END'), fixture('TOOL_CALL_RESULT')]);
    const tool = find(model.entries, 'tool');
    assert.deepEqual(tool.result, { content: 'synthetic result', messageId: 'tm1', origin: 'stream' });
    assert.equal(tool.side, 'server');
  },
  REASONING_START() {
    const { model } = project([RUN_STARTED, fixture('REASONING_START')], true);
    const reasoning = find(model.entries, 'reasoning');
    assert.deepEqual([reasoning.messageId, reasoning.text, reasoning.live], ['rs1', '', true]);
  },
  REASONING_MESSAGE_START() {
    const { model } = project([RUN_STARTED, reasoningStart, fixture('REASONING_MESSAGE_START')], true);
    const reasoning = find(model.entries, 'reasoning');
    assert.equal(reasoning.messageId, 'rs1');
    assert.deepEqual(kinds(model.entries), ['run', 'reasoning'], 'the start of the message and of the phase share one entry');
  },
  REASONING_MESSAGE_CONTENT() {
    const { model } = project([RUN_STARTED, reasoningStart, reasoningMessageStart, fixture('REASONING_MESSAGE_CONTENT')], true);
    const reasoning = find(model.entries, 'reasoning');
    assert.equal(reasoning.text, 'héllo wörld, 你好 🙂');
    assert.equal(reasoning.deltas.length, 1);
  },
  REASONING_MESSAGE_END() {
    const { model } = project([RUN_STARTED, reasoningStart, reasoningMessageStart, fixture('REASONING_MESSAGE_END')], true);
    const reasoning = find(model.entries, 'reasoning');
    assert.equal(reasoning.live, true, 'the phase is still open until REASONING_END');
  },
  REASONING_MESSAGE_CHUNK() {
    const { model, session } = project([RUN_STARTED, fixture('REASONING_MESSAGE_CHUNK'), RUN_FINISHED]);
    const reasoning = find(model.entries, 'reasoning') as ReasoningEntry;
    assert.deepEqual([reasoning.messageId, reasoning.text, reasoning.fromChunk, reasoning.live], ['rs2', 'héllo wörld, 你好 🙂', true, false]);
    const chunk = frameIdAt(session, 'REASONING_MESSAGE_CHUNK');
    assert.deepEqual(model.derived.map((entry) => [entry.eventType, entry.attribution, entry.sources]), [
      ['REASONING_MESSAGE_START', 'identified', [chunk]],
      ['REASONING_MESSAGE_CONTENT', 'identified', [chunk]],
      ['REASONING_MESSAGE_END', 'ambiguous', [chunk]],
    ]);
  },
  REASONING_END() {
    const { model } = project([RUN_STARTED, reasoningStart, reasoningMessageStart, fixture('REASONING_MESSAGE_END'), fixture('REASONING_END')], true);
    assert.equal(find(model.entries, 'reasoning').live, false);
  },
  REASONING_ENCRYPTED_VALUE() {
    const { model, session } = project([RUN_STARTED, reasoningStart, fixture('REASONING_ENCRYPTED_VALUE')]);
    const encrypted = find(model.entries, 'encrypted');
    assert.deepEqual([encrypted.subtype, encrypted.entityId, encrypted.size], ['message', 'rs1', 24]);
    assert.deepEqual(encrypted.frames, [frameIdAt(session, 'REASONING_ENCRYPTED_VALUE')]);
    assert.equal(JSON.stringify(model).includes(fixture('REASONING_ENCRYPTED_VALUE').encryptedValue), false, 'the opaque value never enters the conversation model');
  },
  STATE_SNAPSHOT() {
    const { model, session } = project([RUN_STARTED, fixture('STATE_SNAPSHOT')]);
    assert.deepEqual(kinds(model.entries), ['run'], 'inspection only: no conversation entry');
    assert.deepEqual(model.state.current, { round: 0, items: ['a'] });
    assert.deepEqual(model.state.changes.map((change) => [change.type, change.frameId, change.applied]), [['STATE_SNAPSHOT', frameIdAt(session, 'STATE_SNAPSHOT'), true]]);
  },
  STATE_DELTA() {
    const { model } = project([RUN_STARTED, fixture('STATE_SNAPSHOT'), fixture('STATE_DELTA')]);
    assert.deepEqual(kinds(model.entries), ['run'], 'inspection only: no conversation entry');
    assert.deepEqual(model.state.current, { round: 1, items: ['a'] });
    assert.deepEqual(model.state.changes[0]?.operations, [{ op: 'add', path: '/round', value: 1 }]);
  },
  MESSAGES_SNAPSHOT() {
    const { model } = project([RUN_STARTED, textStart, { type: 'TEXT_MESSAGE_END', messageId: 'm1' }, fixture('MESSAGES_SNAPSHOT')]);
    assert.deepEqual(kinds(model.entries), ['run', 'snapshot', 'message', 'message'], 'the snapshot replaces what came before it');
    const marker = find(model.entries, 'snapshot');
    assert.deepEqual(marker.added.map((message) => message.id), ['u1', 'a1']);
    assert.deepEqual(marker.removed.map((message) => message.id), ['m1']);
    const messages = model.entries.filter((entry): entry is MessageEntry => entry.kind === 'message');
    assert.deepEqual(messages.map((message) => [message.messageId, message.role, message.text, message.origin]), [
      ['u1', 'user', 'Synthetic request', 'snapshot'],
      ['a1', 'assistant', 'héllo wörld, 你好 🙂', 'snapshot'],
    ]);
  },
  ACTIVITY_SNAPSHOT() {
    const { model } = project([RUN_STARTED, fixture('ACTIVITY_SNAPSHOT')]);
    const activity = find(model.entries, 'activity') as ActivityEntry;
    assert.deepEqual([activity.messageId, activity.activityType, activity.content], ['act1', 'synthetic-progress', { title: 'Synthetic' }]);
  },
  ACTIVITY_DELTA() {
    const { model } = project([RUN_STARTED, fixture('ACTIVITY_SNAPSHOT'), fixture('ACTIVITY_DELTA')]);
    const activity = find(model.entries, 'activity');
    assert.deepEqual(activity.content, { title: 'Synthetic', revision: 1 });
    assert.equal(activity.patches, 1);
    assert.deepEqual(kinds(model.entries), ['run', 'activity'], 'a delta updates its card, it adds none');
  },
  SUBAGENT_STARTED() {
    const { model } = project([RUN_STARTED, fixture('SUBAGENT_STARTED')], true);
    const subagent = find(model.entries, 'subagent');
    assert.deepEqual([subagent.subagentRunId, subagent.name, subagent.description, subagent.parentToolCallId, subagent.parentRunId], ['sub1', 'synthetic-researcher', 'Synthetic delegated task', 'tc1', 'r1']);
    assert.deepEqual(subagent.lines.map((line) => line.phase), ['started']);
  },
  SUBAGENT_FINISHED() {
    const { model } = project([RUN_STARTED, fixture('SUBAGENT_STARTED'), fixture('SUBAGENT_FINISHED')], true);
    const subagent = find(model.entries, 'subagent');
    assert.deepEqual(subagent.lines.map((line) => line.phase), ['started', 'finished']);
    assert.deepEqual([subagent.lines[1]?.detail, subagent.lines[1]?.outcome], ['{"summary":"done"}', 'success']);
    assert.equal(model.entries.filter((entry) => entry.kind === 'subagent').length, 1, 'start and finish share one nested marker');
  },
  SUBAGENT_ERROR() {
    const { model } = project([RUN_STARTED, fixture('SUBAGENT_ERROR')], true);
    const subagent = find(model.entries, 'subagent');
    assert.equal(subagent.subagentRunId, 'sub2');
    assert.deepEqual(subagent.lines.map((line) => [line.phase, line.detail]), [['error', 'synthetic subagent failure']]);
  },
  CUSTOM() {
    const { model } = project([RUN_STARTED, fixture('CUSTOM')]);
    const custom = find(model.entries, 'custom');
    assert.deepEqual([custom.name, custom.value], ['synthetic.custom', { note: 'custom' }]);
  },
  RAW() {
    const { model } = project([RUN_STARTED, fixture('RAW')]);
    const raw = find(model.entries, 'raw');
    assert.deepEqual([raw.source, raw.value], ['synthetic', { provider: 'synthetic' }]);
  },
};

test('the cases cover exactly the 31 upstream event types', () => {
  assert.deepEqual(Object.keys(cases).sort(), Object.values(EventType).sort());
  assert.equal(Object.keys(cases).length, 31);
});

for (const type of Object.values(EventType)) {
  test(`event type ${type}: conversation mapping`, () => cases[type]());
}

// ---- how the families combine ----------------------------------------------------------------------

test('interleaved messages keep the received order and their own text', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'a', role: 'assistant' },
    { type: 'TEXT_MESSAGE_START', messageId: 'b', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'one ' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'b', delta: 'two ' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'three' },
    { type: 'TEXT_MESSAGE_END', messageId: 'a' },
  ], true);
  const [a, b] = model.entries.filter((entry): entry is MessageEntry => entry.kind === 'message');
  assert.deepEqual([a?.messageId, a?.text, a?.live], ['a', 'one three', false]);
  assert.deepEqual([b?.messageId, b?.text, b?.live], ['b', 'two ', true]);
  assert.deepEqual(a?.deltas.map((delta) => delta.text), ['one ', 'three']);
});

test('a tool call streams its arguments, completes with parsed arguments and shows its result', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'lookup' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{"a":' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '1}' },
    { type: 'TOOL_CALL_END', toolCallId: 'c' },
    { type: 'TOOL_CALL_RESULT', messageId: 'tm', toolCallId: 'c', content: '{"ok":true}' },
  ]);
  const tool = find(model.entries, 'tool') as ToolCallEntry;
  assert.equal(tool.argsText, '{"a":1}');
  assert.deepEqual(tool.argsParsed, { a: 1 });
  assert.equal(tool.argsDeltas.length, 2);
  assert.equal(tool.result?.content, '{"ok":true}');
});

test('malformed complete arguments stay inspectable as an error, not a dropped call', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'lookup' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{"a":' },
    { type: 'TOOL_CALL_END', toolCallId: 'c' },
  ]);
  const tool = find(model.entries, 'tool');
  assert.equal(tool.argsText, '{"a":');
  assert.equal(tool.argsParsed, undefined);
  assert.match(tool.argsError ?? '', /JSON/);
});

test('a run that succeeds with pending tool calls names them, and marks those calls as client tools', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'pick_color' },
    { type: 'TOOL_CALL_END', toolCallId: 'c' },
    { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success', pendingToolCallIds: ['c'] } },
  ]);
  const run = find(model.entries, 'run') as RunEntry;
  assert.deepEqual(run.pendingToolCallIds, ['c']);
  const tool = find(model.entries, 'tool') as ToolCallEntry;
  assert.deepEqual([tool.pending, tool.side], [true, 'client']);
});

test('interrupt and cancelled outcomes are distinct run outcomes', () => {
  const interrupt = { id: 'i1', reason: 'approval', message: 'Approve?' };
  const interrupted = find(project([RUN_STARTED, { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'interrupt', interrupts: [interrupt] } }]).model.entries, 'run');
  assert.equal(interrupted.status, 'interrupted');
  assert.deepEqual(interrupted.interrupts, [interrupt]);
  const cancelled = find(project([RUN_STARTED, { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'cancelled' } }]).model.entries, 'run');
  assert.equal(cancelled.status, 'cancelled');
});

test('a parent run id is carried to the header and to nested subagent markers', () => {
  const { model } = project([
    { type: 'RUN_STARTED', threadId: 't1', runId: 'r2', parentRunId: 'r1' },
    { type: 'SUBAGENT_STARTED', subagentRunId: 's', name: 'helper' },
  ], true);
  assert.equal(find(model.entries, 'run').parentRunId, 'r1');
  assert.equal(find(model.entries, 'subagent').parentRunId, 'r2');
});

test('a user stop is transport status: no outcome is invented and no terminal frame appears', () => {
  const { model, session } = project([RUN_STARTED, textStart], false);
  const stopped = projectConversation(sessionOf([RUN_STARTED, textStart], { transport: 'user-stopped' }));
  assert.equal(find(stopped.entries, 'run').status, 'stopped');
  assert.equal(find(model.entries, 'run').status, 'no-terminal', 'a stream that ends quietly has no observed outcome');
  assert.equal(session.frames.some((frame) => frame.eventType === 'RUN_ERROR' || frame.eventType === 'RUN_FINISHED'), false);
});

test('conversation text is data: markup and markdown stay literal characters', () => {
  const html = '<img src=x onerror=alert(1)> **bold** [link](http://example.test) `code`';
  const { model } = project([RUN_STARTED, textStart, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: html }]);
  assert.equal(find(model.entries, 'message').text, html);
});

test('frames that are not valid events never become conversation entries', () => {
  const { model } = project([RUN_STARTED, 'not json', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 7 }, { type: 'SYNTHETIC_FUTURE_EVENT' }, RUN_FINISHED]);
  assert.deepEqual(kinds(model.entries), ['run']);
  assert.equal(find(model.entries, 'run').status, 'finished', 'validation findings are separate from the stream');
});

test('an event for an entity that was never started is reported, not invented', () => {
  const { model, session } = project([RUN_STARTED, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ghost', delta: 'x' }, { type: 'TOOL_CALL_ARGS', toolCallId: 'ghost', delta: '{}' }, RUN_FINISHED]);
  assert.deepEqual(kinds(model.entries), ['run', 'issue', 'issue'], 'each issue sits in the run, after the frames before it');
  assert.deepEqual(model.issues.map((issue) => issue.frameId), [frameIdAt(session, 'TEXT_MESSAGE_CONTENT'), frameIdAt(session, 'TOOL_CALL_ARGS')]);
  assert.deepEqual(model.entries.slice(1), model.issues, 'the list and the entries hold the same issues');
});

/** One run on thread `t1`, with `events` at 10 ms steps; a run that sends `messages` carries them as its input. */
function play(h: Harness, id: string, events: ReadonlyArray<object | string>, input: object = {}, thread = 't1') {
  h.open(id, { input: { threadId: thread, runId: id, ...input } });
  events.forEach((event, i) => h.push(id, event, (i + 1) * 10));
  h.close(id);
}
const began = (runId: string, threadId = 't1') => ({ type: 'RUN_STARTED', threadId, runId });
const ended = (runId: string) => ({ type: 'RUN_FINISHED', threadId: 't1', runId, outcome: { type: 'success' } });
const ghost = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 'no start event' };
const reply = (id: string) => [{ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: 'hi' }, { type: 'TEXT_MESSAGE_END', messageId: id }];
const outline = (entries: readonly ConversationEntry[]) => entries.map((entry) => (entry.kind === 'run' ? `run:${entry.runId}` : entry.kind === 'issue' ? `issue:${(entry as IssueEntry).frameId}` : entry.kind));

test('an issue stays in the run that produced it, at the place of its frame, however many runs follow', () => {
  const h = harness();
  play(h, 'r1', [began('r1'), ghost, 'not json at all', { type: 'STEP_STARTED', stepName: 'after the damage' }, { type: 'STEP_FINISHED', stepName: 'after the damage' }, ended('r1')]);
  play(h, 'r2', [began('r2'), ...reply('m2'), ended('r2')], { messages: [{ id: 'u2', role: 'user', content: 'Hello there' }] });
  const ghostFrame = frameIdAt(h.session(), 'TEXT_MESSAGE_CONTENT');
  assert.deepEqual(outline(projectConversation(h.session()).entries), ['run:r1', `issue:${ghostFrame}`, 'step', 'run:r2', 'message', 'message']);

  play(h, 'r3', [began('r3'), ended('r3')]);
  assert.deepEqual(outline(projectConversation(h.session()).entries), ['run:r1', `issue:${ghostFrame}`, 'step', 'run:r2', 'message', 'message', 'run:r3'], 'a later run does not move it');
});

test('an issue on the last frame of a run falls at the end of that run, before the next run', () => {
  const h = harness();
  play(h, 'r1', [began('r1'), ...reply('m1'), ghost]);
  play(h, 'r2', [began('r2'), ended('r2')]);
  const ghostFrame = frameIdAt(h.session(), 'TEXT_MESSAGE_CONTENT', 1);
  assert.deepEqual(outline(projectConversation(h.session()).entries), ['run:r1', 'message', `issue:${ghostFrame}`, 'run:r2']);
});

test('an issue inside an open step stays in that step', () => {
  const { model } = project([RUN_STARTED, { type: 'STEP_STARTED', stepName: 'work' }, ghost, { type: 'STEP_FINISHED', stepName: 'work' }, RUN_FINISHED]);
  assert.deepEqual(kinds(model.entries), ['run', 'step']);
  assert.deepEqual(kinds(find(model.entries, 'step').children), ['issue']);
  assert.equal(model.issues.length, 1);
});

test('issues stay with their runs through a messages snapshot, which replaces the messages and nothing else', () => {
  const h = harness();
  play(h, 'r1', [began('r1'), { type: 'STEP_STARTED', stepName: 'work' }, ghost, { type: 'STEP_FINISHED', stepName: 'work' }, ended('r1')]);
  play(h, 'r2', [began('r2'), { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] }, ghost, ended('r2')]);
  const [first, second] = h.session().frames.filter((frame) => frame.eventType === 'TEXT_MESSAGE_CONTENT');
  assert.deepEqual(outline(projectConversation(h.session()).entries), ['run:r1', `issue:${first!.id}`, 'run:r2', 'snapshot', 'message', `issue:${second!.id}`]);
});

test('issues of a run on another thread are hidden with that run', () => {
  const h = harness();
  play(h, 'r1', [began('r1', 'old'), ghost, ended('r1')], {}, 'old');
  assert.deepEqual(outline(projectConversation(h.session(), 'old').entries).map((item) => item.split(':')[0]), ['run', 'issue']);
  const fresh = projectConversation(h.session(), 'fresh');
  assert.deepEqual([fresh.entries, fresh.issues], [[], []]);
});

test('a step nests what happens inside it, including nested steps, and reports its duration', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'STEP_STARTED', stepName: 'outer' },
    { type: 'STEP_STARTED', stepName: 'inner' },
    { type: 'CUSTOM', name: 'x', value: 1 },
    { type: 'STEP_FINISHED', stepName: 'inner' },
    { type: 'STEP_FINISHED', stepName: 'outer' },
  ]);
  const outer = find(model.entries, 'step') as StepEntry;
  assert.equal(outer.stepName, 'outer');
  assert.equal(outer.durationMs, 40);
  const inner = outer.children[0] as StepEntry;
  assert.deepEqual([inner.stepName, inner.durationMs, kinds(inner.children)], ['inner', 20, ['custom']]);
});

test('a chunk stream is closed by the next explicit event of its lane, and not by raw or activity events', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'TEXT_MESSAGE_CHUNK', messageId: 'c1', delta: 'a' },
    { type: 'RAW', event: { unrelated: true } },
    { type: 'TEXT_MESSAGE_CHUNK', delta: 'b' },
    { type: 'TEXT_MESSAGE_CHUNK', messageId: 'c2', delta: 'x' },
  ], true);
  const messages = model.entries.filter((entry): entry is MessageEntry => entry.kind === 'message');
  assert.deepEqual(messages.map((message) => [message.messageId, message.text, message.live]), [['c1', 'ab', false], ['c2', 'x', true]]);
  assert.equal(model.derived.filter((entry) => entry.eventType === 'TEXT_MESSAGE_START').length, 2, 'a continuation chunk adds no second start');
});

test('derived entries have stable ids, so publishing them twice appends nothing new', () => {
  const events = [RUN_STARTED, fixture('TEXT_MESSAGE_CHUNK'), RUN_FINISHED];
  const first = project(events).model.derived.map((entry) => entry.id);
  const second = project(events).model.derived.map((entry) => entry.id);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
});

test('preparation and raw exchanges are outside the conversation', () => {
  const session = sessionOf([RUN_STARTED, textStart], { kind: 'raw' });
  assert.deepEqual(projectConversation(session).entries, []);
});

test('what is still arriving survives a messages snapshot: a streaming message, an open step and an open subagent', () => {
  const { model } = project([
    RUN_STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'done', role: 'assistant' },
    { type: 'TEXT_MESSAGE_END', messageId: 'done' },
    { type: 'STEP_STARTED', stepName: 'open-step' },
    { type: 'TEXT_MESSAGE_START', messageId: 'live', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'live', delta: 'before ' },
    { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'helper' },
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'live', delta: 'after' },
    { type: 'SUBAGENT_FINISHED', subagentRunId: 's1' },
    { type: 'STEP_FINISHED', stepName: 'open-step' },
    { type: 'TEXT_MESSAGE_END', messageId: 'live' },
  ]);
  assert.deepEqual(model.issues, [], 'later events still find what they belong to');
  assert.deepEqual(kinds(model.entries), ['run', 'snapshot', 'message', 'step']);
  const step = find(model.entries, 'step');
  assert.equal(step.live, false);
  assert.deepEqual(step.children.map((child) => child.kind), ['message', 'subagent'], 'the open step keeps what was still arriving inside it');
  assert.equal((step.children[0] as MessageEntry).text, 'before after');
  assert.deepEqual((step.children[1] as SubagentEntry).lines.map((line) => line.phase), ['started', 'finished']);
  const marker = find(model.entries, 'snapshot');
  assert.deepEqual(marker.removed.map((message) => message.id), ['done'], 'only the finished message counts as replaced');
});
