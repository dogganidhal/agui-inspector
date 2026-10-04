// Spec 013 (US3, FR-016 to FR-018; SC-002): session files with binary frames. A round trip keeps every frame's bytes,
// order, offsets and findings, an SSE-only session exports with none of the new fields, and import rejects a file in
// which the bytes and the decoded event disagree, naming the first problem. Nothing is built from a bad file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode } from '@ag-ui/proto';
import { baselineFrames, concat, futureEventFrame, garbageFrame } from '../../../../examples/reference-agent/protobuf-fixtures.ts';
import { frameInvalid, frameProtobuf } from '../../../../examples/reference-agent/protobuf.ts';
import { eventFixtures } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import type { InspectionSession } from '../../src/contracts.ts';
import { fromBase64, toBase64 } from '../../src/core/frames/bytes.ts';
import { createProtobufFrameReader } from '../../src/core/frames/index.ts';
import { parseSession, restoreSession, serializeSession } from '../../src/core/session-files/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { richSession } from './support.ts';

const runInput = { threadId: 't-proto', runId: 'r-proto', state: {}, messages: [], tools: [], context: [], forwardedProps: {} };

/** Two protobuf exchanges through the real reader and store: the baseline run, and one with every kind of damage. */
function protobufSession(): InspectionSession {
  const store = createSessionStore({ schedule: (callback) => callback() });
  const play = (id: string, chunks: readonly Uint8Array[], runId?: string) => {
    store.appendExchange({
      id,
      kind: 'conversation',
      method: 'POST',
      path: '/agent',
      status: 200,
      startedAt: 1_700_000_000_000,
      transport: 'streaming',
      encoding: 'protobuf',
      requestBody: JSON.stringify(runInput),
      requestBodyJson: runInput,
      ...(runId !== undefined && { runId }),
      frameIds: [],
    });
    const reader = createProtobufFrameReader(store, id);
    chunks.forEach((chunk, at) => reader.push(chunk, (at + 1) * 10));
    reader.end(runId !== undefined ? { type: 'run', id: runId } : { type: 'exchange', id });
    store.updateExchange(id, { transport: 'completed', elapsedMs: 500 });
  };
  store.appendExchange({ id: 'exchange-0', kind: 'preparation', method: 'PUT', path: '/prepare/warm', status: 200, startedAt: 1_699_999_999_000, transport: 'completed', frameIds: [] });
  play('exchange-1', baselineFrames, 'run-1');
  store.upsertRun({ id: 'run-1', threadId: 't-proto', runId: 'r-proto', input: runInput, exchangeId: 'exchange-1', startedAt: 1_700_000_000_000, outcome: { kind: 'success', pendingToolCallIds: [] } });
  play('exchange-2', [frameProtobuf(eventFixtures.RUN_STARTED), garbageFrame, futureEventFrame, frameProtobuf(eventFixtures.RUN_ERROR), frameProtobuf(eventFixtures.STEP_STARTED).slice(0, 7)]);
  return store.snapshot();
}

type File = { version: number; session: { exchanges: Array<Record<string, any>>; frames: Array<Record<string, any>>; findings: Array<Record<string, any>> } };
const fileOf = (): File => JSON.parse(serializeSession(protobufSession())) as File;
const frameOf = (file: File, predicate: (frame: Record<string, any>) => boolean) => file.session.frames.find(predicate)!;
const rejects = (file: unknown, pattern: RegExp) => {
  const result = parseSession(JSON.stringify(file));
  assert.equal(result.ok, false, 'the file must be rejected');
  if (!result.ok) assert.match(result.error, pattern);
};

test('the sample session has decoded, undecodable, unknown and partial binary frames, with findings of the new kind', () => {
  const session = protobufSession();
  const kinds = session.frames.map((frame) => [frame.classification, frame.schemaVerdict, frame.eventType ?? '-']);
  assert.ok(kinds.some(([classification, verdict]) => classification === 'data' && verdict === 'valid'));
  assert.ok(kinds.some(([classification, verdict, type]) => classification === 'data' && verdict === 'not-applicable' && type === '-'), 'undecodable');
  assert.ok(kinds.some(([, verdict]) => verdict === 'unknown-type'), 'unknown');
  assert.ok(kinds.some(([classification]) => classification === 'partial'), 'partial');
  assert.ok(session.findings.some((finding) => finding.kind === 'binary'));
  assert.ok(session.frames.every((frame) => frame.bytes !== undefined));
});

test('a round trip keeps every frame\'s bytes, decoded event, order, offset and finding, and a second export is byte-identical (SC-002)', () => {
  const session = protobufSession();
  const text = serializeSession(session);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.deepEqual(result.session, session);
  assert.equal(serializeSession(result.session), text);
  const store = restoreSession(result.session);
  assert.deepEqual(store.snapshot(), session);

  const original = concat(baselineFrames);
  const baseline = store.snapshot().frames.filter((frame) => frame.exchangeId === 'exchange-1');
  assert.deepEqual(concat(baseline.map((frame) => fromBase64(frame.bytes!)!)), original, 'byte for byte');
  assert.deepEqual(store.snapshot().frames.map((frame) => frame.offsetMs), session.frames.map((frame) => frame.offsetMs));
  assert.deepEqual(store.snapshot().findings, session.findings);
});

test('export writes encoding and bytes only where they apply, and the file holds no header', () => {
  const file = fileOf();
  assert.deepEqual(file.session.exchanges.map((exchange) => exchange.encoding), [undefined, 'protobuf', 'protobuf']);
  assert.equal('encoding' in file.session.exchanges[0]!, false, 'a preparation has no encoding');
  assert.ok(file.session.frames.every((frame) => typeof frame.bytes === 'string' && frame.envelope === '' && !('data' in frame) && frame.jsonVerdict === 'not-applicable'));
  const text = JSON.stringify(file);
  assert.doesNotMatch(text, /requestHeaders|"headers"|authorization|cookie|token/i);
});

test('a session with no protobuf exchange exports with none of the new fields, and a 0.1.0 file imports', async () => {
  const text = serializeSession(await richSession());
  assert.doesNotMatch(text, /"bytes"|"encoding"/);
  assert.equal(parseSession(text).ok, true);
});

test('a frame whose bytes are one whole frame of the stated event imports; the kinds of finding include binary', () => {
  const file = fileOf();
  assert.ok(file.session.findings.some((finding) => finding.kind === 'binary'));
  assert.equal(parseSession(JSON.stringify(file)).ok, true);
});

// ---- import checks ---------------------------------------------------------------------------------

test('import rejects bytes that are not canonical base64, naming the frame', () => {
  for (const bad of ['AAAAEw=', 'AAAA Ew==', 'not base64!', 'AAAAEx==']) {
    const file = fileOf();
    frameOf(file, (frame) => frame.eventType === 'RUN_STARTED').bytes = bad;
    rejects(file, /frames\[\d+\]: bytes is not canonical base64/);
  }
});

test('import rejects bytes on a frame of an exchange that was not read as protobuf, and a frame with no bytes in one that was', () => {
  const noEncoding = fileOf();
  delete noEncoding.session.exchanges[1]!.encoding;
  rejects(noEncoding, /frames\[0\]: bytes belong only to an exchange read as protobuf, and exchange "exchange-1" is not/);

  const textFrame = fileOf();
  const frame = frameOf(textFrame, (candidate) => candidate.eventType === 'RUN_STARTED');
  delete frame.bytes;
  frame.envelope = 'data: {}\n\n';
  frame.data = '{}';
  frame.jsonVerdict = 'valid';
  frame.parsed = {};
  frame.schemaVerdict = 'invalid';
  rejects(textFrame, /frames\[0\]: every frame of the protobuf exchange "exchange-1" must hold bytes/);
});

test('import rejects bytes on control evidence, text in a binary frame and a JSON verdict on one', () => {
  const control = fileOf();
  const partial = frameOf(control, (frame) => frame.classification === 'partial');
  partial.classification = 'control';
  rejects(control, /frames\[\d+\]: bytes must be absent on control evidence/);

  for (const [field, value, pattern] of [
    ['envelope', 'data: x', /envelope must be ""/],
    ['data', '{}', /data must be absent/],
    ['jsonVerdict', 'valid', /jsonVerdict must be "not-applicable"/],
  ] as const) {
    const file = fileOf();
    frameOf(file, (frame) => frame.eventType === 'RUN_STARTED')[field] = value;
    rejects(file, new RegExp(`frames\\[\\d+\\]: ${pattern.source}`));
  }
});

test('import rejects a data frame whose bytes are not one whole frame', () => {
  const short = fileOf();
  frameOf(short, (frame) => frame.eventType === 'RUN_STARTED').bytes = toBase64(Uint8Array.from([0, 0, 0]));
  rejects(short, /frames\[\d+\]: bytes is not one whole frame/);

  const wrongPrefix = fileOf();
  const whole = fromBase64(frameOf(wrongPrefix, (frame) => frame.eventType === 'RUN_STARTED').bytes)!;
  whole[3] = (whole[3]! + 1) & 0xff;
  frameOf(wrongPrefix, (frame) => frame.eventType === 'RUN_STARTED').bytes = toBase64(whole);
  rejects(wrongPrefix, /frames\[\d+\]: bytes is not one whole frame/);
});

test('import rejects a decoded event that is not the one the bytes decode to, and a type that is not its own', () => {
  const edited = fileOf();
  frameOf(edited, (frame) => frame.eventType === 'TEXT_MESSAGE_CONTENT').parsed.delta = 'something else';
  rejects(edited, /frames\[\d+\]: parsed does not match the event the bytes decode to/);

  const missing = fileOf();
  delete frameOf(missing, (frame) => frame.eventType === 'RUN_STARTED').parsed;
  rejects(missing, /frames\[\d+\]: parsed does not match the event the bytes decode to/);

  const type = fileOf();
  frameOf(type, (frame) => frame.eventType === 'RUN_STARTED').eventType = 'RUN_FINISHED';
  rejects(type, /frames\[\d+\]: eventType does not match the decoded event/);
});

test('import checks the verdict of bytes that do not decode: unknown-type for a later protocol, not-applicable for garbage, and no event', () => {
  const unknown = fileOf();
  const future = frameOf(unknown, (frame) => frame.schemaVerdict === 'unknown-type');
  future.schemaVerdict = 'not-applicable';
  rejects(unknown, /frames\[\d+\]: schemaVerdict must be "unknown-type"/);

  const garbage = fileOf();
  const undecodable = frameOf(garbage, (frame) => frame.classification === 'data' && frame.schemaVerdict === 'not-applicable' && frame.eventType === undefined);
  undecodable.schemaVerdict = 'unknown-type';
  rejects(garbage, /frames\[\d+\]: schemaVerdict must be "not-applicable"/);

  const invented = fileOf();
  const nothing = frameOf(invented, (frame) => frame.classification === 'data' && frame.schemaVerdict === 'not-applicable' && frame.eventType === undefined);
  nothing.parsed = { type: 'RUN_STARTED' };
  nothing.eventType = 'RUN_STARTED';
  rejects(invented, /frames\[\d+\]: parsed is present but the bytes do not decode/);
});

test('import rejects a valid verdict that the schema contradicts, and a partial frame that holds an event', () => {
  const lie = fileOf();
  const bytes = frameInvalid({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'robot' });
  const decoded = JSON.parse(JSON.stringify(decode(bytes.subarray(4)))) as { type: string };
  const frame = frameOf(lie, (candidate) => candidate.eventType === 'RUN_STARTED');
  frame.bytes = toBase64(bytes);
  frame.parsed = decoded;
  frame.eventType = decoded.type;
  frame.schemaVerdict = 'valid';
  rejects(lie, /frames\[\d+\]: schemaVerdict "valid" contradicts the data/);

  const partial = fileOf();
  frameOf(partial, (candidate) => candidate.classification === 'partial').parsed = { type: 'RUN_STARTED' };
  rejects(partial, /frames\[\d+\]: parsed must be absent unless classification is "data"/);
});

test('import accepts an exchange encoding of sse or protobuf only, and checks it', () => {
  const sse = fileOf();
  sse.session.exchanges[0]!.encoding = 'sse';
  assert.equal(parseSession(JSON.stringify(sse)).ok, true, 'a file may name server-sent events');
  const bad = fileOf();
  bad.session.exchanges[1]!.encoding = 'binary';
  rejects(bad, /exchanges\[1\]: encoding must be one of sse, protobuf/);
});

test('a failed import builds nothing and starts no request', () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (() => {
    requests += 1;
    return Promise.reject(new Error('no requests'));
  }) as typeof fetch;
  try {
    const file = fileOf();
    frameOf(file, (frame) => frame.eventType === 'RUN_STARTED').bytes = 'AAAAEx==';
    const result = parseSession(JSON.stringify(file));
    assert.equal(result.ok, false);
    assert.equal(parseSession(serializeSession(protobufSession())).ok, true);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
