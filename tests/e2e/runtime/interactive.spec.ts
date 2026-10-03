// L02 T028 (US1.1, US1.2, US1.6, US3.1 to US3.4, US4.3 to US4.5, SC-004, SC-008): connecting and driving
// interactive runs in a real browser. The page is the real runtime wired to the real connection
// controls, reply editors and conversation view (packages/inspector/tests/runtime/harness.tsx). It
// talks to loopback reference servers (examples/reference-agent/interactive-scenarios.ts) that record
// the body of every preparation and run request. Every assertion about "what the next run carries"
// reads those recorded bodies, and what the page recorded is read from its own session store.
//
// Every test also checks the network allowlist: the page may talk to its own origin and the loopback
// servers this file started, and nothing else.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';
import { createInteractiveServer, REDIRECT_PATH, type InteractiveServer, type RecordedRequest } from '../../../examples/reference-agent/interactive-scenarios.ts';

declare global {
  interface Window {
    __harness: {
      runtime: { sendRaw(text: string): Promise<void> };
      session(): unknown;
      setProfile(patch: Record<string, unknown>): void;
      action: Record<string, unknown>;
    };
  }
}

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const SYNTHETIC_TOKEN = 'synthetic-token-7f3a91';
const COOKIE = { name: 'host_session', value: 'synthetic-cookie-51d2' };

interface Servers {
  /** Serves the page, and also an agent for embedded use. */
  site: InteractiveServer;
  /** An agent on another origin that allows the page's origin (CORS). */
  remote: InteractiveServer;
  /** An agent on another origin that grants no CORS at all. */
  closed: InteractiveServer;
}

interface Session {
  exchanges: Array<{ id: string; kind: string; method: string; path: string; status?: number; transport: string; transportError?: string; requestBody?: string; responseBody?: string; runId?: string }>;
  frames: Array<{ exchangeId: string; eventType?: string; jsonVerdict: string; schemaVerdict: string; data?: string }>;
  runs: Array<{ id: string; runId: string; parentRunId?: string; input: Record<string, unknown>; outcome: { kind: string; [key: string]: unknown } }>;
  findings: Array<{ kind: string; message: string; subject: { type: string; id: string } }>;
}

interface RunBody {
  threadId: string;
  runId: string;
  parentRunId?: string;
  protocolVersion?: string;
  state: unknown;
  messages: Array<{ id: string; role: string; content?: string; toolCallId?: string }>;
  forwardedProps: Record<string, unknown>;
  resume?: Array<{ interruptId: string; status: string; payload?: unknown }>;
}

const test = base.extend<{ requested: string[] }, { servers: Servers }>({
  servers: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'runtime-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { harness: path.join(root, 'packages', 'inspector', 'tests', 'runtime', 'harness.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>runtime harness</title>
    <link rel="stylesheet" href="/harness.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/harness.js"></script></body>
</html>`;
      const site = await createInteractiveServer({
        assets: {
          '/': ['text/html', page],
          '/harness.js': ['text/javascript', readFileSync(path.join(outdir, 'harness.js'), 'utf8')],
          '/harness.css': ['text/css', readFileSync(path.join(outdir, 'harness.css'), 'utf8')],
        },
      });
      const remote = await createInteractiveServer({ allowOrigin: site.origin });
      const closed = await createInteractiveServer();
      await use({ site, remote, closed });
      await Promise.all([site.close(), remote.close(), closed.close()]);
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  /** Every URL the page requests; after each test none may be outside the origins this file started. */
  requested: [
    async ({ page, servers }, use) => {
      for (const server of Object.values(servers)) server.reset();
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await use(urls);
      const known = Object.values(servers).map((server) => `${server.origin}/`);
      const outside = urls.filter((url) => !known.some((origin) => url.startsWith(origin)) && !url.startsWith('blob:') && !url.startsWith('data:'));
      expect(outside, 'requests outside the page origin and the scripted targets').toEqual([]);
    },
    { auto: true },
  ],
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const runs = (server: InteractiveServer) => server.requests().filter((request) => request.kind === 'run');
const preparations = (server: InteractiveServer) => server.requests().filter((request) => request.kind === 'preparation');
const bodyOf = (request: RecordedRequest | undefined) => request?.body as RunBody;

interface OpenOptions {
  mode?: 'embedded' | 'hosted';
  allow?: string[];
  agentBase?: string;
  agent?: 'support' | 'plain';
  target?: string;
}

async function open(page: Page, servers: Servers, options: OpenOptions = {}): Promise<void> {
  const query = new URLSearchParams();
  if (options.mode) query.set('mode', options.mode);
  if (options.allow?.length) query.set('allow', options.allow.join(','));
  if (options.agentBase) query.set('agentBase', options.agentBase);
  if (options.agent) query.set('agent', options.agent);
  if (options.target) query.set('target', options.target);
  await page.goto(`${servers.site.origin}/?${query}`);
  await expect(page.getByRole('button', { name: /^Authentication/ })).toBeVisible();
}

const session = (page: Page): Promise<Session> => page.evaluate(() => window.__harness.session() as never);
const messageBox = (page: Page) => page.getByLabel('Message', { exact: true });
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send message' });
const alert = (page: Page) => page.getByRole('alert');

async function send(page: Page, text: string): Promise<void> {
  await messageBox(page).fill(text);
  await sendButton(page).click();
}

async function enterToken(page: Page, token = SYNTHETIC_TOKEN, header?: string): Promise<void> {
  await page.getByRole('button', { name: /^Authentication/ }).click();
  const popover = page.locator('[popover]:popover-open');
  if (header !== undefined) await popover.getByLabel('Header name').fill(header);
  await popover.getByLabel('Token').fill(token);
  await page.keyboard.press('Escape');
}

/** Waits until the page has recorded this many conversation exchanges and every exchange has ended. */
async function settled(page: Page, conversations: number): Promise<Session> {
  await expect
    .poll(async () => {
      const current = await session(page);
      const ended = current.exchanges.every((exchange) => ['completed', 'transport-error', 'user-stopped'].includes(exchange.transport));
      return ended && current.exchanges.filter((exchange) => exchange.kind === 'conversation').length === conversations;
    })
    .toBe(true);
  return session(page);
}

const card = (page: Page, interruptId: string): Locator => page.locator(`[data-entry="interrupt"][data-interrupt="${interruptId}"]`);
const toolCard = (page: Page, toolCallId: string): Locator => page.locator(`[data-entry="tool-result"][data-tool-call="${toolCallId}"]`);

// ---------------------------------------------------------------------------------------------
// US1.1: an embedded run, recorded
// ---------------------------------------------------------------------------------------------

test('a run goes to the agent after its preparations, and the page records the exchange, the frames and the transcript', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await send(page, 'hello there');
  await expect(page.getByText('Hello from the reference agent.')).toBeVisible();

  const requests = site.requests();
  expect(requests.map((request) => `${request.kind} ${request.method} ${request.path.replace(/\/sessions\/.+/, '/sessions/_')}`)).toEqual([
    'preparation PUT /prepare/sessions/_',
    'preparation POST /prepare/warm',
    'run POST /agent',
  ]);
  const run = bodyOf(requests[2]);
  expect(run.messages.map((message) => [message.role, message.content])).toEqual([['user', 'hello there']]);
  expect(requests[0]?.path).toBe(`/prepare/sessions/${run.threadId}`);
  expect(requests[1]?.body).toEqual({ run: run.runId });
  expect(run.forwardedProps).toMatchObject({ tenant: 'acme' });
  expect(run.forwardedProps.user).toMatch(/^u-/);
  expect((requests[0]?.body as { user: string }).user).toBe(run.forwardedProps.user);

  const recorded = await settled(page, 1);
  expect(recorded.exchanges.map((exchange) => [exchange.kind, exchange.method, exchange.status, exchange.transport])).toEqual([
    ['preparation', 'PUT', 200, 'completed'],
    ['preparation', 'POST', 200, 'completed'],
    ['conversation', 'POST', 200, 'completed'],
  ]);
  expect(recorded.exchanges[2]?.requestBody).toBe(requests[2]?.text);
  expect(recorded.frames.map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  expect(recorded.runs[0]?.outcome).toEqual({ kind: 'success', pendingToolCallIds: [] });
  expect(recorded.runs[0]?.input).toEqual(requests[2]?.body);
});

test('the composer is keyboard driven: Enter sends, Shift+Enter adds a line, an empty box cannot send', async ({ page, servers }) => {
  await open(page, servers, { agent: 'plain' });
  await expect(sendButton(page)).toBeDisabled();
  await messageBox(page).fill('line one');
  await messageBox(page).press('Shift+Enter');
  await messageBox(page).pressSequentially('line two');
  await messageBox(page).press('Enter');
  await expect.poll(() => runs(servers.site).length).toBe(1);
  expect(bodyOf(runs(servers.site)[0]).messages[0]?.content).toBe('line one\nline two');
  await expect(messageBox(page)).toHaveValue('');
});

test('quick messages from the preset use the ordinary send path', async ({ page, servers }) => {
  await open(page, servers, { agent: 'support' });
  await page.getByRole('button', { name: '/help', exact: true }).click();
  await expect.poll(() => runs(servers.site).length).toBe(1);
  expect(bodyOf(runs(servers.site)[0]).messages.map((message) => message.content)).toEqual(['/help']);
  expect(preparations(servers.site)).toHaveLength(2);
});

test('a failed preparation sends no run, shows why, and keeps the message for another try', async ({ page, servers }) => {
  const { site } = servers;
  site.fail('/prepare/warm', 500);
  await open(page, servers, { agent: 'support' });
  await send(page, 'try me');
  await expect(alert(page)).toContainText('Preparation failed: POST /prepare/warm answered 500. The run was not sent.');
  expect(runs(site)).toEqual([]);
  expect(preparations(site)).toHaveLength(2);
  await expect(messageBox(page)).toHaveValue('try me');
  site.clear();
  await sendButton(page).click();
  await expect.poll(() => runs(site).length).toBe(1);
  await expect(messageBox(page)).toHaveValue('');
  await expect(alert(page)).toHaveCount(0);
});

test('state from one run is carried into the next', async ({ page, servers }) => {
  await open(page, servers, { agent: 'plain' });
  await send(page, 'state');
  await settled(page, 1);
  await send(page, 'and now?');
  await expect.poll(() => runs(servers.site).length).toBe(2);
  expect(bodyOf(runs(servers.site)[0]).state).toEqual({});
  expect(bodyOf(runs(servers.site)[1]).state).toEqual({ counter: 2, items: ['a', 'b'] });
});

test('profile switches reach the recorded input of the next run', async ({ page, servers }) => {
  await open(page, servers, { agent: 'support' });
  await page.evaluate(() =>
    window.__harness.setProfile({
      messageMode: 'turn',
      protocolVersion: '1.0',
      context: [{ description: 'locale', value: 'fr-FR' }],
      forwardedProps: { tenant: 'override' },
    }),
  );
  await send(page, 'first');
  await settled(page, 1);
  await send(page, 'second');
  await expect.poll(() => runs(servers.site).length).toBe(2);
  const second = bodyOf(runs(servers.site)[1]);
  expect(second.messages.map((message) => message.content)).toEqual(['second']);
  expect(second.forwardedProps.tenant).toBe('override');
  expect((runs(servers.site)[1]?.body as { context: unknown }).context).toEqual([{ description: 'locale', value: 'fr-FR' }]);
  const recorded = await settled(page, 2);
  expect(recorded.runs[1]?.input).toEqual(runs(servers.site)[1]?.body);
});

// ---------------------------------------------------------------------------------------------
// US1.2: findings do not end capture
// ---------------------------------------------------------------------------------------------

test('a sequence violation and a broken frame become findings while every frame is still recorded', async ({ page, servers }) => {
  await open(page, servers, { agent: 'plain' });
  await send(page, 'broken');
  const recorded = await settled(page, 1);
  expect(recorded.frames.map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_CONTENT', undefined, 'STEP_STARTED', 'STEP_FINISHED', 'RUN_FINISHED']);
  expect(recorded.frames[2]).toMatchObject({ jsonVerdict: 'invalid', data: '{not json at all' });
  expect(recorded.findings.some((finding) => finding.kind === 'json' && finding.subject.type === 'frame')).toBe(true);
  expect(recorded.findings.some((finding) => finding.kind === 'sequence' && finding.subject.type === 'run')).toBe(true);
  await expect(alert(page)).toHaveCount(0);
});

test('a "Not shown" issue stays in the run that produced it while later runs arrive', async ({ page, servers }) => {
  await open(page, servers, { agent: 'plain' });
  await send(page, 'broken');
  await settled(page, 1);
  await send(page, 'Hello there');
  await settled(page, 2);
  const issues = page.getByRole('list', { name: 'Projection issues' });
  await expect(issues).toHaveCount(1);
  await expect(issues).toContainText('Not shown');
  await expect(issues).toContainText('never started');
  // Where the issue sits: how many run headers precede it, and whether the damaged run's step follows it.
  const place = () =>
    issues.evaluate((list) => {
      const before = (node: Element) => !!(node.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { runsBefore: [...document.querySelectorAll('[data-entry="run"]')].filter(before).length, stepsBefore: [...document.querySelectorAll('[data-entry="step"]')].filter(before).length };
    });
  expect(await place(), 'inside the broken run, ahead of the second run and of the step after the damage').toEqual({ runsBefore: 1, stepsBefore: 0 });

  await send(page, 'A third run');
  await settled(page, 3);
  await expect(page.locator('[data-entry="run"]')).toHaveCount(3);
  await expect(issues).toHaveCount(1);
  expect(await place(), 'a newer run does not push it down').toEqual({ runsBefore: 1, stepsBefore: 0 });
});

// ---------------------------------------------------------------------------------------------
// US1.6: Stop and New thread
// ---------------------------------------------------------------------------------------------

test('Stop ends the connection, keeps the partial recording and makes up no terminal event', async ({ page, servers }) => {
  await open(page, servers, { agent: 'plain' });
  const stop = page.getByRole('button', { name: 'Stop' });
  await expect(stop).toBeDisabled();
  await send(page, 'slow');
  await expect(stop).toBeEnabled();
  await expect.poll(() => servers.site.openStreams()).toBe(1);
  await expect(page.getByText('A run is streaming. Stop it to send another message.')).toBeVisible();
  await expect(messageBox(page)).toBeDisabled();

  await stop.click();
  await expect(stop).toBeDisabled();
  await expect(messageBox(page)).toBeEnabled();
  await expect.poll(() => servers.site.openStreams()).toBe(0);

  const recorded = await settled(page, 1);
  expect(recorded.exchanges[0]?.transport).toBe('user-stopped');
  expect(recorded.frames.map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT']);
  expect(recorded.runs[0]?.outcome).toEqual({ kind: 'unknown' });
  expect(recorded.findings.filter((finding) => finding.kind === 'terminal')).toHaveLength(1);
  await expect(alert(page)).toHaveCount(0);
  await expect(page.locator('[data-entry="run"]')).toContainText('Stopped by you');

  await send(page, 'after the stop');
  await expect.poll(() => runs(servers.site).length).toBe(2);
});

test('New thread starts clean without rewriting what was recorded', async ({ page, servers }) => {
  await open(page, servers, { agent: 'support' });
  await send(page, 'old thread');
  await expect(page.getByText('Hello from the reference agent.')).toBeVisible();
  await settled(page, 1);
  const before = await session(page);
  await page.getByRole('button', { name: 'New thread' }).click();
  await expect(page.locator('[data-view="conversation"]')).toContainText('No conversation yet');
  await expect(page.getByText('Hello from the reference agent.')).toHaveCount(0);
  await send(page, 'new thread');
  await settled(page, 2);
  const [first, second] = runs(servers.site).map(bodyOf);
  expect(second?.threadId).not.toBe(first?.threadId);
  expect(second?.messages.map((message) => message.content)).toEqual(['new thread']);
  expect(second?.state).toEqual({});
  expect(preparations(servers.site).filter((request) => request.method === 'PUT').map((request) => request.path)).toEqual([`/prepare/sessions/${first?.threadId}`, `/prepare/sessions/${second?.threadId}`]);
  const after = await session(page);
  expect(after.exchanges[0]).toEqual(before.exchanges[0]);
  expect(after.frames.slice(0, before.frames.length)).toEqual(before.frames);
});

// ---------------------------------------------------------------------------------------------
// US3.1: interrupts
// ---------------------------------------------------------------------------------------------

test('interrupts: Resolve and Cancel in place, and the next run starts only after the last answer', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await page.getByRole('button', { name: 'interrupt', exact: true }).click();

  await expect(card(page, 'i-approve')).toBeVisible();
  await expect(card(page, 'i-contact')).toBeVisible();
  await expect(card(page, 'i-approve')).toContainText('Approve the refund of 25.00?');
  await expect(card(page, 'i-approve')).toContainText('2 of 2 waiting');
  const editor = page.getByLabel('Answer for interrupt i-approve');
  await expect(editor).toHaveValue('{\n  "approved": false,\n  "note": ""\n}');
  await expect(page.getByText('2 interrupts waiting. Answer them to continue the run.')).toBeVisible();
  await expect(messageBox(page)).toBeDisabled();
  expect(runs(site)).toHaveLength(1);
  expect(preparations(site)).toHaveLength(2);

  // Not JSON: it cannot be sent. Wrong shape: the schema warns and Resolve stays available.
  await editor.fill('{');
  await expect(page.getByRole('button', { name: 'Resolve interrupt i-approve' })).toBeDisabled();
  await expect(card(page, 'i-approve').getByRole('alert')).toContainText('Not valid JSON');
  await editor.fill('{"approved":"yes"}');
  await expect(card(page, 'i-approve')).toContainText('approved must be true or false');
  await expect(page.getByRole('button', { name: 'Resolve interrupt i-approve' })).toBeEnabled();

  await editor.fill('{"approved": true, "note": "ok"}');
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await expect(card(page, 'i-approve')).toHaveAttribute('data-status', 'resolved');
  await expect(page.getByText('1 interrupt waiting. Answer it to continue the run.')).toBeVisible();
  await page.waitForTimeout(150);
  expect(runs(site), 'one of two answered: no continuation').toHaveLength(1);
  expect(preparations(site), 'not even its preparations').toHaveLength(2);

  await page.getByRole('button', { name: 'Cancel interrupt i-contact' }).click();
  await expect.poll(() => runs(site).length).toBe(2);
  const [first, resume] = runs(site).map(bodyOf);
  expect(resume?.resume).toEqual([
    { interruptId: 'i-approve', status: 'resolved', payload: { approved: true, note: 'ok' } },
    { interruptId: 'i-contact', status: 'cancelled' },
  ]);
  expect(resume?.threadId).toBe(first?.threadId);
  expect(resume?.parentRunId).toBe(first?.runId);
  expect(resume?.runId).not.toBe(first?.runId);
  expect(preparations(site), 'the continuation prepared before it was sent').toHaveLength(4);
  expect(site.requests().map((request) => request.kind)).toEqual(['preparation', 'preparation', 'run', 'preparation', 'preparation', 'run']);
  await expect(page.getByText('Resumed with i-approve=resolved:{"approved":true,"note":"ok"}, i-contact=cancelled')).toBeVisible();
  await expect(page.locator('[data-view="replies"]')).toHaveCount(0);

  const recorded = await settled(page, 2);
  expect(recorded.runs[1]?.input.resume).toEqual(resume?.resume);
  expect(recorded.runs[0]?.outcome.kind).toBe('interrupt');
  expect(recorded.exchanges.filter((exchange) => exchange.kind === 'preparation')).toHaveLength(4);
});

test('a continuation whose preparation fails sends no run, keeps the answers, and can be sent again', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await page.getByRole('button', { name: 'interrupt', exact: true }).click();
  await expect(card(page, 'i-contact')).toBeVisible();

  site.fail('/prepare/warm', 502);
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await page.getByRole('button', { name: 'Resolve interrupt i-contact' }).click();
  await expect(alert(page)).toContainText('Preparation failed: POST /prepare/warm answered 502. The run was not sent.');
  expect(runs(site)).toHaveLength(1);
  await expect(card(page, 'i-approve')).toHaveAttribute('data-status', 'resolved');
  const recorded = await session(page);
  expect(recorded.exchanges.map((exchange) => `${exchange.kind}:${exchange.status}`)).toEqual([
    'preparation:200', 'preparation:200', 'conversation:200', // the first run
    'preparation:200', 'preparation:502', //                      the failed continuation, preserved
  ]);

  site.clear();
  await page.getByRole('button', { name: 'Send the continuation again' }).click();
  await expect.poll(() => runs(site).length).toBe(2);
  expect(bodyOf(runs(site)[1]).resume).toHaveLength(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// US3.2 and US3.3: client tool calls
// ---------------------------------------------------------------------------------------------

test('tool calls: arguments stream into view, results are typed by hand, and the run starts after the last one', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await page.getByRole('button', { name: 'tools', exact: true }).click();

  await expect(toolCard(page, 'c-color')).toBeVisible();
  await expect(toolCard(page, 'c-size')).toBeVisible();
  await expect(toolCard(page, 'c-color').getByRole('region', { name: 'Arguments of pick_color' })).toContainText('"red"');
  await expect(toolCard(page, 'c-color')).toContainText('2 of 2 waiting');
  await expect(page.getByText('2 tool calls waiting for results. Enter them to continue the run.')).toBeVisible();
  // L03's transcript card for the same call shows it as pending, with parsed arguments.
  await expect(page.locator('[data-entry="tool"][data-tool-call="c-color"]')).toContainText('Pending result');
  await page.waitForTimeout(150);
  expect(runs(site), 'nothing answers a pending call automatically').toHaveLength(1);

  await page.getByLabel('Result for pick_color (c-color)').fill('"teal"');
  await page.getByRole('button', { name: 'Submit result for c-color' }).click();
  await expect(toolCard(page, 'c-color')).toHaveAttribute('data-status', 'answered');
  await expect(page.getByText('1 tool call waiting for a result. Enter it to continue the run.')).toBeVisible();
  await page.waitForTimeout(150);
  expect(runs(site), 'one of two results: no continuation').toHaveLength(1);

  await page.getByLabel('Result for pick_size (c-size)').fill('3');
  await page.getByRole('button', { name: 'Submit result for c-size' }).click();
  await expect.poll(() => runs(site).length).toBe(2);
  const second = bodyOf(runs(site)[1]);
  expect(second.messages.filter((message) => message.role === 'tool').map((message) => [message.toolCallId, message.content])).toEqual([
    ['c-color', '"teal"'],
    ['c-size', '3'],
  ]);
  expect(second.parentRunId).toBe(bodyOf(runs(site)[0]).runId);
  expect(second.resume).toBeUndefined();
  await expect(page.getByText('Tool results: c-color="teal", c-size=3')).toBeVisible();
  await expect(page.locator('[data-entry="tool"][data-tool-call="c-color"]')).toContainText('entered by you');

  const recorded = await settled(page, 2);
  expect(recorded.runs[1]?.input.messages).toEqual(second.messages);
});

// ---------------------------------------------------------------------------------------------
// US3.4: a surface action
// ---------------------------------------------------------------------------------------------

test('an A2UI action starts a new run with the documented envelope, after the preparations', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await send(page, 'show the form');
  await settled(page, 1);
  await page.getByRole('button', { name: 'Send test action' }).click();
  await expect.poll(() => runs(site).length).toBe(2);

  const action = await page.evaluate(() => window.__harness.action);
  const body = bodyOf(runs(site)[1]);
  expect(body.forwardedProps).toMatchObject({ tenant: 'acme', a2uiAction: { userAction: action } });
  expect(Object.keys((body.forwardedProps.a2uiAction as { userAction: object }).userAction).sort()).toEqual(['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  expect(body.messages.map((message) => message.content), 'the action adds no user message').toEqual(['show the form', 'Hello from the reference agent.']);
  expect(site.requests().map((request) => request.kind)).toEqual(['preparation', 'preparation', 'run', 'preparation', 'preparation', 'run']);
  await expect(page.getByText('Action received: approve_refund')).toBeVisible();

  const recorded = await settled(page, 2);
  expect((recorded.runs[1]?.input.forwardedProps as { a2uiAction: unknown }).a2uiAction).toEqual({ userAction: action });
});

// ---------------------------------------------------------------------------------------------
// FR-004, FR-005, FR-036, FR-037: targets, credentials and the network
// ---------------------------------------------------------------------------------------------

test('embedded: the host cookie rides along, the token goes out under the chosen header, and neither is recorded', async ({ page, context, servers }) => {
  const { site } = servers;
  await context.addCookies([{ ...COOKIE, url: site.origin }]);
  await open(page, servers, { agent: 'support' });
  await enterToken(page, SYNTHETIC_TOKEN, 'X-Api-Key');
  await expect(page.getByRole('button', { name: 'Authentication: X-Api-Key set' })).toBeVisible();
  await send(page, 'hello');
  await expect.poll(() => runs(site).length).toBe(1);

  for (const request of site.requests()) expect(request.credentials).toEqual(['x-api-key', 'cookie']);
  const recorded = await settled(page, 1);
  const everything = JSON.stringify(recorded);
  expect(everything).not.toContain(SYNTHETIC_TOKEN);
  expect(everything).not.toContain(COOKIE.value);
  expect(everything).not.toMatch(/x-api-key|authorization|"headers?"/i);
  expect(await page.locator('body').innerText()).not.toContain(SYNTHETIC_TOKEN);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(SYNTHETIC_TOKEN);
  expect(JSON.stringify(await context.storageState())).not.toContain(SYNTHETIC_TOKEN);
});

test('hosted: the run goes straight to the allowed origin, preflighted, with the token and without cookies', async ({ page, context, servers }) => {
  const { site, remote } = servers;
  await context.addCookies([{ ...COOKIE, url: remote.origin }, { ...COOKIE, url: site.origin }]);
  await open(page, servers, { mode: 'hosted', allow: [remote.origin], agentBase: remote.origin, agent: 'support' });
  await enterToken(page);
  await send(page, 'hello');
  await expect(page.getByText('Hello from the reference agent.')).toBeVisible();

  expect(remote.requests().map((request) => request.kind)).toEqual(['preparation', 'preparation', 'run']);
  for (const request of remote.requests()) expect(request.credentials, 'a token header, and no cookie').toEqual(['authorization']);
  expect(remote.paths().filter((entry) => entry.startsWith('OPTIONS'))).not.toHaveLength(0);
  expect(site.requests(), 'nothing went to the page origin').toEqual([]);
  expect(bodyOf(remote.requests()[2]).messages[0]?.content).toBe('hello');
  expect(JSON.stringify(await session(page))).not.toContain(SYNTHETIC_TOKEN);
});

test('hosted: even the page own origin gets no cookies, unlike an embedded page', async ({ page, context, servers }) => {
  const { site } = servers;
  await context.addCookies([{ ...COOKIE, url: site.origin }]);
  await open(page, servers, { mode: 'hosted', target: `${site.origin}/agent` });
  await send(page, 'hello');
  await expect.poll(() => runs(site).length).toBe(1);
  expect(runs(site)[0]?.credentials).toEqual([]);
});

test('hosted: a target the browser blocks is a visible failure naming the rules, recorded, and there is no proxy fallback', async ({ page, servers }) => {
  const { closed, site, remote } = servers;
  await open(page, servers, { mode: 'hosted', allow: [closed.origin], target: `${closed.origin}/agent` });
  await send(page, 'hello');
  await expect(alert(page)).toContainText('The run request failed: The browser could not complete the request to ' + closed.origin);
  await expect(alert(page)).toContainText('CORS');
  expect(closed.requests(), 'the preflight failed, so the run never reached the server').toEqual([]);
  expect(site.requests().concat(remote.requests()), 'nothing was retried through another origin').toEqual([]);

  const recorded = await settled(page, 1);
  expect(recorded.exchanges[0]).toMatchObject({ kind: 'conversation', transport: 'transport-error' });
  expect(recorded.exchanges[0]?.transportError).toContain('CORS');
  expect(recorded.findings.some((finding) => finding.kind === 'transport')).toBe(true);
  // The text stays in the box so the send can be retried without retyping.
  await expect(messageBox(page)).toHaveValue('hello');
  await expect(messageBox(page)).toBeEnabled();
});

test('hosted: an endpoint outside the startup allowlist is refused before any request is made', async ({ page, servers }) => {
  const { closed, remote } = servers;
  await open(page, servers, { mode: 'hosted', allow: [remote.origin], target: `${closed.origin}/agent` });
  await expect(alert(page)).toContainText('is not an allowed destination');
  await send(page, 'hello');
  await expect(alert(page)).toContainText('is not an allowed destination');
  await page.waitForTimeout(100);
  expect(closed.paths()).toEqual([]);
  expect(remote.paths()).toEqual([]);
  expect((await session(page)).exchanges).toEqual([]);
});

test('hosted: a relative endpoint and an endpoint with credentials in the URL are refused', async ({ page, servers }) => {
  const { remote } = servers;
  await open(page, servers, { mode: 'hosted', allow: [remote.origin], target: '/agent' });
  await expect(alert(page)).toContainText('Hosted endpoint URLs must be absolute');
  await page.getByLabel('Endpoint URL').fill(`http://user:hunter2@${new URL(remote.origin).host}/agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await expect(alert(page)).toContainText('must not contain credentials');
  await expect(alert(page)).not.toContainText('hunter2');
  expect(remote.paths()).toEqual([]);
});

test('a redirect from the target is refused, not followed', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { target: REDIRECT_PATH });
  await send(page, 'hello');
  await expect(alert(page)).toContainText('The target answered with a redirect');
  expect(site.paths().filter((entry) => entry.includes('/agent')), 'the redirect location was never requested').toEqual([]);
  expect(site.paths().filter((entry) => entry === `POST ${REDIRECT_PATH}`)).toHaveLength(1);
  expect((await settled(page, 1)).exchanges[0]?.transport).toBe('transport-error');
});

test('changing the agent or the endpoint clears the token before anything is sent to the new target', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await enterToken(page);
  await expect(page.getByRole('button', { name: 'Authentication: Authorization set' })).toBeVisible();

  await page.getByRole('button', { name: 'Use Plain agent' }).click();
  await expect(page.getByText('Token cleared because the target changed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();
  await send(page, 'hello');
  await expect.poll(() => runs(site).length).toBe(1);
  expect(runs(site)[0]?.credentials).toEqual([]);

  await enterToken(page);
  await page.getByLabel('Endpoint URL').fill('/agent?variant=2');
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();
  await send(page, 'again');
  await expect.poll(() => runs(site).length).toBe(2);
  expect(runs(site)[1]?.credentials).toEqual([]);
});

test('a reload clears the token', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'plain' });
  await enterToken(page);
  await send(page, 'with token');
  await expect.poll(() => runs(site).length).toBe(1);
  expect(runs(site)[0]?.credentials).toEqual(['authorization']);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();
  await send(page, 'after reload');
  await expect.poll(() => runs(site).length).toBe(2);
  expect(runs(site)[1]?.credentials).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// FR-007: a raw submission (the callback L04's editor uses) is its own exchange
// ---------------------------------------------------------------------------------------------

test('a raw submission goes out exactly as typed, outside the conversation, and its error reply is kept', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  const text = '{\n  "threadId" :  17,\n  "z": 1\n}';
  await page.evaluate((body) => window.__harness.runtime.sendRaw(body), text);
  await expect.poll(() => site.requests().length).toBe(1);
  expect(site.requests()[0]).toMatchObject({ kind: 'run', path: '/agent', text });
  const recorded = await settled(page, 0);
  expect(recorded.exchanges).toHaveLength(1);
  expect(recorded.exchanges[0]).toMatchObject({ kind: 'raw', status: 422, transport: 'completed', requestBody: text });
  expect(recorded.exchanges[0]?.responseBody).toContain('threadId and runId must be strings');
  expect(recorded.runs).toEqual([]);
  expect(preparations(site)).toEqual([]);
});
