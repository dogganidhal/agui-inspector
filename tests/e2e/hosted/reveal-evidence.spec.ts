// #43: a run id and a "frame #n" reference in the conversation reveal their wire evidence in the frames list.
// The page is the production build with a scripted agent. Every run of the `/reveal` scenario has the same frame
// indices (0 RUN_STARTED, 1 STATE_SNAPSHOT, 2 start, 3 to 5 the deltas, 6 end, 7 an orphan delta, 8 RUN_FINISHED), so
// "frame #4" names a frame in each exchange and only the recorded ids tell them apart. The deltas carry the turn, which
// is how a spec reads which exchange a revealed frame belongs to.
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, open, send, test, type Site } from './support';

const config = (origins: Pick<Site, 'agent'>) => ({ version: 0, agents: [{ id: 'reveal', name: 'Reveal agent', url: `${origins.agent.origin}/reveal` }] });

type OpenSite = (options?: { config: typeof config }) => Promise<Site>;

/** Opens the page and sends one message per turn, waiting for each run to finish. */
async function turns(page: Page, openSite: OpenSite, count: number): Promise<Site> {
  const site = await openSite({ config });
  await open(page, site);
  for (let turn = 1; turn <= count; turn += 1) {
    await send(page, `question ${turn}`);
    await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(turn);
  }
  return site;
}

const conversation = (page: Page) => page.locator('[data-view="conversation"]');
/** The frames list's exchanges, newest first. */
const exchanges = (page: Page) => page.locator('[data-exchange]');
const header = (exchange: Locator) => exchange.locator('[data-exchange-header]');
const row = (exchange: Locator, index: number) => exchange.locator('[data-frame-row]').nth(index);
const current = (page: Page) => page.locator('[aria-current="true"]');
const panes = (page: Page) => page.getByRole('group', { name: 'Inspection pane' });
const pane = (page: Page) => page.getByRole('group', { name: 'Pane', exact: true });
const framesView = (page: Page) => page.getByRole('group', { name: 'Inspection view' });
const pressed = (group: Locator, name: string) => group.getByRole('button', { name, exact: true });

/** The reference buttons under the deltas of one turn's reply, opening the disclosure first. */
async function deltaRefs(page: Page, turn: number): Promise<Locator> {
  await conversation(page).getByText('3 deltas').nth(turn - 1).click();
  return page.getByRole('list', { name: `Deltas of reply-${turn}` }).getByRole('button');
}

test('a frame reference reveals the frame of its own exchange, not the one with the same index elsewhere', async ({ page, openSite }) => {
  const site = await turns(page, openSite, 2);
  const [newest, oldest] = [exchanges(page).nth(0), exchanges(page).nth(1)];
  await expect(header(oldest)).toHaveAttribute('aria-expanded', 'false');
  const requests = site.agent.seen.length;
  const footer = await page.getByRole('contentinfo').textContent();

  const first = await deltaRefs(page, 1);
  await expect(first.nth(1)).toHaveText('frame #4');
  await first.nth(1).click();

  await expect(header(oldest)).toHaveAttribute('aria-expanded', 'true');
  await expect(row(oldest, 4)).toHaveAttribute('aria-expanded', 'true');
  await expect(oldest.locator('[data-frame-detail]')).toContainText('turn 1 part b');
  await expect(row(oldest, 4)).toHaveAttribute('aria-current', 'true');
  await expect(current(page)).toHaveCount(1);
  await expect(row(oldest, 4)).toBeFocused();
  await expect(row(oldest, 4)).toBeInViewport();
  // The same index in the other exchange is left alone.
  await expect(row(newest, 4)).toHaveAttribute('aria-expanded', 'false');

  const second = await deltaRefs(page, 2);
  await expect(second.nth(1)).toHaveText('frame #4');
  await second.nth(1).click();
  await expect(row(newest, 4)).toHaveAttribute('aria-expanded', 'true');
  await expect(newest.locator('[data-frame-detail]')).toContainText('turn 2 part b');
  await expect(row(newest, 4)).toBeFocused();
  await expect(current(page)).toHaveCount(1);
  await expect(row(newest, 4)).toHaveAttribute('aria-current', 'true');

  // Revealing evidence sends nothing and records nothing.
  expect(site.agent.seen.length).toBe(requests);
  await expect(page.getByRole('contentinfo')).toHaveText(footer ?? '');
});

test('a reference inside a "Not shown" finding reveals the frame it names', async ({ page, openSite }) => {
  await turns(page, openSite, 2);
  const oldest = exchanges(page).nth(1);

  const finding = conversation(page).getByRole('listitem').filter({ hasText: 'ghost-1' });
  await expect(finding).toContainText('never started');
  await finding.getByRole('button', { name: /^Show frame #7/ }).click();

  await expect(header(oldest)).toHaveAttribute('aria-expanded', 'true');
  await expect(row(oldest, 7)).toHaveAttribute('aria-expanded', 'true');
  await expect(oldest.locator('[data-frame-detail]')).toContainText('turn 1 orphan');
  await expect(row(oldest, 7)).toBeFocused();
  await expect(row(oldest, 7)).toBeInViewport();
  await expect(current(page)).toHaveCount(1);
});

test('a run id reveals its exchange and opens it when it was collapsed', async ({ page, openSite }) => {
  await turns(page, openSite, 2);
  const [newest, oldest] = [exchanges(page).nth(0), exchanges(page).nth(1)];
  await expect(header(oldest)).toHaveAttribute('aria-expanded', 'false');

  const runs = conversation(page).locator('[data-entry="run"]');
  await runs.nth(0).getByRole('button', { name: /^Show the exchange of run / }).click();
  await expect(header(oldest)).toHaveAttribute('aria-expanded', 'true');
  await expect(header(oldest)).toBeFocused();
  await expect(header(oldest)).toHaveAttribute('aria-current', 'true');
  await expect(current(page)).toHaveCount(1);
  await expect(oldest.locator('[data-frame-row]')).toHaveCount(9);
  // An exchange is revealed, not one of its frames.
  await expect(oldest.locator('[data-frame-row][aria-expanded="true"]')).toHaveCount(0);

  // The newest exchange, collapsed by the user, opens the same way.
  await header(newest).click();
  await expect(header(newest)).toHaveAttribute('aria-expanded', 'false');
  await runs.nth(1).getByRole('button', { name: /^Show the exchange of run / }).click();
  await expect(header(newest)).toHaveAttribute('aria-expanded', 'true');
  await expect(header(newest)).toBeFocused();
  await expect(current(page)).toHaveCount(1);
  await expect(header(newest)).toHaveAttribute('aria-current', 'true');
});

test('the inspection pane and its Frames view are selected from any other tab', async ({ page, openSite }) => {
  await turns(page, openSite, 1);
  const oldest = exchanges(page).nth(0);
  const refs = await deltaRefs(page, 1);

  // The raw request view of the inspection pane.
  await pressed(framesView(page), 'Raw request').click();
  await expect(page.getByRole('textbox', { name: 'Raw request body' })).toBeVisible();
  await refs.nth(0).click();
  await expect(pressed(framesView(page), 'Frames')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(oldest, 3)).toBeFocused();

  // Settings.
  await pressed(panes(page), 'Settings').click();
  await expect(pressed(panes(page), 'Settings')).toHaveAttribute('aria-pressed', 'true');
  await refs.nth(2).click();
  await expect(pressed(panes(page), 'Inspection')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(oldest, 5)).toBeFocused();

  // State: its own references lead to the frames list too.
  await pressed(panes(page), 'State').click();
  await page.locator('[data-view="state"]').getByRole('button', { name: /^Show frame #1 / }).click();
  await expect(pressed(panes(page), 'Inspection')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-view="state"]')).toHaveCount(0);
  await expect(row(oldest, 1)).toBeFocused();
  await expect(oldest.locator('[data-frame-detail]').filter({ hasText: 'STATE_SNAPSHOT' })).toContainText('"turn": 1');
});

test('at a narrow width the reference switches to the inspection pane, and again after the user switches back', async ({ page, openSite }) => {
  await page.setViewportSize({ width: 640, height: 800 });
  await turns(page, openSite, 1);
  const app = page.locator('.agui-app');
  const oldest = exchanges(page).nth(0);
  await expect(app).toHaveAttribute('data-pane', 'conversation');
  await expect(oldest).toBeHidden();

  const refs = await deltaRefs(page, 1);
  await refs.nth(1).click();
  await expect(app).toHaveAttribute('data-pane', 'inspection');
  await expect(pressed(pane(page), 'Inspection')).toHaveAttribute('aria-pressed', 'true');
  await expect(conversation(page)).toBeHidden();
  await expect(row(oldest, 4)).toBeFocused();
  await expect(row(oldest, 4)).toBeInViewport();

  await pressed(pane(page), 'Conversation').click();
  await expect(app).toHaveAttribute('data-pane', 'conversation');
  await refs.nth(0).click();
  await expect(app).toHaveAttribute('data-pane', 'inspection');
  await expect(row(oldest, 3)).toBeFocused();
  await expect(row(oldest, 3)).toBeInViewport();
});

test('a view filter that would hide the target is cleared, and one that lists it is kept', async ({ page, openSite }) => {
  await turns(page, openSite, 1);
  const oldest = exchanges(page).nth(0);
  const filter = page.getByRole('searchbox', { name: 'Filter frames by type or content' });
  const refs = await deltaRefs(page, 1);

  // A filter that keeps the target stays as the user set it.
  await filter.fill('part b');
  await expect(oldest.locator('[data-frame-row]')).toHaveCount(1);
  await refs.nth(1).click();
  await expect(filter).toHaveValue('part b');
  await expect(row(oldest, 0)).toBeFocused();
  await expect(row(oldest, 0)).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('Filter cleared')).toHaveCount(0);

  // One that hides it is cleared, and the user is told.
  await refs.nth(0).click();
  await expect(filter).toHaveValue('');
  await expect(page.getByText('Filter cleared to show the frame')).toBeVisible();
  await expect(row(oldest, 3)).toBeFocused();
  await expect(row(oldest, 3)).toHaveAttribute('aria-current', 'true');

  // The family chips too.
  const tools = page.getByRole('button', { name: /^Tools/ });
  await tools.click();
  await expect(tools).toHaveAttribute('aria-pressed', 'true');
  await expect(oldest.getByText('No frames match the filter.')).toBeVisible();
  await refs.nth(2).click();
  await expect(tools).toHaveAttribute('aria-pressed', 'false');
  await expect(row(oldest, 5)).toBeFocused();
});

test('the references are buttons with accessible names that work from the keyboard', async ({ page, openSite }) => {
  await turns(page, openSite, 2);
  const [newest, oldest] = [exchanges(page).nth(0), exchanges(page).nth(1)];
  const refs = await deltaRefs(page, 1);

  await expect(refs.nth(1)).toHaveAccessibleName('Show frame #4 in the frames list');
  await refs.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(row(oldest, 4)).toBeFocused();
  await expect(row(oldest, 4)).toHaveAttribute('aria-expanded', 'true');

  // Space activates it too, and the target row is a button the user can keep driving.
  await refs.nth(0).focus();
  await page.keyboard.press('Space');
  await expect(row(oldest, 3)).toBeFocused();
  await expect(row(oldest, 3)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(row(oldest, 3)).toHaveAttribute('aria-expanded', 'false');

  const run = conversation(page).locator('[data-entry="run"]').nth(1).getByRole('button');
  await expect(run).toHaveAccessibleName(/^Show the exchange of run .* in the frames list$/);
  await run.focus();
  await page.keyboard.press('Enter');
  await expect(header(newest)).toBeFocused();
});

test('references work in an imported recording, which stays inspection only', async ({ page, openSite, requested }, info) => {
  const site = await turns(page, openSite, 2);
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  const file = info.outputPath('session.json');
  await download.saveAs(file);
  expect(readFileSync(file, 'utf8')).toContain('turn 2 part c');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  const [newest, oldest] = [exchanges(page).nth(0), exchanges(page).nth(1)];
  await expect(header(oldest)).toHaveAttribute('aria-expanded', 'false');

  const before = { agent: site.agent.seen.length, requests: requested.length, footer: await page.getByRole('contentinfo').textContent() };
  const refs = await deltaRefs(page, 1);
  await refs.nth(1).click();
  await expect(row(oldest, 4)).toBeFocused();
  await expect(oldest.locator('[data-frame-detail]')).toContainText('turn 1 part b');
  await expect(row(newest, 4)).toHaveAttribute('aria-expanded', 'false');
  await conversation(page).locator('[data-entry="run"]').nth(1).getByRole('button').click();
  await expect(header(newest)).toBeFocused();

  expect(site.agent.seen.length, 'revealing sends nothing').toBe(before.agent);
  expect(requested.length, 'revealing requests nothing').toBe(before.requests);
  await expect(page.getByRole('contentinfo')).toHaveText(before.footer ?? '');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
});
