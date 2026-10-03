// FX8 (FR-003): the agent picker in the top bar, beside the endpoint URL, in the built application.
// It is a second entry point onto the selection Settings has, so a choice made in either one must
// show in both and must behave the same: the endpoint field, the quick messages and the target of the
// next send all follow it. The scripted agent answers any path, so the path a request arrived on says
// which agent the page used.
import type { Page } from '@playwright/test';
import { AGENT_REPLY, expect, open, send, test } from './support';

type Origins = { agent: { origin: string } };

/** Three agents on one allowed origin, as a deployment with several would list them. */
const agents = (origins: Origins) => ({
  version: 0,
  agents: [
    { id: 'support', name: 'Support assistant', url: `${origins.agent.origin}/support`, preset: { quickMessages: ['Where is my refund?'] } },
    { id: 'billing', name: 'Billing assistant', url: `${origins.agent.origin}/billing`, preset: { quickMessages: ['Show my last invoice', 'Change my plan'] } },
    { id: 'plain', name: 'Plain agent', url: `${origins.agent.origin}/plain` },
  ],
});

const chips = (page: Page) => page.getByRole('group', { name: 'Quick messages' }).getByRole('button');
const endpoint = (page: Page) => page.getByRole('textbox', { name: 'Endpoint URL' });
/** The top bar's picker; its name starts with the visible "Agent" label. */
const barPicker = (page: Page, name: string) => page.getByRole('banner').getByRole('button', { name: `Agent ${name}`, exact: true });
/** Settings' own picker: its name is the agent's. */
const settingsPicker = (page: Page, name: string) => page.locator('[data-view="settings"]').getByRole('button', { name, exact: true });

test('choosing an agent in the top bar switches the endpoint, quick messages and next send, and Settings shows the same choice', async ({ page, openSite }) => {
  const site = await openSite({ config: agents });
  await open(page, site);

  // Selected at start, visible whatever tab is showing.
  await expect(barPicker(page, 'Support assistant')).toBeVisible();
  await expect(endpoint(page)).toHaveValue(`${site.agent.origin}/support`);
  await expect(chips(page)).toHaveText(['Where is my refund?']);

  await barPicker(page, 'Support assistant').click();
  await page.getByRole('banner').getByRole('button', { name: /^Billing assistant/ }).click();

  await expect(barPicker(page, 'Billing assistant')).toBeVisible();
  await expect(endpoint(page)).toHaveValue(`${site.agent.origin}/billing`);
  await expect(chips(page)).toHaveText(['Show my last invoice', 'Change my plan']);

  await chips(page).first().click();
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen.map((request) => `${request.method} ${request.path}`)).toEqual(['POST /billing']);
  expect(JSON.parse(site.agent.seen[0]?.body ?? '{}').messages.at(-1).content).toBe('Show my last invoice');

  // Settings shows the same selection...
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(settingsPicker(page, 'Billing assistant')).toBeVisible();
  await expect(page.locator('[data-view="settings"]').getByRole('heading', { name: 'Billing assistant' })).toBeVisible();

  // ...and choosing there moves the top bar, which is the same state read from either side.
  await settingsPicker(page, 'Billing assistant').click();
  await page.locator('[data-view="settings"]').getByRole('button', { name: /^Plain agent/ }).click();
  await expect(barPicker(page, 'Plain agent')).toBeVisible();
  await expect(endpoint(page)).toHaveValue(`${site.agent.origin}/plain`);
  await expect(chips(page)).toHaveCount(0);
});

test('an endpoint typed by hand reads Custom URL in the top bar and in Settings, and choosing an agent again leaves it', async ({ page, openSite }) => {
  const site = await openSite({ config: agents });
  await open(page, site);

  await endpoint(page).fill(`${site.agent.origin}/elsewhere`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await expect(barPicker(page, 'Custom URL')).toBeVisible();
  await expect(chips(page)).toHaveCount(0);
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(settingsPicker(page, 'Custom URL')).toBeVisible();

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen.map((request) => request.path)).toEqual(['/elsewhere']);

  await barPicker(page, 'Custom URL').click();
  const options = page.getByRole('banner').getByRole('listitem');
  await expect(options.getByRole('button', { pressed: true })).toHaveCount(0);
  await options.getByRole('button', { name: /^Support assistant/ }).click();
  await expect(barPicker(page, 'Support assistant')).toBeVisible();
  await expect(endpoint(page)).toHaveValue(`${site.agent.origin}/support`);
});

test('without a configured agent the top bar has no picker', async ({ page, openSite }) => {
  const site = await openSite({ config: () => ({ version: 0, agents: [] }) });
  await open(page, site);
  await expect(endpoint(page)).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: /^Agent / })).toHaveCount(0);
});

test('keyboard: Tab reaches the picker, Enter opens it, an option is chosen with Enter and focus returns to the picker', async ({ page, openSite }) => {
  const site = await openSite({ config: agents });
  await open(page, site);

  await page.keyboard.press('Tab');
  await expect(barPicker(page, 'Support assistant')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[popover]:popover-open')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('[popover]:popover-open').getByRole('button', { name: /^Support assistant/ })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[popover]:popover-open').getByRole('button', { name: /^Billing assistant/ })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.locator('[popover]:popover-open')).toHaveCount(0);
  await expect(barPicker(page, 'Billing assistant')).toBeFocused();
  await expect(endpoint(page)).toHaveValue(`${site.agent.origin}/billing`);
});

test('narrow: the picker wraps with the endpoint controls, a long name is cut, and the page never scrolls sideways', async ({ page, openSite }) => {
  const long = 'A support assistant with a very long display name that cannot fit in a phone-wide bar';
  const site = await openSite({ config: (origins: Origins) => ({ version: 0, agents: [{ id: 'long', name: long, url: `${origins.agent.origin}/long` }, ...agents(origins).agents] }) });
  for (const width of [320, 600, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page, site);
    const picker = barPicker(page, long);
    await expect(picker, `${width}px`).toBeVisible();
    const fits = await page.evaluate(() => {
      const inView = (element: Element | null) => {
        const box = element?.getBoundingClientRect();
        return box !== undefined && box.left >= 0 && box.right <= window.innerWidth;
      };
      return {
        scrolls: document.documentElement.scrollWidth > window.innerWidth,
        picker: inView(document.querySelector('.agui-settings-picker--bar')),
        field: inView(document.querySelector('.agui-conn-endpoint')),
      };
    });
    expect(fits, `${width}px`).toEqual({ scrolls: false, picker: true, field: true });
  }
});
