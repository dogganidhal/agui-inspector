// F01 T005: the loopback, model-free fixture server used by end-to-end tests.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { runHttpRequest, transformHttpEventStream } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { createInteractiveServer } from '../../../../examples/reference-agent/interactive-scenarios.ts';
import { baselineFrames, protobufScenarios } from '../../../../examples/reference-agent/protobuf-fixtures.ts';
import { acceptsProtobuf } from '../../../../examples/reference-agent/protobuf.ts';
import { scenarioBytes } from '../../../../examples/reference-agent/recorder-fixtures.ts';

const root = process.cwd();
const allowed = 'http://127.0.0.1:4173';
let child: ChildProcess;
let base = '';
let port = 0;

before(async () => {
  child = spawn(process.execPath, [path.join(root, 'examples/reference-agent/server.ts'), '--port', '0', '--allow-origin', allowed], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const [line] = (await once(child.stdout!, 'data')) as [Buffer];
  const ready = JSON.parse(line.toString()) as { url: string };
  base = ready.url;
  port = Number(new URL(base).port);
});
after(() => {
  child.kill();
});

const runInput = JSON.stringify({ threadId: 't-fixture', runId: 'r-fixture', messages: [], state: {}, tools: [], context: [], forwardedProps: {} });

async function post(headers: Record<string, string> = {}, body = runInput) {
  return fetch(`${base}/agent`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
}

function parseEvents(body: string) {
  return body
    .split('\n\n')
    .filter((block) => block !== '')
    .map((block) => JSON.parse(block.replace(/^data: /, '')) as { type: string; threadId?: string; runId?: string });
}

test('it listens on loopback only', () => {
  assert.equal(new URL(base).hostname, '127.0.0.1');
});

test('it is unreachable on any non-loopback interface', async (t) => {
  const external = Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === 'IPv4' && !entry.internal);
  if (!external) return t.skip('no non-loopback IPv4 interface on this machine');
  const outcome = await new Promise<string>((resolve) => {
    const socket = net.connect({ host: external.address, port, timeout: 1500 });
    socket.once('connect', () => (socket.destroy(), resolve('connected')));
    socket.once('timeout', () => (socket.destroy(), resolve('timeout')));
    socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });
  assert.notEqual(outcome, 'connected');
});

test('it streams a valid scripted run that echoes the request identifiers', async () => {
  const response = await post({ origin: allowed });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const events = parseEvents(await response.text());
  assert.deepEqual(events.map((event) => event.type), [
    EventType.RUN_STARTED,
    EventType.TEXT_MESSAGE_START,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.TEXT_MESSAGE_END,
    EventType.RUN_FINISHED,
  ]);
  for (const event of events) assert.equal(EventSchemas.safeParse(event).success, true, `${event.type} is schema-valid`);
  assert.equal(events[0]!.threadId, 't-fixture');
  assert.equal(events[0]!.runId, 'r-fixture');
});

test('it is deterministic and needs no model or network', async () => {
  const [first, second] = await Promise.all([post(), post()].map(async (pending) => (await pending).text()));
  assert.equal(first, second);
});

test('it grants CORS to the one allowed origin only, never a wildcard', async () => {
  const granted = await post({ origin: allowed });
  assert.equal(granted.headers.get('access-control-allow-origin'), allowed);
  assert.equal(granted.headers.get('vary'), 'Origin');
  assert.equal(granted.headers.get('access-control-allow-credentials'), null, 'no cookies for cross-origin pages');

  const denied = await post({ origin: 'http://evil.invalid' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const none = await post();
  assert.equal(none.headers.get('access-control-allow-origin'), null);
});

test('it answers preflight for the allowed origin only', async () => {
  const preflight = (origin: string) =>
    fetch(`${base}/agent`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' },
    });
  const ok = await preflight(allowed);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), allowed);
  assert.match(ok.headers.get('access-control-allow-headers') ?? '', /authorization/i);
  const refused = await preflight('http://evil.invalid');
  assert.equal(refused.headers.get('access-control-allow-origin'), null);
});

test('it never echoes request headers or credentials back', async () => {
  const response = await post({ origin: allowed, authorization: 'Bearer synthetic-test-token', cookie: 'session=synthetic' });
  const everything = `${[...response.headers.entries()].join('\n')}\n${await response.text()}`;
  assert.doesNotMatch(everything, /synthetic-test-token|session=synthetic/);
});

test('a malformed request body gets a visible error response, not an event stream', async () => {
  const response = await post({}, '{not json');
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
  assert.match(await response.text(), /error/);
});

test('it serves a health check and refuses other routes', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/elsewhere`)).status, 404);
});

// ---- protobuf (spec 013, FR-019) -----------------------------------------------------------------------

/** What the protocol client itself makes of an answer: its own parsers, chosen by the content type as it does. */
function clientReads(response: Response): Promise<Array<{ type: string }>> {
  return new Promise((resolve, reject) => {
    const events: Array<{ type: string }> = [];
    transformHttpEventStream(runHttpRequest(() => Promise.resolve(response))).subscribe({
      next: (event) => void events.push(event as { type: string }),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

const PROTOBUF = 'application/vnd.ag-ui.event+proto';
/** A protobuf answer over these bytes, announced with the media type the client reads. */
const bodyOf = (bytes: Uint8Array) => new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { 'content-type': PROTOBUF } });

test('POST /agent answers in protobuf when Accept lists the media type, and the protocol client reads the same events as over server-sent events', async () => {
  const binary = await post({ accept: PROTOBUF });
  assert.equal(binary.status, 200);
  assert.equal(binary.headers.get('content-type'), PROTOBUF, 'exactly the media type: the client picks its parser by strict equality');
  const bytes = new Uint8Array(await binary.clone().arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint32(0, false) + 4 <= bytes.length, true, 'the body starts with a four-byte length');
  const viaProtobuf = await clientReads(binary);

  const text = await post({ accept: 'text/event-stream' });
  assert.match(text.headers.get('content-type') ?? '', /^text\/event-stream/);
  const viaText = await clientReads(text);
  assert.deepEqual(viaProtobuf.map((event) => event.type), [EventType.RUN_STARTED, EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END, EventType.RUN_FINISHED]);
  assert.deepEqual(viaProtobuf, viaText, 'the same events whichever encoding carried them');
});

test('Accept decides: no header, a list that names protobuf with a quality, and a list without it', async () => {
  const kind = async (accept: string | undefined) => (await post(accept === undefined ? {} : { accept })).headers.get('content-type');
  assert.match((await kind(undefined)) ?? '', /^text\/event-stream/);
  assert.equal(await kind(`text/event-stream;q=0.5, ${PROTOBUF}`), PROTOBUF);
  assert.equal(await kind(`${PROTOBUF};q=0`), 'text/event-stream');
  assert.match((await kind('*/*')) ?? '', /^text\/event-stream/);
  assert.equal(acceptsProtobuf(`application/json, ${PROTOBUF.toUpperCase()}`), true, 'media types are case-insensitive');
  assert.equal(acceptsProtobuf('application/vnd.ag-ui.event+protobuf'), false, 'a different media type is not this one');
});

test('the fixture streams are framed the way the client reads them: parseProtoStream gives the events that were written', async () => {
  for (const [name, scenario] of Object.entries({ baseline: protobufScenarios.baselineRun, runError: protobufScenarios.runError, large: protobufScenarios.largeFrame })) {
    const events = await clientReads(bodyOf(scenarioBytes(scenario)));
    assert.ok(events.length >= 2, name);
    assert.equal(events[0]!.type, EventType.RUN_STARTED, name);
  }
  const baseline = await clientReads(bodyOf(scenarioBytes(protobufScenarios.baselineRun)));
  assert.equal(baseline.length, baselineFrames.length, 'every frame of the baseline reaches the client');
});

test('the interactive server answers each scenario in protobuf by Accept, records what it saw, and keeps the bytes it wrote', async () => {
  const server = await createInteractiveServer();
  try {
    const run = (message: string, accept: string) =>
      fetch(`${server.origin}/agent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept },
        body: JSON.stringify({ threadId: 't-i', runId: `r-${message}`, messages: [{ id: 'u1', role: 'user', content: message }], state: {}, tools: [], context: [], forwardedProps: {} }),
      });
    for (const message of ['hello', 'interrupt', 'tools', 'state']) {
      const asProtobuf = await run(message, PROTOBUF);
      assert.equal(asProtobuf.headers.get('content-type'), PROTOBUF, message);
      const asText = await run(message, 'text/event-stream');
      assert.deepEqual(await clientReads(asProtobuf), await clientReads(asText), `${message}: the same events in both encodings`);
    }
    const accepts = server.requests().map((request) => request.accept);
    assert.deepEqual(accepts, [PROTOBUF, 'text/event-stream', PROTOBUF, 'text/event-stream', PROTOBUF, 'text/event-stream', PROTOBUF, 'text/event-stream']);
    const sent = server.sent();
    assert.equal(sent.length, 8);
    assert.equal(new DataView(sent[0]!.buffer, sent[0]!.byteOffset).getUint32(0, false) + 4 <= sent[0]!.length, true);
    assert.match(new TextDecoder().decode(sent[1]), /^data: /, 'the server-sent-events response is recorded as text bytes');

    const broken = await run('broken', PROTOBUF);
    assert.equal(broken.status, 406, 'a scenario that sends text that is not an event has no protobuf form');
    assert.match(await broken.text(), /no protobuf form/);
    assert.equal((await run('broken', 'text/event-stream')).status, 200, 'it is still served as server-sent events');
  } finally {
    await server.close();
  }
});
