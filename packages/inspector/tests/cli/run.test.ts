// The command as a function (FR-006, FR-015 to FR-019): what it prints and where, its exit codes, and how it stops.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { run } from '../../src/cli/run.ts';
import { USAGE } from '../../src/cli/args.ts';
import { ask, closedPort, recordingTarget, sleep, standInPage, start, within } from './support.ts';

const SECRET = 'synthetic-secret-77ab10';
const page = standInPage();
const closers: Array<() => Promise<void>> = [];
after(async () => {
  await Promise.all(closers.map((close) => close()));
  page.remove();
});

interface Session {
  readonly out: () => string;
  readonly err: () => string;
  readonly stop: () => void;
  readonly done: Promise<number>;
}

/** Starts `run()` with captured output. It keeps serving until `stop()`. */
function begin(argv: string[], options: { assetsDir?: string } = { assetsDir: page.dir }): Session {
  let out = '';
  let err = '';
  const controller = new AbortController();
  const done = run(argv, { out: (text) => (out += text), err: (text) => (err += text), stop: controller.signal }, { version: '9.8.7', ...options });
  return { out: () => out, err: () => err, stop: () => controller.abort(), done };
}

async function listening(session: Session): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = /listening on http:\/\/127\.0\.0\.1:(\d+)\//.exec(session.out())?.[1];
    if (port !== undefined) return Number(port);
    await sleep(10);
  }
  throw new Error(`the command never printed its address; stderr: ${session.err()}`);
}

async function finished(argv: string[], options?: { assetsDir?: string }) {
  const session = begin(argv, options);
  const code = await session.done;
  return { code, out: session.out(), err: session.err() };
}

test('--help prints the usage to standard output and returns 0 with nothing on standard error', async () => {
  assert.deepEqual(await finished(['--help']), { code: 0, out: USAGE, err: '' });
});

test('--version prints the version and returns 0', async () => {
  assert.deepEqual(await finished(['--version']), { code: 0, out: '9.8.7\n', err: '' });
});

test('wrong arguments print one message and a pointer to standard error and return 2, with nothing on standard output', async () => {
  const pointer = 'Run agui-inspector --help for the options.\n';
  assert.deepEqual(await finished([]), { code: 2, out: '', err: `agui-inspector: --target is required\n${pointer}` });
  assert.deepEqual(await finished(['replay']), { code: 2, out: '', err: `agui-inspector: unknown command "replay"\n${pointer}` });
  assert.deepEqual(await finished(['--target', 'http://a.example', '--port', 'x']), { code: 2, out: '', err: `agui-inspector: --port must be a whole number from 0 to 65535\n${pointer}` });
  const withSecret = await finished(['--target', `http://u:${SECRET}@a.example/?t=${SECRET}`, '--header', `Host: ${SECRET}`]);
  assert.equal(withSecret.code, 2);
  assert.ok(!withSecret.err.includes(SECRET) && !withSecret.out.includes(SECRET));
});

test('a port that is taken returns 1 and names the port; no other port is tried', async () => {
  const holder = await start(() => {});
  closers.push(holder.close);
  const result = await finished(['--target', 'http://127.0.0.1:1/agent', '--port', String(holder.port)]);
  assert.deepEqual(result, { code: 1, out: '', err: `agui-inspector: port ${holder.port} is already in use; choose another with --port\n` });
});

test('missing page files return 1 with the core’s message, which names the build', async () => {
  const result = await finished(['--target', 'http://127.0.0.1:1/agent', '--port', '0'], { assetsDir: '/nonexistent/agui-inspector-page' });
  assert.equal(result.code, 1);
  assert.equal(result.out, '');
  assert.match(result.err, /^agui-inspector: the packaged inspector files are missing; build them with 'npm run build'\n$/);
});

test('a target at the command’s own address is refused with 2 after the bind, and the listener is gone', async () => {
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    const port = await closedPort();
    const result = await finished(['--target', `http://${host}:${port}/agent`, '--port', String(port)]);
    assert.equal(result.code, 2, host);
    assert.match(result.err, /^agui-inspector: --target points at this command's own address\nRun agui-inspector --help/, host);
    assert.equal(result.out, '', host);
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port }, () => resolve(true));
      socket.on('error', () => resolve(false));
      socket.on('connect', () => socket.destroy());
    });
    assert.equal(reachable, false, `${host}: the listener is closed`);
  }
});

test('a normal run prints the address and one line for each target with the names of its headers, never a value', async () => {
  const target = await recordingTarget();
  closers.push(target.close);
  const session = begin(['--target', `${target.origin}/agent`, '--header', `Authorization: Bearer ${SECRET}`, '--header', 'X-Key: k', '--target', 'https://agent.example', '--port', '0']);
  const port = await listening(session);
  assert.equal(
    session.out(),
    `agui-inspector listening on http://127.0.0.1:${port}/\n  /proxy/1 -> ${target.origin} (headers: Authorization, X-Key)\n  /proxy/2 -> https://agent.example\n`,
  );
  assert.equal(session.err(), '');
  await ask({ port, path: '/proxy/1/agent', method: 'POST', body: '{}' });
  assert.equal(target.seen[0]?.headers.authorization, `Bearer ${SECRET}`, 'the target gets the value');
  session.stop();
  assert.equal(await session.done, 0);
  assert.ok(!session.out().includes(SECRET) && !session.err().includes(SECRET));
  assert.equal(session.err(), '', 'a request leaves no log line');
});

test('a failure to reach a target is one line on standard error with the origin and the code', async () => {
  const dead = await closedPort();
  const session = begin(['--target', `http://127.0.0.1:${dead}/agent`, '--header', `X-Key: ${SECRET}`, '--port', '0']);
  const port = await listening(session);
  const answer = await ask({ port, path: `/proxy/1/agent?token=${SECRET}`, method: 'POST', body: '{}' });
  assert.equal(answer.status, 502);
  assert.equal(session.err(), `agui-inspector: could not reach http://127.0.0.1:${dead} (ECONNREFUSED)\n`);
  session.stop();
  await session.done;
  assert.ok(!session.err().includes(SECRET) && !session.out().includes(SECRET));
});

test('stopping while a relay is in progress closes it and returns 0', { timeout: 15_000 }, async () => {
  let held!: () => void;
  const targetClosed = new Promise<void>((resolve) => (held = resolve));
  const target = await recordingTarget((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: first\n\n');
    response.on('close', held);
    return new Promise<void>(() => {});
  });
  closers.push(target.close);
  const session = begin(['--target', `${target.origin}/agent`, '--port', '0']);
  const port = await listening(session);
  const reading = ask({ port, path: '/proxy/1/agent' });
  await sleep(150);
  session.stop();
  assert.equal(await session.done, 0);
  const answer = await reading;
  assert.equal(answer.complete, false, 'the page sees the stream end as a failure');
  assert.equal(await within(targetClosed, 1000), true, 'the target saw its connection end');
});

// --plugin (spec 014, FR-021): checked before the command listens, served at /plugins/<n>.js, and never printed.

test('a --plugin that is missing, a directory or unreadable stops the command before it listens with 2 and a message that names --plugin', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-cli-plugin-'));
  closers.push(async () => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'folder'));
  for (const file of [path.join(dir, 'missing.js'), path.join(dir, 'folder'), dir]) {
    const result = await finished(['--target', 'http://127.0.0.1:1/agent', '--plugin', file, '--port', '0']);
    assert.equal(result.code, 2, file);
    assert.equal(result.out, '', 'nothing was printed, so nothing listened');
    assert.equal(result.err, 'agui-inspector: --plugin must name a file that can be read\nRun agui-inspector --help for the options.\n', file);
    assert.ok(!result.err.includes(dir), 'the message does not echo the value');
  }
});

test('a plugin file is served at /plugins/<n>.js and listed in config.json, and the startup output names no plugin', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-cli-plugin-'));
  closers.push(async () => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'sign.js'), 'export default () => {};');
  const target = await recordingTarget();
  closers.push(target.close);
  const session = begin(['--plugin', path.join(dir, 'sign.js'), '--target', `${target.origin}/agent`, '--port', '0']);
  const port = await listening(session);
  assert.equal(session.out(), `agui-inspector listening on http://127.0.0.1:${port}/\n  /proxy/1 -> ${target.origin}\n`);
  const config = JSON.parse((await ask({ port, path: '/config.json' })).body.toString()) as { plugins: string[] };
  assert.deepEqual(config.plugins, ['/plugins/1.js']);
  const file = await ask({ port, path: '/plugins/1.js' });
  assert.equal(file.status, 200);
  assert.equal(file.body.toString(), 'export default () => {};');
  assert.match(file.headers['content-type'] ?? '', /^text\/javascript/);
  session.stop();
  assert.equal(await session.done, 0);
});
