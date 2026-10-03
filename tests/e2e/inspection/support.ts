// Shared by the inspection end-to-end specs: the scripted host page, served from one loopback
// origin, and a scripted agent on another, with explicit CORS for the page's origin only. The agent
// records what it receives, so a spec can compare the bytes it was sent with the bytes entered.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { test as base, expect, type Page } from '@playwright/test';
import { protocolScenarios } from '../../../examples/reference-agent/protocol-fixtures.ts';
import { scenarioBytes } from '../../../examples/reference-agent/recorder-fixtures.ts';
import { bundleOptions } from '../../../scripts/build.mjs';

export const root = path.resolve(import.meta.dirname, '..', '..', '..');

export interface Received {
  readonly path: string;
  readonly body: string;
  /** Whether a credential header arrived; the value stays on the server and is never echoed. */
  readonly authorization: string | undefined;
}

export interface Site {
  readonly pageOrigin: string;
  readonly agentOrigin: string;
  /** Every request the agent has received since the last reset. */
  readonly received: Received[];
}

const runBody = (threadId: string, runId: string) => [
  { type: 'RUN_STARTED', threadId, runId },
  { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'msg-1', delta: 'Hello from the scripted agent.' },
  { type: 'TEXT_MESSAGE_END', messageId: 'msg-1' },
  { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } },
];

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function agent(pageOrigin: string, received: Received[], extra?: (path: string, response: ServerResponse) => boolean): Server {
  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    if (request.headers.origin === pageOrigin) {
      response.setHeader('access-control-allow-origin', pageOrigin);
      response.setHeader('vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-methods', 'POST, PUT');
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.writeHead(204);
      return void response.end();
    }
    const body = await readBody(request);
    received.push({ path: pathname, body, authorization: request.headers.authorization });

    if (extra?.(pathname, response)) return;
    // Preparation requests: any /prepare/ path answers 200, except the one that stands for a broken one.
    if (pathname.startsWith('/prepare/')) {
      const broken = pathname === '/prepare/broken';
      response.writeHead(broken ? 500 : 200, { 'content-type': 'application/json' });
      return void response.end(broken ? '{"error":"warm-up failed"}' : '{"ok":true}');
    }
    const scenario = pathname.startsWith('/scenario/') ? (protocolScenarios as Record<string, (typeof protocolScenarios)[keyof typeof protocolScenarios]>)[pathname.slice('/scenario/'.length)] : undefined;
    if (scenario) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      response.end(Buffer.from(scenarioBytes(scenario)));
      return;
    }
    if (pathname !== '/agent') {
      response.writeHead(404, { 'content-type': 'application/json' });
      return void response.end('{"error":"not found"}');
    }
    let input: { threadId?: unknown; runId?: unknown } | undefined;
    try {
      input = JSON.parse(body);
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      return void response.end('{"error":"request body is not valid JSON"}');
    }
    if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
      response.writeHead(422, { 'content-type': 'application/json' });
      return void response.end('{"error":"threadId and runId must be strings"}');
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    response.end(runBody(input.threadId, input.runId).map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
}

const listen = (server: Server) => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
// close() alone waits for a connection that is mid-request, such as one the browser still has open
// when the test ends; dropping the connections lets the teardown finish at once.
const close = (server: Server) =>
  new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });

export const PAGE_CSP = "script-src 'self'; object-src 'none'; base-uri 'none'";

export function hostPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}" />
    <title>inspection host</title>
    <link rel="stylesheet" href="/host.css" />
  </head>
  <body><div id="root" data-target="__TARGET__"></div><script type="module" src="/host.js"></script></body>
</html>`;
}

/** Bundles the host the way the app is bundled (production, minified) into a fresh directory. */
export async function bundleHost(entry: { contents?: string } = {}): Promise<{ dir: string; js: string; css: string }> {
  mkdirSync(path.join(root, '.build'), { recursive: true });
  const dir = mkdtempSync(path.join(root, '.build', 'inspection-e2e-'));
  const hostFile = path.join(root, 'packages', 'inspector', 'tests', 'inspection', 'host.tsx');
  await build({
    ...bundleOptions(dir),
    entryNames: 'host',
    ...(entry.contents
      ? { stdin: { contents: entry.contents, resolveDir: path.join(root, 'packages', 'inspector'), sourcefile: 'host-entry.tsx', loader: 'tsx' as const } }
      : { entryPoints: [hostFile] }),
  });
  return { dir, js: readFileSync(path.join(dir, 'host.js'), 'utf8'), css: readFileSync(path.join(dir, 'host.css'), 'utf8') };
}

export async function serveSite(bundle: { js: string; css: string }, extra?: (path: string, response: ServerResponse) => boolean): Promise<{ site: Site; stop(): Promise<void> }> {
  const received: Received[] = [];
  let agentOrigin = '';
  let pageOrigin = '';
  const page = createServer((request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    const files: Record<string, [string, string]> = {
      '/': ['text/html', hostPage().replace('__TARGET__', agentOrigin)],
      '/host.js': ['text/javascript', bundle.js],
      '/host.css': ['text/css', bundle.css],
    };
    const hit = files[pathname];
    response.writeHead(hit ? 200 : 404, { 'content-type': hit?.[0] ?? 'text/plain' });
    response.end(hit?.[1] ?? 'not found');
  });
  pageOrigin = await listen(page);
  const target = agent(pageOrigin, received, extra);
  agentOrigin = await listen(target);
  return {
    site: { pageOrigin, agentOrigin, received },
    stop: async () => {
      await Promise.all([close(page), close(target)]);
    },
  };
}

export const test = base.extend<{ network: string[] }, { site: Site }>({
  site: [
    async ({}, use) => {
      const bundle = await bundleHost();
      const { site, stop } = await serveSite(bundle);
      await use(site);
      await stop();
      rmSync(bundle.dir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  // Every request the page makes, by URL: the network allowlist is checked against this.
  network: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await use(urls);
  },
});

export { expect };

/** Opens the host and waits for the view. */
export async function open(page: Page, site: Site): Promise<void> {
  site.received.length = 0;
  await page.goto(site.pageOrigin);
  await expect(page.getByRole('heading', { name: 'Inspection' })).toBeVisible();
  await page.waitForFunction(() => '__host' in window);
}

/** Records a preparation exchange against the scripted agent and returns its exchange id. */
export const prepare = (page: Page, method: string, path: string) =>
  page.evaluate(([verb, target]) => (window as unknown as { __host: { prepare(method: string, path: string): Promise<string> } }).__host.prepare(verb!, target!), [method, path]);

/** Records a scripted conversation exchange and returns its exchange id. */
export const run = (page: Page, scenario: string) =>
  page.evaluate((name) => (window as unknown as { __host: { run(path: string): Promise<string> } }).__host.run(`/scenario/${name}`), scenario);

/** Every URL the page requested must be the page's own origin or the agent's, and nothing else. */
export function expectAllowlisted(urls: readonly string[], site: Site): void {
  const allowed = [site.pageOrigin, site.agentOrigin];
  for (const url of urls) {
    if (url.startsWith('data:') || url.startsWith('blob:')) continue;
    expect(allowed.some((origin) => url.startsWith(`${origin}/`)), `unexpected request to ${url}`).toBe(true);
  }
}

interface SnapshotFrame {
  id: string;
  exchangeId: string;
  index: number;
  data?: string;
  envelope: string;
  parsed?: unknown;
  eventType?: string;
  classification: string;
  jsonVerdict: string;
}
export interface Snapshot {
  exchanges: Array<{ id: string; kind: string; frameIds: string[]; requestBody?: string; status?: number; responseBody?: string }>;
  frames: SnapshotFrame[];
  runs: unknown[];
  [key: string]: unknown;
}

/** The session the view is showing, as plain data. */
export const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __host: { snapshot(): unknown } }).__host.snapshot()) as Promise<Snapshot>;
