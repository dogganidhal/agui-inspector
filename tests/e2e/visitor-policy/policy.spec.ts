// P01 T005 (US2, FR-007 to FR-011, constitution IV, G-D02): the opt-in hosted visitor-target policy
// in a real browser. The page is the production build, served the way the hosted e2e serves it, with
// `allowVisitorTargets: true` in hosting-config.json. The targets are real servers the deployment never
// named: a TLS server on its own hostname (agent.visitor.test, mapped to loopback inside the browser, with
// a throw-away certificate), a plain-HTTP server on a non-loopback hostname, and loopback servers on
// arbitrary ports. What this proves: the browser's own content security policy and the guarded transport
// make the same decision at the boundary, the page sends no cookie and shows no approval prompt of its
// own, forbidden destinations never produce a request, and the startup policy cannot be widened by a
// resource the page loads. Firefox and Safari are not driven here: website/content/docs/hosted.mdx records the manual
// numeric-loopback matrix.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { externalResources, THIRD_PARTY_HOST } from '../../../examples/reference-agent/a2ui-scenarios.ts';
import { parseHostingConfig, policyFor } from '../../../packages/inspector/src/app/security.ts';
import { resolveTarget } from '../../../packages/inspector/src/core/runtime/transport.ts';
import { AGENT_REPLY, SYNTHETIC_TOKEN, expect, open, root, send, test as base } from '../hosted/support.ts';

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly cookie: string | undefined;
  readonly token: string | undefined;
}

interface Visitor {
  readonly port: number;
  /** `https://agent.visitor.test:<port>` and the like: the origin a visitor would type. */
  readonly origin: string;
  readonly seen: Seen[];
}

interface World {
  /** TLS, on a hostname no deployment named. */
  readonly secure: Visitor;
  /** The "third party" an A2UI surface reaches for; it also speaks TLS and counts every request. */
  readonly third: Visitor;
  /** Plain HTTP on a non-loopback hostname: forbidden. */
  readonly plain: Visitor;
  /** Plain HTTP on loopback, any port. */
  readonly local: Visitor;
}

const sse = (events: readonly object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
const read = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

/** What every visitor target answers. It grants CORS to any page, which is what a public agent does. */
function handler(seen: Seen[], redirectTo: () => string, thirdOrigin: () => string) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    response.setHeader('access-control-allow-origin', '*');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-methods', 'POST, GET, PUT');
      response.setHeader('access-control-allow-headers', String(request.headers['access-control-request-headers'] ?? 'content-type'));
      response.writeHead(204);
      return void response.end();
    }
    const body = await read(request);
    const token = request.headers['x-api-key'] ?? request.headers.authorization;
    seen.push({ method: request.method ?? '', path: pathname, body, cookie: request.headers.cookie, token: Array.isArray(token) ? token[0] : token });

    const json = (status: number, value: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    };
    if (pathname === '/capabilities') return json(200, { identity: { name: 'Visitor agent', version: '1.0.0' } });
    if (pathname.startsWith('/prepare/')) return json(200, { ok: true });
    if (pathname === '/redirect') {
      response.writeHead(302, { location: `${redirectTo()}/agent` });
      return void response.end();
    }
    if (pathname !== '/agent' && pathname !== '/surface') return json(404, { error: 'not found' });
    let input: { threadId?: unknown; runId?: unknown } = {};
    try {
      input = body === '' ? {} : JSON.parse(body);
    } catch {
      return json(400, { error: 'request body is not valid JSON' });
    }
    if (typeof input.threadId !== 'string' || typeof input.runId !== 'string') return json(422, { error: 'threadId and runId must be strings' });
    const { threadId, runId } = input;
    const operations = JSON.parse(JSON.stringify(externalResources).replaceAll(`http://${THIRD_PARTY_HOST}`, thirdOrigin()));
    const activity =
      pathname === '/surface'
        ? [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'activity-1', activityType: 'a2ui-surface', content: { a2ui_operations: operations }, replace: true }]
        : [{ type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: AGENT_REPLY }, { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' }];
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    response.end(sse([{ type: 'RUN_STARTED', threadId, runId }, ...activity, { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } }]));
  };
}

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const close = (server: Server) => new Promise((resolve) => server.close(resolve));

const test = base.extend<{ world: World }, { tls: { key: Buffer; cert: Buffer } }>({
  // A throw-away certificate for the run, never written outside a directory this fixture removes.
  tls: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const directory = mkdtempSync(path.join(root, '.build', 'visitor-policy-tls-'));
      try {
        const key = path.join(directory, 'key.pem');
        const cert = path.join(directory, 'cert.pem');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=visitor.test'], { stdio: 'pipe' });
        await use({ key: readFileSync(key), cert: readFileSync(cert) });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    { scope: 'worker' },
  ],

  world: async ({ tls }, use) => {
    const origins = { secure: '', third: '', plain: '', local: '' };
    const lists = { secure: [] as Seen[], third: [] as Seen[], plain: [] as Seen[], local: [] as Seen[] };
    const answer = (name: keyof typeof lists) => handler(lists[name], () => origins.local, () => origins.third);
    const servers = {
      secure: createHttpsServer(tls, answer('secure')),
      third: createHttpsServer(tls, answer('third')),
      plain: createHttpServer(answer('plain')),
      local: createHttpServer(answer('local')),
    };
    const ports = { secure: await listen(servers.secure), third: await listen(servers.third), plain: await listen(servers.plain), local: await listen(servers.local) };
    origins.secure = `https://agent.visitor.test:${ports.secure}`;
    origins.third = `https://third.visitor.test:${ports.third}`;
    origins.plain = `http://plain.visitor.test:${ports.plain}`;
    origins.local = `http://127.0.0.1:${ports.local}`;
    const visitor = (name: keyof typeof lists): Visitor => ({ port: ports[name], origin: origins[name], seen: lists[name] });
    await use({ secure: visitor('secure'), third: visitor('third'), plain: visitor('plain'), local: visitor('local') });
    await Promise.all(Object.values(servers).map(close));
  },
});

// Every hostname under .visitor.test resolves to loopback inside this browser only; the page never learns that.
test.use({ ignoreHTTPSErrors: true, launchOptions: { args: ['--host-resolver-rules=MAP *.visitor.test 127.0.0.1'] } });

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const OPTED_IN = { version: 0, mode: 'hosted', allowVisitorTargets: true };
/** The deployment file with the opt-in and, optionally, the agent configuration the page reads. */
const optedIn = (world: World, config?: (world: World) => object) => ({ hosting: () => OPTED_IN, config: () => (config === undefined ? null : config(world)) });

const typeEndpoint = async (page: Page, url: string) => {
  await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(url);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
};

/** What the page itself can do against `url`, bypassing the inspector: the browser's policy and nothing else. */
async function probe(page: Page, url: string): Promise<{ outcome: 'reached' | 'failed'; blocked: string[] }> {
  return page.evaluate(async (target) => {
    const blocked: string[] = [];
    const listener = (event: SecurityPolicyViolationEvent) => blocked.push(event.effectiveDirective);
    document.addEventListener('securitypolicyviolation', listener);
    let outcome: 'reached' | 'failed' = 'reached';
    try {
      const response = await fetch(target, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' }, credentials: 'omit' });
      await response.body?.cancel();
    } catch {
      outcome = 'failed';
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.removeEventListener('securitypolicyviolation', listener);
    return { outcome, blocked };
  }, url);
}

const originOf = (url: string) => new URL(url).origin;
const allTargetSeen = (world: World) => [...world.secure.seen, ...world.third.seen, ...world.plain.seen, ...world.local.seen];

// ---------------------------------------------------------------------------------------------
// The browser's policy and the guard agree
// ---------------------------------------------------------------------------------------------

test('opted in, the meta policy allows https: and the exact local hosts, and the script, image and eval rules are unchanged', async ({ page, openSite, world, violations }) => {
  const site = await openSite(optedIn(world));
  await open(page, site);

  const metas = await page.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
  expect(metas).toHaveLength(2);
  expect(metas[0]).toBe("script-src 'self'; object-src 'none'; base-uri 'none'");
  expect(metas[1]).toContain("connect-src 'self' https: http://localhost:* http://127.0.0.1:*;");
  expect(metas[1]).toContain("img-src 'self' data:");
  expect(metas[1]).toContain("script-src 'self'");
  expect(metas[1]).toContain("default-src 'none'");
  expect(metas[1]).not.toMatch(/unsafe-eval|unsafe-inline|(?:^|[ ;])http:(?:[ ;]|$)|\[::1\]|(?:^|[ ])\*(?:[ ;]|$)/);

  // Code that Playwright injects is exempt from the page's policy until its first task boundary, so wait one.
  const outcome = await page.evaluate(async () => {
    const result: Record<string, string> = {};
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      new Function('return 1')();
      result.eval = 'ran';
    } catch (error) {
      result.eval = (error as Error).name;
    }
    const script = document.createElement('script');
    script.textContent = 'window.__inline = true';
    document.head.append(script);
    result.inline = String((window as unknown as { __inline?: boolean }).__inline === true);
    return result;
  });
  expect(outcome).toEqual({ eval: 'EvalError', inline: 'false' });
  // Only the injected inline script is reported (once per policy); no connection, image or font was blocked on the way.
  const reported = (await violations()).map((violation) => violation.directive);
  expect(reported.length).toBeGreaterThan(0);
  expect(reported.every((directive) => directive === 'script-src-elem')).toBe(true);
});

test('the browser and the guard make the same decision for every destination at the boundary, and a blocked one never reaches its server', async ({ page, openSite, world }) => {
  const site = await openSite(optedIn(world));
  await open(page, site);
  const hosting = parseHostingConfig(JSON.stringify(OPTED_IN));
  if (!hosting.ok) throw new Error(hosting.error);
  const policy = policyFor(hosting.value, site.page.origin);

  const port = world.local.port;
  const targets: Array<{ url: string; server?: Visitor }> = [
    { url: `${world.secure.origin}/agent`, server: world.secure },
    { url: `http://127.0.0.1:${port}/agent`, server: world.local },
    { url: `http://localhost:${port}/agent`, server: world.local },
    // The browser parses these to 127.0.0.1 before it matches the policy; the guard parses them the same way.
    { url: `http://127.1:${port}/agent`, server: world.local },
    { url: `http://2130706433:${port}/agent`, server: world.local },
    // Forbidden: plain HTTP off loopback, other loopback addresses, IPv6 literals, a hostname merely ending in localhost.
    { url: `${world.plain.origin}/agent`, server: world.plain },
    { url: `http://127.0.0.2:${port}/agent` },
    { url: `http://[::1]:${port}/agent` },
    { url: `http://foo.localhost:${port}/agent` },
    { url: `http://localhost.evil.visitor.test:${port}/agent` },
    { url: `http://127.0.0.1.evil.visitor.test:${port}/agent` },
  ];
  for (const { url, server } of targets) {
    const guard = resolveTarget(url, policy).ok;
    const before = server?.seen.length ?? 0;
    const native = await probe(page, url);
    expect(native.blocked.length === 0, `${url}: the browser's policy ${native.blocked.length === 0 ? 'allowed' : `blocked (${native.blocked.join(', ')})`}, the guard says ${guard}`).toBe(guard);
    if (guard) {
      expect(native.outcome, url).toBe('reached');
      expect(server?.seen.length, `${url} reached its server`).toBe(before + 1);
      expect(server?.seen.at(-1)?.cookie, `${url} carried no cookie`).toBeUndefined();
    } else {
      expect(native.blocked, url).toEqual(['connect-src']);
      expect(server?.seen.length ?? 0, `${url} never reached a server`).toBe(before);
    }
  }
  expect(await page.evaluate(() => document.cookie), 'the page holds a cookie for its own host').toContain('session=page-cookie');
});

// ---------------------------------------------------------------------------------------------
// A visitor's run, without a prompt and without cookies
// ---------------------------------------------------------------------------------------------

test('an unlisted HTTPS endpoint and unlisted loopback ports run through the inspector with no cookie, no prompt and no third request', async ({ page, openSite, world, requested, violations }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const site = await openSite(optedIn(world, (w) => ({ version: 0, agents: [{ id: 'secure', name: 'Secure', url: `${w.secure.origin}/agent` }] })));
  await open(page, site);
  await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${world.secure.origin}/agent`);
  await expect(page.getByRole('contentinfo')).toContainText('requests to this origin, HTTPS targets and supported local servers');
  await expect(page.getByRole('contentinfo')).not.toContainText('requests only to');
  await expect(page.getByRole('contentinfo')).toContainText('no telemetry · headers never recorded');
  expect(await page.evaluate(() => document.cookie)).toContain('session=page-cookie');

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(world.secure.seen.map((request) => `${request.method} ${request.path}`)).toEqual(['POST /agent']);
  expect(world.secure.seen[0]?.cookie).toBeUndefined();

  for (const endpoint of [`http://127.0.0.1:${world.local.port}/agent`, `http://localhost:${world.local.port}/agent`, `http://127.1:${world.local.port}/agent`]) {
    const before = world.local.seen.length;
    await typeEndpoint(page, endpoint);
    await send(page, `to ${endpoint}`);
    await expect.poll(() => world.local.seen.length, endpoint).toBe(before + 1);
    expect(world.local.seen.at(-1)?.cookie, endpoint).toBeUndefined();
    expect(JSON.parse(world.local.seen.at(-1)?.body ?? '{}')).toMatchObject({ messages: [{ role: 'user', content: `to ${endpoint}` }] });
    await expect(page.getByRole('alert').filter({ hasText: 'allowed destination' })).toHaveCount(0);
  }
  await expect(page.getByRole('contentinfo')).toContainText('4 exchanges');

  // No prompt of the inspector's own, and the only origins the page spoke to are the page and what the visitor chose.
  expect(dialogs).toEqual([]);
  const chosen = [site.page.origin, world.secure.origin, world.local.origin, `http://localhost:${world.local.port}`];
  expect(requested.map(originOf).filter((origin) => !chosen.includes(origin) && !origin.startsWith('data:') && origin !== 'null')).toEqual([]);
  expect(await violations()).toEqual([]);
  expect(allTargetSeen(world).every((request) => request.cookie === undefined)).toBe(true);
  expect(world.plain.seen).toEqual([]);
  expect(world.third.seen).toEqual([]);
});

test('every guarded caller meets the same boundary: capabilities, preparations, the run, a raw request and the token', async ({ page, openSite, world }) => {
  const site = await openSite(
    optedIn(world, (w) => ({
      version: 0,
      agents: [
        {
          id: 'secure',
          name: 'Secure',
          url: `${w.secure.origin}/agent`,
          capabilities: `${w.secure.origin}/capabilities`,
          preset: { prepare: [{ method: 'PUT', path: '/prepare/sessions/{{threadId}}' }, { method: 'POST', path: '/prepare/warm' }] },
        },
        // Declared by an agent, so outside what a visitor chose: a plain-HTTP capabilities URL is refused before a request.
        { id: 'bad', name: 'Bad', url: `${w.secure.origin}/agent`, capabilities: `${w.plain.origin}/capabilities` },
      ],
    })),
  );
  await open(page, site);
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Visitor agent').first()).toBeVisible();

  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Header name' }).fill('X-Api-Key');
  await page.getByRole('textbox', { name: 'Token' }).fill(SYNTHETIC_TOKEN);
  await page.keyboard.press('Escape');

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Inspection', exact: true }).click();
  await page.getByRole('button', { name: 'Raw request', exact: true }).click();
  const raw = '{"threadId":"t-raw","runId":"r-raw","messages":[],"tools":[],"context":[],"forwardedProps":{},"state":{}}';
  await page.getByRole('textbox', { name: 'Raw request body' }).fill(raw);
  await page.getByRole('button', { name: 'Send unchanged' }).click();
  await expect.poll(() => world.secure.seen.filter((request) => request.path === '/agent').length).toBe(2);

  expect(world.secure.seen.map((request) => `${request.method} ${request.path.replace(/(sessions\/).*/, '$1_')}`)).toEqual([
    'GET /capabilities',
    'PUT /prepare/sessions/_',
    'POST /prepare/warm',
    'POST /agent',
    'POST /agent',
  ]);
  expect(world.secure.seen.every((request) => request.cookie === undefined), 'no caller sent a cookie').toBe(true);
  expect(world.secure.seen.find((request) => request.path === '/capabilities')?.token, 'a capabilities read carries no token').toBeUndefined();
  for (const request of world.secure.seen.filter((candidate) => candidate.path !== '/capabilities')) expect(request.token, `${request.method} ${request.path}`).toBe(SYNTHETIC_TOKEN);
  expect(world.secure.seen.at(-1)?.body, 'the raw body went out unchanged').toBe(raw);

  // The same boundary for a declared capabilities URL: refused with the reason, never requested.
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  const picker = page.locator('[data-view="settings"]');
  await picker.getByRole('button', { name: /Secure/ }).click();
  await picker.getByRole('button', { name: /Bad/ }).click();
  await expect(page.getByText(/is not an allowed destination/).first()).toBeVisible();
  expect(world.plain.seen).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// What stays forbidden, and what the browser still decides
// ---------------------------------------------------------------------------------------------

test('forbidden destinations are refused with a reason before any request, and the refusal never repeats a credential', async ({ page, openSite, world, requested, violations }) => {
  const site = await openSite(optedIn(world, (w) => ({ version: 0, agents: [{ id: 'secure', name: 'Secure', url: `${w.secure.origin}/agent` }] })));
  await open(page, site);
  const port = world.local.port;
  const cases: Array<[string, string]> = [
    [`${world.plain.origin}/agent`, 'is not an allowed destination'],
    [`http://127.0.0.2:${port}/agent`, 'is not an allowed destination'],
    [`http://192.168.1.20:${port}/agent`, 'is not an allowed destination'],
    [`http://[::1]:${port}/agent`, 'IPv6 literals such as [::1] are not supported'],
    [`http://localhost.:${port}/agent`, 'is not an allowed destination'],
    [`ftp://agent.visitor.test:${port}/agent`, 'must use http or https'],
    [`https://user:hunter2@agent.visitor.test:${world.secure.port}/agent`, 'user:password@'],
    [`http://token@localhost:${port}/agent`, 'user:password@'],
    ['/agent', 'must be absolute'],
  ];
  for (const [url, message] of cases) {
    await typeEndpoint(page, url);
    const alert = page.getByRole('alert').filter({ hasText: message }).first();
    await expect(alert, url).toBeVisible();
    expect(await page.getByRole('alert').allTextContents()).not.toContain('hunter2');
    await send(page, 'hello');
    await page.getByRole('button', { name: 'Raw request', exact: true }).click();
    await page.getByRole('textbox', { name: 'Raw request body' }).fill('{}');
    await page.getByRole('button', { name: 'Send unchanged' }).click();
  }
  await page.waitForTimeout(200);
  expect(allTargetSeen(world)).toEqual([]);
  expect(requested.filter((url) => /visitor\.test|hunter2|\[::1\]|127\.0\.0\.2|192\.168/.test(url)), 'no request left the page for a refused destination').toEqual([]);
  expect(await violations(), 'the guard stopped each one before the browser had anything to block').toEqual([]);
});

test('a redirect from an opted-in target is shown and not followed', async ({ page, openSite, world }) => {
  const site = await openSite(optedIn(world, (w) => ({ version: 0, agents: [{ id: 'redirect', name: 'Redirect', url: `${w.secure.origin}/redirect` }] })));
  await open(page, site);
  await send(page, 'hello');
  await expect(page.getByRole('alert').filter({ hasText: 'redirect' })).toContainText('does not follow redirects');
  expect(world.secure.seen.map((request) => request.path)).toEqual(['/redirect']);
  expect(world.local.seen, 'the redirect target never saw a request').toEqual([]);
});

test('a target that does not grant CORS fails visibly in the browser; the inspector neither proxies nor bypasses it', async ({ page, openSite }) => {
  const site = await openSite({ hosting: () => OPTED_IN, config: (o) => ({ version: 0, agents: [{ id: 'closed', name: 'Closed', url: `${o.closed.origin}/agent` }] }) });
  await open(page, site);
  await send(page, 'hello');
  const alert = page.getByRole('alert').filter({ hasText: 'The browser could not complete the request' });
  await expect(alert).toContainText(`to ${site.closed.origin}`);
  await expect(alert).toContainText('CORS');
  await expect(alert).toContainText('does not proxy or bypass');
  await expect(page.getByRole('button', { name: /POST \/agent .* failed .* 1 issue/ })).toBeVisible();
  expect(site.closed.seen, 'the preflight was refused and the run was never sent').toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// The startup policy cannot be widened, and a wrong file does not start
// ---------------------------------------------------------------------------------------------

test('a startup configuration resource is read from the page or a fixed origin only, even when visitor targets are on', async ({ page, openSite, world, requested }) => {
  const named = await openSite({ hosting: () => ({ ...OPTED_IN, config: `${world.secure.origin}/config.json` }) });
  await open(page, named);
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'is not an allowed destination' })).toBeVisible();
  expect(world.secure.seen, 'the configuration was never requested from an origin a visitor could have typed').toEqual([]);
  expect(requested.filter((url) => url.startsWith(world.secure.origin))).toEqual([]);

  // Without the opt-in, an unlisted agent in the configuration is refused too: the default is untouched.
  const closedOff = await openSite({ hosting: () => ({ version: 0, mode: 'hosted', allowedOrigins: [] }), config: () => ({ version: 0, agents: [{ id: 'secure', url: `${world.secure.origin}/agent` }] }) });
  await open(page, closedOff);
  await expect(page.getByRole('alert').filter({ hasText: `${world.secure.origin} is not an allowed destination` })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('requests only to this origin ·');
  await send(page, 'hello');
  await typeEndpoint(page, `http://localhost:${world.local.port}/agent`);
  await expect(page.getByRole('alert').filter({ hasText: 'is not an allowed destination' })).toBeVisible();
  expect(allTargetSeen(world)).toEqual([]);
});

test('a hosting file that opts in wrongly does not start: no policy is guessed and no configuration is requested', async ({ page, openSite, requested }) => {
  for (const [hosting, message] of [
    [{ version: 0, mode: 'embedded', allowVisitorTargets: true }, 'allowVisitorTargets belongs to a hosted deployment'],
    [{ version: 0, mode: 'embedded', allowVisitorTargets: false }, 'allowVisitorTargets belongs to a hosted deployment'],
    [{ version: 0, mode: 'hosted', allowVisitorTargets: 'true' }, 'allowVisitorTargets must be true or false'],
    [{ version: 0, mode: 'hosted', allowVisitorTarget: true }, 'unknown field "allowVisitorTarget"'],
    [{ version: 0, mode: 'hosted', allowVisitorTargets: true, allowedOrigins: ['http://192.168.1.20:8787'] }, 'outside the visitor-target boundary'],
    [{ version: 0, mode: 'hosted', allowVisitorTargets: true, allowedOrigins: ['http://[::1]:8787'] }, 'outside the visitor-target boundary'],
  ] as const) {
    const site = await openSite({ hosting: () => hosting });
    requested.length = 0;
    await page.goto(site.page.origin);
    await expect(page.getByRole('alert')).toContainText(`hosting-config.json: `);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
    expect(requested.some((url) => url.endsWith('/config.json')), JSON.stringify(hosting)).toBe(false);
  }
});

test('fixed origins inside the boundary are accepted and add nothing to it', async ({ page, openSite }) => {
  const site = await openSite({
    hosting: (o) => ({ ...OPTED_IN, allowedOrigins: [o.agent.origin, 'https://agent.example'] }),
    config: (o) => ({ version: 0, agents: [{ id: 'agent', url: `${o.agent.origin}/agent` }] }),
  });
  await open(page, site);
  const meta = await page.locator('meta[http-equiv="Content-Security-Policy"]').last().getAttribute('content');
  expect(meta).toContain("connect-src 'self' https: http://localhost:* http://127.0.0.1:*;");
  expect(meta).not.toContain('agent.example');
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen[0]?.cookie).toBeUndefined();
});

// ---------------------------------------------------------------------------------------------
// A2UI keeps blocking what it blocked
// ---------------------------------------------------------------------------------------------

test('an A2UI surface from an opted-in target still loads nothing and opens nothing, even from an HTTPS origin the policy allows', async ({ page, openSite, world, requested }) => {
  const popups: string[] = [];
  page.on('popup', (popup) => void popups.push(popup.url()));
  const site = await openSite(optedIn(world, (w) => ({ version: 0, agents: [{ id: 'surface', name: 'Surface', url: `${w.secure.origin}/surface` }] })));
  await open(page, site);
  await send(page, 'show me');

  const surface = page.locator('[data-surface="media"]');
  await expect(surface.locator('[data-blocked="Image"]')).toContainText(`${world.third.origin}/picture.png`);
  await expect(surface.locator('[data-blocked="Video"]')).toContainText(`${world.third.origin}/clip.mp4`);
  await expect(surface.locator('[data-blocked="AudioPlayer"]')).toContainText(`${world.third.origin}/sound.mp3`);
  await expect(surface.locator('img, video, audio, iframe')).toHaveCount(0);
  await surface.getByRole('button', { name: 'Open page' }).click();
  await expect(page.getByRole('alert')).toContainText(`Blocked openUrl ${world.third.origin}/page`);
  await page.waitForTimeout(300);

  expect(popups).toEqual([]);
  expect(world.third.seen, 'the third party saw nothing').toEqual([]);
  expect(requested.filter((url) => url.startsWith(world.third.origin))).toEqual([]);
  expect(requested.filter((url) => /a2ui\.org|catalog/.test(url)), 'no external catalog was fetched').toEqual([]);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').last().getAttribute('content');
  expect(csp).toContain("img-src 'self' data:");
  expect(csp).toContain("default-src 'none'");
});

// ---------------------------------------------------------------------------------------------
// The mount seam: the ordinary page mounts itself, another container is mounted by its owner
// ---------------------------------------------------------------------------------------------

const DEMO_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'"><title>demo</title><link rel="stylesheet" href="./app.css"></head><body><div id="demo-root"></div><script type="module" src="./demo.js"></script></body></html>`;
const DEMO_JS = `import { mountApp } from './app.js';
window.__mountDemo = () => mountApp(document.getElementById('demo-root'), { document, origin: location.origin, baseUrl: document.baseURI, fetch: globalThis.fetch.bind(globalThis) });
window.__ready = true;`;

test('the ordinary page mounts itself once; a page with another container mounts nothing until its owner calls mountApp', async ({ page, openSite, world, requested }) => {
  const site = await openSite({
    ...optedIn(world, (w) => ({ version: 0, agents: [{ id: 'secure', name: 'Secure', url: `${w.secure.origin}/agent` }] })),
    files: { '/demo.html': { type: 'text/html', body: DEMO_HTML }, '/demo.js': { type: 'text/javascript', body: DEMO_JS } },
  });

  // Ordinary root: automatic, and exactly once.
  await open(page, site);
  expect(requested.filter((url) => url === `${site.page.origin}/hosting-config.json`)).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toHaveCount(1);

  // A different container: the shared bundle loads, nothing starts, nothing is requested.
  requested.length = 0;
  await page.goto(`${site.page.origin}/demo.html`);
  await page.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true);
  await page.waitForTimeout(300);
  expect(requested.filter((url) => url.endsWith('/hosting-config.json') || url.endsWith('/config.json'))).toEqual([]);
  expect(await page.locator('#demo-root').innerHTML()).toBe('');
  expect(await page.locator('#root').count()).toBe(0);

  await page.evaluate(() => (window as unknown as { __mountDemo(): Promise<unknown> }).__mountDemo().then(() => undefined));
  await expect(page.locator('#demo-root').getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  await expect(page.locator('#demo-root').getByRole('contentinfo')).toContainText('requests to this origin, HTTPS targets and supported local servers');
  expect(requested.filter((url) => url === `${site.page.origin}/hosting-config.json`)).toHaveLength(1);
  await expect(page.locator('#demo-root').getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${world.secure.origin}/agent`);
});

