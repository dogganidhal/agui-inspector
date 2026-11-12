// Feature 018, T021 (US4): a host that guards its agent route, as an embedded Python server behind its own auth does.
// The session passes the host's credentials as a header; without them the 401 is recorded. The credentials appear in
// nothing the session returns or writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { openSession } from '../../src/headless/session.ts';
import { SECRET, serve, tempDir } from './support.ts';

const BASIC = `Basic ${Buffer.from(`user:${SECRET}`).toString('base64')}`;

test('with the host\'s auth header the run is recorded, without it the 401 is, and the credentials stay out of every output', async () => {
  const host = await serve((input, request, response) => {
    if (request.headers.authorization !== BASIC) return void response.writeHead(401, { 'www-authenticate': 'Basic realm="host"' }).end();
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = [
      { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
      { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hello from the guarded host.' },
      { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' },
      { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome: { type: 'success' } },
    ];
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  try {
    const target = `${host.origin}/agents/demo/stream`;
    const allowed = await openSession({ target, headers: { Authorization: BASIC } });
    const step = await allowed.send('hi');
    assert.equal(step.error, undefined);
    assert.equal(allowed.frames().length, 5);
    const file = path.join(tempDir(), 'guarded.json');
    await allowed.save(file);
    const everything = JSON.stringify([step, allowed.frames(), allowed.exchanges(), allowed.findings(), allowed.conversation(), allowed.toJSON()]) + readFileSync(file, 'utf8');
    for (const secret of [SECRET, Buffer.from(`user:${SECRET}`).toString('base64')]) assert.ok(!everything.includes(secret));
    allowed.close();

    const refused = await openSession({ target });
    const denied = await refused.send('hi');
    assert.match(denied.error ?? '', /401/);
    assert.equal(refused.exchanges()[0]?.status, 401);
    refused.close();
  } finally {
    await host.close();
  }
});
