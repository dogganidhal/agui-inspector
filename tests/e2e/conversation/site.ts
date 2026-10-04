// The browser fixture host for the conversation and state views, served from one loopback origin: the bundle of
// packages/inspector/tests/conversation/fixture.tsx, which streams scripted events through the real frame reader and
// store. Specs push events one at a time and look at what a user would see. Test support, not a spec.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { test as base, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');

export interface Site {
  origin: string;
}

/** The script API the fixture puts on window, as far as the state specs use it. */
export interface Host {
  open(id: string, options?: { input?: object }): void;
  push(exchangeId: string, event: object | string, offsetMs: number): void;
  close(exchangeId: string, transport?: string): void;
  revealed: Array<{ exchangeId: string; frameId?: string }>;
}

export const test = base.extend<object, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'conversation-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'conversation', 'fixture.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>conversation fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
      };
      const server: Server = createServer((request, response) => {
        const hit = files[new URL(request.url ?? '/', 'http://x').pathname];
        response.writeHead(hit ? 200 : 404, { 'content-type': hit?.[0] ?? 'text/plain' });
        response.end(hit?.[1] ?? 'not found');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

export async function open(page: Page, site: Site): Promise<void> {
  await page.goto(site.origin);
  await page.waitForFunction(() => '__conversation' in window);
}

/** Starts an exchange of the given thread (t1 unless named). */
export const start = (page: Page, id: string, threadId = 't1', runId = id) =>
  page.evaluate(([exchange, thread, run]) => (window as unknown as { __conversation: Host }).__conversation.open(exchange as string, { input: { threadId: thread as string, runId: run as string } }), [id, threadId, runId]);

/** Pushes events to an exchange, 10 ms apart from `from`. */
export const send = (page: Page, id: string, events: ReadonlyArray<object | string>, from = 10) =>
  page.evaluate(
    ([exchange, list, offset]) => (list as Array<object | string>).forEach((event, i) => (window as unknown as { __conversation: Host }).__conversation.push(exchange as string, event, (offset as number) + i * 10)),
    [id, events, from],
  );

/** What the state view asked the page to reveal. */
export const revealed = (page: Page) => page.evaluate(() => (window as unknown as { __conversation: Host }).__conversation.revealed.map((target) => ({ ...target })));
