// F05 T017: the session store. Appends are immediate, notifications are batched per animation frame,
// and the invariants an export and import rely on are enforced when the data goes in.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HttpAgent } from '@ag-ui/client';
import { protocolScenarios } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { scenarioSend } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { DerivedEntry, Exchange, Finding, RawFrame, Run, SessionStore } from '../../src/contracts.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const exchange = (id = 'exchange-1', extra: Partial<Exchange> = {}): Exchange => ({
  id,
  kind: 'conversation',
  method: 'POST',
  path: '/agent',
  startedAt: 1_700_000_000_000,
  transport: 'sending',
  frameIds: [],
  ...extra,
});

const frame = (exchangeId: string, index: number, extra: Partial<RawFrame> = {}): RawFrame => ({
  id: `${exchangeId}:frame-${index}`,
  exchangeId,
  index,
  classification: 'data',
  envelope: 'data: {}\n\n',
  data: '{}',
  offsetMs: index * 10,
  summary: 'Test',
  jsonVerdict: 'valid',
  schemaVerdict: 'invalid',
  provenance: 'raw',
  ...extra,
});

const controlFrame = (exchangeId: string, index: number): RawFrame => {
  const { data: _data, ...rest } = frame(exchangeId, index);
  return { ...rest, classification: 'control', envelope: ': keepalive\n\n', summary: 'SSE comment', jsonVerdict: 'not-applicable', schemaVerdict: 'not-applicable' };
};

const run = (id = 'run-1', extra: Partial<Run> = {}): Run => ({
  id,
  threadId: 't',
  runId: 'r',
  input: { threadId: 't', runId: 'r', state: {}, messages: [], tools: [], context: [], forwardedProps: {} },
  exchangeId: 'exchange-1',
  startedAt: 1_700_000_000_000,
  outcome: { kind: 'unknown' },
  ...extra,
});

const finding = (id: string, subject: Finding['subject'], kind: Finding['kind'] = 'schema'): Finding => ({ id, kind, message: 'm', subject });

/** A scheduler the test drives by hand, like requestAnimationFrame. */
function manualScheduler() {
  const queue: Array<() => void> = [];
  return {
    schedule: (callback: () => void) => void queue.push(callback),
    pending: () => queue.length,
    frame: () => queue.splice(0).forEach((callback) => callback()),
  };
}

function setup(options: Parameters<typeof createSessionStore>[0] = {}) {
  const scheduler = manualScheduler();
  const store = createSessionStore({ schedule: scheduler.schedule, onListenerError: () => {}, ...options });
  return { store, scheduler };
}

// ---- immediate append, batched notification --------------------------------------------------------

test('every append is readable at once, before any animation frame', () => {
  const { store, scheduler } = setup();
  store.subscribe(() => {});
  store.appendExchange(exchange());
  store.appendFrame(frame('exchange-1', 0));
  store.appendFrame(frame('exchange-1', 1));

  assert.equal(scheduler.pending(), 1);
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.frames.map((f) => f.id), ['exchange-1:frame-0', 'exchange-1:frame-1']);
  assert.deepEqual(snapshot.exchanges[0]!.frameIds, ['exchange-1:frame-0', 'exchange-1:frame-1']);
});

test('subscribers are told at most once per animation frame, however many appends happened', () => {
  const { store, scheduler } = setup();
  let calls = 0;
  store.subscribe(() => (calls += 1));
  store.appendExchange(exchange());
  for (let i = 0; i < 1000; i++) store.appendFrame(frame('exchange-1', i));
  store.addFinding(finding('f1', { type: 'exchange', id: 'exchange-1' }));

  assert.equal(calls, 0, 'nothing is pushed synchronously');
  assert.equal(scheduler.pending(), 1, 'one frame is scheduled, not one per append');
  scheduler.frame();
  assert.equal(calls, 1);
  assert.equal(store.snapshot().frames.length, 1000, 'no append was dropped or coalesced');

  store.appendFrame(frame('exchange-1', 1000));
  store.appendFrame(frame('exchange-1', 1001));
  scheduler.frame();
  assert.equal(calls, 2, 'the next change schedules the next frame');
  scheduler.frame();
  assert.equal(calls, 2, 'a frame with no change notifies nobody');
});

test('every subscriber is notified once per frame, and an unsubscribed one is not', () => {
  const { store, scheduler } = setup();
  const seen: string[] = [];
  const offA = store.subscribe(() => seen.push('a'));
  store.subscribe(() => seen.push('b'));
  store.appendExchange(exchange());
  offA();
  scheduler.frame();
  assert.deepEqual(seen, ['b']);
});

test('a subscriber removed by another subscriber during the same frame is skipped', () => {
  const { store, scheduler } = setup();
  const seen: string[] = [];
  let offB = () => {};
  store.subscribe(() => {
    seen.push('a');
    offB();
  });
  offB = store.subscribe(() => seen.push('b'));
  store.appendExchange(exchange());
  scheduler.frame();
  assert.deepEqual(seen, ['a']);
});

test('a subscriber that throws is reported, does not stop the others and cannot affect an append', () => {
  const errors: unknown[] = [];
  const { store, scheduler } = setup({ onListenerError: (error) => errors.push(error) });
  const seen: string[] = [];
  store.subscribe(() => {
    throw new Error('view exploded');
  });
  store.subscribe(() => seen.push('second'));
  store.appendExchange(exchange());
  scheduler.frame();
  assert.deepEqual(seen, ['second']);
  assert.equal(errors.length, 1);
  store.appendFrame(frame('exchange-1', 0));
  scheduler.frame();
  assert.equal(store.snapshot().frames.length, 1);
});

test('with a synchronous scheduler a throwing subscriber still cannot break the append', () => {
  const store = createSessionStore({ schedule: (callback) => callback(), onListenerError: () => {} });
  store.subscribe(() => {
    throw new Error('view exploded');
  });
  assert.doesNotThrow(() => store.appendExchange(exchange()));
  assert.equal(store.snapshot().exchanges.length, 1);
});

test('a scheduler that throws loses no data and is tried again on the next change', () => {
  let broken = true;
  const queue: Array<() => void> = [];
  const store = createSessionStore({
    schedule: (callback) => {
      if (broken) throw new Error('no animation frames');
      queue.push(callback);
    },
    onListenerError: () => {},
  });
  let calls = 0;
  store.subscribe(() => (calls += 1));
  store.appendExchange(exchange());
  assert.equal(store.snapshot().exchanges.length, 1);
  broken = false;
  store.appendFrame(frame('exchange-1', 0));
  queue.splice(0).forEach((callback) => callback());
  assert.equal(calls, 1);
});

test('without subscribers nothing is scheduled', () => {
  const { store, scheduler } = setup();
  store.appendExchange(exchange());
  assert.equal(scheduler.pending(), 0);
});

// ---- ordering, offsets and references -----------------------------------------------------------------

test('frame indices follow arrival order within an exchange; a gap, a repeat or a stranger is refused', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.appendExchange(exchange('exchange-2'));
  store.appendFrame(frame('exchange-1', 0));
  assert.throws(() => store.appendFrame(frame('exchange-1', 2)), /index 2, expected 1/);
  assert.throws(() => store.appendFrame(frame('exchange-1', 0, { id: 'other' })), /index 0, expected 1/);
  assert.throws(() => store.appendFrame(frame('exchange-1', 1, { id: 'exchange-1:frame-0' })), /duplicate frame/);
  assert.throws(() => store.appendFrame(frame('missing', 0)), /unknown exchange/);
  store.appendFrame(frame('exchange-2', 0));
  store.appendFrame(frame('exchange-1', 1));
  assert.deepEqual(store.snapshot().frames.map((f) => f.id), ['exchange-1:frame-0', 'exchange-2:frame-0', 'exchange-1:frame-1']);
});

test('offsets are monotonic within an exchange: equal is fine; backwards, negative or not finite is refused', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.appendExchange(exchange('exchange-2'));
  store.appendFrame(frame('exchange-1', 0, { offsetMs: 0 }));
  store.appendFrame(frame('exchange-1', 1, { offsetMs: 40 }));
  store.appendFrame(frame('exchange-1', 2, { offsetMs: 40 }));
  assert.throws(() => store.appendFrame(frame('exchange-1', 3, { offsetMs: 39.9 })), /not monotonic/);
  assert.throws(() => store.appendFrame(frame('exchange-1', 3, { offsetMs: Number.NaN })), /not monotonic/);
  assert.throws(() => store.appendFrame(frame('exchange-2', 0, { offsetMs: -1 })), /not monotonic/);
  assert.throws(() => store.appendFrame(frame('exchange-2', 0, { offsetMs: Number.POSITIVE_INFINITY })), /not monotonic/);
  store.appendFrame(frame('exchange-2', 0, { offsetMs: 5 }));
  assert.equal(store.snapshot().frames.length, 4, 'refused appends changed nothing, and another exchange has its own clock');
  store.appendFrame(frame('exchange-1', 3, { offsetMs: 40 }));
  assert.equal(store.snapshot().frames.length, 5, 'the refused index is still the next one');
});

test('data text is present exactly on data frames', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  assert.throws(() => store.appendFrame(frame('exchange-1', 0, { classification: 'control' })), /control but has data/);
  assert.throws(() => store.appendFrame(frame('exchange-1', 0, { data: undefined })), /data but has no data/);
  store.appendFrame(controlFrame('exchange-1', 0));
  assert.equal(store.snapshot().frames[0]!.classification, 'control');
});

test('exchange ids are unique and frames are appended, never declared', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  assert.throws(() => store.appendExchange(exchange()), /duplicate exchange/);
  assert.throws(() => store.appendExchange(exchange('exchange-2', { frameIds: ['x'] })), /appended, not declared/);
});

test('findings point at something that exists and have unique ids', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.appendFrame(frame('exchange-1', 0));
  store.upsertRun(run());
  store.addFinding(finding('a', { type: 'frame', id: 'exchange-1:frame-0' }));
  store.addFinding(finding('b', { type: 'run', id: 'run-1' }, 'sequence'));
  store.addFinding(finding('c', { type: 'exchange', id: 'exchange-1' }, 'transport'));
  assert.throws(() => store.addFinding(finding('a', { type: 'exchange', id: 'exchange-1' })), /duplicate finding/);
  assert.throws(() => store.addFinding(finding('d', { type: 'frame', id: 'nope' })), /unknown frame/);
  assert.throws(() => store.addFinding(finding('e', { type: 'run', id: 'nope' })), /unknown run/);
  assert.throws(() => store.addFinding(finding('f', { type: 'exchange', id: 'nope' })), /unknown exchange/);
  assert.deepEqual(store.snapshot().findings.map((f) => f.id), ['a', 'b', 'c']);
});

// ---- evidence, findings and outcomes stay independent -------------------------------------------------

test('a finding never alters the frame, the run or the exchange it points at', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.appendFrame(frame('exchange-1', 0));
  store.upsertRun(run());
  const before = store.snapshot();
  store.addFinding(finding('a', { type: 'frame', id: 'exchange-1:frame-0' }, 'schema'));
  store.addFinding(finding('b', { type: 'run', id: 'run-1' }, 'sequence'));
  const after = store.snapshot();

  assert.equal(after.frames[0], before.frames[0], 'the very same frame record');
  assert.equal(after.runs[0], before.runs[0]);
  assert.equal(after.exchanges[0], before.exchanges[0]);
  assert.deepEqual(after.findings.map((f) => [f.kind, f.subject.type]), [['schema', 'frame'], ['sequence', 'run']]);
});

test('transport status and observed outcome change independently', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.upsertRun(run());

  store.updateExchange('exchange-1', { status: 200, transport: 'streaming' });
  store.updateExchange('exchange-1', { transport: 'completed', elapsedMs: 120 });
  assert.equal(store.snapshot().runs[0]!.outcome.kind, 'unknown', 'a completed transport is not an outcome');

  store.upsertRun(run('run-1', { outcome: { kind: 'error', message: 'agent failed', code: 'x' }, endedAt: 1_700_000_000_120 }));
  assert.equal(store.snapshot().exchanges[0]!.transport, 'completed', 'a run error is not a transport error');

  store.appendExchange(exchange('exchange-2'));
  store.upsertRun(run('run-2', { exchangeId: 'exchange-2', outcome: { kind: 'success', pendingToolCallIds: [] } }));
  store.updateExchange('exchange-2', { transport: 'user-stopped' });
  const snapshot = store.snapshot();
  assert.equal(snapshot.runs[1]!.outcome.kind, 'success', 'stopping the transport does not rewrite the outcome');
  assert.equal(snapshot.exchanges[1]!.transport, 'user-stopped');
});

test('upserting a run replaces it in place and keeps the order runs were first seen', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.upsertRun(run('run-1'));
  store.upsertRun(run('run-2'));
  store.upsertRun(run('run-1', { outcome: { kind: 'cancelled' } }));
  assert.deepEqual(store.snapshot().runs.map((r) => [r.id, r.outcome.kind]), [['run-1', 'cancelled'], ['run-2', 'unknown']]);
  assert.throws(() => store.upsertRun(run('run-3', { exchangeId: 'nope' })), /unknown exchange/);
});

test('updating an exchange cannot change its id or its frames', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.appendFrame(frame('exchange-1', 0));
  store.updateExchange('exchange-1', { id: 'other', frameIds: [], transport: 'completed' } as never);
  const [only] = store.snapshot().exchanges;
  assert.equal(only!.id, 'exchange-1');
  assert.deepEqual(only!.frameIds, ['exchange-1:frame-0']);
  assert.equal(only!.transport, 'completed');
  assert.throws(() => store.updateExchange('nope', { transport: 'completed' }), /unknown exchange/);
});

// ---- derived entries ----------------------------------------------------------------------------------------

const derived = (id: string, extra: Partial<DerivedEntry> = {}): DerivedEntry => ({
  id,
  provenance: 'derived',
  derivation: 'chunk-expansion',
  sources: ['exchange-1:frame-0'],
  attribution: 'identified',
  eventType: 'TEXT_MESSAGE_START',
  label: 'Expanded from TEXT_MESSAGE_CHUNK',
  ...extra,
});

test('derived entries link to the raw frames they came from and never become frames', () => {
  const { store } = setup();
  store.appendExchange(exchange());
  store.appendFrame(frame('exchange-1', 0));
  const framesBefore = store.snapshot().frames;

  store.appendDerived(derived('d1'));
  store.appendDerived(derived('d2', { attribution: 'ambiguous', sources: [] }));
  const snapshot = store.snapshot();

  assert.deepEqual(snapshot.derived.map((d) => [d.id, d.attribution, d.sources.length]), [['d1', 'identified', 1], ['d2', 'ambiguous', 0]]);
  assert.deepEqual(snapshot.frames, framesBefore, 'raw evidence is untouched');
  assert.ok(snapshot.derived.every((d) => d.provenance === 'derived' && !('index' in d)));
  assert.throws(() => store.appendDerived(derived('d1')), /duplicate entry/);
  assert.throws(() => store.appendDerived(derived('d3', { sources: ['nope'] })), /unknown frame/);
  assert.throws(() => store.appendDerived(derived('d4', { sources: [] })), /names no source frame/);
});

// ---- snapshots ------------------------------------------------------------------------------------------------

test('a snapshot is a stable picture: later appends do not change it, unchanged parts keep their identity', () => {
  const { store } = setup({ id: 'session-x' });
  store.appendExchange(exchange());
  store.appendExchange(exchange('exchange-2'));
  store.appendFrame(frame('exchange-1', 0));
  const first = store.snapshot();
  assert.equal(first.id, 'session-x');
  assert.equal(store.snapshot(), first, 'no change, same snapshot');

  store.appendFrame(frame('exchange-2', 0));
  const second = store.snapshot();
  assert.notEqual(second, first);
  assert.equal(first.frames.length, 1);
  assert.deepEqual(first.exchanges[1]!.frameIds, []);
  assert.equal(second.exchanges[0], first.exchanges[0], 'an exchange that did not change is the same object');
  assert.notEqual(second.exchanges[1], first.exchanges[1]);
});

// ---- wired to the recorder, the reader and the real protocol client ----------------------------------------------

async function settled(store: SessionStore, id: string) {
  for (;;) {
    const found = store.snapshot().exchanges.find((candidate) => candidate.id === id);
    if (found && ['completed', 'transport-error', 'user-stopped'].includes(found.transport)) return found;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

test('a client sequence error becomes a finding on the run while every frame stays captured', async () => {
  const { store } = setup();
  let tick = 0;
  const recorder = createRecorder(createFrameSink(store), { now: () => (tick += 5), epoch: () => 1_700_000_000_000 });
  const scenario = protocolScenarios.sequenceViolations;
  const agent = new HttpAgent({
    url: 'http://agent.invalid/agent',
    threadId: 't-proto',
    fetch: async (_url, init) => {
      const response = await recorder.record({ ...scenario.request, runId: 'run-1', body: String(init?.body) }, scenarioSend(scenario));
      // The conversation lane registers the run as soon as it has the exchange.
      store.upsertRun(run('run-1', { threadId: 't-proto', runId: 'r-proto', exchangeId: 'exchange-1' }));
      return response;
    },
  });

  const originalConsoleError = console.error;
  console.error = () => {}; // the client logs the failure with its stack
  let clientError: unknown;
  try {
    await agent.runAgent({ runId: 'r-proto' });
  } catch (error) {
    clientError = error;
  } finally {
    console.error = originalConsoleError;
  }
  assert.ok(clientError, 'the protocol client rejects the stream');
  store.addFinding(finding('client-1', { type: 'run', id: 'run-1' }, 'sequence'));

  const ended = await settled(store, 'exchange-1');
  const snapshot = store.snapshot();
  assert.equal(ended.transport, 'completed');
  assert.deepEqual(snapshot.frames.map((f) => f.eventType), ['RUN_STARTED', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TOOL_CALL_ARGS', 'RUN_FINISHED']);
  assert.ok(snapshot.frames.every((f) => f.schemaVerdict === 'valid'));
  assert.deepEqual(snapshot.findings.map((f) => [f.kind, f.subject.type]), [['sequence', 'run']]);
  assert.equal(snapshot.runs[0]!.outcome.kind, 'unknown', 'the store invents no outcome from a client failure');
});

// ---- the core stays framework-free ---------------------------------------------------------------------------------

test('no module under src/core imports React, a renderer or any view code', () => {
  const core = path.join(process.cwd(), 'packages', 'inspector', 'src', 'core');
  const files = readdirSync(core, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file));
  assert.ok(files.some((file) => file.startsWith('store')) && files.some((file) => file.startsWith('frames')) && files.some((file) => file.startsWith('recorder')));
  for (const file of files) {
    const source = readFileSync(path.join(core, file), 'utf8');
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
    for (const specifier of specifiers) {
      // The framework-free A2UI core may use the renderer's core package, and nothing else from @a2ui/.
      const rendererCore = file.startsWith('a2ui/') && /^@a2ui\/web_core(\/|$)/.test(specifier);
      assert.ok(rendererCore || !/^(react|react-dom|@a2ui\/)/.test(specifier), `${file} imports ${specifier}`);
      assert.ok(!/\/(views|app)\//.test(specifier), `${file} imports view code: ${specifier}`);
    }
    assert.ok(!/\bdocument\.|\bwindow\./.test(source), `${file} touches the DOM`);
    // Header isolation: nothing in core reads a header, a request object or the network.
    assert.ok(!/\.headers\b|\bHeaders\b|\bRequest\b|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/.test(source.replace(/\/\/.*$/gm, '')), `${file} touches headers or the network`);
  }
});
