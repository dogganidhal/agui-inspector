// US4 (SC-002): the disabled helper mounts nothing and the host's own authentication guards every inspector route,
// shown on each JavaScript host. The credentials are synthetic and made per run.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { AGENT_REPLY, startHost, type HostKind, type HostOptions } from './hosts.ts';

const variants: Array<{ label: string; kind: HostKind; options: HostOptions }> = [
  { label: 'Express', kind: 'express', options: {} },
  { label: 'Hono', kind: 'hono', options: {} },
  { label: 'Hono under /api', kind: 'hono', options: { basePath: '/api' } },
  { label: 'Next.js', kind: 'next', options: {} },
  { label: 'Next.js with a basePath', kind: 'next', options: { basePath: '/tools' } },
];

const credentials = { user: 'host-user', password: `synthetic-${randomUUID()}` };
const inspectorPaths = (mount: string) => [mount, `${mount}/`, `${mount}/index.html`, `${mount}/config.json`, `${mount}/app.js`, `${mount}/hosting-config.json`, `${mount}/nope.js`];
const run = { threadId: 't', runId: 'r', messages: [] };

for (const { label, kind, options } of variants) {
  test(`${label}: a disabled helper mounts nothing, logs nothing and leaves the host's own routes alone`, async ({ request }) => {
    const host = await startHost(kind, { ...options, enabled: false });
    try {
      for (const path of inspectorPaths(host.mount)) {
        const response = await request.get(`${host.origin}${path}`, { maxRedirects: 0 });
        expect([404, 308], `${path} is not the inspector`).toContain(response.status());
        expect(response.headers()['content-security-policy'] ?? '').not.toContain("script-src 'self'; object-src 'none'; base-uri 'none'");
        expect(await response.text(), path).not.toContain('<div id="root">');
      }
      expect((await request.get(`${host.origin}${host.mount}/config.json`)).status()).toBe(404);
      const agent = await request.post(`${host.origin}${host.agentUrl}`, { data: run });
      expect(agent.status(), 'the host still answers its agent route').toBe(200);
      expect(await agent.text()).toContain(AGENT_REPLY);
      expect(host.warnings).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  test(`${label}: the host's authentication guards the page, its files, the configuration, the redirect and the agent route`, async ({ browser, request }) => {
    const host = await startHost(kind, { ...options, credentials });
    try {
      for (const path of [...inspectorPaths(host.mount), host.agentUrl]) {
        const denied = await request.fetch(`${host.origin}${path}`, { method: path === host.agentUrl ? 'POST' : 'GET', data: path === host.agentUrl ? run : undefined, maxRedirects: 0 });
        expect(denied.status(), path).toBe(401);
        expect(await denied.text(), path).toBe('host guard');
        expect(denied.headers()['content-security-policy'], 'the host answered, not the helper').toBeUndefined();
      }
      // With the credentials the browser already holds, the same origin serves the page and the agent.
      const context = await browser.newContext({ httpCredentials: { username: credentials.user, password: credentials.password } });
      try {
        const page = await context.newPage();
        await page.goto(`${host.origin}${host.mount}`);
        await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(host.agentUrl);
        const box = page.getByRole('textbox', { name: 'Message' });
        await box.fill('hello');
        await box.press('Enter');
        await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      await host.stop();
    }
  });
}
