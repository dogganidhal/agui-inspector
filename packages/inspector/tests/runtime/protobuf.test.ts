// Spec 013 (US2, FR-001 to FR-005, FR-012; SC-005, SC-007): the runtime asks for the encoding that was chosen, on
// every kind of request that is a run, and the protocol client reads a protobuf answer exactly as received. The
// scripted agent answers in the encoding the Accept header asks for, as a server written with EventEncoder does.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat, garbageFrame } from '../../../../examples/reference-agent/protobuf-fixtures.ts';
import { frameProtobuf, PROTOBUF_MEDIA_TYPE } from '../../../../examples/reference-agent/protobuf.ts';
import type { A2uiAction, ClientProfileSettings, Encoding } from '../../src/contracts.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { canonicalizeLineEndings } from '../../src/core/runtime/line-endings.ts';
import { AGENT, bodyOf, eventStream, ok200, protobufBytes, protobufStream, rig, sse, type Call, type Route } from './support.ts';

const TOKEN = 'synthetic-token-7f3a91';
const JSON_ACCEPT = 'application/json, text/plain;q=0.9, */*;q=0.1';
const agent = { id: 'agent', name: 'Agent', url: AGENT } as const;

type Sent = { threadId: string; runId: string; messages?: Array<{ role: string; content?: string }>; resume?: unknown };
const inputOf = (call: Call | undefined) => bodyOf(call) as unknown as Sent;
const head = (call: Call) => ({ threadId: inputOf(call).threadId, runId: inputOf(call).runId });
const start = (call: Call) => ({ type: 'RUN_STARTED', ...head(call) });
const finish = (call: Call, outcome: object = { type: 'success' }) => ({ type: 'RUN_FINISHED', ...head(call), outcome });
const reply = (call: Call, text = 'server reply') => {
  const messageId = `m-${head(call).runId}`;
  return [
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text },
    { type: 'TEXT_MESSAGE_END', messageId },
  ];
};

const wantsProtobuf = (call: Call) => call.headers.accept === PROTOBUF_MEDIA_TYPE;
/** The agent: it answers in the encoding that the request's Accept names, with the events `events` gives for the call. */
const answering = (events: (call: Call) => object[]): Route => (call) =>
  call.path !== '/run' ? undefined : wantsProtobuf(call) ? protobufStream(events(call)) : eventStream(sse(events(call)));
const plain: Route = answering((call) => [start(call), ...reply(call), finish(call)]);

const withProfile = (patch: Partial<ClientProfileSettings>) => ({ profile: { ...defaultProfile(), ...patch } });
const fixedIds = () => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

const action: A2uiAction = { name: 'submit', surfaceId: 'form', sourceComponentId: 'send', context: { name: 'Ada' }, timestamp: '2026-10-04T10:00:00.000Z' };

// ---------------------------------------------------------------------------------------------
// What each request asks for
// ---------------------------------------------------------------------------------------------

test('with protobuf chosen, a run, a continuation after interrupts and after tool results, a surface action and a raw submission all ask for protobuf', async () => {
  const route = answering((call) => {
    const input = inputOf(call);
    const last = input.messages?.at(-1);
    if (input.resume !== undefined || last?.role === 'tool') return [start(call), ...reply(call), finish(call)];
    if (last?.content === 'ask') return [start(call), finish(call, { type: 'interrupt', interrupts: [{ id: 'i-1', reason: 'approval' }] })];
    if (last?.content === 'tool') {
      return [
        start(call),
        { type: 'TOOL_CALL_START', toolCallId: 'c-1', toolCallName: 'pick_color' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c-1', delta: '{"choices":["red"]}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c-1' },
        finish(call, { type: 'success', pendingToolCallIds: ['c-1'] }),
      ];
    }
    return [start(call), ...reply(call), finish(call)];
  });
  const { runtime, net, settle } = rig([ok200, route], { settings: withProfile({ encoding: 'protobuf' }) });
  runtime.selectAgent(agent);

  await runtime.send('ask');
  await runtime.answerInterrupt('i-1', 'resolved');
  runtime.newThread();
  await runtime.send('tool');
  runtime.draftToolResult('c-1', '"red"');
  await runtime.submitToolResult('c-1');
  runtime.newThread();
  await runtime.sendA2uiAction(action);
  await runtime.sendRaw('{"threadId":"t-raw","runId":"r-raw"}');

  const runs = net.on('/run');
  assert.equal(runs.length, 6, 'a run, its continuation, a run, its continuation, a surface action and a raw submission');
  assert.deepEqual(runs.map((call) => call.headers.accept), Array(6).fill(PROTOBUF_MEDIA_TYPE));
  assert.equal(inputOf(runs[1]).resume !== undefined, true, 'the second request is the continuation after the interrupt');
  assert.equal(inputOf(runs[3]).messages?.at(-1)?.role, 'tool', 'the fourth carries the tool result');

  const session = await settle();
  assert.deepEqual(session.exchanges.map((exchange) => exchange.encoding), Array(6).fill('protobuf'));
  assert.deepEqual(session.exchanges.map((exchange) => exchange.kind), ['conversation', 'conversation', 'conversation', 'conversation', 'conversation', 'raw']);
  assert.deepEqual(session.findings, []);
  assert.equal(session.frames.every((frame) => frame.bytes !== undefined), true);
});

test('with server-sent events chosen, or nothing chosen, every request asks as it did in 0.1.0', async () => {
  for (const settings of [{}, withProfile({ encoding: 'sse' })]) {
    const { runtime, net, settle } = rig([ok200, plain], { settings });
    runtime.selectAgent(agent);
    await runtime.send('hi');
    await runtime.sendRaw('{"threadId":"t","runId":"r"}');
    assert.deepEqual(net.on('/run').map((call) => call.headers.accept), ['text/event-stream', 'text/event-stream']);
    const session = await settle();
    assert.deepEqual(session.exchanges.map((exchange) => exchange.encoding), [undefined, undefined]);
  }
});

test('a preparation request keeps its JSON Accept while the run asks for the preset\'s protobuf default', async () => {
  const { runtime, net } = rig([ok200, plain]);
  runtime.selectAgent({ ...agent, preset: { encoding: 'protobuf', prepare: [{ method: 'PUT', path: '/prepare/warm' }] } });
  await runtime.send('hi');
  assert.equal(net.on('/prepare/warm')[0]?.headers.accept, JSON_ACCEPT);
  assert.equal(net.on('/run')[0]?.headers.accept, PROTOBUF_MEDIA_TYPE);
});

test('the profile beats the preset, which beats the default, and a raw submission follows the same order', async () => {
  const cases: Array<[string, Encoding | undefined, Encoding | undefined, string]> = [
    ['nothing set', undefined, undefined, 'text/event-stream'],
    ['preset protobuf', undefined, 'protobuf', PROTOBUF_MEDIA_TYPE],
    ['profile sse over preset protobuf', 'sse', 'protobuf', 'text/event-stream'],
    ['profile protobuf over preset sse', 'protobuf', 'sse', PROTOBUF_MEDIA_TYPE],
    ['profile protobuf alone', 'protobuf', undefined, PROTOBUF_MEDIA_TYPE],
  ];
  for (const [label, profileEncoding, presetEncoding, expected] of cases) {
    const { runtime, net } = rig([ok200, plain], { settings: withProfile(profileEncoding === undefined ? {} : { encoding: profileEncoding }) });
    runtime.selectAgent({ ...agent, ...(presetEncoding !== undefined && { preset: { encoding: presetEncoding } }) });
    await runtime.send('hi');
    await runtime.sendRaw('{"threadId":"t","runId":"r"}');
    assert.deepEqual(net.on('/run').map((call) => call.headers.accept), [expected, expected], label);
  }
});

test('a typed endpoint has no preset, so only the profile can choose protobuf', async () => {
  const { runtime, net } = rig([plain], { settings: withProfile({ encoding: 'protobuf' }) });
  runtime.setTarget(AGENT);
  await runtime.send('hi');
  assert.equal(net.on('/run')[0]?.headers.accept, PROTOBUF_MEDIA_TYPE);
});

test('the request body is the same with and without the setting, and a raw submission sends the typed text unchanged', async () => {
  const bodies: string[] = [];
  for (const settings of [{}, withProfile({ encoding: 'protobuf' })]) {
    const { runtime, net } = rig([plain], { settings, randomUUID: fixedIds() });
    runtime.selectAgent(agent);
    await runtime.send('same words');
    bodies.push(net.on('/run')[0]!.body!);
  }
  assert.equal(bodies[0], bodies[1], 'the encoding changes how the answer is asked for, never what is sent');

  const { runtime, net } = rig([plain], { settings: withProfile({ encoding: 'protobuf' }) });
  runtime.selectAgent(agent);
  const typed = '{ "threadId" :  "t-raw",\n "runId":"r-raw", "extra": [1 ,2] }';
  await runtime.sendRaw(typed);
  assert.equal(net.on('/run')[0]?.body, typed);
});

test('a change of encoding applies to the next request, the thread continues, and earlier exchanges keep their encoding', async () => {
  const { runtime, net, settings, settle } = rig([plain]);
  runtime.selectAgent(agent);
  await runtime.send('first');
  const thread = runtime.getState().threadId;
  settings.current = { ...settings.current, profile: { ...settings.current.profile, encoding: 'protobuf' } };
  await runtime.send('second');

  assert.deepEqual(net.on('/run').map((call) => call.headers.accept), ['text/event-stream', PROTOBUF_MEDIA_TYPE]);
  assert.equal(runtime.getState().threadId, thread);
  assert.deepEqual(inputOf(net.on('/run')[1]).messages?.map((message) => [message.role, message.content]), [['user', 'first'], ['assistant', 'server reply'], ['user', 'second']]);
  const session = await settle();
  assert.deepEqual(session.exchanges.map((exchange) => exchange.encoding), [undefined, 'protobuf']);
  assert.deepEqual(session.findings, []);
});

test('the token goes out on a protobuf request through the transport only, and nothing recorded holds it', async () => {
  const { runtime, net, settle } = rig([plain], { settings: withProfile({ encoding: 'protobuf' }) });
  runtime.selectAgent(agent);
  runtime.setAuth({ headerName: 'X-Api-Key', token: TOKEN });
  await runtime.send('hi');
  assert.equal(net.on('/run')[0]?.headers['x-api-key'], TOKEN);
  assert.equal(JSON.stringify(await settle()).includes(TOKEN), false);
});

// ---------------------------------------------------------------------------------------------
// What the client reads
// ---------------------------------------------------------------------------------------------

test('the protocol client reads a protobuf answer whose text holds CR and LF bytes, and the recording keeps the same bytes (SC-005)', async () => {
  const text = 'line one\r\nline two\rline three\n';
  const route = answering((call) => [start(call), ...reply(call, text), finish(call)]);
  const { runtime, net, settle } = rig([route], { settings: withProfile({ encoding: 'protobuf' }) });
  runtime.selectAgent(agent);
  await runtime.send('one');
  await runtime.send('two');

  assert.equal(runtime.getState().error, undefined);
  assert.deepEqual(inputOf(net.on('/run')[1]).messages?.map((message) => [message.role, message.content]), [['user', 'one'], ['assistant', text], ['user', 'two']], 'the client kept the reply exactly');
  const session = await settle();
  assert.deepEqual(session.findings, []);
  const delta = session.frames.find((frame) => frame.eventType === 'TEXT_MESSAGE_CONTENT');
  assert.equal((delta?.parsed as { delta?: string } | undefined)?.delta, text);
  assert.deepEqual(session.runs.map((run) => run.outcome.kind), ['success', 'success']);
});

test('the line-ending copy would have changed the bytes of that stream, so the exemption is what keeps it readable', async () => {
  const call = { threadId: 't', runId: 'r' };
  const events = [{ type: 'RUN_STARTED', ...call }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'a\r\nb' }];
  const original = await protobufStream(events).arrayBuffer();
  const copied = await canonicalizeLineEndings(protobufStream(events)).arrayBuffer();
  assert.notDeepEqual(new Uint8Array(copied), new Uint8Array(original));
  assert.ok(copied.byteLength < original.byteLength, 'the LF of a CRLF is dropped, which shortens the payload below its length prefix');
});

test('a damaged protobuf run gives the run a binary finding in the client\'s words, keeps every recorded frame, and shows no connection banner', async () => {
  const cuts: Array<[string, (call: Call) => Uint8Array, RegExp]> = [
    ['an undecodable frame', (call) => concat([frameProtobuf(start(call)), garbageFrame, frameProtobuf(finish(call))]), /Failed to decode protocol buffer message/],
    ['a stream that ends inside a frame', (call) => concat([frameProtobuf(start(call)), frameProtobuf(finish(call)).slice(0, 9)]), /The binary stream ended mid-frame/],
    ['an answer in server-sent events', () => new TextEncoder().encode('data: {"type":"RUN_STARTED"}\n\n'), /Protobuf message size exceeded maximum limit/],
  ];
  for (const [name, bytes, message] of cuts) {
    const route: Route = (call) => (call.path === '/run' ? protobufBytes(bytes(call)) : undefined);
    const { runtime, net, settle } = rig([route], { settings: withProfile({ encoding: 'protobuf' }) });
    runtime.selectAgent(agent);
    await runtime.send('hi');
    const session = await settle();

    const runFindings = session.findings.filter((finding) => finding.subject.type === 'run' && finding.kind === 'binary');
    assert.equal(runFindings.length, 1, `${name}: one binary finding on the run`);
    assert.match(runFindings[0]!.message, new RegExp(`^The protocol client could not read the binary stream: ${message.source}`), name);
    assert.equal(runtime.getState().error, undefined, `${name}: a stream problem is a finding, not a banner`);
    assert.equal(session.exchanges[0]!.transport, 'completed', name);
    assert.equal(session.exchanges[0]!.encoding, 'protobuf', name);
    assert.deepEqual(concat(session.frames.map((frame) => Uint8Array.from(Buffer.from(frame.bytes!, 'base64')))), bytes(net.on('/run')[0]!), `${name}: the frames hold every byte the server sent`);
  }
});
