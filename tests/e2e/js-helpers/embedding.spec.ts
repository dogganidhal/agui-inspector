// US1, US2, US3 (SC-007): the real page, served by each JavaScript helper, in a real browser. The Express host listens as
// it is; the Hono and Next.js hosts are Fetch-API code behind a `node:http` server (see hosts.ts). The agent is the
// scripted reference agent on the same origin, so nothing outside the host is contacted.
import { expect, test } from '@playwright/test';
import { AGENT_REPLY, BRAND, startHost, type HostKind, type HostOptions } from './hosts.ts';

const variants: Array<{ label: string; kind: HostKind; options: HostOptions; warningPath: (mount: string) => string }> = [
  { label: 'Express', kind: 'express', options: {}, warningPath: (mount) => mount },
  { label: 'Hono', kind: 'hono', options: {}, warningPath: (mount) => mount },
  // The warning names the path as it was passed to the helper, so a base path is not part of it.
  { label: 'Hono under /api', kind: 'hono', options: { basePath: '/api' }, warningPath: () => '/agui-inspector' },
  // Next.js has no mount step: its warning names the route's path as the first request reports it, and Next.js strips the
  // `basePath` from the URL it gives a route handler.
  { label: 'Next.js', kind: 'next', options: {}, warningPath: (mount) => mount },
  { label: 'Next.js with a basePath', kind: 'next', options: { basePath: '/tools' }, warningPath: () => '/agui-inspector' },
];

for (const { label, kind, options, warningPath } of variants) {
  test(`${label}: the bare path opens the page, which lists the agent, records a run and contacts only the host`, async ({ page }) => {
    const host = await startHost(kind, options);
    const requested: string[] = [];
    const violations: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    page.on('console', (message) => message.text().includes('Content Security Policy') && violations.push(message.text()));
    try {
      const response = await page.goto(`${host.origin}${host.mount}`);
      expect(page.url(), 'the bare path redirected to the page').toBe(`${host.origin}${host.mount}/index.html`);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['content-security-policy']).toBe("script-src 'self'; object-src 'none'; base-uri 'none'");

      // The first configured agent is selected at the start, so its endpoint is the target.
      await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(host.agentUrl);
      await expect(page.getByRole('heading', { name: BRAND.name, level: 1 }), 'the brand argument reached the top bar').toBeVisible();
      const box = page.getByRole('textbox', { name: 'Message' });
      await box.fill('hello');
      await box.press('Enter');
      await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();
      await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 5 frames');

      const paths = requested.map((url) => new URL(url).pathname);
      expect(paths).toContain(`${host.mount}/hosting-config.json`);
      expect(paths).toContain(`${host.mount}/config.json`);
      expect(paths).toContain(host.agentUrl);
      expect(paths, 'nothing is requested from the origin root').not.toContain('/config.json');
      expect(paths.filter((path) => /\.(js|css)$/.test(path)).every((path) => path.startsWith(`${host.mount}/`))).toBe(true);
      const origins = new Set(requested.filter((url) => !/^(blob|data):/.test(url)).map((url) => new URL(url).origin));
      expect([...origins], 'every request goes to the host').toEqual([host.origin]);
      expect(violations).toEqual([]);
      expect(host.warnings).toEqual([`agui-inspector is enabled and mounted at ${warningPath(host.mount)}; disable it outside development`]);
    } finally {
      await host.stop();
    }
  });
}

for (const { label, kind, options } of variants) {
  test(`${label}: the configuration is the version 0 file of the agents, and the redirect keeps the query`, async ({ request }) => {
    const host = await startHost(kind, options);
    try {
      const config = await request.get(`${host.origin}${host.mount}/config.json`);
      expect(config.status()).toBe(200);
      expect(config.headers()['content-type']).toBe('application/json; charset=utf-8');
      expect(await config.json()).toEqual({ version: 0, agents: [{ id: 'demo', url: host.agentUrl, name: 'Demo agent' }], brand: BRAND });
      const redirect = await request.get(`${host.origin}${host.mount}?x=1`, { maxRedirects: 0 });
      expect(redirect.status()).toBe(307);
      expect(redirect.headers().location).toBe('agui-inspector/index.html?x=1');
    } finally {
      await host.stop();
    }
  });
}

test('Next.js with its default trailing slash setting never loops: the slash form is redirected away and the page still loads', async ({ page, request }) => {
  const host = await startHost('next');
  try {
    const slash = await request.get(`${host.origin}${host.mount}/`, { maxRedirects: 0 });
    expect(slash.status(), 'Next.js redirects the slash form back to the bare path').toBe(308);
    expect(slash.headers().location).toBe(host.mount);
    await page.goto(`${host.origin}${host.mount}/`);
    expect(page.url()).toBe(`${host.origin}${host.mount}/index.html`);
    await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(host.agentUrl);
  } finally {
    await host.stop();
  }
});
