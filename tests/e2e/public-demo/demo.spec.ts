// P03 T014 (US1, US3, FR-001 to FR-006, FR-009 to FR-012, FR-015, FR-016, SC-001, SC-002, SC-004, SC-006;
// G-D03): the public demo in a real browser, with the real service worker. The page under test is the
// isolated demo build (`buildDemo`, the same output the Pages workflow deploys) served under
// `/agui-inspector/` from one loopback origin that logs every request it receives. Example endpoints are
// answered by the actual worker, never by a request stub, so a test sees what the page's own fetch,
// recorder and frame reader saw: the exported session is compared byte for byte with what the shared
// reference producers generate for the request the page actually sent.
//
// Every test starts in a fresh browser context: no controller, no storage, nothing cached.
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { EventType } from '@ag-ui/core';
import { expect, test as base, type Locator, type Page, type Worker } from '@playwright/test';
import { createInteractiveServer, type InteractiveServer } from '../../../examples/reference-agent/interactive-scenarios.ts';
import { a2uiResponse, baselineResponse, interactiveResponse, runErrorResponse, type RunInput, type ScenarioResponse } from '../../../examples/reference-agent/scenarios.ts';
import { buildDemo } from '../../../scripts/build-demo.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const BASE_PATH = '/agui-inspector/';

// ---------------------------------------------------------------------------------------------
// The site: the built demo under its sub-path, a request log, and stand-ins for the worker script
// ---------------------------------------------------------------------------------------------

type WorkerMode = 'real' | 'silent' | 'stale' | 'broken';

/** Installs, claims and never answers: a worker that matches the script but cannot say it is ready. */
const SILENT_WORKER = `
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
`;

/** An older version of the worker: it answers the handshake, with version 0. */
const STALE_WORKER = `
const READY = { type: 'agui-demo-ready', version: 0, ready: true };
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim().then(() => self.clients.matchAll({ includeUncontrolled: true })).then((all) => all.forEach((client) => client.postMessage(READY)))));
self.addEventListener('message', (event) => { if (event.data && event.data.type === 'agui-demo-hello') event.source.postMessage(READY); });
`;

interface Logged {
  readonly method: string;
  readonly path: string;
  readonly cookie: string | undefined;
}

interface Site {
  readonly origin: string;
  readonly base: string;
  /** Every request the page's own server received, in order. The worker answers example routes, so none of those arrive. */
  readonly requests: Logged[];
  /** Which script the server answers for `service-worker.js`; changeable between page loads. */
  worker: WorkerMode;
  /** Milliseconds to hold the worker script, to keep the page visibly preparing. */
  workerDelay: number;
  /** A visitor's own server on another origin, CORS-open to this page. */
  visitor(): Promise<InteractiveServer>;
}

interface Demo {
  readonly dir: string;
  readonly port: number;
  readonly origin: string;
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

async function listen(server: Server, port = 0): Promise<number> {
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}
const close = (server: Server) => new Promise((resolve) => server.close(resolve));

async function openSite(demo: Demo, cleanups: Array<() => Promise<unknown>>): Promise<Site> {
  const files = new Set(['index.html', 'app.js', 'app.css', 'bootstrap.js', 'demo.css', 'hosting-config.json', 'examples.json']);
  const site: Site = {
    origin: demo.origin,
    base: `${demo.origin}${BASE_PATH}`,
    requests: [],
    worker: 'real',
    workerDelay: 0,
    visitor: async () => {
      const visitor = await createInteractiveServer({ allowOrigin: demo.origin });
      cleanups.push(() => visitor.close());
      return visitor;
    },
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    for await (const _ of request) void _;
    site.requests.push({ method: request.method ?? '', path: url.pathname, cookie: request.headers.cookie });
    // A cookie on the page's host: a hosted page must never send it to a target.
    const headers = { 'set-cookie': 'session=page-cookie; Path=/', 'cache-control': 'no-cache' };
    const name = url.pathname.startsWith(BASE_PATH) ? url.pathname.slice(BASE_PATH.length) || 'index.html' : undefined;
    if (request.method === 'GET' && name === 'service-worker.js') {
      if (site.workerDelay > 0) await new Promise((resolve) => setTimeout(resolve, site.workerDelay));
      if (site.worker === 'broken') {
        response.writeHead(500, { 'content-type': 'text/plain' });
        return void response.end('broken');
      }
      const body = site.worker === 'silent' ? SILENT_WORKER : site.worker === 'stale' ? STALE_WORKER : readFileSync(path.join(demo.dir, 'service-worker.js'));
      response.writeHead(200, { ...headers, 'content-type': 'text/javascript' });
      return void response.end(body);
    }
    if (request.method === 'GET' && name !== undefined && files.has(name)) {
      response.writeHead(200, { ...headers, 'content-type': TYPES[path.extname(name)] ?? 'text/plain' });
      return void response.end(readFileSync(path.join(demo.dir, name)));
    }
    response.writeHead(404, { ...headers, 'content-type': 'text/plain' });
    response.end('not found');
  });
  await listen(server, demo.port);
  cleanups.push(() => close(server));
  return site;
}

/** A port nothing is using right now, so the build can name the origin the tests will serve from. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await close(probe);
  return port;
}

const test = base.extend<{ open(): Promise<Site>; requested: string[]; violations: () => Promise<Array<{ directive: string; blocked: string }>> }, { demo: Demo }>({
  demo: [
    async ({}, use) => {
      const port = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const dir = mkdtempSync(path.join(root, '.build', 'public-demo-e2e-'));
      await buildDemo({ outdir: dir, basePath: BASE_PATH, origin });
      await use({ dir, port, origin });
      rmSync(dir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  open: async ({ demo }, use) => {
    const cleanups: Array<() => Promise<unknown>> = [];
    await use(() => openSite(demo, cleanups));
    await Promise.all(cleanups.map((cleanup) => cleanup()));
  },

  // Every URL the page requests, by the browser's own account, worker-answered ones included.
  requested: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await use(urls);
  },

  // Content security policy violations the page reported; a blocked `eval` probe from zod's feature test is not one.
  violations: async ({ page }, use) => {
    await page.addInitScript(() => {
      const found: Array<{ directive: string; blocked: string }> = [];
      (window as unknown as { __violations: typeof found }).__violations = found;
      document.addEventListener('securitypolicyviolation', (event) => found.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
    });
    await use(async () => (await page.evaluate(() => (window as unknown as { __violations: Array<{ directive: string; blocked: string }> }).__violations)).filter((violation) => violation.blocked !== 'eval'));
  },
});

// ---------------------------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------------------------

/** The plain answer as the conversation shows it, not the frame summary that quotes it. */
const reply = (page: Page) => page.getByText('Hello from the reference agent.', { exact: true });
const heading = (page: Page) => page.getByRole('heading', { name: 'agui-inspector', level: 1 });
const status = (page: Page) => page.locator('#demo-status');
const messageBox = (page: Page) => page.getByLabel('Message', { exact: true });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' });
const quick = (page: Page, text: string) => page.getByRole('button', { name: text, exact: true });
const card = (page: Page, interruptId: string): Locator => page.locator(`[data-entry="interrupt"][data-interrupt="${interruptId}"]`);
const toolCard = (page: Page, toolCallId: string): Locator => page.locator(`[data-entry="tool-result"][data-tool-call="${toolCallId}"]`);

/** Loads the demo page and waits for the shared app, which mounts once the examples are ready or known unavailable. */
async function openDemo(page: Page, site: Site): Promise<void> {
  await page.goto(site.base);
  await expect(heading(page)).toBeVisible();
}

/** Chooses an example agent by its name, from the picker beside the endpoint. */
async function chooseAgent(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: /^Agent / }).click();
  await page.getByRole('banner').getByRole('listitem').getByRole('button', { name }).click();
}

/** Types into the composer and sends with Enter. */
async function send(page: Page, text: string): Promise<void> {
  await messageBox(page).fill(text);
  await messageBox(page).press('Enter');
}

/** The run has ended: nothing streams and the composer takes a message again. */
async function idle(page: Page): Promise<void> {
  await expect(stopButton(page)).toBeDisabled();
  await expect(messageBox(page)).toBeEnabled();
}

interface Session {
  exchanges: Array<{ id: string; kind: string; method: string; path: string; status?: number; transport: string; requestBody?: string; responseBody?: string }>;
  frames: Array<{ exchangeId: string; index: number; classification: string; envelope: string; eventType?: string; jsonVerdict: string }>;
  runs: Array<{ outcome: { kind: string } }>;
  findings: Array<{ kind: string }>;
}

/** The session as the user would save it, read from the real export. */
async function exportSession(page: Page): Promise<Session> {
  await page.getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('can contain personal or sensitive data');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export session' }).click()]);
  const file = await download.path();
  return (JSON.parse(readFileSync(file, 'utf8')) as { session: Session }).session;
}

const conversations = (session: Session) => session.exchanges.filter((exchange) => exchange.kind === 'conversation');
const framesOf = (session: Session, exchangeId: string) => session.frames.filter((frame) => frame.exchangeId === exchangeId).sort((a, b) => a.index - b.index);
/** The response body as recorded: the original envelopes, delimiters included, in arrival order. */
const wireOf = (session: Session, exchangeId: string) => framesOf(session, exchangeId).map((frame) => frame.envelope).join('');
const decode = (response: ScenarioResponse) => new TextDecoder().decode(Buffer.concat(response.chunks));

/** What the shared producers answer for the run input the page actually sent to this example route. */
function produced(exchange: { path: string; requestBody?: string }): ScenarioResponse {
  const input = JSON.parse(exchange.requestBody ?? '') as RunInput;
  if (exchange.path.endsWith('/__demo__/agent/interactive')) return interactiveResponse(input);
  if (exchange.path.endsWith('/__demo__/agent/a2ui')) return a2uiResponse(input);
  if (exchange.path.endsWith('/__demo__/agent/protocol/baseline')) return baselineResponse(input);
  if (exchange.path.endsWith('/__demo__/agent/protocol/run-error')) return runErrorResponse(input);
  throw new Error(`no producer for ${exchange.path}`);
}

/** Every conversation exchange carries exactly the bytes the producer generates for its request. */
function expectProducedBytes(session: Session): void {
  expect(conversations(session).length).toBeGreaterThan(0);
  for (const exchange of conversations(session)) {
    expect(exchange.status, exchange.path).toBe(200);
    expect(wireOf(session, exchange.id), `bytes of ${exchange.path}`).toBe(decode(produced(exchange)));
  }
}

const runBody = (exchange: { requestBody?: string }) => JSON.parse(exchange.requestBody ?? '') as RunInput & { parentRunId?: string; threadId: string; messages: Array<{ role: string; content?: string; toolCallId?: string }>; forwardedProps?: Record<string, unknown> };

/** After each test: the page may have asked its own origin for the demo's files and a visitor's server, and nothing else. */
function onlyOwnOrigin(urls: readonly string[], origin: string, allowed: readonly string[] = []): void {
  const outside = urls.filter((url) => !url.startsWith(`${origin}/`) && !allowed.some((a) => url.startsWith(`${a}/`)) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank');
  expect(outside, 'requests outside the demo origin').toEqual([]);
}

const EXAMPLE_ROUTE = `${BASE_PATH}__demo__/`;
const exampleRequests = (urls: readonly string[]) => urls.filter((url) => url.includes('/__demo__/'));

// ---------------------------------------------------------------------------------------------
// First visit
// ---------------------------------------------------------------------------------------------

test('a fresh visit prepares, becomes ready under the sub-path within 10 seconds, mounts once, and runs the first example without a reload', async ({ page, open, requested, violations }) => {
  const site = await open();
  site.workerDelay = 1200; // keeps the page visibly preparing long enough to look at
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations.push(frame.url()));

  const started = Date.now();
  await page.goto(site.base, { waitUntil: 'commit' });
  // Preparing: native status text, no app, no example control, no request to an example route.
  await expect(status(page)).toHaveText('Preparing the browser-local examples…');
  await expect(status(page)).toHaveAttribute('role', 'status');
  await expect(heading(page)).toHaveCount(0);
  await expect(quick(page, 'Hello there')).toHaveCount(0);
  expect(exampleRequests(requested)).toEqual([]);

  await expect(heading(page)).toBeVisible();
  expect(Date.now() - started, 'ready within the 10 second bound').toBeLessThan(10_000);
  await expect(status(page)).toContainText('Browser-local examples are ready');
  // Control, scope and cache policy are the contract's, and no worker is cached or stored by the page.
  const registration = await page.evaluate(async () => {
    const found = await navigator.serviceWorker.getRegistration();
    return { scope: found?.scope, script: navigator.serviceWorker.controller?.scriptURL, updateViaCache: found?.updateViaCache };
  });
  expect(registration).toEqual({ scope: site.base, script: `${site.base}service-worker.js`, updateViaCache: 'none' });

  // The shared app mounted exactly once, into a separate root, and the demo files were asked for once each.
  await expect(heading(page)).toHaveCount(1);
  await expect(page.locator('#root')).toHaveCount(1);
  await expect(page.locator('#demo-mount')).toHaveCount(0);
  const asked = (name: string) => requested.filter((url) => url === `${site.base}${name}`).length;
  expect([asked('hosting-config.json'), asked('examples.json'), asked('bootstrap.js'), asked('app.js')]).toEqual([1, 1, 1, 1]);
  // The worker script is fetched by the browser itself, so the server's own log is where it shows.
  expect(site.requests.filter((request) => request.path === `${BASE_PATH}service-worker.js`)).toHaveLength(1);
  expect(requested.some((url) => url === `${site.base}config.json`), 'the demo ships no config.json to ask for').toBe(false);

  // Distinguishes a scripted example from a real endpoint, links the embedding guide, and does not fetch it.
  await expect(page.getByText(/scripted agents that run inside this page/)).toBeVisible();
  const guide = page.getByRole('link', { name: 'Embedding guide' });
  await expect(guide).toHaveAttribute('href', 'https://github.com/dogganidhal/agui-inspector/blob/main/docs/embedding.md');
  await expect(guide).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('[data-view="footer"]')).toContainText('requests to this origin, HTTPS targets and supported local servers');

  // First run: preparations in order, then the run, all answered by the worker. Nothing reached the page's server.
  await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${site.base}__demo__/agent/interactive`);
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  const calls = exampleRequests(requested).map((url) => url.replace(site.base, '').replace(/sessions\/[^/]+$/, 'sessions/_'));
  expect(calls).toEqual(['__demo__/prepare/sessions/_', '__demo__/prepare/warm', '__demo__/agent/interactive']);
  expect(site.requests.filter((request) => request.method !== 'GET'), 'no POST or PUT ever reached the static host').toEqual([]);
  expect(site.requests.filter((request) => request.path.includes('__demo__'))).toEqual([]);
  await idle(page);
  expectProducedBytes(await exportSession(page));

  expect(navigations, 'no manual or automatic reload').toEqual([site.base]);
  onlyOwnOrigin(requested, site.origin);
  expect(await violations(), 'the demo policy and the startup policy leave the worker and the app nothing to violate').toEqual([]);
});

test('a second visit finds the worker already in control and neither waits nor registers a duplicate app', async ({ page, open, requested }) => {
  const site = await open();
  await openDemo(page, site);
  await expect(status(page)).toContainText('Browser-local examples are ready');
  requested.length = 0;

  await page.reload();
  await expect(heading(page)).toBeVisible();
  await expect(status(page)).toContainText('Browser-local examples are ready');
  await expect(heading(page)).toHaveCount(1);
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  expect(exampleRequests(requested).map((url) => url.replace(site.base, '')).at(-1)).toBe('__demo__/agent/interactive');
});

// ---------------------------------------------------------------------------------------------
// The six interactive scenarios
// ---------------------------------------------------------------------------------------------

test('plain, state and broken runs carry exactly the reference bytes, and the damage in the broken run stays inspectable', async ({ page, open }) => {
  const site = await open();
  await openDemo(page, site);

  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  await idle(page);

  await quick(page, 'state').click();
  await idle(page);
  await page.getByRole('button', { name: 'State', exact: true }).click();
  await expect(page.getByText(/"counter": 2/).filter({ visible: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Inspection', exact: true }).first().click();

  await quick(page, 'broken').click();
  await idle(page);

  const session = await exportSession(page);
  expectProducedBytes(session);
  const runs = conversations(session);
  expect(runs).toHaveLength(3);
  expect(framesOf(session, runs[1]!.id).map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'STATE_SNAPSHOT', 'STATE_DELTA', 'RUN_FINISHED']);
  // The client rejects the run at the first invalid event, yet every later byte is recorded, as received.
  const broken = framesOf(session, runs[2]!.id);
  expect(broken.map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_CONTENT', undefined, 'STEP_STARTED', 'STEP_FINISHED', 'RUN_FINISHED']);
  expect(broken[2]).toMatchObject({ jsonVerdict: 'invalid', envelope: 'data: {not json at all\n\n' });
  expect(session.findings.some((finding) => finding.kind === 'json')).toBe(true);
  expect(session.findings.some((finding) => finding.kind === 'sequence')).toBe(true);
  // Preparations ran before each run, in order.
  expect(session.exchanges.filter((exchange) => exchange.kind === 'preparation').map((exchange) => exchange.method)).toEqual(['PUT', 'POST', 'PUT', 'POST', 'PUT', 'POST']);
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('interrupts: resolved and cancelled answers go out together, and the continuation matches the shared producer', async ({ page, open }) => {
  const site = await open();
  await openDemo(page, site);
  await quick(page, 'interrupt').click();

  await expect(card(page, 'i-approve')).toBeVisible();
  await expect(card(page, 'i-contact')).toBeVisible();
  await expect(page.getByText('2 interrupts waiting. Answer them to continue the run.')).toBeVisible();
  await page.getByLabel('Answer for interrupt i-approve').fill('{"approved": true, "note": "ok"}');
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await expect(card(page, 'i-approve')).toHaveAttribute('data-status', 'resolved');
  await page.waitForTimeout(200);
  expect(conversations(await exportSession(page)), 'one of two answered: no continuation').toHaveLength(1);
  await page.getByRole('button', { name: 'Cancel interrupt i-contact' }).click();

  await expect(page.getByText('Resumed with i-approve=resolved:{"approved":true,"note":"ok"}, i-contact=cancelled', { exact: true })).toBeVisible();
  await idle(page);
  const session = await exportSession(page);
  expectProducedBytes(session);
  const [first, resume] = conversations(session).map(runBody);
  expect(resume?.resume).toEqual([
    { interruptId: 'i-approve', status: 'resolved', payload: { approved: true, note: 'ok' } },
    { interruptId: 'i-contact', status: 'cancelled' },
  ]);
  expect(resume?.threadId).toBe(first?.threadId);
  expect(resume?.parentRunId).toBe(first?.runId);
  expect(session.runs[0]?.outcome.kind).toBe('interrupt');
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('tools: no run starts on a subset of replies, and every result rides in the next run', async ({ page, open }) => {
  const site = await open();
  await openDemo(page, site);
  await quick(page, 'tools').click();

  await expect(toolCard(page, 'c-color')).toBeVisible();
  await expect(toolCard(page, 'c-size')).toBeVisible();
  await expect(page.getByText('2 tool calls waiting for results. Enter them to continue the run.')).toBeVisible();
  await page.getByLabel('Result for pick_color (c-color)').fill('"teal"');
  await page.getByRole('button', { name: 'Submit result for c-color' }).click();
  await expect(toolCard(page, 'c-color')).toHaveAttribute('data-status', 'answered');
  await page.waitForTimeout(200);
  expect(conversations(await exportSession(page)), 'one of two results: no continuation').toHaveLength(1);

  await page.getByLabel('Result for pick_size (c-size)').fill('3');
  await page.getByRole('button', { name: 'Submit result for c-size' }).click();
  await expect(page.getByText('Tool results: c-color="teal", c-size=3', { exact: true })).toBeVisible();
  await idle(page);
  const session = await exportSession(page);
  expectProducedBytes(session);
  const [first, second] = conversations(session).map(runBody);
  expect(second?.messages.filter((message) => message.role === 'tool').map((message) => [message.toolCallId, message.content])).toEqual([
    ['c-color', '"teal"'],
    ['c-size', '3'],
  ]);
  expect(second?.parentRunId).toBe(first?.runId);
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Slow responses and Stop (G-D03)
// ---------------------------------------------------------------------------------------------

/**
 * Counts how many of the worker's response streams were cancelled by their reader. A page that is stopped
 * cancels both the client's branch and the recorder's; a tee cancels its source only when both have gone,
 * so one count here means the held-open producer was released. Test-side instrumentation of the worker's
 * global only: the product is untouched.
 */
async function countCancellations(worker: Worker): Promise<() => Promise<number>> {
  await worker.evaluate(() => {
    type Source = { cancel?: (reason: unknown) => unknown } & Record<string, unknown>;
    const scope = globalThis as unknown as { __cancelled: number; ReadableStream: unknown };
    scope.__cancelled = 0;
    const Native = scope.ReadableStream as new (source?: Source, strategy?: unknown) => object;
    scope.ReadableStream = class extends Native {
      constructor(source?: Source, strategy?: unknown) {
        if (source?.cancel !== undefined) {
          const cancel = source.cancel.bind(source);
          source = {
            ...source,
            cancel: (reason: unknown) => {
              scope.__cancelled += 1;
              return cancel(reason);
            },
          };
        }
        super(source, strategy);
      }
    };
  });
  return () => worker.evaluate(() => (globalThis as unknown as { __cancelled: number }).__cancelled);
}

test('slow: bytes arrive while the response is held open, and Stop releases the client, the recorder and the producer', async ({ page, context, open }) => {
  const site = await open();
  await openDemo(page, site);
  const [worker] = context.serviceWorkers();
  expect(worker, 'the demo worker is running').toBeDefined();
  const cancelled = await countCancellations(worker!);

  await quick(page, 'slow').click();
  // Incremental: the text is on screen while the response is still open and Stop is live.
  await expect(page.getByText('Thinking about it', { exact: true })).toBeVisible();
  await expect(stopButton(page)).toBeEnabled();
  await expect(messageBox(page)).toBeDisabled();
  expect(await cancelled(), 'held open: nothing is cancelled yet').toBe(0);

  await stopButton(page).click();
  await idle(page);
  await expect.poll(cancelled, 'the page cancelled both of its readers, so the held-open producer was released').toBe(1);

  const session = await exportSession(page);
  const [slow] = conversations(session);
  expect(slow?.transport).toBe('user-stopped');
  // The partial evidence is kept as received, and no terminal frame was made up.
  expect(framesOf(session, slow!.id).map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
  expect(wireOf(session, slow!.id)).toBe(decode(produced(slow!)));
  expect(session.runs[0]?.outcome).toEqual({ kind: 'unknown' });
  expect(session.findings.filter((finding) => finding.kind === 'terminal')).toHaveLength(1);
  await expect(page.locator('[data-entry="run"]')).toContainText('Stopped by you');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Nothing is left over: the next example runs.
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('slow: stopping the moment the run starts keeps what arrived, makes up no terminal frame and leaves the example usable', async ({ page, open }) => {
  const site = await open();
  await openDemo(page, site);
  await quick(page, 'slow').click();
  await expect(stopButton(page)).toBeEnabled();
  await stopButton(page).click();
  await idle(page);

  const session = await exportSession(page);
  const [slow] = conversations(session);
  expect(slow?.transport).toBe('user-stopped');
  const types = framesOf(session, slow!.id).map((frame) => frame.eventType);
  expect(types).not.toContain('RUN_FINISHED');
  expect(types).not.toContain('RUN_ERROR');
  expect(wireOf(session, slow!.id)).toBe(decode(produced(slow!)).slice(0, wireOf(session, slow!.id).length));

  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// A2UI and the protocol examples
// ---------------------------------------------------------------------------------------------

test('the four example agents are one choice away in the top bar, and a typed endpoint reads Custom URL', async ({ page, open }) => {
  const site = await open();
  await openDemo(page, site);
  const endpoint = page.getByRole('textbox', { name: 'Endpoint URL' });
  const picker = (name: string) => page.getByRole('banner').getByRole('button', { name: `Agent ${name}`, exact: true });

  await expect(picker('Interactive scenarios (browser-local example)')).toBeVisible();
  await expect(endpoint).toHaveValue(`${site.base}__demo__/agent/interactive`);
  await expect(quick(page, 'Hello there')).toBeVisible();

  await picker('Interactive scenarios (browser-local example)').click();
  const options = page.getByRole('banner').getByRole('listitem');
  await expect(options).toHaveCount(4);
  await options.getByRole('button', { name: /A2UI form/ }).click();
  await expect(picker('A2UI form (browser-local example)')).toBeVisible();
  await expect(endpoint).toHaveValue(`${site.base}__demo__/agent/a2ui`);
  await expect(quick(page, 'Show the order form')).toBeVisible();
  await expect(quick(page, 'Hello there')).toHaveCount(0);

  // Settings is the same selection, from the other side.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('[data-view="settings"]').getByRole('button', { name: 'A2UI form (browser-local example)', exact: true })).toBeVisible();

  await endpoint.fill(`${site.origin}/my-own-agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await expect(picker('Custom URL')).toBeVisible();
  await expect(page.locator('[data-view="settings"]').getByRole('button', { name: 'Custom URL', exact: true })).toBeVisible();
  await expect(quick(page, 'Show the order form')).toHaveCount(0);
});

test('A2UI: the form renders, its edited action starts a new run, and the surface changes in place', async ({ page, open, requested }) => {
  const site = await open();
  await openDemo(page, site);
  await chooseAgent(page, /A2UI form/);
  await quick(page, 'Show the order form').click();

  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Note' }).fill('edited in the demo');
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect(page.getByText('Received send_note from send on form: {"note":"edited in the demo","count":1}', { exact: true })).toBeVisible();
  await idle(page);

  const session = await exportSession(page);
  expectProducedBytes(session);
  const [form, action] = conversations(session).map(runBody);
  expect(form?.forwardedProps).toBeDefined();
  expect(action?.forwardedProps?.a2uiAction).toMatchObject({ userAction: { name: 'send_note', surfaceId: 'form', sourceComponentId: 'send', context: { note: 'edited in the demo', count: 1 } } });
  expect(session.runs).toHaveLength(2);
  // A new run on the same endpoint, recorded like any other.
  expect(conversations(session).map((exchange) => exchange.path.replace(BASE_PATH, '/'))).toEqual(['/__demo__/agent/a2ui', '/__demo__/agent/a2ui']);
  // The surface stays local: no remote asset, catalog or script was fetched.
  onlyOwnOrigin(requested, site.origin);
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('baseline and run-error together retain all 31 event types, original frames and delimiters unchanged', async ({ page, open }) => {
  const site = await open();
  await openDemo(page, site);

  await chooseAgent(page, /Protocol baseline/);
  await quick(page, 'Run the baseline protocol example').click();
  await expect(page.locator('[data-exchange] [data-frame-row]').first()).toBeVisible();
  await idle(page);
  await chooseAgent(page, /Protocol run error/);
  await quick(page, 'Run the failing example').click();
  await idle(page);
  await expect(page.getByText('RUN_ERROR').first()).toBeVisible();

  const session = await exportSession(page);
  expectProducedBytes(session);
  const types = new Set(session.frames.map((frame) => frame.eventType));
  expect([...types].filter((type): type is string => type !== undefined).sort()).toEqual(Object.keys(EventType).sort());
  const [baseline] = conversations(session);
  // Mixed delimiters and byte-sized chunks arrive as the producer wrote them: the recording is not normalized.
  const envelopes = framesOf(session, baseline!.id).map((frame) => frame.envelope);
  expect(envelopes.some((envelope) => envelope.endsWith('\r\n\r\n'))).toBe(true);
  expect(envelopes.some((envelope) => envelope.endsWith('\r\r'))).toBe(true);
  expect(envelopes.some((envelope) => envelope.endsWith('\n\n') && !envelope.endsWith('\r\n\r\n'))).toBe(true);
  // The ids in the response are the ones in the request the page sent.
  expect(wireOf(session, baseline!.id)).toContain(`"runId":"${runBody(baseline!).runId}"`);
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Scope, network and storage
// ---------------------------------------------------------------------------------------------

test('the worker answers exactly its reserved routes: nothing else is replaced, cached or proxied', async ({ page, open }) => {
  const site = await open();
  const visitor = await site.visitor();
  await openDemo(page, site);
  const body = JSON.stringify({ threadId: 't-scope', runId: 'r-scope', messages: [] });

  const probe = (url: string, method = 'POST') =>
    page.evaluate(async ([target, verb, payload]) => {
      try {
        const response = await fetch(target!, { method: verb!, body: verb === 'GET' ? undefined : payload!, credentials: 'omit' });
        return { status: response.status, text: await response.text() };
      } catch (error) {
        return { error: String(error) };
      }
    }, [url, method, body] as const);

  // Reserved and answered by the worker: a stream, a local JSON 404, and errors that are visible bodies.
  expect((await probe(`${site.base}__demo__/agent/interactive`)).status).toBe(200);
  expect(await probe(`${site.base}__demo__/nope`)).toEqual({ status: 404, text: '{"error":"not found"}' });
  expect((await probe(`${site.base}__demo__/prepare/sessions/a/b`, 'PUT')).status, 'a session is exactly one segment, not a prefix').toBe(404);
  expect((await probe(`${site.base}__demo__/agent/interactive`, 'GET')).status).toBe(405);
  expect((await probe(`${site.base}__demo__/agent/interactive`, 'PUT')).status).toBe(405);
  expect(site.requests.filter((request) => request.path.includes('__demo__'))).toEqual([]);

  // Not reserved: each reaches the host that owns it, unchanged.
  expect(await probe(`${site.base}asset-that-is-not-there.txt`, 'GET')).toEqual({ status: 404, text: 'not found' });
  expect(await probe(`${site.origin}/__demo__/agent/interactive`)).toEqual({ status: 404, text: 'not found' });
  expect(await probe(`${site.origin}/other-repo/__demo__/agent/interactive`)).toEqual({ status: 404, text: 'not found' });
  expect(site.requests.map((request) => `${request.method} ${request.path}`).slice(-3)).toEqual([
    `GET ${BASE_PATH}asset-that-is-not-there.txt`,
    'POST /__demo__/agent/interactive',
    'POST /other-repo/__demo__/agent/interactive',
  ]);
  const reached = await probe(`${visitor.origin}/agent`);
  expect(reached.status).toBe(200);
  expect(reached.text).toContain('Hello from the reference agent.');
  expect(visitor.requests().map((request) => `${request.method} ${request.path}`)).toEqual(['POST /agent']);
  // The page's own navigation is not the worker's either.
  await page.goto(`${site.base}nowhere`);
  expect(site.requests.at(-1)).toMatchObject({ method: 'GET', path: `${BASE_PATH}nowhere` });
});

test('example-only use leaves nothing behind: no worker cache, database, stored request or credential', async ({ page, context, open, requested }) => {
  const site = await open();
  await openDemo(page, site);
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  await idle(page);
  await quick(page, 'interrupt').click();
  await expect(card(page, 'i-approve')).toBeVisible();

  const storage = async () => ({
    caches: await caches.keys(),
    databases: (await indexedDB.databases()).map((database) => database.name),
    local: 'localStorage' in globalThis ? JSON.stringify(Object.entries(localStorage)) : '',
    session: 'sessionStorage' in globalThis ? JSON.stringify(Object.entries(sessionStorage)) : '',
  });
  const [worker] = context.serviceWorkers();
  for (const found of [await page.evaluate(storage), await worker!.evaluate(storage)]) {
    expect(found.caches).toEqual([]);
    expect(found.databases).toEqual([]);
    expect(found.session).not.toMatch(/threadId|runId|messages/);
    // At most the credential-free profile: never a request body, a thread, a run or a token.
    expect(found.local).not.toMatch(/threadId|runId|messages|token|Hello there|thread/i);
  }
  expect(await context.cookies()).toEqual([{ ...(await context.cookies())[0]!, name: 'session' }]);
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
  onlyOwnOrigin(requested, site.origin);
});

// ---------------------------------------------------------------------------------------------
// When the examples cannot be offered
// ---------------------------------------------------------------------------------------------

/**
 * The same app mounts with no example agents, says why, and keeps the visitor's own server and recordings
 * usable: a real run goes to their server and carries no cookie, and nothing was ever sent to an example route.
 */
async function expectFallback(page: Page, site: Site, requested: readonly string[], reason: RegExp, within = 10_000): Promise<void> {
  const started = Date.now();
  await expect(status(page)).toContainText('Browser-local examples are unavailable', { timeout: within + 3_000 });
  await expect(status(page)).toContainText(reason);
  await expect(status(page)).toContainText('reload the page; export any recording you need first');
  await expect(status(page)).toContainText('You can still inspect your own server or open a recording');
  expect(Date.now() - started, 'the wait is bounded').toBeLessThan(within + 2_500);
  await expect(heading(page)).toBeVisible();
  await expect(heading(page)).toHaveCount(1);

  // No example agent, no example quick message, no example request.
  await expect(quick(page, 'Hello there')).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'No agents loaded' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspection', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Import session' })).toBeEnabled();
  expect(exampleRequests(requested), 'no example request was made').toEqual([]);
  expect(site.requests.filter((request) => request.method !== 'GET'), 'nothing was posted to the static host').toEqual([]);

  // Own server: type its URL and run it, exactly as on the public page.
  const visitor = await site.visitor();
  await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(`${visitor.origin}/agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await send(page, 'my own server');
  await expect(reply(page)).toBeVisible();
  expect(visitor.requests().map((request) => `${request.kind} ${request.method} ${request.path}`)).toEqual(['run POST /agent']);
  expect(visitor.requests()[0]?.credentials, 'the page host has a cookie, and the target got none').toEqual([]);
  expect(exampleRequests(requested)).toEqual([]);
}

test('a browser without service workers says so, mounts the app with no examples, and keeps own-server use', async ({ page, open, requested }) => {
  const site = await open();
  await page.addInitScript(() => {
    delete (Navigator.prototype as { serviceWorker?: unknown }).serviceWorker;
  });
  await page.goto(site.base);
  await expectFallback(page, site, requested, /this browser does not support service workers/);
});

test('a browser that refuses the registration says so at once, mounts the app with no examples, and keeps own-server use', async ({ page, open, requested }) => {
  const site = await open();
  await page.addInitScript(() => {
    navigator.serviceWorker.register = () => Promise.reject(new DOMException('blocked by the browser', 'SecurityError'));
  });
  await page.goto(site.base);
  await expectFallback(page, site, requested, /the example worker could not be registered \(SecurityError\)/, 2_000);
});

test.describe('worker control blocked by the browser', () => {
  test.use({ serviceWorkers: 'block' });
  test('ends the wait at the bound, says the worker never took control, and keeps own-server use', async ({ page, open, requested }) => {
    test.setTimeout(45_000);
    const site = await open();
    await page.goto(site.base);
    await expectFallback(page, site, requested, /the example worker did not take control of this page within 10 seconds/);
  });
});

test('a worker that never says it is ready ends the wait at 10 seconds, with no example request', async ({ page, open, requested }) => {
  test.setTimeout(45_000);
  const site = await open();
  site.worker = 'silent';
  const started = Date.now();
  await page.goto(site.base);
  await expect(status(page)).toContainText('Browser-local examples are unavailable', { timeout: 14_000 });
  expect(Date.now() - started, 'not before the bound').toBeGreaterThanOrEqual(9_500);
  await expectFallback(page, site, requested, /the example worker did not answer within 10 seconds/);
});

test('an older worker in control that cannot be updated is refused at once, not trusted', async ({ page, open, requested }) => {
  const site = await open();
  // An earlier visit left a worker of another version in control of the sub-path.
  site.worker = 'stale';
  await page.goto(`${site.base}nowhere`);
  await page.evaluate(() => navigator.serviceWorker.register('./service-worker.js', { scope: './' }).then(() => navigator.serviceWorker.ready).then(() => undefined));
  site.worker = 'broken';
  requested.length = 0;
  await page.goto(site.base);
  await expectFallback(page, site, requested, /an older version of the example worker is in control and could not be updated/, 4_000);
});

test('an older worker in control is replaced by the update, and the examples work without a reload', async ({ page, open, requested }) => {
  const site = await open();
  site.worker = 'stale';
  await page.goto(`${site.base}nowhere`);
  await page.evaluate(() => navigator.serviceWorker.register('./service-worker.js', { scope: './' }).then(() => navigator.serviceWorker.ready).then(() => undefined));
  site.worker = 'real';
  requested.length = 0;
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations.push(frame.url()));

  await page.goto(site.base);
  await expect(status(page)).toContainText('Browser-local examples are ready', { timeout: 10_000 });
  await expect(heading(page)).toHaveCount(1);
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  await idle(page);
  expectProducedBytes(await exportSession(page));
  expect(navigations).toEqual([site.base]);
  expect(site.requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('a controller that changes after the page was ready is shown, and nothing is reloaded or replayed', async ({ page, open, requested }) => {
  const site = await open();
  await openDemo(page, site);
  await expect(status(page)).toContainText('Browser-local examples are ready');
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  const before = exampleRequests(requested).length;
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => navigations.push(frame.url()));

  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  await expect(status(page)).toContainText('The example worker was replaced, so the examples may stop answering');
  await expect(status(page)).toContainText('Export any recording you need, then reload the page');
  await page.waitForTimeout(300);
  expect(exampleRequests(requested).length, 'no request was repeated').toBe(before);
  expect(navigations, 'no reload').toEqual([]);
  await expect(heading(page)).toHaveCount(1);
});

// ---------------------------------------------------------------------------------------------
// The sub-path
// ---------------------------------------------------------------------------------------------

test('every example, preparation and asset route lives under the sub-path; the root and other paths are not the demo', async ({ page, open, requested }) => {
  const site = await open();
  await openDemo(page, site);
  await quick(page, 'Hello there').click();
  await expect(reply(page)).toBeVisible();
  await idle(page);

  for (const url of requested) {
    if (url.startsWith('data:') || url.startsWith('blob:')) continue;
    expect(new URL(url).pathname.startsWith(BASE_PATH), url).toBe(true);
  }
  expect(exampleRequests(requested).every((url) => new URL(url).pathname.startsWith(EXAMPLE_ROUTE))).toBe(true);
  // The site root is not the demo: no page, no worker.
  const root = await page.request.get(`${site.origin}/`);
  expect(root.status()).toBe(404);
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope));
  expect(scopes).toEqual([site.base]);
});
