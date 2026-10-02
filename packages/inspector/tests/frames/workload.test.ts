// F05 T018: the frozen 5,000-frame fixture survives recorder, reader and store unchanged.
// The expected values come from tests/benchmarks/manifest.json, frozen in F03; the generator only
// supplies the wire bytes to play. Every check is on the original text, order and offsets.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { missingTerminalScenarios, protocolScenarios } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { fragment, recorderScenarios, scenarioSend, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import { generateFixture } from '../../../../tests/benchmarks/generate.ts';
import type { RawFrame, SessionStore } from '../../src/contracts.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

type Manifest = {
  frameCount: number;
  schemaValidFrames: number;
  invalidFrames: number;
  sha256: string;
  typeCounts: Record<string, number>;
  exchanges: Array<{ sha256: string; dataSha256: string; frameCount: number; frames: string[] }>;
};

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'benchmarks', 'manifest.json'), 'utf8')) as Manifest;
const encoder = new TextEncoder();
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
/** The plan's byte chunking: 1, 7, 64 and 4096 bytes, repeating across the wire. */
const CHUNK_SIZES = [1, 7, 64, 4096];

const ended = (store: SessionStore, id: string) => store.snapshot().exchanges.find((candidate) => candidate.id === id)?.transport;
async function untilEnded(store: SessionStore, id: string) {
  while (!['completed', 'transport-error', 'user-stopped'].includes(ended(store, id) ?? '')) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** One recorder, one store; the recorder's clock ticks once per call, so chunk k of an exchange is at offset k. */
function pipeline() {
  const store = createSessionStore();
  let tick = 0;
  const chunks = { read: 0 };
  const sink = createFrameSink(store);
  const counted = {
    ...sink,
    appendChunk(id: string, bytes: Uint8Array, offsetMs: number) {
      chunks.read += 1;
      sink.appendChunk(id, bytes, offsetMs);
    },
  };
  const recorder = createRecorder(counted, { now: () => (tick += 1), epoch: () => 1_700_000_000_000 });
  return { store, recorder, chunks };
}

const fixtureWire = () => generateFixture().map((exchange) => exchange.frames.map((frame) => frame.envelope).join(''));

async function playFixture() {
  const { store, recorder } = pipeline();
  const chunked: Uint8Array[][] = [];
  for (const [index, text] of fixtureWire().entries()) {
    const scenario: RecorderScenario = {
      name: `fixture-${index}`,
      request: { kind: 'conversation', method: 'POST', path: '/agent', responseKind: 'sse' },
      status: 200,
      announcedContentType: 'text/event-stream',
      chunks: fragment(encoder.encode(text), CHUNK_SIZES),
      ending: 'close',
    };
    chunked.push([...scenario.chunks]);
    // The client branch reads everything, as a real client would.
    await (await recorder.record(scenario.request, scenarioSend(scenario))).arrayBuffer();
    await untilEnded(store, `exchange-${index + 1}`);
  }
  return { store, chunked };
}

const kindOf = (frame: RawFrame) =>
  frame.jsonVerdict === 'invalid' ? 'NON_JSON' : frame.schemaVerdict === 'unknown-type' ? 'UNKNOWN_TYPE' : frame.schemaVerdict === 'invalid' ? 'SCHEMA_INVALID' : frame.eventType!;

test('the wire played below is the frozen fixture: it hashes to the manifest', () => {
  const wire = fixtureWire();
  assert.equal(sha256(wire.join('')), manifest.sha256);
  wire.forEach((text, i) => assert.equal(sha256(text), manifest.exchanges[i]!.sha256, `exchange ${i}`));
});

const played = playFixture();

test('exactly 5,000 original frames come out of recorder, reader and store, matching the manifest hashes', async () => {
  const { store } = await played;
  const snapshot = store.snapshot();

  assert.equal(snapshot.exchanges.length, 10);
  assert.equal(snapshot.frames.length, manifest.frameCount);
  assert.equal(snapshot.frames.filter((frame) => frame.classification === 'data').length, 5000);
  assert.equal(snapshot.frames.map((frame) => frame.envelope).join(''), fixtureWire().join(''));
  assert.equal(sha256(snapshot.frames.map((frame) => frame.envelope).join('')), manifest.sha256);

  snapshot.exchanges.forEach((exchange, x) => {
    const row = manifest.exchanges[x]!;
    const frames = snapshot.frames.filter((frame) => frame.exchangeId === exchange.id);
    assert.equal(frames.length, row.frameCount);
    assert.deepEqual(frames.map((frame) => frame.index), frames.map((_, i) => i), 'zero-based arrival order');
    assert.deepEqual(exchange.frameIds, frames.map((frame) => frame.id));
    assert.equal(sha256(frames.map((frame) => frame.envelope).join('')), row.sha256, `${exchange.id} envelopes`);
    assert.equal(sha256(frames.map((frame) => `${frame.data}\n`).join('')), row.dataSha256, `${exchange.id} data text`);
    frames.forEach((frame, i) => {
      const [type, dataBytes, envelopeBytes] = row.frames[i]!.split(' ') as [string, string, string];
      assert.equal(kindOf(frame), type, `${frame.id} type`);
      assert.equal(encoder.encode(frame.data!).length, Number(dataBytes), `${frame.id} data bytes`);
      assert.equal(encoder.encode(frame.envelope).length, Number(envelopeBytes), `${frame.id} envelope bytes`);
    });
    assert.equal(exchange.transport, 'completed');
    assert.equal(exchange.status, 200);
  });

  const counts: Record<string, number> = {};
  for (const frame of snapshot.frames) counts[kindOf(frame)] = (counts[kindOf(frame)] ?? 0) + 1;
  assert.deepEqual(counts, manifest.typeCounts, 'all 31 baseline types and the three invalid classes, in the planned numbers');
});

test('the 100 invalid frames are kept and flagged once each; nothing else is reported or invented', async () => {
  const { store } = await played;
  const snapshot = store.snapshot();
  const flagged = new Set(snapshot.findings.map((finding) => (finding.subject as { id: string }).id));

  assert.equal(snapshot.frames.filter((frame) => frame.schemaVerdict === 'valid').length, manifest.schemaValidFrames);
  assert.equal(snapshot.findings.length, manifest.invalidFrames, 'no terminal, transport, capture or sequence findings: every exchange ended in a valid terminal');
  assert.equal(flagged.size, manifest.invalidFrames, 'one finding per invalid frame');
  assert.ok(snapshot.findings.every((finding) => finding.subject.type === 'frame'));
  assert.equal(snapshot.findings.filter((finding) => finding.kind === 'json').length, 40);
  assert.equal(snapshot.findings.filter((finding) => finding.kind === 'schema').length, 60);
  for (const frame of snapshot.frames.filter((candidate) => candidate.schemaVerdict !== 'valid')) assert.ok(flagged.has(frame.id), `${frame.id} is flagged`);
  assert.deepEqual(snapshot.runs, [], 'the frame layer invents no run and no outcome');
  assert.deepEqual(snapshot.derived, []);
});

test('the captured entities carry no header fields at all', async () => {
  const { store } = await played;
  const { exchanges, frames, findings } = store.snapshot();
  const keys = new Set([...exchanges, ...frames, ...findings].flatMap((entity) => Object.keys(entity)));
  assert.deepEqual([...keys].filter((key) => /header|cookie|authori[sz]ation|token|credential/i.test(key)), []);
  assert.ok(!JSON.stringify([exchanges, findings]).match(/content-type|set-cookie/i), 'the announced content type never reaches the store');
});

test('offsets never go backwards, and each frame carries the offset of the chunk its last byte arrived in', async () => {
  const { store, chunked } = await played;
  const snapshot = store.snapshot();
  snapshot.exchanges.forEach((exchange, x) => {
    const ends: number[] = [];
    let at = 0;
    for (const chunk of chunked[x]!) ends.push((at += chunk.length));

    let previous = 0;
    let wireEnd = 0;
    for (const frame of snapshot.frames.filter((candidate) => candidate.exchangeId === exchange.id)) {
      wireEnd += encoder.encode(frame.envelope).length;
      const chunkNumber = ends.findIndex((end) => end >= wireEnd) + 1;
      assert.equal(frame.offsetMs, chunkNumber, `${frame.id}: its last byte is byte ${wireEnd}, in chunk ${chunkNumber}`);
      assert.ok(frame.offsetMs >= previous);
      previous = frame.offsetMs;
    }
    assert.equal(wireEnd, ends.at(-1), 'every received byte belongs to a frame');
  });
});

// ---- the other protocol scenarios through the whole pipeline -------------------------------------------------

async function record(scenario: RecorderScenario) {
  const { store, recorder, chunks } = pipeline();
  const stop = new AbortController();
  const response = await recorder.record(scenario.request, scenarioSend(scenario, stop.signal));
  if (scenario.ending === 'hold-until-abort') {
    const reader = response.body!.getReader();
    for (let i = 0; i < scenario.chunks.length; i++) await reader.read();
    while (chunks.read < scenario.chunks.length) await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort();
    await reader.read().catch(() => {});
  } else {
    await response.arrayBuffer().catch(() => {});
  }
  await untilEnded(store, 'exchange-1');
  return store.snapshot();
}

test('a stream that ends without a terminal event gets a finding on the exchange and no outcome, however it ended', async () => {
  for (const scenario of [...Object.values(missingTerminalScenarios), recorderScenarios.midStreamFailure, recorderScenarios.heldOpen]) {
    const snapshot = await record(scenario);
    const terminal = snapshot.findings.filter((finding) => finding.kind === 'terminal');
    assert.equal(terminal.length, 1, scenario.name);
    assert.deepEqual(terminal[0]!.subject, { type: 'exchange', id: 'exchange-1' });
    assert.deepEqual(snapshot.runs, [], `${scenario.name}: no invented outcome`);
    assert.ok(!snapshot.frames.some((frame) => frame.eventType === 'RUN_ERROR'), `${scenario.name}: no invented error event`);
    assert.ok(!snapshot.frames.some((frame) => frame.eventType === 'RUN_FINISHED' && frame.schemaVerdict === 'valid'));
  }
});

test('how the transport ended is recorded beside the missing terminal, not instead of it', async () => {
  const dropped = await record(recorderScenarios.midStreamFailure);
  assert.equal(dropped.exchanges[0]!.transport, 'transport-error');
  assert.deepEqual(dropped.findings.map((finding) => finding.kind).sort(), ['terminal', 'transport']);
  assert.equal(dropped.frames.at(-1)!.classification, 'partial', 'the half event received before the drop is kept');
  assert.equal(dropped.frames.at(-1)!.envelope, 'data: {"type":"TEXT_MESS');

  const stopped = await record(recorderScenarios.heldOpen);
  assert.equal(stopped.exchanges[0]!.transport, 'user-stopped');
  assert.deepEqual(stopped.findings.map((finding) => finding.kind), ['terminal'], 'a user stop is not a transport error');
});

test('a valid stream with comments and malformed frames records the valid terminal and no terminal finding', async () => {
  for (const scenario of [protocolScenarios.baselineRun, protocolScenarios.invalidFrames, protocolScenarios.controlEvidence, protocolScenarios.runError]) {
    const snapshot = await record(scenario);
    assert.equal(snapshot.findings.filter((finding) => finding.kind === 'terminal').length, 0, scenario.name);
    assert.equal(snapshot.frames.map((frame) => frame.envelope).join(''), new TextDecoder().decode(Buffer.concat(scenario.chunks)), scenario.name);
  }
});

test('a non-event-stream answer and a request that never got a response produce no frames and no terminal finding', async () => {
  const error = await record(recorderScenarios.errorJsonBody);
  assert.equal(error.frames.length, 0);
  assert.deepEqual(error.findings, []);
  assert.equal(error.exchanges[0]!.responseBody, '{"error":"threadId and runId must be strings"}');

  const { store, recorder } = pipeline();
  await assert.rejects(recorder.record(recorderScenarios.transportFailure.request, scenarioSend(recorderScenarios.transportFailure)));
  assert.equal(store.snapshot().frames.length, 0);
  assert.deepEqual(store.snapshot().findings.map((finding) => finding.kind), ['transport']);
});

test('a capture failure inside the store is reported once and the client still gets its response', async () => {
  const store = createSessionStore();
  const failing: SessionStore = { ...store, appendFrame: () => { throw new Error('store exploded'); } };
  let tick = 0;
  const recorder = createRecorder(createFrameSink(failing), { now: () => (tick += 1), epoch: () => 0 });
  const scenario = protocolScenarios.baselineRun;
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes.length, Buffer.concat(scenario.chunks).length, 'the client branch is untouched');
  await untilEnded(store, 'exchange-1');
  assert.deepEqual(store.snapshot().findings.map((finding) => finding.kind), ['capture']);
});
