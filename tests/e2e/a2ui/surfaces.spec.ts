// L05 T042 (FR-020, FR-025, FR-037; US3.4): A2UI v0.9 surfaces in a real browser, through the real
// renderer, offline. The fixture host feeds the scripted scenarios to the A2UI view and records the
// action callback; a scripted continuation answers it (L02's runtime is not involved). Every check is
// about what a user sees and what the callback received: the data round trip, live updates, JSON-only
// mode, keyboard operation, and zero requests outside the page's own origin.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Page } from '@playwright/test';
import {
  BASIC_CATALOG_ID,
  deleteForm,
  externalResources,
  formSurface,
  malformedOperations,
  secondSurface,
  THIRD_PARTY_HOST,
} from '../../../examples/reference-agent/a2ui-scenarios.ts';
import { bundleOptions } from '../../../scripts/build.mjs';

/** The script API packages/inspector/tests/a2ui/fixture.tsx puts on window, as far as this spec uses it. */
declare global {
  interface Window {
    __a2ui: {
      set(operations: unknown): void;
      render(enabled: boolean): void;
      continueWith(on: boolean): void;
      actions(): Array<{ name: string; surfaceId: string; sourceComponentId: string; context: unknown; timestamp: string }>;
      control(operations: unknown): void;
    };
  }
}

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const OVERRIDE = ':root { --agui-radius: 22px; }';

interface Site {
  origin: string;
}

const test = base.extend<object, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'a2ui-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'a2ui', 'fixture.tsx') },
      });
      // No img-src, media-src or connect-src: the page's CSP must not be what stops a third-party request.
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>a2ui fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
        '/override.css': ['text/css', OVERRIDE],
      };
      const server: Server = createServer((request, response) => {
        const hit = files[new URL(request.url ?? '/', 'http://x').pathname];
        response.writeHead(hit ? 200 : 404, { 'content-type': hit?.[0] ?? 'text/plain' });
        response.end(hit?.[1] ?? 'not found');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

async function open(page: Page, site: Site): Promise<void> {
  await page.goto(site.origin);
  await page.waitForFunction(() => '__a2ui' in window);
}

const feed = (page: Page, operations: unknown) => page.evaluate((list) => window.__a2ui.set(list), operations);
const actions = (page: Page) => page.evaluate(() => window.__a2ui.actions());
const view = (page: Page) => page.locator('[data-view="a2ui"]');

test('a v0.9 surface renders through the official renderer and its controls work', async ({ page, site }) => {
  await open(page, site);
  await feed(page, formSurface);

  await expect(view(page)).toHaveAttribute('data-status', 'rendered');
  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('first draft');
  await expect(page.getByRole('button', { name: 'Send note' })).toBeEnabled();
  expect(await actions(page)).toEqual([]);
});

test('activating a control calls back with name, surface, component, resolved context and the renderer timestamp', async ({ page, site }) => {
  await open(page, site);
  await feed(page, formSurface);
  await page.getByRole('textbox', { name: 'Note' }).fill('edited by hand');
  const before = Date.now();
  await page.getByRole('button', { name: 'Send note' }).click();

  const [action, ...rest] = await actions(page);
  expect(rest).toEqual([]);
  expect(Object.keys(action!).sort()).toEqual(['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  expect(action).toMatchObject({
    name: 'send_note',
    surfaceId: 'form',
    sourceComponentId: 'send',
    context: { note: 'edited by hand', count: 1 },
  });
  expect(Date.parse(action!.timestamp)).toBeGreaterThanOrEqual(before - 1000);
  expect(Date.parse(action!.timestamp)).toBeLessThanOrEqual(Date.now() + 1000);
  expect(new Date(action!.timestamp).toISOString()).toBe(action!.timestamp);
});

test('a scripted continuation round-trips the envelope and updates the surface without losing what was typed', async ({ page, site }) => {
  await open(page, site);
  await page.evaluate(() => window.__a2ui.continueWith(true));
  await feed(page, formSurface);
  await page.getByRole('textbox', { name: 'Note' }).fill('keep me');
  await page.getByRole('button', { name: 'Send note' }).click();

  await expect(page.getByText('Received send_note from send on form: {"note":"keep me","count":1}')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('keep me');
  await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();

  // The continuation set count to 2; the next action carries the new data, not the old.
  await page.getByRole('button', { name: 'Send note' }).click();
  expect((await actions(page)).map((action) => action.context)).toEqual([
    { note: 'keep me', count: 1 },
    { note: 'keep me', count: 2 },
  ]);
});

test('surfaces come and go as operations are added and deleted', async ({ page, site }) => {
  await open(page, site);
  await feed(page, formSurface);
  await expect(page.locator('[data-surface]')).toHaveCount(1);

  await feed(page, [...formSurface, ...secondSurface]);
  await expect(page.locator('[data-surface]')).toHaveCount(2);
  await expect(page.getByText('Second surface')).toBeVisible();

  await feed(page, [...formSurface, ...secondSurface, deleteForm]);
  await expect(page.locator('[data-surface]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Order check' })).toHaveCount(0);
  await expect(page.getByText('Second surface')).toBeVisible();
});

test('a rewritten earlier operation (a delta) redraws the surface from the operations as they now stand', async ({ page, site }) => {
  await open(page, site);
  await feed(page, formSurface);
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('first draft');

  const rewritten = JSON.parse(JSON.stringify(formSurface));
  rewritten[2].updateDataModel.value.note = 'from a delta';
  await feed(page, rewritten);
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('from a delta');
});

test('with rendering off the operations stay JSON; turning it on again renders them', async ({ page, site }) => {
  await open(page, site);
  await page.evaluate(() => window.__a2ui.render(false));
  await feed(page, formSurface);

  await expect(view(page)).toHaveAttribute('data-status', 'json-only');
  await expect(page.getByRole('region', { name: 'Operations of a2ui-surface-1', exact: true })).toContainText('"send_note"');
  await expect(page.getByRole('region', { name: 'Operations of a2ui-surface-1', exact: true })).toContainText(BASIC_CATALOG_ID);
  await expect(page.getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);

  await page.evaluate(() => window.__a2ui.render(true));
  await expect(page.getByRole('button', { name: 'Send note' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Operations of a2ui-surface-1', exact: true })).toHaveCount(0);
  expect(await actions(page)).toEqual([]);
});

test('the surface works from the keyboard: Tab reaches the control, Enter and Space activate it', async ({ page, site }) => {
  await open(page, site);
  await feed(page, formSurface);
  await page.getByRole('textbox', { name: 'Note' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Send note' })).toBeFocused();
  // The focus ring is visible, not removed.
  expect(await page.getByRole('button', { name: 'Send note' }).evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');

  await page.keyboard.press('Enter');
  expect(await actions(page)).toHaveLength(1);
  await page.keyboard.press('Space');
  expect(await actions(page)).toHaveLength(2);
  expect((await actions(page)).every((action) => action.name === 'send_note')).toBe(true);
});

test('malformed operations are reported with their position and the valid ones still render', async ({ page, site }) => {
  await open(page, site);
  await feed(page, malformedOperations);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Operation 2');
  await expect(alert).toContainText('not an object');
  await expect(alert).toContainText('Operation 3');
  await expect(alert).toContainText('no version');
  await expect(alert).toContainText('Operation 4');
  await expect(alert).toContainText('Only A2UI v0.9 is supported');
  await expect(alert).toContainText('Operation 5');
  await expect(alert).toContainText('Catalog not found');
  await expect(alert).toContainText('Operation 6');
  await expect(alert).toContainText('ghost');
  await expect(page.getByText('Survivor')).toBeVisible();

  // The entry as received is one click away.
  await alert.getByText('As received').first().click();
  await expect(page.getByRole('region', { name: 'Received operation 2' })).toContainText('not an object');
});

test('an unknown component is shown by the renderer and a non-list is a visible error', async ({ page, site }) => {
  await open(page, site);
  await feed(page, [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: BASIC_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Hologram' }] } },
  ]);
  await expect(page.getByText('Unknown component type: Hologram')).toBeVisible();

  await feed(page, { a2ui_operations: [] });
  await expect(page.getByRole('alert')).toContainText('not a list');
  await expect(page.locator('[data-surface]')).toHaveCount(0);
});

test('a surface that reaches outside the page loads nothing and opens nothing; the address is shown as text', async ({ page, site }) => {
  const requests: string[] = [];
  const popups: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('popup', (popup) => popups.push(popup.url()));
  await open(page, site);
  await feed(page, externalResources);

  const surface = page.locator('[data-surface="media"]');
  await expect(surface.locator('[data-blocked="Image"]')).toContainText(`http://${THIRD_PARTY_HOST}/picture.png`);
  await expect(surface.locator('[data-blocked="Video"]')).toContainText(`http://${THIRD_PARTY_HOST}/clip.mp4`);
  await expect(surface.locator('[data-blocked="AudioPlayer"]')).toContainText(`http://${THIRD_PARTY_HOST}/sound.mp3`);
  await expect(surface.locator('img, video, audio, iframe')).toHaveCount(0);

  await surface.getByRole('button', { name: 'Open page' }).click();
  await expect(page.getByRole('alert')).toContainText(`Blocked openUrl http://${THIRD_PARTY_HOST}/page`);
  await page.waitForTimeout(300);

  expect(popups).toEqual([]);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  expect(await actions(page)).toEqual([]);
});

test('control: the official renderer with its stock catalog does request the third-party address', async ({ page, site }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await open(page, site);
  await page.evaluate((operations) => window.__a2ui.control(operations), externalResources);
  await expect.poll(() => requests.some((url) => url.includes(THIRD_PARTY_HOST))).toBe(true);
});

test('the page requests nothing outside its own origin and raises no console errors across a whole session', async ({ page, site }) => {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  await open(page, site);
  await page.evaluate(() => window.__a2ui.continueWith(true));
  await feed(page, formSurface);
  await page.getByRole('button', { name: 'Send note' }).click();
  await feed(page, [...formSurface, ...secondSurface]);
  await page.evaluate(() => window.__a2ui.render(false));
  await page.evaluate(() => window.__a2ui.render(true));
  await feed(page, malformedOperations);
  await feed(page, externalResources);
  await page.waitForTimeout(300);

  expect(requests.length).toBeGreaterThan(0);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  expect(problems).toEqual([]);
});

test('surfaces follow the theme tokens: an overridden radius reaches the renderer controls', async ({ page, site }) => {
  await open(page, site);
  await feed(page, formSurface);
  const field = page.getByRole('textbox', { name: 'Note' });
  const before = await field.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
  await page.addStyleTag({ url: `${site.origin}/override.css` });
  await expect.poll(() => field.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).not.toBe(before);
  expect(await field.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe('15.4px');
});

// D03 T063 (FR-020, US3.4): the bundled catalog answers to the renderer's basic catalog id and to
// middleware 0.0.11's default catalog id. Both render and round-trip an action offline, with the
// operations as received; any other id stays a visible error.
const MIDDLEWARE_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

/** The same scenario addressed to another catalog id; only the id differs. */
const addressedTo = (operations: readonly Record<string, unknown>[], catalogId: string) =>
  operations.map((operation) => {
    const { createSurface } = operation as { createSurface?: Record<string, unknown> };
    return createSurface === undefined ? operation : { ...operation, createSurface: { ...createSurface, catalogId } };
  });

for (const [label, catalogId] of [
  ['renderer basic catalog id', BASIC_CATALOG_ID],
  ['middleware 0.0.11 default catalog id', MIDDLEWARE_CATALOG_ID],
] as const) {
  test(`the ${label} renders, calls back and round-trips offline`, async ({ page, site }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page, site);
    await page.evaluate(() => window.__a2ui.continueWith(true));
    const operations = addressedTo(formSurface, catalogId);
    await feed(page, operations);

    await expect(view(page)).toHaveAttribute('data-status', 'rendered');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Order check' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Note' }).fill('via ' + label);
    await page.getByRole('button', { name: 'Send note' }).click();

    const [action, ...rest] = await actions(page);
    expect(rest).toEqual([]);
    expect(action).toMatchObject({ name: 'send_note', surfaceId: 'form', sourceComponentId: 'send', context: { note: 'via ' + label, count: 1 } });
    await expect(page.getByText(`Received send_note from send on form: {"note":"via ${label}","count":1}`)).toBeVisible();

    await page.waitForTimeout(300);
    expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
    expect(requests.filter((url) => /catalog|a2ui\.org/.test(url))).toEqual([]);
  });

  test(`the ${label} keeps blocking what reaches outside the page`, async ({ page, site }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page, site);
    await feed(page, addressedTo(externalResources, catalogId));

    const surface = page.locator('[data-surface="media"]');
    await expect(surface.locator('[data-blocked="Image"]')).toContainText(THIRD_PARTY_HOST);
    await expect(surface.locator('img, video, audio, iframe')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  });
}

test('both catalog ids stay in the JSON view exactly as received when rendering is off', async ({ page, site }) => {
  await open(page, site);
  await page.evaluate(() => window.__a2ui.render(false));
  await feed(page, addressedTo(formSurface, MIDDLEWARE_CATALOG_ID));
  await expect(page.getByRole('region', { name: 'Operations of a2ui-surface-1', exact: true })).toContainText(MIDDLEWARE_CATALOG_ID);
  await expect(page.getByRole('region', { name: 'Operations of a2ui-surface-1', exact: true })).not.toContainText(BASIC_CATALOG_ID);
});

test('an unsupported catalog id is still a visible error, never a fetch or a silent alias', async ({ page, site }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await open(page, site);
  for (const unknown of [`${MIDDLEWARE_CATALOG_ID}/`, 'https://a2ui.org/specification/v0_8/basic_catalog.json', 'https://catalog.invalid/custom.json']) {
    await feed(page, addressedTo(formSurface, unknown));
    await expect(page.getByRole('alert')).toContainText('Catalog not found');
    await expect(page.getByRole('alert')).toContainText(unknown);
    await expect(page.locator('[data-surface]')).toHaveCount(0);
  }
  await page.waitForTimeout(300);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
});
