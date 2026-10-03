// P02 T006: the default scenario bytes, IDs and order are frozen, and the Node fixture servers keep their
// validation, routes, CORS, request order, failure injection and open-stream accounting. The pure
// producers in examples/reference-agent/scenarios.ts must answer with exactly the bytes the Node
// interactive server puts on the wire, so a browser example and a Node fixture cannot drift apart.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { EventType } from '@ag-ui/core';
import { parseConfig } from '../../packages/inspector/src/core/config/index.ts';
import { continuation, formSurface, type UserAction } from '../../examples/reference-agent/a2ui-scenarios.ts';
import { createInteractiveServer, INTERRUPTS, REDIRECT_PATH, SCENARIOS, type InteractiveServer } from '../../examples/reference-agent/interactive-scenarios.ts';
import { baselineRun, eventFixtures, protocolScenarios, runError } from '../../examples/reference-agent/protocol-fixtures.ts';
import { scenarioBytes } from '../../examples/reference-agent/recorder-fixtures.ts';
import {
  a2uiResponse,
  baselineResponse,
  interactiveResponse,
  jsonResponse,
  referenceRunResponse,
  runErrorResponse,
  type RunInput,
  type ScenarioResponse,
} from '../../examples/reference-agent/scenarios.ts';

const decoder = new TextDecoder();
const text = (bytes: Uint8Array) => decoder.decode(bytes);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const join = (chunks: readonly Uint8Array[]) => Buffer.concat(chunks);
const bodyOf = (response: ScenarioResponse) => text(join(response.chunks));
const frames = (...events: readonly object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

const ids = { threadId: 't-1', runId: 'r-1' };
const started = { type: 'RUN_STARTED', threadId: 't-1', runId: 'r-1' };
const finished = { type: 'RUN_FINISHED', threadId: 't-1', runId: 'r-1', outcome: { type: 'success' } };
const say = (messageId: string, delta: string) => [
  { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId, delta },
  { type: 'TEXT_MESSAGE_END', messageId },
];
const user = (content: string) => ({ messages: [{ role: 'user', content }] });

const userAction: UserAction = { name: 'send_note', surfaceId: 'form', sourceComponentId: 'send', context: { note: 'first draft', count: 1 }, timestamp: '2026-10-02T10:00:00.000Z' };

interface Case {
  readonly name: string;
  readonly extra: Omit<RunInput, 'threadId' | 'runId'>;
  readonly expected: string;
  readonly ending?: 'hold-until-abort';
}

// Every branch of the interactive server, with the bytes it wrote before the refactor.
const CASES: readonly Case[] = [
  { name: 'plain', extra: user('hello'), expected: frames(started, ...say('m-r-1', 'Hello from the reference agent.'), finished) },
  { name: 'no messages', extra: {}, expected: frames(started, ...say('m-r-1', 'Hello from the reference agent.'), finished) },
  {
    name: 'interrupt',
    extra: user(SCENARIOS.interrupt),
    expected: frames(
      started,
      ...say('m-r-1', 'I need two answers before I can continue.'),
      {
        ...finished,
        outcome: {
          type: 'interrupt',
          interrupts: [
            {
              id: 'i-approve',
              reason: 'approval',
              message: 'Approve the refund of 25.00?',
              responseSchema: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, note: { type: 'string' } } },
            },
            { id: 'i-contact', reason: 'input', message: 'Which contact should the agent use?' },
          ],
        },
      },
    ),
  },
  {
    name: 'tools',
    extra: user(SCENARIOS.tools),
    expected: frames(
      started,
      { type: 'TOOL_CALL_START', toolCallId: 'c-color', toolCallName: 'pick_color' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c-color', delta: '{"choices":' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c-color', delta: '["red","teal"]}' },
      { type: 'TOOL_CALL_END', toolCallId: 'c-color' },
      { type: 'TOOL_CALL_START', toolCallId: 'c-size', toolCallName: 'pick_size' },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'c-size', delta: '{"max":3}' },
      { type: 'TOOL_CALL_END', toolCallId: 'c-size' },
      finished,
    ),
  },
  {
    name: 'slow',
    extra: user(SCENARIOS.slow),
    expected: frames(
      started,
      ...say(
        'm-r-1',
        'This reply is slow on purpose. A busy model can take several seconds to write a long answer, and the inspector records every frame as it arrives. The run finishes by itself when the last word lands. Press Stop at any point to cancel it and keep what has arrived.',
      ),
      finished,
    ),
  },
  {
    name: 'never finishes',
    extra: user(SCENARIOS.neverFinishes),
    expected: frames(started, { type: 'TEXT_MESSAGE_START', messageId: 'm-r-1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-r-1', delta: 'This response stays open until you press Stop.' }),
    ending: 'hold-until-abort',
  },
  {
    name: 'state',
    extra: user(SCENARIOS.state),
    expected: frames(
      started,
      { type: 'STATE_SNAPSHOT', snapshot: { counter: 1, items: ['a'] } },
      { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/counter', value: 2 }, { op: 'add', path: '/items/-', value: 'b' }] },
      finished,
    ),
  },
  {
    name: 'broken',
    extra: user(SCENARIOS.broken),
    expected:
      frames(started, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 'no start event' }) +
      'data: {not json at all\n\n' +
      frames({ type: 'STEP_STARTED', stepName: 'after the damage' }, { type: 'STEP_FINISHED', stepName: 'after the damage' }, finished),
  },
  {
    name: 'resume resolved',
    extra: { resume: [{ interruptId: 'i-approve', status: 'resolved', payload: { approved: true } }, { interruptId: 'i-contact', status: 'resolved', payload: 'ana' }] },
    expected: frames(started, ...say('m-r-1', 'Resumed with i-approve=resolved:{"approved":true}, i-contact=resolved:"ana"'), finished),
  },
  {
    name: 'resume cancelled',
    extra: { resume: [{ interruptId: 'i-approve', status: 'cancelled' }, { interruptId: 'i-contact', status: 'cancelled' }] },
    expected: frames(started, ...say('m-r-1', 'Resumed with i-approve=cancelled, i-contact=cancelled'), finished),
  },
  {
    name: 'tool results',
    extra: { messages: [{ role: 'tool', toolCallId: 'c-color', content: 'teal' }, { role: 'tool', toolCallId: 'c-size', content: '2' }] },
    expected: frames(started, ...say('m-r-1', 'Tool results: c-color=teal, c-size=2'), finished),
  },
  {
    name: 'a2ui action',
    extra: { forwardedProps: { a2uiAction: { userAction } } },
    expected: frames(started, ...say('m-r-1', 'Action received: send_note'), finished),
  },
  {
    name: 'resume outranks tool results, tool results outrank an action, an action outranks the message',
    extra: { resume: [{ interruptId: 'i-approve', status: 'cancelled' }], messages: [{ role: 'tool', toolCallId: 'c', content: 'x' }, { role: 'user', content: SCENARIOS.slow }], forwardedProps: { a2uiAction: { userAction } } },
    expected: frames(started, ...say('m-r-1', 'Resumed with i-approve=cancelled'), finished),
  },
];

let site: InteractiveServer;
let cors: InteractiveServer;
const origin = 'http://127.0.0.1:4173';

before(async () => {
  site = await createInteractiveServer({ assets: { '/index.html': ['text/html', '<p>page</p>'] } });
  cors = await createInteractiveServer({ allowOrigin: origin });
});
after(async () => {
  await site.close();
  await cors.close();
});

const postTo = (server: InteractiveServer, route: string, body: string, headers: Record<string, string> = {}, signal?: AbortSignal) =>
  fetch(`${server.origin}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, ...(signal && { signal }) });
const run = (extra: Case['extra'], server = site, signal?: AbortSignal) => postTo(server, '/agent', JSON.stringify({ ...ids, ...extra }), {}, signal);

for (const scenario of CASES) {
  test(`interactive ${scenario.name}: the Node server and the shared producer write the frozen bytes`, async () => {
    const produced = interactiveResponse({ ...ids, ...scenario.extra });
    assert.equal(produced.status, 200);
    assert.equal(produced.contentType, 'text/event-stream');
    assert.equal(produced.ending, scenario.ending ?? 'close');
    assert.equal(bodyOf(produced), scenario.expected);
    assert.ok(produced.chunks.every((chunk) => chunk instanceof Uint8Array), 'bytes, not strings');

    if (scenario.ending === undefined) {
      const response = await run(scenario.extra);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'text/event-stream');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), scenario.expected);
      return;
    }
    // A held stream: the bytes arrive, the connection stays counted open, and going away releases it.
    const controller = new AbortController();
    const response = await run(scenario.extra, site, controller.signal);
    const reader = response.body!.getReader();
    let received = '';
    while (received.length < scenario.expected.length) {
      const { value, done } = await reader.read();
      assert.equal(done, false, 'the stream must stay open');
      received += decoder.decode(value, { stream: true });
    }
    assert.equal(received, scenario.expected);
    assert.equal(site.openStreams(), 1);
    controller.abort();
    await reader.read().catch(() => undefined);
    for (let waited = 0; site.openStreams() !== 0 && waited < 100; waited += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(site.openStreams(), 0);
  });
}

test('only the slow scenario asks for slow pacing, and only never finishes is held open', () => {
  const answers = Object.values(SCENARIOS).map((content) => [content, interactiveResponse({ ...ids, ...user(content) })] as const);
  assert.deepEqual(answers.filter(([, answer]) => answer.pacing !== undefined).map(([content, answer]) => [content, answer.pacing]), [['slow', 'slow']]);
  assert.deepEqual(answers.filter(([, answer]) => answer.ending === 'hold-until-abort').map(([content]) => content), ['never finishes']);
});

test('the interrupts the server declares are the ones exported for tests', () => {
  assert.deepEqual(INTERRUPTS.map((interrupt) => interrupt.id), ['i-approve', 'i-contact']);
});

test('the interactive server keeps its routes, statuses, CORS and request order', async () => {
  site.reset();
  const base = site.origin;
  assert.equal((await fetch(`${base}/index.html`)).status, 200);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}${REDIRECT_PATH}`, { redirect: 'manual' })).status, 302);

  const first = await postTo(site, '/prepare/sessions/t-1', '{"a":1}');
  assert.deepEqual([first.status, await first.text(), first.headers.get('content-type')], [200, '{"ok":true}', 'application/json']);
  await (await postTo(site, '/prepare/warm', 'not json')).text();
  await (await run(user('hello'))).text();
  const unknown = await postTo(site, '/elsewhere', '{}');
  assert.deepEqual([unknown.status, await unknown.text()], [404, '{"error":"not found"}']);

  assert.deepEqual(
    site.requests().map(({ seq, kind, method, path: route, body, text: raw, credentials }) => ({ seq, kind, method, route, body, raw, credentials })),
    [
      { seq: 1, kind: 'preparation', method: 'POST', route: '/prepare/sessions/t-1', body: { a: 1 }, raw: '{"a":1}', credentials: [] },
      { seq: 2, kind: 'preparation', method: 'POST', route: '/prepare/warm', body: 'not json', raw: 'not json', credentials: [] },
      { seq: 3, kind: 'run', method: 'POST', route: '/agent', body: { ...ids, ...user('hello') }, raw: JSON.stringify({ ...ids, ...user('hello') }), credentials: [] },
    ],
  );
  assert.deepEqual(site.paths().slice(0, 3), ['GET /index.html', 'GET /missing', 'GET /redirect']);
});

test('the interactive server validates run identifiers with 422 and records the request first', async () => {
  site.reset();
  const response = await postTo(site, '/agent', '{"threadId":1,"runId":"r"}');
  assert.equal(response.status, 422);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(await response.text(), '{"detail":"threadId and runId must be strings"}');
  const malformed = await postTo(site, '/agent', '{not json');
  assert.equal(malformed.status, 422);
  assert.deepEqual(site.requests().map((request) => request.body), [{ threadId: 1, runId: 'r' }, '{not json']);
});

test('scripted failures answer with the chosen status until cleared', async () => {
  site.fail('/prepare/warm', 503);
  site.fail('/agent');
  const warm = await postTo(site, '/prepare/warm', '{}');
  assert.deepEqual([warm.status, await warm.text()], [503, '{"error":"scripted failure"}']);
  assert.equal((await run(user('hello'))).status, 500);
  site.clear();
  assert.equal((await run(user('hello'))).status, 200);
});

test('the interactive server records credential header names, never values', async () => {
  site.reset();
  await (await postTo(site, '/agent', JSON.stringify(ids), { authorization: 'Bearer synthetic', 'x-api-key': 'synthetic', cookie: 'a=b' })).text();
  assert.deepEqual(site.requests()[0]!.credentials, ['authorization', 'x-api-key', 'cookie']);
  assert.doesNotMatch(JSON.stringify(site.requests()), /synthetic|a=b/);
});

test('the interactive server grants CORS to its one origin and answers preflight', async () => {
  const granted = await run(user('hello'), cors).then((r) => r.status);
  assert.equal(granted, 200);
  const withOrigin = await postTo(cors, '/agent', JSON.stringify(ids), { origin });
  assert.equal(withOrigin.headers.get('access-control-allow-origin'), origin);
  assert.equal(withOrigin.headers.get('vary'), 'Origin');
  assert.equal(withOrigin.headers.get('access-control-allow-credentials'), null);
  const other = await postTo(cors, '/agent', JSON.stringify(ids), { origin: 'http://evil.invalid' });
  assert.equal(other.headers.get('access-control-allow-origin'), null);

  const preflight = (from: string) => fetch(`${cors.origin}/agent`, { method: 'OPTIONS', headers: { origin: from, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' } });
  const ok = await preflight(origin);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-methods'), 'GET, POST, PUT, OPTIONS');
  assert.equal(ok.headers.get('access-control-allow-headers'), 'content-type,authorization');
  const refused = await preflight('http://evil.invalid');
  assert.equal(refused.status, 204);
  assert.equal(refused.headers.get('access-control-allow-origin'), null);
});

// ---- the CLI fixture server --------------------------------------------------------------------

test('the CLI fixture server keeps its plain run, validation statuses and routes', async () => {
  const child: ChildProcess = spawn(process.execPath, [path.join(process.cwd(), 'examples/reference-agent/server.ts'), '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const [line] = (await once(child.stdout!, 'data')) as [Buffer];
    const { url } = JSON.parse(line.toString()) as { url: string };
    const post = (route: string, body: string) => fetch(`${url}${route}`, { method: 'POST', body });

    const plain = await post('/agent', JSON.stringify(ids));
    assert.deepEqual([plain.status, plain.headers.get('content-type'), plain.headers.get('cache-control')], [200, 'text/event-stream', 'no-store']);
    const expected = frames(started, { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hello from the reference agent.' }, { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' }, finished);
    assert.equal(await plain.text(), expected);
    assert.equal(bodyOf(referenceRunResponse(ids)), expected);

    const malformed = await post('/agent', '{nope');
    assert.deepEqual([malformed.status, await malformed.text()], [400, '{"error":"request body is not valid JSON"}']);
    const missing = await post('/agent', '{"threadId":"t"}');
    assert.deepEqual([missing.status, await missing.text()], [422, '{"error":"threadId and runId must be strings"}']);
    assert.equal((await fetch(`${url}/agent`)).status, 405);
    assert.equal((await fetch(`${url}/health`)).status, 200);
    assert.equal((await fetch(`${url}/elsewhere`)).status, 404);
  } finally {
    child.kill();
  }
});

// ---- protocol bytes ---------------------------------------------------------------------------

test('default protocol bytes and chunk boundaries are unchanged', () => {
  const frozen = (scenario: { chunks: readonly Uint8Array[] }) => [sha256(scenarioBytes(scenario as never)), scenario.chunks.map((chunk) => chunk.length)];
  assert.deepEqual(frozen(protocolScenarios.baselineRun), ['f7d4e56a041e77878e1ec024f8ceeb43a25f2b9e0372ae87dfb58fd3bb2a6579', [1, 7, 64, 2788]]);
  assert.deepEqual(frozen(protocolScenarios.runError), ['babaa0d9bd4ff8598cf1067d6547eebbc4101c18e2fc276a772573ba7da6fe2a', [64, 64, 24]]);
  assert.equal(sha256(scenarioBytes(protocolScenarios.invalidFrames)), 'ca33b424defaeddaffa4e736ae52bafe04fa0ead9ef18ae17c1733241d316d83');
  assert.equal(sha256(scenarioBytes(protocolScenarios.sequenceViolations)), '777846075dcfff838ac30900abbb116a8167d0d5975600138006e4005e5d128e');
  assert.equal(sha256(scenarioBytes(protocolScenarios.controlEvidence)), 'bccffbcf9e2c0607137dff96abc7a5cb0e81e135d1cf63af3f579fa4426319e1');
});

test('the baseline and run-error scenarios take the defaults and equal the exported fixtures', () => {
  assert.equal(sha256(scenarioBytes(baselineRun())), sha256(scenarioBytes(protocolScenarios.baselineRun)));
  assert.equal(sha256(scenarioBytes(runError())), sha256(scenarioBytes(protocolScenarios.runError)));
  assert.equal(eventFixtures.RUN_STARTED.threadId, 't-proto');
  assert.equal(eventFixtures.RUN_FINISHED.runId, 'r-proto');
});

test('baseline plus run-error carry all 31 supported event types, once each in the baseline', () => {
  const types = (scenario: Parameters<typeof scenarioBytes>[0]) =>
    text(scenarioBytes(scenario))
      .split(/\r\n\r\n|\n\n|\r\r/)
      .filter((block) => block !== '')
      .map((block) => (JSON.parse(block.replace(/^data: /, '')) as { type: string }).type);
  const baseline = types(protocolScenarios.baselineRun);
  const all = new Set([...baseline, ...types(protocolScenarios.runError)]);
  assert.equal(all.size, 31);
  assert.deepEqual([...all].sort(), Object.keys(EventType).sort());
  assert.equal(new Set(baseline).size, baseline.length);
});

test('supplied identifiers change only the run envelope, generated at the source', () => {
  const custom = { threadId: 'thread-π', runId: 'run-42' };
  for (const [fixed, generate] of [[protocolScenarios.baselineRun, baselineRun], [protocolScenarios.runError, runError]] as const) {
    const bytes = scenarioBytes(generate(custom));
    const defaults = text(scenarioBytes(fixed));
    assert.equal(text(bytes), defaults.replaceAll('"threadId":"t-proto"', '"threadId":"thread-π"').replaceAll('"runId":"r-proto"', '"runId":"run-42"'));
    assert.equal(generate(custom).chunks.length, fixed.chunks.length);
    assert.deepEqual(JSON.parse(generate(custom).request.body!), { ...custom, messages: [], state: {}, tools: [], context: [], forwardedProps: {} });
  }
});

test('the shared producers answer the protocol routes with input-matched bytes', () => {
  const custom = { threadId: 'tt', runId: 'rr' };
  const baseline = baselineResponse(custom);
  assert.deepEqual([baseline.status, baseline.contentType, baseline.ending], [200, 'text/event-stream', 'close']);
  assert.deepEqual(baseline.chunks, baselineRun(custom).chunks);
  assert.match(bodyOf(baseline), /^data: \{"type":"RUN_STARTED","threadId":"tt","runId":"rr"\}\r?\n/);
  assert.deepEqual(runErrorResponse(custom).chunks, runError(custom).chunks);
  assert.equal(bodyOf(runErrorResponse(custom)), frames({ type: 'RUN_STARTED', threadId: 'tt', runId: 'rr' }, eventFixtures.RUN_ERROR));
  assert.equal(sha256(join(baselineResponse({ threadId: 't-proto', runId: 'r-proto' }).chunks)), sha256(scenarioBytes(protocolScenarios.baselineRun)));
});

// ---- A2UI -------------------------------------------------------------------------------------

test('the A2UI producer sends the form, then the continuation for the action it was sent', () => {
  const surface = (operations: readonly unknown[]) =>
    frames(started, { type: 'ACTIVITY_SNAPSHOT', messageId: 'a2ui-surface-1', activityType: 'a2ui-surface', content: { a2ui_operations: operations }, replace: true }, finished);
  const initial = a2uiResponse(ids);
  assert.deepEqual([initial.status, initial.contentType, initial.ending], [200, 'text/event-stream', 'close']);
  assert.equal(bodyOf(initial), surface(formSurface));

  const next = a2uiResponse({ ...ids, forwardedProps: { a2uiAction: { userAction } } });
  assert.equal(bodyOf(next), surface(continuation(formSurface, userAction)));
  // A malformed action is not a continuation: the form is sent again.
  assert.equal(bodyOf(a2uiResponse({ ...ids, forwardedProps: { a2uiAction: { userAction: { name: 'send_note' } } } })), surface(formSurface));
});

test('a JSON error response is a status and bytes, never a stream', () => {
  const response = jsonResponse(422, { error: 'x' });
  assert.deepEqual([response.status, response.contentType, response.ending, bodyOf(response)], [422, 'application/json', 'close', '{"error":"x"}']);
});

// ---- deployment files --------------------------------------------------------------------------

const demoFile = (name: string) => readFileSync(path.join(process.cwd(), 'demo', name), 'utf8');

test('the hosting file opts a hosted deployment in to visitor targets and names no required config', () => {
  assert.deepEqual(JSON.parse(demoFile('hosting-config.json')), { version: 0, mode: 'hosted', allowedOrigins: [], allowVisitorTargets: true });
});

test('the example configuration is a valid version-0 file with the four example agents and no credentials or policy', () => {
  const parsed = parseConfig(demoFile('config.json'));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  assert.deepEqual(parsed.value.warnings, []);
  assert.equal(parsed.value.version, 0);
  assert.deepEqual(parsed.value.agents.map((agent) => [agent.id, agent.url]), [
    ['interactive', '__demo__/agent/interactive'],
    ['a2ui', '__demo__/agent/a2ui'],
    ['protocol-baseline', '__demo__/agent/protocol/baseline'],
    ['protocol-run-error', '__demo__/agent/protocol/run-error'],
  ]);
  const text = demoFile('config.json');
  assert.doesNotMatch(text, /"(headers|token|authorization|auth|apiKey|cookie|allowedOrigins|allowVisitorTargets|mode)"/i);
  assert.doesNotMatch(text, /https?:/);
  for (const agent of parsed.value.agents) {
    assert.match(agent.url, /^__demo__\//, 'demo-relative, so the build can prefix the deployment base');
    assert.ok(agent.preset?.quickMessages?.length, `${agent.id} has a quick message`);
  }
});

test('the interactive agent exposes all seven scenarios as quick messages and prepares a session, then warms, in order', () => {
  const parsed = parseConfig(demoFile('config.json'));
  assert.ok(parsed.ok);
  const interactive = parsed.value.agents.find((agent) => agent.id === 'interactive')!;
  const messages = interactive.preset!.quickMessages!;
  assert.equal(messages.length, 7);
  assert.deepEqual(messages.slice(1), Object.values(SCENARIOS));
  const answers = messages.map((message) => bodyOf(interactiveResponse({ ...ids, messages: [{ role: 'user', content: message }] })));
  assert.equal(new Set(answers).size, 7, 'seven different scenarios');
  assert.match(answers[0]!, /Hello from the reference agent\./, 'the first is the plain reply');

  assert.deepEqual(
    interactive.preset!.prepare!.map(({ method, path: route, body }) => ({ method, route, body })),
    [
      { method: 'PUT', route: '__demo__/prepare/sessions/{{threadId}}', body: { thread: '{{threadId}}' } },
      { method: 'POST', route: '__demo__/prepare/warm', body: { run: '{{runId}}' } },
    ],
  );
  assert.equal(interactive.preset!.messages, 'turn');
});
