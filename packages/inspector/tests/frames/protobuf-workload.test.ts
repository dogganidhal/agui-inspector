// Spec 013 (plan: performance goals): the protobuf reader is linear in the bytes it receives. A session of 5,000
// frames in uneven reads keeps every frame and every byte, and a 10 MB frame that arrives in 1 KB reads is read in a
// time that does not grow with the square of the number of reads. The bounds are loose on purpose: they catch a
// reader that copies its whole buffer on each read, not a slow machine.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { concat } from '../../../../examples/reference-agent/protobuf-fixtures.ts';
import { frameProtobuf } from '../../../../examples/reference-agent/protobuf.ts';
import { fragment, scenarioSend, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { RawFrame } from '../../src/contracts.ts';
import { createFrameSink, createProtobufFrameReader } from '../../src/core/frames/index.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const THREAD = { threadId: 't-load', runId: 'r-load' };

test('5,000 protobuf frames in uneven reads are all recorded, in order, with every byte', async () => {
  const events = [
    { type: 'RUN_STARTED', ...THREAD },
    ...Array.from({ length: 4998 }, (_, at) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: `piece ${at}` })),
    { type: 'RUN_FINISHED', ...THREAD, outcome: { type: 'success' } },
  ];
  const bytes = concat(events.map((event) => frameProtobuf(event)));
  const scenario: RecorderScenario = {
    name: 'protobuf-5000-frames',
    request: { kind: 'conversation', method: 'POST', path: '/agent', body: JSON.stringify(THREAD), responseKind: 'protobuf' },
    status: 200,
    announcedContentType: 'application/vnd.ag-ui.event+proto',
    chunks: fragment(bytes, [1, 7, 64, 4096, 511]),
    ending: 'close',
  };
  const store = createSessionStore({ schedule: (callback) => callback() });
  const recorder = createRecorder(createFrameSink(store));

  const started = performance.now();
  await (await recorder.record(scenario.request, scenarioSend(scenario))).arrayBuffer();
  while (store.snapshot().exchanges[0]?.transport !== 'completed') await new Promise((resolve) => setTimeout(resolve, 0));
  const elapsed = performance.now() - started;

  const { frames, findings } = store.snapshot();
  assert.equal(frames.length, 5000);
  assert.equal(frames.filter((frame) => frame.classification === 'data' && frame.schemaVerdict === 'valid').length, 5000);
  assert.deepEqual(frames.map((frame) => frame.index), frames.map((_, at) => at));
  assert.deepEqual(concat(frames.map((frame) => Uint8Array.from(Buffer.from(frame.bytes!, 'base64')))), bytes);
  assert.deepEqual(findings, []);
  assert.ok(elapsed < 20_000, `5,000 frames took ${Math.round(elapsed)} ms`);
});

test('a frame of about 10 MB that arrives in 1 KB reads is read in linear time and keeps every byte', () => {
  const event = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'x'.repeat(10 * 1024 * 1024 - 200) };
  const frame = frameProtobuf(event);
  assert.ok(frame.length < 10 * 1024 * 1024 && frame.length > 10 * 1024 * 1024 - 400);
  const frames: RawFrame[] = [];
  const reader = createProtobufFrameReader({ appendFrame: (entry) => void frames.push(entry), addFinding: () => undefined }, 'exchange-1');

  const started = performance.now();
  let reads = 0;
  for (let at = 0; at < frame.length; at += 1024) {
    reader.push(frame.subarray(at, at + 1024), (reads += 1));
  }
  reader.end();
  const elapsed = performance.now() - started;

  assert.ok(reads > 10_000, 'many reads, so a reader that copied its buffer on each one would take far too long');
  assert.deepEqual(frames.map((entry) => entry.classification), ['data']);
  assert.equal(frames[0]!.bytes, Buffer.from(frame).toString('base64'));
  assert.equal(frames[0]!.offsetMs, reads, 'the offset of the read that carried the last byte');
  assert.ok(elapsed < 10_000, `${reads} reads took ${Math.round(elapsed)} ms`);
});
