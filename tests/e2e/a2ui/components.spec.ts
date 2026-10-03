// FX11 (FR-020, FR-025, FR-037): the A2UI render audit. One gallery of the v0.9 basic catalog
// (packages/inspector/tests/a2ui/gallery.ts) goes through the real renderer in Chromium, and every check
// is about what a user can see, reach with the keyboard and send back: each component draws with a role
// and a name, Tabs and Modal behave, inputs bind to the data model and the action context carries the
// bound values, a failing check disables its button, the format functions show their output, and a
// surface that is still being generated says so. Screenshots of the gallery in both themes go to
// .build/a2ui-gallery (not committed).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { galleryOperations, inputsSurface } from '../../../packages/inspector/tests/a2ui/gallery.ts';
import { actions, feed, open, test, view } from './support.ts';

const shots = path.resolve(import.meta.dirname, '..', '..', '..', '.build', 'a2ui-gallery');
const surface = (page: Page, id: string) => page.locator(`[data-surface="${id}"]`);
const lifecycle = (page: Page, content: unknown) => page.evaluate((value) => window.__a2ui.activity(value), content);

async function gallery(page: Page, site: { origin: string }): Promise<void> {
  await open(page, site);
  await feed(page, galleryOperations);
  await expect(view(page)).toHaveAttribute('data-status', 'rendered');
  await expect(page.locator('[data-surface]')).toHaveCount(3);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('every component of the gallery draws with a role and a name, and nothing is reported as an error', async ({ page, site }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  await gallery(page, site);
  const layout = surface(page, 'layout');
  const inputs = surface(page, 'inputs');

  // Text, every variant, as real headings (renderer behaviour) and plain text.
  for (const [level, name] of [[1, 'Heading one'], [2, 'Heading two'], [3, 'Heading three'], [4, 'Heading four'], [5, 'Heading five']] as const) {
    await expect(layout.getByRole('heading', { name, level })).toBeVisible();
  }
  await expect(layout.getByText('Body text sits at the base size')).toBeVisible();
  await expect(layout.getByText('Caption text is smaller and muted')).toBeVisible();

  // Icon, Row, Column, Divider, List, Card.
  await expect(layout.getByRole('img', { name: 'home' })).toBeVisible();
  await expect(layout.getByRole('button', { name: 'Row action' })).toBeVisible();
  await expect(page.getByRole('separator')).toHaveCount(3);
  await expect(layout.locator('[role="separator"][aria-orientation="vertical"]')).toHaveCount(1);
  expect(await layout.locator('[role="separator"][aria-orientation="vertical"]').evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(10);
  for (const title of ['Record the run', 'Read the frames', 'Export the session']) await expect(layout.getByText(title, { exact: true })).toBeVisible();
  for (const state of ['done', 'in progress', 'to do']) await expect(layout.getByText(state, { exact: true })).toBeVisible();
  for (const tag of ['protocol', 'ui', 'tools', 'state']) await expect(layout.getByText(tag, { exact: true })).toBeVisible();
  const card = layout.locator('.a2ui-card').first();
  expect(await card.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('1px');
  expect(await card.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop))).toBeGreaterThan(8);
  expect(await card.evaluate((element) => getComputedStyle(element).marginTop)).toBe('0px');

  // Tabs, Modal trigger, media (blocked by design), Button variants.
  await expect(layout.getByRole('tablist')).toBeVisible();
  await expect(layout.getByRole('tab')).toHaveCount(3);
  await expect(layout.getByRole('tabpanel')).toBeVisible();
  await expect(layout.getByRole('button', { name: 'Open the dialog' })).toBeVisible();
  for (const kind of ['Image', 'Video', 'AudioPlayer']) await expect(layout.locator(`[data-blocked="${kind}"]`)).toHaveAttribute('role', 'note');
  await expect(layout.locator('img, video, audio, iframe')).toHaveCount(0);
  for (const [name, variant] of [['Default', 'default'], ['Primary', 'primary'], ['Borderless', 'borderless']] as const) {
    await expect(inputs.getByRole('button', { name, exact: true })).toHaveAttribute('data-variant', variant);
  }

  // TextField (short, long, number, obscured), CheckBox, ChoicePicker (single and chips), Slider, DateTimeInput.
  await expect(inputs.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada');
  await expect(inputs.getByRole('textbox', { name: 'Bio' })).toHaveValue('Writes the first program\nand the notes on it.');
  expect(await inputs.getByRole('textbox', { name: 'Bio' }).evaluate((element) => element.tagName)).toBe('TEXTAREA');
  await expect(inputs.getByRole('spinbutton', { name: 'Seats' })).toHaveValue('2');
  await expect(inputs.getByLabel('Passphrase')).toHaveAttribute('type', 'password');
  await expect(inputs.getByRole('checkbox', { name: 'Send me the newsletter' })).not.toBeChecked();
  await expect(inputs.getByRole('group', { name: 'Plan' }).getByRole('radio')).toHaveCount(3);
  await expect(inputs.getByRole('radio', { name: 'Pro' })).toBeChecked();
  await expect(inputs.getByRole('group', { name: 'Topics' }).getByRole('button')).toHaveCount(4);
  await expect(inputs.getByRole('button', { name: 'Protocol' })).toHaveAttribute('aria-pressed', 'true');
  await expect(inputs.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-pressed', 'false');
  await expect(inputs.getByRole('slider', { name: 'Budget' })).toHaveValue('40');
  await expect(inputs.getByText('40', { exact: true })).toBeVisible();
  await expect(inputs.getByLabel('Day', { exact: true })).toHaveValue('2026-10-03');
  await expect(inputs.getByLabel('Time', { exact: true })).toHaveValue('14:30');
  await expect(inputs.getByLabel('Moment', { exact: true })).toHaveValue('2026-10-03T14:30');

  expect(problems).toEqual([]);
});

test('Tabs select on click and on the arrow keys, with one tab stop and a labelled panel', async ({ page, site }) => {
  await gallery(page, site);
  const overview = page.getByRole('tab', { name: 'Overview' });
  const frames = page.getByRole('tab', { name: 'Frames' });
  const raw = page.getByRole('tab', { name: 'Raw' });
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Overview' })).toHaveText('The overview tab is selected first.');
  await expect(overview).toHaveAttribute('tabindex', '0');
  await expect(frames).toHaveAttribute('tabindex', '-1');

  await frames.click();
  await expect(frames).toHaveAttribute('aria-selected', 'true');
  await expect(overview).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByRole('tabpanel', { name: 'Frames' })).toHaveText('Frames arrive in order.');

  await page.keyboard.press('ArrowRight');
  await expect(raw).toBeFocused();
  await expect(raw).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toHaveText('Raw bytes stay untouched.');
  await page.keyboard.press('ArrowRight');
  await expect(overview).toBeFocused();
  await page.keyboard.press('End');
  await expect(raw).toBeFocused();
  await page.keyboard.press('Home');
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(raw).toBeFocused();
});

test('Modal opens from the keyboard, keeps focus inside, closes with Escape or Close and returns focus', async ({ page, site }) => {
  await gallery(page, site);
  const trigger = page.getByRole('button', { name: 'Open the dialog' });
  const dialog = page.getByRole('dialog', { name: 'Dialog' });
  await expect(dialog).toHaveCount(0);

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Dialog title' })).toBeVisible();
  await expect(dialog.getByText('The dialog content is any component.')).toBeVisible();
  // The trigger is a Button and keeps its own action; opening is local.
  expect((await actions(page)).map((action) => action.name)).toEqual(['open_dialog']);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

  // The page behind is inert: Tab cycles through the dialog (and the browser's own chrome), never the page.
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement?.closest('dialog') != null)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // The backdrop closes it too, and a control inside still works.
  await trigger.click();
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  expect((await actions(page)).map((action) => action.name)).toEqual(['open_dialog', 'open_dialog', 'open_dialog', 'dialog_confirm']);
  await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0);
});

test('a Row wraps instead of overflowing a narrow pane, and nothing scrolls sideways', async ({ page, site }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await gallery(page, site);
  const tops = await page.locator('[data-surface="layout"] [class="agui-a2ui-row"]').nth(2).evaluate((row) => [...row.children].map((child) => Math.round(child.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('inputs bind to the data model: the action context carries the initial values, then what the user entered', async ({ page, site }) => {
  await gallery(page, site);
  const inputs = surface(page, 'inputs');
  const send = inputs.getByRole('button', { name: 'Send preferences' });

  await send.click();
  expect((await actions(page))[0]).toMatchObject({
    name: 'save_preferences',
    surfaceId: 'inputs',
    sourceComponentId: 'submit',
    context: {
      name: 'Ada',
      bio: 'Writes the first program\nand the notes on it.',
      seats: 2,
      newsletter: false,
      plan: ['pro'],
      topics: ['protocol'],
      budget: 40,
      day: '2026-10-03',
      time: '14:30',
      moment: '2026-10-03T14:30',
    },
  });

  await inputs.getByRole('textbox', { name: 'Name' }).fill('Grace');
  await inputs.getByRole('textbox', { name: 'Bio' }).fill('Compiler pioneer');
  await inputs.getByRole('spinbutton', { name: 'Seats' }).fill('3');
  await inputs.getByRole('checkbox', { name: 'Send me the newsletter' }).check();
  await inputs.getByRole('radio', { name: 'Team' }).check();
  await inputs.getByRole('button', { name: 'State' }).click();
  await inputs.getByRole('slider', { name: 'Budget' }).focus();
  await page.keyboard.press('End');
  await inputs.getByLabel('Day', { exact: true }).fill('2026-12-25');
  await inputs.getByLabel('Time', { exact: true }).fill('09:15');
  await inputs.getByLabel('Moment', { exact: true }).fill('2026-12-25T09:15');
  await expect(inputs.getByText('100', { exact: true })).toBeVisible();
  await send.click();

  const all = await actions(page);
  expect(all).toHaveLength(2);
  // A number field edits the data model as text, as the official renderer does.
  expect(all[1]!.context).toEqual({
    name: 'Grace',
    bio: 'Compiler pioneer',
    seats: '3',
    newsletter: true,
    plan: ['team'],
    topics: ['protocol', 'state'],
    budget: 100,
    day: '2026-12-25',
    time: '09:15',
    moment: '2026-12-25T09:15',
  });
});

test('the keyboard drives the pickers: arrows move a radio selection, Space toggles a chip and a checkbox', async ({ page, site }) => {
  await gallery(page, site);
  const inputs = surface(page, 'inputs');
  await inputs.getByRole('radio', { name: 'Pro' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(inputs.getByRole('radio', { name: 'Team' })).toBeChecked();
  await expect(inputs.getByRole('radio', { name: 'Pro' })).not.toBeChecked();

  const tools = inputs.getByRole('button', { name: 'Tools' });
  await tools.focus();
  await page.keyboard.press('Space');
  await expect(tools).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(tools).toHaveAttribute('aria-pressed', 'false');

  const news = inputs.getByRole('checkbox', { name: 'Send me the newsletter' });
  await news.focus();
  await page.keyboard.press('Space');
  await expect(news).toBeChecked();

  await inputs.getByRole('button', { name: 'Send preferences' }).click();
  expect((await actions(page))[0]!.context).toMatchObject({ plan: ['team'], topics: ['protocol'], newsletter: true });
});

test('a Button with a failing check is disabled and says why; it enables when the form is right and disables again when it is not', async ({ page, site }) => {
  await gallery(page, site);
  const form = surface(page, 'functions');
  const register = form.getByRole('button', { name: 'Register' });
  const reason = 'Accept the terms and fix the fields above';

  await expect(register).toBeDisabled();
  await expect(register).toHaveAccessibleDescription(reason);
  await expect(form.getByText(reason)).toBeVisible();
  // required, email and length each report their own message beside the field.
  await expect(form.getByRole('textbox', { name: 'Email' })).toHaveAccessibleDescription('Enter a valid email address');
  await expect(form.getByRole('textbox', { name: 'Invite code' })).toHaveAccessibleDescription('Use 4 to 8 characters');
  await form.getByRole('textbox', { name: 'Email' }).fill('');
  await expect(form.getByText('Email is required')).toBeVisible();

  await form.getByRole('textbox', { name: 'Email' }).fill('ada@lovelace.dev');
  await expect(form.getByText('Enter a valid email address')).toHaveCount(0);
  await expect(form.getByRole('textbox', { name: 'Email' })).not.toHaveAttribute('aria-invalid', 'true');
  await form.getByRole('textbox', { name: 'Invite code' }).fill('ADA1');
  await expect(register).toBeDisabled();
  await form.getByRole('checkbox', { name: 'I accept the terms' }).check();
  await expect(register).toBeEnabled();
  await expect(form.getByText(reason)).toHaveCount(0);

  await register.click();
  expect((await actions(page)).map((action) => [action.name, action.context])).toEqual([['register', { email: 'ada@lovelace.dev', code: 'ADA1' }]]);

  // regex and not(...) fail on lower case; the button follows.
  await form.getByRole('textbox', { name: 'Invite code' }).fill('ada1');
  await expect(form.getByText('Capital letters and digits only')).toBeVisible();
  await expect(register).toBeDisabled();
  await form.getByRole('textbox', { name: 'Invite code' }).fill('ADA12345678');
  await expect(form.getByText('Use 4 to 8 characters')).toBeVisible();
  await expect(register).toBeDisabled();
  await form.getByRole('checkbox', { name: 'I accept the terms' }).uncheck();
  await form.getByRole('textbox', { name: 'Invite code' }).fill('ADA1');
  await expect(register).toBeDisabled();
});

test('formatString, formatNumber, formatCurrency, formatDate and pluralize draw their output and follow the data model', async ({ page, site }) => {
  await gallery(page, site);
  const form = surface(page, 'functions');
  await expect(form.getByText('Hello Ada, you are number 1.')).toBeVisible();
  await expect(form.getByText('1,234.5', { exact: true })).toBeVisible();
  await expect(form.getByText('$1,234.50')).toBeVisible();
  await expect(form.getByText('Saturday, October 3, 2026')).toBeVisible();
  await expect(form.getByText('3 seats booked')).toBeVisible();

  // The same surface, with appended updates: the numbers and the plural form change in place.
  const update = (path: string, value: unknown) => ({ version: 'v0.9', updateDataModel: { surfaceId: 'functions', path, value } });
  await feed(page, [...galleryOperations, update('/order/count', 1), update('/order/total', 99), update('/order/when', '2027-01-02T00:00:00Z'), update('/user/name', 'Grace')]);
  await expect(form.getByText('1 seat booked')).toBeVisible();
  await expect(form.getByText('99.0', { exact: true })).toBeVisible();
  await expect(form.getByText('$99.00')).toBeVisible();
  await expect(form.getByText('Saturday, January 2, 2027')).toBeVisible();
  await expect(form.getByText('Hello Grace, you are number 1.')).toBeVisible();
});

test('a surface that is still being generated says so: building, retrying and failed look and read differently', async ({ page, site }) => {
  await open(page, site);
  const errors = [{ code: 'unresolved_child', path: 'components[2].children[0]', message: "Child 'ghost' does not exist" }];

  await lifecycle(page, { status: 'building', progressTokens: 120 });
  await expect(view(page)).toHaveAttribute('data-status', 'building');
  await expect(page.getByRole('status')).toContainText('Building');
  await expect(page.getByRole('status')).toContainText('about 120 tokens so far');
  await expect(page.getByText('No A2UI operations yet.')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await lifecycle(page, { status: 'retrying', attempt: 2, maxAttempts: 3, errors });
  await expect(view(page)).toHaveAttribute('data-status', 'retrying');
  await expect(page.getByRole('status')).toContainText('Retrying');
  await expect(page.getByRole('status')).toContainText('Attempt 2 of 3');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText("components[2].children[0]: Child 'ghost' does not exist")).toBeHidden();
  await page.getByText('Validation errors (1)').click();
  await expect(page.getByText("components[2].children[0]: Child 'ghost' does not exist")).toBeVisible();

  const attempts = [1, 2, 3].map((attempt) => ({ attempt, ok: false, errors }));
  await lifecycle(page, { status: 'failed', error: 'The generated UI failed validation', attempts, maxAttempts: 3 });
  await expect(view(page)).toHaveAttribute('data-status', 'failed');
  await expect(page.getByRole('alert')).toContainText('Failed');
  await expect(page.getByRole('alert')).toContainText('The generated UI failed validation');
  await expect(page.getByRole('alert')).toContainText('3 of 3 attempts used');
  await expect(page.getByText('Validation errors (3)')).toBeVisible();
  const failed = await page.locator('.agui-finding').evaluate((element) => getComputedStyle(element).backgroundColor);
  await lifecycle(page, { status: 'retrying', attempt: 1, maxAttempts: 3, errors: [] });
  expect(await page.locator('.agui-finding').evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(failed);

  // The server's debugExposure decides how much error detail shows.
  await lifecycle(page, { status: 'failed', error: 'x', attempts, maxAttempts: 3, debugExposure: 'hidden' });
  await expect(page.getByText(/Validation errors/)).toHaveCount(0);
  await lifecycle(page, { status: 'failed', error: 'x', attempts, maxAttempts: 3, debugExposure: 'verbose' });
  await expect(page.getByText("Attempt 1 · components[2].children[0]: Child 'ghost' does not exist")).toBeVisible();

  // The painted surface replaces the lifecycle under the same id.
  await lifecycle(page, { a2ui_operations: inputsSurface });
  await expect(view(page)).toHaveAttribute('data-status', 'rendered');
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Ada');
  // Unknown statuses and content without either keep the plain note.
  await lifecycle(page, { status: 'cooking' });
  await expect(view(page)).toHaveAttribute('data-status', 'empty');
  await expect(page.getByText('No A2UI operations yet.')).toBeVisible();
});

test('the gallery follows the theme tokens in both themes: an accent override reaches buttons, chips and tabs', async ({ page, site }) => {
  await gallery(page, site);
  await page.addStyleTag({ content: '*, ::before, ::after { transition: none !important; }' });
  const inputs = surface(page, 'inputs');
  const primary = inputs.getByRole('button', { name: 'Primary', exact: true });
  const chip = inputs.getByRole('button', { name: 'Protocol' });
  const tab = page.getByRole('tab', { name: 'Overview' });
  const paint = () =>
    Promise.all([
      primary.evaluate((element) => getComputedStyle(element).backgroundColor),
      chip.evaluate((element) => getComputedStyle(element).borderTopColor),
      tab.evaluate((element) => getComputedStyle(element).borderBottomColor),
    ]);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => (document.documentElement.dataset['theme'] = value), theme);
    const before = await paint();
    await page.addStyleTag({ content: ':root { --agui-accent: oklch(0.55 0.2 262); --agui-accent-contrast: oklch(0.99 0 0); }' });
    const after = await paint();
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[2]).not.toBe(before[2]);
    await page.evaluate(() => document.head.lastElementChild?.remove());
  }
});

test('the whole gallery session requests nothing outside the page and opens no popup', async ({ page, site }) => {
  const requests: string[] = [];
  const popups: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('popup', (popup) => popups.push(popup.url()));
  await gallery(page, site);
  await page.getByRole('button', { name: 'Open the dialog' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  expect(popups).toEqual([]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`screenshots of the gallery, the dialog and the lifecycle states (${scheme})`, async ({ page, site }) => {
    mkdirSync(shots, { recursive: true });
    await page.setViewportSize({ width: 760, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await gallery(page, site);
    await page.screenshot({ path: path.join(shots, `gallery-${scheme}.png`), fullPage: true });

    await page.getByRole('tab', { name: 'Frames' }).click();
    await page.getByRole('button', { name: 'Open the dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.screenshot({ path: path.join(shots, `dialog-${scheme}.png`) });
    await page.keyboard.press('Escape');

    const errors = [{ path: 'components[2].children[0]', message: "Child 'ghost' does not exist" }];
    const attempts = [1, 2, 3].map((attempt) => ({ attempt, ok: false, errors }));
    for (const [name, content] of [
      ['building', { status: 'building', progressTokens: 120 }],
      ['retrying', { status: 'retrying', attempt: 2, maxAttempts: 3, errors, debugExposure: 'verbose' }],
      ['failed', { status: 'failed', error: 'The generated UI failed validation', attempts, maxAttempts: 3, debugExposure: 'verbose' }],
    ] as const) {
      await lifecycle(page, content);
      await expect(view(page)).toHaveAttribute('data-status', name);
      await view(page).screenshot({ path: path.join(shots, `lifecycle-${name}-${scheme}.png`) });
    }
  });
}
