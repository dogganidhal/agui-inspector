// Spec 013 (US1, US4; FR-006 to FR-009; SC-003, SC-004): the protobuf frame reader. Every check compares the bytes
// as received, the order and the offsets, not only the decoded events: the reader may add findings, never change
// what crossed the wire.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventType } from '@ag-ui/core';
import { eventFixtures, protocolScenarios } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { baselineFrames, concat, futureEventFrame, garbageFrame, protobufScenarios, zeroLengthFrame, oversizedPrefix } from '../../../../examples/reference-agent/protobuf-fixtures.ts';
import { frameProtobuf } from '../../../../examples/reference-agent/protobuf.ts';
import { fragment, scenarioBytes, scenarioSend, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { Finding, FindingSubject, RawFrame } from '../../src/contracts.ts';
import { toBase64 } from '../../src/core/frames/bytes.ts';
import { createFrameReader, createFrameSink, createProtobufFrameReader } from '../../src/core/frames/index.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const encoder = new TextEncoder();
const EXCHANGE = 'exchange-1';

/** Pushes chunks with offsets 10, 20, 30 ... unless given, then ends the stream unless told not to. */
function read(chunks: readonly Uint8Array[], options: { offsets?: readonly number[]; end?: FindingSubject | false } = {}) {
  const frames: RawFrame[] = [];
  const findings: Finding[] = [];
  const reader = createProtobufFrameReader({ appendFrame: (frame) => void frames.push(frame), addFinding: (finding) => void findings.push(finding) }, EXCHANGE);
  chunks.forEach((chunk, at) => reader.push(chunk, options.offsets?.[at] ?? (at + 1) * 10));
  if (options.end !== false) reader.end(options.end);
  return { frames, findings, reader };
}

/** What the server-sent-events reader makes of the same event, to compare the two. */
function readAsText(event: object) {
  const frames: RawFrame[] = [];
  const reader = createFrameReader({ appendFrame: (frame) => void frames.push(frame), addFinding: () => undefined }, EXCHANGE);
  reader.push(encoder.encode(`data: ${JSON.stringify(event)}\n\n`), 10);
  reader.end();
  return frames[0]!;
}

const wire = (scenario: RecorderScenario) => scenarioBytes(scenario);
/** The stream cut in two at one byte position. */
const cut = (bytes: Uint8Array, at: number) => [bytes.slice(0, at), bytes.slice(at)];

// ---- one dedicated case per baseline event type -------------------------------------------------

for (const type of Object.values(EventType)) {
  test(`event type ${type} over protobuf: kept as received, decoded like the same event over server-sent events`, () => {
    const bytes = frameProtobuf(eventFixtures[type]);
    const { frames, findings } = read([bytes]);

    assert.equal(frames.length, 1);
    const frame = frames[0]!;
    assert.equal(frame.id, `${EXCHANGE}:frame-0`);
    assert.equal(frame.classification, 'data');
    assert.equal(frame.bytes, toBase64(bytes), 'the bytes as received, length prefix included');
    assert.equal(frame.envelope, '');
    assert.equal(frame.data, undefined);
    assert.equal(frame.jsonVerdict, 'not-applicable');
    assert.equal(frame.provenance, 'raw');

    const text = readAsText(eventFixtures[type]);
    assert.equal(frame.eventType, text.eventType);
    assert.equal(frame.eventType, type);
    assert.equal(frame.schemaVerdict, 'valid');
    assert.deepEqual(frame.parsed, text.parsed);
    assert.deepEqual(frame.parsed, eventFixtures[type]);
    assert.equal(frame.summary, text.summary);
    assert.deepEqual(findings.filter((finding) => finding.kind !== 'terminal'), []);
    const terminal = type === 'RUN_FINISHED' || type === 'RUN_ERROR';
    assert.equal(findings.some((finding) => finding.kind === 'terminal'), !terminal);
  });
}

// ---- reads cut anywhere ----------------------------------------------------------------------------

test('the baseline run gives the same frames however the network cuts it, at every byte position (SC-004)', () => {
  const bytes = wire(protobufScenarios.baselineRun);
  const whole = read([bytes]).frames;
  assert.equal(whole.length, 30);
  assert.deepEqual(concat(whole.map((frame) => Uint8Array.from(atob(frame.bytes!), (char) => char.charCodeAt(0)))), bytes, 'the frames hold every byte, in order');

  const same = (frames: readonly RawFrame[], label: string) => {
    const shape = (frame: RawFrame) => [frame.id, frame.index, frame.classification, frame.bytes, frame.eventType, frame.summary, JSON.stringify(frame.parsed)];
    assert.deepEqual(frames.map(shape), whole.map(shape), label);
  };
  for (let at = 0; at <= bytes.length; at += 1) same(read(cut(bytes, at)).frames, `cut at ${at}`);
  same(read(fragment(bytes, [1])).frames, 'one byte at a time');
  same(read(fragment(bytes, [1, 7, 64, 4096])).frames, 'uneven pieces');
  same(read(fragment(bytes, [3])).frames, 'threes');
  same(read(protobufScenarios.splitByByte.chunks).frames, 'the split-by-byte scenario');
  same(read(protobufScenarios.baselineRun.chunks).frames, 'the baseline scenario');
  same(read(protobufScenarios.evenFrames.chunks).frames, 'one read for each frame');
});

test('a frame is appended in the read that brings its last byte, and carries that read\'s offset', () => {
  const [a, b, c] = [frameProtobuf(eventFixtures.RUN_STARTED), frameProtobuf(eventFixtures.STEP_STARTED), frameProtobuf(eventFixtures.STEP_FINISHED)] as [Uint8Array, Uint8Array, Uint8Array];
  const stream = concat([a, b, c]);
  const frames: RawFrame[] = [];
  const reader = createProtobufFrameReader({ appendFrame: (frame) => void frames.push(frame), addFinding: () => undefined }, EXCHANGE);

  reader.push(stream.slice(0, 2), 10); // inside the first length prefix
  assert.equal(frames.length, 0);
  reader.push(stream.slice(2, a.length - 1), 20); // the first frame is one byte short
  assert.equal(frames.length, 0, 'a frame is not emitted before all its bytes have arrived');
  reader.push(stream.slice(a.length - 1, a.length + b.length + 2), 30); // completes a and b, starts c
  assert.deepEqual(frames.map((frame) => [frame.index, frame.offsetMs]), [[0, 30], [1, 30]], 'frames completed by one read share its offset');
  reader.push(stream.slice(a.length + b.length + 2), 40);
  assert.deepEqual(frames.map((frame) => [frame.index, frame.offsetMs]), [[0, 30], [1, 30], [2, 40]]);

  const offsets = read(protobufScenarios.splitByByte.chunks).frames.map((frame) => frame.offsetMs);
  assert.deepEqual([...offsets].sort((x, y) => x - y), offsets, 'offsets never go back');
});

test('an offset that goes back is raised to the last one, as for server-sent events', () => {
  const bytes = frameProtobuf(eventFixtures.RUN_STARTED);
  const { frames } = read([bytes.slice(0, 5), bytes.slice(5)], { offsets: [50, 20] });
  assert.equal(frames[0]!.offsetMs, 50);
});

// ---- the end of the stream ------------------------------------------------------------------------

test('a valid run ends without a terminal finding and a stream with no terminal event gets one', () => {
  assert.deepEqual(read(protobufScenarios.baselineRun.chunks).findings, []);
  const open = read([concat(baselineFrames.slice(0, 3))]);
  assert.deepEqual(open.findings.map((finding) => [finding.kind, finding.subject]), [['terminal', { type: 'exchange', id: EXCHANGE }]]);
  const named = read([concat(baselineFrames.slice(0, 3))], { end: { type: 'run', id: 'run-1' } });
  assert.deepEqual(named.findings.map((finding) => finding.subject), [{ type: 'run', id: 'run-1' }]);
  assert.deepEqual(read([]).findings.map((finding) => finding.kind), ['terminal'], 'an empty stream has none of the events');
});

test('end is idempotent, and push after end throws', () => {
  const { reader, findings } = read([baselineFrames[0]!]);
  const before = findings.length;
  reader.end();
  assert.equal(findings.length, before);
  assert.throws(() => reader.push(baselineFrames[1]!, 99), /already ended/);
});

// ---- through the recorder, the sink and the store -----------------------------------------------

test('a protobuf exchange through the recorder and the store keeps every byte and is marked as protobuf', async () => {
  const store = createSessionStore();
  let tick = 0;
  const recorder = createRecorder(createFrameSink(store), { now: () => (tick += 1), epoch: () => 1_700_000_000_000 });
  const scenario = protobufScenarios.baselineRun;
  const response = await recorder.record(scenario.request, scenarioSend(scenario));
  await response.arrayBuffer();
  while (store.snapshot().exchanges[0]?.transport !== 'completed') await new Promise((resolve) => setTimeout(resolve, 0));

  const { exchanges, frames, findings } = store.snapshot();
  assert.equal(exchanges[0]!.encoding, 'protobuf');
  assert.equal(frames.length, 30);
  assert.deepEqual(exchanges[0]!.frameIds, frames.map((frame) => frame.id));
  assert.equal(frames.every((frame) => frame.bytes !== undefined && frame.data === undefined), true);
  assert.deepEqual(concat(frames.map((frame) => Uint8Array.from(atob(frame.bytes!), (char) => char.charCodeAt(0)))), scenarioBytes(scenario));
  assert.deepEqual(findings, []);
});

test('a server-sent-events exchange is not marked and keeps its text frames', async () => {
  const store = createSessionStore();
  const recorder = createRecorder(createFrameSink(store));
  const scenario = protocolScenarios.runError;
  await (await recorder.record(scenario.request, scenarioSend(scenario))).arrayBuffer();
  while (store.snapshot().exchanges[0]?.transport !== 'completed') await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(store.snapshot().exchanges[0]!.encoding, undefined);
  assert.equal(store.snapshot().frames.every((frame) => frame.bytes === undefined && frame.data !== undefined), true);
});

test('a reader whose output throws loses its place: the sink reports it once and adds no false terminal finding', () => {
  const store = createSessionStore();
  const sink = createFrameSink({
    ...store,
    appendFrame() {
      throw new Error('store is full');
    },
  } as typeof store);
  sink.appendExchange({ id: EXCHANGE, kind: 'conversation', method: 'POST', path: '/agent', startedAt: 1, transport: 'streaming', encoding: 'protobuf', frameIds: [] });
  assert.throws(() => sink.appendChunk(EXCHANGE, baselineFrames[0]!, 10), /store is full/);
  sink.updateExchange(EXCHANGE, { transport: 'completed' });
  assert.deepEqual(store.snapshot().findings, [], 'a terminal finding would blame the stream for what the store lost');
});

// ---- damaged and unexpected binary (US4; FR-009, FR-010) ---------------------------------------------

const bytesOfFrame = (frame: RawFrame) => Uint8Array.from(Buffer.from(frame.bytes!, 'base64'));
const findingOf = (findings: readonly Finding[], frame: RawFrame) => findings.filter((finding) => finding.subject.type === 'frame' && finding.subject.id === frame.id);
const terminal = (findings: readonly Finding[]) => findings.filter((finding) => finding.kind === 'terminal');
const typesOf = (frames: readonly RawFrame[]) => frames.map((frame) => frame.eventType ?? `(${frame.classification})`);
const noReceivedValues = (findings: readonly Finding[], ...values: string[]) => {
  for (const finding of findings) for (const value of values) assert.ok(!finding.message.includes(value), `"${finding.message}" repeats a received value`);
};

test('a payload that is not a protobuf event is kept, flagged on its frame with a binary finding, and the frames after it are still read', () => {
  const { frames, findings } = read(protobufScenarios.undecodablePayload.chunks);
  assert.deepEqual(typesOf(frames), ['RUN_STARTED', '(data)', 'STEP_STARTED', 'STEP_FINISHED', 'RUN_FINISHED']);
  const garbage = frames[1]!;
  assert.deepEqual(bytesOfFrame(garbage), garbageFrame, 'the bytes as received, length prefix included');
  assert.deepEqual([garbage.classification, garbage.jsonVerdict, garbage.schemaVerdict, garbage.parsed, garbage.eventType, garbage.data, garbage.envelope], ['data', 'not-applicable', 'not-applicable', undefined, undefined, undefined, '']);
  assert.match(garbage.summary, /^Not a decodable protobuf event · 7 bytes$/);
  assert.deepEqual(findingOf(findings, garbage).map((finding) => [finding.kind, finding.id]), [['binary', `${garbage.id}:finding`]]);
  assert.match(findingOf(findings, garbage)[0]!.message, /not a valid protobuf event/);
  assert.deepEqual(terminal(findings), [], 'the run still ended with a valid RUN_FINISHED');
  assert.deepEqual(frames.map((frame) => frame.index), [0, 1, 2, 3, 4]);
});

test('an empty message is a complete frame of four bytes that cannot be decoded', () => {
  const { frames, findings } = read(protobufScenarios.zeroLength.chunks);
  assert.deepEqual(typesOf(frames), ['RUN_STARTED', '(data)', 'RUN_FINISHED']);
  assert.deepEqual(bytesOfFrame(frames[1]!), zeroLengthFrame);
  assert.deepEqual(findingOf(findings, frames[1]!).map((finding) => finding.kind), ['binary']);
});

test('an event from a later protocol is kept with an unknown-type verdict and a schema finding, and it has no event type', () => {
  const { frames, findings } = read(protobufScenarios.unknownEvent.chunks);
  assert.deepEqual(typesOf(frames), ['RUN_STARTED', '(data)', 'RUN_FINISHED']);
  const future = frames[1]!;
  assert.deepEqual(bytesOfFrame(future), futureEventFrame);
  assert.deepEqual([future.schemaVerdict, future.jsonVerdict, future.parsed, future.eventType], ['unknown-type', 'not-applicable', undefined, undefined]);
  assert.match(future.summary, /^Event from a later protocol \(not decoded\) · 9 bytes$/);
  assert.deepEqual(findingOf(findings, future).map((finding) => finding.kind), ['schema']);
  assert.match(findingOf(findings, future)[0]!.message, /not in the supported baseline/);
});

test('an event that decodes and fails the event schema keeps its decoded content and gets a schema finding that names fields, not values', () => {
  const { frames, findings } = read(protobufScenarios.invalidEvent.chunks);
  const invalid = frames[1]!;
  assert.deepEqual([invalid.eventType, invalid.schemaVerdict, invalid.classification], ['TEXT_MESSAGE_START', 'invalid', 'data']);
  assert.equal((invalid.parsed as { role?: string }).role, 'robot', 'what was received is kept as it decoded');
  assert.deepEqual(findingOf(findings, invalid).map((finding) => finding.kind), ['schema']);
  assert.match(findingOf(findings, invalid)[0]!.message, /^Does not match the AG-UI event schema: role/);
  noReceivedValues(findings, 'robot', 'm-invalid');
});

test('a stream that ends inside a frame, or inside a length prefix, keeps the bytes as one partial frame with no finding of its own', () => {
  for (const [name, scenario, cutAt] of [['inside a frame', protobufScenarios.truncatedFrame, 9], ['inside a length prefix', protobufScenarios.truncatedLength, 2]] as const) {
    const { frames, findings } = read(scenario.chunks);
    assert.deepEqual(typesOf(frames), ['RUN_STARTED', '(partial)'], name);
    const partial = frames[1]!;
    assert.equal(bytesOfFrame(partial).length, cutAt, name);
    assert.deepEqual(bytesOfFrame(partial), wire(scenario).slice(frameProtobuf(eventFixtures.RUN_STARTED).length), name);
    assert.deepEqual([partial.jsonVerdict, partial.schemaVerdict, partial.parsed, partial.envelope, partial.data], ['not-applicable', 'not-applicable', undefined, '', undefined], name);
    assert.equal(partial.summary, 'Incomplete frame at the end of the stream (never dispatched)', name);
    assert.deepEqual(findingOf(findings, partial), [], name);
    assert.deepEqual(terminal(findings).map((finding) => finding.subject), [{ type: 'exchange', id: EXCHANGE }], `${name}: the missing terminal event is reported`);
  }
});

test('a frame larger than the limit stops the splitting: every byte from its prefix to the end of the stream is one partial frame with a binary finding', () => {
  const scenario = protobufScenarios.oversizedLength;
  const { frames, findings } = read(scenario.chunks, { offsets: [10, 20, 30] });
  assert.deepEqual(typesOf(frames), ['RUN_STARTED', 'STEP_STARTED', '(partial)'], 'the frames before it are unchanged');
  const rest = frames[2]!;
  const expected = wire(scenario).slice(frameProtobuf(eventFixtures.RUN_STARTED).length + frameProtobuf(eventFixtures.STEP_STARTED).length);
  assert.deepEqual(bytesOfFrame(rest), expected, 'the prefix and everything after it, across all the reads');
  assert.equal(rest.offsetMs, 30, 'the offset of the last read');
  assert.match(rest.summary, /^Bytes that cannot be read as length-prefixed frames · \d+ bytes$/);
  assert.deepEqual(findingOf(findings, rest).map((finding) => finding.kind), ['binary']);
  assert.match(findingOf(findings, rest)[0]!.message, /larger than 10 MB.*another encoding/s);
  assert.equal(frames[0]!.offsetMs, 10);
});

test('the rest of the stream after an unreadable length is not read as frames, however many reads bring it, and nothing is lost', () => {
  const lead = concat([frameProtobuf(eventFixtures.RUN_STARTED), oversizedPrefix()]);
  const more = Uint8Array.from({ length: 100 }, (_, at) => at);
  for (const pieces of [[lead, more], [lead.slice(0, lead.length - 1), lead.slice(lead.length - 1), more.slice(0, 1), more.slice(1)], fragment(concat([lead, more]), [1])]) {
    const { frames } = read(pieces);
    assert.deepEqual(typesOf(frames), ['RUN_STARTED', '(partial)']);
    assert.deepEqual(bytesOfFrame(frames[1]!), concat([oversizedPrefix(), more]));
  }
});

test('a frame of exactly the limit, length prefix included, is read as a frame, and one byte more is not', () => {
  const limit = 10 * 1024 * 1024;
  const frameWith = (size: number) => frameProtobuf({ ...eventFixtures.TEXT_MESSAGE_CONTENT, delta: 'x'.repeat(size) });
  let size = limit - 200;
  let frame = frameWith(size);
  size += limit - frame.length;
  frame = frameWith(size);
  for (let guard = 0; frame.length !== limit && guard < 8; guard += 1) {
    size += limit - frame.length;
    frame = frameWith(size);
  }
  assert.equal(frame.length, limit, 'a frame of exactly the limit was built');
  const exact = read([frame.slice(0, 1000), frame.slice(1000)]).frames;
  assert.deepEqual(exact.map((entry) => [entry.classification, entry.eventType]), [['data', 'TEXT_MESSAGE_CONTENT']]);
  assert.equal(bytesOfFrame(exact[0]!).length, limit);

  const over = frameWith(size + 1);
  assert.equal(over.length > limit, true);
  const refused = read([over]).frames;
  assert.deepEqual(refused.map((entry) => entry.classification), ['partial'], 'one byte more: not a frame any client reads');
  assert.equal(bytesOfFrame(refused[0]!).length, over.length, 'all of it is kept');
});

test('an answer in server-sent events to a request for protobuf is kept as bytes and flagged as unreadable in this encoding', () => {
  const scenario = protobufScenarios.answeredInSse;
  const { frames, findings } = read(scenario.chunks);
  assert.deepEqual(typesOf(frames), ['(partial)']);
  assert.deepEqual(bytesOfFrame(frames[0]!), wire(scenario), 'every received byte, in order');
  assert.deepEqual(findingOf(findings, frames[0]!).map((finding) => finding.kind), ['binary']);
  assert.match(findingOf(findings, frames[0]!)[0]!.message, /another encoding/);
  assert.equal(terminal(findings).length, 1);
});

test('damaged streams through the recorder and the store: every byte is in the recording and the exchange ends in its true state', async () => {
  for (const [name, scenario] of Object.entries(protobufScenarios)) {
    const store = createSessionStore({ schedule: (callback) => callback() });
    const recorder = createRecorder(createFrameSink(store), { now: (() => { let tick = 0; return () => (tick += 1); })(), epoch: () => 1_700_000_000_000 });
    await (await recorder.record(scenario.request, scenarioSend(scenario))).arrayBuffer();
    while (store.snapshot().exchanges[0]?.transport !== 'completed') await new Promise((resolve) => setTimeout(resolve, 0));
    const { exchanges, frames } = store.snapshot();
    assert.equal(exchanges[0]!.encoding, 'protobuf', name);
    assert.deepEqual(concat(frames.map(bytesOfFrame)), wire(scenario), `${name}: the frames hold every byte the server sent`);
    assert.deepEqual(frames.map((frame) => frame.index), frames.map((_, at) => at), name);
  }
});
