// Spec 008 (FR-012 to FR-018, US3): catalog aliases in config.json, in the assembled application. The page under
// test is the production build, served hosted and embedded; the agent is scripted and model-free, and names the
// basic catalog by a former id. What this proves: a configured alias draws the surface, the same id without it is
// "Catalog not found" with the entry as received, a bad alias is one visible nonfatal warning that leaves the good
// ones working, and none of it adds a request or touches the content security policy.
import type { Page } from '@playwright/test';
import { FORMER_CATALOG, expect, expectAllowlisted, open, send, test } from '../hosted/support';

const BASIC = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';
const warnings = (page: Page) => page.getByRole('status', { name: 'Configuration warnings' });
const metas = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));

const hosted = (extra: object) => (o: { agent: { origin: string } }) => ({ version: 0, agents: [{ id: 'old', name: 'Old catalog agent', url: `${o.agent.origin}/former-catalog` }], ...extra });
const embedded = (extra: object) => () => ({ version: 0, agents: [{ id: 'old', url: '/former-catalog' }], ...extra });

for (const mode of ['hosted', 'embedded'] as const) {
  const options = (extra: object) => (mode === 'hosted' ? { config: hosted(extra) } : { hosting: () => null, config: embedded(extra) });

  test(`${mode}: a configured alias draws the surface that names a former catalog id, and the page asks for nothing more`, async ({ page, openSite, requested, violations }) => {
    const baseline = await openSite(options({}));
    const site = await openSite(options({ catalogAliases: { [FORMER_CATALOG]: BASIC } }));
    await open(page, site);
    await expect(warnings(page)).toHaveCount(0);
    await send(page, 'Show me the form');
    await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send note' })).toBeVisible();
    await expect(page.locator('.agui-a2ui-issues')).toHaveCount(0);

    // The activity still holds the id the agent sent.
    await page.getByRole('button', { name: 'JSON' }).first().click();
    await expect(page.getByText(FORMER_CATALOG).first()).toBeVisible();

    expect(await violations()).toEqual([]);
    expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
    expect(requested.map((url) => new URL(url).pathname).filter((p) => p.endsWith('.json'))).toEqual(['/hosting-config.json', '/config.json']);
    // The same policy with and without aliases.
    await open(page, baseline);
    const without = await metas(page);
    await open(page, site);
    const swap = (policy: string[], from: typeof site) => policy.map((entry) => entry.replaceAll(from.agent.origin, 'AGENT'));
    expect(swap(await metas(page), site)).toEqual(swap(without, baseline));
  });

  test(`${mode}: without the alias the same id is "Catalog not found" with the entry as received, and nothing is drawn`, async ({ page, openSite }) => {
    const site = await openSite(options({}));
    await open(page, site);
    await send(page, 'Show me the form');
    await expect(page.locator('.agui-a2ui-issues')).toContainText(`Catalog not found: ${FORMER_CATALOG}`);
    await page.locator('.agui-a2ui-issues').getByText('As received').first().click();
    await expect(page.getByRole('region', { name: 'Received operation 1' })).toContainText(FORMER_CATALOG);
    await expect(page.getByRole('heading', { name: 'Order check' })).toHaveCount(0);
  });

  test(`${mode}: bad aliases are nonfatal warnings, and the good one beside them still works`, async ({ page, openSite }) => {
    const site = await openSite(options({ catalogAliases: { '': BASIC, [FORMER_CATALOG]: BASIC, broken: 'https://catalog.invalid/new.json' } }));
    await open(page, site);
    const found = warnings(page).locator('.agui-finding--warn');
    await expect(found).toHaveCount(2);
    await expect(found.nth(0)).toContainText('catalogAliases: "" is not a catalog id; it was ignored');
    await expect(found.nth(1)).toContainText('catalogAliases: "broken" maps to "https://catalog.invalid/new.json", which is not a catalog this inspector bundles; it was ignored');
    await send(page, 'Show me the form');
    await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
  });
}

test('a catalogAliases field that is not an object is one warning and the agents still run', async ({ page, openSite }) => {
  const site = await openSite({ config: hosted({ catalogAliases: [BASIC] }) });
  await open(page, site);
  await expect(warnings(page).locator('.agui-finding--warn')).toHaveCount(1);
  await expect(warnings(page)).toContainText('catalogAliases must be an object from a catalog id to a bundled catalog id; it was ignored');
  await send(page, 'Show me the form');
  await expect(page.locator('.agui-a2ui-issues')).toContainText(`Catalog not found: ${FORMER_CATALOG}`);
});
