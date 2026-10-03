// Shared by the A2UI Playwright specs: the page that hosts packages/inspector/tests/a2ui/fixture.tsx
// (the real A2UI view with the real theme and A2UI stylesheets, served by a local server whose CSP
// restricts scripts only) and the helpers that drive it.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { test as base, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';

/** The script API packages/inspector/tests/a2ui/fixture.tsx puts on window, as far as the specs use it. */
declare global {
  interface Window {
    __a2ui: {
      set(operations: unknown): void;
      render(enabled: boolean): void;
      continueWith(on: boolean): void;
      actions(): Array<{ name: string; surfaceId: string; sourceComponentId: string; context: unknown; timestamp: string }>;
      control(operations: unknown): void;
      /** An `a2ui-surface` activity's whole content, so a lifecycle snapshot (`status`, no operations) can be shown. */
      activity(content: unknown): void;
    };
  }
}

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const OVERRIDE = ':root { --agui-radius: 22px; }';

export interface Site {
  origin: string;
}

export const test = base.extend<object, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'a2ui-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'a2ui', 'fixture.tsx') },
      });
      // No img-src, media-src or connect-src: the page's CSP must not be what stops a third-party request.
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>a2ui fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
        '/override.css': ['text/css', OVERRIDE],
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
  await page.waitForFunction(() => '__a2ui' in window);
}

export const feed = (page: Page, operations: unknown) => page.evaluate((list) => window.__a2ui.set(list), operations);
export const actions = (page: Page) => page.evaluate(() => window.__a2ui.actions());
export const view = (page: Page) => page.locator('[data-view="a2ui"]');

