// The Hono helper against a real Hono application, called through `app.request` as Hono's own tests do: mounting, the
// routes, the disabled case, the startup warning, the content security policy and a host guard.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { mountInspector } from '../../src/server/hono.ts';
import { AGENTS, APP_JS, CHUNK_JS, INDEX, pageDirectory, POLICY, SECRET, warnings } from './fixtures.ts';

const assetsDir = pageDirectory();

function hosted(options: Partial<Parameters<typeof mountInspector>[1]> = {}, app: Hono = new Hono()): Hono {
  warnings(() => mountInspector(app, { agents: AGENTS, enabled: true, assetsDir, ...options }));
  return app;
}

const request = (app: Hono, target: string, init?: RequestInit) => app.request(`http://host${target}`, init);

test('the bare path redirects to the page, and the page, its files and the configuration load', async () => {
  const app = hosted();
  const redirect = await request(app, '/agui-inspector?x=1', { redirect: 'manual' });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), 'agui-inspector/index.html?x=1');
  assert.equal(await (await request(app, '/agui-inspector/index.html')).text(), INDEX);
  assert.equal(await (await request(app, '/agui-inspector/app.js')).text(), APP_JS);
  assert.equal(await (await request(app, '/agui-inspector/assets/chunk.js')).text(), CHUNK_JS);
  const config = await request(app, '/agui-inspector/config.json');
  assert.equal(config.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await config.json(), { version: 0, agents: AGENTS });
});

test('plugins reach config.json as given, and the helper serves no module', async () => {
  const app = hosted({ plugins: ['/static/sign.js'] });
  assert.deepEqual(await (await request(app, '/agui-inspector/config.json')).json(), { version: 0, agents: AGENTS, plugins: ['/static/sign.js'] });
  assert.equal((await request(app, '/agui-inspector/static/sign.js')).status, 404);
});

test('the slash form serves the page in both of Hono\'s routing modes, never Hono\'s own 404', async () => {
  for (const strict of [true, false]) {
    const app = hosted({}, new Hono({ strict }));
    const response = await request(app, '/agui-inspector/');
    assert.equal(response.status, 200, `strict ${strict}`);
    assert.equal(await response.text(), INDEX, `strict ${strict}`);
    assert.equal(response.headers.get('content-security-policy'), POLICY);
    assert.equal((await request(app, '/agui-inspector', { redirect: 'manual' })).status, 307, `strict ${strict}`);
  }
});

test('under a base path or a sub-application the redirect and the page follow the real address', async () => {
  const based = hosted({}, new Hono().basePath('/api'));
  const redirect = await request(based, '/api/agui-inspector?x=1', { redirect: 'manual' });
  assert.equal(redirect.headers.get('location'), 'agui-inspector/index.html?x=1');
  assert.equal(await (await request(based, '/api/agui-inspector/index.html')).text(), INDEX);
  assert.deepEqual(await (await request(based, '/api/agui-inspector/config.json')).json(), { version: 0, agents: AGENTS });
  assert.equal((await request(based, '/agui-inspector/config.json')).status, 404);

  const sub = hosted();
  const app = new Hono().route('/api', sub);
  assert.equal(await (await request(app, '/api/agui-inspector/index.html')).text(), INDEX);
  assert.equal((await request(app, '/api/agui-inspector', { redirect: 'manual' })).headers.get('location'), 'agui-inspector/index.html');
});

test('a custom path serves the page there, a trailing slash is ignored, and the default path is Hono\'s own 404', async () => {
  for (const given of ['/tools/inspect', '/tools/inspect/']) {
    const app = hosted({ path: given });
    assert.equal(await (await request(app, '/tools/inspect/index.html')).text(), INDEX, given);
    assert.equal((await request(app, '/tools/inspect/config.json')).status, 200, given);
    const elsewhere = await request(app, '/agui-inspector/config.json');
    assert.equal(elsewhere.status, 404, given);
    assert.notEqual(elsewhere.headers.get('content-security-policy'), POLICY, 'the host answers, not the helper');
  }
});

test('a path that names a file outside the page or an unknown file is not found, with the policy', async () => {
  const app = hosted();
  for (const target of ['..%2fsecret.txt', '..%2f..%2fsecret.txt', 'assets%2f..%2f..%2fsecret.txt', 'assets%5c..%5csecret.txt', '%00', 'nope.js', 'assets', 'assets/nested', '%2Fetc%2Fpasswd']) {
    const response = await request(app, `/agui-inspector/${target}`);
    assert.equal(response.status, 404, target);
    assert.ok(!(await response.text()).includes(SECRET), target);
    assert.equal(response.headers.get('content-security-policy'), POLICY, target);
  }
});

test('methods other than GET and HEAD get 405 with Allow, and HEAD has the headers of GET and no body', async () => {
  const app = hosted();
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const target of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/config.json', '/agui-inspector/app.js']) {
      const response = await request(app, target, { method, body: '{}', redirect: 'manual' });
      assert.equal(response.status, 405, `${method} ${target}`);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(response.headers.get('content-security-policy'), POLICY);
    }
  }
  const head = await request(app, '/agui-inspector/app.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(APP_JS.length));
  assert.equal(await head.text(), '');
});

test('it adds no cookie, no session route and no proxy of its own', async () => {
  const app = hosted();
  for (const target of ['/agui-inspector/', '/agui-inspector/config.json']) assert.equal((await request(app, target)).headers.get('set-cookie'), null);
  for (const target of ['/agui-inspector/sessions', '/agents/support/stream']) assert.equal((await request(app, target)).status, 404, target);
});

test('mountInspector accepts a real Hono application, with or without a base path, under the strict type check', () => {
  warnings(() => {
    mountInspector(new Hono(), { agents: AGENTS, assetsDir });
    mountInspector(new Hono().basePath('/api'), { agents: AGENTS, assetsDir });
    // @ts-expect-error an agent needs a url
    mountInspector(new Hono(), { agents: [{ id: 'a' }] });
    // @ts-expect-error the helper takes agents
    mountInspector(new Hono(), {});
  });
});

test('with enabled false, left out, or not exactly true, no route is added, nothing is logged or read, and the host answers', async () => {
  const missing = path.join(assetsDir, 'does-not-exist');
  for (const enabled of [false, undefined, 'false' as unknown as boolean, 0 as unknown as boolean]) {
    const app = new Hono();
    const { logged } = warnings(() => mountInspector(app, { agents: [{ id: '', url: '' }], path: 'bad', assetsDir: missing, ...(enabled !== undefined && { enabled }) }));
    assert.deepEqual(logged, [], String(enabled));
    assert.equal(app.routes.length, 0, String(enabled));
    for (const target of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/config.json', '/agui-inspector/app.js']) {
      const response = await request(app, target, { redirect: 'manual' });
      assert.equal(response.status, 404, `${String(enabled)} ${target}`);
      assert.notEqual(response.headers.get('content-security-policy'), POLICY);
    }
  }
});

test('enabling adds the two routes and logs one warning that names the mount path', () => {
  for (const [options, mount] of [
    [{}, '/agui-inspector'],
    [{ path: '/tools/inspect/' }, '/tools/inspect'],
  ] as const) {
    const app = new Hono();
    const { logged } = warnings(() => mountInspector(app, { agents: AGENTS, enabled: true, assetsDir, ...options }));
    assert.deepEqual(logged, [`agui-inspector is enabled and mounted at ${mount}; disable it outside development`]);
    assert.equal(app.routes.length, 2);
  }
});

test('a bad path or agent list stops startup with a message, and nothing is mounted', () => {
  const app = new Hono();
  for (const [options, message] of [
    [{ path: '/' }, /^path must start with '\/' and name a sub-path/],
    [{ path: 'inspector' }, /^path must start with '\/' and name a sub-path/],
    [{ agents: [{ id: 'a', url: '/1' }, { id: 'a', url: '/2' }] }, /^every agent needs a unique nonempty id and a url$/],
    [{ agents: [{ id: '', url: '/1' }] }, /^every agent needs a unique nonempty id and a url$/],
    [{ assetsDir: path.join(assetsDir, 'does-not-exist') }, /the packaged inspector files are missing; build them with 'npm run build'/],
  ] as const) {
    assert.throws(() => mountInspector(app, { agents: AGENTS, enabled: true, assetsDir, ...options }), { message });
  }
  assert.equal(app.routes.length, 0);
});

test('every response carries the policy: page, file, configuration, redirect, 404 and 405', async () => {
  const app = hosted();
  const requests: Array<[string, RequestInit?]> = [
    ['/agui-inspector/'],
    ['/agui-inspector/app.js'],
    ['/agui-inspector/config.json'],
    ['/agui-inspector', { redirect: 'manual' }],
    ['/agui-inspector/nope.js'],
    ['/agui-inspector/', { method: 'POST' }],
  ];
  for (const [target, init] of requests) {
    assert.equal((await request(app, target, init)).headers.get('content-security-policy'), POLICY, `${init?.method ?? 'GET'} ${target}`);
  }
});

test('a middleware registered before the helper protects all four routes, and one registered after it never runs', async () => {
  const guarded = new Hono();
  guarded.use('*', async (c, next) => (c.req.header('authorization') === 'Basic aG9zdDpzZWNyZXQ=' ? next() : c.text('host guard', 401)));
  hosted({}, guarded);
  for (const target of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/config.json', '/agui-inspector/app.js']) {
    const denied = await request(guarded, target, { redirect: 'manual' });
    assert.equal(denied.status, 401, target);
    assert.equal(await denied.text(), 'host guard');
    const allowed = await request(guarded, target, { redirect: 'manual', headers: { authorization: 'Basic aG9zdDpzZWNyZXQ=' } });
    assert.ok([200, 307].includes(allowed.status), target);
  }
  let ran = 0;
  const late = hosted();
  late.use('*', async (_c, next) => {
    ran += 1;
    await next();
  });
  assert.equal((await request(late, '/agui-inspector/config.json')).status, 200);
  assert.equal(ran, 0);
});
