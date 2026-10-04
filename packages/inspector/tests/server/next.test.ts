// The Next.js helper, called the way Next.js calls a route handler: a web-standard Request and the route parameters,
// as a promise (Next.js 15 and later) or a plain object (before). The helper imports nothing from `next`, so the tests
// need no Next.js either. A real application backs the claim: see specs/006-js-server-helpers/research.md.
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mock, test } from 'node:test';
import { inspectorRoute, type InspectorRouteContext, type InspectorRouteHandler } from '../../src/server/next.ts';
import { AGENTS, APP_JS, CHUNK_JS, INDEX, pageDirectory, POLICY, SECRET, warnings } from './fixtures.ts';

const assetsDir = pageDirectory();

const route = (options: Partial<Parameters<typeof inspectorRoute>[0]> = {}) => inspectorRoute({ agents: AGENTS, enabled: true, assetsDir, ...options });
const request = (target: string, init?: RequestInit) => new Request(`http://host${target}`, init);
/** The params of a catch-all route for `segments`, the way Next.js 15 and later passes them. */
const params = (...segments: string[]) => ({ params: Promise.resolve(segments.length > 0 ? { path: segments } : {}) });
const call = (handler: InspectorRouteHandler, target: string, segments: string[], init?: RequestInit) => handler(request(target, init), params(...segments));
const quiet = <T>(fn: () => T) => warnings(fn).result;

test('the page, its files and the configuration are served for the catch-all parameters', async () => {
  const { GET } = route();
  assert.equal(await (await quiet(() => call(GET, '/agui-inspector/', []))).text(), INDEX);
  assert.equal(await (await call(GET, '/agui-inspector/index.html', ['index.html'])).text(), INDEX);
  assert.equal(await (await call(GET, '/agui-inspector/app.js', ['app.js'])).text(), APP_JS);
  assert.equal(await (await call(GET, '/agui-inspector/assets/chunk.js', ['assets', 'chunk.js'])).text(), CHUNK_JS);
  const config = await call(GET, '/agui-inspector/config.json', ['config.json']);
  assert.equal(config.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await config.json(), { version: 0, agents: AGENTS });
});

test('params may be a promise, as in Next.js 15 and later, or a plain object, as before, with path undefined, missing or empty', async () => {
  const { GET } = route();
  quiet(() => undefined);
  for (const context of [{ params: Promise.resolve({ path: ['config.json'] }) }, { params: { path: ['config.json'] } }]) {
    assert.equal((await GET(request('/agui-inspector/config.json'), context as InspectorRouteContext)).status, 200);
  }
  for (const context of [{ params: Promise.resolve({}) }, { params: {} }, { params: { path: [] } }, { params: Promise.resolve({ path: undefined }) }]) {
    const response = await GET(request('/agui-inspector/'), context as InspectorRouteContext);
    assert.equal(await response.text(), INDEX);
  }
});

test('the bare path redirects to index.html, which Next.js serves with its default trailing slash setting', async () => {
  const { GET, HEAD } = route();
  for (const handler of [GET, HEAD]) {
    const redirect = await call(handler, '/agui-inspector?x=1', [], { redirect: 'manual' } as RequestInit);
    assert.equal(redirect.status, 307);
    assert.equal(redirect.headers.get('location'), 'agui-inspector/index.html?x=1');
  }
  const based = await call(GET, '/tools/agui-inspector', []);
  assert.equal(based.headers.get('location'), 'agui-inspector/index.html');
});

test('HEAD has the headers of GET and no body', async () => {
  const { GET, HEAD } = route();
  const get = await call(GET, '/agui-inspector/app.js', ['app.js']);
  const head = await call(HEAD, '/agui-inspector/app.js', ['app.js'], { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
  assert.equal(await head.text(), '');
});

test('an unknown file, a directory and a path that names a file outside the page are not found, with the policy', async () => {
  const { GET } = route();
  for (const segments of [['nope.js'], ['assets'], ['..', 'secret.txt'], ['..'], ['.'], ['', 'x'], ['assets', '..', '..', 'secret.txt'], ['..\\secret.txt'], ['a/b'], ['%2e%2e', 'secret.txt'], ['x\0']]) {
    const response = await call(GET, `/agui-inspector/${segments.join('/')}`, segments);
    assert.equal(response.status, 404, JSON.stringify(segments));
    assert.ok(!(await response.text()).includes(SECRET), JSON.stringify(segments));
    assert.equal(response.headers.get('content-security-policy'), POLICY, JSON.stringify(segments));
  }
});

test('every response of the helper carries the policy: page, file, configuration, redirect and 404', async () => {
  const { GET } = route();
  for (const [target, segments] of [
    ['/agui-inspector/', []],
    ['/agui-inspector/app.js', ['app.js']],
    ['/agui-inspector/config.json', ['config.json']],
    ['/agui-inspector', []],
    ['/agui-inspector/nope.js', ['nope.js']],
  ] as const) {
    assert.equal((await call(GET, target, [...segments])).headers.get('content-security-policy'), POLICY, target);
  }
});

test('the context type satisfies the check that `next build` generates for a catch-all route handler', () => {
  // Next.js writes `RouteContext = { params: Promise<SegmentParams> }` into `.next/types` and requires the second
  // argument of GET and HEAD to fit it. A union with a plain object does not, which failed `next build --webpack`.
  type NextRouteContext = { params: Promise<{ [key: string]: string | string[] | undefined }> };
  type Second = Parameters<InspectorRouteHandler>[1];
  const fits: Second extends NextRouteContext ? true : false = true;
  const first: Parameters<InspectorRouteHandler>[0] extends Request ? true : false = true;
  assert.deepEqual([fits, first], [true, true]);
});

test('the handlers fit what a Next.js route file exports', () => {
  const { GET, HEAD } = route();
  // Next.js reads `GET` and `HEAD` as named exports of the route module, so `export const { GET, HEAD } = ...` is the use.
  const nextHandler: (request: Request, context: { params: Promise<{ path?: string[] }> }) => Promise<Response> = GET;
  assert.equal(typeof nextHandler, 'function');
  assert.equal(typeof HEAD, 'function');
  assert.deepEqual(Object.keys(route()).sort(), ['GET', 'HEAD']);
});

test('with enabled false, left out, or not exactly true, every request is a 404 with no inspector content, nothing is logged or read', async () => {
  const missing = path.join(assetsDir, 'does-not-exist');
  for (const enabled of [false, undefined, 'false' as unknown as boolean, 0 as unknown as boolean]) {
    const { result: handlers, logged: atCreation } = warnings(() => inspectorRoute({ agents: [{ id: '', url: '' }], assetsDir: missing, ...(enabled !== undefined && { enabled }) }));
    assert.deepEqual(atCreation, [], String(enabled));
    for (const [target, segments] of [['/agui-inspector', []], ['/agui-inspector/', []], ['/agui-inspector/config.json', ['config.json']], ['/agui-inspector/app.js', ['app.js']]] as const) {
      for (const handler of [handlers.GET, handlers.HEAD]) {
        const { result: response, logged } = warnings(() => call(handler, target, [...segments]));
        const settled = await response;
        assert.equal(settled.status, 404, `${String(enabled)} ${target}`);
        assert.deepEqual(logged, []);
        assert.ok(!(await settled.text()).includes('inspector</title>'));
        assert.notEqual(settled.headers.get('content-security-policy'), POLICY);
      }
    }
  }
});

test('creating an enabled route logs nothing, and the first request logs one warning naming the route path', async () => {
  const { result: handlers, logged: atCreation } = warnings(() => route());
  assert.deepEqual(atCreation, []);
  const warn = mock.method(console, 'warn', () => undefined);
  try {
    await call(handlers.GET, '/agui-inspector/assets/chunk.js', ['assets', 'chunk.js']);
    await call(handlers.GET, '/agui-inspector/', []);
    await call(handlers.HEAD, '/agui-inspector/config.json', ['config.json']);
    assert.deepEqual(warn.mock.calls.map((c) => String(c.arguments[0])), ['agui-inspector is enabled and mounted at /agui-inspector; disable it outside development']);
  } finally {
    warn.mock.restore();
  }
});

test('the warning names the path of the route whatever the first request is, with or without a prefix in the URL', async () => {
  for (const [target, segments, mount] of [
    ['/agui-inspector', [], '/agui-inspector'],
    ['/agui-inspector/', [], '/agui-inspector'],
    ['/agui-inspector/config.json', ['config.json'], '/agui-inspector'],
    ['/agui-inspector/assets/chunk.js', ['assets', 'chunk.js'], '/agui-inspector'],
    ['/agui-inspector/assets/', ['assets'], '/agui-inspector'],
    ['/tools/agui-inspector', [], '/tools/agui-inspector'],
    ['/tools/agui-inspector/config.json', ['config.json'], '/tools/agui-inspector'],
    ['/dev/tools/inspect/nope.js', ['nope.js'], '/dev/tools/inspect'],
  ] as const) {
    const handlers = quiet(() => route());
    const { logged } = await (async () => {
      const warn = mock.method(console, 'warn', () => undefined);
      try {
        await call(handlers.GET, target, [...segments]);
        return { logged: warn.mock.calls.map((c) => String(c.arguments[0])) };
      } finally {
        warn.mock.restore();
      }
    })();
    assert.deepEqual(logged, [`agui-inspector is enabled and mounted at ${mount}; disable it outside development`], target);
  }
});

test('a bad agent list or a missing page stops the route module when it is enabled, with a message', () => {
  assert.throws(() => inspectorRoute({ agents: [{ id: 'a', url: '/1' }, { id: 'a', url: '/2' }], enabled: true, assetsDir }), { message: /^every agent needs a unique nonempty id and a url$/ });
  assert.throws(() => inspectorRoute({ agents: [{ id: 'a' }] as never, enabled: true, assetsDir }), { message: /^every agent needs a unique nonempty id and a url$/ });
  assert.throws(() => inspectorRoute({ agents: AGENTS, enabled: true, assetsDir: path.join(assetsDir, 'does-not-exist') }), { message: /the packaged inspector files are missing; build them with 'npm run build'/ });
});

test('the helper takes the theme and has no path argument', async () => {
  const theme = { light: { '--agui-accent': '#2563eb' }, dark: { '--agui-accent': '#93c5fd' } };
  const { GET } = route({ theme });
  assert.deepEqual(await (await quiet(() => call(GET, '/agui-inspector/config.json', ['config.json']))).json(), { version: 0, agents: AGENTS, theme });
  // @ts-expect-error Next.js fixes the path by the route file's location
  route({ path: '/elsewhere' });
});

test('an unexpected file error is thrown to Next.js, which answers 500', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root reads a file with no permissions');
  const locked = path.join(assetsDir, 'assets', 'locked.js');
  writeFileSync(locked, 'x');
  chmodSync(locked, 0);
  await assert.rejects(quiet(() => call(route().GET, '/agui-inspector/assets/locked.js', ['assets', 'locked.js'])), { code: 'EACCES' });
});
