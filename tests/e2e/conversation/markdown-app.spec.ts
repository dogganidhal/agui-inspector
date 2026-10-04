// Spec 012 (US2, US3; FR-009, FR-010, FR-011; SC-001 to SC-003): Markdown through the whole production app, with its own
// content security policy in force. The page is the real build (`buildApp`) served from one loopback origin, which is also
// the agent. The reply is the reference agent's `markdownRunResponse`, chunk for chunk: every construct the view draws, and
// a remote image, a `javascript:` link and raw HTML with a handler. A live run is turned into Markdown and back, exported,
// and imported again; the recording, the requests and the policy report are checked around each step.
//
// Self-contained on purpose, like tests/e2e/hosted/support.ts: it shares no helper with another spec.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { MARKDOWN_REPLY, markdownRunResponse } from '../../../examples/reference-agent/scenarios.ts';
import { buildApp } from '../../../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

declare global {
  interface Window {
    __pwned?: number;
    __violations: Array<{ directive: string; blocked: string }>;
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

interface Site {
  readonly origin: string;
  /** Every request the server received, `METHOD path`. */
  readonly seen: string[];
}

const test = base.extend<{ site: Site }, { dist: string }>({
  dist: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const dist = mkdtempSync(path.join(root, '.build', 'markdown-app-e2e-'));
      await buildApp(dist);
      await use(dist);
      rmSync(dist, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  site: async ({ dist }, use) => {
    const seen: string[] = [];
    let origin = '';
    const server: Server = createServer(async (request, response) => {
      const { pathname } = new URL(request.url ?? '/', 'http://x');
      seen.push(`${request.method} ${pathname}`);
      if (request.method === 'POST' && pathname === '/agent') {
        const input = JSON.parse(await readBody(request)) as { threadId: string; runId: string };
        const reply = markdownRunResponse({ threadId: input.threadId, runId: input.runId });
        response.writeHead(reply.status, { 'content-type': reply.contentType, 'cache-control': 'no-store' });
        return void response.end(Buffer.concat(reply.chunks));
      }
      if (pathname === '/config.json') {
        response.writeHead(200, { 'content-type': 'application/json' });
        return void response.end(JSON.stringify({ version: 0, agents: [{ id: 'markdown', name: 'Markdown agent', url: `${origin}/agent` }] }));
      }
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      try {
        const content = /^[\w.-]+$/.test(name) ? readFileSync(path.join(dist, name)) : undefined;
        if (content === undefined) throw new Error('not a file');
        response.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream' });
        response.end(content);
      } catch {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await use({ origin, seen });
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  },
});

const toolbar = (page: Page) => page.locator('.agui-ins-head');
const markdownButton = (page: Page) => page.getByRole('button', { name: 'Markdown', exact: true });
const plainButton = (page: Page) => page.getByRole('button', { name: 'Plain text', exact: true });
const reply = (page: Page) => page.locator('[data-view="conversation"] [data-entry="message"][data-role="assistant"] .agui-conv-body');

async function exportSession(page: Page): Promise<string> {
  await toolbar(page).getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return readFileSync((await download.path())!, 'utf8');
}

const importText = (page: Page, text: string) => page.getByLabel('Session file to import').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(text) });

/** What the page drew for the reply, read from the DOM. */
async function drawn(page: Page) {
  return reply(page).evaluate((body) => ({
    heading: body.querySelector('h3')?.textContent,
    strong: body.querySelector('strong')?.textContent,
    em: body.querySelector('em')?.textContent,
    del: body.querySelector('del')?.textContent,
    code: body.querySelector('code')?.textContent,
    items: [...body.querySelectorAll('li')].map((node) => node.textContent),
    cells: [...body.querySelectorAll('td')].map((node) => [node.textContent, node.getAttribute('data-align')]),
    block: body.querySelector('pre')?.textContent,
    links: [...body.querySelectorAll('a')].map((node) => node.getAttribute('href')),
    addresses: [...body.querySelectorAll('.agui-md-dest')].map((node) => node.textContent),
    inert: [...body.querySelectorAll('.agui-md-inert')].map((node) => node.textContent),
    active: body.querySelectorAll('img, iframe, script, style, form, svg, [style], [onerror]').length,
  }));
}

const FORMATTED = {
  heading: 'Release notes',
  strong: 'agent',
  em: 'Markdown',
  del: 'no',
  code: 'inline code',
  items: ['a list item', 'another item'],
  cells: [['apples', 'left'], ['3', 'right']],
  block: 'const answer = 42;',
  links: ['https://example.test/docs'],
  addresses: ['(https://example.test/docs)'],
  inert: ['[image: remote image]'],
  active: 0,
};

test('a live run, then Markdown on and off, then an import of the same recording', async ({ page, site }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  // zod probes `new Function('')` once inside a try/catch and the policy reports it. Nothing is evaluated, so only
  // violations of any other kind count, as in tests/e2e/hosted/support.ts.
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
  });

  await page.goto(site.origin);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill('show me markdown');
  await box.press('Enter');
  await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();

  // Plain text is the default: the reply is exactly the text the agent sent.
  await expect(page.locator('[data-view="conversation"]')).toHaveAttribute('data-text-mode', 'plain');
  await expect(plainButton(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await reply(page).evaluate((body) => body.textContent)).toBe(MARKDOWN_REPLY);
  const recorded = await exportSession(page);
  expect(recorded).toContain('Release notes');

  // Markdown on: every construct is drawn, and the hostile parts are inert.
  await markdownButton(page).click();
  await expect(reply(page).getByRole('heading', { name: 'Release notes', level: 3 })).toBeVisible();
  expect(await drawn(page)).toEqual(FORMATTED);
  await expect(reply(page).getByRole('link', { name: 'link' })).toHaveAttribute('target', '_blank');
  expect(await reply(page).evaluate((body) => body.textContent)).toContain('[unsafe link](javascript:window.__pwned=1)');
  expect(await reply(page).evaluate((body) => body.textContent)).toContain('<img src=x onerror="window.__pwned=1">');
  expect(await exportSession(page), 'the export is the same bytes while Markdown is on').toBe(recorded);

  // Back to plain text: the received text again.
  await plainButton(page).click();
  expect(await reply(page).evaluate((body) => body.textContent)).toBe(MARKDOWN_REPLY);
  expect(await exportSession(page), 'and after turning it off').toBe(recorded);

  // An imported session: the mode is kept across the import, and the same text draws the same way.
  await markdownButton(page).click();
  await expect(reply(page).getByRole('heading', { name: 'Release notes' })).toBeVisible();
  await importText(page, recorded);
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(page.locator('[data-view="conversation"]')).toHaveAttribute('data-text-mode', 'markdown');
  await expect(reply(page).getByRole('heading', { name: 'Release notes' })).toBeVisible();
  expect(await drawn(page)).toEqual(FORMATTED);
  await plainButton(page).click();
  expect(await reply(page).evaluate((body) => body.textContent)).toBe(MARKDOWN_REPLY);
  await markdownButton(page).click();
  expect(await drawn(page)).toEqual(FORMATTED);
  expect(await exportSession(page), 'exporting what was imported gives back the same bytes').toBe(recorded);

  // The whole time: no script ran, no problem in the console, no violation, and no request left the page's own origin.
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(problems).toEqual([]);
  expect((await page.evaluate(() => window.__violations)).filter((violation) => violation.blocked !== 'eval')).toEqual([]);
  expect(requested.filter((url) => !url.startsWith(`${site.origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank')).toEqual([]);
  expect(site.seen.filter((line) => line.startsWith('POST') && !line.endsWith(' /agent'))).toEqual([]);
  expect(site.seen.filter((line) => line.startsWith('POST'))).toEqual(['POST /agent']);
});

test('on a narrow screen the page does not scroll sideways with Markdown on', async ({ page, site }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(site.origin);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill('hello');
  await box.press('Enter');
  await expect(reply(page)).toBeVisible();
  await markdownButton(page).click();
  await expect(reply(page).getByRole('table')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page does not scroll sideways').toBe(true);
});
