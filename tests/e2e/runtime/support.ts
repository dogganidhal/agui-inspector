// Shared by the runtime end-to-end specs: the real runtime wired to the real connection controls, reply editors and
// conversation view (packages/inspector/tests/runtime/harness.tsx), served next to loopback reference servers
// (examples/reference-agent/interactive-scenarios.ts) that record the body of every preparation and run request.
// Every test built on `test` also checks the network allowlist: the page may talk to its own origin and the servers
// this file started, and nothing else.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Locator, type Page } from '@playwright/test';

export { expect };
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

export const root = path.resolve(import.meta.dirname, '..', '..', '..');
export const SYNTHETIC_TOKEN = 'synthetic-token-7f3a91';
export const COOKIE = { name: 'host_session', value: 'synthetic-cookie-51d2' };

export interface Servers {
  /** Serves the page, and also an agent for embedded use. */
  site: InteractiveServer;
  /** An agent on another origin that allows the page's origin (CORS). */
  remote: InteractiveServer;
  /** An agent on another origin that grants no CORS at all. */
  closed: InteractiveServer;
}

export interface Session {
  exchanges: Array<{ id: string; kind: string; method: string; path: string; status?: number; transport: string; transportError?: string; requestBody?: string; responseBody?: string; runId?: string }>;
  frames: Array<{ exchangeId: string; eventType?: string; jsonVerdict: string; schemaVerdict: string; data?: string }>;
  runs: Array<{ id: string; runId: string; parentRunId?: string; input: Record<string, unknown>; outcome: { kind: string; [key: string]: unknown } }>;
  findings: Array<{ kind: string; message: string; subject: { type: string; id: string } }>;
}

export interface RunBody {
  threadId: string;
  runId: string;
  parentRunId?: string;
  protocolVersion?: string;
  state: unknown;
  messages: Array<{ id: string; role: string; content?: string; toolCallId?: string }>;
  forwardedProps: Record<string, unknown>;
  resume?: Array<{ interruptId: string; status: string; payload?: unknown }>;
}

export const test = base.extend<{ requested: string[] }, { servers: Servers }>({
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

export const runs = (server: InteractiveServer) => server.requests().filter((request) => request.kind === 'run');
export const preparations = (server: InteractiveServer) => server.requests().filter((request) => request.kind === 'preparation');
export const bodyOf = (request: RecordedRequest | undefined) => request?.body as RunBody;

export interface OpenOptions {
  mode?: 'embedded' | 'hosted';
  allow?: string[];
  agentBase?: string;
  agent?: 'support' | 'plain';
  target?: string;
}

export async function open(page: Page, servers: Servers, options: OpenOptions = {}): Promise<void> {
  const query = new URLSearchParams();
  if (options.mode) query.set('mode', options.mode);
  if (options.allow?.length) query.set('allow', options.allow.join(','));
  if (options.agentBase) query.set('agentBase', options.agentBase);
  if (options.agent) query.set('agent', options.agent);
  if (options.target) query.set('target', options.target);
  await page.goto(`${servers.site.origin}/?${query}`);
  await expect(page.getByRole('button', { name: /^Authentication/ })).toBeVisible();
}

export const session = (page: Page): Promise<Session> => page.evaluate(() => window.__harness.session() as never);
export const messageBox = (page: Page) => page.getByLabel('Message', { exact: true });
export const sendButton = (page: Page) => page.getByRole('button', { name: 'Send message' });
export const alert = (page: Page) => page.getByRole('alert');

export async function send(page: Page, text: string): Promise<void> {
  await messageBox(page).fill(text);
  await sendButton(page).click();
}

export async function enterToken(page: Page, token = SYNTHETIC_TOKEN, header?: string): Promise<void> {
  await page.getByRole('button', { name: /^Authentication/ }).click();
  const popover = page.locator('[popover]:popover-open');
  if (header !== undefined) await popover.getByLabel('Header name').fill(header);
  await popover.getByLabel('Token').fill(token);
  await page.keyboard.press('Escape');
}

/** Waits until the page has recorded this many conversation exchanges and every exchange has ended. */
export async function settled(page: Page, conversations: number): Promise<Session> {
  await expect
    .poll(async () => {
      const current = await session(page);
      const ended = current.exchanges.every((exchange) => ['completed', 'transport-error', 'user-stopped'].includes(exchange.transport));
      return ended && current.exchanges.filter((exchange) => exchange.kind === 'conversation').length === conversations;
    })
    .toBe(true);
  return session(page);
}

export const card = (page: Page, interruptId: string): Locator => page.locator(`[data-entry="interrupt"][data-interrupt="${interruptId}"]`);
export const toolCard = (page: Page, toolCallId: string): Locator => page.locator(`[data-entry="tool-result"][data-tool-call="${toolCallId}"]`);
