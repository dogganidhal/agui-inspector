// Spec 014 (FR-014 to FR-017; story 4; SC-006, SC-007): plugin renderers in a real browser, against the reference agent's
// plugin scenario (a custom event and an activity of a type of its own, with a delta). A card carries the plugin's view with
// the name, a frame reference and a Rendered/JSON switch. The frames list and the export are what they are without plugins, a
// renderer that throws leaves the JSON view and one warning, and the A2UI view keeps its type.
import type { Page } from '@playwright/test';
import { PLUGINS } from '../../../examples/reference-agent/scenarios.ts';
import { expect, send, test } from '../hosted/support';
import { embeddedWith, exportedSession, footer, JS, PLUGIN_RUN_FRAMES, runMessage, warningList } from './support';

const INTERACTIVE = { url: '/interactive' };
/** Draws the note and the plan with the DOM, counts draws and cleanups on the page, and registers nothing else. */
const VIEWS = `
const count = (key) => { document.documentElement.dataset[key] = String(Number(document.documentElement.dataset[key] ?? '0') + 1); };
export default (api) => {
  api.renderCustomEvent('example.note', (event, el) => {
    count('noteDraws');
    const p = document.createElement('p');
    p.setAttribute('data-testid', 'note');
    p.textContent = 'Note: ' + event.value.text;
    el.append(p);
    return () => count('noteCleanups');
  });
  api.renderActivity('example-plan', (activity, el) => {
    count('planDraws');
    const list = document.createElement('ol');
    list.setAttribute('data-testid', 'plan');
    for (const step of activity.content.steps) { const li = document.createElement('li'); li.textContent = step; list.append(li); }
    el.append(list);
    return () => count('planCleanups');
  });
};
`;

const noteCard = (page: Page) => page.locator('[data-entry="custom"][data-custom="example.note"]');
const planCard = (page: Page) => page.locator('[data-entry="activity"][data-activity="plan-1"]');
const mark = (page: Page, key: string) => page.evaluate((name) => document.documentElement.dataset[name] ?? '0', key);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** A row of the frames list without its arrival offset and the ids the page makes up for each run. */
const rowText = (text: string) => text.replace(/^\+[\d.]+\s*/, '').replace(UUID, '<id>');
const framesOf = (session: Awaited<ReturnType<typeof exportedSession>>['session']) =>
  session.frames.map((frame) => [frame.eventType, frame.envelope.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>'), frame.data?.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')]);

/** Opens an embedded page with `files` as its plugins and the reference agent's interactive scenarios, and runs the plugin scenario. */
async function open(page: Page, openSite: (options?: never) => Promise<never>, plugins: Record<string, string>, extra: object = INTERACTIVE) {
  const files = Object.fromEntries(Object.entries(plugins).map(([name, body]) => [`/plugins/${name}.js`, { type: JS, body }]));
  const site = await (openSite as unknown as (options: unknown) => Promise<{ page: { origin: string } }>)(embeddedWith(Object.keys(plugins).map((name) => `plugins/${name}.js`), files, extra));
  await page.goto(site.page.origin);
  return site;
}

test('a custom event and an activity are drawn by their plugin: the cards hold the view, the name, a frame reference and the JSON switch, and the delta draws again', async ({ page, openSite }) => {
  await open(page, openSite as never, { views: VIEWS });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);

  await expect(noteCard(page).getByTestId('note')).toHaveText('Note: Synthetic note');
  await expect(noteCard(page)).toContainText('CUSTOM');
  await expect(noteCard(page)).toContainText('example.note');
  await expect(noteCard(page)).toContainText('frame #');
  // The plan: the snapshot had two steps, the delta adds a third, and the view was drawn again.
  await expect(planCard(page).getByTestId('plan').locator('li')).toHaveText(['Read', 'Write', 'Review']);
  await expect(planCard(page)).toContainText('example-plan');
  await expect(planCard(page)).toContainText('1 patch');
  // Every draw but the last has had its cleanup, and the container holds one view, not one per draw.
  expect(Number(await mark(page, 'planDraws'))).toBeGreaterThanOrEqual(1);
  expect(Number(await mark(page, 'planCleanups'))).toBe(Number(await mark(page, 'planDraws')) - 1);
  await expect(planCard(page).getByTestId('plan')).toHaveCount(1);

  // The JSON switch shows the content as received, and back.
  await noteCard(page).getByRole('button', { name: 'JSON' }).click();
  await expect(noteCard(page).getByRole('region', { name: 'Value of example.note' })).toContainText('"text": "Synthetic note"');
  await expect(noteCard(page).getByTestId('note')).toHaveCount(0);
  await noteCard(page).getByRole('button', { name: 'Rendered' }).click();
  await expect(noteCard(page).getByTestId('note')).toBeVisible();
  await planCard(page).getByRole('button', { name: 'JSON' }).click();
  await expect(planCard(page).getByRole('region', { name: 'Content of plan-1' })).toContainText('"Review"');

  // New thread takes the cards away, and every cleanup that was owed has run.
  const draws = Number(await mark(page, 'noteDraws'));
  await page.getByRole('button', { name: 'New thread' }).click();
  await expect(noteCard(page)).toHaveCount(0);
  await expect(page.getByText('No conversation yet')).toBeVisible();
  expect(Number(await mark(page, 'noteCleanups'))).toBe(draws);
});

test('the frames list and the export are the same with and without the plugin, and without a renderer an event looks as it did', async ({ page, openSite }) => {
  await open(page, openSite as never, { views: VIEWS });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  const withPlugin = await exportedSession(page);
  const listWith = (await page.locator('[data-frame-row]').allInnerTexts()).map(rowText);

  await open(page, openSite as never, {});
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  const without = await exportedSession(page);
  const listWithout = (await page.locator('[data-frame-row]').allInnerTexts()).map(rowText);

  expect(framesOf(withPlugin.session)).toEqual(framesOf(without.session));
  expect(withPlugin.session.derived).toEqual(without.session.derived);
  expect(listWith).toEqual(listWithout);
  // No renderer: the marker row and the JSON in the activity card, as before.
  await expect(page.locator('[data-entry="custom"]').first()).toContainText('{"text":"Synthetic note"}');
  await expect(planCard(page)).toContainText('"steps"');
  await expect(page.locator('[data-plugin-view]')).toHaveCount(0);
});

test('a renderer for one name leaves the other custom events and activity types alone', async ({ page, openSite }) => {
  const only = "export default (api) => api.renderCustomEvent('other.event', (e, el) => { el.textContent = 'never'; });";
  await open(page, openSite as never, { only });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  await expect(page.locator('[data-entry="custom"]')).toHaveCount(1);
  await expect(page.locator('[data-entry="custom"] [data-plugin-view]')).toHaveCount(0);
  await expect(footer(page)).toContainText('1 plugin');
});

test('a renderer for the A2UI activity type is refused with one warning, and the A2UI view still draws its surface', async ({ page, openSite }) => {
  const steal = "export default (api) => api.renderActivity('a2ui-surface', (a, el) => { el.textContent = 'stolen'; });";
  await open(page, openSite as never, { steal }, { url: '/surface' });
  await send(page, 'form');
  await expect(page.getByText('Order check')).toBeVisible();
  await expect(page.getByText('stolen')).toHaveCount(0);
  expect(await warningList(page)).toEqual([['Plugin', '/plugins/steal.js: renderActivity(a2ui-surface) is drawn by the A2UI view; ignored']]);
});

test('two plugins that claim the same name: the first draws and the second gets one warning', async ({ page, openSite }) => {
  const second = "export default (api) => api.renderCustomEvent('example.note', (e, el) => { el.setAttribute('data-testid', 'second'); el.textContent = 'second'; });";
  await open(page, openSite as never, { a: VIEWS, b: second });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  await expect(noteCard(page).getByTestId('note')).toBeVisible();
  await expect(page.getByTestId('second')).toHaveCount(0);
  expect(await warningList(page)).toEqual([['Plugin', '/plugins/b.js: renderCustomEvent(example.note) is already registered by /plugins/a.js; ignored']]);
});

test('a renderer that throws leaves the JSON view in its card and one warning, even when it throws again on the delta, and the rest of the conversation works', async ({ page, openSite }) => {
  const bad = "export default (api) => { api.renderActivity('example-plan', () => { throw new Error('bad plan view'); }); api.renderCustomEvent('example.note', (e, el) => { el.textContent = 'fine'; }); };";
  await open(page, openSite as never, { bad });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  await expect(planCard(page).getByRole('region', { name: 'Content of plan-1' })).toContainText('"Review"');
  await expect(noteCard(page)).toContainText('fine');
  await expect(page.getByText('Plan ready.').first()).toBeVisible();
  expect(await warningList(page)).toEqual([['Plugin', '/plugins/bad.js: renderActivity(example-plan) threw: bad plan view']]);
  await expect(footer(page)).toContainText('1 exchange');
});

test('a renderer that changes the data it received changes nothing: the JSON view, the frames list and the export show it as received', async ({ page, openSite }) => {
  const mutate = "export default (api) => { api.renderCustomEvent('example.note', (e, el) => { e.value.text = 'CHANGED'; e.name = 'changed'; el.textContent = e.value.text; }); api.renderActivity('example-plan', (a, el) => { a.content.steps.length = 0; el.textContent = 'cleared'; }); };";
  await open(page, openSite as never, { mutate });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  await expect(noteCard(page)).toContainText('CHANGED');
  await noteCard(page).getByRole('button', { name: 'JSON' }).click();
  await expect(noteCard(page).getByRole('region')).toContainText('Synthetic note');
  await planCard(page).getByRole('button', { name: 'JSON' }).click();
  await expect(planCard(page).getByRole('region')).toContainText('"Review"');
  const { text } = await exportedSession(page);
  expect(text).toContain('Synthetic note');
  expect(text).not.toContain('CHANGED');
  await expect(page.locator('[data-frame-row]', { hasText: 'CUSTOM' }).first()).toBeVisible();
});

test('an imported recording is drawn with the renderers too', async ({ page, openSite }) => {
  const site = await open(page, openSite as never, { views: VIEWS });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  const { text } = await exportedSession(page);
  await page.goto(site.page.origin);
  await page.getByLabel('Session file to import').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(noteCard(page).getByTestId('note')).toHaveText('Note: Synthetic note');
  await expect(planCard(page).getByTestId('plan').locator('li')).toHaveText(['Read', 'Write', 'Review']);
});

test('markup a renderer writes runs no script: the policy forbids inline handlers', async ({ page, openSite, violations }) => {
  const xss = "export default (api) => api.renderCustomEvent('example.note', (e, el) => { el.innerHTML = '<img src=x onerror=\"document.documentElement.dataset.pwned=1\">'; });";
  await open(page, openSite as never, { xss });
  await runMessage(page, PLUGINS, 1, PLUGIN_RUN_FRAMES);
  await expect(noteCard(page).locator('img')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.dataset.pwned ?? '')).toBe('');
  expect((await violations()).every((violation) => violation.directive.startsWith('script-src') || violation.directive === 'img-src')).toBe(true);
});
