// F04 T012: the wire recorder. It copies request metadata and the response body without touching
// the client's branch, never reads a header, and keeps partial evidence when a run ends badly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpAgent } from '@ag-ui/client';
import {
  fragment,
  recorderScenarios,
  scenarioBody,
  scenarioBytes,
  scenarioSend,
  type RecorderScenario,
} from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { Exchange, ExchangeId, ExchangePatch, Finding } from '../../src/contracts.ts';
import { createRecorder, type RecorderSink } from '../../src/core/recorder/index.ts';

const TERMINAL = ['completed', 'transport-error', 'user-stopped'];
const decoder = new TextDecoder();

/** A sink that keeps everything it is given, plus a promise per exchange for its last update. */
function memorySink(options: { failOnChunk?: boolean } = {}) {
  const exchanges = new Map<ExchangeId, Exchange>();
  const chunks = new Map<ExchangeId, Array<{ bytes: Uint8Array; offsetMs: number }>>();
  const findings: Finding[] = [];
  const waiting = new Map<ExchangeId, Array<() => void>>();
  const sink: RecorderSink = {
    appendExchange(exchange) {
      exchanges.set(exchange.id, exchange);
      chunks.set(exchange.id, []);
    },
    updateExchange(id: ExchangeId, patch: ExchangePatch) {
      exchanges.set(id, { ...exchanges.get(id)!, ...patch });
      if (patch.transport && TERMINAL.includes(patch.transport)) for (const wake of waiting.get(id) ?? []) wake();
    },
    addFinding: (finding) => void findings.push(finding),
    appendChunk(id, bytes, offsetMs) {
      if (options.failOnChunk) throw new Error('reader exploded');
      chunks.get(id)!.push({ bytes, offsetMs });
    },
  };
  return {
    sink,
    findings,
    all: () => [...exchanges.values()],
    only: () => {
      assert.equal(exchanges.size, 1);
      return [...exchanges.values()][0]!;
    },
    chunksOf: (id: ExchangeId) => chunks.get(id)!,
    bytesOf: (id: ExchangeId) => concat(chunks.get(id)!.map((chunk) => chunk.bytes)),
    /** Resolves once the recorder has finished with the exchange, whatever the outcome. */
    settled: (id: ExchangeId) =>
      new Promise<Exchange>((resolve) => {
        const done = () => resolve(exchanges.get(id)!);
        if (TERMINAL.includes(exchanges.get(id)!.transport)) return done();
        waiting.set(id, [...(waiting.get(id) ?? []), done]);
      }),
  };
}

/** A clock that advances 5 ms per read, so durations and offsets are exact. */
function steppedClock() {
  let monotonic = 0;
  return { now: () => (monotonic += 5), epoch: () => 1_700_000_000_000 };
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) (bytes.set(part, at), (at += part.length));
  return bytes;
}

async function readAll(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  const reader = body!.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concat(parts);
    parts.push(value);
  }
}

function setup() {
  const memory = memorySink();
  return { memory, recorder: createRecorder(memory.sink, steppedClock()) };
}

test('an exchange records method, path, the exact body, status and duration, and nothing else', async () => {
  const { memory, recorder } = setup();
  const body = '{ "runId":"r-rec",\n  "threadId": "t-rec" }';
  const scenario = recorderScenarios.coalescedStream;
  await recorder.record({ ...scenario.request, body }, scenarioSend(scenario));
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.kind, 'conversation');
  assert.equal(exchange.method, 'POST');
  assert.equal(exchange.path, '/agent');
  assert.equal(exchange.requestBody, body, 'the request body text is kept byte for byte, whitespace and key order included');
  assert.deepEqual(exchange.requestBodyJson, { runId: 'r-rec', threadId: 't-rec' });
  assert.equal(exchange.status, 200);
  assert.equal(exchange.transport, 'completed');
  assert.equal(exchange.startedAt, 1_700_000_000_000);
  assert.equal(typeof exchange.elapsedMs, 'number');
  assert.ok(exchange.elapsedMs! > 0);
  assert.equal(exchange.transportError, undefined);
  assert.deepEqual(memory.findings, []);
});

test('a request body that is not JSON is kept as text with no parsed companion', async () => {
  const { memory, recorder } = setup();
  const scenario = recorderScenarios.coalescedStream;
  await recorder.record({ kind: 'raw', method: 'POST', path: '/agent', body: '{not json', responseKind: 'sse' }, scenarioSend(scenario));
  const exchange = memory.only();
  assert.equal(exchange.kind, 'raw');
  assert.equal(exchange.requestBody, '{not json');
  assert.equal(exchange.requestBodyJson, undefined);
});

test('a request without a body records none', async () => {
  const { memory, recorder } = setup();
  const scenario = recorderScenarios.errorTextBody;
  await recorder.record({ kind: 'preparation', method: 'GET', path: '/sessions', responseKind: 'response' }, scenarioSend(scenario));
  assert.equal('requestBody' in memory.only(), false);
  assert.equal('requestBodyJson' in memory.only(), false);
});

test('a split stream is recorded chunk by chunk and the client gets the same bytes', async () => {
  const scenario = recorderScenarios.splitStream;
  const wire = scenarioBytes(scenario);
  assert.ok(scenario.chunks.length > 10, 'the fixture really is fragmented');
  assert.throws(
    () => scenario.chunks.forEach((chunk) => new TextDecoder('utf-8', { fatal: true }).decode(chunk)),
    'at least one chunk ends inside a multibyte code point',
  );

  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  const clientBytes = await readAll(response.body);
  const exchange = await memory.settled(memory.only().id);

  assert.deepEqual(clientBytes, wire);
  assert.deepEqual(memory.bytesOf(exchange.id), wire, 'two independent readers see identical bytes');
  assert.deepEqual(
    memory.chunksOf(exchange.id).map((chunk) => chunk.bytes.length),
    scenario.chunks.map((chunk) => chunk.length),
    'chunks are handed over as they arrived, not regrouped',
  );
  assert.equal(exchange.transport, 'completed');
  assert.equal(exchange.responseBody, undefined, 'an event stream is not also stored as a body');
});

test('chunk offsets run from request dispatch and never go backwards', async () => {
  const scenario = recorderScenarios.splitStream;
  const { memory, recorder } = setup();
  await recorder.record(scenario.request, scenarioSend(scenario));
  const exchange = await memory.settled(memory.only().id);
  const offsets = memory.chunksOf(exchange.id).map((chunk) => chunk.offsetMs);

  assert.ok(offsets[0]! > 0);
  assert.deepEqual([...offsets].sort((a, b) => a - b), offsets);
  assert.equal(new Set(offsets).size, offsets.length, 'every chunk is stamped when it arrives');
  assert.ok(exchange.elapsedMs! >= offsets.at(-1)!, 'the exchange outlasts its last chunk');
});

test('a coalesced stream arrives as one chunk and is not split', async () => {
  const scenario = recorderScenarios.coalescedStream;
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  const clientBytes = await readAll(response.body);
  const exchange = await memory.settled(memory.only().id);

  assert.equal(memory.chunksOf(exchange.id).length, 1);
  assert.deepEqual(memory.bytesOf(exchange.id), clientBytes);
  assert.deepEqual(clientBytes, scenarioBytes(scenario));
});

test('the same bytes are recorded however the stream is cut', async () => {
  const wire = scenarioBytes(recorderScenarios.coalescedStream);
  for (const sizes of [[1], [2], [3, 5], [7], [64], [4096], [1, 7, 64, 4096]]) {
    const scenario: RecorderScenario = { ...recorderScenarios.coalescedStream, chunks: fragment(wire, sizes) };
    const { memory, recorder } = setup();
    const response = await recorder.record(scenario.request, scenarioSend(scenario));
    const clientBytes = await readAll(response.body);
    const exchange = await memory.settled(memory.only().id);
    assert.deepEqual(memory.bytesOf(exchange.id), wire, `cut ${sizes.join(',')}`);
    assert.deepEqual(clientBytes, wire, `cut ${sizes.join(',')}`);
  }
});

test('the client receives the original response object, untouched and unread', async () => {
  const scenario = recorderScenarios.coalescedStream;
  const original = new Response(scenarioBody(scenario), { status: 200 });
  const { recorder } = setup();
  const returned = await recorder.record(scenario.request, async () => original);

  assert.equal(returned, original);
  assert.equal(returned.bodyUsed, false);
  assert.equal(returned.body!.locked, false, 'the recorder holds no lock on the client branch');
  assert.deepEqual(await readAll(returned.body), scenarioBytes(scenario));
});

test('a non-2xx answer to a run request is kept as body evidence, not read as events', async () => {
  const scenario = recorderScenarios.errorJsonBody;
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  const clientText = await response.text();
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.status, 422);
  assert.equal(exchange.responseBody, '{"error":"threadId and runId must be strings"}');
  assert.equal(clientText, exchange.responseBody, 'the client reads the same error');
  assert.deepEqual(memory.chunksOf(exchange.id), [], 'no frames are produced from an error body');
  assert.equal(exchange.transport, 'completed');
  assert.deepEqual(memory.findings, []);
});

test('an ordinary response is read whole, with split multibyte text decoded exactly', async () => {
  const scenario = recorderScenarios.errorTextBody;
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  await response.text();
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.kind, 'preparation');
  assert.equal(exchange.status, 503);
  assert.equal(exchange.responseBody, decoder.decode(scenarioBytes(scenario)));
  assert.equal(exchange.responseBody, 'service indisponible, réessayez plus tard 🙂');
  assert.deepEqual(memory.chunksOf(exchange.id), []);
});

test('a successful response without a body records no body', async () => {
  const { memory, recorder } = setup();
  await recorder.record(
    { kind: 'preparation', method: 'POST', path: '/sessions', responseKind: 'response' },
    async () => new Response(null, { status: 204 }),
  );
  const exchange = await memory.settled(memory.only().id);
  assert.equal(exchange.status, 204);
  assert.equal(exchange.transport, 'completed');
  assert.equal(exchange.responseBody, undefined);
});

test('a transport failure before any response is recorded, shown, and rethrown unchanged', async () => {
  const scenario = recorderScenarios.transportFailure;
  const { memory, recorder } = setup();
  const failure = await recorder.record(scenario.request, scenarioSend(scenario)).then(
    () => assert.fail('expected the send to fail'),
    (error: unknown) => error,
  );
  assert.ok(failure instanceof TypeError);
  assert.equal(failure.message, 'Failed to fetch');

  const exchange = memory.only();
  assert.equal(exchange.transport, 'transport-error');
  assert.equal(exchange.transportError, 'TypeError: Failed to fetch');
  assert.equal(exchange.status, undefined);
  assert.equal(exchange.requestBody, scenario.request.body, 'the request is still inspectable');
  assert.ok(exchange.elapsedMs! > 0);
  assert.deepEqual(memory.findings.map((finding) => [finding.kind, finding.rule, finding.subject]), [
    ['transport', 'transport.failed', { type: 'exchange', id: exchange.id }],
  ]);
});

test('a failure mid-stream keeps what arrived, reports the failure, and invents no frames', async () => {
  const scenario = recorderScenarios.midStreamFailure;
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  await assert.rejects(readAll(response.body), /network error/, 'the client branch fails too');
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.status, 200);
  assert.equal(exchange.transport, 'transport-error');
  assert.equal(exchange.transportError, 'TypeError: network error');
  assert.deepEqual(memory.bytesOf(exchange.id), scenarioBytes(scenario), 'the half event is kept as received bytes');
  assert.ok(!decoder.decode(memory.bytesOf(exchange.id)).includes('RUN_FINISHED'));
  assert.deepEqual(memory.findings.map((finding) => [finding.kind, finding.rule]), [['transport', 'transport.failed']]);
});

test('a slow client does not slow or lose the recording', async () => {
  const scenario = recorderScenarios.splitStream;
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));

  // The client has not read a single byte, yet the capture runs to the end.
  const exchange = await memory.settled(memory.only().id);
  assert.equal(exchange.transport, 'completed');
  assert.deepEqual(memory.bytesOf(exchange.id), scenarioBytes(scenario));

  // The client then reads, slowly, and still gets every byte.
  const reader = response.body!.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  assert.deepEqual(concat(parts), scenarioBytes(scenario));
});

test('a client that gives up early does not stop the recording', async () => {
  const scenario = recorderScenarios.splitStream;
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel(new Error('client rejected the stream'));
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.transport, 'completed');
  assert.deepEqual(memory.bytesOf(exchange.id), scenarioBytes(scenario));
});

test('recording continues past a client failure on malformed, schema-invalid and out-of-sequence events', async () => {
  const scenario = recorderScenarios.malformedThenValid;
  const memory = memorySink();
  const recorder = createRecorder(memory.sink, steppedClock());
  const agent = new HttpAgent({
    url: 'http://agent.invalid/agent',
    threadId: 't-rec',
    fetch: (_url, init) =>
      recorder.record({ ...scenario.request, body: String(init?.body) }, scenarioSend(scenario)),
  });

  const originalConsoleError = console.error;
  console.error = () => {}; // the client logs the failure with its stack
  try {
    await assert.rejects(agent.runAgent({ runId: 'r-rec' }));
  } finally {
    console.error = originalConsoleError;
  }
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.transport, 'completed');
  assert.deepEqual(memory.bytesOf(exchange.id), scenarioBytes(scenario), 'every byte after the failure is still there');
  const text = decoder.decode(memory.bytesOf(exchange.id));
  assert.ok(text.includes('{this is not json'));
  assert.ok(text.includes('m-never-started'));
  assert.ok(text.includes('RUN_FINISHED'), 'the valid ending after the failure is recorded');
});

test('a valid run through the real client is recorded byte for byte', async () => {
  const scenario = recorderScenarios.lfStream;
  const memory = memorySink();
  const recorder = createRecorder(memory.sink, steppedClock());
  const agent = new HttpAgent({
    url: 'http://agent.invalid/agent',
    threadId: 't-rec',
    fetch: (_url, init) => recorder.record({ ...scenario.request, body: String(init?.body) }, scenarioSend(scenario)),
  });
  await agent.runAgent({ runId: 'r-rec' });
  const exchange = await memory.settled(memory.only().id);
  assert.deepEqual(memory.bytesOf(exchange.id), scenarioBytes(scenario));
  assert.equal(JSON.parse(exchange.requestBody!).runId, 'r-rec', 'the run input the client built is the recorded body');
});

test('stopping a run keeps the partial evidence and does not manufacture a terminal or an error', async () => {
  const scenario = recorderScenarios.heldOpen;
  const stop = new AbortController();
  const { memory, recorder } = setup();
  const response = await recorder.record(scenario.request, scenarioSend(scenario, stop.signal));

  // Let the recorder read what has been delivered, then stop the run.
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();
  while (memory.chunksOf(memory.only().id).length < scenario.chunks.length) await new Promise((resolve) => setTimeout(resolve, 0));
  stop.abort();
  await assert.rejects(reader.read(), { name: 'AbortError' });
  const exchange = await memory.settled(memory.only().id);

  assert.equal(exchange.transport, 'user-stopped');
  assert.equal(exchange.transportError, undefined, 'a user stop is not a transport error');
  assert.equal(exchange.status, 200);
  assert.ok(exchange.elapsedMs! > 0);
  assert.deepEqual(memory.bytesOf(exchange.id), scenarioBytes(scenario), 'partial evidence stays exactly as received');
  assert.ok(!decoder.decode(memory.bytesOf(exchange.id)).includes('RUN_FINISHED'));
  assert.deepEqual(memory.findings, [], 'no finding, no outcome: the recorder only reports transport status');
});

test('aborting before a response arrives is a user stop and the abort reaches the caller', async () => {
  const scenario = recorderScenarios.heldOpen;
  const stop = new AbortController();
  stop.abort();
  const { memory, recorder } = setup();
  await assert.rejects(recorder.record(scenario.request, scenarioSend(scenario, stop.signal)), { name: 'AbortError' });

  const exchange = memory.only();
  assert.equal(exchange.transport, 'user-stopped');
  assert.equal(exchange.status, undefined);
  assert.equal(exchange.transportError, undefined);
  assert.deepEqual(memory.findings, []);
});

/** A native stream the test feeds by hand. Its source never looks at the abort signal: only the recorder decides what is read. */
function manualStream(status = 200) {
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start: (controller) => void (source = controller) }), { status });
  const encoder = new TextEncoder();
  return { response, push: (text: string) => source.enqueue(encoder.encode(text)), close: () => source.close() };
}
const pause = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

test('a stop signal ends capture even when the response body ignores it: partial evidence stays and later bytes are refused', async () => {
  const stream = manualStream();
  const stop = new AbortController();
  let ends = 0;
  const { memory, recorder } = setup();
  stream.push('data: {"type":"RUN_STARTED"}\n\n');
  const request = recorderScenarios.heldOpen.request;
  await recorder.record(request, async () => stream.response, { signal: stop.signal, onEnd: () => void (ends += 1) });
  await pause();
  const id = memory.only().id;
  assert.equal(memory.only().transport, 'streaming');
  assert.equal(ends, 0, 'capture is still active while the stream is open');

  stop.abort();
  stream.push('data: {"type":"RUN_FINISHED"}\n\n');
  const exchange = await memory.settled(id);
  await pause();

  assert.equal(exchange.transport, 'user-stopped');
  assert.equal(exchange.transportError, undefined);
  assert.equal(decoder.decode(memory.bytesOf(id)), 'data: {"type":"RUN_STARTED"}\n\n', 'only what arrived before the stop is kept');
  assert.deepEqual(memory.findings, []);
  assert.equal(ends, 1);
});

test('a signal that was already aborted when the response arrived keeps nothing and ends capture at once', async () => {
  const stream = manualStream();
  const stop = new AbortController();
  stop.abort();
  let ends = 0;
  const { memory, recorder } = setup();
  stream.push('data: {"type":"RUN_STARTED"}\n\n');
  await recorder.record(recorderScenarios.heldOpen.request, async () => stream.response, { signal: stop.signal, onEnd: () => void (ends += 1) });
  const exchange = await memory.settled(memory.only().id);
  assert.equal(exchange.transport, 'user-stopped');
  assert.equal(memory.chunksOf(exchange.id).length, 0);
  assert.equal(ends, 1);
});

test('a stop keeps the part of a plain response that was read, and stops reading it', async () => {
  const stream = manualStream(500);
  const stop = new AbortController();
  const { memory, recorder } = setup();
  stream.push('{"error":"par');
  await recorder.record({ kind: 'preparation', method: 'POST', path: '/prepare', responseKind: 'response' }, async () => stream.response, { signal: stop.signal });
  await pause();
  stop.abort();
  stream.push('tial"}');
  const exchange = await memory.settled(memory.only().id);
  assert.equal(exchange.transport, 'user-stopped');
  assert.equal(exchange.responseBody, '{"error":"par');
});

test('onEnd is called once, after the last update, for a finished stream, a failed request, a body-less answer and a clone that fails', async () => {
  const { memory, recorder } = setup();
  const seen: string[] = [];
  const onEnd = (label: string) => () => void seen.push(`${label}:${memory.all().at(-1)?.transport}`);

  const finished = manualStream();
  finished.push('data: {}\n\n');
  finished.close();
  await recorder.record(recorderScenarios.heldOpen.request, async () => finished.response, { onEnd: onEnd('finished') });
  await pause();

  await assert.rejects(recorder.record(recorderScenarios.heldOpen.request, async () => Promise.reject(new TypeError('offline')), { onEnd: onEnd('failed') }), TypeError);
  await recorder.record(recorderScenarios.heldOpen.request, async () => new Response(null, { status: 204 }), { onEnd: onEnd('bodyless') });
  await pause();

  const unclonable = manualStream();
  unclonable.response.clone = () => {
    throw new TypeError('body already used');
  };
  await recorder.record(recorderScenarios.heldOpen.request, async () => unclonable.response, { onEnd: onEnd('unclonable') });
  await pause();

  assert.deepEqual(seen, ['finished:completed', 'failed:transport-error', 'bodyless:completed', 'unclonable:streaming']);
});

test('a listener that throws does not reach the recording or the client', async () => {
  const stream = manualStream();
  stream.close();
  const { memory, recorder } = setup();
  const response = await recorder.record(recorderScenarios.heldOpen.request, async () => stream.response, {
    onEnd() {
      throw new Error('bookkeeping failed');
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await memory.settled(memory.only().id)).transport, 'completed');
  assert.deepEqual(memory.findings, []);
});

class TrappedResponse extends Response {
  readonly touched: string[] = [];
  override get headers(): Headers {
    this.touched.push('headers');
    throw new Error('the recorder must not read response headers');
  }
}

test('no header is read, copied or stored, on the request or the response', async () => {
  const scenario = recorderScenarios.splitStream;
  const touched: string[] = [];
  const request = {
    ...scenario.request,
    get headers(): never {
      touched.push('request.headers');
      throw new Error('the recorder must not read request headers');
    },
    get init(): never {
      touched.push('request.init');
      throw new Error('the recorder must not read a request init');
    },
    authorization: 'Bearer synthetic-secret-token',
  };
  const original = new TrappedResponse(scenarioBody(scenario), {
    status: 200,
    headers: { 'set-cookie-sentinel': 'synthetic-cookie', 'x-echo': 'Bearer synthetic-secret-token' },
  });
  const { memory, recorder } = setup();
  const response = await recorder.record(request, async () => original);
  await readAll(response.body);
  const exchange = await memory.settled(memory.only().id);

  assert.deepEqual(touched, [], 'request headers and init are never accessed');
  assert.deepEqual(original.touched, [], 'response headers are never accessed');
  const everything = JSON.stringify([exchange, memory.findings]) + decoder.decode(memory.bytesOf(exchange.id));
  assert.doesNotMatch(everything, /synthetic-secret-token|synthetic-cookie|headers|authorization/i);
  assert.deepEqual(Object.keys(exchange).sort(), [
    'elapsedMs', 'frameIds', 'id', 'kind', 'method', 'path', 'requestBody', 'requestBodyJson', 'startedAt', 'status', 'transport',
  ]);
});

test('the announced content type never decides how the body is read', async () => {
  // The server lies in both directions; only the caller's request kind counts.
  const lyingStream: RecorderScenario = { ...recorderScenarios.coalescedStream, announcedContentType: 'application/json' };
  const sse = setup();
  await sse.recorder.record(lyingStream.request, scenarioSend(lyingStream));
  const streamed = await sse.memory.settled(sse.memory.only().id);
  assert.equal(sse.memory.chunksOf(streamed.id).length, 1);
  assert.equal(streamed.responseBody, undefined);

  const lyingBody: RecorderScenario = { ...recorderScenarios.errorTextBody, announcedContentType: 'text/event-stream' };
  const plain = setup();
  await plain.recorder.record(lyingBody.request, scenarioSend(lyingBody));
  const read = await plain.memory.settled(plain.memory.only().id);
  assert.deepEqual(plain.memory.chunksOf(read.id), []);
  assert.equal(read.responseBody, 'service indisponible, réessayez plus tard 🙂');
});

test('each request gets its own exchange, and a run link is kept only when given', async () => {
  const { memory, recorder } = setup();
  const prepare = recorderScenarios.errorTextBody;
  const run = recorderScenarios.coalescedStream;
  await recorder.record(prepare.request, scenarioSend(prepare));
  await recorder.record({ ...run.request, runId: 'run-record-1' }, scenarioSend(run));
  const [first, second] = memory.all();
  await memory.settled(second!.id);

  assert.notEqual(first!.id, second!.id);
  assert.deepEqual([first!.kind, second!.kind], ['preparation', 'conversation'], 'exchanges are stored in dispatch order');
  assert.equal('runId' in first!, false);
  assert.equal(second!.runId, 'run-record-1');
  assert.deepEqual(memory.chunksOf(first!.id), [], 'chunks never cross between exchanges');
  assert.equal(memory.chunksOf(second!.id).length, 1);
});

test('a sink that throws is reported as a capture failure and never reaches the client', async () => {
  const scenario = recorderScenarios.splitStream;
  const memory = memorySink({ failOnChunk: true });
  const recorder = createRecorder(memory.sink, steppedClock());
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  const clientBytes = await readAll(response.body);
  const exchange = await memory.settled(memory.only().id);

  assert.deepEqual(clientBytes, scenarioBytes(scenario), 'the client branch is unaffected');
  assert.equal(exchange.transport, 'completed', 'the wire itself finished');
  assert.deepEqual(memory.findings.map((finding) => [finding.kind, finding.rule, finding.subject]), [
    ['capture', 'capture.failed', { type: 'exchange', id: exchange.id }],
  ]);
  assert.match(memory.findings[0]!.message, /reader exploded/);
});
