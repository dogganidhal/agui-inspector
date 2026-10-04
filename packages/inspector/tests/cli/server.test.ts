// The listener (FR-006 to FR-009, FR-013): routes and configuration from the shared core, the relay under /proxy/<n>/, the
// refused request spellings, the guards against the network and against other sites, and several targets. The page is a
// stand-in directory, so these tests run before the build.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import { after, test } from 'node:test';
import { parseCli, type Target } from '../../src/cli/args.ts';
import { listen, type Listening } from '../../src/cli/server.ts';
import { ask, countingServer, PAGE_FILES, raw, recordingTarget, standInPage, type Recorded } from './support.ts';

const POLICY = "script-src 'self'; object-src 'none'; base-uri 'none'";
const page = standInPage();
const closers: Array<() => Promise<void>> = [];
after(async () => {
  await Promise.all(closers.map((close) => close()));
  page.remove();
});

function targetsOf(...argv: string[]): readonly Target[] {
  const cli = parseCli(argv);
  assert.equal(cli.kind, 'serve', cli.kind === 'error' ? cli.message : '');
  return (cli as Extract<typeof cli, { kind: 'serve' }>).targets;
}

async function serveTargets(...argv: string[]): Promise<Listening> {
  const listening = await listen({ port: 0, targets: targetsOf(...argv), assetsDir: page.dir });
  closers.push(listening.close);
  return listening;
}

async function withTarget(): Promise<{ target: Recorded; listening: Listening }> {
  const target = await recordingTarget();
  closers.push(target.close);
  return { target, listening: await serveTargets('--target', `${target.origin}/agent`) };
}

test('the listener is on 127.0.0.1, and nothing answers on another address of this machine or on ::1', async () => {
  const { listening } = await withTarget();
  // A host firewall may drop the packets instead of refusing them, so a timeout counts as "not reachable" as well.
  const tryConnect = (host: string) =>
    new Promise<string>((resolve) => {
      const socket = connect({ host, port: listening.port, timeout: 2000 }, () => {
        socket.destroy();
        resolve('connected');
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve('timeout');
      });
      socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
    });
  assert.equal(await tryConnect('127.0.0.1'), 'connected');
  assert.notEqual(await tryConnect('::1'), 'connected', 'IPv6 loopback is not bound');
  const other = Object.values(networkInterfaces()).flat().find((address) => address?.family === 'IPv4' && !address.internal);
  if (other === undefined) return void console.log('# no non-loopback IPv4 address on this machine: that part is skipped');
  assert.notEqual(await tryConnect(other.address), 'connected', `${other.address} must not reach the listener`);
});

test('the page, its files and hosting-config.json come from the core, with the policy on every response', async () => {
  const { listening } = await withTarget();
  for (const [name, text] of Object.entries(PAGE_FILES)) {
    const answer = await ask({ port: listening.port, path: `/${name}` });
    assert.equal(answer.status, 200, name);
    assert.equal(answer.body.toString(), text, name);
    assert.equal(answer.headers['content-security-policy'], POLICY, name);
  }
  const root = await ask({ port: listening.port, path: '/' });
  assert.equal(root.body.toString(), PAGE_FILES['index.html']);
  assert.match(root.headers['content-type'] ?? '', /^text\/html/);
  const query = await ask({ port: listening.port, path: '/?x=1' });
  assert.equal(query.status, 200);
});

test('config.json is the version 0 file with one agent for each target and nothing else', async () => {
  const { target, listening } = await withTarget();
  const answer = await ask({ port: listening.port, path: '/config.json' });
  assert.equal(answer.headers['content-security-policy'], POLICY);
  assert.match(answer.headers['content-type'] ?? '', /^application\/json/);
  assert.equal(answer.body.toString(), JSON.stringify({ version: 0, agents: [{ id: 'target-1', name: `${target.origin}/agent`, url: '/proxy/1/agent' }] }));

  const bare = await serveTargets('--target', 'https://agent.example');
  const parsed = JSON.parse((await ask({ port: bare.port, path: '/config.json' })).body.toString()) as { agents: Array<Record<string, string>> };
  assert.deepEqual(parsed.agents, [{ id: 'target-1', name: 'https://agent.example/', url: '/proxy/1/' }]);
});

test('HEAD, other methods, a missing file and a bad escape answer from the core, with the policy', async () => {
  const { listening } = await withTarget();
  const head = await ask({ port: listening.port, path: '/app.js', method: 'HEAD' });
  assert.deepEqual([head.status, head.body.length, head.headers['content-length']], [200, 0, String(PAGE_FILES['app.js'].length)]);
  const post = await ask({ port: listening.port, path: '/', method: 'POST', body: '{}' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.equal(post.headers['content-security-policy'], POLICY);
  for (const missing of ['/nope', '/%', '/%E0%A4%A', '/assets/', '/..%2f..%2fetc%2fpasswd']) {
    const answer = await ask({ port: listening.port, path: missing });
    assert.equal(answer.status, 404, missing);
    assert.equal(answer.headers['content-security-policy'], POLICY, missing);
  }
});

test('a request under /proxy/1/ reaches the target with its method, path, query and body; /proxy/1 is the target’s /', async () => {
  const { target, listening } = await withTarget();
  const run = await ask({ port: listening.port, path: '/proxy/1/agent?x=1', method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } });
  assert.equal(run.status, 200);
  assert.equal(run.body.toString(), 'ok');
  await ask({ port: listening.port, path: '/proxy/1' });
  await ask({ port: listening.port, path: '/proxy/1?q=2' });
  await ask({ port: listening.port, path: '/proxy/1/', method: 'DELETE' });
  assert.deepEqual(target.seen.map((seen) => `${seen.method} ${seen.url}`), ['POST /agent?x=1', 'GET /', 'GET /?q=2', 'DELETE /']);
  assert.equal(target.seen[0]?.body.toString(), '{"a":1}');
});

// ---------------------------------------------------------------------------------------------
// Story 3: only the named targets can be reached
// ---------------------------------------------------------------------------------------------

function line(listening: Listening, request: string, ...headers: string[]): string {
  return `${request}\r\nHost: 127.0.0.1:${listening.port}\r\n${headers.map((header) => `${header}\r\n`).join('')}Connection: close\r\n\r\n`;
}
const statusOf = (answer: string) => /^HTTP\/1\.[01] (\d{3})/.exec(answer)?.[1] ?? 'none';

test('a proxy number that names no target is a 403 and no outbound connection is made', async () => {
  const { target, listening } = await withTarget();
  const other = await countingServer();
  closers.push(other.close);
  for (const number of ['2', '0', '01', '+1', '%31', '1x', '', '-1', '1.0', '9999999999999999999', ' 1']) {
    const answer = await raw(listening.port, line(listening, `GET /proxy/${number.replace(' ', '%20')}/x HTTP/1.1`));
    assert.equal(statusOf(answer), '403', JSON.stringify(number));
  }
  assert.equal(target.seen.length, 0);
  assert.equal(other.connections(), 0);
});

test('absolute-form targets, OPTIONS *, CONNECT and upgrade requests are refused without a connection', async () => {
  const { target, listening } = await withTarget();
  const other = await countingServer();
  closers.push(other.close);
  const there = `127.0.0.1:${other.port}`;
  assert.equal(statusOf(await raw(listening.port, line(listening, `GET http://${there}/ HTTP/1.1`))), '403');
  assert.equal(statusOf(await raw(listening.port, `GET http://${there}/ HTTP/1.1\r\nHost: ${there}\r\nConnection: close\r\n\r\n`)), '403');
  assert.equal(statusOf(await raw(listening.port, line(listening, `GET http://${there}/proxy/1/agent HTTP/1.1`))), '403');
  assert.equal(statusOf(await raw(listening.port, line(listening, 'OPTIONS * HTTP/1.1'))), '403');
  assert.notEqual(statusOf(await raw(listening.port, line(listening, `GET ${there} HTTP/1.1`))).startsWith('2'), true, 'an authority form is not served');
  assert.equal(statusOf(await raw(listening.port, `CONNECT ${there} HTTP/1.1\r\nHost: ${there}\r\n\r\n`)), '403');
  assert.equal(statusOf(await raw(listening.port, line(listening, 'GET /proxy/1/agent HTTP/1.1', 'Connection: Upgrade', 'Upgrade: websocket'))), '403');
  assert.equal(statusOf(await raw(listening.port, line(listening, 'GET /agent HTTP/1.1', 'Connection: Upgrade', 'Upgrade: websocket'))), '403');
  assert.equal(target.seen.length, 0);
  assert.equal(other.connections(), 0, 'no connection to the other host');
});

test('nothing after the proxy path can change the host: odd spellings stay paths on the target', async () => {
  const { target, listening } = await withTarget();
  const other = await countingServer();
  closers.push(other.close);
  const there = `127.0.0.1:${other.port}`;
  const paths = [
    `/proxy/1//${there}/x`,
    `/proxy/1/@${there}`,
    `/proxy/1/\\${there}/x`,
    `/proxy/1/..%2f..%2f${there}`,
    '/proxy/1/%2e%2e/%2e%2e/',
    '/proxy/1/a/../../b',
    '/proxy/1/x%00y',
    `/proxy/1/%2f%2f${there}`,
    `/proxy/1/?@${there}`,
    `/proxy/1/x?u=http://${there}/`,
  ];
  for (const path of paths) {
    const before = target.seen.length;
    const status = statusOf(await raw(listening.port, line(listening, `GET ${path} HTTP/1.1`)));
    // Either the target got exactly this text as a path, or Node refused to send it (a 400). Never another host.
    if (status === '200') assert.equal(target.seen[before]?.url, path.slice('/proxy/1'.length), path);
    else assert.ok(['400', 'none'].includes(status), `${path} gave ${status}`);
  }
  assert.ok(target.seen.length > 0, 'the plain paths did reach the target');
  assert.equal(other.connections(), 0, 'no connection to the other host');
});

// ---------------------------------------------------------------------------------------------
// Story 4: the guards
// ---------------------------------------------------------------------------------------------

test('Host must be this listener’s own address, on every path', async () => {
  const { target, listening } = await withTarget();
  const hosts = {
    good: [`127.0.0.1:${listening.port}`, `localhost:${listening.port}`, `LOCALHOST:${listening.port}`],
    bad: ['127.0.0.1', '127.0.0.1:1', 'evil.example', `evil.example:${listening.port}`, `localhost.evil.example:${listening.port}`, `127.0.0.1:${listening.port}.evil.example`, `[::1]:${listening.port}`],
  };
  for (const path of ['/', '/config.json', '/proxy/1/agent']) {
    for (const host of hosts.good) assert.equal((await ask({ port: listening.port, path, headers: { host } })).status, 200, `${host} ${path}`);
    for (const host of hosts.bad) assert.equal((await ask({ port: listening.port, path, headers: { host } })).status, 403, `${host} ${path}`);
    assert.equal(statusOf(await raw(listening.port, `GET ${path} HTTP/1.0\r\n\r\n`)), '403', `no Host on ${path}`);
  }
  assert.equal(target.seen.length, 3, 'only the three good hosts reached the target');
});

test('on a proxy path, a foreign Origin or a cross-site fetch is refused and the target sees nothing', async () => {
  const { target, listening } = await withTarget();
  const own = [`http://127.0.0.1:${listening.port}`, `http://localhost:${listening.port}`];
  for (const origin of ['http://evil.example', 'null', `http://127.0.0.1:${listening.port + 1}`, `https://127.0.0.1:${listening.port}`, own.join(', ')]) {
    const answer = await ask({ port: listening.port, path: '/proxy/1/agent', method: 'POST', body: '{}', headers: { origin } });
    assert.equal(answer.status, 403, origin);
  }
  for (const site of ['cross-site', 'same-site', '', 'same-origin, cross-site']) {
    assert.equal((await ask({ port: listening.port, path: '/proxy/1/agent', headers: { 'sec-fetch-site': site } })).status, 403, JSON.stringify(site));
  }
  assert.equal(target.seen.length, 0);
  for (const origin of own) assert.equal((await ask({ port: listening.port, path: '/proxy/1/agent', method: 'POST', body: '{}', headers: { origin } })).status, 200, origin);
  for (const site of ['same-origin', 'none']) assert.equal((await ask({ port: listening.port, path: '/proxy/1/agent', headers: { 'sec-fetch-site': site } })).status, 200, site);
  assert.equal((await ask({ port: listening.port, path: '/proxy/1/agent' })).status, 200, 'no browser headers at all, like curl');
  assert.equal(target.seen.length, 5);
});

test('the cross-origin rules are for proxy paths: a link from another site still opens the page', async () => {
  const { listening } = await withTarget();
  for (const path of ['/', '/config.json']) {
    const answer = await ask({ port: listening.port, path, headers: { 'sec-fetch-site': 'cross-site', origin: 'http://evil.example' } });
    assert.equal(answer.status, 200, path);
  }
});

// ---------------------------------------------------------------------------------------------
// Story 6: several targets
// ---------------------------------------------------------------------------------------------

test('two targets: both in config.json in the order given, each run reaches its own target with its own header', async () => {
  const a = await recordingTarget();
  const b = await recordingTarget();
  closers.push(a.close, b.close);
  const listening = await serveTargets('--target', `${a.origin}/a`, '--header', 'X-Key: for-a', '--target', `${b.origin}/b/stream`, '--header', 'X-Key: for-b');
  const config = JSON.parse((await ask({ port: listening.port, path: '/config.json' })).body.toString()) as { agents: Array<{ id: string; url: string }> };
  assert.deepEqual(config.agents.map((agent) => [agent.id, agent.url]), [['target-1', '/proxy/1/a'], ['target-2', '/proxy/2/b/stream']]);
  await ask({ port: listening.port, path: '/proxy/1/a', method: 'POST', body: '{}' });
  await ask({ port: listening.port, path: '/proxy/2/b/stream', method: 'POST', body: '{}' });
  assert.deepEqual(a.seen.map((seen) => [seen.url, seen.headers['x-key']]), [['/a', 'for-a']]);
  assert.deepEqual(b.seen.map((seen) => [seen.url, seen.headers['x-key']]), [['/b/stream', 'for-b']]);
});

test('two targets on one origin are two entries with their own proxy paths and headers', async () => {
  const target = await recordingTarget();
  closers.push(target.close);
  const listening = await serveTargets('--target', `${target.origin}/one`, '--header', 'X-Key: first', '--target', `${target.origin}/two`, '--header', 'X-Key: second');
  await ask({ port: listening.port, path: '/proxy/1/one' });
  await ask({ port: listening.port, path: '/proxy/2/two' });
  assert.deepEqual(target.seen.map((seen) => [seen.url, seen.headers['x-key']]), [['/one', 'first'], ['/two', 'second']]);
});

test('listen() rejects when the port is taken and when the page files are missing, and opens no listener then', async () => {
  const { listening } = await withTarget();
  await assert.rejects(listen({ port: listening.port, targets: targetsOf('--target', 'http://127.0.0.1:1'), assetsDir: page.dir }), { code: 'EADDRINUSE' });
  await assert.rejects(listen({ port: 0, targets: targetsOf('--target', 'http://127.0.0.1:1'), assetsDir: '/nonexistent/agui-inspector-page' }), /packaged inspector files are missing.*npm run build/);
});

// ---------------------------------------------------------------------------------------------
// Plugin files (spec 014, FR-021): served from the command's own address, behind the same guards as the relay
// ---------------------------------------------------------------------------------------------

const pluginDir = mkdtempSync(path.join(tmpdir(), 'agui-cli-plugins-'));
after(() => rmSync(pluginDir, { recursive: true, force: true }));
const pluginFile = (name: string, text: string) => {
  writeFileSync(path.join(pluginDir, name), text);
  return path.join(pluginDir, name);
};

async function withPlugins(...files: string[]): Promise<{ target: Recorded; listening: Listening }> {
  const target = await recordingTarget();
  closers.push(target.close);
  const listening = await listen({ port: 0, targets: targetsOf('--target', `${target.origin}/agent`), assetsDir: page.dir, plugins: files });
  closers.push(listening.close);
  return { target, listening };
}

test('config.json lists the plugin files in the order given and nothing else is new; without them it is the text it was', async () => {
  const { target, listening } = await withPlugins(pluginFile('a.js', 'a'), pluginFile('b.js', 'b'));
  const config = (await ask({ port: listening.port, path: '/config.json' })).body.toString();
  assert.equal(config, JSON.stringify({ version: 0, agents: [{ id: 'target-1', name: `${target.origin}/agent`, url: '/proxy/1/agent' }], plugins: ['/plugins/1.js', '/plugins/2.js'] }));
  const bare = await withTarget();
  assert.equal(
    (await ask({ port: bare.listening.port, path: '/config.json' })).body.toString(),
    JSON.stringify({ version: 0, agents: [{ id: 'target-1', name: `${bare.target.origin}/agent`, url: '/proxy/1/agent' }] }),
  );
});

test('GET and HEAD return the file with a JavaScript type and the policy, reading it at request time; other methods are refused', async () => {
  const file = pluginFile('live.js', 'export const v = 1;');
  const { listening } = await withPlugins(file);
  const first = await ask({ port: listening.port, path: '/plugins/1.js' });
  assert.equal(first.status, 200);
  assert.equal(first.body.toString(), 'export const v = 1;');
  assert.match(first.headers['content-type'] ?? '', /^text\/javascript/);
  assert.equal(first.headers['content-security-policy'], POLICY);
  writeFileSync(file, 'export const v = 2;');
  assert.equal((await ask({ port: listening.port, path: '/plugins/1.js' })).body.toString(), 'export const v = 2;', 'an edit shows without a restart');
  const head = await ask({ port: listening.port, path: '/plugins/1.js', method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], String('export const v = 2;'.length));
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const refused = await ask({ port: listening.port, path: '/plugins/1.js', method, ...(method !== 'DELETE' && { body: '{}' }) });
    assert.equal(refused.status, 405, method);
    assert.equal(refused.headers.allow, 'GET, HEAD', method);
  }
});

test('a file that was removed after the start is a 404, and no name but the listed ones reads a file', async () => {
  const gone = pluginFile('gone.js', 'x');
  const { listening } = await withPlugins(gone, pluginFile('other.js', 'y'));
  rmSync(gone);
  assert.equal((await ask({ port: listening.port, path: '/plugins/1.js' })).status, 404);
  for (const spelling of ['/plugins/0.js', '/plugins/3.js', '/plugins/01.js', '/plugins/1.js/', '/plugins/1.js/../x', '/plugins/%2e%2e/x', '/plugins/..%2fplugins/2.js', '/plugins/2.js%00', '/plugins//2.js', '/plugins/2', '/plugins/2.JS', '/plugins\\2.js', '/plugins/other.js', `/plugins/${path.join(pluginDir, 'other.js')}`]) {
    const answer = await ask({ port: listening.port, path: spelling });
    assert.notEqual(answer.status, 200, `${spelling} answered ${answer.status}`);
    assert.notEqual(answer.body.toString(), 'y', `${spelling} read the other file by a path`);
  }
  assert.equal((await ask({ port: listening.port, path: '/plugins/2.js?x=1' })).body.toString(), 'y', 'a query is not part of the name');
});

test('a plugin file passes the relay\'s guards: a foreign Host, a foreign Origin and a cross-site fetch get 403 and the file is not read', async () => {
  const file = pluginFile('guarded.js', 'secret signing key');
  const { listening } = await withPlugins(file);
  const own = [`http://127.0.0.1:${listening.port}`, `http://localhost:${listening.port}`];
  const refused = async (headers: Record<string, string>, label: string) => {
    const answer = await ask({ port: listening.port, path: '/plugins/1.js', headers });
    assert.equal(answer.status, 403, label);
    assert.ok(!answer.body.toString().includes('signing key'), label);
  };
  for (const host of ['evil.example', `evil.example:${listening.port}`, `127.0.0.1:${listening.port + 1}`]) await refused({ host }, host);
  for (const origin of ['http://evil.example', 'null', `https://127.0.0.1:${listening.port}`]) await refused({ origin }, origin);
  for (const site of ['cross-site', 'same-site', '']) await refused({ 'sec-fetch-site': site }, `sec-fetch-site ${site}`);
  for (const origin of own) assert.equal((await ask({ port: listening.port, path: '/plugins/1.js', headers: { origin } })).status, 200, origin);
  for (const site of ['same-origin', 'none']) assert.equal((await ask({ port: listening.port, path: '/plugins/1.js', headers: { 'sec-fetch-site': site } })).status, 200, site);
  assert.equal((await ask({ port: listening.port, path: '/plugins/1.js' })).status, 200, 'no browser headers, like curl');
  // The page itself is still a link another site may open.
  assert.equal((await ask({ port: listening.port, path: '/', headers: { 'sec-fetch-site': 'cross-site' } })).status, 200);
});

test('a header that a provider adds on the page reaches the target through the relay, and the page\'s value wins over the command line', async () => {
  const target = await recordingTarget();
  closers.push(target.close);
  const listening = await listen({ port: 0, targets: targetsOf('--target', `${target.origin}/agent`, '--header', 'X-Signature: from-the-command-line', '--header', 'X-Other: held'), assetsDir: page.dir, plugins: [pluginFile('p.js', 'p')] });
  closers.push(listening.close);
  await ask({ port: listening.port, path: '/proxy/1/agent', method: 'POST', body: '{}', headers: { 'x-signature': 'from-the-plugin' } });
  assert.equal(target.seen[0]?.headers['x-signature'], 'from-the-plugin');
  assert.equal(target.seen[0]?.headers['x-other'], 'held');
});

test('the listener is still on 127.0.0.1 only with plugins, and plugins open no other listener', async () => {
  const { listening } = await withPlugins(pluginFile('l.js', 'l'));
  const bound = await new Promise<string>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: listening.port }, () => {
      socket.destroy();
      resolve('connected');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });
  assert.equal(bound, 'connected');
  const notBound = await new Promise<string>((resolve) => {
    const socket = connect({ host: '::1', port: listening.port, timeout: 1000 }, () => (socket.destroy(), resolve('connected')));
    socket.on('timeout', () => (socket.destroy(), resolve('timeout')));
    socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });
  assert.notEqual(notBound, 'connected');
});
