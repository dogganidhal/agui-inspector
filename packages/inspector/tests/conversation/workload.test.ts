// L03: the projection over the frozen 5,000-frame benchmark workload (plan.md, Fixed 5,000-frame
// benchmark). The conversation view re-projects on every store notification, so it must stay cheap
// at the release size, keep every valid event, and never touch the raw frames.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { generateFixture } from '../../../../tests/benchmarks/generate.ts';
import { projectConversation, publishChunkExpansions } from '../../src/core/projection/index.ts';
import { harness } from './support.ts';

function play() {
  const h = harness();
  const fixture = generateFixture();
  for (const exchange of fixture) {
    const id = `bench-${exchange.index}`;
    // One thread, so the whole workload is the current conversation.
    h.open(id, { input: { threadId: 'bench-thread', runId: exchange.runId } });
    for (const frame of exchange.frames) h.pushWire(id, frame.envelope, 0);
    h.close(id);
  }
  return { h, fixture };
}

test('the 5,000-frame workload projects quickly, completely and without touching the evidence', () => {
  const { h, fixture } = play();
  const session = h.session();
  const rawHash = () => createHash('sha256').update(JSON.stringify(session.frames)).digest('hex');
  const before = rawHash();
  assert.equal(session.frames.filter((frame) => frame.classification === 'data').length, 5000);

  const started = performance.now();
  const model = projectConversation(session);
  const elapsed = performance.now() - started;
  console.log(`projection of ${session.frames.length} frames: ${elapsed.toFixed(1)} ms, ${model.entries.length} top-level entries, ${model.derived.length} derived, ${model.issues.length} issues`);

  assert.ok(elapsed < 500, `projecting 5,000 frames took ${elapsed.toFixed(0)} ms`);
  assert.equal(model.entries.filter((entry) => entry.kind === 'run').length, fixture.length, 'one header per exchange');
  assert.ok(model.entries.length > fixture.length, 'and the content under them');
  assert.deepEqual(model.issues, [], 'the workload is lifecycle-valid apart from its 100 invalid frames, which never project');
  const runs = model.entries.filter((entry) => entry.kind === 'run');
  assert.equal(runs.filter((run) => run.status === 'error').length, 2, 'the plan ends two exchanges with RUN_ERROR');
  assert.equal(runs.filter((run) => run.status === 'no-terminal' || run.status === 'streaming').length, 0, 'and the other eight reach a terminal outcome');
  assert.equal(rawHash(), before, 'the raw frames are exactly as the reader left them');
});

test('publishing chunk expansions for the workload is idempotent and links every expansion to a chunk frame', () => {
  const { h } = play();
  const added = publishChunkExpansions(h.store);
  assert.ok(added > 0);
  assert.equal(publishChunkExpansions(h.store), 0);
  const session = h.session();
  const byId = new Map(session.frames.map((frame) => [frame.id, frame]));
  for (const entry of session.derived) {
    assert.equal(entry.provenance, 'derived');
    assert.equal(entry.sources.length, 1);
    assert.match(byId.get(entry.sources[0]!)?.eventType ?? '', /_CHUNK$/, `${entry.id} points at a chunk frame`);
  }
});
