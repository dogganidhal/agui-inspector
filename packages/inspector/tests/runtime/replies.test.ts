// L02 T027 (US3.1 to US3.4, FR-023 to FR-025): interrupt Resolve/Cancel and manual tool results are
// barriers. The next run starts only when every one has an answer, carries the upstream resume entries
// or tool messages, and its recorded input shows them. A surface action starts its own run with the
// documented envelope. Nothing here is answered, scripted or fabricated on the user's behalf.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interrupt } from '@ag-ui/core';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import type { A2uiAction, JsonObject, ObservedOutcome } from '../../src/contracts.ts';
import {
  AUTOMATIC_REPLY_LIMIT,
  NO_REPLIES,
  answerInterrupt,
  automate,
  automaticReplies,
  checkA2uiAction,
  draftInterrupt,
  draftToolResult,
  isBlocked,
  remaining,
  repliesFor,
  resumeEntries,
  submitToolResult,
  toolMessages,
  waitingNotice,
} from '../../src/core/runtime/replies.ts';
import { checkAgainstSchema, seedFromSchema } from '../../src/core/runtime/schema.ts';
import { AGENT, bodyOf, eventStream, ok200, replyRoute, rig, sse, type Route } from './support.ts';

// ---------------------------------------------------------------------------------------------
// Prefilling and checking an answer
// ---------------------------------------------------------------------------------------------

test('an answer is prefilled from the response schema: defaults first, then the empty value of each type', () => {
  assert.deepEqual(seedFromSchema(undefined), {});
  assert.deepEqual(
    seedFromSchema({
      type: 'object',
      properties: {
        approved: { type: 'boolean' },
        note: { type: 'string' },
        amount: { type: 'number', default: 25 },
        count: { type: 'integer' },
        mode: { enum: ['fast', 'slow'] },
        kind: { const: 'refund' },
        tags: { type: 'array', items: { type: 'string' } },
        nested: { type: 'object', properties: { who: { type: 'string' } } },
        either: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        nothing: { type: 'null' },
        free: {},
      },
    }),
    { approved: false, note: '', amount: 25, count: 0, mode: 'fast', kind: 'refund', tags: [], nested: { who: '' }, either: '', nothing: null, free: null },
  );
  assert.deepEqual(seedFromSchema({ type: 'string' }), '');
  assert.deepEqual(seedFromSchema({ type: ['null', 'integer'] }), 0);
  assert.deepEqual(seedFromSchema({ properties: { a: { type: 'boolean' } } }), { a: false });
});

test('a schema that nests without end does not hang the prefill', () => {
  const schema: Record<string, unknown> = { type: 'object' };
  schema.properties = { again: schema };
  assert.doesNotThrow(() => seedFromSchema(schema as JsonObject));
});

test('an answer that misses its schema gets a message that says what is required, and a matching one gets none', () => {
  const schema = {
    type: 'object',
    required: ['approved'],
    properties: { approved: { type: 'boolean' }, amount: { type: 'integer' }, mode: { enum: ['fast', 'slow'] }, tags: { type: 'array', items: { type: 'string' } } },
  };
  assert.equal(checkAgainstSchema({ approved: true, amount: 3, mode: 'fast', tags: ['a'] }, schema), undefined);
  assert.match(checkAgainstSchema({ approved: 'yes' }, schema) ?? '', /approved must be true or false\. The interrupt's response schema requires it\./);
  assert.match(checkAgainstSchema({}, schema) ?? '', /approved is required/);
  assert.match(checkAgainstSchema({ approved: true, amount: 1.5 }, schema) ?? '', /amount must be a whole number/);
  assert.match(checkAgainstSchema({ approved: true, mode: 'warp' }, schema) ?? '', /mode must be one of "fast", "slow"/);
  assert.match(checkAgainstSchema({ approved: true, tags: ['a', 2] }, schema) ?? '', /tags\[1\] must be text/);
  assert.match(checkAgainstSchema([], schema) ?? '', /The answer must be an object/);
  assert.equal(checkAgainstSchema('anything', undefined), undefined);
  assert.equal(checkAgainstSchema(1, {}), undefined, 'a schema with no keywords accepts any answer');
});

// ---------------------------------------------------------------------------------------------
// The barrier as a value
// ---------------------------------------------------------------------------------------------

const interrupts: Interrupt[] = [
  { id: 'i-1', reason: 'approval', message: 'Approve the refund?', responseSchema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] } },
  { id: 'i-2', reason: 'input' },
  { id: 'i-3', reason: 'approval' },
];
const owed = (outcome: ObservedOutcome = { kind: 'interrupt', interrupts }) => repliesFor('run-1', outcome, []);

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return (result as { ok: true; value: T }).value;
};

test('each interrupt starts unanswered with a draft prefilled from its own schema', () => {
  const replies = owed();
  assert.deepEqual(replies.interrupts.map((answer) => [answer.interruptId, answer.status, answer.draft]), [
    ['i-1', 'unanswered', { approved: false }],
    ['i-2', 'unanswered', {}],
    ['i-3', 'unanswered', {}],
  ]);
  assert.deepEqual(replies.interrupts[0]?.responseSchema, interrupts[0]?.responseSchema);
  assert.equal(replies.interrupts[0]?.runId, 'run-1');
  assert.equal(isBlocked(replies), true);
  assert.deepEqual(remaining(replies), { interrupts: 3, toolResults: 0 });
});

test('only an interrupt or a success with pending tool calls leaves anything to answer', () => {
  for (const outcome of [{ kind: 'success', pendingToolCallIds: [] }, { kind: 'cancelled' }, { kind: 'error', message: 'x' }, { kind: 'unknown' }] as const) {
    assert.equal(repliesFor('run-1', outcome, []), NO_REPLIES);
  }
  assert.equal(isBlocked(NO_REPLIES), false);
});

test('answering a subset leaves the barrier up: no resume entries exist until every interrupt has an answer', () => {
  let replies = owed();
  replies = unwrap(draftInterrupt(replies, 'i-1', { approved: true }));
  replies = unwrap(answerInterrupt(replies, 'i-1', 'resolved'));
  replies = unwrap(answerInterrupt(replies, 'i-2', 'cancelled'));
  assert.equal(isBlocked(replies), true);
  assert.deepEqual(remaining(replies), { interrupts: 1, toolResults: 0 });
  const early = resumeEntries(replies);
  assert.equal(early.ok, false);
  assert.match(early.ok ? '' : early.error, /1 interrupt still has no answer/);
  assert.match(waitingNotice(replies) ?? '', /^1 interrupt waiting\. Answer it to continue the run\.$/);
});

test('with every interrupt answered the resume entries use the upstream shapes, in the order the run reported them', () => {
  let replies = owed();
  replies = unwrap(draftInterrupt(replies, 'i-1', { approved: true }));
  replies = unwrap(answerInterrupt(replies, 'i-3', 'cancelled'));
  replies = unwrap(answerInterrupt(replies, 'i-1', 'resolved'));
  replies = unwrap(draftInterrupt(replies, 'i-2', 'free text'));
  replies = unwrap(answerInterrupt(replies, 'i-2', 'resolved'));
  assert.equal(isBlocked(replies), false);
  assert.equal(waitingNotice(replies), undefined);
  assert.deepEqual(unwrap(resumeEntries(replies)), [
    { interruptId: 'i-1', status: 'resolved', payload: { approved: true } },
    { interruptId: 'i-2', status: 'resolved', payload: 'free text' },
    { interruptId: 'i-3', status: 'cancelled' },
  ]);
});

test('Cancel carries no payload even when the draft was edited, and a Resolve without edits sends the prefilled draft', () => {
  let replies = owed();
  replies = unwrap(draftInterrupt(replies, 'i-1', { approved: true }));
  replies = unwrap(answerInterrupt(replies, 'i-1', 'cancelled'));
  replies = unwrap(answerInterrupt(replies, 'i-2', 'resolved'));
  replies = unwrap(answerInterrupt(replies, 'i-3', 'resolved'));
  const entries = unwrap(resumeEntries(replies)) ?? [];
  assert.deepEqual(entries[0], { interruptId: 'i-1', status: 'cancelled' });
  assert.deepEqual(entries[1], { interruptId: 'i-2', status: 'resolved', payload: {} });
});

test('an answer is final: it cannot be changed, repeated or given to an interrupt that is not waiting', () => {
  let replies = unwrap(answerInterrupt(owed(), 'i-1', 'resolved'));
  assert.equal(answerInterrupt(replies, 'i-1', 'cancelled').ok, false);
  assert.equal(draftInterrupt(replies, 'i-1', 1).ok, false);
  assert.equal(answerInterrupt(replies, 'nope', 'resolved').ok, false);
  replies = unwrap(draftInterrupt(replies, 'i-2', 1));
  assert.equal(replies.interrupts[1]?.draft, 1);
});

const assistantWithCalls = {
  id: 'a-1',
  role: 'assistant' as const,
  toolCalls: [
    { id: 'c-1', type: 'function' as const, function: { name: 'pick_color', arguments: '{"choices":["red","teal"]}' } },
    { id: 'c-2', type: 'function' as const, function: { name: 'pick_size', arguments: '{"choices":' } },
  ],
};
const toolsOwed = () => repliesFor('run-1', { kind: 'success', pendingToolCallIds: ['c-1', 'c-2', 'c-3'] }, [assistantWithCalls]);

test('each pending tool call shows its name and arguments: parsed when complete JSON, with the error when not, and nothing invented when unseen', () => {
  const [first, second, third] = toolsOwed().toolResults;
  assert.deepEqual([first?.toolName, first?.argumentsText, first?.argumentsParsed, first?.argumentsError, first?.status], ['pick_color', '{"choices":["red","teal"]}', { choices: ['red', 'teal'] }, undefined, 'pending']);
  assert.deepEqual([second?.toolName, second?.argumentsText, second?.argumentsParsed], ['pick_size', '{"choices":', undefined]);
  assert.match(second?.argumentsError ?? '', /not valid JSON/);
  assert.deepEqual([third?.toolName, third?.argumentsText, third?.argumentsParsed, third?.argumentsError], ['', '', undefined, undefined]);
});

test('tool messages exist only when every pending call has a result, one per call in order, with the entered text unchanged', () => {
  let replies = toolsOwed();
  replies = unwrap(draftToolResult(replies, 'c-1', '"teal"'));
  replies = unwrap(submitToolResult(replies, 'c-1'));
  assert.equal(isBlocked(replies), true);
  const early = toolMessages(replies, () => 'x');
  assert.equal(early.ok, false);
  assert.match(early.ok ? '' : early.error, /2 tool calls still have no result/);
  assert.match(waitingNotice(replies) ?? '', /^2 tool calls waiting for results\. Enter them to continue the run\.$/);

  replies = unwrap(draftToolResult(replies, 'c-2', ' 3 '));
  replies = unwrap(submitToolResult(replies, 'c-2'));
  replies = unwrap(submitToolResult(replies, 'c-3'));
  assert.equal(isBlocked(replies), false);
  let n = 0;
  assert.deepEqual(unwrap(toolMessages(replies, () => `tm-${(n += 1)}`)), [
    { id: 'tm-1', role: 'tool', toolCallId: 'c-1', content: '"teal"' },
    { id: 'tm-2', role: 'tool', toolCallId: 'c-2', content: ' 3 ' },
    { id: 'tm-3', role: 'tool', toolCallId: 'c-3', content: '' },
  ]);
  assert.equal(draftToolResult(replies, 'c-1', 'again').ok, false, 'a submitted result is final');
  assert.equal(submitToolResult(replies, 'nope').ok, false);
});

// ---------------------------------------------------------------------------------------------
// A surface action
// ---------------------------------------------------------------------------------------------

const action: A2uiAction = { name: 'approve', surfaceId: 'surface-7', sourceComponentId: 'btn-ok', context: { orderId: 'o-9', n: 2, nested: { ok: true } }, timestamp: '2026-10-02T09:30:00.250Z' };

test('the action envelope must carry all five fields; the checked copy keeps them exactly', () => {
  assert.deepEqual(unwrap(checkA2uiAction(action)), action);
  assert.deepEqual(unwrap(checkA2uiAction({ ...action, ignored: 'extra' })), action, 'only the five documented fields are carried');
  for (const field of ['name', 'surfaceId', 'sourceComponentId', 'timestamp']) {
    assert.equal(checkA2uiAction({ ...action, [field]: '' }).ok, false, field);
    assert.equal(checkA2uiAction({ ...action, [field]: undefined }).ok, false, field);
  }
  assert.equal(checkA2uiAction({ ...action, context: 'x' }).ok, false);
  assert.equal(checkA2uiAction({ ...action, context: undefined }).ok, false);
  assert.equal(checkA2uiAction(null).ok, false);
});

// ---------------------------------------------------------------------------------------------
// Through the runtime: no early run, upstream shapes, recorded input
// ---------------------------------------------------------------------------------------------

function agentRoute(options: { interrupts?: Interrupt[]; tools?: boolean } = {}): Route {
  return (call) => {
    if (call.path !== '/run') return undefined;
    const input = bodyOf(call) as { threadId: string; runId: string; resume?: unknown[]; messages: Array<{ role: string; toolCallId?: string }> };
    const start = { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };
    const done = (outcome: object) => ({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome });
    const continued = input.resume !== undefined || input.messages.some((message) => message.role === 'tool');
    if (continued) return eventStream(sse([start, done({ type: 'success' })]));
    if (options.interrupts) return eventStream(sse([start, done({ type: 'interrupt', interrupts: options.interrupts })]));
    if (options.tools) {
      return eventStream(
        sse([
          start,
          { type: 'TOOL_CALL_START', toolCallId: 'c-1', toolCallName: 'pick_color' },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c-1', delta: '{"choices":' },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c-1', delta: '["red","teal"]}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c-1' },
          { type: 'TOOL_CALL_START', toolCallId: 'c-2', toolCallName: 'pick_size' },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c-2', delta: '{"n":3}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c-2' },
          done({ type: 'success' }),
        ]),
      );
    }
    return eventStream(sse([start, done({ type: 'success' })]));
  };
}

const supportAgent = { id: 'support', url: AGENT, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }] } } as const;

test('interrupts: no run starts until the last one is answered, and then one run carries every answer', async () => {
  const { runtime, net, settle } = rig([ok200, agentRoute({ interrupts })]);
  runtime.selectAgent(supportAgent);
  await runtime.send('refund my order');
  assert.equal(net.on('/run').length, 1);
  assert.deepEqual(runtime.getState().interrupts.map((answer) => answer.status), ['unanswered', 'unanswered', 'unanswered']);
  assert.match(runtime.getState().notice ?? '', /3 interrupts waiting/);

  runtime.draftInterrupt('i-1', { approved: true });
  await runtime.answerInterrupt('i-1', 'resolved');
  await runtime.answerInterrupt('i-3', 'cancelled');
  assert.equal(net.on('/run').length, 1, 'two of three answered: no continuation');
  assert.equal(net.on('/prepare/warm').length, 1, 'not even a preparation for the continuation');
  assert.match(runtime.getState().notice ?? '', /1 interrupt waiting/);

  await runtime.answerInterrupt('i-2', 'resolved');
  assert.equal(net.on('/run').length, 2);
  const [first, resume] = net.on('/run').map((call) => bodyOf(call) as { threadId: string; runId: string; parentRunId?: string; resume?: unknown; messages: Array<{ content: string }> });
  assert.deepEqual(resume?.resume, [
    { interruptId: 'i-1', status: 'resolved', payload: { approved: true } },
    { interruptId: 'i-2', status: 'resolved', payload: {} },
    { interruptId: 'i-3', status: 'cancelled' },
  ]);
  assert.equal(resume?.threadId, first?.threadId, 'the same thread');
  assert.notEqual(resume?.runId, first?.runId);
  assert.equal(resume?.parentRunId, first?.runId, 'the interrupted run is the parent');
  assert.equal(first?.parentRunId, undefined);
  assert.deepEqual(resume?.messages.map((message) => message.content), ['refund my order'], 'a resume adds no user message');
  assert.equal(RunAgentInputSchema.safeParse(resume).success, true);
  assert.equal(net.on('/prepare/warm').length, 2, 'the continuation prepared again, before it was sent');
  assert.deepEqual(runtime.getState().interrupts, [], 'what was carried is no longer waiting');

  const session = await settle();
  const recorded = session.runs.find((run) => run.runId === resume?.runId);
  assert.deepEqual(recorded?.input.resume, resume?.resume, 'the recorded input shows the answers');
  assert.equal(session.exchanges.find((exchange) => exchange.id === recorded?.exchangeId)?.requestBody, net.on('/run')[1]?.body);
  assert.equal(recorded?.parentRunId, first?.runId);
  assert.deepEqual(session.runs[0]?.outcome, { kind: 'interrupt', interrupts }, 'the first run keeps the outcome it observed');
});

test('interrupts: a new message cannot start a run while answers are owed, and Stop is not an answer', async () => {
  const { runtime, net } = rig([ok200, agentRoute({ interrupts })]);
  runtime.selectAgent(supportAgent);
  await runtime.send('refund');
  await runtime.send('hello again');
  assert.equal(net.on('/run').length, 1);
  assert.match(runtime.getState().error ?? '', /3 interrupts waiting/);
  runtime.stop();
  assert.equal(runtime.getState().interrupts.length, 3, 'stopping answers nothing');
  await runtime.continueRun();
  assert.match(runtime.getState().error ?? '', /3 interrupts still have no answer/);
  assert.equal(net.on('/run').length, 1);
});

test('interrupts: a new thread drops what was waiting; the earlier exchanges stay', async () => {
  const { runtime, net, settle } = rig([ok200, agentRoute({ interrupts }), replyRoute()]);
  runtime.selectAgent(supportAgent);
  await runtime.send('refund');
  const firstThread = runtime.getState().threadId;
  runtime.newThread();
  assert.notEqual(runtime.getState().threadId, firstThread);
  assert.deepEqual(runtime.getState().interrupts, []);
  await runtime.send('fresh start');
  const second = bodyOf(net.on('/run')[1]) as { threadId: string; parentRunId?: string; messages: unknown[]; resume?: unknown };
  assert.notEqual(second.threadId, firstThread);
  assert.equal(second.messages.length, 1);
  assert.equal(second.resume, undefined);
  assert.equal(second.parentRunId, undefined, 'the run that was waiting is not the new thread\'s parent');
  assert.equal((await settle()).exchanges.filter((exchange) => exchange.kind === 'conversation').length, 2);
});

test('tool calls: no run starts until every pending call has a result, then one run carries the tool messages', async () => {
  const { runtime, net, settle } = rig([ok200, agentRoute({ tools: true })]);
  runtime.selectAgent(supportAgent);
  await runtime.send('pick things');
  const pending = runtime.getState().toolResults;
  assert.deepEqual(pending.map((draft) => [draft.toolCallId, draft.toolName, draft.argumentsParsed, draft.status]), [
    ['c-1', 'pick_color', { choices: ['red', 'teal'] }, 'pending'],
    ['c-2', 'pick_size', { n: 3 }, 'pending'],
  ]);

  runtime.draftToolResult('c-1', '"teal"');
  await runtime.submitToolResult('c-1');
  assert.equal(net.on('/run').length, 1, 'one of two results: no continuation');
  assert.match(runtime.getState().notice ?? '', /1 tool call waiting for a result/);
  runtime.draftToolResult('c-2', '3');
  await runtime.submitToolResult('c-2');

  assert.equal(net.on('/run').length, 2);
  const second = bodyOf(net.on('/run')[1]) as { parentRunId: string; resume?: unknown; messages: Array<Record<string, unknown>> };
  const tools = second.messages.filter((message) => message.role === 'tool');
  assert.deepEqual(tools.map((message) => [message.toolCallId, message.content]), [['c-1', '"teal"'], ['c-2', '3']]);
  assert.equal(second.resume, undefined, 'tool results are not interrupt answers');
  assert.deepEqual(second.messages.map((message) => message.role), ['user', 'assistant', 'assistant', 'tool', 'tool'], 'the full transcript: the turn, the calls the client saw, then the results');
  assert.ok(tools.every((message) => typeof message.id === 'string' && message.id !== ''));
  assert.equal(RunAgentInputSchema.safeParse(second).success, true);

  const session = await settle();
  const recorded = session.runs[1];
  assert.deepEqual(recorded?.input.messages.filter((message) => message.role === 'tool').length, 2);
  assert.equal(recorded?.parentRunId, session.runs[0]?.runId);
});

test('tool calls in turn mode: the continuation carries only the tool messages', async () => {
  const { runtime, net, settings } = rig([ok200, agentRoute({ tools: true })]);
  settings.current = { ...settings.current, profile: { ...settings.current.profile, messageMode: 'turn' } };
  runtime.selectAgent(supportAgent);
  await runtime.send('pick things');
  runtime.draftToolResult('c-1', 'one');
  await runtime.submitToolResult('c-1');
  runtime.draftToolResult('c-2', 'two');
  await runtime.submitToolResult('c-2');
  const second = bodyOf(net.on('/run')[1]) as { messages: Array<Record<string, unknown>> };
  assert.deepEqual(second.messages.map((message) => [message.role, message.content]), [['tool', 'one'], ['tool', 'two']]);
});

test('interrupts in turn mode: a resume carries no messages at all', async () => {
  const { runtime, net, settings } = rig([ok200, agentRoute({ interrupts: [interrupts[1] as Interrupt] })]);
  settings.current = { ...settings.current, profile: { ...settings.current.profile, messageMode: 'turn' } };
  runtime.selectAgent(supportAgent);
  await runtime.send('go');
  await runtime.answerInterrupt('i-2', 'cancelled');
  const second = bodyOf(net.on('/run')[1]) as { messages: unknown[]; resume: unknown };
  assert.deepEqual(second.messages, []);
  assert.deepEqual(second.resume, [{ interruptId: 'i-2', status: 'cancelled' }]);
});

test('tool results the user typed are their own: nothing answers a pending call automatically', async () => {
  const { runtime, net } = rig([ok200, agentRoute({ tools: true })]);
  runtime.selectAgent(supportAgent);
  await runtime.send('pick things');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(net.on('/run').length, 1, 'waiting costs nothing and sends nothing');
  assert.equal(runtime.getState().toolResults.every((draft) => draft.status === 'pending' && draft.resultDraft === ''), true);
});

test('an A2UI action starts a new run with the documented envelope, after the preparations, in either message mode', async () => {
  for (const mode of ['full', 'turn'] as const) {
    const { runtime, net, settings, settle } = rig([ok200, replyRoute()]);
    settings.current = { ...settings.current, profile: { ...settings.current.profile, messageMode: mode, forwardedProps: { tenant: 'acme' } } };
    runtime.selectAgent(supportAgent);
    await runtime.send('show me a form');
    await runtime.sendA2uiAction(action);

    assert.deepEqual(net.calls.map((call) => call.path), ['/prepare/warm', '/run', '/prepare/warm', '/run']);
    const body = bodyOf(net.on('/run')[1]) as { forwardedProps: Record<string, unknown>; messages: Array<{ role: string }>; resume?: unknown };
    assert.deepEqual(body.forwardedProps, { tenant: 'acme', a2uiAction: { userAction: action } });
    assert.equal(body.resume, undefined);
    assert.equal(body.messages.some((message) => message.role === 'tool'), false);
    assert.equal(body.messages.length, mode === 'full' ? 2 : 0, `${mode}: the action adds no user message`);
    assert.equal(RunAgentInputSchema.safeParse(body).success, true);

    const recorded = (await settle()).runs[1];
    assert.deepEqual((recorded?.input.forwardedProps as { a2uiAction: unknown }).a2uiAction, { userAction: action }, 'the recording exposes the action');
  }
});

test('an invalid action envelope is refused visibly and nothing is sent', async () => {
  const { runtime, net } = rig([ok200, replyRoute()]);
  runtime.selectAgent(supportAgent);
  await runtime.sendA2uiAction({ ...action, surfaceId: '' });
  assert.match(runtime.getState().error ?? '', /surfaceId/);
  assert.equal(net.calls.length, 0);
});

test('an action cannot start a run while interrupts are owed', async () => {
  const { runtime, net } = rig([ok200, agentRoute({ interrupts })]);
  runtime.selectAgent(supportAgent);
  await runtime.send('refund');
  await runtime.sendA2uiAction(action);
  assert.equal(net.on('/run').length, 1);
  assert.match(runtime.getState().error ?? '', /interrupts waiting/);
});

// ---------------------------------------------------------------------------------------------
// Automatic replies (spec 004): what the profile answers, and what it leaves for the developer
// ---------------------------------------------------------------------------------------------

test('the limit of automatic continuations in a row is 10', () => {
  assert.equal(AUTOMATIC_REPLY_LIMIT, 10);
});

test('resolve answers every interrupt as pressing Resolve unedited would: same status, same starting draft, marked automatic', () => {
  const replies = owed();
  const answered = automate(replies, { interruptReply: 'resolve' });
  assert.deepEqual(
    answered.interrupts.map((answer) => [answer.interruptId, answer.status, answer.draft, answer.automatic]),
    [
      ['i-1', 'resolved', { approved: false }, true],
      ['i-2', 'resolved', {}, true],
      ['i-3', 'resolved', {}, true],
    ],
  );
  assert.equal(isBlocked(answered), false);
  // The same entries a developer's own Resolve clicks produce.
  let manual = owed();
  for (const id of ['i-1', 'i-2', 'i-3']) manual = unwrap(answerInterrupt(manual, id, 'resolved'));
  assert.deepEqual(unwrap(resumeEntries(answered)), unwrap(resumeEntries(manual)));
  assert.deepEqual(replies.interrupts.map((answer) => answer.status), ['unanswered', 'unanswered', 'unanswered'], 'the input value is not changed');
});

test('cancel answers every interrupt with a cancellation and no payload', () => {
  const answered = automate(owed(), { interruptReply: 'cancel', interruptPayloads: { approval: { approved: true } } });
  assert.deepEqual(unwrap(resumeEntries(answered)), [
    { interruptId: 'i-1', status: 'cancelled' },
    { interruptId: 'i-2', status: 'cancelled' },
    { interruptId: 'i-3', status: 'cancelled' },
  ]);
  assert.equal(answered.interrupts.every((answer) => answer.automatic === true), true);
});

test('the payload for an interrupt reason replaces the starting answer and is sent as written; other reasons keep theirs', () => {
  const payload = { approved: true, note: ' as written\n', n: [1, { a: null }] };
  const answered = automate(owed(), { interruptReply: 'resolve', interruptPayloads: { approval: payload } });
  assert.deepEqual(unwrap(resumeEntries(answered)), [
    { interruptId: 'i-1', status: 'resolved', payload },
    { interruptId: 'i-2', status: 'resolved', payload: {} },
    { interruptId: 'i-3', status: 'resolved', payload },
  ]);
  assert.notEqual(answered.interrupts[0]?.draft, payload, 'the reply holds its own copy');
  assert.notEqual(answered.interrupts[0]?.draft, answered.interrupts[2]?.draft, 'two interrupts of one reason do not share one object');
  // The entries equal what a developer who typed the same JSON into the editor sends.
  let manual = owed();
  manual = unwrap(draftInterrupt(manual, 'i-1', payload));
  manual = unwrap(draftInterrupt(manual, 'i-3', payload));
  for (const id of ['i-1', 'i-2', 'i-3']) manual = unwrap(answerInterrupt(manual, id, 'resolved'));
  assert.deepEqual(unwrap(resumeEntries(answered)), unwrap(resumeEntries(manual)));
});

test('a payload is never checked against the interrupt response schema, and a list, text, a number and false are payloads too', () => {
  assert.equal(checkAgainstSchema({ approved: 'yes' }, interrupts[0]?.responseSchema) !== undefined, true, 'the payload misses the schema');
  const answered = automate(owed(), { interruptReply: 'resolve', interruptPayloads: { approval: { approved: 'yes' }, input: 'free text' } });
  assert.deepEqual((unwrap(resumeEntries(answered)) ?? []).map((entry) => entry.payload), [{ approved: 'yes' }, 'free text', { approved: 'yes' }]);
  for (const odd of [[], 'text', 0, false]) {
    const next = automate(owed(), { interruptReply: 'resolve', interruptPayloads: { input: odd } });
    assert.deepEqual(next.interrupts[1]?.draft, odd);
  }
});

test('payloads alone answer nothing: they need the interrupt reply to be resolve', () => {
  const replies = owed();
  assert.equal(automate(replies, { interruptPayloads: { approval: 1 } }), replies);
  assert.equal(automate(replies, { interruptReply: undefined }), replies);
});

test('a reason that the agent names like an object property never finds a payload', () => {
  const odd = [{ id: 'i-a', reason: 'constructor' }, { id: 'i-b', reason: 'toString' }, { id: 'i-c', reason: '__proto__' }, { id: 'i-d', reason: 'hasOwnProperty' }];
  const answered = automate(owed({ kind: 'interrupt', interrupts: odd }), { interruptReply: 'resolve', interruptPayloads: { approval: 1 } });
  assert.deepEqual(answered.interrupts.map((answer) => answer.draft), [{}, {}, {}, {}]);
  const own = JSON.parse('{"__proto__":{"own":true}}') as Record<string, never>;
  const withOwn = automate(owed({ kind: 'interrupt', interrupts: odd }), { interruptReply: 'resolve', interruptPayloads: own });
  assert.deepEqual(withOwn.interrupts[2]?.draft, { own: true }, 'a reason that the profile really names still matches');
});

test('automate answers only what is still waiting and returns the same value when it answers nothing', () => {
  let replies = owed();
  replies = unwrap(draftInterrupt(replies, 'i-2', 'typed'));
  replies = unwrap(answerInterrupt(replies, 'i-2', 'resolved'));
  const answered = automate(replies, { interruptReply: 'cancel' });
  assert.deepEqual(answered.interrupts.map((answer) => [answer.status, answer.automatic]), [['cancelled', true], ['resolved', undefined], ['cancelled', true]]);
  assert.equal(answered.interrupts[1]?.draft, 'typed', 'the developer\'s own answer is untouched');
  assert.deepEqual(answered.source, replies.source);
  assert.equal(automate(answered, { interruptReply: 'resolve' }), answered, 'nothing left to answer');
  assert.equal(automate(NO_REPLIES, { interruptReply: 'resolve', toolResults: { a: 'b' } }), NO_REPLIES);
});

test('a scripted result answers the pending calls of its tool, byte for byte, and leaves the rest', () => {
  const replies = toolsOwed();
  const answered = automate(replies, { toolResults: { pick_color: ' "teal"\n', pick_size: '{"size":2}' } });
  assert.deepEqual(
    answered.toolResults.map((draft) => [draft.toolCallId, draft.status, draft.resultDraft, draft.automatic]),
    [
      ['c-1', 'answered', ' "teal"\n', true],
      ['c-2', 'answered', '{"size":2}', true],
      ['c-3', 'pending', '', undefined],
    ],
    'c-3 was never seen to start, so it has no name and no script',
  );
  assert.equal(isBlocked(answered), true);
  let manual = toolsOwed();
  manual = unwrap(draftToolResult(manual, 'c-1', ' "teal"\n'));
  manual = unwrap(submitToolResult(manual, 'c-1'));
  manual = unwrap(draftToolResult(manual, 'c-2', '{"size":2}'));
  manual = unwrap(submitToolResult(manual, 'c-2'));
  assert.deepEqual(
    answered.toolResults.slice(0, 2).map(({ automatic: _mark, ...draft }) => draft),
    manual.toolResults.slice(0, 2),
    'the same drafts a developer produces, apart from the mark',
  );
});

test('a call whose arguments are not valid JSON still gets its scripted result, and a tool without a script waits', () => {
  const answered = automate(toolsOwed(), { toolResults: { pick_size: 'two' } });
  assert.deepEqual(answered.toolResults.map((draft) => [draft.status, draft.automatic]), [['pending', undefined], ['answered', true], ['pending', undefined]]);
  assert.match(answered.toolResults[1]?.argumentsError ?? '', /not valid JSON/);
});

test('a tool name that looks like an object property finds no script', () => {
  const odd = { id: 'a-2', role: 'assistant' as const, toolCalls: ['constructor', 'toString', '__proto__'].map((name, at) => ({ id: `k-${at}`, type: 'function' as const, function: { name, arguments: '{}' } })) };
  const replies = repliesFor('run-1', { kind: 'success', pendingToolCallIds: ['k-0', 'k-1', 'k-2'] }, [odd]);
  const answered = automate(replies, { toolResults: { pick_color: 'x' } });
  assert.equal(answered, replies);
  assert.equal(answered.toolResults.every((draft) => draft.status === 'pending'), true);
});

test('interrupts follow their own setting and tool calls theirs', () => {
  const replies = owed();
  assert.equal(automate(replies, { toolResults: { pick_color: 'x' } }), replies, 'tool scripts do not answer interrupts');
  const tools = toolsOwed();
  assert.equal(automate(tools, { interruptReply: 'resolve', interruptPayloads: { approval: 1 } }), tools, 'an interrupt reply does not answer tool calls');
});

test('automaticReplies lists the ids the inspector answered, and is undefined when it answered none', () => {
  assert.equal(automaticReplies(owed()), undefined);
  assert.equal(automaticReplies(NO_REPLIES), undefined);
  const mixed = automate(toolsOwed(), { toolResults: { pick_color: 'x' } });
  assert.deepEqual(automaticReplies(mixed), { interruptIds: [], toolCallIds: ['c-1'] });
  assert.deepEqual(automaticReplies(automate(owed(), { interruptReply: 'cancel' })), { interruptIds: ['i-1', 'i-2', 'i-3'], toolCallIds: [] });
  let byHand = owed();
  byHand = unwrap(answerInterrupt(byHand, 'i-1', 'resolved'));
  assert.deepEqual(automaticReplies(automate(byHand, { interruptReply: 'resolve' })), { interruptIds: ['i-2', 'i-3'], toolCallIds: [] }, 'a reply the developer gave is not listed');
});
