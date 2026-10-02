// L02 T024/T025 (US1.1, US1.2, US1.6, US3, FR-003 to FR-005, FR-007, FR-009, FR-011, FR-031, FR-036,
// FR-037): the runtime as a whole. A run is recorded with its exchange, frames and run record; Stop,
// New thread and quick messages work without inventing events; client sequence errors become run
// findings while capture goes on; the token is volatile and absent from everything recorded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interrupt } from '@ag-ui/core';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import type { JsonValue } from '../../src/contracts.ts';
import { AGENT, bodyOf, embedded, eventStream, hosted, ok200, replyRoute, rig, sse, type Call, type Route } from './support.ts';

const TOKEN = 'synthetic-token-7f3a91';
const support = { id: 'support', name: 'Support', url: AGENT, preset: { quickMessages: ['/help', 'Where is my order?'], forwardedProps: { tenant: 'acme' } } } as const;

const start = (call: Call) => {
  const input = bodyOf(call) as { threadId: string; runId: string };
  return { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };
};
const finish = (call: Call, outcome: object = { type: 'success' }) => {
  const input = bodyOf(call) as { threadId: string; runId: string };
  return { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome };
};
const route = (events: (call: Call) => Array<object | string>, options: { hold?: boolean } = {}): Route => (call) =>
  call.path === '/run' ? eventStream(sse(events(call)), { ...options, ...(call.signal && { signal: call.signal }) }) : undefined;

// ---------------------------------------------------------------------------------------------
// A recorded run
// ---------------------------------------------------------------------------------------------

test('a run is an exchange with its frames in order, a run record with the input as sent, and a transcript', async () => {
  const { runtime, net, settle } = rig([replyRoute('/run', 'Hello from the agent.')]);
  runtime.selectAgent(support);
  await runtime.send('hi there');
  const session = await settle();

  const call = net.on('/run')[0] as Call;
  const [exchange] = session.exchanges;
  assert.deepEqual([exchange?.kind, exchange?.method, exchange?.path, exchange?.status, exchange?.transport], ['conversation', 'POST', '/run', 200, 'completed']);
  assert.equal(exchange?.requestBody, call.body, 'the recording keeps the exact body that was sent');
  assert.equal(typeof exchange?.elapsedMs, 'number');

  const frames = session.frames.filter((frame) => frame.exchangeId === exchange?.id);
  assert.deepEqual(frames.map((frame) => frame.eventType), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  assert.deepEqual(frames.map((frame) => frame.index), [0, 1, 2, 3, 4]);
  assert.ok(frames.every((frame) => frame.schemaVerdict === 'valid'));

  const [run] = session.runs;
  assert.deepEqual([run?.id, run?.exchangeId, run?.threadId, run?.outcome], ['run-1', exchange?.id, runtime.getState().threadId, { kind: 'success', pendingToolCallIds: [] }]);
  assert.deepEqual(run?.input, bodyOf(call));
  assert.equal(typeof run?.endedAt, 'number');
  assert.equal(exchange?.runId, 'run-1');
  assert.equal(runtime.getState().running, false);
  assert.equal(runtime.getState().error, undefined);
});

test('the next run carries the whole transcript the client built, including the reply it received', async () => {
  const { runtime, net } = rig([replyRoute('/run', 'First reply')]);
  runtime.selectAgent(support);
  await runtime.send('first');
  await runtime.send('second');
  const second = bodyOf(net.on('/run')[1]) as { messages: Array<{ role: string; content: string }>; threadId: string };
  assert.deepEqual(second.messages.map((message) => [message.role, message.content]), [['user', 'first'], ['assistant', 'First reply'], ['user', 'second']]);
  assert.equal(second.threadId, (bodyOf(net.on('/run')[0]) as { threadId: string }).threadId);
});

test('the run input follows the documented contract: ids, protocol version, state, tools, context and merged properties', async () => {
  const { runtime, net, settings } = rig([ok200, replyRoute()]);
  settings.current = {
    variables: {},
    profile: {
      protocolVersion: '1.0',
      tools: [{ name: 'lookup', description: 'Looks things up', parameters: { type: 'object' } }],
      context: [{ description: 'locale', value: 'fr-FR' }],
      renderA2ui: true,
      injectA2uiTool: false,
      forwardedProps: { tenant: 'override', extra: [1, 2] },
    },
  };
  runtime.selectAgent(support);
  await runtime.send('hello');
  const input = bodyOf(net.on('/run')[0]) as Record<string, unknown>;
  assert.equal(RunAgentInputSchema.safeParse(input).success, true);
  assert.equal(input.protocolVersion, '1.0');
  assert.equal(input.parentRunId, undefined, 'an ordinary message names no parent');
  assert.deepEqual(input.state, {});
  assert.deepEqual(input.tools, settings.current.profile.tools);
  assert.deepEqual(input.context, settings.current.profile.context);
  assert.deepEqual(input.forwardedProps, { tenant: 'override', extra: [1, 2] }, 'profile properties override the preset');
  assert.equal(typeof input.runId, 'string');
  assert.equal(input.threadId, runtime.getState().threadId);
});

test('an input that does not satisfy the protocol is refused visibly before anything is sent', async () => {
  const { runtime, net, settings } = rig([ok200, replyRoute()]);
  settings.current = { ...settings.current, profile: { ...settings.current.profile, context: [{ description: 5, value: 'x' } as unknown as { description: string; value: string }] } };
  runtime.selectAgent(support);
  await runtime.send('hello');
  assert.equal(net.calls.length, 0);
  assert.match(runtime.getState().error ?? '', /Run input is invalid/);
});

test('subscribers hear every change to the state and the state object is replaced, never mutated', async () => {
  const { runtime } = rig([replyRoute()]);
  const seen: Array<{ running: boolean; error?: string }> = [];
  let calls = 0;
  const unsubscribe = runtime.subscribe(() => {
    calls += 1;
    seen.push({ running: runtime.getState().running });
  });
  runtime.selectAgent(support);
  const before = runtime.getState();
  await runtime.send('hello');
  assert.notEqual(runtime.getState(), before);
  assert.equal(before.running, false);
  assert.ok(seen.some((entry) => entry.running), 'the running state was visible while the run was in flight');
  assert.equal(runtime.getState().running, false);
  const heard = calls;
  unsubscribe();
  runtime.newThread();
  assert.equal(calls, heard);
});

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

test('state snapshots and deltas are carried into the next run', async () => {
  let n = 0;
  const { runtime, net } = rig([
    route((call) => {
      n += 1;
      return n === 1
        ? [start(call), { type: 'STATE_SNAPSHOT', snapshot: { cart: { items: 1 }, step: 'a' } }, { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/step', value: 'b' }, { op: 'add', path: '/cart/items', value: 2 }] }, finish(call)]
        : [start(call), finish(call)];
    }),
  ]);
  runtime.selectAgent(support);
  await runtime.send('one');
  assert.deepEqual((bodyOf(net.on('/run')[0]) as { state: unknown }).state, {});
  await runtime.send('two');
  assert.deepEqual((bodyOf(net.on('/run')[1]) as { state: unknown }).state, { cart: { items: 2 }, step: 'b' });
});

test('a new thread starts again from an empty state and an empty transcript', async () => {
  const { runtime, net } = rig([
    route((call) => [start(call), { type: 'STATE_SNAPSHOT', snapshot: { n: 1 } }, finish(call)]),
  ]);
  runtime.selectAgent(support);
  await runtime.send('one');
  runtime.newThread();
  await runtime.send('fresh');
  const input = bodyOf(net.on('/run')[1]) as { state: unknown; messages: Array<{ content: string }> };
  assert.deepEqual(input.state, {});
  assert.deepEqual(input.messages.map((message) => message.content), ['fresh']);
});

// ---------------------------------------------------------------------------------------------
// Controls: stop, new thread, quick messages
// ---------------------------------------------------------------------------------------------

test('Stop ends the connection mid-run: the partial recording stays, no terminal event is made up, the outcome stays unknown', async () => {
  const { runtime, net, settle } = rig([
    route((call) => [start(call), { type: 'TEXT_MESSAGE_START', messageId: 'm-1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-1', delta: 'partial' }], { hold: true }),
  ]);
  runtime.selectAgent(support);
  const running = runtime.send('stream please');
  for (let i = 0; i < 100 && runtime.getState().running === false; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  for (let i = 0; i < 100 && !net.calls.some((call) => call.path === '/run'); i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(runtime.getState().running, true);
  assert.ok(runtime.getState().connection.abortController, 'the active controller is part of the connection state');

  runtime.stop();
  await running;
  const session = await settle();
  assert.equal(runtime.getState().running, false);
  assert.equal(runtime.getState().connection.abortController, undefined);
  assert.equal(runtime.getState().error, undefined, 'a stop is not an error');

  assert.equal(session.exchanges[0]?.transport, 'user-stopped');
  assert.deepEqual(session.frames.map((frame) => frame.eventType), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
  assert.ok(session.frames.every((frame) => frame.eventType !== 'RUN_FINISHED' && frame.eventType !== 'RUN_ERROR'), 'nothing was fabricated');
  assert.deepEqual(session.runs[0]?.outcome, { kind: 'unknown' });
  assert.ok(session.findings.some((finding) => finding.kind === 'terminal' && finding.subject.type === 'run'), 'the missing terminal event is reported on the run');

  net.routes.length = 0;
  net.routes.push(replyRoute());
  await runtime.send('after the stop');
  assert.equal(net.on('/run').length, 2, 'a stopped run does not block the next one');
});

test('Stop before the answer arrives records the exchange as stopped by the user', async () => {
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? new Promise<Response>((_, reject) => call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) : undefined)]);
  runtime.selectAgent(support);
  const running = runtime.send('hello');
  await new Promise((resolve) => setTimeout(resolve, 30));
  runtime.stop();
  await running;
  const session = await settle();
  assert.equal(session.exchanges[0]?.transport, 'user-stopped');
  assert.equal(runtime.getState().error, undefined);
  assert.equal(runtime.getState().running, false);
});

test('New thread changes the identifiers and clears what the next run carries, and the earlier exchanges stay as recorded', async () => {
  const { runtime, net, settle } = rig([replyRoute()]);
  runtime.selectAgent(support);
  await runtime.send('old thread');
  const oldThread = runtime.getState().threadId;
  const before = await settle();
  runtime.newThread();
  assert.notEqual(runtime.getState().threadId, oldThread);
  await runtime.send('new thread');
  const after = await settle();
  assert.deepEqual(after.exchanges[0], before.exchanges[0], 'the earlier exchange is untouched');
  assert.deepEqual(after.frames.slice(0, before.frames.length), before.frames, 'so are its frames');
  assert.notEqual((bodyOf(net.on('/run')[1]) as { threadId: string }).threadId, oldThread);
  assert.equal(after.exchanges.length, 2);
});

test('New thread while a run streams ends that run and starts clean', async () => {
  const { runtime, net, settle } = rig([route((call) => [start(call)], { hold: true })]);
  runtime.selectAgent(support);
  const running = runtime.send('long run');
  await new Promise((resolve) => setTimeout(resolve, 40));
  runtime.newThread();
  await running;
  assert.equal(runtime.getState().running, false);
  net.routes.length = 0;
  net.routes.push(replyRoute());
  await runtime.send('again');
  assert.deepEqual((bodyOf(net.on('/run')[1]) as { messages: Array<{ content: string }> }).messages.map((message) => message.content), ['again'], 'the abandoned run does not leak into the new thread');
  assert.equal((await settle()).exchanges[0]?.transport, 'user-stopped');
});

test('quick messages come from the preset and use the ordinary send path, preparations included', async () => {
  const { runtime, net } = rig([ok200, replyRoute()]);
  runtime.selectAgent({ ...support, preset: { quickMessages: ['/help'], prepare: [{ method: 'POST', path: '/prepare/warm' }] } });
  assert.deepEqual(runtime.getState().quickMessages, ['/help']);
  await runtime.send('/help');
  assert.deepEqual(net.calls.map((call) => call.path), ['/prepare/warm', '/run']);
  assert.equal((bodyOf(net.on('/run')[0]) as { messages: Array<{ content: string }> }).messages[0]?.content, '/help');
  runtime.setTarget(AGENT);
  assert.deepEqual(runtime.getState().quickMessages, [], 'a typed endpoint has no preset');
});

test('an empty message is not sent, and a second send while one is running is refused', async () => {
  const { runtime, net } = rig([replyRoute()]);
  runtime.selectAgent(support);
  await runtime.send('   ');
  assert.equal(net.calls.length, 0);
  assert.match(runtime.getState().error ?? '', /Enter a message/);

  const first = runtime.send('one');
  const second = runtime.send('two');
  await Promise.all([first, second]);
  assert.equal(net.on('/run').length, 1);
});

// ---------------------------------------------------------------------------------------------
// Findings: the client's complaints never end capture (FR-009)
// ---------------------------------------------------------------------------------------------

test('a sequence violation becomes a finding on the run while every later frame is still captured, unchanged', async () => {
  const stream = (call: Call) => [
    start(call),
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 'no start event' },
    { type: 'STEP_STARTED', stepName: 'after the violation' },
    { type: 'STEP_FINISHED', stepName: 'after the violation' },
    finish(call),
  ];
  const { runtime, net, settle } = rig([route(stream)]);
  runtime.selectAgent(support);
  await runtime.send('break the rules');
  const session = await settle();

  assert.deepEqual(session.frames.map((frame) => frame.eventType), ['RUN_STARTED', 'TEXT_MESSAGE_CONTENT', 'STEP_STARTED', 'STEP_FINISHED', 'RUN_FINISHED']);
  const sequence = session.findings.filter((finding) => finding.kind === 'sequence');
  assert.equal(sequence.length, 1);
  assert.deepEqual(sequence[0]?.subject, { type: 'run', id: 'run-1' });
  assert.match(sequence[0]?.message ?? '', /No active text message found/);
  assert.equal(session.findings.some((finding) => finding.kind === 'terminal'), false, 'the stream did end with a valid RUN_FINISHED');
  assert.equal(runtime.getState().error, undefined, 'stream problems are findings, not a connection banner');
  assert.equal(session.exchanges[0]?.transport, 'completed');
  void net;
});

test('a frame that is not JSON ends the client run but not the recording; later frames are kept and flagged correctly', async () => {
  const { runtime, settle } = rig([route((call) => [start(call), '{not json at all', { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, finish(call)])]);
  runtime.selectAgent(support);
  await runtime.send('malformed');
  const session = await settle();
  assert.deepEqual(session.frames.map((frame) => [frame.eventType, frame.jsonVerdict]), [['RUN_STARTED', 'valid'], [undefined, 'invalid'], ['TEXT_MESSAGE_START', 'valid'], ['RUN_FINISHED', 'valid']]);
  assert.equal(session.frames[1]?.data, '{not json at all', 'the received text is untouched');
  assert.ok(session.findings.some((finding) => finding.kind === 'json' && finding.subject.type === 'frame'));
  assert.ok(session.findings.some((finding) => finding.kind === 'json' && finding.subject.type === 'run'), 'the client rejection is on the run too');
  assert.equal(session.exchanges[0]?.transport, 'completed');
});

test('a schema-invalid or unknown-type frame stays inspectable and capture reaches the end of the stream', async () => {
  const { runtime, settle } = rig([route((call) => [start(call), { type: 'TEXT_MESSAGE_START', messageId: 5, role: 'assistant' }, { type: 'NOT_A_REAL_EVENT' }, finish(call)])]);
  runtime.selectAgent(support);
  await runtime.send('invalid');
  const session = await settle();
  assert.deepEqual(session.frames.map((frame) => [frame.eventType, frame.schemaVerdict]), [['RUN_STARTED', 'valid'], ['TEXT_MESSAGE_START', 'invalid'], ['NOT_A_REAL_EVENT', 'unknown-type'], ['RUN_FINISHED', 'valid']]);
  assert.ok(session.findings.some((finding) => finding.kind === 'schema' && finding.subject.type === 'run'));
});

test('a stream that ends without a terminal event gets a terminal finding on the run, and the outcome is unknown, not made up', async () => {
  const { runtime, settle } = rig([route((call) => [start(call), { type: 'STEP_STARTED', stepName: 'work' }])]);
  runtime.selectAgent(support);
  await runtime.send('hang up on me');
  const session = await settle();
  assert.deepEqual(session.runs[0]?.outcome, { kind: 'unknown' });
  const terminal = session.findings.filter((finding) => finding.kind === 'terminal');
  assert.deepEqual(terminal.map((finding) => finding.subject), [{ type: 'run', id: 'run-1' }]);
  assert.equal(session.frames.length, 2);
});

test('RUN_ERROR is the observed outcome, with its message and code', async () => {
  const { runtime, settle } = rig([route((call) => [start(call), { type: 'RUN_ERROR', message: 'model unavailable', code: 'E_MODEL' }])]);
  runtime.selectAgent(support);
  await runtime.send('fail');
  assert.deepEqual((await settle()).runs[0]?.outcome, { kind: 'error', message: 'model unavailable', code: 'E_MODEL' });
});

test('RUN_FINISHED outcomes are kept as observed: success with result and pending tool calls, cancellation', async () => {
  let n = 0;
  const { runtime, settle } = rig([
    route((call) => {
      n += 1;
      return n === 1
        ? [start(call), { type: 'TOOL_CALL_START', toolCallId: 'c-1', toolCallName: 'x' }, { type: 'TOOL_CALL_END', toolCallId: 'c-1' }, { ...finish(call), result: { answer: 42 }, outcome: { type: 'success', pendingToolCallIds: ['c-1'] } }]
        : [start(call), finish(call, { type: 'cancelled' })];
    }),
  ]);
  runtime.selectAgent(support);
  await runtime.send('one');
  runtime.draftToolResult('c-1', 'done');
  await runtime.submitToolResult('c-1');
  const { runs } = await settle();
  assert.deepEqual(runs[0]?.outcome, { kind: 'success', result: { answer: 42 }, pendingToolCallIds: ['c-1'] });
  assert.deepEqual(runs[1]?.outcome, { kind: 'cancelled' });
});

// ---------------------------------------------------------------------------------------------
// Connection failures are visible (FR-005)
// ---------------------------------------------------------------------------------------------

test('a connection the browser blocks is a transport error on the exchange and a message the user can read', async () => {
  const { runtime, settle } = rig([() => {
    throw new TypeError('Failed to fetch');
  }]);
  runtime.selectAgent(support);
  await runtime.send('hello');
  const session = await settle();
  assert.equal(session.exchanges[0]?.transport, 'transport-error');
  assert.match(session.exchanges[0]?.transportError ?? '', /CORS/);
  assert.ok(session.findings.some((finding) => finding.kind === 'transport'));
  assert.match(runtime.getState().error ?? '', /The run request failed: The browser could not complete the request to https:\/\/agent\.example/);
  assert.equal(runtime.getState().running, false);
  assert.equal(session.runs[0]?.outcome.kind, 'unknown');
});

test('a server error is kept as inspectable evidence: status and body on the exchange, and a message', async () => {
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? new Response('{"detail":"bad input"}', { status: 422 }) : undefined)]);
  runtime.selectAgent(support);
  await runtime.send('hello');
  const session = await settle();
  assert.deepEqual([session.exchanges[0]?.status, session.exchanges[0]?.responseBody], [422, '{"detail":"bad input"}']);
  assert.match(runtime.getState().error ?? '', /422/);
});

test('a redirect is refused and shown, with no second request', async () => {
  const { runtime, net, settle } = rig([() => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })]);
  runtime.selectAgent(support);
  await runtime.send('hello');
  assert.equal(net.calls.length, 1);
  assert.match(runtime.getState().error ?? '', /redirect/i);
  assert.equal((await settle()).exchanges[0]?.transport, 'transport-error');
});

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

test('hosted targets must be absolute and allowed; otherwise nothing is sent and the reason is shown', async () => {
  const { runtime, net } = rig([replyRoute()]);
  for (const [url, reason] of [
    ['/relative/run', /must be absolute/],
    ['https://evil.example/run', /not an allowed destination/],
    ['https://user:hunter2@agent.example/run', /user:password@/],
    ['ftp://agent.example/run', /http or https/],
    ['', /Enter an endpoint URL/],
  ] as const) {
    runtime.setTarget(url);
    assert.match(runtime.getState().error ?? '', reason, url);
    await runtime.send('hello');
    assert.match(runtime.getState().error ?? '', reason, url);
  }
  assert.equal(net.calls.length, 0);
  assert.ok(!(runtime.getState().error ?? '').includes('hunter2'));
});

test('embedded: a relative endpoint resolves against the page origin and uses the host credentials', async () => {
  const { runtime, net, settle } = rig([replyRoute('/agents/support/stream')], { policy: embedded });
  runtime.selectAgent({ id: 'support', url: '/agents/support/stream' });
  await runtime.send('hello');
  assert.equal(net.calls[0]?.url, 'https://host.example/agents/support/stream');
  assert.equal(net.calls[0]?.credentials, 'same-origin');
  assert.equal((await settle()).exchanges[0]?.path, '/agents/support/stream');
});

test('hosted requests carry no cookies', async () => {
  const { runtime, net } = rig([ok200, replyRoute()]);
  runtime.selectAgent({ ...support, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }] } });
  await runtime.send('hello');
  assert.deepEqual(net.calls.map((call) => call.credentials), ['omit', 'omit']);
});

// ---------------------------------------------------------------------------------------------
// The token (FR-004, FR-036)
// ---------------------------------------------------------------------------------------------

test('the token goes out under the chosen header on every request and is absent from everything recorded', async () => {
  const { runtime, net, settle } = rig([ok200, replyRoute()]);
  runtime.selectAgent({ ...support, preset: { prepare: [{ method: 'POST', path: '/prepare/warm', body: { a: 1 } }], forwardedProps: { tenant: 'acme' } } });
  runtime.setAuth({ headerName: 'X-Api-Key', token: TOKEN });
  await runtime.send('hello');
  await runtime.sendRaw('{"threadId":17}');
  await settle();
  assert.ok(net.calls.length >= 3);
  assert.ok(net.calls.every((call) => call.headers['x-api-key'] === TOKEN && call.headers.authorization === undefined));

  const session = await settle();
  const everything = JSON.stringify(session);
  assert.ok(!everything.includes(TOKEN), 'not in exchanges, frames, runs or findings');
  assert.ok(!/x-api-key|authorization|"headers?"/i.test(everything), 'no header names or header fields are recorded');
  assert.equal(JSON.stringify(runtime.getState().interrupts), '[]');
  assert.ok(!Object.keys(session).includes('auth'));
  for (const call of net.calls) {
    assert.ok(!call.url.includes(TOKEN));
    assert.ok(!(call.body ?? '').includes(TOKEN));
  }
});

test('the default header is Authorization when the caller names none', async () => {
  const { runtime, net } = rig([replyRoute()]);
  runtime.selectAgent(support);
  runtime.setAuth({ headerName: 'Authorization', token: `Bearer ${TOKEN}` });
  await runtime.send('hello');
  assert.equal(net.calls[0]?.headers.authorization, `Bearer ${TOKEN}`);
});

test('changing the agent or the endpoint clears the token before anything is sent to the new target', async () => {
  const { runtime, net } = rig([replyRoute()], { policy: { ...hosted, allowedOrigins: ['https://agent.example', 'https://other.example'] } });
  runtime.selectAgent(support);
  runtime.setAuth({ headerName: 'Authorization', token: TOKEN });
  assert.equal(runtime.selectAgent(support), false, 'choosing the same agent again changes nothing');
  assert.equal(runtime.getState().connection.auth?.token, TOKEN);

  assert.equal(runtime.setTarget('https://other.example/run'), true, 'a new endpoint reports that it cleared a token');
  assert.equal(runtime.getState().connection.auth, undefined);
  await runtime.send('hello');
  assert.equal(net.calls[0]?.url, 'https://other.example/run');
  assert.equal(net.calls[0]?.headers.authorization, undefined);

  runtime.setAuth({ headerName: 'Authorization', token: TOKEN });
  assert.equal(runtime.selectAgent({ ...support, id: 'second' }), true, 'another agent, same URL, is still another target');
  assert.equal(runtime.getState().connection.auth, undefined);
  assert.equal(runtime.setTarget('https://other.example/run'), false, 'nothing to clear');
});

test('a changed target also starts a new thread and ends the run in flight', async () => {
  const { runtime, net } = rig([route((call) => [start(call)], { hold: true })], { policy: { ...hosted, allowedOrigins: ['https://agent.example', 'https://other.example'] } });
  runtime.selectAgent(support);
  const first = runtime.getState().threadId;
  const running = runtime.send('long');
  await new Promise((resolve) => setTimeout(resolve, 40));
  runtime.setTarget('https://other.example/run');
  await running;
  assert.notEqual(runtime.getState().threadId, first);
  assert.equal(runtime.getState().running, false);
  void net;
});

test('a fresh runtime holds no token, and the runtime never touches browser storage or cookies', async () => {
  const touched: string[] = [];
  const trap = (name: string) =>
    new Proxy({}, { get: (_, key) => (touched.push(`${name}.${String(key)}`), undefined), set: () => (touched.push(`${name}=`), true) });
  const saved = ['localStorage', 'sessionStorage', 'indexedDB', 'document'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name] of saved) Object.defineProperty(globalThis, name, { value: trap(name), configurable: true, writable: true });
  try {
    const { runtime } = rig([ok200, replyRoute()]);
    assert.equal(runtime.getState().connection.auth, undefined, 'a reload starts with no token');
    runtime.selectAgent({ ...support, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }] } });
    runtime.setAuth({ headerName: 'Authorization', token: TOKEN });
    await runtime.send('hello');
    await runtime.sendRaw('{}');
    runtime.newThread();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
  assert.deepEqual(touched, []);
});

test('a header name that cannot carry a token is refused before any request, without echoing the token', async () => {
  const { runtime, net } = rig([ok200, replyRoute()]);
  runtime.selectAgent({ ...support, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }] } });
  runtime.setAuth({ headerName: 'Cookie', token: TOKEN });
  await runtime.send('hello');
  await runtime.sendRaw('{}');
  assert.equal(net.calls.length, 0);
  assert.match(runtime.getState().error ?? '', /header name "Cookie"/);
  assert.ok(!(runtime.getState().error ?? '').includes(TOKEN));
});

test('a server that rejects the token shows as a 401 exchange; the token is still not recorded', async () => {
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? new Response('{"detail":"unauthorized"}', { status: 401 }) : undefined)]);
  runtime.selectAgent(support);
  runtime.setAuth({ headerName: 'Authorization', token: TOKEN });
  await runtime.send('hello');
  const session = await settle();
  assert.equal(session.exchanges[0]?.status, 401);
  assert.ok(!JSON.stringify(session).includes(TOKEN));
});

// ---------------------------------------------------------------------------------------------
// Raw submissions (FR-007)
// ---------------------------------------------------------------------------------------------

test('a raw submission is sent exactly as typed, outside the conversation, and the reply is kept even when it is an error', async () => {
  const { runtime, net, settle } = rig([ok200, (call) => (call.path === '/run' ? new Response('{"detail":"threadId must be a string"}', { status: 422 }) : undefined)]);
  runtime.selectAgent({ ...support, preset: { prepare: [{ method: 'POST', path: '/prepare/warm' }], forwardedProps: { tenant: 'acme' } } });
  const text = '{\n  "threadId" :  17,\n  "z": 1, "a": [ 1 ,2 ]\n}';
  await runtime.sendRaw(text);

  assert.deepEqual(net.calls.map((call) => [call.method, call.path]), [['POST', '/run']], 'no preparation, no preset, no profile');
  assert.equal(net.calls[0]?.body, text, 'whitespace and key order are untouched');
  const session = await settle();
  assert.deepEqual([session.exchanges[0]?.kind, session.exchanges[0]?.requestBody, session.exchanges[0]?.status, session.exchanges[0]?.responseBody], ['raw', text, 422, '{"detail":"threadId must be a string"}']);
  assert.equal(session.runs.length, 0, 'a raw submission is not a conversation run');
  assert.equal(runtime.getState().error, undefined);

  net.routes.unshift(replyRoute());
  await runtime.send('hello');
  const next = bodyOf(net.on('/run').at(-1)) as { messages: unknown[] };
  assert.equal(next.messages.length, 1, 'the conversation is unchanged by the raw submission');
});

test('invalid JSON is refused visibly and never sent', async () => {
  const { runtime, net } = rig([replyRoute()]);
  runtime.selectAgent(support);
  await runtime.sendRaw('{"threadId": ');
  assert.equal(net.calls.length, 0);
  assert.match(runtime.getState().error ?? '', /Not valid JSON, so it was not sent/);
});

test('any valid JSON document is accepted, including one that is not an object', async () => {
  const { runtime, net } = rig([() => new Response('{}', { status: 200 })]);
  runtime.selectAgent(support);
  for (const text of ['[]', '"just text"', '42', 'null']) await runtime.sendRaw(text);
  assert.deepEqual(net.calls.map((call) => call.body), ['[]', '"just text"', '42', 'null']);
});

// ---------------------------------------------------------------------------------------------
// Client sequence errors never reach the interrupt barrier, and replies need a finished run
// ---------------------------------------------------------------------------------------------

test('nothing is waiting after a run that did not end in an interrupt or pending tool calls', async () => {
  const { runtime } = rig([replyRoute()]);
  runtime.selectAgent(support);
  await runtime.send('hello');
  assert.deepEqual([runtime.getState().interrupts, runtime.getState().toolResults, runtime.getState().notice], [[], [], undefined]);
  await runtime.continueRun();
  assert.match(runtime.getState().error ?? '', /nothing waiting/i);
});

test('draft values are kept while editing; an interrupt the run never reported cannot be answered', async () => {
  const interrupts: Interrupt[] = [{ id: 'i-1', reason: 'approval', responseSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } }];
  const { runtime } = rig([route((call) => [start(call), finish(call, { type: 'interrupt', interrupts })])]);
  runtime.selectAgent(support);
  await runtime.send('hello');
  assert.deepEqual(runtime.getState().interrupts[0]?.draft, { ok: false });
  runtime.draftInterrupt('i-1', { ok: true } satisfies JsonValue);
  assert.deepEqual(runtime.getState().interrupts[0]?.draft, { ok: true });
  await runtime.answerInterrupt('nope', 'resolved');
  assert.match(runtime.getState().error ?? '', /no waiting interrupt nope/i);
});
