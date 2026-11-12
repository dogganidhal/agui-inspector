// Feature 018, T023 (US5): session files go both ways between the page and a headless session.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';
import { parseSession, serializeSession } from '../../src/core/session-files/index.ts';
import { loadSession, openSession } from '../../src/headless/session.ts';
import { AGENT, replyRoute, rig } from '../runtime/support.ts';
import { tempDir, withAgent } from './support.ts';

test('a file the page exported loads with the same frames and findings, and has no step methods', async () => {
  const page = rig([replyRoute('/run', 'Hello from the page.')]);
  page.runtime.setTarget(AGENT);
  await page.runtime.send('hi');
  const recorded = await page.settle();
  const file = path.join(tempDir(), 'page.json');
  writeFileSync(file, serializeSession(recorded));

  const loaded = await loadSession(file);
  assert.deepEqual(loaded.frames(), [...recorded.frames]);
  assert.deepEqual(loaded.findings(), [...recorded.findings]);
  assert.match(JSON.stringify(loaded.conversation().entries), /Hello from the page\./);
  for (const method of ['send', 'sendRaw', 'answerInterrupt', 'submitToolResult', 'a2ui', 'stop']) assert.equal(method in loaded, false, method);
  assert.deepEqual(loaded.pending(), { interrupts: [], toolCalls: [] });
});

test('a file that fails the page\'s checks is refused with the page\'s message', async () => {
  const file = path.join(tempDir(), 'bad.json');
  writeFileSync(file, '{"version": 0, "session": {}}');
  await assert.rejects(loadSession(file), /^Error: Import failed: /);
});

test('a headless file passes the page\'s import, findings included', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send(SCENARIOS.broken);
    const file = path.join(tempDir(), 'headless.json');
    await session.save(file);
    const loaded = await loadSession(file);
    assert.deepEqual(loaded.frames(), session.frames());
    assert.deepEqual(loaded.findings(), session.findings());
    const parsed = parseSession(JSON.stringify(session.toJSON()));
    assert.ok(parsed.ok);
    session.close();
  });
});
