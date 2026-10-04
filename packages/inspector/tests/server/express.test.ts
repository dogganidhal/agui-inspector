// The Express helper against a real Express 5 application over a real HTTP server: mounting, the routes, the disabled
// case, the startup warning, the content security policy and a host guard in front of the routes.
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, test } from 'node:test';
import express, { type Express, type NextFunction, type Request, type Response, Router } from 'express';
import { mountInspector } from '../../src/server/express.ts';
import { AGENTS, APP_JS, CHUNK_JS, INDEX, pageDirectory, POLICY, SECRET, warnings } from './fixtures.ts';

const assetsDir = pageDirectory();
const servers: Server[] = [];
after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

/** Starts the application on a free port and returns its origin. */
async function listen(app: Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** An application with the helper mounted and the warning kept out of the test output. */
function hosted(options: Partial<Parameters<typeof mountInspector>[1]> = {}, setup?: (app: Express) => void): Express {
  const app = express();
  setup?.(app);
  warnings(() => mountInspector(app, { agents: AGENTS, enabled: true, assetsDir, ...options }));
  return app;
}

test('the bare path redirects to the page, which loads with its files and configuration', async () => {
  const origin = await listen(hosted());
  const page = await fetch(`${origin}/agui-inspector`);
  assert.equal(page.url, `${origin}/agui-inspector/index.html`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), INDEX);
  assert.equal(await (await fetch(`${origin}/agui-inspector/app.js`)).text(), APP_JS);
  assert.equal(await (await fetch(`${origin}/agui-inspector/assets/chunk.js`)).text(), CHUNK_JS);
  const config = await fetch(`${origin}/agui-inspector/config.json`);
  assert.equal(config.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await config.json(), { version: 0, agents: AGENTS });
});

test('the redirect is a relative 307 that keeps the query, and the slash form serves the page', async () => {
  const origin = await listen(hosted());
  const redirect = await fetch(`${origin}/agui-inspector?x=1&y=2`, { redirect: 'manual' });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), 'agui-inspector/index.html?x=1&y=2');
  const slash = await fetch(`${origin}/agui-inspector/`);
  assert.equal(slash.status, 200);
  assert.equal(await slash.text(), INDEX);
});

test('a custom path serves the page there, a trailing slash is ignored, and the default path is the host\'s own 404', async () => {
  for (const given of ['/tools/inspect', '/tools/inspect/']) {
    const origin = await listen(hosted({ path: given }));
    const page = await fetch(`${origin}/tools/inspect`);
    assert.equal(page.url, `${origin}/tools/inspect/index.html`, given);
    assert.equal(await page.text(), INDEX, given);
    assert.equal((await fetch(`${origin}/tools/inspect/config.json`)).status, 200, given);
    const elsewhere = await fetch(`${origin}/agui-inspector/`);
    assert.equal(elsewhere.status, 404, given);
    assert.notEqual(elsewhere.headers.get('content-security-policy'), POLICY, 'the host answers, not the helper');
  }
});

test('on a Router that the application mounts under /api, the page and its files load there', async () => {
  const app = express();
  const router = Router();
  warnings(() => mountInspector(router, { agents: AGENTS, enabled: true, assetsDir }));
  app.use('/api', router);
  const origin = await listen(app);
  const page = await fetch(`${origin}/api/agui-inspector?x=1`);
  assert.equal(page.url, `${origin}/api/agui-inspector/index.html?x=1`);
  assert.equal(await page.text(), INDEX);
  assert.deepEqual(await (await fetch(`${origin}/api/agui-inspector/config.json`)).json(), { version: 0, agents: AGENTS });
  assert.equal((await fetch(`${origin}/agui-inspector/config.json`)).status, 404);
});

test('a path that names a file outside the page, a malformed escape or an unknown file is not found, with the policy', async () => {
  const origin = await listen(hosted());
  for (const target of ['..%2fsecret.txt', '..%2f..%2fsecret.txt', 'assets%2f..%2f..%2fsecret.txt', 'assets%5c..%5csecret.txt', '%E0%A4%A', '%00', 'nope.js', 'assets', 'assets/nested', '/etc/passwd', '%2Fetc%2Fpasswd']) {
    const response = await fetch(`${origin}/agui-inspector/${target}`);
    assert.equal(response.status, 404, target);
    assert.ok(!(await response.text()).includes(SECRET), target);
    assert.equal(response.headers.get('content-security-policy'), POLICY, target);
  }
  // The URL parser resolves dot segments before the request leaves the client, so these never reach the mount.
  assert.equal((await fetch(`${origin}/agui-inspector/../secret.txt`)).status, 404);
  assert.equal((await fetch(`${origin}/agui-inspector/%2e%2e/secret.txt`)).status, 404);
});

test('methods other than GET and HEAD get 405 with Allow, and HEAD has the headers of GET and no body', async () => {
  const origin = await listen(hosted());
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const target of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/config.json', '/agui-inspector/app.js']) {
      const response = await fetch(`${origin}${target}`, { method, body: '{}', redirect: 'manual' });
      assert.equal(response.status, 405, `${method} ${target}`);
      assert.equal(response.headers.get('allow'), 'GET, HEAD');
      assert.equal(response.headers.get('content-security-policy'), POLICY);
    }
  }
  const head = await fetch(`${origin}/agui-inspector/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(APP_JS.length));
  assert.equal(await head.text(), '');
});

test('an unexpected file error goes to Express\'s error handling instead of hanging the request', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads a file with no permissions');
  const locked = path.join(assetsDir, 'assets', 'locked.js');
  writeFileSync(locked, 'x');
  chmodSync(locked, 0);
  const handled: unknown[] = [];
  const app = hosted({}, () => undefined);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    handled.push(error);
    res.status(500).send('host error handler');
  });
  const response = await fetch(`${await listen(app)}/agui-inspector/assets/locked.js`);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'host error handler');
  assert.equal(handled.length, 1);
});

test('it adds no cookie, no session route and no proxy of its own', async () => {
  const app = hosted();
  const origin = await listen(app);
  const responses = [await fetch(`${origin}/agui-inspector/`), await fetch(`${origin}/agui-inspector/config.json`)];
  for (const response of responses) assert.equal(response.headers.get('set-cookie'), null);
  for (const target of ['/agui-inspector/sessions', '/agents/support/stream']) assert.equal((await fetch(`${origin}${target}`)).status, 404, target);
});

test('mountInspector accepts a real Express application and a real Router under the strict type check', () => {
  warnings(() => {
    mountInspector(express(), { agents: AGENTS, assetsDir });
    mountInspector(Router(), { agents: AGENTS, assetsDir });
    // @ts-expect-error an agent needs a url
    mountInspector(express(), { agents: [{ id: 'a' }] });
    // @ts-expect-error the helper takes agents
    mountInspector(express(), {});
  });
});

test('with enabled false, left out, or not exactly true, no route is added, nothing is logged or read, and the host answers', async () => {
  const missing = path.join(assetsDir, 'does-not-exist');
  for (const enabled of [false, undefined, 'false' as unknown as boolean, 0 as unknown as boolean]) {
    const app = express();
    const before = app.router.stack.length;
    const { logged } = warnings(() => mountInspector(app, { agents: [{ id: '', url: '' }], path: 'bad', assetsDir: missing, ...(enabled !== undefined && { enabled }) }));
    assert.deepEqual(logged, [], String(enabled));
    assert.equal(app.router.stack.length, before, String(enabled));
    const origin = await listen(app);
    for (const target of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/config.json', '/agui-inspector/app.js']) {
      const response = await fetch(`${origin}${target}`, { redirect: 'manual' });
      assert.equal(response.status, 404, `${String(enabled)} ${target}`);
      assert.notEqual(response.headers.get('content-security-policy'), POLICY, 'the host answers, not the helper');
      assert.ok(!(await response.text()).includes('inspector</title>'));
    }
  }
});

test('enabling logs one warning that names the mount path, the custom one without its trailing slash', () => {
  for (const [options, mount] of [
    [{}, '/agui-inspector'],
    [{ path: '/tools/inspect/' }, '/tools/inspect'],
  ] as const) {
    const { logged } = warnings(() => mountInspector(express(), { agents: AGENTS, enabled: true, assetsDir, ...options }));
    assert.deepEqual(logged, [`agui-inspector is enabled and mounted at ${mount}; disable it outside development`]);
  }
});

test('a bad path or agent list stops startup with a message, and nothing is mounted', () => {
  const app = express();
  const before = app.router.stack.length;
  for (const [options, message] of [
    [{ path: '/' }, /^path must start with '\/' and name a sub-path/],
    [{ path: 'inspector' }, /^path must start with '\/' and name a sub-path/],
    [{ agents: [{ id: 'a', url: '/1' }, { id: 'a', url: '/2' }] }, /^every agent needs a unique nonempty id and a url$/],
    [{ agents: [{ id: 'a', url: '' }] }, /^every agent needs a unique nonempty id and a url$/],
    [{ assetsDir: path.join(assetsDir, 'does-not-exist') }, /the packaged inspector files are missing; build them with 'npm run build'/],
  ] as const) {
    assert.throws(() => mountInspector(app, { agents: AGENTS, enabled: true, assetsDir, ...options }), { message });
  }
  assert.equal(app.router.stack.length, before);
});

test('every response carries the policy: page, file, configuration, redirect, 404 and 405', async () => {
  const origin = await listen(hosted());
  const requests: Array<[string, RequestInit?]> = [
    ['/agui-inspector/'],
    ['/agui-inspector/app.js'],
    ['/agui-inspector/config.json'],
    ['/agui-inspector', { redirect: 'manual' }],
    ['/agui-inspector/nope.js'],
    ['/agui-inspector/', { method: 'POST' }],
  ];
  for (const [target, init] of requests) {
    const response = await fetch(`${origin}${target}`, init);
    assert.equal(response.headers.get('content-security-policy'), POLICY, `${init?.method ?? 'GET'} ${target}`);
  }
});

test('a guard registered before the helper protects the page, the files, the configuration and the redirect', async () => {
  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization === 'Basic aG9zdDpzZWNyZXQ=') return next();
    res.status(401).send('host guard');
  };
  const origin = await listen(hosted({}, (app) => app.use(guard)));
  for (const target of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/index.html', '/agui-inspector/config.json', '/agui-inspector/app.js']) {
    const denied = await fetch(`${origin}${target}`, { redirect: 'manual' });
    assert.equal(denied.status, 401, target);
    assert.equal(await denied.text(), 'host guard', target);
    assert.notEqual(denied.headers.get('content-security-policy'), POLICY);
    const allowed = await fetch(`${origin}${target}`, { redirect: 'manual', headers: { authorization: 'Basic aG9zdDpzZWNyZXQ=' } });
    assert.ok([200, 307].includes(allowed.status), target);
  }
});

test('a guard registered after the helper never runs for the inspector routes, which is why the docs say to register it first', async () => {
  let ran = 0;
  const app = hosted();
  app.use((_req, _res, next) => {
    ran += 1;
    next();
  });
  const origin = await listen(app);
  assert.equal((await fetch(`${origin}/agui-inspector/config.json`)).status, 200);
  assert.equal(ran, 0);
});
