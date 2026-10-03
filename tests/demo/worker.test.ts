// P02 T010: the demo service worker is an endpoint adapter over the shared producers. These tests bundle
// the real demo/service-worker.ts as the browser would receive it (a classic IIFE, platform browser, so a
// Node import cannot resolve) and drive its listeners with native Request, Response and streams. They
// prove routing, methods, errors, bytes, hold and cancel at the adapter. They do not prove a first-page
// controller or native browser abort: that is the integrated browser proof in P03 (G-D03).
// The worker paces its answers (FX9). The worker's own timers are a fake clock here, so nothing sleeps: it
// fires every pause at once by default, and a test that wants to hold time still asks for a manual one.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import { formSurface, continuation, type UserAction } from '../../examples/reference-agent/a2ui-scenarios.ts';
import { protocolScenarios } from '../../examples/reference-agent/protocol-fixtures.ts';
import { scenarioBytes } from '../../examples/reference-agent/recorder-fixtures.ts';
import { pace } from '../../examples/reference-agent/pacing.ts';
import { a2uiResponse, baselineResponse, interactiveResponse, runErrorResponse, SCENARIOS, type ScenarioResponse } from '../../examples/reference-agent/scenarios.ts';

const root = process.cwd();
const entry = path.join(root, 'demo', 'service-worker.ts');
const PAGE = 'https://demo.test/agui-inspector/';
const decoder = new TextDecoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const joined = (response: ScenarioResponse) => Buffer.concat(response.chunks);

interface Posted {
  readonly to: string;
  readonly message: unknown;
}

/** The worker's own timers. `delays` is every pause it asked for, in order; `waiting` the ones not yet fired or cleared. */
interface Clock {
  readonly delays: number[];
  readonly waiting: Map<number, () => void>;
  /** Ends the oldest pause now. Nothing happens when the worker is not waiting. */
  fire(): void;
}

interface Harness {
  readonly clock: Clock;
  /** Runs the worker's fetch listeners; resolves to undefined when none claims the request. */
  fetch(request: Request | FakeRequest): Promise<Response | undefined>;
  /** The event types the worker listens for. */
  readonly listens: readonly string[];
  install(): Promise<void>;
  activate(): Promise<void>;
  message(data: unknown): void;
  readonly posted: Posted[];
  readonly calls: { skipWaiting: number; claim: number };
}

/** A request that is not a native Request: used where Node's constructor refuses the shape (navigation). */
interface FakeRequest {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  text(): Promise<string>;
  readonly headers?: never;
}

let code = '';
let inputs: string[] = [];

before(async () => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2023',
    logLevel: 'silent',
  });
  code = result.outputFiles[0]!.text;
  inputs = Object.keys(result.metafile.inputs);
  armTraps();
  worker = load();
});

// Anything the worker must never touch is replaced by a trap for the length of each test.
const trapped = ['fetch', 'caches', 'indexedDB', 'localStorage', 'sessionStorage', 'XMLHttpRequest', 'WebSocket', 'importScripts'] as const;
const originals = new Map<string, PropertyDescriptor | undefined>();
let attempts: string[] = [];

function armTraps(): void {
  attempts = [];
  for (const name of trapped) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, get: () => (attempts.push(name), undefined) });
  }
}
function disarmTraps(): void {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
  originals.clear();
}

type Listener = (event: Record<string, unknown>) => void;

/** Instant unless `manual`: every pause ends on the next microtask, so a test never waits for a real timer. */
function load(scriptUrl = `${PAGE}service-worker.js`, { manual = false } = {}): Harness {
  const listeners = new Map<string, Listener[]>();
  const posted: Posted[] = [];
  const calls = { skipWaiting: 0, claim: 0 };
  const clock: Clock = {
    delays: [],
    waiting: new Map(),
    fire() {
      const [first] = clock.waiting;
      if (first === undefined) return;
      clock.waiting.delete(first[0]);
      first[1]();
    },
  };
  let timers = 0;
  const scope = {
    setTimeout(handler: () => void, ms: number) {
      timers += 1;
      const id = timers;
      clock.delays.push(ms);
      clock.waiting.set(id, handler);
      if (!manual) queueMicrotask(() => clock.waiting.delete(id) && handler());
      return id;
    },
    clearTimeout: (id: number) => void clock.waiting.delete(id),
    location: new URL(scriptUrl),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    skipWaiting: async () => void (calls.skipWaiting += 1),
    clients: {
      claim: async () => void (calls.claim += 1),
      matchAll: async () => [{ postMessage: (message: unknown) => posted.push({ to: 'window-client', message }) }],
    },
  };
  // The bundle is a classic script that reads the global `self`; give each instance its own.
  const run = vm.runInThisContext(`(function (self) {${code}\n})`, { filename: 'service-worker.js' }) as (scope: unknown) => void;
  run(scope);

  const waited = async (type: string): Promise<void> => {
    const pending: Promise<unknown>[] = [];
    for (const listener of listeners.get(type) ?? []) listener({ waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  };
  return {
    clock,
    listens: [...listeners.keys()].sort(),
    install: () => waited('install'),
    activate: () => waited('activate'),
    message(data) {
      for (const listener of listeners.get('message') ?? []) listener({ data, source: { postMessage: (message: unknown) => posted.push({ to: 'message-source', message }) } });
    },
    posted,
    calls,
    async fetch(request) {
      let responded: Promise<Response> | undefined;
      for (const listener of listeners.get('fetch') ?? []) listener({ request, respondWith: (promise: Promise<Response>) => void (responded = Promise.resolve(promise)) });
      return responded;
    },
  };
}

let worker: Harness;
after(disarmTraps);
afterEach(() => assert.deepEqual(attempts, [], 'the worker reached for the network or for storage'));

const url = (route: string) => `${PAGE}__demo__/${route}`;
const input = (extra: object = {}) => ({ threadId: 't-1', runId: 'r-1', ...extra });
const post = (route: string, body: unknown = input(), method = 'POST') => new Request(url(route), { method, body: typeof body === 'string' ? body : JSON.stringify(body) });
const bytesOf = async (response: Response) => Buffer.from(await response.arrayBuffer());

async function handled(request: Request | FakeRequest): Promise<Response> {
  const response = await worker.fetch(request);
  assert.ok(response, `${request.method} ${request.url} should be answered`);
  return response;
}

// ---- the reserved routes, byte for byte ---------------------------------------------------------

const AGENTS = [
  ['agent/interactive', (extra: object) => interactiveResponse({ threadId: 't-1', runId: 'r-1', ...extra })],
  ['agent/a2ui', (extra: object) => a2uiResponse({ threadId: 't-1', runId: 'r-1', ...extra })],
  ['agent/protocol/baseline', () => baselineResponse({ threadId: 't-1', runId: 'r-1' })],
  ['agent/protocol/run-error', () => runErrorResponse({ threadId: 't-1', runId: 'r-1' })],
] as const;

for (const [route, producer] of AGENTS) {
  test(`${route} answers a POST with the shared producer's status, type and bytes, paced`, async () => {
    const expected = pace(producer({}));
    const response = await handled(post(route));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await bytesOf(response), joined(expected));
  });
}

const userAction: UserAction = { name: 'send_note', surfaceId: 'form', sourceComponentId: 'send', context: { note: 'hi', count: 1 }, timestamp: '2026-10-02T10:00:00.000Z' };

test('the interactive route serves every scenario and continuation as the shared producer answers it, paced', async () => {
  const bodies = [
    { messages: [{ role: 'user', content: 'plain hello' }] },
    ...Object.values(SCENARIOS).filter((name) => name !== 'slow').map((name) => ({ messages: [{ role: 'user', content: name }] })),
    { resume: [{ interruptId: 'i-approve', status: 'resolved', payload: { approved: true } }, { interruptId: 'i-contact', status: 'cancelled' }] },
    { messages: [{ role: 'tool', toolCallId: 'c-color', content: 'teal' }] },
    { forwardedProps: { a2uiAction: { userAction } } },
  ];
  for (const extra of bodies) {
    const response = await handled(post('agent/interactive', input(extra)));
    assert.deepEqual(await bytesOf(response), joined(pace(interactiveResponse({ threadId: 't-1', runId: 'r-1', ...extra }))), JSON.stringify(extra));
  }
});

test('the broken scenario keeps its malformed frame and every later byte unrepaired', async () => {
  const bytes = await bytesOf(await handled(post('agent/interactive', input({ messages: [{ role: 'user', content: SCENARIOS.broken }] }))));
  const text = decoder.decode(bytes);
  assert.ok(text.includes('data: {not json at all\n\n'));
  assert.ok(text.endsWith('"outcome":{"type":"success"}}\n\n'));
  assert.ok(text.indexOf('never-started') < text.indexOf('{not json') && text.indexOf('{not json') < text.indexOf('after the damage'));
});

test('the A2UI route sends the form, then the continuation for a forwarded action, as supported activity snapshots', async () => {
  const snapshot = async (extra: object) => {
    const blocks = decoder.decode(await bytesOf(await handled(post('agent/a2ui', input(extra))))).split('\n\n').filter(Boolean).map((block) => JSON.parse(block.slice('data: '.length)));
    assert.deepEqual(blocks.map((block) => block.type), ['RUN_STARTED', 'ACTIVITY_SNAPSHOT', 'RUN_FINISHED']);
    assert.deepEqual([blocks[0].threadId, blocks[0].runId, blocks[2].runId], ['t-1', 'r-1', 'r-1']);
    assert.equal(blocks[1].activityType, 'a2ui-surface');
    return blocks[1].content.a2ui_operations;
  };
  assert.deepEqual(await snapshot({}), JSON.parse(JSON.stringify(formSurface)));
  assert.deepEqual(await snapshot({ forwardedProps: { a2uiAction: { userAction } } }), JSON.parse(JSON.stringify(continuation(formSurface, userAction))));
});

test('protocol routes retain the fixed default bytes, and input identifiers are generated at the source', async () => {
  const defaults = { threadId: 't-proto', runId: 'r-proto' };
  const baseline = await bytesOf(await handled(post('agent/protocol/baseline', defaults)));
  assert.equal(sha256(baseline), sha256(scenarioBytes(protocolScenarios.baselineRun)));
  const error = await bytesOf(await handled(post('agent/protocol/run-error', defaults)));
  assert.equal(sha256(error), sha256(scenarioBytes(protocolScenarios.runError)));

  const custom = await bytesOf(await handled(post('agent/protocol/baseline', { threadId: 'tt', runId: 'rr' })));
  assert.match(decoder.decode(custom), /^data: \{"type":"RUN_STARTED","threadId":"tt","runId":"rr"\}\n\n/);
  assert.match(decoder.decode(custom), /"type":"RUN_FINISHED","threadId":"tt","runId":"rr"/);
  assert.ok(!decoder.decode(custom).includes('t-proto'));
  // Mixed delimiters survive: the response is not normalized to one.
  assert.ok(decoder.decode(custom).includes('\r\n\r\n') && decoder.decode(custom).includes('\r\r'));
});

test('the preparation routes answer 200 JSON ok for exactly one nonempty session segment and for warm', async () => {
  for (const request of [post('prepare/sessions/t-1', '{"user_id":"u"}', 'PUT'), post('prepare/warm', '{"run":"r"}'), post('prepare/sessions/with%20space', 'not json at all', 'PUT')]) {
    const response = await handled(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '{"ok":true}');
  }
  for (const path of ['prepare/sessions', 'prepare/sessions/', 'prepare/sessions/a/b', 'prepare/sessions//', 'prepare/', 'prepare/warm/extra', 'prepare/other', 'agent/interactive/extra', 'agent/protocol', 'agent', 'nothing', '']) {
    const response = await handled(new Request(url(path), { method: path.startsWith('prepare/sessions') ? 'PUT' : 'POST', body: '{}' }));
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.match(await response.text(), /"error"/);
  }
});

test('inherited object keys are not routes', async () => {
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) assert.equal((await handled(post(key))).status, 404);
});

// ---- methods and bodies: visible errors, never a successful stream -------------------------------

test('a wrong method on a reserved route is a visible 405', async () => {
  const cases: [string, string][] = [
    ['agent/interactive', 'GET'],
    ['agent/a2ui', 'PUT'],
    ['agent/protocol/baseline', 'DELETE'],
    ['agent/protocol/run-error', 'PATCH'],
    ['prepare/warm', 'PUT'],
    ['prepare/sessions/t-1', 'POST'],
    ['prepare/sessions/t-1', 'GET'],
  ];
  for (const [route, method] of cases) {
    const response = await handled(new Request(url(route), { method, ...(method === 'GET' ? {} : { body: '{}' }) }));
    assert.equal(response.status, 405, `${method} ${route}`);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.match(await response.text(), /method not allowed/);
  }
});

test('malformed JSON is a 400 and a missing or non-string identifier is a 422, each an inspectable error body', async () => {
  for (const [route] of AGENTS) {
    for (const body of ['{not json', '', '{"threadId":"t-1"', 'data: nope']) {
      const response = await handled(post(route, body));
      assert.equal(response.status, 400, `${route} ${body}`);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.equal(await response.text(), '{"error":"request body is not valid JSON"}');
    }
    for (const body of ['{}', '{"threadId":"t"}', '{"runId":"r"}', '{"threadId":1,"runId":"r"}', '{"threadId":"t","runId":null}', 'null', '[]', '"text"', '7']) {
      const response = await handled(post(route, body));
      assert.equal(response.status, 422, `${route} ${body}`);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.equal(await response.text(), '{"error":"threadId and runId must be strings"}');
    }
  }
});

// ---- hold, cancel and incremental delivery -----------------------------------------------------

/** Answers a request while recording every cancel the worker's response stream receives from its consumer. */
async function answeredWithSpy(request: Request, target: Harness = worker): Promise<{ response: Response; cancelled: unknown[] }> {
  const cancelled: unknown[] = [];
  const Native = globalThis.ReadableStream;
  globalThis.ReadableStream = class extends Native<Uint8Array> {
    constructor(source: UnderlyingDefaultSource<Uint8Array>, strategy?: QueuingStrategy<Uint8Array>) {
      super({ ...source, cancel: (reason) => (cancelled.push(reason), source.cancel?.(reason)) }, strategy);
    }
  } as typeof Native;
  try {
    const response = await target.fetch(request);
    assert.ok(response, `${request.method} ${request.url} should be answered`);
    return { response, cancelled };
  } finally {
    globalThis.ReadableStream = Native;
  }
}

const slowRequest = () => post('agent/interactive', input({ messages: [{ role: 'user', content: SCENARIOS.slow }] }));
const slowResponse = () => pace(interactiveResponse({ threadId: 't-1', runId: 'r-1', messages: [{ role: 'user', content: SCENARIOS.slow }] }));
const slowBytes = () => joined(slowResponse());
const slowChunks = slowResponse().chunks.length;
const heldFor = (read: Promise<unknown>) => Promise.race([read.then(() => 'ended'), new Promise((resolve) => setTimeout(() => resolve('held'), 60))]);

test('a held response delivers its bytes in order, stays open without inventing a terminal frame, and releases on cancel', async () => {
  const expected = slowResponse();
  assert.equal(expected.ending, 'hold-until-abort');
  const { response, cancelled } = await answeredWithSpy(slowRequest());

  const reader = response.body!.getReader();
  const received: Uint8Array[] = [];
  for (let index = 0; index < expected.chunks.length; index += 1) {
    const { value, done } = await reader.read();
    assert.equal(done, false);
    received.push(value!);
  }
  assert.deepEqual(Buffer.concat(received), slowBytes(), 'every byte arrives before the hold, in order');

  const waiting = reader.read();
  assert.equal(await heldFor(waiting), 'held', 'the stream stays open and sends nothing more');
  assert.equal(cancelled.length, 0);

  await reader.cancel(new DOMException('stopped', 'AbortError'));
  assert.deepEqual(await waiting, { value: undefined, done: true }, 'the page reader is released without a closing frame');
  assert.equal(cancelled.length, 1, 'the producer was told to stop');
  const text = decoder.decode(Buffer.concat(received));
  assert.ok(!text.includes('RUN_FINISHED') && !text.includes('RUN_ERROR'), 'no terminal frame was invented');
});

test('the producer is released only when both branches of a teed held response stop', async () => {
  // The recorder and the client each read a branch; the source must outlive either one alone.
  const { response, cancelled } = await answeredWithSpy(slowRequest());
  const [recorder, client] = response.body!.tee();
  const recorderReader = recorder.getReader();
  const clientReader = client.getReader();
  for (let index = 0; index < slowChunks; index += 1) {
    const [first] = await Promise.all([recorderReader.read(), clientReader.read()]);
    assert.equal(first.done, false);
  }

  void clientReader.cancel();
  assert.equal(await heldFor(recorderReader.read().then(() => undefined).catch(() => undefined)), 'held', 'the other branch is still open');
  assert.equal(cancelled.length, 0);
  await recorderReader.cancel();
  assert.equal(cancelled.length, 1, 'the producer is released once, after the last branch stopped');
});

test('a finite response read through a teed branch delivers every byte to the other branch', async () => {
  const response = await handled(post('agent/protocol/baseline', input()));
  const [recorder, client] = response.body!.tee();
  void client.cancel();
  assert.deepEqual(Buffer.from(await new Response(recorder).arrayBuffer()), joined(baselineResponse({ threadId: 't-1', runId: 'r-1' })));
});

test('a finished response closes without extra bytes', async () => {
  const response = await handled(post('agent/interactive', input()));
  const reader = response.body!.getReader();
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
  }
  assert.equal(total, joined(pace(interactiveResponse({ threadId: 't-1', runId: 'r-1' }))).length);
});

// ---- pacing (FX9) ------------------------------------------------------------------------------

const plainRequest = () => post('agent/interactive', input({ messages: [{ role: 'user', content: 'plain hello' }] }));
const plainResponse = () => pace(interactiveResponse({ threadId: 't-1', runId: 'r-1', messages: [{ role: 'user', content: 'plain hello' }] }));

test('a run is announced at once, then every chunk waits its pause: a think latency first, then small deltas', async () => {
  const manual = load(undefined, { manual: true });
  const expected = plainResponse();
  const reader = (await manual.fetch(plainRequest()))!.body!.getReader();

  const received: Uint8Array[] = [(await reader.read()).value!];
  assert.match(decoder.decode(received[0]), /"type":"RUN_STARTED"/, 'the run shows up before the model has "thought"');
  assert.equal(manual.clock.waiting.size, 1);
  assert.ok(manual.clock.delays[0]! >= 300 && manual.clock.delays[0]! <= 900, `think latency ${manual.clock.delays[0]}`);

  const next = reader.read();
  assert.equal(await heldFor(next), 'held', 'nothing arrives while the pause lasts');
  manual.clock.fire();
  received.push((await next).value!);
  assert.match(decoder.decode(received[1]), /"type":"TEXT_MESSAGE_START"/);

  for (;;) {
    manual.clock.fire();
    const { value, done } = await reader.read();
    if (done) break;
    received.push(value);
  }
  assert.deepEqual(Buffer.concat(received), joined(expected));
  assert.deepEqual(manual.clock.delays, expected.delaysMs!.filter((delay) => delay > 0), 'the worker asked for exactly the pauses the pacing layer set');
  const deltas = received.map((chunk) => decoder.decode(chunk)).filter((frame) => frame.includes('TEXT_MESSAGE_CONTENT')).map((frame) => JSON.parse(frame.slice('data: '.length)).delta as string);
  assert.ok(deltas.length > 1, 'the text streams in several deltas');
  assert.equal(deltas.join(''), 'Hello from the reference agent.');
});

test('Stop in the middle of a pause ends it, sends nothing more, closes nothing and releases the producer', async () => {
  const manual = load(undefined, { manual: true });
  const { response, cancelled } = await answeredWithSpy(plainRequest(), manual);
  const reader = response.body!.getReader();
  await reader.read();
  assert.equal(manual.clock.waiting.size, 1, 'the worker is in its think pause');

  const waiting = reader.read();
  await reader.cancel(new DOMException('stopped', 'AbortError'));
  assert.deepEqual(await waiting, { value: undefined, done: true });
  assert.equal(cancelled.length, 1, 'the producer was told to stop');
  assert.equal(manual.clock.waiting.size, 0, 'the pause was cleared, not left to fire later');
  manual.clock.fire();
  assert.equal(manual.clock.delays.length, 1, 'no later chunk was scheduled');
});

test('protocol fixtures are byte-exact wire evidence: no pause is asked for and no byte is re-cut', async () => {
  const manual = load(undefined, { manual: true });
  for (const [route, expected] of [
    ['agent/protocol/baseline', baselineResponse({ threadId: 't-1', runId: 'r-1' })],
    ['agent/protocol/run-error', runErrorResponse({ threadId: 't-1', runId: 'r-1' })],
  ] as const) {
    const response = (await manual.fetch(post(route)))!;
    assert.deepEqual(await bytesOf(response), joined(expected), route);
  }
  assert.deepEqual(manual.clock.delays, [], 'a fixture reaches the page at wire speed');
});

// ---- confinement: everything else passes through unhandled -------------------------------------

test('unrelated origins, routes, assets, visitor endpoints and navigation are left to the browser', async () => {
  const passes: [string, string][] = [
    ['GET', `${PAGE}`],
    ['GET', `${PAGE}app.js`],
    ['GET', `${PAGE}config.json`],
    ['GET', `${PAGE}hosting-config.json`],
    ['GET', `${PAGE}service-worker.js`],
    ['POST', `${PAGE}agent`],
    ['POST', `${PAGE}__demo__`],
    ['POST', `${PAGE}__demo__x/agent/interactive`],
    ['POST', `${PAGE}x/__demo__/agent/interactive`],
    ['POST', 'https://demo.test/__demo__/agent/interactive'],
    ['POST', 'https://demo.test/other/__demo__/agent/interactive'],
    ['POST', 'https://other.test/agui-inspector/__demo__/agent/interactive'],
    ['POST', 'http://demo.test/agui-inspector/__demo__/agent/interactive'],
    ['POST', 'https://demo.test:8443/agui-inspector/__demo__/agent/interactive'],
    ['POST', 'https://agent.example/agent'],
    ['PUT', 'https://agent.example/prepare/sessions/t-1'],
    ['POST', 'http://localhost:8787/agent'],
    ['GET', 'https://fonts.example/font.woff2'],
  ];
  for (const [method, target] of passes) {
    const response = await worker.fetch(new Request(target, { method, ...(method === 'GET' ? {} : { body: '{}' }) }));
    assert.equal(response, undefined, `${method} ${target} must pass through`);
  }
  // Navigation to a reserved path is never answered (Node's Request cannot construct mode "navigate").
  const navigation: FakeRequest = { url: url('agent/interactive'), method: 'GET', mode: 'navigate', text: async () => '' };
  assert.equal(await worker.fetch(navigation), undefined);
});

test('the base is the script directory, so a worker served under another sub-path owns only that sub-path', async () => {
  const moved = load('https://demo.test/tools/inspector/service-worker.js');
  const own = await moved.fetch(new Request('https://demo.test/tools/inspector/__demo__/agent/interactive', { method: 'POST', body: JSON.stringify(input()) }));
  assert.equal(own?.status, 200);
  assert.equal(await moved.fetch(new Request(url('agent/interactive'), { method: 'POST', body: JSON.stringify(input()) })), undefined);
  assert.equal((await moved.fetch(new Request('https://demo.test/tools/inspector/__demo__/nothing', { method: 'POST', body: '{}' })))?.status, 404);
});

test('a query string or fragment does not change which route answers', async () => {
  assert.equal((await handled(new Request(`${url('prepare/warm')}?x=1#y`, { method: 'POST', body: '{}' }))).status, 200);
});

test('the worker never reads headers or credentials of a request', async () => {
  // A request whose headers, credentials and cookies are booby-trapped: touching them fails the test.
  const hostile = (route: string, method: string, body: string) =>
    new Proxy({ url: url(route), method, mode: 'cors', text: async () => body }, {
      get(target, property) {
        if (['headers', 'credentials', 'referrer', 'clone', 'body', 'bodyUsed', 'arrayBuffer', 'formData', 'blob'].includes(String(property))) throw new Error(`worker read request.${String(property)}`);
        return Reflect.get(target, property);
      },
    }) as unknown as Request;
  for (const [route, method, body] of [['agent/interactive', 'POST', JSON.stringify(input())], ['agent/a2ui', 'POST', '{bad'], ['prepare/warm', 'POST', '{}'], ['prepare/sessions/t-1', 'PUT', '{}'], ['agent/protocol/baseline', 'GET', ''], ['nothing', 'POST', '']] as const) {
    assert.ok(await handled(hostile(route, method, body)));
  }
});

// ---- lifecycle and readiness -------------------------------------------------------------------

test('the worker listens only for install, activate, message and fetch', () => {
  assert.deepEqual(worker.listens, ['activate', 'fetch', 'install', 'message']);
});

test('install skips waiting and activation claims clients, then tells them it is ready with type, version and ready only', async () => {
  const fresh = load();
  await fresh.install();
  assert.equal(fresh.calls.skipWaiting, 1);
  assert.equal(fresh.calls.claim, 0);
  await fresh.activate();
  assert.equal(fresh.calls.claim, 1);
  assert.equal(fresh.posted.length, 1);
  assert.equal(fresh.posted[0]!.to, 'window-client');
  assert.deepEqual(Object.keys(fresh.posted[0]!.message as object).sort(), ['ready', 'type', 'version']);
  assert.deepEqual(fresh.posted[0]!.message, { type: 'agui-demo-ready', version: 1, ready: true });
});

test('an existing controller can ask and gets the same sensitive-data-free answer; anything else is ignored', () => {
  const fresh = load();
  fresh.message({ type: 'agui-demo-hello' });
  assert.deepEqual(fresh.posted, [{ to: 'message-source', message: { type: 'agui-demo-ready', version: 1, ready: true } }]);
  for (const data of [undefined, null, 'agui-demo-hello', 7, { type: 'other' }, { type: 'agui-demo-hello-not' }, { threadId: 't', headers: { authorization: 'x' } }]) fresh.message(data);
  assert.equal(fresh.posted.length, 1);
});

// ---- what the worker is made of ----------------------------------------------------------------

test('the worker bundle pulls in only the shared pure producers, their pacing and no Node, React or storage code', () => {
  assert.ok(inputs.length > 1);
  for (const file of inputs) assert.match(file, /^(demo\/service-worker\.ts|examples\/reference-agent\/(scenarios|pacing|a2ui-scenarios|protocol-fixtures|recorder-fixtures)\.ts)$/, file);
  assert.ok(!code.includes('node:'));
  assert.ok(!/\brequire\(/.test(code));
  for (const forbidden of [/\bcaches\b/, /\bindexedDB\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bimportScripts\b/, /\bfetch\(/, /\.headers\b(?!\s*:)/, /\bcredentials\b/, /\bcookie/i]) {
    // The only `headers` in the bundle is the option object of the Response it builds.
    const match = code.match(forbidden);
    assert.equal(match, null, `unexpected ${String(forbidden)} in the worker bundle: ${match?.[0]}`);
  }
});

test('the worker source reads no request headers and forwards nothing', () => {
  const source = readFileSync(entry, 'utf8');
  assert.doesNotMatch(source, /request\.headers|\.headers\.(get|has|entries|forEach)|credentials|cookie/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|importScripts|caches|indexedDB|localStorage|sessionStorage|XMLHttpRequest|WebSocket|clone\(\)/);
  assert.doesNotMatch(source, /from 'node:|from "node:|process\./);
});
