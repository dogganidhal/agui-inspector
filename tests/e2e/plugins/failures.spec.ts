// Spec 014 (FR-005, FR-006, FR-017, SC-006; story 5): a plugin that fails is one warning and never stops the page. Each
// way a plugin can fail to load or to activate, alone and together with a good plugin, then the page is used: a message is
// sent and answered, and every pane works. Failures of hooks, providers and renderers are in their own specs.
import { AGENT_REPLY, expect, expectAllowlisted, send, test } from '../hosted/support';
import { embeddedWith, exportedSession, footer, JS, loaded, marker, warn, warningList } from './support';

const FAILING: Array<{ name: string; file?: { type: string; body: string }; text: string }> = [
  { name: 'missing', text: 'could not be loaded' },
  { name: 'plain', file: { type: 'text/plain', body: 'export default () => {};' }, text: 'could not be loaded' },
  { name: 'syntax', file: { type: JS, body: 'export default (' }, text: 'could not be loaded' },
  { name: 'nodefault', file: { type: JS, body: 'export const x = 1;' }, text: 'the default export is not a function' },
  { name: 'notfunction', file: { type: JS, body: 'export default 42;' }, text: 'the default export is not a function' },
  { name: 'throws', file: { type: JS, body: "export default (api) => { api.beforeRun(() => {}); api.renderCustomEvent('x', () => {}); throw new Error('boom'); };" }, text: 'activation failed: boom' },
  { name: 'rejects', file: { type: JS, body: "export default async () => { throw new Error('later boom'); };" }, text: 'activation failed: later boom' },
];

/** The page is usable: a message is answered, and the panes, the export and the settings work. */
async function expectUsable(page: import('@playwright/test').Page): Promise<void> {
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  await expect(footer(page)).toContainText('1 exchange · 5 frames');
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'State' }).click();
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Inspection' }).click();
  expect((await exportedSession(page)).session.exchanges).toHaveLength(1);
}

for (const failing of FAILING) {
  test(`a plugin that ${failing.name === 'missing' ? 'does not exist' : `is "${failing.name}"`} is one warning, the good plugin is active, and the page works`, async ({ page, openSite, violations }) => {
    const files = { '/plugins/good.js': { type: JS, body: marker('g') }, ...(failing.file !== undefined && { [`/plugins/${failing.name}.js`]: failing.file }) };
    const site = await openSite(embeddedWith(['plugins/good.js', `plugins/${failing.name}.js`], files));
    await page.goto(site.page.origin);
    await expect(footer(page)).toContainText('1 plugin ·');
    expect(await loaded(page)).toBe('g');
    expect(await warningList(page)).toEqual([['Plugin', `/plugins/${failing.name}.js: ${failing.text}`]]);
    expect(await page.getByRole('alert').count()).toBe(0);
    await expectUsable(page);
    if (failing.name !== 'missing' && failing.name !== 'plain') expect((await violations()).filter((violation) => violation.directive.startsWith('script-src'))).toEqual([]);
  });
}

test('every failure at once: one warning each, the good plugin runs, and the page works', async ({ page, openSite }) => {
  const files: Record<string, { type: string; body: string }> = { '/plugins/good.js': { type: JS, body: marker('g') } };
  for (const failing of FAILING) if (failing.file !== undefined) files[`/plugins/${failing.name}.js`] = failing.file;
  const site = await openSite(embeddedWith(['plugins/good.js', ...FAILING.map((failing) => `plugins/${failing.name}.js`)], files));
  await page.goto(site.page.origin);
  await expect(footer(page)).toContainText('1 plugin ·');
  expect(await loaded(page)).toBe('g');
  const shown = await warningList(page);
  expect(shown.map(([kind]) => kind)).toEqual(FAILING.map(() => 'Plugin'));
  for (const failing of FAILING) expect(shown.some(([, text]) => text === `/plugins/${failing.name}.js: ${failing.text}`), failing.name).toBe(true);
  await expectUsable(page);
});

test('a module that redirects to another origin is blocked by the policy: one warning, a script violation, and no request to that origin', async ({ page, openSite, requested, violations }) => {
  const files: Record<string, { type: string; body: string; redirect?: string }> = { '/plugins/good.js': { type: JS, body: marker('g') } };
  const site = await openSite(embeddedWith(['plugins/good.js', 'plugins/redirect.js'], files));
  files['/plugins/redirect.js'] = { type: JS, body: '', redirect: `${site.foreign.origin}/plugins/stolen.js` };
  await page.goto(site.page.origin);
  await expect(footer(page)).toContainText('1 plugin ·');
  expect(await warningList(page)).toEqual([['Plugin', '/plugins/redirect.js: could not be loaded']]);
  // The browser reports the address that was asked for, not the one it was redirected to.
  expect((await violations()).filter((violation) => violation.directive === 'script-src-elem').map((violation) => violation.blocked)).toContain(`${site.page.origin}/plugins/redirect.js`);
  // The browser lists the redirect target as a request it started, and the policy stops it before it leaves: the other origin saw nothing.
  expect(site.foreign.seen).toEqual([]);
  expectAllowlisted(requested.filter((url) => !url.startsWith(site.foreign.origin)), [site.page.origin]);
  await expectUsable(page);
});

test('a function that never finishes is skipped after 10 seconds with one warning, and the page starts', async ({ page, openSite }) => {
  test.setTimeout(60_000);
  const site = await openSite(embeddedWith(['plugins/good.js', 'plugins/stuck.js'], { '/plugins/good.js': { type: JS, body: marker('g') }, '/plugins/stuck.js': { type: JS, body: 'export default () => new Promise(() => {});' } }));
  const started = Date.now();
  await page.goto(site.page.origin);
  await expect(footer(page)).toContainText('1 plugin ·', { timeout: 20_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(9_500);
  expect(await warningList(page)).toEqual([['Plugin', '/plugins/stuck.js: activation did not finish within 10 seconds']]);
  await expectUsable(page);
});

test('the text of a failure is shown as text, and nothing in it runs', async ({ page, openSite }) => {
  const message = '<img src=x onerror="document.documentElement.dataset.pwned=1">';
  const site = await openSite(embeddedWith(['plugins/xss.js'], { '/plugins/xss.js': { type: JS, body: `export default () => { throw new Error(${JSON.stringify(message)}); };` } }));
  await page.goto(site.page.origin);
  await expect(warn(page)).toHaveCount(1);
  await expect(warn(page)).toContainText(message);
  await expect(page.locator('[data-view="warnings"] img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.dataset.pwned ?? '')).toBe('');
});
