// Spec 013 (FR-008, US1.6): decoded protobuf frames feed the conversation, state, interrupt and tool views as
// server-sent-events frames do, so the same events give the same conversation whichever encoding carried them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baselineRunTypes, eventFixtures } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { frameProtobuf } from '../../../../examples/reference-agent/protobuf.ts';
import type { InspectionSession } from '../../src/contracts.ts';
import { createProtobufFrameReader } from '../../src/core/frames/index.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { sessionOf } from './support.ts';

/** The same shape as `sessionOf`: one closed conversation exchange with the events 10 ms apart. */
function protobufSessionOf(events: readonly object[]): InspectionSession {
  const store = createSessionStore({ schedule: (callback) => callback() });
  store.appendExchange({ id: 'ex1', kind: 'conversation', method: 'POST', path: '/agent', startedAt: 1_700_000_000_000, transport: 'streaming', encoding: 'protobuf', frameIds: [] });
  const reader = createProtobufFrameReader(store, 'ex1');
  events.forEach((event, at) => reader.push(frameProtobuf(event), (at + 1) * 10));
  reader.end();
  store.updateExchange('ex1', { transport: 'completed', elapsedMs: (events.length + 1) * 10 });
  return store.snapshot();
}

const baseline = baselineRunTypes.map((type) => eventFixtures[type as keyof typeof eventFixtures]);

test('the baseline run gives the same conversation over protobuf as over server-sent events', () => {
  const text = projectConversation(sessionOf(baseline));
  const binary = projectConversation(protobufSessionOf(baseline));
  assert.ok(new Set(text.entries.map((entry) => entry.kind)).size >= 4, 'the baseline run projects to runs, messages, steps and snapshots');
  assert.ok(text.derived.length > 0, 'chunk expansions are derived from decoded chunk frames too');
  assert.deepEqual(binary, text);
});

test('messages, state, interrupts and tool calls come out of decoded frames', () => {
  const events = [
    { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'héllo\r\nwörld 🙂' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'pick_color' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"choices":["red"]}' },
    { type: 'TOOL_CALL_END', toolCallId: 'c1' },
    { type: 'STATE_SNAPSHOT', snapshot: { counter: 1 } },
    { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/counter', value: 2 }] },
    { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval', message: 'Approve?' }] } },
  ];
  const model = projectConversation(protobufSessionOf(events));
  const kinds = model.entries.map((entry) => entry.kind);
  for (const kind of ['run', 'message', 'tool']) assert.ok(kinds.includes(kind as never), `${kind} is projected`);
  assert.deepEqual(model, projectConversation(sessionOf(events)));
  const message = model.entries.find((entry) => entry.kind === 'message');
  assert.ok(message && 'text' in message && String(message.text).includes('héllo\r\nwörld 🙂'), 'text with multibyte characters and CRLF arrives unchanged');
});
