// Spec 011 (FR-017, SC-008): the waterfall over the frozen 5,000-frame benchmark workload (plan.md, research R9). It is
// built again on every store update while the tab is open, so it must stay cheap at the release size, keep every
// message and tool call the messages snapshot of the workload would hide in the conversation, and never touch the raw
// frames. The browser measurement is in tests/e2e/inspection/waterfall.spec.ts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { generateFixture } from '../../../../tests/benchmarks/generate.ts';
import { buildWaterfall, type WaterfallRow } from '../../src/core/projection/waterfall.ts';
import { harness } from '../conversation/support.ts';

const FRAME_MS = 7;

/** One thread, ten exchanges, 7 ms between frames. */
function play(h = harness()) {
  const fixture = generateFixture();
  for (const exchange of fixture) {
    const id = `bench-${exchange.index}`;
    h.open(id, { input: { threadId: 'bench-thread', runId: exchange.runId } });
    exchange.frames.forEach((frame, i) => h.pushWire(id, frame.envelope, (i + 1) * FRAME_MS));
    h.close(id);
  }
  return { h, fixture };
}

const kinds = (rows: readonly WaterfallRow[], into = new Map<string, number>()): Map<string, number> => {
  for (const row of rows) {
    into.set(row.kind, (into.get(row.kind) ?? 0) + 1);
    kinds(row.children, into);
  }
  return into;
};

test('the 5,000-frame workload builds quickly, keeps every row the snapshot would hide and does not touch the evidence', () => {
  const { h } = play();
  const session = h.session();
  const rawHash = () => createHash('sha256').update(JSON.stringify(session.frames)).digest('hex');
  const before = rawHash();
  assert.equal(session.frames.filter((frame) => frame.classification === 'data').length, 5000);

  const started = performance.now();
  const waterfall = buildWaterfall(session);
  const elapsed = performance.now() - started;
  const counts = kinds(waterfall.runs.map((run) => run.row));
  console.log(`waterfall of ${session.frames.length} frames: ${elapsed.toFixed(1)} ms, rows ${JSON.stringify(Object.fromEntries(counts))}`);

  assert.ok(elapsed < 500, `building the waterfall of 5,000 frames took ${elapsed.toFixed(0)} ms`);
  assert.equal(waterfall.runs.length, 10);
  // The workload sends a MESSAGES_SNAPSHOT: the conversation keeps 2 of these 160 messages and none of the tool calls.
  assert.deepEqual(Object.fromEntries(counts), { run: 10, step: 100, message: 160, tool: 140, reasoning: 60 });
  const ids = new Set<string>();
  const visit = (row: WaterfallRow) => {
    assert.ok(!ids.has(row.id), `duplicate row id ${row.id}`);
    ids.add(row.id);
    row.children.forEach(visit);
  };
  waterfall.runs.forEach((run) => visit(run.row));
  assert.equal(rawHash(), before, 'the raw frames are exactly as the reader left them');
});

test('while the workload is captured, every update rebuilds the waterfall within budget', () => {
  const fixture = generateFixture();
  const h = harness();
  const last = fixture[fixture.length - 1];
  assert.ok(last);
  for (const exchange of fixture.slice(0, -1)) {
    const id = `bench-${exchange.index}`;
    h.open(id, { input: { threadId: 'bench-thread', runId: exchange.runId } });
    exchange.frames.forEach((frame, i) => h.pushWire(id, frame.envelope, (i + 1) * FRAME_MS));
    h.close(id);
  }
  const id = `bench-${last.index}`;
  h.open(id, { input: { threadId: 'bench-thread', runId: last.runId } });
  const frames = last.frames;
  const samples: number[] = [];
  frames.forEach((frame, i) => {
    h.pushWire(id, frame.envelope, (i + 1) * FRAME_MS);
    if (i >= frames.length - 200) {
      const started = performance.now();
      buildWaterfall(h.session());
      samples.push(performance.now() - started);
    }
  });
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95) - 1] as number;
  console.log(`waterfall rebuild per frame near 5,000 frames: p95 ${p95.toFixed(1)} ms, max ${samples.at(-1)?.toFixed(1)} ms`);
  assert.equal(samples.length, 200);
  assert.ok(p95 < 100, `the 95th percentile of a rebuild was ${p95.toFixed(0)} ms`);
});
