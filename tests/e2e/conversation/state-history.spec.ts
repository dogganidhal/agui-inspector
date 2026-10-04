// The state history in a real browser (specs/010-state-history, US2 to US4, FR-007 to FR-016, SC-003, SC-005). The
// fixture host streams scripted state events through the real frame reader and store, so each check is about what a
// developer sees and can do: pick a point with the pointer or the keyboard, read its state and diff, stay on a past
// point while a live run goes on, and leave the recording alone.
import { expect, type Locator, type Page } from '@playwright/test';
import { open, revealed, send, start, test } from './site';

const STARTED = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const snapshot = (value: object) => ({ type: 'STATE_SNAPSHOT', snapshot: value });
const delta = (...ops: object[]) => ({ type: 'STATE_DELTA', delta: ops });
const set = (n: number) => delta({ op: 'replace', path: '/n', value: n });

const state = (page: Page) => page.locator('[data-pane="state"]');
const history = (page: Page) => state(page).getByRole('listbox', { name: 'State history' });
const rows = (page: Page) => history(page).getByRole('option');
const selected = (page: Page) => history(page).getByRole('option', { selected: true });
const banner = (page: Page) => state(page).locator('[data-part="state-banner"]');
const shown = (page: Page) => state(page).getByRole('region', { name: /^(Current state|State at the selected point)$/ });
const diff = (page: Page) => state(page).getByRole('list', { name: 'State diff' });

/** Presses Tab (or Shift+Tab) until the locator has focus, so the test never uses the pointer. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab'): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`focus never reached ${String(target)}`);
}

/** A thread with a snapshot and three deltas, so the history is: start, snapshot, n=1, n=2, n=3. */
async function run(page: Page, site: Parameters<typeof open>[1]): Promise<void> {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, snapshot({ n: 0, items: ['a'] }), delta({ op: 'replace', path: '/n', value: 1 }, { op: 'add', path: '/items/-', value: 'b' }), set(2), set(3)]);
  await expect(rows(page)).toHaveCount(5);
}

test('from the keyboard alone: reach the history, step to older and newer points, jump to both ends and read each point', async ({ page, site }) => {
  await run(page, site);
  await expect(shown(page)).toContainText('"n": 3');
  await expect(banner(page)).toHaveCount(0);

  await tabTo(page, history(page));
  await expect(history(page)).toBeFocused();
  const outline = await history(page).evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline, 'focus is visible').not.toBe('none');
  await expect(history(page)).toHaveAttribute('aria-activedescendant', (await rows(page).first().getAttribute('id')) ?? '');

  // Down is older.
  await page.keyboard.press('ArrowDown');
  await expect(shown(page)).toContainText('"n": 2');
  await expect(banner(page)).toContainText('Past state');
  await expect(banner(page)).toContainText('1 newer change');
  await expect(state(page)).not.toContainText('Sent as state in the next run');
  await expect(selected(page)).toHaveCount(1);
  await expect(history(page)).toHaveAttribute('aria-activedescendant', (await selected(page).getAttribute('id')) ?? '');
  await expect(diff(page)).toContainText('~ changed');
  await expect(diff(page)).toContainText('/n');
  await page.keyboard.press('ArrowDown');
  await expect(shown(page)).toContainText('"n": 1');
  await expect(banner(page)).toContainText('2 newer changes');
  // The delta that made n=1 also added an item, and its operations are shown.
  await expect(diff(page)).toContainText('+ added');
  await expect(diff(page)).toContainText('/items/1');
  await expect(state(page).getByRole('list', { name: 'Delta operations' })).toContainText('/items/-');

  // Up is newer, and the newest row is the latest state again.
  await page.keyboard.press('ArrowUp');
  await expect(shown(page)).toContainText('"n": 2');
  await page.keyboard.press('ArrowUp');
  await expect(shown(page)).toContainText('"n": 3');
  await expect(banner(page)).toHaveCount(0);
  await expect(state(page)).toContainText('Sent as state in the next run');

  // End is the oldest point, the state the run started from.
  await page.keyboard.press('End');
  await expect(banner(page)).toContainText('4 newer changes');
  await expect(state(page).locator('.agui-label', { hasText: 'Starting state' })).toBeVisible();
  await expect(diff(page)).toHaveCount(0);
  // The first snapshot is compared with the state the run started from, an empty object here.
  await page.keyboard.press('ArrowUp');
  await expect(diff(page)).toContainText('+ added');
  await expect(diff(page)).toContainText('/items');
  await expect(shown(page)).toContainText('"items"');
  await page.keyboard.press('Home');
  await expect(shown(page)).toContainText('"n": 3');
  await expect(banner(page)).toHaveCount(0);

  // The ends are ends: another press does nothing and nothing throws.
  await page.keyboard.press('ArrowUp');
  await expect(shown(page)).toContainText('"n": 3');
});

test('Back to latest and the frame reference work with Enter and Space, and the list keeps focus after the way back', async ({ page, site }) => {
  await run(page, site);
  await tabTo(page, history(page));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(shown(page)).toContainText('"n": 1');

  const reference = state(page).getByRole('button', { name: /^Show frame #/ });
  await tabTo(page, reference, 'Shift+Tab');
  await page.keyboard.press('Enter');
  const targets = await revealed(page);
  expect(targets).toHaveLength(1);
  expect(targets[0]?.exchangeId).toBe('ex1');
  expect(targets[0]?.frameId).toBeTruthy();

  const back = banner(page).getByRole('button', { name: 'Back to latest' });
  await tabTo(page, back, 'Shift+Tab');
  await page.keyboard.press('Space');
  await expect(banner(page)).toHaveCount(0);
  await expect(shown(page)).toContainText('"n": 3');
  await expect(history(page), 'the button left with the banner, so focus goes to the list').toBeFocused();

  await page.keyboard.press('ArrowDown');
  await tabTo(page, banner(page).getByRole('button', { name: 'Back to latest' }), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(shown(page)).toContainText('"n": 3');
});

test('a long value is shortened, opens in full from the keyboard, and a large diff shows 100 differences and the rest on request', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  const long = 'x'.repeat(200);
  const wide = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, i]));
  await send(page, 'ex1', [STARTED, snapshot({}), delta({ op: 'add', path: '/note', value: long }), snapshot(wide)]);
  await expect(rows(page)).toHaveCount(4);

  // The newest point is the snapshot of 250 keys over the earlier one: 250 added and 1 removed.
  await expect(diff(page).locator('li[data-kind]')).toHaveCount(100);
  const more = diff(page).getByRole('button', { name: 'Show 151 more' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(diff(page).locator('li[data-kind]')).toHaveCount(251);

  await tabTo(page, history(page));
  await page.keyboard.press('ArrowDown');
  const value = diff(page).locator('summary');
  await expect(value).toContainText('…');
  await expect(diff(page)).not.toContainText(long);
  await value.focus();
  await page.keyboard.press('Enter');
  await expect(diff(page).getByRole('region', { name: 'Full added value' })).toContainText(long);
});

test('clicking a row selects it, clicking the newest row follows the latest, and arrow keys in another field leave the selection alone', async ({ page, site }) => {
  await run(page, site);
  await rows(page).nth(2).click();
  await expect(shown(page)).toContainText('"n": 1');
  await expect(banner(page)).toContainText('2 newer changes');
  await expect(selected(page)).toContainText('STATE_DELTA');

  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'elsewhere';
    document.body.append(field);
    field.focus();
  });
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await expect(shown(page)).toContainText('"n": 1');

  await rows(page).first().click();
  await expect(banner(page)).toHaveCount(0);
  await expect(shown(page)).toContainText('"n": 3');
  await page.evaluate(() => void document.getElementById('elsewhere')?.remove());
});

test('the selected row scrolls into view as the keys move it', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, snapshot({ n: 0 }), ...Array.from({ length: 60 }, (_, i) => set(i + 1))]);
  await expect(rows(page)).toHaveCount(62);
  await tabTo(page, history(page));
  await page.keyboard.press('End');
  await expect(rows(page).last()).toBeInViewport();
  await expect(history(page)).toBeInViewport();
  await page.keyboard.press('Home');
  await expect(rows(page).first()).toBeInViewport();
});

test('live: the latest point follows new changes, and a past point stays put while 100 more arrive', async ({ page, site }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __writes: string[] }).__writes = writes;
    for (const store of [Storage.prototype]) {
      const original = store.setItem;
      store.setItem = function (key: string, value: string) {
        writes.push(key);
        return original.call(this, key, value);
      };
    }
  });
  await run(page, site);

  // Following the latest: a new change shows without an action.
  await send(page, 'ex1', [set(4)], 100);
  await expect(shown(page)).toContainText('"n": 4');
  await expect(rows(page)).toHaveCount(6);
  await expect(banner(page)).toHaveCount(0);

  // Pick a past point, then let 100 more changes arrive.
  await tabTo(page, history(page));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(shown(page)).toContainText('"n": 2');
  const pastState = await shown(page).textContent();
  const pastDiff = await diff(page).textContent();
  const before = requests.length;

  await send(page, 'ex1', Array.from({ length: 100 }, (_, i) => set(100 + i)), 200);
  await expect(rows(page)).toHaveCount(106);
  await expect(banner(page)).toContainText('102 newer changes');
  expect(await shown(page).textContent()).toBe(pastState);
  expect(await diff(page).textContent()).toBe(pastDiff);
  await expect(selected(page)).toHaveCount(1);

  await banner(page).getByRole('button', { name: 'Back to latest' }).click();
  await expect(shown(page)).toContainText('"n": 199');
  await expect(banner(page)).toHaveCount(0);

  // Browsing sent nothing and wrote nothing.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  expect(requests.length).toBe(before);
  expect(await page.evaluate(() => (window as unknown as { __writes: string[] }).__writes)).toEqual([]);
  const session = await page.evaluate(() => (window as unknown as { __conversation: { session(): { frames: unknown[] } } }).__conversation.session());
  expect(session.frames, 'RUN_STARTED, a snapshot and 104 deltas, all kept').toHaveLength(1 + 1 + 104);
});

test('a new thread shows its own history, empty until it has state, with no selection left over', async ({ page, site }) => {
  await run(page, site);
  await tabTo(page, history(page));
  await page.keyboard.press('ArrowDown');
  await expect(banner(page)).toHaveCount(1);

  await start(page, 'ex2', 't2', 'r2');
  await expect(state(page)).toContainText('No state events in this thread.');
  await expect(history(page)).toHaveCount(0);
  await expect(banner(page)).toHaveCount(0);

  await send(page, 'ex2', [{ type: 'RUN_STARTED', threadId: 't2', runId: 'r2' }, snapshot({ other: true }), delta({ op: 'add', path: '/more', value: 1 })]);
  await expect(rows(page)).toHaveCount(3);
  await expect(shown(page)).toContainText('"more": 1');
  await expect(banner(page)).toHaveCount(0);
  await expect(selected(page)).toContainText('STATE_DELTA');
});
