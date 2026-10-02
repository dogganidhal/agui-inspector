// F06 T054 (FR-037, FR-041, SC-010): the theme and primitives in a real browser. The fixture page
// renders every primitive and state; overrides are a stylesheet loaded after the inspector's own,
// which is how every candidate delivery mechanism (G-09, undecided) reduces.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const overridesDir = path.join(import.meta.dirname, 'overrides');

interface Site {
  origin: string;
}

/** Bundles the fixture the way the app is bundled and serves it, with the override files, from 127.0.0.1. */
const test = base.extend<object, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'theme-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'theme', 'fixture.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>theme fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
      };
      for (const name of ['cobalt', 'sage-surface', 'bg-only']) {
        files[`/overrides/${name}.css`] = ['text/css', readFileSync(path.join(overridesDir, `${name}.css`), 'utf8')];
      }
      const server: Server = createServer((request, response) => {
        const hit = files[new URL(request.url ?? '/', 'http://x').pathname];
        response.writeHead(hit ? 200 : 404, { 'content-type': hit?.[0] ?? 'text/plain' });
        response.end(hit?.[1] ?? 'not found');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      await new Promise((resolve) => server.close(resolve));
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

type Scheme = 'light' | 'dark';

/** Waits out the 0.15 s transitions a token change starts, so computed values are the final ones. */
const settle = (page: Page) => page.evaluate(() => Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished)).then(() => undefined));

/** Opens the fixture; `override` is loaded as a stylesheet after the inspector's own. */
async function open(page: Page, site: Site, scheme: Scheme, override?: string): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(site.origin);
  await expect(page.locator('[data-section="button"] .agui-btn').first()).toBeVisible();
  if (override) await page.addStyleTag({ url: `${site.origin}/overrides/${override}.css` });
  await settle(page);
}

/** The computed value of `property` on the first element matching `selector`. */
const computed = (page: Page, selector: string, property: string) =>
  page.evaluate(([sel, prop]) => getComputedStyle(document.querySelector(sel as string) as Element).getPropertyValue(prop as string), [selector, property]);

/** What a CSS expression in tokens computes to, serialized by the browser the way a real property would be. */
const expression = (page: Page, property: string, value: string) =>
  page.evaluate(
    ([prop, expr]) => {
      const probe = document.createElement('div');
      document.body.append(probe);
      probe.style.setProperty(prop as string, expr as string);
      const result = getComputedStyle(probe).getPropertyValue(prop as string);
      probe.remove();
      return result;
    },
    [property, value],
  );

/** Every row says: this property of this primitive is this expression over the tokens, and nothing literal. */
const rows: Array<[primitive: string, selector: string, property: string, tokens: string]> = [
  ['button', '[data-section="button"] .agui-btn:not([class*="--"])', 'background-color', 'var(--bg)'],
  ['button', '[data-section="button"] .agui-btn:not([class*="--"])', 'border-top-color', 'var(--line-2)'],
  ['button', '[data-section="button"] .agui-btn:not([class*="--"])', 'border-top-left-radius', 'var(--r-sm)'],
  ['button', '[data-section="button"] .agui-btn:not([class*="--"])', 'height', 'calc(var(--u) * 7.5)'],
  ['button', '[data-section="button"] .agui-btn:not([class*="--"])', 'padding-left', 'calc(var(--u) * 2.75)'],
  ['button', '[data-section="button"] .agui-btn:not([class*="--"])', 'color', 'var(--fg)'],
  ['button', '[data-section="button"] .agui-btn--primary:not(:disabled)', 'background-color', 'var(--agui-accent)'],
  ['button', '[data-section="button"] .agui-btn--primary:not(:disabled)', 'color', 'var(--agui-accent-contrast)'],
  ['button', '[data-section="button"] .agui-btn--small:not(.agui-btn--icon)', 'height', 'calc(var(--u) * 6)'],
  ['button', '[data-section="button"] .agui-btn--icon:not(.agui-btn--small)', 'width', 'calc(var(--u) * 7.5)'],
  ['tag', '[data-section="tag"] .agui-tag:not([class*="--"])', 'background-color', 'var(--sunk)'],
  ['tag', '[data-section="tag"] .agui-tag:not([class*="--"])', 'border-top-left-radius', 'var(--r-xs)'],
  ['tag', '[data-section="tag"] .agui-tag--accent', 'background-color', 'var(--acc-soft)'],
  ['tag', '[data-section="tag"] .agui-tag--accent', 'color', 'var(--acc-ink)'],
  ['tag', '[data-section="tag"] .agui-tag--ok', 'color', 'var(--ok)'],
  ['tag', '[data-section="tag"] .agui-tag--err', 'background-color', 'var(--err-soft)'],
  ['family-dot', '[data-section="family-dot"] .agui-dot[data-family="text"]:not(.agui-dot--hollow)', 'background-color', 'var(--f-text)'],
  ['family-dot', '[data-section="family-dot"] .agui-dot[data-family="neutral"]:not(.agui-dot--hollow)', 'background-color', 'var(--muted)'],
  ['chip', '[data-section="chip"] .agui-chip[aria-pressed="false"]:not(:disabled)', 'border-top-left-radius', 'var(--r-sm)'],
  ['chip', '[data-section="chip"] .agui-chip[aria-pressed="true"]', 'background-color', 'var(--sunk)'],
  ['chip', '[data-section="chip"] .agui-chip[aria-pressed="false"]:not(:disabled)', 'height', 'calc(var(--u) * 6.5)'],
  ['card', '[data-section="card"] .agui-card:not(.agui-card--interrupt)', 'border-top-left-radius', 'var(--r)'],
  ['card', '[data-section="card"] .agui-card:not(.agui-card--interrupt)', 'border-top-color', 'var(--line)'],
  ['card', '[data-section="card"] .agui-card:not(.agui-card--interrupt) .agui-card-b', 'padding-left', 'calc(var(--u) * 3)'],
  ['card', '[data-section="card"] .agui-card--interrupt', 'border-top-color', 'var(--acc-line)'],
  ['card', '[data-section="card"] .agui-card-f', 'color', 'var(--muted)'],
  ['code-block', '[data-section="code-block"] .agui-code', 'background-color', 'var(--sunk)'],
  ['code-block', '[data-section="code-block"] .agui-code', 'border-top-left-radius', 'var(--r-sm)'],
  ['code-block', '[data-section="code-block"] .agui-j-s', 'color', 'var(--j-str)'],
  ['code-block', '[data-section="code-block"] .agui-j-p', 'color', 'var(--faint)'],
  ['segmented', '[data-section="segmented"] .agui-seg', 'background-color', 'var(--sunk)'],
  ['segmented', '[data-section="segmented"] .agui-seg-opt[aria-pressed="true"]', 'background-color', 'var(--bg)'],
  ['segmented', '[data-section="segmented"] .agui-seg-opt', 'height', 'calc(var(--u) * 6)'],
  ['switch', '[data-section="switch"] .agui-switch[aria-checked="true"]:not(:disabled)', 'background-color', 'var(--agui-accent)'],
  ['switch', '[data-section="switch"] .agui-switch[aria-checked="false"]', 'background-color', 'var(--line-2)'],
  ['switch', '[data-section="switch"] .agui-switch[aria-checked="false"]', 'width', 'calc(var(--u) * 7.5)'],
  ['field', '[data-section="field"] .agui-field:not([aria-invalid])', 'border-top-left-radius', 'var(--r-sm)'],
  ['field', '[data-section="field"] .agui-field:not([aria-invalid])', 'height', 'calc(var(--u) * 8)'],
  ['field', '[data-section="field"] .agui-field[aria-invalid="true"]', 'border-top-color', 'var(--err)'],
  ['field', '[data-section="field"] .agui-search', 'border-top-left-radius', 'var(--r-sm)'],
  ['field', '[data-section="field"] .agui-editor:not([aria-invalid])', 'background-color', 'var(--sunk)'],
  ['field', '[data-section="field"] .agui-editor[aria-invalid="true"]', 'border-top-color', 'var(--err)'],
  ['finding', '[data-section="finding"] .agui-finding--neutral', 'background-color', 'var(--sunk)'],
  ['finding', '[data-section="finding"] .agui-finding--warn', 'background-color', 'var(--warn-soft)'],
  ['finding', '[data-section="finding"] .agui-finding--err', 'background-color', 'var(--err-soft)'],
  ['finding', '[data-section="finding"] .agui-finding--err', 'border-top-left-radius', 'var(--r-sm)'],
  ['label', '[data-section="button"] .agui-label', 'color', 'var(--muted)'],
];

/** Properties whose values must follow the tokens in all four combinations of mode and override. */
const mono = '[data-section="code-block"] .agui-code';
const fonts: Array<[selector: string, token: string]> = [
  ['[data-section="button"] .agui-btn', '--agui-font-sans'],
  ['[data-section="field"] .agui-field', '--agui-font-sans'],
  ['[data-section="field"] .agui-search input', '--agui-font-sans'],
  ['[data-section="finding"] .agui-finding', '--agui-font-sans'],
  ['[data-section="button"] .agui-label', '--agui-font-sans'],
  ['[data-section="tag"] .agui-tag', '--agui-font-mono'],
  ['[data-section="chip"] .agui-count', '--agui-font-mono'],
  [mono, '--agui-font-mono'],
  ['[data-section="field"] .agui-editor', '--agui-font-mono'],
];

const states: Array<{ name: string; scheme: Scheme; override?: string }> = [
  { name: 'light, defaults', scheme: 'light' },
  { name: 'dark, defaults', scheme: 'dark' },
  { name: 'light, cobalt override', scheme: 'light', override: 'cobalt' },
  { name: 'dark, cobalt override', scheme: 'dark', override: 'cobalt' },
];

for (const { name, scheme, override } of states) {
  test(`every primitive takes its look from the tokens: ${name}`, async ({ page, site }) => {
    await open(page, site, scheme, override);
    for (const [primitive, selector, property, tokens] of rows) {
      expect(await page.locator(selector).count(), `${primitive}: ${selector} is in the fixture`).toBeGreaterThan(0);
      expect(await computed(page, selector, property), `${primitive} ${selector} ${property}`).toBe(await expression(page, property, tokens));
    }
    for (const [selector, token] of fonts) {
      expect(await computed(page, selector, 'font-family'), `${selector} font-family`).toBe(await expression(page, 'font-family', `var(${token})`));
    }
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`overriding only --agui-* properties restyles every primitive in ${scheme} mode`, async ({ page, site }) => {
    await open(page, site, scheme);
    const sections = await page.locator('[data-section]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section') as string));
    const props = ['color', 'background-color', 'border-top-color', 'border-top-left-radius', 'font-family', 'height', 'padding-left', 'box-shadow'];
    /** One string per section: the computed look of every agui element in it. */
    const looks = () =>
      page.evaluate(
        ([names, list]) =>
          Object.fromEntries(
            (names as string[]).map((section) => [
              section,
              [...document.querySelectorAll(`[data-section="${section}"] [class*="agui-"]`)]
                .map((element) => (list as string[]).map((prop) => getComputedStyle(element).getPropertyValue(prop)).join('|'))
                .join('\n'),
            ]),
          ),
        [sections, props],
      );
    const before = await looks();
    await page.addStyleTag({ url: `${site.origin}/overrides/cobalt.css` });
    await settle(page);
    const after = await looks();
    const unchanged = sections.filter((section) => before[section] === after[section]);
    expect(sections.length).toBeGreaterThanOrEqual(15);
    expect(unchanged, 'sections the override did not restyle').toEqual([]);
    expect(await computed(page, '[data-section="button"] .agui-btn--primary:not(:disabled)', 'background-color')).toBe(
      await expression(page, 'background-color', 'oklch(0.52 0.19 262)'),
    );
    expect(await computed(page, '[data-section="button"] .agui-btn:not([class*="--"])', 'font-family')).toContain('Georgia');
    expect(await computed(page, mono, 'font-family')).toContain('Courier New');
    expect(await computed(page, '[data-section="button"] .agui-btn:not([class*="--"])', 'border-top-left-radius')).toBe('1.4px');
    expect(await computed(page, '[data-section="button"] .agui-btn:not([class*="--"])', 'height')).toBe('25.5px');
  });
}

test('light and dark defaults differ, and an explicit data-theme beats the system preference', async ({ page, site }) => {
  await open(page, site, 'light');
  const light = await computed(page, 'main', 'background-color');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const forcedDark = await computed(page, 'main', 'background-color');
  expect(forcedDark).not.toBe(light);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await open(page, site, 'dark');
  expect(await computed(page, 'main', 'background-color')).toBe(forcedDark);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  expect(await computed(page, 'main', 'background-color')).toBe(light);
});

test('background and text overrides work in both modes when dark values come with them', async ({ page, site }) => {
  for (const scheme of ['light', 'dark'] as const) {
    await open(page, site, scheme, 'sage-surface');
    const wanted = scheme === 'light' ? 'oklch(0.98 0.012 150)' : 'oklch(0.21 0.03 150)';
    expect(await computed(page, 'main', 'background-color')).toBe(await expression(page, 'background-color', wanted));
    // derived tokens follow: the sunk code block is mixed from the overridden colors
    expect(await computed(page, '[data-section="code-block"] .agui-code', 'background-color')).toBe(
      await expression(page, 'background-color', 'color-mix(in oklab, var(--agui-fg) 4%, var(--agui-bg))'),
    );
  }
});

test('a background override in :root alone is ignored in dark mode, as the theming doc warns', async ({ page, site }) => {
  await open(page, site, 'light', 'bg-only');
  expect(await computed(page, 'main', 'background-color')).toBe(await expression(page, 'background-color', 'oklch(0.98 0.012 150)'));
  await open(page, site, 'dark', 'bg-only');
  expect(await computed(page, 'main', 'background-color')).not.toBe(await expression(page, 'background-color', 'oklch(0.98 0.012 150)'));
});

test('the page requests nothing outside its own origin and loads no font, in every mode and with overrides', async ({ page, site }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  for (const scheme of ['light', 'dark'] as const) {
    await open(page, site, scheme, 'cobalt');
    await page.getByRole('button', { name: 'Open popover' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open dialog' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Show toast' }).click();
  }
  await page.waitForLoadState('networkidle');
  expect(requests.filter((url) => /\/(fixture\.(js|css)|overrides\/cobalt\.css)$/.test(url)).length, 'own assets were observed').toBeGreaterThanOrEqual(6);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  expect(await page.evaluate(() => document.fonts.size), 'no @font-face was registered').toBe(0);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(resources.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
});

test('keyboard focus is visible on every kind of control and follows the accent', async ({ page, site }) => {
  await open(page, site, 'light', 'cobalt');
  const ring = await expression(page, 'outline-color', 'color-mix(in oklab, var(--agui-accent) 55%, transparent)');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const seen = new Set<string>();
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const holder = element.closest('.agui-search') as HTMLElement | null;
      const shown = holder ? getComputedStyle(holder) : style;
      return { kind: element.className || element.tagName, width: shown.outlineWidth, style: shown.outlineStyle, color: shown.outlineColor };
    });
    if (!focus) continue;
    expect(focus.style, `${focus.kind} shows an outline`).toBe('solid');
    expect(focus.width, `${focus.kind} outline width`).toBe('2px');
    expect(focus.color, `${focus.kind} outline color`).toBe(ring);
    seen.add(String(focus.kind).split(' ')[0] ?? '');
  }
  for (const kind of ['agui-btn', 'agui-chip', 'agui-seg-opt', 'agui-switch', 'agui-field', 'agui-editor', 'agui-code']) {
    expect([...seen], `Tab reached an ${kind}`).toContain(kind);
  }
});

test('switch, segmented control and chips expose and change their state from the keyboard and pointer', async ({ page, site }) => {
  await open(page, site, 'light');
  const toggle = page.getByRole('switch', { name: 'Render A2UI' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('switch', { name: 'Locked' })).toBeDisabled();

  const turn = page.getByRole('button', { name: 'Turn only' });
  await expect(turn).toHaveAttribute('aria-pressed', 'false');
  await turn.click();
  await expect(turn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Full transcript' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Pressed' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Disabled', exact: true }).first()).toBeDisabled();
});

test('icon-only buttons have accessible names and decorative icons are hidden', async ({ page, site }) => {
  await open(page, site, 'light');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
  expect(await page.locator('svg:not([aria-hidden="true"])').count()).toBe(0);
});

test('the popover is native, opens under its trigger, and Escape closes it and returns focus', async ({ page, site }) => {
  await open(page, site, 'light');
  const trigger = page.getByRole('button', { name: 'Open popover' });
  const popover = page.locator('#fixture-pop');
  await trigger.click();
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((element) => element.matches(':popover-open'))).toBe(true);
  const [anchor, box] = await Promise.all([trigger.boundingBox(), popover.boundingBox()]);
  expect(Math.round((box?.y ?? 0) - ((anchor?.y ?? 0) + (anchor?.height ?? 0)))).toBe(6);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('the dialog is a native modal that Escape or its buttons close', async ({ page, site }) => {
  await open(page, site, 'light');
  const trigger = page.getByRole('button', { name: 'Open dialog' });
  const dialog = page.getByRole('dialog', { name: 'Export this session?' });
  await trigger.click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await trigger.click();
  await expect(dialog).toBeVisible();
});

test('a toast appears in a polite live region and is removed after 3.2 s', async ({ page, site }) => {
  await page.clock.install();
  await open(page, site, 'light');
  const region = page.locator('.agui-toasts');
  await expect(region).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('button', { name: 'Show toast' }).click();
  await expect(region.getByText('Token cleared.')).toBeVisible();
  await page.clock.fastForward(3100);
  await expect(region.getByText('Token cleared.')).toBeVisible();
  await page.clock.fastForward(200);
  await expect(region.getByText('Token cleared.')).toHaveCount(0);
});

test('reduced motion turns off the pulse, the caret, the row fade and every transition', async ({ page, site }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await open(page, site, 'light');
  expect(await computed(page, '.agui-pulse', 'animation-name')).not.toBe('none');
  expect(await computed(page, '.agui-fresh', 'animation-name')).not.toBe('none');
  expect(await computed(page, '[data-section="button"] .agui-btn', 'transition-duration')).not.toBe('0s');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await computed(page, '.agui-pulse', 'animation-name')).toBe('none');
  expect(await computed(page, '.agui-fresh', 'animation-name')).toBe('none');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.agui-caret') as Element, '::after').animationName)).toBe('none');
  expect(await computed(page, '[data-section="button"] .agui-btn', 'transition-duration')).toBe('0s');
  expect(await computed(page, '.agui-switch', 'transition-duration')).toBe('0s');
});

test('long code wraps and tall code scrolls inside its own capped box, at phone width', async ({ page, site }) => {
  await open(page, site, 'light');
  await page.setViewportSize({ width: 400, height: 800 });
  const code = page.locator('[data-section="code-block"] .agui-code').first();
  await code.evaluate((element) => {
    element.textContent = `{"k": "${'x'.repeat(2000)}"}\n${'line\n'.repeat(100)}`;
  });
  const box = await code.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(400);
  expect(box?.height ?? 0).toBeLessThanOrEqual(342);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
  expect(await code.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
});
