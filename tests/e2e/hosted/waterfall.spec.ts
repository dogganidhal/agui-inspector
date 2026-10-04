// The run waterfall in the assembled app (specs/011-run-waterfall, US1, US3, US6, FR-011, FR-012, FR-014, FR-020, SC-006,
// SC-007). The page is the production build. A scripted target streams the reference agent's delegation run with a pause
// between frames, so the bars have real width, and answers the interactive reference scenarios `tools` and
// `never finishes` from the reference agent's own producer. A run is read, exported, imported into a fresh page and read
// again: the rows, nesting and times must be the same, and using the waterfall must never send a request, write browser
// storage or change the recording.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Locator, Page } from '@playwright/test';
import { delegationRun } from '../../../examples/reference-agent/delegation-run.ts';
import { interactiveResponse, SCENARIOS } from '../../../examples/reference-agent/scenarios.ts';
import { expect, expectAllowlisted, open, send, test, type Site } from './support';

const FRAME_PAUSE_MS = 15;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Target {
  readonly origin: string;
  /** Paths whose connection the browser closed while the response was still open. */
  readonly closed: string[];
  stop(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** `/delegation` plays the delegation run frame by frame. `/interactive` answers with the reference agent's own producer. */
async function target(pageOrigin: () => string): Promise<Target> {
  const closed: string[] = [];
  const server: Server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    response.setHeader('access-control-allow-origin', pageOrigin());
    response.setHeader('vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-methods', 'POST');
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.writeHead(204);
      return void response.end();
    }
    const input = JSON.parse(await readBody(request)) as { threadId: string; runId: string; messages?: Array<{ role?: string; content?: unknown }> };
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    response.on('close', () => !response.writableFinished && closed.push(pathname));
    if (pathname === '/delegation') {
      for (const { event } of delegationRun(input, { subagents: false })) {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
        await sleep(FRAME_PAUSE_MS);
      }
      return void response.end();
    }
    const reply = interactiveResponse(input as Parameters<typeof interactiveResponse>[0]);
    for (const chunk of reply.chunks) response.write(chunk);
    if (reply.ending === 'close') response.end();
  });
  const origin = await new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return {
    origin,
    closed,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** The page's hosting and its one configured agent, which is the one the page selects. */
const sites = (held: Target, agent: string) => ({
  hosting: () => ({ version: 0, mode: 'hosted', allowedOrigins: [held.origin] }),
  config: () => ({ version: 0, agents: [{ id: agent, name: agent, url: `${held.origin}/${agent}` }] }),
});

const tabs = (page: Page) => page.getByRole('group', { name: 'Inspection view' });
const tree = (page: Page) => page.getByRole('tree', { name: 'Run waterfall' });
const rows = (page: Page) => tree(page).getByRole('treeitem');
const row = (page: Page, name: RegExp | string) => tree(page).getByRole('treeitem', { name });
const names = (locator: Locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
const showWaterfall = async (page: Page) => {
  await tabs(page).getByRole('button', { name: 'Waterfall', exact: true }).click();
  await expect(page.locator('[data-view="waterfall"]')).toBeVisible();
};
const stop = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });

async function exportFile(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return readFileSync((await download.path())!, 'utf8');
}

async function use(page: Page, openSite: (options: ReturnType<typeof sites>) => Promise<Site>, held: Target, agent: 'delegation' | 'interactive'): Promise<Site> {
  const site = await openSite(sites(held, agent));
  await open(page, site);
  return site;
}

test('a delegation run is a waterfall of its steps, messages and calls, the same after export and import, and using it changes and sends nothing', async ({ page, openSite, requested }) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __writes: string[] }).__writes = writes;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(key);
      return original.call(this, key, value);
    };
  });
  let pageOrigin = '';
  const held = await target(() => pageOrigin);
  try {
    const site = await use(page, openSite, held, 'delegation');
    pageOrigin = site.page.origin;
    await send(page, 'plan the work');
    await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(1);
    await showWaterfall(page);

    await expect(rows(page)).toHaveCount(10);
    const live = await names(rows(page));
    expect(live[0]).toMatch(/^run, [^,]+, level 1, started \+0\.\d{3}, ended \+(\d\.\d{3}), .*Finished, open$/);
    const ended = Number(/ended \+(\d\.\d{3})/.exec(live[0] as string)?.[1]);
    expect(ended, 'the run spans the real pauses between the frames').toBeGreaterThan(0.4);
    expect(live.map((label) => label.split(',')[0])).toEqual(['run', 'step', 'reasoning', 'text', 'step', 'tool', 'text', 'step', 'text', 'tool']);
    expect(live.find((label) => label.startsWith('tool, pick_color'))).toContain('waiting for result');
    expect(live.filter((label) => label.includes('no end seen') || label.includes('running'))).toEqual([]);
    await expect(row(page, /^step, research,/)).toHaveAttribute('aria-level', '2');
    await expect(row(page, /^tool, search_documents,/)).toHaveAttribute('aria-level', '3');

    // Using the waterfall sent nothing, wrote nothing and left the recording as it was.
    const sent = site.agent.seen.length;
    const requests = requested.length;
    const stored = await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length);
    await row(page, /^step, research,/).focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    await page.keyboard.press('End');
    expect(requested.length).toBe(requests);
    expect(site.agent.seen.length).toBe(sent);
    expect(await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length), 'nothing was written to browser storage').toBe(stored);
    const file = await exportFile(page);
    expect(await exportFile(page), 'two exports of the same session are the same file').toBe(file);
    const parsed = JSON.parse(file) as { version: number; session: Record<string, unknown> };
    expect(parsed.version).toBe(0);
    expect(Object.keys(parsed.session).sort(), 'the waterfall is derived, so the file keeps the format of 0.1.0').toEqual(['derived', 'exchanges', 'findings', 'frames', 'id', 'runs']);

    // A fresh page imports the file and shows the same rows, nesting and times.
    const fresh = await page.context().newPage();
    await open(fresh, site);
    await fresh.locator('input[type="file"]').first().setInputFiles({ name: 'run.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await expect(fresh.getByText('Imported recording: inspection only')).toBeVisible();
    await showWaterfall(fresh);
    await expect(rows(fresh)).toHaveCount(10);
    expect(await names(rows(fresh))).toEqual(live);
    expect(await exportFile(fresh), 'and exporting it again gives back the same bytes').toBe(file);
    expect(site.agent.seen.length, 'importing and reading sent nothing to the agent').toBe(sent);
    expectAllowlisted(requested, [site.page.origin, held.origin]);
  } finally {
    await held.stop();
  }
});

test('the selection and the closed rows stay across the frames list, and a new thread empties the waterfall', async ({ page, openSite }) => {
  let pageOrigin = '';
  const held = await target(() => pageOrigin);
  try {
    const site = await use(page, openSite, held, 'delegation');
    pageOrigin = site.page.origin;
    await send(page, 'plan the work');
    await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(1);
    await showWaterfall(page);

    await row(page, /^step, plan,/).focus();
    await page.keyboard.press('ArrowLeft');
    await row(page, /^tool, search_documents,/).focus();
    await tabs(page).getByRole('button', { name: 'Frames', exact: true }).click();
    await showWaterfall(page);
    await expect(row(page, /^tool, search_documents,/)).toHaveAttribute('aria-selected', 'true');
    await expect(row(page, /^step, plan,/)).toHaveAttribute('aria-expanded', 'false');

    await page.getByRole('button', { name: 'New thread' }).click();
    await expect(page.getByText('No run in this thread yet.')).toBeVisible();
  } finally {
    await held.stop();
  }
});

test('the interactive reference runs: a client tool call waits for its result, and a held-open run is running until Stop and then has no end', async ({ page, openSite }) => {
  let pageOrigin = '';
  const held = await target(() => pageOrigin);
  try {
    const site = await use(page, openSite, held, 'interactive');
    pageOrigin = site.page.origin;
    await showWaterfall(page);

    await send(page, SCENARIOS.tools);
    await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(1);
    const calls = rows(page).filter({ hasText: 'waiting for result' });
    await expect(calls).toHaveCount(2);
    await expect(row(page, /^tool, pick_color,/)).toContainText('waiting for result');
    await expect(row(page, /^tool, pick_size,/)).toContainText('waiting for result');

    await page.getByRole('button', { name: 'New thread' }).click();
    await send(page, SCENARIOS.neverFinishes);
    await expect(row(page, /^run, /)).toContainText('Streaming');
    await expect(row(page, /^text, assistant,/)).toContainText('running');
    await expect(row(page, /^text, assistant,/)).toHaveAttribute('data-open', 'true');
    await stop(page).click();
    await expect(row(page, /^run, /)).toContainText('Stopped by you');
    await expect(row(page, /^text, assistant,/)).toContainText('no end seen');
    expect((await names(rows(page))).filter((label) => label.includes('running'))).toEqual([]);
    await expect.poll(() => held.closed).toContain('/interactive');
  } finally {
    await held.stop();
  }
});

test('embedded, the page has the same Waterfall tab and rows', async ({ page, openSite }) => {
  const site = await openSite({ hosting: () => null, config: () => ({ version: 0, agents: [{ id: 'embedded', name: 'Embedded', url: '/agent' }] }) });
  await open(page, site);
  await send(page, 'hello');
  await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(1);
  await showWaterfall(page);
  const labels = await names(rows(page));
  expect(labels.map((label) => label.split(',')[0])).toEqual(['run', 'text']);
  expect(labels[1]).toMatch(/^text, assistant, level 2, started \+/);
});
