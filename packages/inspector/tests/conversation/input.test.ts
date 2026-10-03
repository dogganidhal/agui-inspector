// L03 T030/T031: what a run's recorded input adds to the transcript (FR-013, FR-014): the user's turn,
// results the user entered for pending tool calls, what the run carried, and the new-thread boundary.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectConversation, type MessageEntry, type RunEntry, type ToolCallEntry } from '../../src/core/projection/index.ts';
import { harness } from './support.ts';

const started = (runId: string, threadId = 't1') => ({ type: 'RUN_STARTED', threadId, runId });
const finished = (runId: string, outcome: object = { type: 'success' }) => ({ type: 'RUN_FINISHED', threadId: 't1', runId, outcome });

test('every role is shown as its own entry, in the order of the input, ahead of what the agent streams', () => {
  const h = harness();
  h.open('ex1', {
    input: {
      threadId: 't1',
      runId: 'r1',
      messages: [
        { id: 's', role: 'system', content: 'be brief' },
        { id: 'd', role: 'developer', content: 'internal note' },
        { id: 'u', role: 'user', content: 'hello' },
      ],
    },
  });
  h.push('ex1', started('r1'), 10);
  h.push('ex1', { type: 'TEXT_MESSAGE_START', messageId: 'a', role: 'assistant' }, 20);
  h.close('ex1');
  const { entries } = projectConversation(h.session());
  assert.deepEqual(entries.map((entry) => (entry.kind === 'message' ? `${entry.role}:${entry.origin}` : entry.kind)), ['run', 'system:input', 'developer:input', 'user:input', 'assistant:stream']);
});

test('a full-transcript input repeats earlier messages, which are shown once', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1', messages: [{ id: 'u1', role: 'user', content: 'first' }] } });
  h.push('ex1', started('r1'), 10);
  h.push('ex1', { type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }, 20);
  h.push('ex1', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'reply' }, 30);
  h.push('ex1', { type: 'TEXT_MESSAGE_END', messageId: 'a1' }, 40);
  h.push('ex1', finished('r1'), 50);
  h.close('ex1');
  h.open('ex2', {
    input: { threadId: 't1', runId: 'r2', messages: [{ id: 'u1', role: 'user', content: 'first' }, { id: 'a1', role: 'assistant', content: 'reply' }, { id: 'u2', role: 'user', content: 'second' }] },
  });
  h.push('ex2', started('r2'), 10);
  h.close('ex2');
  const messages = projectConversation(h.session()).entries.filter((entry): entry is MessageEntry => entry.kind === 'message');
  assert.deepEqual(messages.map((message) => [message.messageId, message.text]), [['u1', 'first'], ['a1', 'reply'], ['u2', 'second']]);
});

test('a result the user entered for a pending call joins that call, and names the run that carried it', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  for (const [i, event] of [started('r1'), { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'pick_color' }, { type: 'TOOL_CALL_END', toolCallId: 'c1' }, finished('r1', { type: 'success', pendingToolCallIds: ['c1'] })].entries()) h.push('ex1', event, (i + 1) * 10);
  h.close('ex1');
  let tool = projectConversation(h.session()).entries.find((entry): entry is ToolCallEntry => entry.kind === 'tool');
  assert.deepEqual([tool?.pending, tool?.side, tool?.result], [true, 'client', undefined]);

  h.open('ex2', { input: { threadId: 't1', runId: 'r2', messages: [{ id: 'tr1', role: 'tool', toolCallId: 'c1', content: '"teal"' }] } });
  h.push('ex2', started('r2'), 10);
  h.close('ex2');
  const model = projectConversation(h.session());
  tool = model.entries.find((entry): entry is ToolCallEntry => entry.kind === 'tool');
  assert.deepEqual(tool?.result, { content: '"teal"', messageId: 'tr1', origin: 'entered', carriedBy: 'r2' });
  assert.deepEqual([tool?.pending, tool?.side], [false, 'client']);
  assert.deepEqual((model.entries.filter((entry): entry is RunEntry => entry.kind === 'run')[1] as RunEntry).carried, ['tool result · c1']);
  assert.equal(model.entries.filter((entry) => entry.kind === 'tool').length, 1, 'no second card for the same call');
});

test('a run names what its input carried: resume answers and an A2UI action', () => {
  const h = harness();
  h.open('ex1', {
    input: {
      threadId: 't1',
      runId: 'r1',
      resume: [{ interruptId: 'i1', status: 'resolved', payload: { ok: true } }, { interruptId: 'i2', status: 'cancelled' }],
      forwardedProps: { a2uiAction: { userAction: { name: 'approve', surfaceId: 's', sourceComponentId: 'b', context: {}, timestamp: '2026-10-02T00:00:00Z' } } },
    },
  });
  h.push('ex1', started('r1'), 10);
  const run = projectConversation(h.session()).entries[0] as RunEntry;
  assert.deepEqual(run.carried, ['resume · 2 answers', 'a2uiAction · approve']);
});

test('starting a new thread clears the conversation, and the earlier exchanges stay in the session', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 'old', runId: 'r1', messages: [{ id: 'u1', role: 'user', content: 'old thread' }] } });
  h.push('ex1', started('r1', 'old'), 10);
  h.close('ex1');
  h.open('ex2', { input: { threadId: 'new', runId: 'r2', messages: [{ id: 'u2', role: 'user', content: 'new thread' }] } });
  h.push('ex2', started('r2', 'new'), 10);
  const model = projectConversation(h.session());
  assert.equal(model.threadId, 'new');
  assert.deepEqual(model.entries.filter((entry): entry is MessageEntry => entry.kind === 'message').map((message) => message.text), ['new thread']);
  assert.equal(h.session().exchanges.length, 2);
});

test('a thread named by the caller is shown at once, even before any exchange of it exists, and the earlier thread stays reachable', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 'old', runId: 'r1', messages: [{ id: 'u1', role: 'user', content: 'old thread' }] } });
  h.push('ex1', started('r1', 'old'), 10);
  h.push('ex1', { type: 'STATE_SNAPSHOT', snapshot: { old: true } }, 20);
  h.close('ex1');
  const fresh = projectConversation(h.session(), 'fresh');
  assert.deepEqual([fresh.threadId, fresh.entries, fresh.state.current, fresh.state.changes, fresh.derived, fresh.issues], ['fresh', [], undefined, [], [], []]);
  assert.equal(h.session().exchanges.length, 1, 'the retained exchange is untouched');
  assert.deepEqual(projectConversation(h.session(), 'old').entries.filter((entry) => entry.kind === 'message').length, 1);
  assert.equal(projectConversation(h.session()).threadId, 'old', 'without a named thread the latest recorded one shows, as for an imported recording');
});

test('an exchange with no frames yet shows its run as streaming, and a failed connection says so without an outcome', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' }, transport: 'sending' });
  assert.equal((projectConversation(h.session()).entries[0] as RunEntry).status, 'streaming');
  h.store.updateExchange('ex1', { transport: 'transport-error', transportError: 'Failed to fetch (CORS)' });
  const run = projectConversation(h.session()).entries[0] as RunEntry;
  assert.deepEqual([run.status, run.transportError], ['no-terminal', 'Failed to fetch (CORS)']);
});

test('non-text content parts are counted, not inlined', () => {
  const h = harness();
  h.open('ex1', {
    input: { threadId: 't1', runId: 'r1', messages: [{ id: 'u', role: 'user', content: [{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'url', value: 'https://example.test/x.png' } }] }] },
  });
  const message = projectConversation(h.session()).entries.find((entry): entry is MessageEntry => entry.kind === 'message');
  assert.deepEqual([message?.text, message?.extraParts], ['look', 1]);
});
