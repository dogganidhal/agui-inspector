// The state history in the assembled app (specs/010-state-history, US4, FR-011 to FR-014, SC-006, SC-007). The page is
// the production build with a scripted agent. A run of the `/state-history` scenario is browsed point by point, exported,
// imported into a fresh page and browsed again: the history must be the same, and browsing must never send a request,
// write browser storage or change the recording.
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { expect, expectAllowlisted, open, send, test, type Site } from './support';

const config = (origins: Pick<Site, 'agent'>) => ({ version: 0, agents: [{ id: 'history', name: 'History agent', url: `${origins.agent.origin}/state-history` }] });

const tabs = (page: Page) => page.getByRole('group', { name: 'Inspection pane' });
const state = (page: Page) => page.locator('[data-view="state"]');
const history = (page: Page) => state(page).getByRole('listbox', { name: 'State history' });
const shown = (page: Page) => state(page).getByRole('region', { name: /^(Current state|State at the selected point)$/ });

const openState = async (page: Page) => {
  await tabs(page).getByRole('button', { name: 'State', exact: true }).click();
  await expect(history(page)).toBeVisible();
};

const textOf = async (locator: Locator): Promise<string> => ((await locator.count()) === 0 ? '' : ((await locator.textContent()) ?? ''));

/** Every point from the newest to the oldest, read with the keyboard: its state, its diff and its banner. */
async function readPoints(page: Page): Promise<Array<{ state: string; diff: string; banner: string }>> {
  const count = await history(page).getByRole('option').count();
  await history(page).focus();
  await page.keyboard.press('Home');
  const points: Array<{ state: string; diff: string; banner: string }> = [];
  for (let i = 0; i < count; i += 1) {
    if (i > 0) await page.keyboard.press('ArrowDown');
    await expect(history(page).getByRole('option', { selected: true })).toHaveCount(1);
    await expect(history(page).getByRole('option').nth(i)).toHaveAttribute('aria-selected', 'true');
    points.push({
      state: (await shown(page).textContent()) ?? '',
      diff: await textOf(state(page).getByRole('list', { name: 'State diff' })),
      banner: await textOf(state(page).locator('[data-part="state-banner"]')),
    });
  }
  await page.keyboard.press('Home');
  return points;
}

async function exportFile(page: Page): Promise<string> {
  await tabs(page).getByRole('button', { name: 'Inspection', exact: true }).click();
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return readFileSync((await download.path())!, 'utf8');
}

test('the history of a run is the same after export and import, and browsing it changes and sends nothing', async ({ page, openSite, requested }) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __writes: string[] }).__writes = writes;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(key);
      return original.call(this, key, value);
    };
  });
  const site = await openSite({ config });
  await open(page, site);
  await send(page, 'go');
  await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(1);
  await openState(page);

  // Five changes, and the state the run started from.
  await expect(history(page).getByRole('option')).toHaveCount(6);
  await expect(shown(page)).toContainText('"round": 11');
  await expect(state(page)).toContainText('Sent as state in the next run');
  const live = await readPoints(page);
  expect(live).toHaveLength(6);
  expect(live[0]?.banner).toBe('');
  expect(live[1]?.state).toContain('"round": 10');
  expect(live[1]?.state).toContain('"items": []');
  expect(live[2]?.state, 'a delta that cannot be applied leaves the state as it was').toBe(live[3]?.state);
  expect(live[2]?.diff).toBe('');
  expect(live[3]?.state).toContain('"b"');
  expect(live[5]?.state, 'the oldest point is the state the run started from').toContain('{}');
  expect(live[5]?.diff).toBe('');
  for (const point of live.slice(1)) expect(point.banner).toContain('Past state');

  // Leaving the tab and coming back selects the latest point.
  await history(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(state(page).locator('[data-part="state-banner"]')).toHaveCount(1);
  await tabs(page).getByRole('button', { name: 'Inspection', exact: true }).click();
  await openState(page);
  await expect(state(page).locator('[data-part="state-banner"]')).toHaveCount(0);
  await expect(shown(page)).toContainText('"round": 11');

  // Browsing sent nothing, wrote nothing and left the recording as it was.
  const writes = () => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length);
  const requests = requested.length;
  const sent = site.agent.seen.length;
  const stored = await writes();
  await readPoints(page);
  expect(requested.length).toBe(requests);
  expect(site.agent.seen.length).toBe(sent);
  expect(await writes(), 'nothing was written to browser storage').toBe(stored);
  const file = await exportFile(page);
  expect(await exportFile(page), 'two exports of the same session are the same file').toBe(file);
  // The history is derived from the frames, so the file has no field for it and keeps the format of 0.1.0.
  const parsed = JSON.parse(file) as { version: number; session: Record<string, unknown> };
  expect(parsed.version).toBe(0);
  expect(Object.keys(parsed.session).sort()).toEqual(['derived', 'exchanges', 'findings', 'frames', 'id', 'runs']);
  expect(file).not.toMatch(/checkpoint|"initial"/);

  // A fresh page imports the file and shows the same history.
  const fresh = await page.context().newPage();
  await open(fresh, site);
  await fresh.locator('input[type="file"]').first().setInputFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(fresh.getByText('Imported recording: inspection only')).toBeVisible();
  await openState(fresh);
  await expect(history(fresh).getByRole('option')).toHaveCount(6);
  expect(await readPoints(fresh)).toEqual(live);
  expect(await exportFile(fresh), 'and exporting it again gives back the same bytes').toBe(file);
  expect(site.agent.seen.length, 'importing and browsing sent nothing to the agent').toBe(sent);
  expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
});
