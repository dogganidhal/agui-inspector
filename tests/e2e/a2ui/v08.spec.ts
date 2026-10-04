// Spec 008 (FR-001 to FR-012, FR-017; US1 to US3): A2UI v0.8 surfaces in a real browser, through the real v0.8
// renderer, under the real page's `style-src 'self'`. The fixture host feeds the scripted v0.8 story, a gallery of
// the 18 standard components and a few hand-written lists to the A2UI view and records the action callback. Every
// check is about what a user sees and what the callback received: drawing, the action round trip, what typed text
// survives, the JSON that must stay as received, the guards, the keyboard, and zero requests and console errors.
import { expect, type Page } from '@playwright/test';
import {
  BASIC_CATALOG_ID,
  STANDARD_V08_CATALOG_ID,
  THIRD_PARTY_HOST,
  formSurface,
  mixedSurfaces,
  v08Surfaces,
} from '../../../examples/reference-agent/a2ui-scenarios.ts';
import { v08Gallery } from '../../../packages/inspector/tests/a2ui/gallery-v08.ts';
import { actions, feed, open, test, view } from './support.ts';

const lit = (value: string) => ({ literalString: value });
const text = (id: string, value: string) => ({ id, component: { Text: { text: lit(value) } } });
const surface = (page: Page, id: string) => page.locator(`[data-surface="${id}"]`);

/**
 * With the real page's `style-src 'self'`, one policy violation is already there before any surface is drawn:
 * `@a2ui/react/v0_9` injects a `<style>` for Safari's date input (`a2ui-date-time-input-webkit-styles`) as it loads.
 * That is the v0.9 renderer's, not v0.8's. It is named by its hash, so a violation by the v0.8 renderer's
 * stylesheet, which has another hash, still fails.
 */
const V09_DATE_INPUT_STYLE = 'sha256-hl8oWaqVB/FPzxoC+o0SsbSifRCyvtG+dpTsoua83YA=';
const unexpected = (problems: readonly string[]) => problems.filter((problem) => !problem.includes(V09_DATE_INPUT_STYLE));
const alerts = (page: Page) => page.locator('.agui-a2ui-issues');

/** A one-surface v0.8 list: components, then the message that names the root. */
const single = (surfaceId: string, components: readonly object[], catalogId?: string, styles?: object) => [
  { surfaceUpdate: { surfaceId, components } },
  { beginRendering: { surfaceId, root: 'root', ...(catalogId === undefined ? {} : { catalogId }), ...(styles === undefined ? {} : { styles }) } },
];

// ---- US1: see a v0.8 surface and use it ---------------------------------------------------------------

test('both v0.8 surfaces of the story are drawn by the v0.8 renderer, with their data', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);

  await expect(view(page)).toHaveAttribute('data-status', 'rendered');
  await expect(page.locator('[data-surface]')).toHaveCount(2);
  await expect(surface(page, 'expense')).toHaveAttribute('data-version', 'v0.8');
  await expect(surface(page, 'status')).toHaveAttribute('data-version', 'v0.8');
  await expect(page.getByRole('heading', { name: 'Expense report', level: 2 })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('42.50');
  await expect(page.getByRole('checkbox', { name: 'Receipt attached' })).not.toBeChecked();
  await expect(page.getByRole('slider', { name: 'Urgency' })).toHaveValue('2');
  await expect(page.getByRole('combobox', { name: 'Category' })).toBeVisible();
  await expect(page.getByText('Waiting for review')).toBeVisible();
  await expect(alerts(page)).toHaveCount(0);
  expect(await actions(page)).toEqual([]);
});

test('a surface whose root has not been named yet is not drawn, and that is not an error', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces.slice(0, 2));
  await expect(view(page)).toHaveAttribute('data-status', 'rendered');
  await expect(page.locator('[data-surface]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('No surface has been created yet.')).toBeVisible();

  // The message that names the root arrives in a later snapshot: the surface appears.
  await feed(page, v08Surfaces.slice(0, 3));
  await expect(surface(page, 'expense')).toBeVisible();
});

test('pressing the button calls back with name, surface, component, the values bound at the click and a timestamp', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);
  await page.getByRole('textbox', { name: 'Amount' }).fill('19.99');
  await page.getByRole('combobox', { name: 'Category' }).selectOption('meals');
  await page.getByRole('checkbox', { name: 'Receipt attached' }).check();
  await page.getByRole('slider', { name: 'Urgency' }).fill('4');
  const before = Date.now();
  await page.getByRole('button', { name: 'Submit expense' }).click();

  const [action, ...rest] = await actions(page);
  expect(rest).toEqual([]);
  expect(Object.keys(action!).sort()).toEqual(['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  expect(action).toMatchObject({
    name: 'submit_expense',
    surfaceId: 'expense',
    sourceComponentId: 'submit',
    context: { amount: '19.99', category: ['meals'], receipt: true, urgency: 4 },
  });
  expect(Date.parse(action!.timestamp)).toBeGreaterThanOrEqual(before - 1000);
  expect(new Date(action!.timestamp).toISOString()).toBe(action!.timestamp);
});

test('a context entry bound to an object path reaches the action as an object, not as {}', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, [
    ...single('obj', [
      { id: 'root', component: { Column: { children: { explicitList: ['send'] } } } },
      text('send-label', 'Send'),
      { id: 'send', component: { Button: { child: 'send-label', action: { name: 'send_profile', context: [{ key: 'whole', value: { path: '/profile' } }, { key: 'name', value: { path: '/profile/name' } }] } } } },
    ]),
    { dataModelUpdate: { surfaceId: 'obj', contents: [{ key: 'profile', valueMap: [{ key: 'name', valueString: 'Ada' }, { key: 'age', valueNumber: 36 }] }] } },
  ]);
  await page.getByRole('button', { name: 'Send' }).click();
  const [action] = await actions(page);
  expect(action?.context).toEqual({ whole: { name: 'Ada', age: 36 }, name: 'Ada' });
});

test('a scripted continuation round-trips both actions: the surface changes, typed text stays, a surface is removed', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await page.evaluate(() => window.__a2ui.continueWith(true));
  await feed(page, v08Surfaces);
  await page.getByRole('textbox', { name: 'Amount' }).fill('keep me');
  await page.getByRole('button', { name: 'Submit expense' }).click();

  await expect(page.getByText('Submitted keep me for no category')).toBeVisible();
  await expect(page.getByText(/^Received submit_expense from submit on expense: .*"amount":"keep me"/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('keep me');
  await expect(page.getByRole('heading', { name: 'Expense report' })).toBeVisible();

  await page.getByRole('button', { name: 'Withdraw' }).click();
  await expect(page.getByText('Withdrawn')).toBeVisible();
  await expect(surface(page, 'expense')).toHaveCount(0);
  await expect(surface(page, 'status')).toBeVisible();
  expect((await actions(page)).map((action) => action.name)).toEqual(['submit_expense', 'withdraw_expense']);
});

test('a rewritten earlier message redraws the surface from the messages as they now stand and the typed text is lost', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);
  await page.getByRole('textbox', { name: 'Amount' }).fill('typed by hand');
  const rewritten = JSON.parse(JSON.stringify(v08Surfaces)) as Array<{ dataModelUpdate?: { contents: Array<{ valueString?: string }> } }>;
  rewritten[1]!.dataModelUpdate!.contents[0]!.valueString = '99.00';
  await feed(page, rewritten);
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('99.00');
});

test('typing and acting never change the operations: the JSON view shows exactly what was received', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);
  await page.getByRole('textbox', { name: 'Amount' }).fill('1');
  await page.getByRole('checkbox', { name: 'Receipt attached' }).check();
  await page.getByRole('button', { name: 'Submit expense' }).click();
  expect(await actions(page)).toHaveLength(1);

  await page.evaluate(() => window.__a2ui.render(false));
  await expect(view(page)).toHaveAttribute('data-status', 'json-only');
  await expect(page.getByText('Rendering is off. The operations are shown as received.')).toBeVisible();
  const shown = await page.getByLabel('Operations of a2ui-surface-1').textContent();
  expect(JSON.parse(shown ?? 'null')).toEqual(v08Surfaces);

  // Back on, the surface is drawn again from the operations, so what was typed is gone.
  await page.evaluate(() => window.__a2ui.render(true));
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('42.50');
});

test('a surface that reaches outside the page loads nothing; Markdown and markup in text stay as typed', async ({ page, site }) => {
  const requests: string[] = [];
  const popups: string[] = [];
  const problems: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('popup', (popup) => popups.push(popup.url()));
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  await open(page, site, { strict: true });
  const markup = '<b>not bold</b> **not bold** [not a link](http://third-party.invalid/page) ![not a picture](http://third-party.invalid/picture.png)';
  await feed(page, [...v08Gallery, ...single('plain8', [{ id: 'root', component: { Column: { children: { explicitList: ['markup'] } } } }, text('markup', markup)])]);

  const media = surface(page, 'gallery8');
  await expect(media.locator('[data-blocked="Image"]')).toContainText(`http://${THIRD_PARTY_HOST}/picture.png`);
  await expect(media.locator('[data-blocked="Video"]')).toContainText(`http://${THIRD_PARTY_HOST}/clip.mp4`);
  await expect(media.locator('[data-blocked="AudioPlayer"]')).toContainText(`http://${THIRD_PARTY_HOST}/sound.mp3`);
  await expect(media.locator('img, video, audio, iframe')).toHaveCount(0);
  await expect(surface(page, 'plain8')).toContainText(markup);
  await expect(surface(page, 'plain8').locator('a, b, strong, img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Go' }).click();
  await page.waitForTimeout(300);

  expect(popups).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  expect(unexpected(problems)).toEqual([]);
});

test('the renderer never injects its stylesheet: no <style> from it, and the policy raises nothing', async ({ page, site }) => {
  const problems: string[] = [];
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);
  await expect(surface(page, 'expense')).toBeVisible();
  expect(await page.locator('style#a2ui-structural-styles').count()).toBe(0);
  expect(await page.locator('template#a2ui-structural-styles').count()).toBe(1);
  expect(unexpected(problems)).toEqual([]);
});

test('every one of the 18 components draws, and each control has a role and an accessible name', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Gallery);
  const gallery = surface(page, 'gallery8');
  await expect(gallery).toBeVisible();
  await expect(alerts(page)).toHaveCount(0);

  await expect(gallery.getByRole('heading', { name: 'Heading one', level: 1 })).toBeVisible();
  await expect(gallery.getByText('Body text wraps like a paragraph')).toBeVisible();
  await expect(gallery.getByText('Caption text is smaller and muted')).toBeVisible();
  await expect(gallery.getByRole('img', { name: 'account circle' })).toBeVisible();
  await expect(gallery.getByText('Inside a card')).toBeVisible();
  await expect(gallery.getByRole('separator')).toBeVisible();
  await expect(gallery.getByText('Left of the row')).toBeVisible();
  await expect(gallery.getByText('First list item')).toBeVisible();
  await expect(gallery.getByRole('tablist')).toBeVisible();
  await expect(gallery.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
  await expect(gallery.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'false');
  await expect(gallery.getByRole('tabpanel')).toContainText('Panel of the first tab');
  await expect(gallery.getByRole('button', { name: 'Open dialog' })).toBeVisible();
  await expect(gallery.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada');
  await expect(gallery.getByRole('checkbox', { name: 'I agree' })).toBeVisible();
  await expect(gallery.getByRole('slider', { name: 'Level' })).toHaveValue('4');
  await expect(gallery.getByRole('combobox', { name: 'Pick one' })).toBeVisible();
  await expect(gallery.getByRole('button', { name: 'Go' })).toBeVisible();
  const date = gallery.locator('input[type="date"]');
  await expect(date).toHaveValue('2026-10-04');
  await expect(date).toHaveAccessibleName(/\S/);
  for (const kind of ['Image', 'Video', 'AudioPlayer']) await expect(gallery.locator(`[data-blocked="${kind}"]`)).toHaveAttribute('role', 'note');
});

test('the surface works from the keyboard: Enter and Space press a button, Arrow keys and Home move between tabs', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);
  const submit = page.getByRole('button', { name: 'Submit expense' });
  await submit.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  expect((await actions(page)).map((action) => action.name)).toEqual(['submit_expense', 'submit_expense']);

  const limits = page.getByRole('tab', { name: 'Limits' });
  await limits.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Receipts' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Receipts' })).toBeFocused();
  await expect(page.getByRole('tabpanel')).toContainText('Keep every receipt above 25.');
  await page.keyboard.press('Home');
  await expect(limits).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Meals are capped at 40 per day.');
  // Only the selected tab is in the tab order.
  await expect(page.getByRole('tab', { name: 'Receipts' })).toHaveAttribute('tabindex', '-1');
});

test('a modal opens from its trigger, Escape shuts it and focus returns to the trigger', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Gallery);
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Dialog' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Inside the dialog');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});

test('an unknown component type is an error in place that names it and keeps the definition as received; the rest draws', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, single('odd', [
    { id: 'root', component: { Column: { children: { explicitList: ['fine', 'odd-one'] } } } },
    text('fine', 'Survivor'),
    { id: 'odd-one', component: { Hologram: { depth: 3 } } },
  ]));
  const alert = page.getByRole('alert').filter({ hasText: 'Unknown component type: Hologram.' });
  await expect(alert).toBeVisible();
  await alert.getByText('As received').click();
  await expect(page.getByRole('region', { name: 'Received component odd-one' })).toContainText('"Hologram"');
  await expect(page.getByText('Survivor')).toBeVisible();
});

test('surfaces follow the theme tokens: an overridden radius reaches a v0.8 control', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, v08Surfaces);
  const field = page.getByRole('textbox', { name: 'Amount' });
  const before = await field.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  await page.addStyleTag({ url: `${site.origin}/override.css` });
  await expect.poll(() => field.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).not.toBe(before);
  expect(await field.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe('15.4px');
});

test('the primary color a surface carries applies to that surface only', async ({ page, site }) => {
  await open(page, site, { strict: true });
  /** A surface with one primary button. Component ids carry the surface id, as the ids of two surfaces never meet. */
  const withButton = (id: string, styles?: object) =>
    single(
      id,
      [
        { id: 'root', component: { Column: { children: { explicitList: [`${id}-go`] } } } },
        text(`${id}-label`, `Go ${id}`),
        { id: `${id}-go`, component: { Button: { child: `${id}-label`, primary: true, action: { name: 'go' } } } },
      ],
      undefined,
      styles,
    );
  await feed(page, [...withButton('red', { primaryColor: '#ff0000' }), ...withButton('plain')]);
  const color = (name: string) => page.getByRole('button', { name }).evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(await color('Go red')).toBe('rgb(255, 0, 0)');
  expect(await color('Go plain')).not.toBe('rgb(255, 0, 0)');
});

// ---- US2: both versions in one activity -----------------------------------------------------------------

test('a list with both versions draws both surfaces in the order the list first names them; one id in two versions is two surfaces', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, mixedSurfaces);

  await expect(alerts(page)).toHaveCount(0);
  const drawn = page.locator('[data-surface]');
  await expect(drawn).toHaveCount(4);
  expect(await drawn.evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute('data-version')}:${node.getAttribute('data-surface')}`))).toEqual(['v0.9:nine', 'v0.8:eight', 'v0.9:same', 'v0.8:same']);
  await expect(page.getByText('Surface in v0.9')).toBeVisible();
  await expect(page.getByText('Surface in v0.8')).toBeVisible();
  await expect(page.getByText('Same id, v0.9')).toBeVisible();
  await expect(page.getByText('Same id, v0.8')).toBeVisible();
});

test('a deleteSurface with no version removes the v0.8 surface, and one that declares v0.9 removes the v0.9 one', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, mixedSurfaces);
  await feed(page, [...mixedSurfaces, { deleteSurface: { surfaceId: 'same' } }]);
  await expect(page.locator('[data-surface="same"]')).toHaveCount(1);
  await expect(page.locator('[data-surface="same"]')).toHaveAttribute('data-version', 'v0.9');
  await feed(page, [...mixedSurfaces, { deleteSurface: { surfaceId: 'same' } }, { version: 'v0.9', deleteSurface: { surfaceId: 'same' } }]);
  await expect(page.locator('[data-surface="same"]')).toHaveCount(0);
  await expect(page.locator('[data-surface]')).toHaveCount(2);
});

test('bad entries are reported by position with the entry as received, and every valid surface still draws', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, [
    ...mixedSurfaces.slice(0, 4),
    'not an object',
    { version: 'v0.8', beginRendering: { surfaceId: 'x', root: 'root' } },
    { surfaceUpdate: { surfaceId: 'y', components: [] } },
    { beginRendering: { surfaceId: 'z', root: 'root' }, deleteSurface: { surfaceId: 'z' } },
    ...mixedSurfaces.slice(4),
  ]);
  const issues = alerts(page);
  await expect(issues).toContainText('Operation 5');
  await expect(issues).toContainText('This operation is not an object.');
  await expect(issues).toContainText('Operation 6');
  await expect(issues).toContainText('This operation declares version v0.8.');
  await expect(issues).toContainText('Operation 7');
  await expect(issues).toContainText('surfaceUpdate.components');
  await expect(issues).toContainText('Operation 8');
  await expect(issues).toContainText('A2UI Protocol message must have exactly one of');
  await expect(page.locator('[data-surface]')).toHaveCount(4);
  await issues.getByText('As received').nth(1).click();
  await expect(page.getByRole('region', { name: 'Received operation 6' })).toContainText('"version": "v0.8"');
});

test('two bad entries are exactly two reports', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, [...mixedSurfaces, 7, { nonsense: true }]);
  await expect(alerts(page).locator('> div')).toHaveCount(2);
  await expect(page.locator('[data-surface]')).toHaveCount(4);
});

test('a message the v0.8 renderer cannot build is reported at its position, and the other surfaces survive', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, [
    ...formSurface,
    { surfaceUpdate: { surfaceId: 'loop', components: [{ id: 'root', component: { Column: { children: { explicitList: ['inner'] } } } }, { id: 'inner', component: { Column: { children: { explicitList: ['root'] } } } }] } },
    { beginRendering: { surfaceId: 'loop', root: 'root' } },
  ]);
  await expect(alerts(page)).toContainText('Operation 5');
  await expect(alerts(page)).toContainText('Circular dependency');
  await expect(surface(page, 'form')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
});

test('typed text in a v0.9 surface survives an appended v0.8 tail', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, formSurface);
  await page.getByRole('textbox', { name: 'Note' }).fill('keep me');
  await feed(page, [...formSurface, ...v08Surfaces]);
  await expect(surface(page, 'expense')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('keep me');
  await page.getByRole('textbox', { name: 'Amount' }).fill('keep me too');
  await feed(page, [...formSurface, ...v08Surfaces, { version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/count', value: 7 } }]);
  await expect(page.getByRole('textbox', { name: 'Amount' })).toHaveValue('keep me too');
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('keep me');
});

// ---- US3: aliases -------------------------------------------------------------------------------------------

const FORMER = 'https://catalog.invalid/old/basic.json';
const FORMER_V08 = 'https://catalog.invalid/old/standard.json';
const withCatalog = (operations: readonly Record<string, unknown>[], catalogId: string) =>
  operations.map((operation) => {
    const { createSurface } = operation as { createSurface?: Record<string, unknown> };
    return createSurface === undefined ? operation : { ...operation, createSurface: { ...createSurface, catalogId } };
  });

test('a configured alias draws a v0.9 and a v0.8 surface, and the JSON view still shows the id the agent sent', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await page.evaluate((aliases) => window.__a2ui.aliases(aliases), { [FORMER]: BASIC_CATALOG_ID, [FORMER_V08]: STANDARD_V08_CATALOG_ID });
  const operations = [...withCatalog(formSurface, FORMER), ...single('old8', [{ id: 'root', component: { Column: { children: { explicitList: ['hello'] } } } }, text('hello', 'Hello from the alias')], FORMER_V08)];
  await feed(page, operations);

  await expect(alerts(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
  await expect(page.getByText('Hello from the alias')).toBeVisible();

  await page.evaluate(() => window.__a2ui.render(false));
  const shown = JSON.parse((await page.getByLabel('Operations of a2ui-surface-1').textContent()) ?? 'null') as unknown;
  expect(shown).toEqual(operations);
});

test('without the alias the same ids are "Catalog not found" with the entry as received, and nothing is drawn for them', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, [...withCatalog(formSurface, FORMER), ...single('old8', [{ id: 'root', component: { Column: { children: { explicitList: ['hello'] } } } }, text('hello', 'Hello')], FORMER_V08)]);
  await expect(alerts(page)).toContainText(`Catalog not found: ${FORMER}`);
  await expect(alerts(page)).toContainText(`Catalog not found: ${FORMER_V08}`);
  await expect(page.locator('[data-surface="old8"]')).toHaveCount(0);
  await alerts(page).getByText('As received').first().click();
  await expect(page.getByRole('region', { name: 'Received operation 1' })).toContainText(FORMER);
});

test('an alias of one version does not serve the other, and near misses are not aliases', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await page.evaluate((aliases) => window.__a2ui.aliases(aliases), { [FORMER]: BASIC_CATALOG_ID });
  await feed(page, [
    ...single('a', [{ id: 'root', component: { Column: { children: { explicitList: [] } } } }], FORMER),
    ...single('b', [{ id: 'root', component: { Column: { children: { explicitList: [] } } } }], `${FORMER}/`),
  ]);
  await expect(alerts(page)).toContainText(`Catalog not found: ${FORMER}`);
  await expect(alerts(page)).toContainText(`Catalog not found: ${FORMER}/`);
  await expect(page.locator('[data-surface]')).toHaveCount(0);
});

test('the middleware default id and a v0.8 surface with no catalog id both still draw with no config', async ({ page, site }) => {
  await open(page, site, { strict: true });
  await feed(page, [...withCatalog(formSurface, 'https://a2ui.org/specification/v0_9/basic_catalog.json'), ...single('plain8', [{ id: 'root', component: { Column: { children: { explicitList: ['hello'] } } } }, text('hello', 'No catalog named')])]);
  await expect(alerts(page)).toHaveCount(0);
  await expect(page.getByText('No catalog named')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
});
