// Feature 018, T007: a headless session over real HTTP (contracts/testing-api.md).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { INTERRUPT_FOREVER, SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';
import { parseSession } from '../../src/core/session-files/index.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { openSession, type Session } from '../../src/headless/session.ts';
import { fixed, SECRET, serve, tempDir, withAgent } from './support.ts';

const messages = (session: Session) => session.conversation().entries.flatMap((entry) => (entry.kind === 'message' ? [`${entry.role}: ${entry.text}`] : []));

test('openSession refuses a bad target or header before any request, with messages that echo nothing', async () => {
  for (const target of ['not a url', 'ftp://127.0.0.1/agent', `http://user:${SECRET}@127.0.0.1/agent`, `http://127.0.0.1/agent?token=${SECRET}`, `http://127.0.0.1/agent#${SECRET}`]) {
    await assert.rejects(openSession({ target }), (error: Error) => !error.message.includes(SECRET) && /^target must/.test(error.message));
  }
  for (const name of ['Host', 'content-length', 'Transfer-Encoding', 'Connection']) {
    await assert.rejects(openSession({ target: 'http://127.0.0.1:9/agent', headers: { [name]: SECRET } }), (error: Error) => !error.message.includes(SECRET));
  }
  for (const [name, value] of [['bad name', SECRET], ['x-ok', ''], ['x-ok', `a\nb${SECRET}`]] as const) {
    await assert.rejects(openSession({ target: 'http://127.0.0.1:9/agent', headers: { [name]: value } }), (error: Error) => !error.message.includes(SECRET));
  }
});

test('send resolves once the run has ended and capture is over, and reports what it added', async () => {
  await withAgent(async (server, agent) => {
    const session = await openSession({ target: agent });
    const step = await session.send('hello');
    assert.equal(step.idle, true);
    assert.equal(step.timedOut, false);
    assert.equal(step.error, undefined);
    assert.equal(step.newFrames, session.frames().length);
    assert.ok(step.newFrames > 2);
    assert.equal(session.exchanges()[0]?.transport, 'completed');
    assert.deepEqual(messages(session), ['user: hello', 'assistant: Hello from the reference agent.']);
    const written = new TextDecoder().decode(server.sent()[0]);
    for (const frame of session.frames()) assert.ok(written.includes(frame.data ?? '\u0000'));

    const second = await session.send(SCENARIOS.state);
    assert.equal(second.newFrames, session.frames().length - step.newFrames, 'a step counts only its own frames');
    assert.deepEqual(session.state(), { counter: 2, items: ['a', 'b'] });
    session.close();
  });
});

test('sendRaw sends JSON that is not a valid run input unchanged, and refuses text that is not JSON, as the page does', async () => {
  const served = await serve((_input, _request, response) => response.writeHead(422).end());
  try {
    const session = await openSession({ target: served.agent });
    const raw = '{ "threadId": 1,  "extra": true }';
    const step = await session.sendRaw(raw);
    assert.equal(step.idle, true);
    assert.equal(session.exchanges()[0]?.requestBody, raw);
    assert.deepEqual(served.inputs, [{ threadId: 1, extra: true }]);
    const refused = await session.sendRaw('{"threadId": 1');
    assert.match(refused.error ?? '', /Not valid JSON, so it was not sent/);
    assert.equal(session.exchanges().length, 1);
    session.close();
  } finally {
    await served.close();
  }
});

test('interrupts: an unknown id rejects, the first answer waits for the second, the last one sends the continuation', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send(SCENARIOS.interrupt);
    const pending = session.pending();
    assert.deepEqual(pending.interrupts.map((interrupt) => [interrupt.id, interrupt.reason]), [['i-approve', 'approval'], ['i-contact', 'input']]);
    await assert.rejects(session.answerInterrupt('i-nope', 'resolved'), /No pending interrupt/);
    const first = await session.answerInterrupt('i-approve', 'resolved', { approved: true });
    assert.deepEqual(first.waitingFor, ['i-contact']);
    assert.equal(first.newFrames, 0);
    const last = await session.answerInterrupt('i-contact', 'cancelled');
    assert.deepEqual(last.waitingFor, []);
    assert.ok(last.newFrames > 0);
    assert.match(messages(session).at(-1) ?? '', /Resumed with i-approve=resolved:\{"approved":true\}, i-contact=cancelled/);
    assert.deepEqual(session.pending().interrupts, []);
    session.close();
  });
});

test('client tool calls: results go with the continuation once both exist', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send(SCENARIOS.tools);
    assert.deepEqual(session.pending().toolCalls.map((call) => [call.id, call.name]), [['c-color', 'pick_color'], ['c-size', 'pick_size']]);
    assert.deepEqual(session.pending().toolCalls[0]?.arguments, { choices: ['red', 'teal'] });
    await assert.rejects(session.submitToolResult('c-nope', 'x'), /No pending tool call/);
    assert.deepEqual((await session.submitToolResult('c-color', 'teal')).waitingFor, ['c-size']);
    await session.submitToolResult('c-size', '2');
    assert.match(messages(session).at(-1) ?? '', /Tool results: c-color=teal, c-size=2/);
    session.close();
  });
});

test('a run that never ends is stopped at the time limit, and what arrived is kept', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent, timeoutMs: 300 });
    const step = await session.send(SCENARIOS.neverFinishes);
    assert.equal(step.timedOut, true);
    assert.equal(step.idle, true, 'capture ended when the session stopped it');
    assert.equal(session.exchanges()[0]?.transport, 'user-stopped');
    assert.ok(session.frames().length > 0);
    session.close();
  });
});

test('a profile answers interrupts automatically and stops at the limit, as in the page', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent, profile: { ...defaultProfile(), interruptReply: 'resolve', interruptPayloads: { input: 'yes' } } });
    const step = await session.send(INTERRUPT_FOREVER);
    assert.equal(step.idle, true);
    assert.match(session.pending().notice ?? '', /Automatic replies paused/);
    assert.ok(session.toJSON().session.runs.length > 2);
    session.close();
  });
});

test('a profile can come from a file', async () => {
  await withAgent(async (_server, agent) => {
    const file = path.join(tempDir(), 'profile.json');
    writeFileSync(file, JSON.stringify({ version: 0, profile: { ...defaultProfile(), interruptReply: 'resolve', interruptPayloads: { input: 'yes' } } }));
    const session = await openSession({ target: agent, profile: file });
    await session.send(INTERRUPT_FOREVER);
    assert.match(session.pending().notice ?? '', /Automatic replies paused/);
    session.close();
  });
});

test('close stops the session, and a later step rejects', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    session.close();
    await assert.rejects(session.send('hello'), /closed/);
  });
});

test('two sessions in one process keep their own threads, frames and headers', async () => {
  const served = await serve((input, _request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId })}\n\ndata: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId })}\n\n`);
  });
  try {
    const one = await openSession({ target: served.agent, headers: { 'x-who': 'one' } });
    const two = await openSession({ target: served.agent, headers: { 'x-who': 'two' } });
    await Promise.all([one.send('a'), two.send('b')]);
    assert.notEqual(one.toJSON().session.runs[0]?.threadId, two.toJSON().session.runs[0]?.threadId);
    assert.equal(one.frames().length, 2);
    assert.equal(two.frames().length, 2);
    assert.deepEqual(served.headers.map((headers) => headers['x-who']).sort(), ['one', 'two']);
    one.close();
    two.close();
  } finally {
    await served.close();
  }
});

test('with a fixed clock and identifiers, the same scripted run gives the same file', async () => {
  await withAgent(async (_server, agent) => {
    const files: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const session = await openSession({ target: agent, ...fixed() });
      await session.send('hello');
      files.push(JSON.stringify(session.toJSON()));
      session.close();
    }
    assert.equal(files[0], files[1]);
  });
});

test('a non-2xx answer resolves with the error and keeps the exchange', async () => {
  await withAgent(async (server, agent) => {
    server.fail('/agent', 500);
    const session = await openSession({ target: agent });
    const step = await session.send('hello');
    assert.match(step.error ?? '', /500/);
    assert.equal(session.exchanges()[0]?.status, 500);
    session.close();
  });
});

test('the header reaches the target and nothing the session returns or writes holds it', async () => {
  await withAgent(async (_server, agent) => {
    const requested: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      requested.push(String(input));
      return real(input, init);
    };
    try {
      const session = await openSession({ target: agent, headers: { authorization: `Bearer ${SECRET}` } });
      const steps = [await session.send(SCENARIOS.interrupt), await session.answerInterrupt('i-approve', 'resolved', { approved: true }), await session.answerInterrupt('i-contact', 'resolved', 'Ada')];
      const file = path.join(tempDir(), 'session.json');
      await session.save(file);
      const everything = JSON.stringify([steps, session.frames(), session.exchanges(), session.findings(), session.conversation(), session.pending(), session.surfaces(), session.state(), session.toJSON()]) + readFileSync(file, 'utf8');
      assert.doesNotMatch(everything, new RegExp(SECRET));
      assert.ok(requested.length >= 2 && requested.every((url) => url.startsWith(new URL(agent).origin)), 'every request went to the target');
      session.close();
    } finally {
      globalThis.fetch = real;
    }
  });
});

test('save writes a session file the page can import, and refuses to replace a file unless asked', async () => {
  await withAgent(async (_server, agent) => {
    const session = await openSession({ target: agent });
    await session.send('hello');
    const file = path.join(tempDir(), 'session.json');
    await session.save(file);
    const parsed = parseSession(readFileSync(file, 'utf8'));
    assert.ok(parsed.ok);
    assert.equal(parsed.session.frames.length, session.frames().length);
    writeFileSync(file, 'keep');
    await assert.rejects(session.save(file), /exists/);
    assert.equal(readFileSync(file, 'utf8'), 'keep');
    await session.save(file, { overwrite: true });
    assert.ok(parseSession(readFileSync(file, 'utf8')).ok);
    assert.ok(existsSync(file));
    session.close();
  });
});

test('findings of a damaged stream come back with their rule ids, and the frames are kept as received', async () => {
  await withAgent(async (server, agent) => {
    const session = await openSession({ target: agent });
    const step = await session.send(SCENARIOS.broken);
    assert.ok(step.newFindings.length > 0);
    assert.ok(session.findings().every((finding) => typeof finding.rule === 'string'));
    assert.ok(session.frames().some((frame) => frame.data === '{not json at all'));
    const written = new TextDecoder().decode(server.sent()[0]);
    for (const frame of session.frames()) assert.ok(written.includes(frame.data ?? '\u0000'));
    session.close();
  });
});
