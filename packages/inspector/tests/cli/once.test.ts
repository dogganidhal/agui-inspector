// Feature 018, T017: `agui-inspector run` as a function (contracts/run-command.md): output, warning, exit codes, headers.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { INTERRUPT_FOREVER, SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';
import { EXPORT_WARNING } from '../../src/cli/once.ts';
import { run } from '../../src/cli/run.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { parseSession } from '../../src/core/session-files/index.ts';
import { serve, tempDir, withAgent } from '../headless/support.ts';

const SECRET = 'synthetic-header-018';

async function command(argv: string[], stdin = '') {
  let out = '';
  let err = '';
  const code = await run(argv, { out: (text) => (out += text), err: (text) => (err += text), stop: new AbortController().signal, stdin: async () => stdin });
  return { code, out, err };
}

const summary = (err: string) => err.trimEnd().split('\n').at(-1) ?? '';

test('a clean run exits 0 and prints the session file, then the export warning and a summary on standard error', async () => {
  await withAgent(async (_server, agent) => {
    const { code, out, err } = await command(['run', '--target', agent, '--message', 'hello']);
    assert.equal(code, 0, err);
    const parsed = parseSession(out);
    assert.ok(parsed.ok);
    assert.ok(parsed.session.frames.length > 2);
    assert.equal(err, `agui-inspector: ${EXPORT_WARNING}\n${parsed.session.frames.length} frames, 0 findings\n`);
  });
});

test('a run with findings exits 3', async () => {
  await withAgent(async (_server, agent) => {
    const { code, err } = await command(['run', '--target', agent, '--message', SCENARIOS.broken]);
    assert.equal(code, 3);
    assert.match(summary(err), /^\d+ frames, [1-9]\d* findings$/);
  });
});

test('an unreachable target, a 500 and the time limit exit 1 and still write the file', async () => {
  const dir = tempDir();
  const closed = await serve(() => {});
  const gone = closed.agent;
  await closed.close();
  const unreachable = await command(['run', '--target', gone, '--message', 'hello', '--out', path.join(dir, 'a.json')]);
  assert.equal(unreachable.code, 1);
  assert.ok(parseSession(readFileSync(path.join(dir, 'a.json'), 'utf8')).ok);
  assert.match(unreachable.err, /could not complete/i);

  await withAgent(async (server, agent) => {
    server.fail('/agent', 500);
    const failed = await command(['run', '--target', agent, '--message', 'hello', '--out', path.join(dir, 'b.json')]);
    assert.equal(failed.code, 1);
    server.clear();
    const slow = await command(['run', '--target', agent, '--message', SCENARIOS.neverFinishes, '--timeout', '1', '--out', path.join(dir, 'c.json')]);
    assert.equal(slow.code, 1);
    assert.match(summary(slow.err), /, timed out$/);
    assert.ok(parseSession(readFileSync(path.join(dir, 'c.json'), 'utf8')).ok);
  });
});

test('wrong arguments exit 2 and write nothing', async () => {
  const { code, out, err } = await command(['run', '--message', 'hello']);
  assert.equal(code, 2);
  assert.equal(out, '');
  assert.match(err, /--target is required/);
  assert.doesNotMatch(err, /may contain personal/);
});

test('--input - sends standard input unchanged when it is JSON, and refuses text that is not JSON', async () => {
  const served = await serve((_input, _request, response) => response.writeHead(422).end());
  try {
    const raw = '{ "threadId": 1,  "extra": true }';
    const sent = await command(['run', '--target', served.agent, '--input', '-'], raw);
    assert.equal(sent.code, 1, 'a 422 is a run that could not complete');
    assert.deepEqual(served.inputs, [{ threadId: 1, extra: true }]);
    const file = path.join(tempDir(), 'input.json');
    writeFileSync(file, raw);
    await command(['run', '--target', served.agent, '--input', file]);
    assert.equal(served.inputs.length, 2);
    const refused = await command(['run', '--target', served.agent, '--input', '-'], '{"threadId": 1');
    assert.equal(refused.code, 2);
    assert.match(refused.err, /--input must be JSON/);
    assert.equal(served.inputs.length, 2);
    const missing = await command(['run', '--target', served.agent, '--input', path.join(tempDir(), 'none.json')]);
    assert.equal(missing.code, 2);
  } finally {
    await served.close();
  }
});

test('--out to an existing file without --force exits 2 and leaves it; with --force it is replaced', async () => {
  await withAgent(async (server, agent) => {
    const file = path.join(tempDir(), 'session.json');
    writeFileSync(file, 'keep');
    const refused = await command(['run', '--target', agent, '--message', 'hello', '--out', file]);
    assert.equal(refused.code, 2);
    assert.equal(readFileSync(file, 'utf8'), 'keep');
    assert.equal(server.requests().length, 0, 'nothing was sent');
    const replaced = await command(['run', '--target', agent, '--message', 'hello', '--out', file, '--force']);
    assert.equal(replaced.code, 0);
    assert.equal(replaced.out, '', 'the file went to --out');
    assert.ok(parseSession(readFileSync(file, 'utf8')).ok);
    assert.match(replaced.err, /may contain personal or sensitive data/);
  });
});

test('a header reaches the target and appears nowhere the command writes', async () => {
  const served = await serve((input, _request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId })}\n\ndata: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId })}\n\n`);
  });
  const bystander = await serve(() => {});
  try {
    const file = path.join(tempDir(), 'session.json');
    const toFile = await command(['run', '--target', served.agent, '--header', `x-test: ${SECRET}`, '--message', 'hi', '--out', file]);
    const toOut = await command(['run', '--target', served.agent, '--header', `x-test: ${SECRET}`, '--message', 'hi']);
    assert.equal(toFile.code, 0, toFile.err);
    assert.equal(served.headers[0]?.['x-test'], SECRET);
    for (const text of [toFile.out, toFile.err, toOut.out, toOut.err, readFileSync(file, 'utf8')]) assert.ok(!text.includes(SECRET));
    assert.equal(bystander.headers.length, 0, 'no request went anywhere but the target');
  } finally {
    await served.close();
    await bystander.close();
  }
});

test('--profile answers the interrupt scenario with automatic replies', async () => {
  await withAgent(async (_server, agent) => {
    const file = path.join(tempDir(), 'profile.json');
    writeFileSync(file, JSON.stringify({ version: 0, profile: { ...defaultProfile(), interruptReply: 'resolve', interruptPayloads: { input: 'yes' } } }));
    const { code, out } = await command(['run', '--target', agent, '--profile', file, '--message', INTERRUPT_FOREVER]);
    assert.equal(code, 0);
    const parsed = parseSession(out);
    assert.ok(parsed.ok && parsed.session.runs.length > 2);
    const bad = await command(['run', '--target', agent, '--profile', path.join(tempDir(), 'none.json'), '--message', 'hi']);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /--profile must name a valid profile file/);
    assert.ok(!existsSync(path.join(tempDir(), 'none.json')));
  });
});

test('nothing but the command\'s own lines reaches standard error, even when the client fails a run', async () => {
  await withAgent(async (_server, agent) => {
    const { err } = await command(['run', '--target', agent, '--message', SCENARIOS.broken]);
    assert.doesNotMatch(err, /Agent execution failed/);
    assert.equal(err.split('\n').filter(Boolean).length, 2);
  });
});
