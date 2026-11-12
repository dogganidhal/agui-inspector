// Feature 018, T009: the structural assertions of agui-inspector/testing.
import assert, { AssertionError } from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';
import {
  assertFinding,
  assertMessage,
  assertNoFinding,
  assertNoMessage,
  assertPendingInterrupt,
  assertPendingToolCall,
  assertState,
  assertSurface,
} from '../../src/headless/assert.ts';
import { openSession } from '../../src/headless/session.ts';
import { serveA2ui, tempDir, withAgent } from './support.ts';

const fails = (body: () => void) =>
  assert.throws(body, (error: unknown) => error instanceof AssertionError && 'expected' in error && 'actual' in error && error.actual !== undefined);

test('message assertions match exact text or a pattern, and fail with what they found', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send('hello');
    assertMessage(session, { role: 'assistant', text: 'Hello from the reference agent.' });
    assertMessage(session, { text: /reference agent/ });
    assertNoMessage(session, { role: 'assistant', text: /goodbye/ });
    fails(() => assertMessage(session, { role: 'assistant', text: 'Hello' }));
    fails(() => assertNoMessage(session, { role: 'user' }));
    session.close();
  });
});

test('pending interrupts and tool calls', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send(SCENARIOS.interrupt);
    assertPendingInterrupt(session, { reason: 'approval' });
    assertPendingInterrupt(session, { reason: /inp/ });
    fails(() => assertPendingInterrupt(session, { reason: 'other' }));
    fails(() => assertPendingToolCall(session, { name: 'pick_color' }));
    session.close();

    const tools = await openSession({ target: agent });
    await tools.send(SCENARIOS.tools);
    assertPendingToolCall(tools, { name: /^pick_/ });
    tools.close();
  });
});

test('findings by rule id, and no finding at all', async () => {
  await withAgent(async (_server, agent) => {
    const clean = await openSession({ target: agent });
    await clean.send('hello');
    assertNoFinding(clean);
    clean.close();

    const broken = await openSession({ target: agent });
    await broken.send(SCENARIOS.broken);
    const rule = broken.findings()[0]?.rule ?? '';
    assertFinding(broken, rule);
    fails(() => assertNoFinding(broken));
    fails(() => assertNoFinding(broken, rule));
    fails(() => assertFinding(broken, 'sequence.no-such-rule'));
    broken.close();
  });
});

test('state matches a deep partial value', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send(SCENARIOS.state);
    assertState(session, { counter: 2 });
    assertState(session, { items: ['a', 'b'] });
    fails(() => assertState(session, { counter: 3 }));
    fails(() => assertState(session, { items: ['a'] }));
    session.close();
  });
});

test('surfaces by component type and properties', async () => {
  const served = await serveA2ui();
  try {
    const session = await openSession({ target: served.agent });
    await session.send('show the form');
    assertSurface(session, { component: { type: 'Button' } });
    assertSurface(session, { surfaceId: 'form', component: { type: 'Text', props: { text: /Order/ } } });
    fails(() => assertSurface(session, { component: { type: 'Slider' } }));
    fails(() => assertSurface(session, { surfaceId: 'other', component: { type: 'Button' } }));
    session.close();
  } finally {
    await served.close();
  }
});

test('with AGUI_INSPECTOR_SAVE_ON_FAILURE set, a failure saves the session and names the file', async () => {
  const dir = tempDir();
  const before = process.env['AGUI_INSPECTOR_SAVE_ON_FAILURE'];
  process.env['AGUI_INSPECTOR_SAVE_ON_FAILURE'] = dir;
  try {
    await withAgent(async (_server, agent) => {
      const session = await openSession({ target: agent });
      await session.send('hello');
      assert.throws(
        () => assertMessage(session, { text: 'not there' }),
        (error: Error) => error.message.includes(dir),
      );
      assert.equal(readdirSync(dir).length, 1);
      session.close();
    });
  } finally {
    if (before === undefined) delete process.env['AGUI_INSPECTOR_SAVE_ON_FAILURE'];
    else process.env['AGUI_INSPECTOR_SAVE_ON_FAILURE'] = before;
  }
});
