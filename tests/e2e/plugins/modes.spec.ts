// Spec 014 (FR-001 to FR-004, FR-019, FR-020, SC-001 to SC-003): a plugin named in `config.json` or in a helper argument is
// loaded from the page's own origin in every serving mode, with the policy and the requests unchanged, and a rejected address
// is one warning, no request and no lost agent. The page under test is the production build. The plugins here register
// nothing: they only leave a mark on the page, so the spec proves loading and the same-origin rule. What a plugin can do is
// in the other specs of this directory.
import { startHost, type HostKind, type HostOptions } from '../js-helpers/hosts';
import { startPython, startStatic } from '../hosted/serving';
import { AGENT_REPLY, expect, expectAllowlisted, send, test, type SiteOptions } from '../hosted/support';
import { footer, JS, loaded, marker, metas, warn, warnings } from './support';

const hostedConfig = (plugins?: unknown) => (o: { agent: { origin: string } }) => ({ version: 0, agents: [{ id: 'support', name: 'Support assistant', url: `${o.agent.origin}/agent` }], ...(plugins !== undefined && { plugins }) });
const embeddedConfig = (plugins?: unknown) => () => ({ version: 0, agents: [{ id: 'support', url: '/agent' }], ...(plugins !== undefined && { plugins }) });

const files = (): NonNullable<SiteOptions['files']> => ({
  '/plugins/a.js': { type: JS, body: marker('a') },
  '/plugins/b.js': { type: JS, body: marker('b') },
  '/static/plugins/c.js': { type: JS, body: marker('c') },
});

// ---------------------------------------------------------------------------------------------
// Hosted and embedded pages
// ---------------------------------------------------------------------------------------------

for (const mode of ['hosted', 'embedded'] as const) {
  const options = (plugins?: unknown, extra: NonNullable<SiteOptions['files']> = files()): SiteOptions =>
    mode === 'hosted' ? { config: hostedConfig(plugins), files: extra } : { hosting: () => null, config: embeddedConfig(plugins), files: extra };

  test(`${mode}: a plugin loads from the page's own origin, the footer counts it, and the policy and the requests are unchanged`, async ({ page, openSite, requested, violations }) => {
    const baseline = await openSite(options(undefined));
    const site = await openSite(options(['plugins/a.js']));

    await page.goto(baseline.page.origin);
    await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
    await expect(footer(page)).not.toContainText('plugin');
    const policy = (await metas(page))[1]?.replaceAll(baseline.agent.origin, 'AGENT');
    expect(requested.filter((url) => url.includes('/plugins/'))).toEqual([]);

    await page.goto(site.page.origin);
    await expect(footer(page)).toContainText('0 exchanges · 0 frames · 1 plugin ·');
    expect(await loaded(page)).toBe('a');
    await expect(warnings(page)).toHaveCount(0);
    expect((await metas(page))[1]?.replaceAll(site.agent.origin, 'AGENT'), 'the content security policy text is the same with a plugin').toBe(policy);
    expect(requested).toContain(`${site.page.origin}/plugins/a.js`);

    await send(page, 'hello');
    await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
    expectAllowlisted(requested, [baseline.page.origin, baseline.agent.origin, site.page.origin, site.agent.origin]);
    expect(await violations()).toEqual([]);
  });

  test(`${mode}: a relative path, an absolute path and a full URL on the page's origin all load, and entries activate in the order written`, async ({ page, openSite }) => {
    const extra = files();
    const site = await openSite(options(['plugins/a.js'], extra));
    extra['/config.json'] = { type: 'application/json', body: JSON.stringify(options(['plugins/a.js', '/plugins/b.js', `${site.page.origin}/static/plugins/c.js`]).config?.(site) ?? {}) };
    await page.goto(site.page.origin);
    await expect(footer(page)).toContainText('3 plugins');
    expect(await loaded(page)).toBe('abc');
    await expect(warnings(page)).toHaveCount(0);
  });

  test(`${mode}: each rejected address is one warning, no request goes to another origin, and the other plugins and the agent still work`, async ({ page, openSite, requested, violations }) => {
    const bad = ['https://other.example/x.js', '//other.example/x.js', 'data:text/javascript,export default () => {}', 'javascript:alert(1)', 'blob:https://other.example/x', 'https://user:pw@127.0.0.1/x.js', 'plugins\\evil.js', 7, ''];
    const extra = files();
    const withBad = await openSite(options(undefined, extra));
    extra['/config.json'] = { type: 'application/json', body: JSON.stringify(options([...bad, 'plugins/a.js', 'plugins/b.js']).config?.(withBad) ?? {}) };
    await page.goto(withBad.page.origin);
    await expect(footer(page)).toContainText('2 plugins');
    expect(await loaded(page)).toBe('ab');
    await expect(warn(page)).toHaveCount(bad.length);
    for (const text of await warn(page).allInnerTexts()) {
      expect(text).toMatch(/plugins\[\d\] .*; it was ignored/);
      expect(text).not.toContain('other.example');
    }
    expect(await page.getByRole('alert').count()).toBe(0);
    await send(page, 'hello');
    await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
    expect(requested.filter((url) => url.includes('other.example') || url.startsWith('data:text/javascript'))).toEqual([]);
    expect(withBad.foreign.seen).toEqual([]);
    expectAllowlisted(requested, [withBad.page.origin, withBad.agent.origin]);
    expect(await violations()).toEqual([]);
  });

  test(`${mode}: the same module written twice loads once with one warning`, async ({ page, openSite }) => {
    const extra = files();
    const site = await openSite(options(undefined, extra));
    extra['/config.json'] = { type: 'application/json', body: JSON.stringify(options(['plugins/a.js', '/plugins/a.js', './plugins/a.js']).config?.(site) ?? {}) };
    await page.goto(site.page.origin);
    await expect(footer(page)).toContainText('1 plugin ·');
    expect(await loaded(page)).toBe('a');
    await expect(warn(page)).toHaveCount(2);
    await expect(warn(page).first()).toContainText('repeats an earlier entry');
  });
}

test('hosted: the file that hosting-config.json names carries the plugins, and the startup policy is the one it set', async ({ page, openSite, violations }) => {
  const extra = files();
  extra['/deployment.json'] = { type: 'application/json', body: JSON.stringify({ version: 0, agents: [{ id: 'support', url: '/agent' }], plugins: ['plugins/a.js'] }) };
  const site = await openSite({ hosting: (o) => ({ version: 0, mode: 'hosted', allowedOrigins: [o.agent.origin], config: 'deployment.json' }), files: extra });
  await page.goto(site.page.origin);
  await expect(footer(page)).toContainText('1 plugin');
  expect(await loaded(page)).toBe('a');
  expect(await violations()).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Generic static files, the Python helper and the JavaScript helpers
// ---------------------------------------------------------------------------------------------

test('npm static assets: a generic static server loads the plugin from beside the page', async ({ page, dist }) => {
  const config = JSON.stringify({ version: 0, agents: [{ id: 'demo', url: '/agents/demo/stream' }], plugins: ['plugins/a.js'] });
  const generic = await startStatic(dist, config, { '/plugins/a.js': { type: JS, body: marker('a') } });
  try {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await page.goto(generic.origin);
    await expect(footer(page)).toContainText('1 plugin');
    expect(await loaded(page)).toBe('a');
    await expect(warnings(page)).toHaveCount(0);
    expect(urls.filter((url) => !url.startsWith(`${generic.origin}/`))).toEqual([]);
  } finally {
    await generic.close();
  }
});

test.describe('the Python helper', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('writes plugins into config.json, the host serves the module from its own route, and a mount with none shows no plugin', async ({ page, dist, requested, violations }) => {
    const python = await startPython(dist, { plugins: ['/static/sign.js'], assets: { 'sign.js': marker('p') } });
    try {
      const served = await fetch(`${python.origin}/agui-inspector/config.json`).then((response) => response.json());
      expect(served).toEqual({ version: 0, agents: [{ id: 'demo', url: '/agents/demo/stream', name: 'Demo agent' }], plugins: ['/static/sign.js'] });
      await page.goto(`${python.origin}/agui-inspector/`);
      await expect(footer(page)).toContainText('1 plugin');
      expect(await loaded(page)).toBe('p');
      await expect(warnings(page)).toHaveCount(0);
      await send(page, 'hello');
      await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      expect(new Set(requested.map((url) => new URL(url).origin))).toEqual(new Set([python.origin]));
      expect(await violations()).toEqual([]);
    } finally {
      python.stop();
    }

    const bare = await startPython(dist);
    try {
      expect(await fetch(`${bare.origin}/agui-inspector/config.json`).then((response) => response.json())).not.toHaveProperty('plugins');
      await page.goto(`${bare.origin}/agui-inspector/`);
      await expect(footer(page)).not.toContainText('plugin');
    } finally {
      bare.stop();
    }
  });
});

const hosts: Array<{ label: string; kind: HostKind; basePath?: string }> = [
  { label: 'Express', kind: 'express' },
  { label: 'Hono under /api', kind: 'hono', basePath: '/api' },
  { label: 'Next.js with a basePath', kind: 'next', basePath: '/tools' },
];

for (const { label, kind, basePath = '' } of hosts) {
  test(`${label}: the plugins option reaches config.json, the host serves the module, and the page loads it`, async ({ page, requested, violations }) => {
    const options: HostOptions = { ...(basePath !== '' && { basePath }), plugins: [`${basePath}/static/sign.js`], files: { 'sign.js': marker('h') } };
    const host = await startHost(kind, options);
    try {
      const served = await fetch(`${host.origin}${host.mount}/config.json`).then((response) => response.json());
      expect(served.plugins).toEqual([`${basePath}/static/sign.js`]);
      await page.goto(`${host.origin}${host.mount}`);
      await expect(footer(page)).toContainText('1 plugin');
      expect(await loaded(page)).toBe('h');
      await expect(warnings(page)).toHaveCount(0);
      expect(requested).toContain(`${host.origin}${basePath}/static/sign.js`);
      expect(new Set(requested.filter((url) => !/^(blob|data):/.test(url)).map((url) => new URL(url).origin))).toEqual(new Set([host.origin]));
      expect(await violations()).toEqual([]);
    } finally {
      await host.stop();
    }
  });
}
