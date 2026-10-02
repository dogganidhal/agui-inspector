// L04 T037 (FR-034, FR-035, FR-036, FR-039; SC-007, SC-008; US5.3, US5.4): the export warning, the
// local import control, a byte-exact round trip, corrupt files that leave the session alone, and
// a file with no headers or credentials even though a token was in use. Import makes no request.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, expectAllowlisted, open, run, snapshot, test, type Site } from './support.ts';

const SECRET = 'SECRET-TOKEN-4f9a';
const toolbar = (page: Page) => page.locator('.agui-ins-head');
const exchangeIds = (page: Page) => page.locator('[data-exchange-header]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-exchange-header')));

/** A session with every kind of record, captured while a token is in use and sent to the agent. */
async function populate(page: Page, site: Site) {
  await page.evaluate((token) => (window as unknown as { __host: { setToken(value: string): void } }).__host.setToken(token), SECRET);
  await run(page, 'baselineRun');
  await run(page, 'invalidFrames');
  await run(page, 'controlEvidence');
  await page.getByRole('button', { name: 'Raw request', exact: true }).click();
  await page.getByRole('textbox', { name: 'Raw request body' }).fill('{ "threadId" :17 }');
  await page.getByRole('button', { name: 'Send unchanged' }).click();
  await expect(page.locator('[data-exchange-header]')).toHaveCount(4);
  await expect(page.locator('[data-exchange-header]').first()).toContainText('422');
  // The token really was in use: the agent received it on every request.
  expect(site.received.length).toBe(4);
  expect(site.received.every((request) => request.authorization === `Bearer ${SECRET}`)).toBe(true);
}

async function exportFile(page: Page): Promise<{ text: string; name: string }> {
  await toolbar(page).getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return { text: readFileSync((await download.path())!, 'utf8'), name: download.suggestedFilename() };
}

const importText = (page: Page, text: string, name = 'session.json') =>
  page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });

test('export warns about sensitive data first, and cancelling downloads nothing', async ({ page, site }) => {
  await open(page, site);
  await populate(page, site);

  let downloads = 0;
  page.on('download', () => (downloads += 1));
  await toolbar(page).getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export this session' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('can contain personal or sensitive data');
  await expect(dialog).toContainText('Headers and authentication tokens are never included');
  const received = (await snapshot(page)).frames.filter((frame) => frame.classification === 'data').length;
  expect(received).toBe(41);
  await expect(dialog).toContainText(`agui-inspector-session.json · 4 exchanges · ${received} frames · 0 headers`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(200);
  expect(downloads).toBe(0);

  // Escape closes it too, and the dialog can be reopened.
  await toolbar(page).getByRole('button', { name: 'Export session' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(downloads).toBe(0);

  const file = await exportFile(page);
  expect(file.name).toBe('agui-inspector-session.json');
  expect(downloads).toBe(1);
});

test('the exported file has no headers and no credentials, though a token was in use', async ({ page, site }) => {
  await open(page, site);
  await populate(page, site);
  const { text } = await exportFile(page);

  const file = JSON.parse(text) as { version: number; session: Record<string, Array<Record<string, unknown>> | string> };
  expect(file.version).toBe(0);
  expect(Object.keys(file)).toEqual(['version', 'session']);
  expect(text).not.toContain(SECRET);
  expect(text).not.toMatch(/Bearer/);
  // Header absence: no record has any field that names a header, cookie, token or credential.
  for (const [collection, records] of Object.entries(file.session)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) expect(Object.keys(record).filter((key) => /header|authorization|cookie|credential|token|auth/i.test(key)), `${collection} record ${String(record.id)}`).toEqual([]);
  }
  // What the file does hold: every exchange, the frames as received, the run inputs.
  const session = await snapshot(page);
  expect(file.session.exchanges).toHaveLength(4);
  expect(file.session.frames).toEqual(JSON.parse(JSON.stringify(session.frames)));
  expect((file.session.exchanges as Array<{ requestBody?: string }>).map((exchange) => exchange.requestBody)).toContain('{ "threadId" :17 }');
  expect(file.session.runs).toHaveLength(3);
});

test('a round trip restores the same exchanges, frames, run inputs, order and timing, with no request', async ({ page, site, network, browser }) => {
  await open(page, site);
  await populate(page, site);
  const original = await snapshot(page);
  const { text } = await exportFile(page);

  // A fresh page has nothing; importing the file shows the recording and makes no request at all.
  const fresh = await browser.newPage();
  const requests: string[] = [];
  fresh.on('request', (request) => requests.push(request.url()));
  await open(fresh, site);
  const before = requests.length;
  site.received.length = 0;
  await importText(fresh, text);

  await expect(fresh.locator('[data-exchange-header]')).toHaveCount(4);
  expect(await snapshot(fresh)).toEqual(original);
  expect(await exchangeIds(fresh)).toEqual(await exchangeIds(page));
  expect(requests.length).toBe(before);
  expect(site.received).toEqual([]);

  // The imported recording is inspected like a live one: filters, raw expansion and copy work.
  await fresh.locator('[data-family-chip="tool"]').click();
  await fresh.locator('[data-exchange-header="exchange-1"]').click();
  await expect(fresh.locator('[data-exchange="exchange-1"] [data-frame-row]')).toHaveCount(5);
  await fresh.locator('[data-family-chip="tool"]').click();
  const frame = original.frames.find((candidate) => candidate.eventType === 'TOOL_CALL_ARGS')!;
  await fresh.locator(`[data-frame-row="${frame.id}"]`).click();
  await expect(fresh.locator(`[data-frame-detail="${frame.id}"] pre`)).toHaveText(JSON.stringify(frame.parsed, null, 2));
  await fresh.close();

  // Exporting what was imported gives back the same bytes.
  await page.reload();
  await page.waitForFunction(() => '__host' in window);
  await importText(page, text);
  await expect(page.locator('[data-exchange-header]')).toHaveCount(4);
  expect((await exportFile(page)).text).toBe(text);
  expectAllowlisted(network, site);
});

test('a corrupt file shows an error and leaves the session being viewed alone', async ({ page, site }) => {
  await open(page, site);
  await populate(page, site);
  const good = (await exportFile(page)).text;
  const before = await snapshot(page);
  const headersBefore = await exchangeIds(page);
  const requestsBefore = site.received.length;

  const parsed = JSON.parse(good);
  const cases: Array<[label: string, file: string, message: RegExp]> = [
    ['not JSON', '{"version": 0, "session": ', /not valid JSON/],
    ['empty', '', /not valid JSON/],
    ['wrong version', JSON.stringify({ ...parsed, version: 1 }), /Unsupported version 1/],
    ['no session', JSON.stringify({ version: 0 }), /session/i],
    ['header-bearing', JSON.stringify({ ...parsed, session: { ...parsed.session, exchanges: parsed.session.exchanges.map((exchange: object, at: number) => (at === 0 ? { ...exchange, headers: { authorization: 'x' } } : exchange)) } }), /header or credential field "headers"/],
    ['dangling frame reference', JSON.stringify({ ...parsed, session: { ...parsed.session, exchanges: parsed.session.exchanges.map((exchange: { frameIds: string[] }, at: number) => (at === 1 ? { ...exchange, frameIds: ['gone', ...exchange.frameIds.slice(1)] } : exchange)) } }), /gone/],
    ['out-of-order frames', JSON.stringify({ ...parsed, session: { ...parsed.session, frames: [...parsed.session.frames].reverse() } }), /frames\[0\]|frameIds|index/],
    ['unknown field', JSON.stringify({ ...parsed, extra: true }), /unknown field "extra"/],
  ];
  for (const [label, file, message] of cases) {
    await importText(page, file, `${label}.json`);
    const alert = page.getByTestId('inspection-error');
    await expect(alert, label).toContainText('Import failed');
    await expect(alert, label).toContainText(message);
    // The old session is still the one on screen, byte for byte.
    expect(await snapshot(page), label).toEqual(before);
    expect(await exchangeIds(page), label).toEqual(headersBefore);
  }
  expect(site.received.length).toBe(requestsBefore);

  // A good file afterwards clears the error and replaces the session.
  await importText(page, good);
  await expect(page.getByTestId('inspection-error')).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test('a file whose frames contradict themselves is refused', async ({ page, site }) => {
  await open(page, site);
  await run(page, 'baselineRun');
  const { text } = await exportFile(page);
  const file = JSON.parse(text);
  file.session.frames[2].parsed = { type: 'SOMETHING_ELSE' };
  await importText(page, JSON.stringify(file));
  await expect(page.getByTestId('inspection-error')).toContainText('parsed does not match data');
});

test('importing is keyboard accessible and the file chooser can be reused after a failure', async ({ page, site }) => {
  await open(page, site);
  await run(page, 'baselineRun');
  const { text } = await exportFile(page);
  await importText(page, '{nope');
  await expect(page.getByTestId('inspection-error')).toBeVisible();
  // The same name again still triggers a change: the input was reset.
  await importText(page, text, 'session.json');
  await expect(page.getByTestId('inspection-error')).toHaveCount(0);

  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), (async () => {
    await toolbar(page).getByRole('button', { name: 'Import session' }).focus();
    await page.keyboard.press('Enter');
  })()]);
  expect(chooser.isMultiple()).toBe(false);
});

test('an empty session exports with its warning and imports back to nothing', async ({ page, site }) => {
  await open(page, site);
  const { text } = await exportFile(page);
  expect(JSON.parse(text).session).toMatchObject({ exchanges: [], runs: [], frames: [], findings: [], derived: [] });
  await run(page, 'baselineRun');
  await importText(page, text);
  await expect(page.locator('[data-exchange-header]')).toHaveCount(0);
  await expect(page.getByText('No exchanges yet')).toBeVisible();
});
