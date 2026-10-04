// L07 T051: the assembled application in a real browser. The page under test is the production build
// (`buildApp`, the same output `npm run build` ships, including hosting-config.json from public/),
// served from one loopback origin, with scripted model-free agents on others. Which agent origins
// the deployment allows is decided by the hosting-config.json the page server answers with, exactly as
// a static host's file would; the agents record what they receive, so a spec compares what reached
// them (cookies, headers, bodies) with what the page claims.
//
// Self-contained on purpose: it imports the build script and the reference agent's scenarios, and nothing from another lane's tests.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { contradictionEvents } from '../../../examples/reference-agent/rule-fixtures.ts';
import { interactiveResponse, SUBAGENTS, type RunInput } from '../../../examples/reference-agent/scenarios.ts';
import { buildApp } from '../../../scripts/build.mjs';
import { acceptsProtobuf, frameProtobuf, PROTOBUF_MEDIA_TYPE } from '../../../examples/reference-agent/protobuf.ts';

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
  /** The Accept header as it arrived: the encoding the page asked for. */
  readonly accept?: string | undefined;
  /** Every header as it arrived, names in lower case. A spec reads the headers a plugin provided from here. */
  readonly headers?: IncomingHttpHeaders;
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
  /** Extra files on the page's origin, by path. Read on every request, so a test may add one once the origins are known. `redirect` answers 302 to that URL instead. */
  readonly files?: Record<string, { type: string; body: string; redirect?: string }>;
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


/** The id an agent still uses for the basic catalog, which only a config alias makes known. */
export const FORMER_CATALOG = 'https://catalog.invalid/old/basic.json';

const formerCatalogOperations = formOperations.map((operation) => ('createSurface' in operation ? { ...operation, createSurface: { ...operation.createSurface, catalogId: FORMER_CATALOG } } : operation));

/** A reply in five deltas, then a subagent that starts and finishes: every place the conversation shows an offset and a frame reference. */
const evidenceEvents = [
  { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' },
  ...['Hello', ' there', ',', ' how can', ' I help?'].map((delta) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta })),
  { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' },
  { type: 'SUBAGENT_STARTED', subagentRunId: 'sub-1', name: 'synthetic-researcher', parentToolCallId: 'tc-1' },
  { type: 'SUBAGENT_FINISHED', subagentRunId: 'sub-1', outcome: { type: 'success' } },
];

/**
 * One run of the reveal scenario, whose frame indices are the same on every turn: a state snapshot, a reply in three
 * deltas, then a valid delta for a message that never started (the projection reports it as "Not shown"). The deltas
 * carry the turn, so a spec can tell which exchange a revealed frame belongs to.
 */
const revealEvents = (turn: number) => [
  { type: 'STATE_SNAPSHOT', snapshot: { turn } },
  { type: 'TEXT_MESSAGE_START', messageId: `reply-${turn}`, role: 'assistant' },
  ...['a', 'b', 'c'].map((part) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: `reply-${turn}`, delta: `turn ${turn} part ${part}` })),
  { type: 'TEXT_MESSAGE_END', messageId: `reply-${turn}` },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: `ghost-${turn}`, delta: `turn ${turn} orphan` },
];

/** The `/state-history` scenario: a snapshot, a delta with two operations, a delta that cannot apply, a second snapshot and a last delta. */
const historyEvents = [
  { type: 'STATE_SNAPSHOT', snapshot: { round: 0, items: ['a'] } },
  { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/round', value: 1 }, { op: 'add', path: '/items/-', value: 'b' }] },
  { type: 'STATE_DELTA', delta: [{ op: 'remove', path: '/missing' }] },
  { type: 'STATE_SNAPSHOT', snapshot: { round: 10, items: [] } },
  { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/round', value: 11 }] },
];

/** The reference agent's scripted "subagents" run (nested and parallel subagents, one failing), without the RUN_STARTED and RUN_FINISHED that `answer` adds. */
const subagentEvents = (runId: string): object[] =>
  interactiveResponse({ threadId: 'unused', runId, messages: [{ role: 'user', content: SUBAGENTS }] })
    .chunks.map((chunk) => JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /, '').trim()) as object)
    .slice(1, -1);

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
function answer(pathname: string, input: { threadId?: unknown; runId?: unknown; messages?: unknown } | undefined, response: ServerResponse, redirectTo: () => string, accept?: string): void {
  if (pathname === '/redirect') {
    response.writeHead(302, { location: `${redirectTo()}/agent` });
    return void response.end();
  }
  if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
    response.writeHead(422, { 'content-type': 'application/json' });
    return void response.end('{"error":"threadId and runId must be strings"}');
  }
  const { threadId, runId } = input;
  if (pathname === '/interactive') {
    // The reference agent's interactive scenarios (interrupts, client tools), so a spec can drive replies through the real app.
    const reply = interactiveResponse(input as RunInput);
    response.writeHead(reply.status, { 'content-type': reply.contentType, 'cache-control': 'no-store' });
    for (const chunk of reply.chunks) response.write(chunk);
    return void response.end();
  }
  if (pathname === '/contradiction') {
    // A whole run, from the reference fixtures, that breaks what an agent can declare false.
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    return void response.end(sse(contradictionEvents({ threadId, runId })));
  }
  const activity =
    pathname === '/surface' || pathname === '/former-catalog'
      ? [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'activity-1', activityType: 'a2ui-surface', content: { a2ui_operations: pathname === '/surface' ? formOperations : formerCatalogOperations }, replace: true }]
      : pathname === '/evidence'
        ? evidenceEvents
        : pathname === '/reveal'
          ? revealEvents(Array.isArray(input.messages) ? input.messages.filter((message) => (message as { role?: unknown }).role === 'user').length : 1)
          : pathname === '/state-history'
            ? historyEvents
            : pathname === '/subagents'
              ? subagentEvents(runId)
              : [{ type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: AGENT_REPLY }, { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' }];
  const events = [{ type: 'RUN_STARTED', threadId, runId }, ...activity, { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } }];
  // A server written with EventEncoder: protobuf when the request's Accept asks for it, server-sent events otherwise.
  if (acceptsProtobuf(accept)) {
    response.writeHead(200, { 'content-type': PROTOBUF_MEDIA_TYPE, 'cache-control': 'no-store' });
    return void response.end(Buffer.concat(events.map((event) => Buffer.from(frameProtobuf(event)))));
  }
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  response.end(sse(events));
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
    seen.push({ method: request.method ?? '', path: pathname, body, cookie: request.headers.cookie, token: Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader, accept: request.headers.accept, headers: request.headers });

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
    answer(pathname, input, response, redirectTo, request.headers.accept);
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
      pageSeen.push({ method: 'POST', path: pathname, body, cookie: request.headers.cookie, token: request.headers.authorization, headers: request.headers });
      let input: { threadId?: unknown; runId?: unknown } | undefined;
      try {
        input = JSON.parse(body);
      } catch {
        input = undefined;
      }
      return answer(pathname, input, response, () => origins.foreign.origin, request.headers.accept);
    }
    pageSeen.push({ method: 'GET', path: pathname, body: '', cookie: request.headers.cookie, token: undefined });
    const extra = options.files?.[pathname];
    if (extra?.redirect !== undefined) {
      response.writeHead(302, { location: extra.redirect });
      return void response.end();
    }
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
  // What the agent served at /contradiction declares false: a reasoning span, a state delta and an interrupt outcome.
  const contradicted = JSON.stringify({ reasoning: { supported: false }, state: { deltas: false }, humanInTheLoop: { interrupts: false } });
  const agent = agentServer(agentSeen, () => pageOrigin, () => origins.foreign.origin, () => ({ '/capabilities': capabilities, '/capabilities-contradicted': contradicted }));
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
