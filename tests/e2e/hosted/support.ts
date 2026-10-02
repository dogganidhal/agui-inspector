// L07 T051: the assembled application in a real browser. The page under test is the production build
// (`buildApp`, the same output `npm run build` ships, including hosting-config.json from public/),
// served from one loopback origin, with scripted model-free agents on others. Which agent origins
// the deployment allows is decided by the hosting-config.json the page server answers with, exactly as
// a static host's file would; the agents record what they receive, so a spec compares what reached
// them (cookies, headers, bodies) with what the page claims.
//
// Self-contained on purpose: it imports the build script and nothing from another lane's tests.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { buildApp } from '../../../scripts/build.mjs';

export const root = path.resolve(import.meta.dirname, '..', '..', '..');
export const SYNTHETIC_TOKEN = 'synthetic-token-7f3a91';
export const AGENT_REPLY = 'Hello from the scripted agent.';

export interface Seen {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly cookie: string | undefined;
  /** Whether the credential header arrived and what it held; the agent never echoes it back. */
  readonly token: string | undefined;
}

export interface Origin {
  readonly origin: string;
  /** Every request this origin received since it started. */
  readonly seen: Seen[];
}

export interface Site {
  readonly page: Origin;
  /** Grants CORS to the page; the deployment may allow it. */
  readonly agent: Origin;
  /** Grants CORS to the page too, but no deployment allows it: only the page's own policy stops requests to it. */
  readonly foreign: Origin;
  /** Answers like an agent but sends no CORS headers at all. */
  readonly closed: Origin;
}

export interface SiteOptions {
  /** What `hosting-config.json` holds, from the origins; returning `null` serves none (the page is embedded). Default: hosted, allowing `agent`. */
  readonly hosting?: (origins: Pick<Site, 'agent' | 'foreign' | 'closed'>) => object | string | null;
  /** What `config.json` holds on the page's origin, from the origins; `null` serves none. */
  readonly config?: ((origins: Pick<Site, 'agent' | 'foreign' | 'closed'>) => object | string | null) | undefined;
  /** Extra files on the page's origin, by path. */
  readonly files?: Record<string, { type: string; body: string }>;
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const V = 'v0.9';
const BASIC_CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** The a2ui_operations of a small form: a note field and a button whose context binds the data model. */
export const formOperations = [
  { version: V, createSurface: { surfaceId: 'form', catalogId: BASIC_CATALOG } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'form',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'send'] },
        { id: 'title', component: 'Text', text: 'Order check', variant: 'h3' },
        { id: 'send-label', component: 'Text', text: 'Send note' },
        { id: 'send', component: 'Button', child: 'send-label', variant: 'primary', action: { event: { name: 'send_note', context: { note: { path: '/note' } } } } },
      ],
    },
  },
  { version: V, updateDataModel: { surfaceId: 'form', path: '/', value: { note: 'first draft' } } },
];

const sse = (events: readonly object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const listen = (server: Server) => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
// close() alone waits for a connection that is mid-request, such as one the browser still has open
// when the test ends; dropping the connections lets the teardown finish at once.
const close = (server: Server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });

/** What every scripted agent answers, on whichever origin it is asked. */
function answer(pathname: string, input: { threadId?: unknown; runId?: unknown } | undefined, response: ServerResponse, redirectTo: () => string): void {
  if (pathname === '/redirect') {
    response.writeHead(302, { location: `${redirectTo()}/agent` });
    return void response.end();
  }
  if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
    response.writeHead(422, { 'content-type': 'application/json' });
    return void response.end('{"error":"threadId and runId must be strings"}');
  }
  const { threadId, runId } = input;
  const activity =
    pathname === '/surface'
      ? [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'activity-1', activityType: 'a2ui-surface', content: { a2ui_operations: formOperations }, replace: true }]
      : [{ type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: AGENT_REPLY }, { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' }];
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  response.end(sse([{ type: 'RUN_STARTED', threadId, runId }, ...activity, { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } }]));
}

function agentServer(seen: Seen[], cors: () => string | undefined, redirectTo: () => string, files: () => Record<string, string>): Server {
  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    const allowed = cors();
    if (allowed !== undefined && request.headers.origin === allowed) {
      response.setHeader('access-control-allow-origin', allowed);
      response.setHeader('vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      if (allowed !== undefined) {
        response.setHeader('access-control-allow-methods', 'POST, GET');
        response.setHeader('access-control-allow-headers', String(request.headers['access-control-request-headers'] ?? 'content-type'));
      }
      response.writeHead(204);
      return void response.end();
    }
    const body = await readBody(request);
    const tokenHeader = request.headers['authorization'] ?? request.headers['x-api-key'];
    seen.push({ method: request.method ?? '', path: pathname, body, cookie: request.headers.cookie, token: Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader });

    const file = files()[pathname];
    if (request.method === 'GET' && file !== undefined) {
      response.writeHead(200, { 'content-type': 'application/json' });
      return void response.end(file);
    }
    let input: { threadId?: unknown; runId?: unknown } | undefined;
    try {
      input = body === '' ? undefined : JSON.parse(body);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      return void response.end('{"error":"request body is not valid JSON"}');
    }
    answer(pathname, input, response, redirectTo);
  });
}

async function openSite(dist: string, options: SiteOptions): Promise<{ site: Site; stop(): Promise<void> }> {
  const pageSeen: Seen[] = [];
  const agentSeen: Seen[] = [];
  const foreignSeen: Seen[] = [];
  const closedSeen: Seen[] = [];
  let pageOrigin = '';
  let origins = { agent: { origin: '', seen: agentSeen }, foreign: { origin: '', seen: foreignSeen }, closed: { origin: '', seen: closedSeen } } as Pick<Site, 'agent' | 'foreign' | 'closed'>;

  const render = (value: object | string | null | undefined) => (value === null || value === undefined ? undefined : typeof value === 'string' ? value : JSON.stringify(value));
  const hostingOption = options.hosting ?? ((o: typeof origins) => ({ version: 0, mode: 'hosted', allowedOrigins: [o.agent.origin] }));
  const served = (name: 'hosting-config.json' | 'config.json'): string | undefined =>
    name === 'hosting-config.json' ? render(hostingOption(origins)) : options.config === undefined ? undefined : render(options.config(origins));

  const page = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (request.method === 'POST') {
      // The embedded case: the page's own origin is also the agent's.
      const body = await readBody(request);
      pageSeen.push({ method: 'POST', path: pathname, body, cookie: request.headers.cookie, token: request.headers.authorization });
      let input: { threadId?: unknown; runId?: unknown } | undefined;
      try {
        input = JSON.parse(body);
      } catch {
        input = undefined;
      }
      return answer(pathname, input, response, () => origins.foreign.origin);
    }
    pageSeen.push({ method: 'GET', path: pathname, body: '', cookie: request.headers.cookie, token: undefined });
    const extra = options.files?.[pathname];
    let content: string | Buffer | undefined = extra?.body;
    let type = extra?.type;
    if (content === undefined && (name === 'hosting-config.json' || name === 'config.json')) {
      content = served(name);
      type = 'application/json';
    } else if (content === undefined && /^[\w.-]+$/.test(name)) {
      try {
        content = readFileSync(path.join(dist, name));
        type = TYPES[path.extname(name)] ?? 'application/octet-stream';
      } catch {
        content = undefined;
      }
    }
    if (content === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      return void response.end('not found');
    }
    // The page's own cookie: a hosted page must never send it to a target.
    response.writeHead(200, { 'content-type': type ?? 'text/plain', 'set-cookie': 'session=page-cookie; Path=/' });
    response.end(content);
  });
  pageOrigin = await listen(page);

  const capabilities = JSON.stringify({ identity: { name: 'Scripted agent', version: '1.0.0' } });
  const agent = agentServer(agentSeen, () => pageOrigin, () => origins.foreign.origin, () => ({ '/capabilities': capabilities }));
  const foreign = agentServer(foreignSeen, () => pageOrigin, () => origins.foreign.origin, () => ({ '/capabilities': capabilities, '/config.json': JSON.stringify({ version: 0, agents: [{ id: 'foreign', url: `${origins.foreign.origin}/agent` }] }) }));
  const closed = agentServer(closedSeen, () => undefined, () => origins.foreign.origin, () => ({}));
  origins = {
    agent: { origin: await listen(agent), seen: agentSeen },
    foreign: { origin: await listen(foreign), seen: foreignSeen },
    closed: { origin: await listen(closed), seen: closedSeen },
  };
  return {
    site: { page: { origin: pageOrigin, seen: pageSeen }, ...origins },
    stop: async () => void (await Promise.all([close(page), close(agent), close(foreign), close(closed)])),
  };
}

export const test = base.extend<{ openSite(options?: SiteOptions): Promise<Site>; requested: string[]; violations: () => Promise<Array<{ directive: string; blocked: string }>> }, { dist: string }>({
  dist: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const dist = mkdtempSync(path.join(root, '.build', 'hosted-e2e-'));
      await buildApp(dist);
      await use(dist);
      rmSync(dist, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  openSite: async ({ dist }, use) => {
    const stops: Array<() => Promise<void>> = [];
    await use(async (options = {}) => {
      const opened = await openSite(dist, options);
      stops.push(opened.stop);
      return opened.site;
    });
    await Promise.all(stops.map((stop) => stop()));
  },

  // Every URL the page requests, by the browser's own account.
  requested: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await use(urls);
  },

  // Content security policy violations the page reported, read back from the page. A blocked `eval`
  // report is left out: zod's feature probe calls `new Function('')` once inside a try/catch to choose
  // its non-JIT path, and the browser reports the blocked probe. Nothing is evaluated (the policy spec
  // proves `new Function` throws); every other kind of violation is a failure.
  violations: async ({ page }, use) => {
    await page.addInitScript(() => {
      const found: Array<{ directive: string; blocked: string }> = [];
      (window as unknown as { __violations: typeof found }).__violations = found;
      document.addEventListener('securitypolicyviolation', (event) => found.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    });
    await use(async () => (await page.evaluate(() => (window as unknown as { __violations: Array<{ directive: string; blocked: string }> }).__violations)).filter((violation) => violation.blocked !== 'eval'));
  },
});

export { expect };

/** Opens the page and waits for the shell. */
export async function open(page: Page, site: Site): Promise<void> {
  await page.goto(site.page.origin);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
}

/** Types into the composer and sends with Enter. */
export async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}

/** A request the page made counts as allowed only when it went to one of these origins (or is inline data). */
export function expectAllowlisted(urls: readonly string[], origins: readonly string[]): void {
  for (const url of urls) {
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') continue;
    expect(origins.some((origin) => url.startsWith(`${origin}/`)), `unexpected request to ${url}`).toBe(true);
  }
}
