// L04 T034 (FR-010, FR-012, FR-017; US1.2 to US1.4): frames in a real browser. Every check compares
// what the page shows or copies with the recording behind it.
import { expect, open, run, snapshot, test, expectAllowlisted } from './support.ts';

test.beforeEach(async ({ page, site }) => {
  await open(page, site);
});

const headers = (page: import('@playwright/test').Page) => page.locator('[data-exchange-header]');
const rowsOf = (page: import('@playwright/test').Page, exchange: string) => page.locator(`[data-exchange="${exchange}"] [data-frame-row]`);

test('an empty session says so, and the view has no exchanges to open', async ({ page }) => {
  await expect(page.getByText('No exchanges yet')).toBeVisible();
  await expect(headers(page)).toHaveCount(0);
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '0');
});

test('exchanges appear newest first, the newest is expanded, and every frame shows in arrival order', async ({ page }) => {
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  await run(page, 'controlEvidence');

  await expect(headers(page)).toHaveCount(3);
  await expect(headers(page).nth(0)).toHaveAttribute('data-exchange-header', 'exchange-3');
  await expect(headers(page).nth(1)).toHaveAttribute('data-exchange-header', 'exchange-2');
  await expect(headers(page).nth(2)).toHaveAttribute('data-exchange-header', 'exchange-1');
  await expect(headers(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
  await expect(headers(page).nth(1)).toHaveAttribute('aria-expanded', 'false');
  await expect(headers(page).nth(2)).toHaveAttribute('aria-expanded', 'false');

  const session = await snapshot(page);
  const newest = session.frames.filter((frame) => frame.exchangeId === 'exchange-3');
  const shown = await rowsOf(page, 'exchange-3').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-frame-row')));
  expect(shown).toEqual(newest.map((frame) => frame.id));
  // Each row carries its offset, type and summary.
  const first = rowsOf(page, 'exchange-3').filter({ hasText: 'RUN_STARTED' });
  await expect(first).toContainText(/\+\d+\.\d{3}/);
  await expect(first).toContainText('r-proto');
  await expect(page.locator('[data-exchange="exchange-2"] [data-frame-row]')).toHaveCount(0);

  // Opening an older exchange shows its frames; the newest stays open.
  await headers(page).nth(2).click();
  await expect(headers(page).nth(2)).toHaveAttribute('aria-expanded', 'true');
  await expect(rowsOf(page, 'exchange-1')).toHaveCount(30);
  await expect(headers(page).nth(0)).toHaveAttribute('aria-expanded', 'true');
});

test('filters by event family, content and issues, and the counts follow them', async ({ page }) => {
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  await headers(page).nth(1).click();
  const baseline = rowsOf(page, 'exchange-1');
  await expect(baseline).toHaveCount(30);

  // Family chips.
  await page.locator('[data-family-chip="tool"]').click();
  await expect(baseline).toHaveCount(5);
  for (const type of await baseline.locator('.agui-fr-ty').allTextContents()) expect(type).toMatch(/^TOOL_CALL_/);
  await expect(page.locator('[data-exchange-header="exchange-1"]')).toContainText('5/30 frames');
  await expect(page.locator('[data-family-chip="tool"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-family-chip="reasoning"]').click();
  await expect(baseline).toHaveCount(5 + 7);
  await page.locator('[data-family-chip="tool"]').click();
  await page.locator('[data-family-chip="reasoning"]').click();
  await expect(baseline).toHaveCount(30);

  // Content search matches the raw text, not only the type.
  const search = page.getByRole('searchbox', { name: 'Filter frames by type or content' });
  await search.fill('SYNTHETIC-RESEARCHER');
  await expect(baseline).toHaveCount(1);
  await expect(baseline.first()).toContainText('SUBAGENT_STARTED');
  await search.fill('nothing says this');
  await expect(baseline).toHaveCount(0);
  await expect(page.getByText('No frames match the filter.').first()).toBeVisible();
  await search.fill('');
  await expect(baseline).toHaveCount(30);

  // Issues: only frames with a finding, in every exchange; the chip counts them.
  const session = await snapshot(page);
  await expect(page.locator('[data-issues-chip] .agui-count')).toHaveText('5');
  await page.locator('[data-issues-chip]').click();
  await expect(baseline).toHaveCount(0);
  const invalid = rowsOf(page, 'exchange-2');
  await expect(invalid).toHaveCount(5);
  await expect(invalid.locator('.agui-tag--err')).toHaveCount(5);
  expect(session.frames.filter((frame) => frame.exchangeId === 'exchange-2' && frame.jsonVerdict === 'invalid')).toHaveLength(2);
  await page.locator('[data-issues-chip]').click();
  await expect(baseline).toHaveCount(30);
});

test('a frame opens to its raw text, formatted JSON or exactly as received', async ({ page }) => {
  await run(page, 'invalidFrames');
  const session = await snapshot(page);
  const frames = session.frames.filter((frame) => frame.exchangeId === 'exchange-1');

  // Valid JSON is formatted for reading and says so; the copy button and label stay on the raw text.
  const valid = frames.find((frame) => frame.eventType === 'RUN_STARTED')!;
  await page.locator(`[data-frame-row="${valid.id}"]`).click();
  const detail = page.locator(`[data-frame-detail="${valid.id}"]`);
  await expect(detail).toContainText('as received');
  await expect(detail.locator('pre')).toHaveText(JSON.stringify(valid.parsed, null, 2));

  // Data that is not JSON is shown character for character, with the finding beside it.
  for (const bad of frames.filter((frame) => frame.jsonVerdict === 'invalid')) {
    await page.locator(`[data-frame-row="${bad.id}"]`).click();
    const text = page.locator(`[data-frame-detail="${bad.id}"]`);
    await expect(text.locator('pre')).toHaveText(bad.data!);
    await expect(text).toContainText('Data is not valid JSON');
    await expect(page.locator(`[data-frame-row="${bad.id}"]`)).toContainText('unparsed');
  }

  // Unknown types and schema failures keep their type, their verdict and their text.
  const unknown = frames.find((frame) => frame.eventType === 'SYNTHETIC_FUTURE_EVENT')!;
  await page.locator(`[data-frame-row="${unknown.id}"]`).click();
  await expect(page.locator(`[data-frame-detail="${unknown.id}"]`)).toContainText('not in the supported baseline');
  const wrongField = frames.find((frame) => frame.eventType === 'TEXT_MESSAGE_CONTENT' && frame.parsed && (frame.parsed as { delta?: unknown }).delta === 7)!;
  await page.locator(`[data-frame-row="${wrongField.id}"]`).click();
  await expect(page.locator(`[data-frame-detail="${wrongField.id}"]`)).toContainText('Does not match the AG-UI event schema');
  await expect(page.locator(`[data-frame-detail="${wrongField.id}"] pre`)).toContainText('"delta": 7');

  // Closing a frame removes its detail.
  await page.locator(`[data-frame-row="${valid.id}"]`).click();
  await expect(detail).toHaveCount(0);
});

test('control evidence is listed with its envelope, not as an event', async ({ page }) => {
  await run(page, 'controlEvidence');
  const session = await snapshot(page);
  const control = session.frames.filter((frame) => frame.classification === 'control');
  expect(control.length).toBeGreaterThan(0);
  const row = page.locator(`[data-frame-row="${control[0]!.id}"]`);
  await expect(row).toContainText('control');
  await row.click();
  await expect(page.locator(`[data-frame-detail="${control[0]!.id}"] pre`)).toHaveText(control[0]!.envelope);
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '3');
});

test('copying an exchange puts its original frame records, in order, on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  const session = await snapshot(page);
  const expected = session.frames.filter((frame) => frame.exchangeId === 'exchange-1');

  await page.getByRole('button', { name: /Copy the frames of POST \/scenario\/baselineRun as JSON/ }).click();
  await expect(page.getByText('Copied 30 frames')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual(expected);
  expect(copied).toBe(JSON.stringify(expected, null, 2));

  // A filter changes the view, not the recording that gets copied.
  await page.locator('[data-family-chip="tool"]').click();
  await page.getByRole('button', { name: /Copy the frames of POST \/scenario\/baselineRun as JSON/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied);

  // One frame's raw text copies exactly as received.
  await page.locator('[data-exchange-header="exchange-1"]').click();
  const first = expected.find((frame) => frame.eventType === 'TOOL_CALL_ARGS')!;
  await page.locator(`[data-frame-row="${first.id}"]`).click();
  await page.locator(`[data-frame-detail="${first.id}"]`).getByRole('button', { name: 'Copy the frame as received' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first.data);
});

test('without clipboard access the text is offered for copying by hand', async ({ page, context }) => {
  await context.clearPermissions();
  await run(page, 'baselineRun');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
  });
  await page.getByRole('button', { name: /Copy the frames of/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Copy by hand' });
  await expect(dialog).toBeVisible();
  expect(JSON.parse(await dialog.getByRole('textbox').inputValue())).toHaveLength(30);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('original chunk events stay in the list with their client-derived expansion beside them', async ({ page }) => {
  await run(page, 'baselineRun');
  const session = await snapshot(page);
  const chunk = session.frames.find((frame) => frame.eventType === 'TEXT_MESSAGE_CHUNK')!;
  await page.evaluate((source) => {
    (window as unknown as { __host: { store(): { appendDerived(entry: unknown): void } } }).__host.store().appendDerived({
      id: 'derived-1',
      provenance: 'derived',
      derivation: 'chunk-expansion',
      sources: [source],
      attribution: 'identified',
      eventType: 'TEXT_MESSAGE_CONTENT',
      label: 'Expanded from TEXT_MESSAGE_CHUNK',
      value: { messageId: 'm2', delta: 'héllo' },
    });
  }, chunk.id);

  const original = page.locator(`[data-frame-row="${chunk.id}"]`);
  await expect(original).toContainText('TEXT_MESSAGE_CHUNK');
  const derived = page.locator('[data-derived-row="derived-1"]');
  await expect(derived).toBeVisible();
  await expect(derived).toHaveAttribute('data-derived-from', chunk.id);
  await expect(derived).toContainText('derived');
  await expect(derived.locator('.agui-fr-off')).toHaveText('');
  // It follows the chunk directly.
  expect(await original.locator('xpath=..').evaluate((item) => item.nextElementSibling?.querySelector('[data-derived-row]')?.getAttribute('data-derived-row'))).toBe('derived-1');
  await derived.click();
  await expect(page.getByText(/Not on the wire/)).toBeVisible();
  // The original is untouched and still listed once.
  await expect(page.locator(`[data-frame-row="${chunk.id}"]`)).toHaveCount(1);
  // Counts and copies are of received frames only.
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '30');
});

test('the list is keyboard accessible: headers and rows toggle with Enter and Space', async ({ page }) => {
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  const older = page.locator('[data-exchange-header="exchange-1"]');
  await older.focus();
  await page.keyboard.press('Enter');
  await expect(older).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(older).toHaveAttribute('aria-expanded', 'false');

  const row = page.locator('[data-exchange="exchange-2"] [data-frame-row]').first();
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Space');
  await expect(row).toHaveAttribute('aria-expanded', 'false');

  // Filters are reachable by keyboard too.
  const chip = page.locator('[data-family-chip="text"]');
  await chip.focus();
  await page.keyboard.press('Enter');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
});

test('on a phone the summary column goes away and rows keep type and verdict', async ({ page }) => {
  await run(page, 'baselineRun');
  await page.setViewportSize({ width: 400, height: 800 });
  const row = page.locator('[data-frame-row]').first();
  await expect(row.locator('.agui-fr-sum')).toBeHidden();
  await expect(row.locator('.agui-fr-ty')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the page asks for nothing outside its own origin and the scripted agent', async ({ page, site, network }) => {
  await run(page, 'baselineRun');
  expectAllowlisted(network, site);
  expect(network.some((url) => /fonts\.|googleapis|gstatic/.test(url))).toBe(false);
});
