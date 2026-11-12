// Feature 018, T013 (FR-009, SC-006): a headless session records what the page records. For every reference scenario,
// its frames are the bytes the server wrote, in order, and its findings equal those of the page's runtime fed the same
// bytes through the scripted network the runtime tests use. And a headless run costs at most a second over the stream.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInteractiveServer } from '../../../../examples/reference-agent/interactive-scenarios.ts';
import { NATURAL_PACE } from '../../../../examples/reference-agent/pacing.ts';
import { SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';
import type { Finding, RawFrame } from '../../src/contracts.ts';
import { openSession } from '../../src/headless/session.ts';
import { AGENT, rig } from '../runtime/support.ts';

const MESSAGES = ['hello', ...Object.values(SCENARIOS).filter((message) => message !== SCENARIOS.neverFinishes)];

const framesOf = (frames: readonly RawFrame[]) => frames.map((frame) => [frame.classification, frame.eventType ?? null, frame.data ?? frame.bytes ?? null]);
const findingsOf = (findings: readonly Finding[]) => findings.map((finding) => [finding.kind, finding.rule ?? null, finding.message]).sort();

for (const message of MESSAGES) {
  test(`"${message}": the frames are the bytes the server wrote, and the findings equal the page runtime's`, async () => {
    const server = await createInteractiveServer();
    try {
      const session = await openSession({ target: `${server.origin}/agent` });
      await session.send(message);
      const bytes = server.sent()[0];
      assert.ok(bytes !== undefined);
      const written = new TextDecoder().decode(bytes);
      let at = 0;
      for (const frame of session.frames()) {
        const found = written.indexOf(frame.data ?? '\u0000', at);
        assert.ok(found >= at, `frame ${frame.index} comes after the one before it in the written bytes`);
        at = found;
      }

      const page = rig([(call) => (call.path === '/run' ? new Response(bytes.slice(), { status: 200, headers: { 'content-type': 'text/event-stream' } }) : undefined)]);
      page.runtime.setTarget(AGENT);
      await page.runtime.send(message);
      const recorded = await page.settle();
      assert.equal(session.exchanges().length, 1);
      assert.equal(recorded.exchanges.length, 1);
      assert.deepEqual(framesOf(session.frames()), framesOf(recorded.frames));
      assert.deepEqual(findingsOf(session.findings()), findingsOf(recorded.findings));
      if (message === SCENARIOS.broken) assert.ok(session.findings().length > 0, 'the damaged stream has findings to compare');
      session.close();
    } finally {
      await server.close();
    }
  });
}

test('a paced run takes at most one second longer headless than reading the same stream with fetch', async () => {
  const server = await createInteractiveServer({ pace: NATURAL_PACE });
  try {
    const started = performance.now();
    const response = await fetch(`${server.origin}/agent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId: 't', runId: 'r', messages: [{ id: 'm', role: 'user', content: 'hello' }], tools: [], context: [], state: {}, forwardedProps: {} }),
    });
    await response.arrayBuffer();
    const stream = performance.now() - started;

    const session = await openSession({ target: `${server.origin}/agent` });
    const before = performance.now();
    await session.send('hello');
    const headless = performance.now() - before;
    session.close();
    assert.ok(headless <= stream + 1000, `headless ${Math.round(headless)} ms, stream ${Math.round(stream)} ms`);
  } finally {
    await server.close();
  }
});
