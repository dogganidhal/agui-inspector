// Spec 014 (FR-008 to FR-013, FR-016; stories 2 and 3): the runtime with a real plugin host. A run hook may replace the
// input before the preparations, and what is sent is what is recorded. Header providers are asked before each
// preparation, run and raw request, never for configuration, and what they return reaches fetch and nothing else. A
// failure of either stops that one request, records nothing for it and leaves what the run was waiting for in place.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Interrupt } from '@ag-ui/core';
import type { BeforeRunHook, HeaderProvider, PluginApi } from '../../src/contracts.ts';
import { createPluginHost, type PluginHost } from '../../src/core/plugins/index.ts';
import { serializeSession } from '../../src/core/session-files/index.ts';
import { AGENT, bodyOf, eventStream, replyRoute, rig, sse, type Call, type Route } from './support.ts';

const PAGE = { origin: 'https://inspector.example', baseUrl: 'https://inspector.example/' };
const SECRET = 'synthetic-signature-7f3a91';
const TOKEN = 'synthetic-token-7f3a91';
const label = (name: string) => `/plugins/${name}.js`;

/** A host with one plugin per entry. */
async function plugins(entries: Record<string, (api: PluginApi) => void>): Promise<PluginHost> {
  const host = createPluginHost();
  await host.load(Object.keys(entries).map((name) => `https://inspector.example${label(name)}`), async (address) => ({ default: entries[address.slice('https://inspector.example/plugins/'.length, -'.js'.length)] }), PAGE);
  assert.deepEqual(host.warnings(), [], 'the plugins loaded');
  return host;
}

const agent = (prepare: Array<{ method: string; path: string; body?: unknown }> = []) => ({ id: 'support', name: 'Support', url: AGENT, ...(prepare.length > 0 && { preset: { prepare } }) }) as never;
const runCalls = (calls: readonly Call[]) => calls.filter((call) => call.path === '/run');
const interruptRoute = (): Route => {
  let first = true;
  return (call) => {
    if (call.path !== '/run') return undefined;
    const input = bodyOf(call) as { threadId: string; runId: string };
    const interrupts: Interrupt[] = [{ id: 'i1', reason: 'input', message: 'Which one?' }];
    const outcome = first ? { type: 'interrupt', interrupts } : { type: 'success' };
    first = false;
    return eventStream(sse([{ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId }, { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome }]));
  };
};
const ok200: Route = (call) => (call.path.startsWith('/prepare/') ? new Response('{"ok":true}', { status: 200 }) : undefined);
const never = () => new Promise<never>(() => undefined);

// ---------------------------------------------------------------------------------------------
// Header providers
// ---------------------------------------------------------------------------------------------

test('a provider is asked for each preparation, the run and a raw request, with that request\'s method, address and exact body, and the headers reach fetch', async () => {
  const asked: Array<{ method: string; url: string; body?: string }> = [];
  const host = await plugins({ sign: (api) => api.provideHeaders(({ method, url, body }) => (asked.push({ method, url, ...(body !== undefined && { body }) }), { 'X-Signature': `sig-${asked.length}` })) });
  const { runtime, net, settle } = rig([ok200, replyRoute('/run', 'hello')], { plugins: host });
  runtime.selectAgent(agent([{ method: 'PUT', path: '/prepare/a', body: { x: 1 } }, { method: 'POST', path: '/prepare/b' }]));
  await runtime.send('hi');
  await runtime.sendRaw('{"threadId":"t","runId":"r"}');
  await settle();

  const run = runCalls(net.calls)[0];
  assert.deepEqual(asked.map((entry) => [entry.method, entry.url, entry.body]), [
    ['PUT', 'https://agent.example/prepare/a', '{"x":1}'],
    ['POST', 'https://agent.example/prepare/b', undefined],
    ['POST', AGENT, run?.body],
    ['POST', AGENT, '{"threadId":"t","runId":"r"}'],
  ]);
  assert.deepEqual(net.calls.map((call) => call.headers['x-signature']), ['sig-1', 'sig-2', 'sig-3', 'sig-4']);
  assert.equal(runtime.getState().error, undefined);
});

test('it is not asked for a request made through runtime.transport, which is how configuration and capabilities load', async () => {
  let asked = 0;
  const host = await plugins({ sign: (api) => api.provideHeaders(() => void (asked += 1)) });
  const { runtime, net } = rig([(call) => (call.path === '/config.json' ? new Response('{}', { status: 200 }) : undefined)], { plugins: host });
  await runtime.transport.send({ url: 'https://inspector.example/config.json', method: 'GET', responseKind: 'response' });
  assert.equal(asked, 0);
  assert.deepEqual(Object.keys(net.calls[0]?.headers ?? {}), ['accept']);
});

test('a provider that answers differently each time gives two runs two values, and the typed token replaces a header of its name', async () => {
  let n = 0;
  const host = await plugins({ sign: (api) => api.provideHeaders(() => ({ 'X-Signature': `${SECRET}-${++n}`, 'X-Other': 'kept' })) });
  const { runtime, net } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('one');
  await runtime.send('two');
  assert.deepEqual(runCalls(net.calls).map((call) => call.headers['x-signature']), [`${SECRET}-1`, `${SECRET}-2`]);
  runtime.setAuth({ headerName: 'x-signature', token: TOKEN });
  await runtime.send('three');
  const third = runCalls(net.calls)[2];
  assert.equal(third?.headers['x-signature'], TOKEN, 'the typed token wins');
  assert.equal(third?.headers['x-other'], 'kept');
});

test('a provider failure on the run stops it: nothing is sent or recorded for it, the message names the plugin, and the owed answers survive for a retry', async () => {
  let failing = false;
  const host = await plugins({ sign: (api) => api.provideHeaders(() => { if (failing) throw new Error('no key today'); return { 'X-Signature': SECRET }; }) });
  const { runtime, net, session, settle } = rig([interruptRoute()], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('start');
  await settle();
  assert.equal(runtime.getState().interrupts.length, 1);
  const exchanges = session().exchanges.length;

  failing = true;
  await runtime.answerInterrupt('i1', 'cancelled');
  assert.equal(runCalls(net.calls).length, 1, 'the continuation was not sent');
  assert.equal(session().exchanges.length, exchanges, 'no exchange for a request that was never sent');
  assert.equal(runtime.getState().error, `Plugin ${label('sign')} could not provide headers: no key today`);
  assert.equal(runtime.getState().running, false);
  assert.deepEqual(runtime.getState().interrupts.map((entry) => [entry.interruptId, entry.status]), [['i1', 'cancelled']], 'the answer is still there');
  assert.deepEqual(host.warnings(), [`${label('sign')}: provideHeaders threw: no key today`]);

  failing = false;
  await runtime.continueRun();
  await settle();
  assert.equal(runCalls(net.calls).length, 2, 'the retry sends it');
  assert.equal(runtime.getState().error, undefined);
});

test('a provider failure on a preparation is the usual preparation failure, and the run is not sent', async () => {
  const host = await plugins({ sign: (api) => api.provideHeaders(({ url }) => { if (url.endsWith('/prepare/b')) throw new Error('nope'); return {}; }) });
  const { runtime, net, session, settle } = rig([ok200, replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent([{ method: 'POST', path: '/prepare/a' }, { method: 'POST', path: '/prepare/b' }]));
  await runtime.send('hi');
  await settle();
  assert.equal(runtime.getState().error, `Preparation failed: POST /prepare/b: Plugin ${label('sign')} could not provide headers: nope. The run was not sent.`);
  assert.deepEqual(net.calls.map((call) => call.path), ['/prepare/a']);
  assert.equal(session().exchanges.length, 1);
});

test('a provider failure on a raw request sends and records nothing and shows the error', async () => {
  const host = await plugins({ sign: (api) => api.provideHeaders(() => { throw new Error('nope'); }) });
  const { runtime, net, session } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.sendRaw('{"threadId":"t","runId":"r"}');
  assert.deepEqual(net.calls, []);
  assert.deepEqual(session().exchanges, []);
  assert.equal(runtime.getState().error, `Plugin ${label('sign')} could not provide headers: nope`);
});

test('an invalid header from a provider stops the request and the message holds the name and not the value', async () => {
  const host = await plugins({ sign: (api) => api.provideHeaders(() => ({ Accept: SECRET })) });
  const { runtime, net } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('hi');
  assert.deepEqual(net.calls, []);
  const message = runtime.getState().error ?? '';
  assert.ok(message.includes('"Accept"') && !message.includes(SECRET), message);
});

test('Stop while a provider works sends nothing and reports nothing', async () => {
  const host = await plugins({ sign: (api) => api.provideHeaders(() => never()) });
  const { runtime, net, session } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  const sending = runtime.send('hi');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(runtime.getState().running, true);
  runtime.stop();
  await sending;
  assert.deepEqual(net.calls, []);
  assert.deepEqual(session().exchanges, []);
  assert.deepEqual(host.warnings(), []);
  assert.equal(runtime.getState().running, false);
});

test('the value of a provider header is in fetch and in nothing the inspector keeps: not the store, the session file, the runtime state or the recorded request', async () => {
  const host = await plugins({ sign: (api) => api.provideHeaders(() => ({ 'X-Signature': SECRET })) });
  const { runtime, net, session, settle } = rig([ok200, replyRoute('/run', `the reply does not echo it`)], { plugins: host });
  runtime.selectAgent(agent([{ method: 'POST', path: '/prepare/a' }]));
  await runtime.send('hi');
  await runtime.sendRaw('{"threadId":"t","runId":"r"}');
  const settled = await settle();
  assert.deepEqual(net.calls.map((call) => call.headers['x-signature']), [SECRET, SECRET, SECRET], 'the target received it each time');
  for (const [name, text] of [['the store', JSON.stringify(settled)], ['the session file', serializeSession(session())], ['the runtime state', JSON.stringify(runtime.getState())], ['the host', JSON.stringify([host.warnings(), host.count()])]] as const) {
    assert.ok(!text.includes(SECRET), `${name} holds the value`);
  }
  const exchange = settled.exchanges.find((entry) => entry.kind === 'conversation');
  assert.equal(exchange?.requestBody, runCalls(net.calls)[0]?.body, 'the recorded body is the sent body');
  assert.equal(JSON.stringify(settled.runs[0]?.input), runCalls(net.calls)[0]?.body);
});

test('a profile that asks for protobuf keeps its Accept header: the provider\'s other headers ride along, and one that returns Accept stops the request', async () => {
  const media = 'application/vnd.ag-ui.event+proto';
  const good = await plugins({ sign: (api) => api.provideHeaders(() => ({ 'X-Signature': SECRET })) });
  const profile = { ...rigProfile(), encoding: 'protobuf' as const };
  const a = rig([replyRoute('/run')], { plugins: good, settings: { profile } });
  a.runtime.selectAgent(agent());
  await a.runtime.send('hi');
  assert.equal(runCalls(a.net.calls)[0]?.headers.accept, media);
  assert.equal(runCalls(a.net.calls)[0]?.headers['x-signature'], SECRET);

  const bad = await plugins({ sign: (api) => api.provideHeaders(() => ({ Accept: 'text/event-stream' })) });
  const b = rig([replyRoute('/run')], { plugins: bad, settings: { profile } });
  b.runtime.selectAgent(agent());
  await b.runtime.send('hi');
  assert.deepEqual(b.net.calls, [], 'nothing is sent that asks for another encoding');
  assert.match(b.runtime.getState().error ?? '', /"Accept"/);
});

// ---------------------------------------------------------------------------------------------
// The run hook
// ---------------------------------------------------------------------------------------------

test('a hook that adds a property changes what is sent, and the recorded exchange and run input are that body', async () => {
  const host = await plugins({ add: (api) => api.beforeRun((run) => ({ ...run.input, forwardedProps: { ...run.input.forwardedProps, example: 1 } })) });
  const { runtime, net, session, settle } = rig([replyRoute('/run', 'reply')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('hi');
  const settled = await settle();
  const sent = runCalls(net.calls)[0];
  assert.equal((bodyOf(sent)?.forwardedProps as Record<string, unknown>).example, 1);
  const [exchange] = settled.exchanges;
  assert.equal(exchange?.requestBody, sent?.body, 'the recording shows what was sent');
  assert.deepEqual(settled.runs[0]?.input, bodyOf(sent));
  assert.deepEqual(settled.frames.map((frame) => frame.eventType), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED'], 'the frames are recorded as received');
  assert.equal(session().runs[0]?.outcome.kind, 'success');
});

test('a hook that returns nothing keeps the input, and two hooks run in order', async () => {
  const order: string[] = [];
  const host = await plugins({
    first: (api) => {
      api.beforeRun(() => void order.push('first-nothing'));
      api.beforeRun((run) => (order.push('first'), { ...run.input, forwardedProps: { a: 1 } }));
    },
    second: (api) => api.beforeRun((run) => (order.push('second'), { ...run.input, forwardedProps: { ...run.input.forwardedProps, b: (run.input.forwardedProps as { a: number }).a + 1 } })),
  });
  const { runtime, net } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('hi');
  assert.deepEqual(order, ['first-nothing', 'first', 'second']);
  assert.deepEqual(bodyOf(runCalls(net.calls)[0])?.forwardedProps, { a: 1, b: 2 });

  const none = await plugins({ none: (api) => api.beforeRun(() => undefined) });
  const plain = rig([replyRoute('/run')], { plugins: none });
  plain.runtime.selectAgent(agent());
  await plain.runtime.send('hi');
  const bare = rig([replyRoute('/run')]);
  bare.runtime.selectAgent(agent());
  await bare.runtime.send('hi');
  const strip = (call: Call | undefined) => ({ ...bodyOf(call), threadId: 0, runId: 0, messages: (bodyOf(call)?.messages as Array<Record<string, unknown>>).map((message) => ({ ...message, id: 0 })) });
  assert.deepEqual(strip(runCalls(plain.net.calls)[0]), strip(runCalls(bare.net.calls)[0]));
});

test('a hook that throws, rejects, returns an invalid input or changes an id stops the run: nothing is sent, no preparation, no exchange, a message that names the plugin, and the owed answers survive', async () => {
  const hooks: Array<[string, (run: Parameters<BeforeRunHook>[0]) => unknown, RegExp]> = [
    ['throws', () => { throw new Error('not on prod'); }, /^Plugin \/plugins\/throws\.js stopped the run in beforeRun: not on prod$/],
    ['rejects', async () => { throw new Error('not on prod'); }, /not on prod$/],
    ['invalid', () => ({ nope: true }), /returned an invalid input: Run input is invalid/],
    ['thread', (run) => ({ ...run.input, threadId: 'other' }), /changed threadId or runId/],
    ['run', (run) => ({ ...run.input, runId: 'other' }), /changed threadId or runId/],
  ];
  for (const [name, hook, text] of hooks) {
    let failing = false;
    const host = await plugins({ [name]: (api) => api.beforeRun(((run: Parameters<BeforeRunHook>[0]) => (failing ? hook(run) : undefined)) as BeforeRunHook) });
    const { runtime, net, session, settle } = rig([ok200, interruptRoute()], { plugins: host });
    runtime.selectAgent(agent([{ method: 'POST', path: '/prepare/a' }]));
    await runtime.send('start');
    await settle();
    const before = [net.calls.length, session().exchanges.length];

    failing = true;
    await runtime.answerInterrupt('i1', 'cancelled');
    assert.deepEqual([net.calls.length, session().exchanges.length], before, `${name}: nothing sent, no preparation, no exchange`);
    assert.match(runtime.getState().error ?? '', text, name);
    assert.ok((runtime.getState().error ?? '').includes(label(name)), name);
    assert.deepEqual(runtime.getState().interrupts.map((entry) => entry.status), ['cancelled'], `${name}: the answer is kept`);
    assert.equal(host.warnings().length, 1, name);

    failing = false;
    await runtime.continueRun();
    await settle();
    assert.equal(runCalls(net.calls).length, 2, `${name}: the retry sends it`);
  }
});

test('Stop while a hook works sends nothing and reports nothing', async () => {
  const host = await plugins({ slow: (api) => api.beforeRun(() => never()) });
  const { runtime, net } = rig([ok200, replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent([{ method: 'POST', path: '/prepare/a' }]));
  const sending = runtime.send('hi');
  await new Promise((resolve) => setTimeout(resolve, 20));
  runtime.stop();
  await sending;
  assert.deepEqual(net.calls, []);
  assert.deepEqual(host.warnings(), []);
  assert.equal(runtime.getState().running, false);
});

test('an automatic continuation calls the hook too, and a failing hook ends the chain', async () => {
  let calls = 0;
  const host = await plugins({ count: (api) => api.beforeRun(() => { calls += 1; if (calls === 2) throw new Error('second run refused'); }) });
  const { runtime, net, settle } = rig([interruptRoute()], { plugins: host, settings: { profile: { ...rigProfile(), interruptReply: 'cancel' } } });
  runtime.selectAgent(agent());
  await runtime.send('start');
  await settle();
  assert.equal(calls, 2, 'the hook ran for the run and for the automatic continuation');
  assert.equal(runCalls(net.calls).length, 1, 'the refused continuation was not sent');
  assert.ok((runtime.getState().error ?? '').includes('second run refused'));
});

function rigProfile() {
  return rig([]).settings.current.profile;
}

test('a raw submission is not offered to a hook and goes out unchanged', async () => {
  let calls = 0;
  const host = await plugins({ count: (api) => api.beforeRun(() => void (calls += 1)) });
  const { runtime, net } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  const text = '{ "threadId": "t",\n  "runId": "r" }';
  await runtime.sendRaw(text);
  assert.equal(calls, 0);
  assert.equal(net.calls[0]?.body, text);
});

test('the hook gets the selected agent\'s id and the address, and no id for a typed endpoint', async () => {
  const seen: Array<{ agentId?: string; url: string }> = [];
  const host = await plugins({ look: (api) => api.beforeRun(({ agentId, url }) => void seen.push({ ...(agentId !== undefined && { agentId }), url })) });
  const { runtime } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('one');
  runtime.setTarget(AGENT);
  await runtime.send('two');
  assert.deepEqual(seen, [{ agentId: 'support', url: AGENT }, { url: AGENT }]);
});

test('what a hook returns changes the request only: the conversation the inspector keeps is untouched', async () => {
  let first = true;
  const host = await plugins({ trim: (api) => api.beforeRun((run) => { if (!first) return undefined; first = false; return { ...run.input, messages: [] }; }) });
  const { runtime, net } = rig([replyRoute('/run', 'reply')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('one');
  await runtime.send('two');
  assert.deepEqual(bodyOf(runCalls(net.calls)[0])?.messages, [], 'the first request went out with the history the hook left');
  const second = bodyOf(runCalls(net.calls)[1])?.messages as Array<{ role: string }>;
  assert.deepEqual(second.map((message) => message.role), ['user', 'assistant', 'user'], 'the inspector still held the whole transcript');
});

test('a hook that keeps its argument or its result and changes it later changes neither the recorded input nor the next run', async () => {
  const kept: Array<Record<string, unknown>> = [];
  const host = await plugins({
    keep: (api) => api.beforeRun((run) => {
      const mine = { ...run.input, forwardedProps: { stable: 1 } };
      kept.push(run.input.forwardedProps as Record<string, unknown>, mine.forwardedProps);
      return mine;
    }),
  });
  const { runtime, net, settle } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('one');
  for (const object of kept) object.stable = 'changed';
  const settled = await settle();
  assert.deepEqual(settled.runs[0]?.input.forwardedProps, { stable: 1 });
  assert.deepEqual(bodyOf(runCalls(net.calls)[0])?.forwardedProps, { stable: 1 });
  await runtime.send('two');
  assert.deepEqual(bodyOf(runCalls(net.calls)[1])?.forwardedProps, { stable: 1 });
});

// A provider and a hook together on one run.
test('a hook and a provider on the same run each do their part', async () => {
  const host = await plugins({
    both: (api) => {
      api.beforeRun((run) => ({ ...run.input, forwardedProps: { signed: true } }));
      api.provideHeaders(({ body }) => ({ 'X-Body-Length': String(body?.length ?? 0) }));
    },
  });
  const { runtime, net } = rig([replyRoute('/run')], { plugins: host });
  runtime.selectAgent(agent());
  await runtime.send('hi');
  const run = runCalls(net.calls)[0];
  assert.deepEqual(bodyOf(run)?.forwardedProps, { signed: true });
  assert.equal(run?.headers['x-body-length'], String(run?.body?.length), 'the provider saw the adjusted body that was sent');
});

// Referenced so a typed provider and hook are kept in step with the contract.
const _types: [HeaderProvider | undefined, BeforeRunHook | undefined] = [undefined, undefined];
void _types;
