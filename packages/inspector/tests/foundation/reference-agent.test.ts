// F01 T005: the loopback, model-free fixture server used by end-to-end tests.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { EventType } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';

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
