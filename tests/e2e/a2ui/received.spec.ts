// FX14 (FR-020; constitution I): what a user types into a rendered A2UI surface never reaches the
// operations the agent sent. The page is the production build, embedded in one loopback origin that also
// answers as a scripted agent. A bound field is typed into, then the same activity is read three ways
// that must still show the agent's value: the JSON view of its card, the exported session, and that
// session imported again. A drawn surface that did write into its own received list would show the
// typed text in all three.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { buildApp } from '../../../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const V = 'v0.9';
const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** What the agent sends: a note field the agent starts empty, and a button that carries it back. */
const OPERATIONS = [
  { version: V, createSurface: { surfaceId: 'form', catalogId: CATALOG } },
  {
    version: V,
    updateComponents: {
      surfaceId: 'form',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'note', 'send'] },
        { id: 'title', component: 'Text', text: 'Order check', variant: 'h3' },
        { id: 'note', component: 'TextField', label: 'Note', value: { path: '/note' } },
        { id: 'send-label', component: 'Text', text: 'Send note' },
        { id: 'send', component: 'Button', child: 'send-label', variant: 'primary', action: { event: { name: 'send_note', context: { form: { path: '/' } } } } },
      ],
    },
  },
  { version: V, updateDataModel: { surfaceId: 'form', path: '/', value: { note: '', count: 1 } } },
];

interface Site {
  origin: string;
  /** The body of every run request the agent received. */
  runs: string[];
}

const test = base.extend<object, { dist: string }>({
  dist: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const dist = mkdtempSync(path.join(root, '.build', 'received-e2e-'));
      await buildApp(dist);
      await use(dist);
      rmSync(dist, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

const sse = (events: readonly object[]) => events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');

async function serve(dist: string): Promise<{ site: Site; stop(): Promise<void> }> {
  const runs: string[] = [];
  let origin = '';
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server: Server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    if (request.method === 'POST' && pathname === '/agent') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString('utf8');
      runs.push(body);
      const { threadId, runId } = JSON.parse(body) as { threadId: string; runId: string };
      const first = runs.length === 1;
      const events = first
        ? [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'activity-1', activityType: 'a2ui-surface', content: { a2ui_operations: OPERATIONS }, replace: true }]
        : [{ type: 'TEXT_MESSAGE_START', messageId: `m-${runId}`, role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${runId}`, delta: 'Action received.' }, { type: 'TEXT_MESSAGE_END', messageId: `m-${runId}` }];
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      return void response.end(sse([{ type: 'RUN_STARTED', threadId, runId }, ...events, { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } }]));
    }
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (name === 'config.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      return void response.end(JSON.stringify({ version: 0, agents: [{ id: 'support', name: 'Support assistant', url: `${origin}/agent` }] }));
    }
    try {
      const content = /^[\w.-]+$/.test(name) ? readFileSync(path.join(dist, name)) : undefined;
      if (content === undefined) throw new Error('not served');
      response.writeHead(200, { 'content-type': types[path.extname(name)] ?? 'application/octet-stream' });
      response.end(content);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    site: { origin, runs },
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** The activity card's JSON, as the page shows it. */
const jsonOf = (page: Page) => page.getByLabel('Content of activity-1');

async function showJson(page: Page): Promise<void> {
  await page.getByRole('group', { name: 'Activity display' }).getByRole('button', { name: 'JSON' }).click();
}

/** Exports the session and returns the file's parsed content. */
async function exportSession(page: Page, to: string): Promise<{ session: unknown }> {
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  await download.saveAs(to);
  return { session: JSON.parse(readFileSync(to, 'utf8')) };
}

const framesOf = (file: unknown) => (file as { session: { frames: Array<{ data?: string }> } }).session.frames;

/** The operations the exported frames carry, read from the raw frame text. */
function operationsIn(file: unknown): unknown {
  const events = framesOf(file).map((frame) => (frame.data === undefined ? undefined : (JSON.parse(frame.data) as { type?: string; content?: { a2ui_operations?: unknown } })));
  return events.find((event) => event?.type === 'ACTIVITY_SNAPSHOT')?.content?.a2ui_operations;
}

test('typing into a bound field leaves the received operations as sent: JSON view, export and re-import', async ({ page, dist }, info) => {
  const { site, stop } = await serve(dist);
  try {
    await page.goto(site.origin);
    await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('show the form');
    await box.press('Enter');
    const note = page.getByRole('textbox', { name: 'Note' });
    await expect(note).toHaveValue('');
    const untouched = await exportSession(page, info.outputPath('before.json'));
    expect(operationsIn(untouched.session)).toEqual(OPERATIONS);

    await note.fill('typed by me');
    await expect(note).toHaveValue('typed by me');

    // The bound value is real: the action carries what was typed, and only the action does.
    await page.getByRole('button', { name: 'Send note' }).click();
    await expect.poll(() => site.runs.length).toBe(2);
    expect(JSON.parse(site.runs[1]!).forwardedProps.a2uiAction.userAction.context).toEqual({ form: { note: 'typed by me', count: 1 } });
    await expect(page.getByText('Action received.').first()).toBeVisible();

    // 1. The JSON view of the activity card shows what the agent sent.
    await showJson(page);
    const content = await jsonOf(page).innerText();
    expect(JSON.parse(content)).toEqual({ a2ui_operations: OPERATIONS });
    expect(content).not.toContain('typed by me');

    // 2. The exported session holds the same operations, and the frames recorded before the user typed are unchanged.
    const typed = await exportSession(page, info.outputPath('after.json'));
    expect(operationsIn(typed.session)).toEqual(OPERATIONS);
    const before = framesOf(untouched.session);
    expect(framesOf(typed.session).slice(0, before.length)).toEqual(before);

    // 3. Imported again, the recording shows the same operations.
    await page.locator('input[type="file"]').first().setInputFiles(info.outputPath('after.json'));
    await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
    await showJson(page);
    expect(JSON.parse(await jsonOf(page).innerText())).toEqual({ a2ui_operations: OPERATIONS });
  } finally {
    await stop();
  }
});
