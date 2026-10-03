// FX7 (FR-007, FR-010, FR-028): hiding the preparation exchanges in the frames list. A preset's
// preparation requests run before every run and fill the list with exchanges nobody is reading;
// the Preparation chip takes them out of the list and back. It is a view choice only: what is
// recorded, exported and counted does not change, and a failed preparation is never hidden.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, open, prepare, run, snapshot, test } from './support.ts';

test.beforeEach(async ({ page, site }) => {
  await open(page, site);
});

const headers = (page: Page) => page.locator('[data-exchange-header]');
const chip = (page: Page) => page.locator('[data-preparation-chip]');
const listed = (page: Page) => headers(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-exchange-header')));

/** What a preset with two preparation requests produces before one run: PUT a session, POST a warm-up, then the run. */
async function preparedRun(page: Page): Promise<void> {
  await prepare(page, 'PUT', '/prepare/sessions/thread-1');
  await prepare(page, 'POST', '/prepare/warm');
  await run(page, 'baselineRun');
  await expect(headers(page)).toHaveCount(3);
}

test('the chip hides the preparation exchanges and brings them back, leaving the run exchange alone', async ({ page }) => {
  await preparedRun(page);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page)).toContainText('Preparation');
  await expect(chip(page).locator('.agui-count')).toHaveText('2');
  expect(await listed(page)).toEqual(['exchange-3', 'exchange-2', 'exchange-1']);
  const prepares = page.locator('[data-exchange-header]', { hasText: 'prepare' });
  await expect(prepares).toHaveCount(2);
  await expect(prepares.nth(0)).toContainText('/prepare/warm');
  await expect(prepares.nth(1)).toContainText('/prepare/sessions/thread-1');

  await chip(page).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(prepares).toHaveCount(0);
  expect(await listed(page)).toEqual(['exchange-3']);
  // The run is still open with its frames, and the chip still counts what it hides.
  await expect(headers(page).first()).toContainText('/scenario/baselineRun');
  await expect(headers(page).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-exchange="exchange-3"] [data-frame-row]')).toHaveCount(30);
  await expect(chip(page).locator('.agui-count')).toHaveText('2');

  await chip(page).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await listed(page)).toEqual(['exchange-3', 'exchange-2', 'exchange-1']);
});

test('hiding is a view choice: the recording, the totals and the export keep every exchange', async ({ page }) => {
  await preparedRun(page);
  await chip(page).click();
  await expect(headers(page)).toHaveCount(1);

  const session = await snapshot(page);
  expect(session.exchanges.map((exchange) => exchange.kind)).toEqual(['preparation', 'preparation', 'conversation']);
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '30');
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-shown', '30');
  // Nothing recorded is listed as a frame filter: no "shown/total" on the run's header.
  await expect(headers(page).first()).not.toContainText('/30 frames');

  await page.locator('.agui-ins-head').getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export this session' });
  await expect(dialog).toContainText('3 exchanges · 30 frames');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export session' }).click()]);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8')) as { session: { exchanges: Array<{ kind: string }> } };
  expect(exported.session.exchanges.map((exchange) => exchange.kind)).toEqual(['preparation', 'preparation', 'conversation']);
});

test('the chip works from the keyboard', async ({ page }) => {
  await preparedRun(page);
  await chip(page).focus();
  await expect(chip(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await listed(page)).toEqual(['exchange-3']);
  await page.keyboard.press('Space');
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await listed(page)).toEqual(['exchange-3', 'exchange-2', 'exchange-1']);

  // It follows the Issues chip in the tab order, inside the same filter row.
  await page.locator('[data-issues-chip]').focus();
  await page.keyboard.press('Tab');
  await expect(chip(page)).toBeFocused();
});

test('the text filter, the family chips and Issues leave the preparation choice alone', async ({ page }) => {
  await preparedRun(page);
  await chip(page).click();

  const search = page.getByRole('searchbox', { name: 'Filter frames by type or content' });
  await search.fill('SYNTHETIC-RESEARCHER');
  await expect(page.locator('[data-exchange="exchange-3"] [data-frame-row]')).toHaveCount(1);
  expect(await listed(page)).toEqual(['exchange-3']);
  await page.locator('[data-family-chip="tool"]').click();
  await page.locator('[data-issues-chip]').click();
  expect(await listed(page)).toEqual(['exchange-3']);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');

  // Clearing them does not bring the preparation exchanges back either.
  await search.fill('');
  await page.locator('[data-family-chip="tool"]').click();
  await page.locator('[data-issues-chip]').click();
  expect(await listed(page)).toEqual(['exchange-3']);
});

test('a failed preparation is never hidden, and the chip turns red while one is in the session', async ({ page }) => {
  await prepare(page, 'PUT', '/prepare/sessions/thread-1');
  await expect(chip(page)).not.toHaveAttribute('data-has-issues', 'true');
  await prepare(page, 'POST', '/prepare/broken');
  await expect(headers(page)).toHaveCount(2);
  await expect(chip(page)).toHaveAttribute('data-has-issues', 'true');

  await chip(page).click();
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
  expect(await listed(page)).toEqual(['exchange-2']);
  const failed = headers(page).first();
  await expect(failed).toContainText('/prepare/broken');
  await expect(failed).toContainText('500');
  await expect(failed.locator('.agui-fr-bad')).toHaveText('500');
  await expect(chip(page).locator('.agui-count')).toHaveText('2');
  // The failed exchange is the newest listed one, so it opens with its response.
  await expect(failed).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('warm-up failed')).toBeVisible();
});

test('a session of preparation requests only says why the list is empty', async ({ page }) => {
  await prepare(page, 'PUT', '/prepare/sessions/thread-1');
  await chip(page).click();
  await expect(headers(page)).toHaveCount(0);
  await expect(page.getByText('Only preparation requests so far, and they are hidden.')).toBeVisible();
  await expect(page.getByText('No exchanges yet')).toHaveCount(0);
  await chip(page).click();
  await expect(headers(page)).toHaveCount(1);
});
