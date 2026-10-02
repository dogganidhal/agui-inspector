// L06 T047 (US2, SC-002, FR-002, FR-004, FR-006, FR-038): the packaged inspector inside a real FastAPI host.
//
// examples/fastapi/app.py is started under uv with HTTP Basic authentication on every route, once
// with the inspector enabled and once disabled. The assets are the ones scripts/package-python.mjs
// stages from packages/inspector/dist, so run `npm run build` first (CI does). These tests cover
// routes, host authentication, configuration, CSP and the network allowlist; the conversation views
// are other slices. A second, generic Node file server proves the same assets work outside Python.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer, type AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, request as playwrightRequest, test as base, type APIRequestContext, type Page } from '@playwright/test';
import { staticAssetsPath } from '../../../packages/inspector/src/static-path.js';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const USER = 'host-user';
const PASSWORD = `synthetic-${randomUUID()}`;
const credentials = { username: USER, password: PASSWORD };
const CONFIG = { version: 0, agents: [{ id: 'demo', url: '/agents/demo/stream', name: 'Demo agent' }] };

interface Host {
  readonly origin: string;
  stderr(): string;
}

async function freePort(): Promise<number> {
  const server = createSocketServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startHost(debug: boolean, script = 'examples/fastapi/app.py'): Promise<{ host: Host; stop(): void }> {
  const port = await freePort();
  const child: ChildProcess = spawn(
    'uv',
    ['run', '--project', 'packages/python', '--locked', '--extra', 'embedded', '--group', 'test', 'python', script, '--port', String(port)],
    { cwd: root, env: { ...process.env, EXAMPLE_USER: USER, EXAMPLE_PASSWORD: PASSWORD, EXAMPLE_DEBUG: debug ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  child.stdout?.resume();
  let exited = false;
  child.on('exit', () => (exited = true));
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 600; attempt++) {
    if (exited) throw new Error(`${script} exited early:\n${stderr}`);
    const up = await fetch(origin).then(() => true, () => false);
    if (up) return { host: { origin, stderr: () => stderr }, stop: () => void child.kill() };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill();
  throw new Error(`${script} did not start:\n${stderr}`);
}

/** A generic static file server: the npm assets plus an adjacent config.json, and nothing else. */
async function startStaticServer(): Promise<{ origin: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const body = pathname === '/config.json' ? JSON.stringify(CONFIG) : pathname === '/' ? readAsset('index.html') : readAsset(pathname.slice(1));
    if (body === undefined) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': pathname === '/config.json' ? 'application/json' : (types[path.extname(pathname || 'x.html')] ?? 'text/html') }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function readAsset(relative: string): Buffer | undefined {
  const files = assetFiles();
  return files.includes(relative) ? readFileSync(path.join(staticAssetsPath, relative)) : undefined;
}

function assetFiles(): string[] {
  return readdirSync(staticAssetsPath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(staticAssetsPath, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

const test = base.extend<{ requested: string[] }, { enabled: Host; disabled: Host; custom: Host }>({
  enabled: [
    async ({}, use) => {
      // The stage step needs only an existing build; it never rebuilds under parallel specs.
      execFileSync('node', ['scripts/package-python.mjs', '--no-build', '--stage-only'], { cwd: root, stdio: 'inherit' });
      const { host, stop } = await startHost(true);
      await use(host);
      stop();
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  // Started after `enabled`: two `uv run` calls must not sync the same environment at once.
  disabled: [
    async ({ enabled: _enabled }, use) => {
      const { host, stop } = await startHost(false);
      await use(host);
      stop();
    },
    { scope: 'worker', timeout: 180_000 },
  ],

  custom: [
    async ({ enabled: _enabled }, use) => {
      const { host, stop } = await startHost(true, 'tests/e2e/python/custom_mount_host.py');
      await use(host);
      stop();
    },
    { scope: 'worker', timeout: 180_000 },
  ],

  context: async ({ browser }, use) => {
    const context = await browser.newContext({ httpCredentials: credentials });
    await use(context);
    await context.close();
  },

  /** Every URL the page requests; after each test none may be outside the page's own origin. */
  requested: [
    async ({ page }, use) => {
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await use(urls);
      const origins = new Set(urls.filter((url) => !/^(blob|data):/.test(url)).map((url) => new URL(url).origin));
      expect(origins.size, `requests: ${[...origins].join(', ')}`).toBeLessThanOrEqual(1);
    },
    { auto: true },
  ],
});

// One worker owns both hosts and the staged copy of the assets.
test.describe.configure({ mode: 'serial' });

/**
 * Loads a same-origin script that calls eval and one that is inline. CDP evaluation bypasses the
 * page's policy, so `page.evaluate` cannot show that eval is blocked; a page script can.
 */
async function probePolicy(page: Page, origin: string): Promise<{ eval: string; inline: boolean }> {
  await page.route(`${origin}/**/probe-eval.js`, (route) =>
    route.fulfill({ contentType: 'text/javascript', body: "try { eval('1'); window.__eval = 'allowed'; } catch (error) { window.__eval = error.name; }" }),
  );
  await page.addScriptTag({ url: `${new URL(page.url()).pathname.replace(/[^/]*$/, '')}probe-eval.js` });
  await page.addScriptTag({ content: 'window.__inline = true;' }).catch(() => undefined);
  return page.evaluate(() => ({ eval: (window as unknown as { __eval: string }).__eval, inline: '__inline' in window }));
}

async function anonymous(origin: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: origin });
}

async function signedIn(origin: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: origin, httpCredentials: { ...credentials, send: 'always' } });
}

test('the host authentication guards the page, its assets, the configuration and the agent route', async ({ enabled }) => {
  const client = await anonymous(enabled.origin);
  for (const url of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/app.js', '/agui-inspector/config.json']) {
    const response = await client.get(url, { maxRedirects: 0 });
    expect(response.status(), url).toBe(401);
  }
  expect((await client.post('/agents/demo/stream', { data: { threadId: 't', runId: 'r' } })).status()).toBe(401);
  await client.dispose();
});

test('the page boots on the host origin under an own-origin, no-eval content security policy', async ({ page, enabled }) => {
  const violations: string[] = [];
  page.on('console', (message) => message.text().includes('Content Security Policy') && violations.push(message.text()));
  const response = await page.goto(`${enabled.origin}/agui-inspector`);
  expect(response?.url()).toBe(`${enabled.origin}/agui-inspector/`);
  expect(response?.status()).toBe(200);

  const policy = response?.headers()['content-security-policy'] ?? '';
  expect(policy).toContain("script-src 'self'");
  expect(policy).not.toMatch(/unsafe-eval|unsafe-inline|https?:/);

  await expect(page.locator('#root')).not.toBeEmpty();
  expect(await probePolicy(page, enabled.origin)).toEqual({ eval: 'EvalError', inline: false });
  expect(violations.filter((text) => !/unsafe-eval|inline script/i.test(text))).toEqual([]);
});

test('the configuration lists the host agents and holds no credentials', async ({ page, enabled }) => {
  await page.goto(`${enabled.origin}/agui-inspector/`);
  const result = await page.evaluate(async () => {
    const response = await fetch('config.json', { credentials: 'same-origin' });
    return { status: response.status, type: response.headers.get('content-type'), text: await response.text() };
  });
  expect(result.status).toBe(200);
  expect(result.type).toBe('application/json');
  expect(JSON.parse(result.text)).toEqual(CONFIG);
  expect(result.text).not.toContain(PASSWORD);
  expect(result.text).not.toMatch(/token|authorization|header|cookie|password/i);
});

test('a request from the page to the configured agent reuses the host same-origin authentication', async ({ page, enabled }) => {
  await page.goto(`${enabled.origin}/agui-inspector/`);
  const { status, body } = await page.evaluate(async () => {
    const response = await fetch('/agents/demo/stream', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ threadId: 'thread-1', runId: 'run-1' }),
    });
    return { status: response.status, body: await response.text() };
  });
  expect(status).toBe(200);
  const events = body.split('\n\n').filter(Boolean).map((frame) => JSON.parse(frame.replace(/^data: /, '')) as { type: string });
  expect(events.map((event) => event.type)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  expect(body).not.toContain(PASSWORD);
});

test('every file of the npm static assets is served byte for byte', async ({ enabled }) => {
  const client = await signedIn(enabled.origin);
  const files = assetFiles();
  expect(files).toContain('index.html');
  for (const file of files) {
    const response = await client.get(file === 'index.html' ? '/agui-inspector/' : `/agui-inspector/${file}`);
    expect(response.status(), file).toBe(200);
    expect(Buffer.compare(await response.body(), readFileSync(path.join(staticAssetsPath, file))), file).toBe(0);
  }
  await client.dispose();
});

test('the helper creates no session storage and no agent proxy', async ({ enabled }) => {
  const client = await signedIn(enabled.origin);
  expect((await client.get('/agui-inspector/sessions')).status()).toBe(404);
  expect([404, 405]).toContain((await client.post('/agui-inspector/sessions', { data: {} })).status()); // no write method exists
  expect((await client.put('/agui-inspector/config.json', { data: CONFIG })).status()).toBe(405);
  expect((await client.post('/agui-inspector/', { data: {} })).status()).toBe(405);
  await client.dispose();
});

test('enabling logs a startup warning with the mount path', ({ enabled, disabled }) => {
  expect(enabled.stderr()).toContain('mounted at /agui-inspector');
  expect(disabled.stderr()).not.toContain('/agui-inspector');
});

test('a disabled host mounts nothing, not even for an authenticated request', async ({ disabled }) => {
  const client = await signedIn(disabled.origin);
  for (const url of ['/agui-inspector', '/agui-inspector/', '/agui-inspector/app.js', '/agui-inspector/config.json']) {
    expect((await client.get(url, { maxRedirects: 0 })).status(), url).toBe(404);
  }
  expect((await client.post('/agents/demo/stream', { data: { threadId: 't', runId: 'r' } })).status()).toBe(200);
  await client.dispose();
});

test('another server can serve the same assets beside a config file', async ({ page }) => {
  const other = await startStaticServer();
  try {
    await page.goto(other.origin);
    await expect(page.locator('#root')).not.toBeEmpty();
    const config = await page.evaluate(async () => (await fetch('/config.json')).json());
    expect(config).toEqual(CONFIG);
    expect(await probePolicy(page, other.origin)).toEqual({ eval: 'EvalError', inline: false });
  } finally {
    await other.close();
  }
});

// F-01: the page asked for the origin-root /config.json under a mount path, so no configured agent was listed.
for (const [name, mount, host] of [
  ['the default mount', '/agui-inspector', 'enabled'],
  ['a custom mount', '/tools/inspector', 'custom'],
] as const) {
  for (const slash of ['', '/']) {
    test(`${name}, opened as ${mount}${slash}, reads its files beside the page and lists the configured agent`, async ({ page, requested, enabled, custom }) => {
      const origin = { enabled, custom }[host].origin;
      await page.goto(`${origin}${mount}${slash}`);
      // The first configured agent is selected at the start, so its endpoint is the target.
      await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue('/agents/demo/stream');

      const paths = requested.map((url) => new URL(url).pathname);
      expect(paths).toContain(`${mount}/hosting-config.json`);
      expect(paths).toContain(`${mount}/config.json`);
      expect(paths, 'nothing is requested from the origin root').not.toContain('/config.json');
      expect(paths).not.toContain('/hosting-config.json');
      expect(paths.filter((path) => /\.(js|css)$/.test(path)).every((path) => path.startsWith(`${mount}/`))).toBe(true);
    });
  }
}
