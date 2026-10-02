// L02 T026 (US4.3, FR-028): preparation plans run in declared order before every ordinary run and
// every continuation, each as a recorded exchange, and any failure stops the sequence before the agent
// request is sent. The first half drives the executor alone; the second half drives the runtime.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interrupt } from '@ag-ui/core';
import type { JsonValue, PreparationRequest } from '../../src/contracts.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createGuardedTransport } from '../../src/core/runtime/transport.ts';
import { runPreparations } from '../../src/core/runtime/prepare.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { AGENT, bodyOf, embedded, eventStream, hosted, ok200, replyRoute, rig, scriptedNetwork, sse, type Route } from './support.ts';

const TOKEN = 'synthetic-token-7f3a91';

function executor(routes: Route[], policy = hosted) {
  const net = scriptedNetwork(routes);
  const store = createSessionStore({ schedule: (callback) => queueMicrotask(callback) });
  const recorder = createRecorder(createFrameSink(store));
  const transport = createGuardedTransport(policy, { fetch: net.fetch });
  const run = (plan: readonly PreparationRequest[], extra: Partial<Parameters<typeof runPreparations>[1]> = {}) =>
    runPreparations(plan, { recorder, transport, baseUrl: AGENT, ...extra });
  const settle = async () => {
    for (let i = 0; i < 100; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (store.snapshot().exchanges.every((exchange) => exchange.transport !== 'sending' && exchange.transport !== 'reading')) break;
    }
    return store.snapshot();
  };
  return { net, store, run, settle };
}

const plan: PreparationRequest[] = [
  { method: 'PUT', path: '/prepare/sessions/t-1', body: { user: 'u-1', seed: { plan: 'free' } } },
  { method: 'POST', path: '/prepare/warm' },
  { method: 'POST', path: '/prepare/last', body: [1, 2] },
];

test('every preparation is sent in declared order and recorded as an exchange with its exact body', async () => {
  const { net, run, settle } = executor([ok200]);
  assert.deepEqual(await run(plan), { ok: true, value: undefined });
  assert.deepEqual(net.calls.map((call) => `${call.method} ${call.path}`), ['PUT /prepare/sessions/t-1', 'POST /prepare/warm', 'POST /prepare/last']);

  const { exchanges } = await settle();
  assert.deepEqual(exchanges.map((exchange) => [exchange.kind, exchange.method, exchange.path, exchange.status, exchange.transport]), [
    ['preparation', 'PUT', '/prepare/sessions/t-1', 200, 'completed'],
    ['preparation', 'POST', '/prepare/warm', 200, 'completed'],
    ['preparation', 'POST', '/prepare/last', 200, 'completed'],
  ]);
  assert.equal(exchanges[0]?.requestBody, '{"user":"u-1","seed":{"plan":"free"}}');
  assert.deepEqual(exchanges[0]?.requestBodyJson, { user: 'u-1', seed: { plan: 'free' } });
  assert.equal(exchanges[1]?.requestBody, undefined, 'a preparation without a body sends none');
  assert.equal(exchanges[2]?.requestBody, '[1,2]');
  assert.equal(exchanges[0]?.responseBody, '{"ok":true}', 'the reply stays available for inspection');
  assert.equal(net.calls[1]?.body, undefined);
});

test('each step starts only after the one before it has answered', async () => {
  const order: string[] = [];
  const slow: Route = async (call) => {
    order.push(`start ${call.path}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push(`end ${call.path}`);
    return new Response('{}', { status: 200 });
  };
  const { run } = executor([slow]);
  await run([{ method: 'POST', path: '/prepare/a' }, { method: 'POST', path: '/prepare/b' }]);
  assert.deepEqual(order, ['start /prepare/a', 'end /prepare/a', 'start /prepare/b', 'end /prepare/b']);
});

test('an empty plan sends and records nothing', async () => {
  const { net, run, store } = executor([ok200]);
  assert.deepEqual(await run([]), { ok: true, value: undefined });
  assert.equal(net.calls.length, 0);
  assert.equal(store.snapshot().exchanges.length, 0);
});

test('an error status stops the sequence: later steps are not sent and the failing exchange keeps status and body', async () => {
  const { net, run, settle } = executor([(call) => (call.path === '/prepare/warm' ? new Response('{"error":"quota"}', { status: 503 }) : undefined), ok200]);
  const result = await run(plan);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /Preparation failed: POST \/prepare\/warm answered 503/);
  assert.match(result.ok ? '' : result.error, /run was not sent/i);
  assert.equal(net.calls.length, 2, 'the third preparation was never sent');

  const { exchanges } = await settle();
  assert.deepEqual(exchanges.map((exchange) => [exchange.path, exchange.status]), [['/prepare/sessions/t-1', 200], ['/prepare/warm', 503]]);
  assert.equal(exchanges[1]?.responseBody, '{"error":"quota"}');
});

test('a connection failure stops the sequence and is recorded as a transport error', async () => {
  const { net, run, settle } = executor([
    (call) => {
      if (call.path === '/prepare/warm') throw new TypeError('Failed to fetch');
      return undefined;
    },
    ok200,
  ]);
  const result = await run(plan);
  assert.match(result.ok ? '' : result.error, /Preparation failed: POST \/prepare\/warm: The browser could not complete the request/);
  assert.equal(net.calls.length, 2);
  const session = await settle();
  assert.equal(session.exchanges[1]?.transport, 'transport-error');
  assert.ok(session.findings.some((finding) => finding.kind === 'transport'));
});

test('a redirect answer fails the preparation instead of being followed', async () => {
  const { net, run } = executor([() => new Response(null, { status: 307, headers: { location: 'https://evil.example/x' } })]);
  const result = await run(plan);
  assert.match(result.ok ? '' : result.error, /Preparation failed: PUT \/prepare\/sessions\/t-1: .*redirect/i);
  assert.equal(net.calls.length, 1);
});

test('a preparation aimed outside the allowlist fails without a request', async () => {
  const { net, run, settle } = executor([ok200]);
  const result = await run([{ method: 'POST', path: 'https://evil.example/prepare/x' }]);
  assert.match(result.ok ? '' : result.error, /not an allowed destination/);
  assert.equal(net.calls.length, 0);
  assert.equal((await settle()).exchanges[0]?.transport, 'transport-error', 'the refusal is visible as an exchange');
});

test('relative paths start from the agent target, so hosted preparations reach the agent origin', async () => {
  const { net, run } = executor([ok200]);
  await run([{ method: 'POST', path: '/prepare/x?mode=1' }], { baseUrl: 'https://agent.example/agents/support/stream' });
  assert.equal(net.calls[0]?.url, 'https://agent.example/prepare/x?mode=1');
  const embeddedRun = executor([ok200], embedded);
  await embeddedRun.run([{ method: 'POST', path: '/prepare/x' }], { baseUrl: 'https://host.example/agents/support/stream' });
  assert.equal(embeddedRun.net.calls[0]?.url, 'https://host.example/prepare/x');
  assert.equal(embeddedRun.net.calls[0]?.credentials, 'same-origin');
});

test('the token rides on preparations as a header and appears nowhere in what is recorded', async () => {
  const { net, run, settle } = executor([ok200]);
  await run(plan, { auth: { headerName: 'X-Api-Key', token: TOKEN } });
  assert.ok(net.calls.every((call) => call.headers['x-api-key'] === TOKEN));
  const session = await settle();
  assert.ok(!JSON.stringify(session).toLowerCase().includes(TOKEN.toLowerCase()));
  assert.ok(!/x-api-key|authorization/i.test(JSON.stringify(session)), 'no header names are recorded');
});

test('a stop during a preparation records it as stopped and ends the sequence', async () => {
  const controller = new AbortController();
  const hang: Route = (call) => {
    if (call.path !== '/prepare/warm') return undefined;
    queueMicrotask(() => controller.abort());
    return new Promise<Response>((_, reject) => call.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  };
  const { net, run, settle } = executor([hang, ok200]);
  const result = await run(plan, { signal: controller.signal });
  assert.match(result.ok ? '' : result.error, /Stopped during preparation: POST \/prepare\/warm/);
  assert.equal(net.calls.length, 2);
  assert.equal((await settle()).exchanges[1]?.transport, 'user-stopped');
});

// ---------------------------------------------------------------------------------------------
// Through the runtime: before every ordinary run and every continuation
// ---------------------------------------------------------------------------------------------

const agent = {
  id: 'support',
  url: AGENT,
  preset: {
    variables: { user: { default: 'u-{{uuid}}' }, seed: { default: { plan: 'free' }, type: 'json' as const } },
    forwardedProps: { user: '{{user}}' },
    prepare: [
      { method: 'PUT', path: '/prepare/sessions/{{threadId}}', body: { user: '{{user}}', seed: '{{seed}}' } },
      { method: 'POST', path: '/prepare/warm', body: { run: '{{runId}}' } },
    ],
  },
} as const;

test('an ordinary run is preceded by its resolved preparations, in order, and then sent', async () => {
  const { runtime, net, settle } = rig([ok200, replyRoute()]);
  runtime.selectAgent(agent);
  await runtime.send('hello');
  assert.deepEqual(net.calls.map((call) => `${call.method} ${call.path}`), ['PUT /prepare/sessions/' + runtime.getState().threadId, 'POST /prepare/warm', 'POST /run']);

  const session = await settle();
  assert.deepEqual(session.exchanges.map((exchange) => exchange.kind), ['preparation', 'preparation', 'conversation']);
  const run = bodyOf(net.calls[2]);
  const first = bodyOf(net.calls[0]) as { user: string; seed: JsonValue };
  assert.deepEqual(first.seed, { plan: 'free' }, 'a whole-value JSON variable keeps its type');
  assert.match(first.user, /^u-id\d+-\d+$/);
  assert.deepEqual(bodyOf(net.calls[1]), { run: (run as { runId: string }).runId });
  assert.deepEqual((run as { forwardedProps: unknown }).forwardedProps, { user: first.user }, 'the uuid is one value across preparations and properties');
});

test('a failed preparation fails the run visibly and the agent request is never sent', async () => {
  const { runtime, net, settle } = rig([(call) => (call.path === '/prepare/warm' ? new Response('no', { status: 500 }) : undefined), ok200, replyRoute()]);
  runtime.selectAgent(agent);
  await runtime.send('hello');
  assert.deepEqual(net.calls.map((call) => call.path.replace(/\/sessions\/.*/, '/sessions/_')), ['/prepare/sessions/_', '/prepare/warm']);
  assert.match(runtime.getState().error ?? '', /Preparation failed: POST \/prepare\/warm answered 500.*run was not sent/);
  assert.equal(runtime.getState().running, false);
  const session = await settle();
  assert.deepEqual(session.exchanges.map((exchange) => exchange.kind), ['preparation', 'preparation']);
  assert.equal(session.runs.length, 0, 'no run record exists for a run that was never sent');
});

test('a failed preparation leaves the transcript as it was: the unsent message is not part of the next run', async () => {
  let failing = true;
  const { runtime, net } = rig([(call) => (failing && call.path === '/prepare/warm' ? new Response('no', { status: 500 }) : undefined), ok200, replyRoute()]);
  runtime.selectAgent(agent);
  await runtime.send('first try');
  failing = false;
  await runtime.send('second try');
  const run = bodyOf(net.on('/run').at(-1)) as { messages: Array<{ content: string }> };
  assert.deepEqual(run.messages.map((message) => message.content), ['second try']);
});

test('a preset that cannot be resolved fails visibly before any request, including a preparation', async () => {
  const { runtime, net } = rig([ok200, replyRoute()]);
  runtime.selectAgent({ id: 'ghost', url: AGENT, preset: { prepare: [{ method: 'POST', path: '/prepare/{{nobody}}' }] } });
  await runtime.send('hello');
  assert.equal(net.calls.length, 0);
  assert.match(runtime.getState().error ?? '', /undefined variable "nobody"/);
});

function interruptRoute(interrupts: Interrupt[]): Route {
  return (call) => {
    if (call.path !== '/run') return undefined;
    const input = bodyOf(call) as { threadId: string; runId: string; resume?: unknown[] };
    const events =
      input.resume === undefined
        ? [{ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId }, { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome: { type: 'interrupt', interrupts } }]
        : [{ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId }, { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome: { type: 'success' } }];
    return eventStream(sse(events));
  };
}

test('a continuation runs the preparations again, and when one fails the resume run is not sent and can be retried', async () => {
  let failing = false;
  const { runtime, net, settle } = rig([(call) => (failing && call.path === '/prepare/warm' ? new Response('no', { status: 502 }) : undefined), ok200, interruptRoute([{ id: 'i-1', reason: 'approval' }])]);
  runtime.selectAgent(agent);
  await runtime.send('please approve');
  assert.equal(runtime.getState().interrupts.length, 1);
  assert.equal(net.on('/run').length, 1);
  assert.equal(net.on('/prepare/warm').length, 1);

  failing = true;
  runtime.draftInterrupt('i-1', { approved: true });
  await runtime.answerInterrupt('i-1', 'resolved');
  assert.equal(net.on('/prepare/warm').length, 2, 'the continuation prepares again');
  assert.equal(net.on('/run').length, 1, 'the resume run was not sent');
  assert.match(runtime.getState().error ?? '', /Preparation failed: POST \/prepare\/warm answered 502/);
  assert.deepEqual(runtime.getState().interrupts.map((interrupt) => interrupt.status), ['resolved'], 'the answers are kept');

  failing = false;
  await runtime.continueRun();
  assert.equal(net.on('/prepare/warm').length, 3);
  assert.equal(net.on('/run').length, 2);
  const resume = bodyOf(net.on('/run')[1]) as { resume: unknown; parentRunId: string };
  assert.deepEqual(resume.resume, [{ interruptId: 'i-1', status: 'resolved', payload: { approved: true } }]);

  const session = await settle();
  assert.deepEqual(session.exchanges.map((exchange) => `${exchange.kind}:${exchange.status}`), [
    'preparation:200', 'preparation:200', 'conversation:200', // first run
    'preparation:200', 'preparation:502', //                      the failed continuation: preserved, no run
    'preparation:200', 'preparation:200', 'conversation:200', //  the retry
  ]);
});
