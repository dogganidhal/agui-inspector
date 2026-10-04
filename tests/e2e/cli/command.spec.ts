// Feature 005 (US3 to US7; FR-001, FR-006, FR-013 to FR-019; SC-005 to SC-007): the shipped command as a process. Exit codes,
// output, signals, the loopback bind, HTTPS targets, and a search for a synthetic header value in everything the command
// writes or serves. No browser. Run `npm run build` first.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer, connect, type AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { USAGE } from '../../../packages/inspector/src/cli/args.ts';
import { expect, referenceReply, root, runCommand, sleep, startCommand, startTarget, test } from './support.ts';

const pkg = JSON.parse(readFileSync(path.join(root, 'packages', 'inspector', 'package.json'), 'utf8')) as { version: string };
const dist = path.join(root, 'packages', 'inspector', 'dist');
const POINTER = 'Run agui-inspector --help for the options.';

test('the package ships the command: the bin target starts with the node shebang, and the packed tarball serves the page', async ({ later }) => {
  const manifest = JSON.parse(readFileSync(path.join(root, 'packages', 'inspector', 'package.json'), 'utf8')) as { bin: Record<string, string> };
  expect(manifest.bin).toEqual({ 'agui-inspector': './lib/cli/main.js' });
  expect(readFileSync(path.join(root, 'packages', 'inspector', manifest.bin['agui-inspector'] as string), 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');

  // What `npx agui-inspector` runs: the files of the tarball, unpacked where no workspace link or source is near.
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-cli-pack-'));
  later(() => rmSync(dir, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--workspace', 'packages/inspector', '--pack-destination', dir, '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as unknown;
  const [first] = (Array.isArray(packed) ? packed : Object.values(packed as object)) as Array<{ filename: string; files: Array<{ path: string }> }>;
  const files = (first as { files: Array<{ path: string }> }).files.map((file) => file.path);
  for (const required of ['lib/cli/main.js', 'lib/cli/run.js', 'lib/cli/args.js', 'lib/cli/server.js', 'lib/cli/proxy.js', 'lib/server/core.js', 'lib/server/node.js', 'lib/static-path.js', 'dist/index.html']) {
    expect(files, required).toContain(required);
  }
  execFileSync('tar', ['-xzf', path.join(dir, (first as { filename: string }).filename), '-C', dir]);
  const installed = path.join(dir, 'package', 'lib', 'cli', 'main.js');
  const command = await startCommand(['--target', 'http://127.0.0.1:1/agent'], {}, installed);
  later(() => command.stop());
  const page = await fetch(`${command.origin}/`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<title>');
  expect(await (await fetch(`${command.origin}/config.json`)).json()).toEqual({ version: 0, agents: [{ id: 'target-1', name: 'http://127.0.0.1:1/agent', url: '/proxy/1/agent' }] });
});

test('--help and --version print to standard output and exit with 0', async () => {
  expect(await runCommand(['--help'])).toEqual({ code: 0, stdout: USAGE, stderr: '' });
  expect(await runCommand(['--version'])).toEqual({ code: 0, stdout: `${pkg.version}\n`, stderr: '' });
});

test('wrong arguments exit with 2, one message and a pointer on standard error, and nothing listens', async () => {
  const cases: Array<[string[], string]> = [
    [[], '--target is required'],
    [['replay'], 'unknown command "replay"'],
    [['replay', '--target', 'http://a.example'], 'unknown command "replay"'],
    [['--target', 'http://a.example', '--port', '99999'], '--port must be a whole number from 0 to 65535'],
    [['--target', 'http://a.example', '--host', '0.0.0.0'], 'unknown option "--host"'],
    [['--header', 'X-K: v', '--target', 'http://a.example'], '--header must come after the --target it belongs to'],
  ];
  for (const [args, message] of cases) {
    expect(await runCommand(args), args.join(' ')).toEqual({ code: 2, stdout: '', stderr: `agui-inspector: ${message}\n${POINTER}\n` });
  }
});

test('a port that is already in use exits with 1 and names the port', async ({ later }) => {
  const holder = createNetServer();
  await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
  later(() => new Promise((resolve) => holder.close(resolve)));
  const { port } = holder.address() as AddressInfo;
  expect(await runCommand(['--target', 'http://127.0.0.1:1/agent', '--port', String(port)])).toEqual({
    code: 1,
    stdout: '',
    stderr: `agui-inspector: port ${port} is already in use; choose another with --port\n`,
  });
});

test('a target at the command\u2019s own address exits with 2', async () => {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  const result = await runCommand(['--target', `http://localhost:${port}/agent`, '--port', String(port)]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain("--target points at this command's own address");
});

// ---------------------------------------------------------------------------------------------
// Story 4: the listener
// ---------------------------------------------------------------------------------------------

test('the listener is on 127.0.0.1 only: localhost works, a foreign Host is refused, and another address of this machine does not connect', async ({ later }) => {
  const target = await startTarget();
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);
  later(() => command.stop());
  expect(command.stdout()).toBe(`agui-inspector listening on http://127.0.0.1:${command.port}/\n  /proxy/1 -> ${target.origin}\n`);

  expect((await fetch(`http://localhost:${command.port}/config.json`)).status).toBe(200);
  // `fetch` refuses to set Host, so a raw socket sends the foreign one.
  const answer = await new Promise<string>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: command.port }, () => socket.write('GET /config.json HTTP/1.1\r\nHost: other.example\r\nConnection: close\r\n\r\n'));
    let text = '';
    socket.on('data', (chunk) => (text += String(chunk)));
    socket.on('close', () => resolve(text));
  });
  expect(answer.split('\r\n')[0]).toBe('HTTP/1.1 403 Forbidden');

  const other = Object.values(networkInterfaces()).flat().find((address) => address?.family === 'IPv4' && !address.internal);
  test.skip(other === undefined, 'this machine has no non-loopback IPv4 address to connect to');
  const outcome = await new Promise<string>((resolve) => {
    const socket = connect({ host: other?.address as string, port: command.port, timeout: 2000 }, () => {
      socket.destroy();
      resolve('connected');
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve('dropped');
    });
    socket.on('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
  });
  // Refused, or dropped by a host firewall: either way it is not reachable.
  expect(outcome).not.toBe('connected');
});

// ---------------------------------------------------------------------------------------------
// Story 5: a header value is in no output and no file
// ---------------------------------------------------------------------------------------------

test('a synthetic header value is in no served file, response, output or error, and the target receives it on every request', async ({ later }) => {
  const secret = `synthetic-${randomUUID()}`;
  const target = await startTarget();
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`, '--header', `X-Synthetic: ${secret}`, '--target', 'http://127.0.0.1:1/agent', '--header', `X-Other: ${secret}`]);
  later(() => command.stop());
  expect(command.stdout()).toContain('(headers: X-Synthetic)');

  const texts: string[] = [];
  for (const file of readdirSync(dist, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(html|js|css|json)$/.test(file)) continue;
    const response = await fetch(`${command.origin}/${file.split(path.sep).join('/')}`);
    expect(response.status, file).toBe(200);
    texts.push(await response.text());
  }
  for (const route of ['/', '/config.json', '/hosting-config.json', '/nope', '/proxy/9/agent']) texts.push(await (await fetch(`${command.origin}${route}`)).text());
  // Run the target, a refused request and a dead target (502): their bodies and the command's output.
  const run = (n: number) => fetch(`${command.origin}/proxy/${n}/agent`, { method: 'POST', body: JSON.stringify({ threadId: 't', runId: 'r' }) });
  const ok = await run(1);
  expect(ok.status).toBe(200);
  texts.push(await ok.text());
  const dead = await run(2);
  expect(dead.status).toBe(502);
  texts.push(await dead.text());
  await run(1);
  expect(target.seen.map((seen) => seen.headers['x-synthetic'])).toEqual([secret, secret]);

  expect(texts.length).toBeGreaterThan(8);
  for (const text of texts) expect(text).not.toContain(secret);
  expect(command.stdout()).not.toContain(secret);
  expect(command.stderr()).not.toContain(secret);
  expect(command.stderr()).toContain('could not reach http://127.0.0.1:1 (ECONNREFUSED)');
});

test('no usage error or startup failure prints a header value, a target\u2019s password or its query', async () => {
  const secret = `synthetic-${randomUUID()}`;
  const attempts = [
    ['--target', `http://user:${secret}@a.example/agent`],
    ['--target', `http://a.example/agent?token=${secret}`],
    ['--target', 'http://a.example', '--header', `Host: ${secret}`],
    ['--target', 'http://a.example', '--header', `Bad Name: ${secret}`],
    ['--target', 'http://a.example', '--header', `X-K: a\n${secret}`],
    ['--target', 'http://a.example', '--header', 'Authorization:', 'Bearer', secret],
    ['--header', `X-K: ${secret}`, '--target', 'http://a.example'],
    [`--bogus=${secret}`],
    [`--help=${secret}`],
    ['--target', 'http://a.example', '--port', secret],
  ];
  for (const args of attempts) {
    const { code, stdout, stderr } = await runCommand(args);
    expect(code, args.join(' ')).toBe(2);
    expect(stdout + stderr).not.toContain(secret);
  }
});

// ---------------------------------------------------------------------------------------------
// Story 7: signals
// ---------------------------------------------------------------------------------------------

test('SIGTERM while a relay is in progress ends it and exits with 0', async ({ later }) => {
  const target = await startTarget((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('data: first\n\n');
    return new Promise<void>(() => {});
  });
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);

  const response = await fetch(`${command.origin}/proxy/1/agent`, { method: 'POST', body: '{}' });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  expect((await reader.read()).done).toBe(false);
  const reading = reader.read().then(() => 'ended', () => 'failed');
  expect(await command.stop('SIGTERM')).toBe(0);
  expect(await Promise.race([reading, sleep(3000).then(() => 'still open')])).not.toBe('still open');
  expect(command.stderr()).toBe('');
});

test('SIGINT stops an idle command with 0', async () => {
  const command = await startCommand(['--target', 'http://127.0.0.1:1/agent']);
  expect(await command.stop('SIGINT')).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// HTTPS targets
// ---------------------------------------------------------------------------------------------

test('an HTTPS target relays when the process trusts its certificate, and is a 502 that names the origin and the code when it does not', async ({ later }) => {
  test.skip(spawnSync('openssl', ['version']).status !== 0, 'openssl is not installed, so no throwaway certificate can be made');
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-cli-tls-'));
  later(() => rmSync(dir, { recursive: true, force: true }));
  const config = path.join(dir, 'openssl.cnf');
  writeFileSync(config, '[req]\ndistinguished_name = dn\nx509_extensions = v3\nprompt = no\n[dn]\nCN = 127.0.0.1\n[v3]\nsubjectAltName = IP:127.0.0.1\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'), '-days', '1', '-config', config], { stdio: 'ignore' });

  const seen: string[] = [];
  const server = createHttpsServer({ key: readFileSync(path.join(dir, 'key.pem')), cert: readFileSync(path.join(dir, 'cert.pem')) }, (request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += String(chunk)));
    request.on('end', () => {
      seen.push(`${request.method} ${request.url}`);
      referenceReply(body, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  later(() => new Promise((resolve) => (server.close(resolve), server.closeAllConnections())));
  const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const body = JSON.stringify({ threadId: 't', runId: 'r' });

  const trusting = await startCommand(['--target', `${origin}/agent`], { NODE_EXTRA_CA_CERTS: path.join(dir, 'cert.pem') });
  later(() => trusting.stop());
  const accepted = await fetch(`${trusting.origin}/proxy/1/agent`, { method: 'POST', body });
  expect(accepted.status).toBe(200);
  expect(await accepted.text()).toContain('Hello from the reference agent.');
  expect(seen).toEqual(['POST /agent']);

  const strict = await startCommand(['--target', `${origin}/agent`], { NODE_EXTRA_CA_CERTS: '' });
  later(() => strict.stop());
  const refused = await fetch(`${strict.origin}/proxy/1/agent`, { method: 'POST', body });
  expect(refused.status).toBe(502);
  expect(await refused.text()).toMatch(new RegExp(`^agui-inspector could not reach ${origin.replace(/[.]/g, '\\.')} \\((DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\\)$`));
  expect(seen).toEqual(['POST /agent']);
});
