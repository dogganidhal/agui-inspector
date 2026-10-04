// The shared core of the JavaScript server helpers: routes, configuration, policy header, file safety and the mount
// rules. The helpers are tested with their frameworks in express.test.ts, hono.test.ts and next.test.ts.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { createInspectorHandler, DEFAULT_PATH, resolveMount, warnMounted } from '../../src/server/core.ts';
import { AGENTS, APP_JS, CHUNK_JS, INDEX, pageDirectory, POLICY, SECRET } from './fixtures.ts';

const assetsDir = pageDirectory();
const handler = createInspectorHandler({ agents: AGENTS, assetsDir });
const at = (url: string, init?: RequestInit) => new Request(`http://host${url}`, init);
const get = (asset: string, url = '/agui-inspector/') => handler(at(url), asset);

test('the page is served for an empty asset when the path ends in a slash', async () => {
  const response = await get('');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), INDEX);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
});

test('the bare mount path redirects to index.html with a relative location and keeps the query', async () => {
  for (const [url, location] of [
    ['/agui-inspector', 'agui-inspector/index.html'],
    ['/agui-inspector?x=1&y=2', 'agui-inspector/index.html?x=1&y=2'],
    ['/api/agui-inspector', 'agui-inspector/index.html'],
    ['/tools/inspect?x=1', 'inspect/index.html?x=1'],
  ] as const) {
    const response = await handler(at(url), '');
    assert.equal(response.status, 307, url);
    assert.equal(response.headers.get('location'), location, url);
    assert.equal(response.headers.get('content-security-policy'), POLICY, url);
    assert.equal(await response.text(), '');
  }
});

test('a relative redirect resolves under the mount for the address the client used', async () => {
  const resolved = new URL(((await handler(at('/api/agui-inspector?x=1'), '')).headers.get('location')) ?? '', 'http://host/api/agui-inspector?x=1');
  assert.equal(resolved.href, 'http://host/api/agui-inspector/index.html?x=1');
});

test('config.json is the version 0 file built from the agents and carries only declared fields', async () => {
  const agents = [
    { id: 'minimal', url: '/m' },
    {
      id: 'full',
      url: '/f',
      name: 'Full',
      capabilities: '/f/capabilities',
      preset: { messages: 'turn', prepare: [{ method: 'PUT', path: '/s/{{threadId}}' }] },
    },
    { id: 'inline', url: '/i', capabilities: { tools: true }, name: undefined },
  ];
  const response = await createInspectorHandler({ agents, assetsDir })(at('/agui-inspector/config.json'), 'config.json');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), {
    version: 0,
    agents: [
      { id: 'minimal', url: '/m' },
      { id: 'full', url: '/f', name: 'Full', capabilities: '/f/capabilities', preset: { messages: 'turn', prepare: [{ method: 'PUT', path: '/s/{{threadId}}' }] } },
      { id: 'inline', url: '/i', capabilities: { tools: true } },
    ],
  });
  assert.deepEqual(Object.keys(JSON.parse(text)), ['version', 'agents']);
});

test('theme is served as given, either map may be missing, and no theme means no theme field', async () => {
  const config = async (theme?: object) =>
    JSON.parse(await (await createInspectorHandler({ agents: AGENTS, assetsDir, ...(theme && { theme }) })(at('/agui-inspector/config.json'), 'config.json')).text());
  const both = { light: { '--agui-accent': '#2563eb', '--agui-radius': '6px' }, dark: { '--agui-accent': '#93c5fd' } };
  assert.deepEqual(await config(both), { version: 0, agents: AGENTS, theme: both });
  assert.deepEqual((await config({ dark: { '--agui-bg': '#101418' } })).theme, { dark: { '--agui-bg': '#101418' } });
  assert.equal('theme' in (await config()), false);
  // The page judges names and values and warns; the helper neither hides nor repairs them.
  const odd = { light: { '--bg': 'red', '--agui-accent': 'url(https://example.invalid/x.png)' }, sepia: {} };
  assert.deepEqual((await config(odd)).theme, odd);
  assert.deepEqual(Object.keys(await config(both)), ['version', 'agents', 'theme']);
});

test('packaged files are served, nested ones included, with a content type by extension', async () => {
  const cases = [
    ['app.js', APP_JS, 'text/javascript; charset=utf-8'],
    ['assets/chunk.js', CHUNK_JS, 'text/javascript; charset=utf-8'],
    ['hosting-config.json', '{"version":0,"mode":"embedded","allowedOrigins":[]}', 'application/json; charset=utf-8'],
    ['index.html', INDEX, 'text/html; charset=utf-8'],
    ['assets/data.bin', 'binary', 'application/octet-stream'],
  ] as const;
  for (const [asset, body, type] of cases) {
    const response = await get(asset);
    assert.equal(response.status, 200, asset);
    assert.equal(await response.text(), body, asset);
    assert.equal(response.headers.get('content-type'), type, asset);
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(body)), asset);
  }
});

test('a missing file, a directory and an unknown asset are not found and are not the page', async () => {
  for (const asset of ['nope.js', 'assets', 'assets/nested', 'assets/chunk.js/x', 'config.json/x']) {
    const response = await get(asset);
    assert.equal(response.status, 404, asset);
    assert.equal(await response.text(), 'Not found', asset);
    assert.equal(response.headers.get('content-type'), 'text/plain', asset);
  }
});

test('paths cannot leave the packaged directory', async () => {
  const assets = [
    '..',
    '../secret.txt',
    '../../secret.txt',
    'assets/../../secret.txt',
    '.',
    './app.js',
    'assets//chunk.js',
    '/app.js',
    'assets/',
    'assets\\..\\..\\secret.txt',
    '..\\secret.txt',
    'app.js\0',
    'a/\0/../../secret.txt',
    path.join('..', 'secret.txt'),
    path.resolve(assetsDir, '..', 'secret.txt'),
  ];
  for (const asset of assets) {
    const response = await get(asset);
    assert.equal(response.status, 404, JSON.stringify(asset));
    assert.ok(!(await response.text()).includes(SECRET), JSON.stringify(asset));
    assert.equal(response.headers.get('content-security-policy'), POLICY, JSON.stringify(asset));
  }
});

test('every response of the helper carries the own-origin, no-eval policy', async () => {
  const responses = [
    await get(''),
    await get('app.js'),
    await get('config.json'),
    await get('nope.js'),
    await handler(at('/agui-inspector'), ''),
    await handler(at('/agui-inspector/', { method: 'POST' }), ''),
    await handler(at('/agui-inspector/app.js', { method: 'HEAD' }), 'app.js'),
  ];
  for (const response of responses) {
    const policy = response.headers.get('content-security-policy') ?? '';
    assert.equal(policy, POLICY);
    const directives = Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
    assert.deepEqual(directives['script-src'], ["'self'"]);
    assert.doesNotMatch(policy, /unsafe-eval|unsafe-inline|http/);
  }
});

test('only GET and HEAD are served; others get 405 with Allow, and HEAD has the headers of GET and no body', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    for (const asset of ['', 'config.json', 'app.js', 'nope.js']) {
      const response = await handler(at('/agui-inspector/', { method }), asset);
      assert.equal(response.status, 405, `${method} ${asset}`);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
    }
  }
  for (const asset of ['', 'config.json', 'app.js']) {
    const get = await handler(at('/agui-inspector/'), asset);
    const head = await handler(at('/agui-inspector/', { method: 'HEAD' }), asset);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
    assert.equal(head.headers.get('content-type'), get.headers.get('content-type'));
    assert.ok(Number(head.headers.get('content-length')) > 0);
  }
  assert.equal((await handler(at('/agui-inspector/nope.js', { method: 'HEAD' }), 'nope.js')).status, 404);
});

test('the helper adds no cookie, no cache header and no header of its own beyond content, policy and redirect', async () => {
  for (const response of [await get(''), await get('config.json'), await handler(at('/agui-inspector'), '')]) {
    assert.deepEqual([...response.headers.keys()].filter((name) => !['content-type', 'content-length', 'content-security-policy', 'location'].includes(name)), []);
  }
});

test('it reads the method and the URL of the request and nothing else', async () => {
  const response = await handler(at('/agui-inspector/', { headers: { cookie: 'a=b', authorization: 'Bearer x' } }), 'app.js');
  assert.equal(response.status, 200);
});

test('a name the file system refuses is not found, but any other file system error reaches the host', async () => {
  assert.equal((await get('a'.repeat(5000))).status, 404);
  if (process.getuid?.() === 0) return; // root reads a file with no permissions
  const locked = path.join(assetsDir, 'assets', 'locked.js');
  writeFileSync(locked, 'x');
  chmodSync(locked, 0);
  await assert.rejects(get('assets/locked.js'), { code: 'EACCES' });
});

test('a files directory without index.html fails when the handler is created, naming the build', () => {
  const empty = mkdtempSync(path.join(tmpdir(), 'agui-empty-'));
  try {
    assert.throws(() => createInspectorHandler({ agents: AGENTS, assetsDir: empty }), /the packaged inspector files are missing; build them with 'npm run build'/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('the default path is /agui-inspector and the warning text names the mount path', () => {
  assert.equal(DEFAULT_PATH, '/agui-inspector');
  const warn = mock.method(console, 'warn', () => undefined);
  try {
    warnMounted('/tools/inspector');
    assert.deepEqual(warn.mock.calls.map((call) => call.arguments), [['agui-inspector is enabled and mounted at /tools/inspector; disable it outside development']]);
  } finally {
    warn.mock.restore();
  }
});

test('resolveMount returns null and reads nothing unless enabled is exactly true', () => {
  const missing = path.join(tmpdir(), 'agui-does-not-exist');
  for (const enabled of [undefined, false, 'false', 'true', 1, 0, null, {}] as unknown[]) {
    const options = { agents: AGENTS, assetsDir: missing, ...(enabled !== undefined && { enabled }) } as Parameters<typeof resolveMount>[0];
    assert.equal(resolveMount(options), null, String(enabled));
  }
  // A disabled call checks nothing, not even arguments that would throw when enabled.
  assert.equal(resolveMount({ agents: [{ id: '', url: '' }], path: 'bad', enabled: false }), null);
  assert.equal(resolveMount({ agents: undefined as never, enabled: false }), null);
});

test('resolveMount normalizes the path and returns a working handler', async () => {
  for (const [given, mount] of [
    [undefined, '/agui-inspector'],
    ['/tools/inspector', '/tools/inspector'],
    ['/tools/inspector/', '/tools/inspector'],
    ['/a/b/c//', '/a/b/c'],
  ] as const) {
    const resolved = resolveMount({ agents: AGENTS, enabled: true, assetsDir, ...(given !== undefined && { path: given }) });
    assert.equal(resolved?.mount, mount, String(given));
    assert.equal((await resolved!.handle(at(`${mount}/`), '')).status, 200);
  }
});

test('resolveMount rejects a path that could shadow the host, with the Python helper message', () => {
  for (const bad of ['', '/', 'inspector', '//', '///']) {
    assert.throws(() => resolveMount({ agents: AGENTS, enabled: true, assetsDir, path: bad }), /^Error: path must start with '\/' and name a sub-path, got /, JSON.stringify(bad));
  }
});

test('resolveMount needs a unique nonempty id and a url for every agent', () => {
  const message = /^Error: every agent needs a unique nonempty id and a url$/;
  for (const agents of [
    [{ id: 'a', url: '/1' }, { id: 'a', url: '/2' }],
    [{ id: '', url: '/1' }],
    [{ id: 'a', url: '' }],
    [{ id: 'a' }],
    [{ url: '/1' }],
    undefined,
    'agents',
  ] as unknown[]) {
    assert.throws(() => resolveMount({ agents: agents as never, enabled: true, assetsDir }), message, JSON.stringify(agents));
  }
  assert.ok(resolveMount({ agents: [], enabled: true, assetsDir }), 'an empty list is allowed: the page lets the visitor type an endpoint');
});

test('resolveMount checks the path first, then the agents, then that the page exists', () => {
  const missing = path.join(tmpdir(), 'agui-does-not-exist');
  assert.throws(() => resolveMount({ agents: [{ id: '', url: '' }], enabled: true, path: 'bad', assetsDir: missing }), /path must start with/);
  assert.throws(() => resolveMount({ agents: [{ id: '', url: '' }], enabled: true, assetsDir: missing }), /every agent needs/);
  assert.throws(() => resolveMount({ agents: AGENTS, enabled: true, assetsDir: missing }), /packaged inspector files are missing/);
});

test('resolveMount does not log; warnMounted is the one place that does', () => {
  const warn = mock.method(console, 'warn', () => undefined);
  try {
    resolveMount({ agents: AGENTS, enabled: true, assetsDir });
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
  }
});
