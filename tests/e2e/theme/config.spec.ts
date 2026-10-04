// D02 T061 (US2.5, US2.6, FR-006, FR-037, FR-038, FR-041, SC-002, SC-008, SC-010, G-09): the theme maps
// in config.json, in the assembled application. The page under test is the production build, served
// hosted, embedded, by the Python helper and by a generic static server; the agents are scripted and
// model-free. What this proves: the maps restyle the shell in light and dark, by system preference and
// by the switch; omitted values keep their defaults; every rejected override is a visible nonfatal
// warning that applies nothing, starts no request and leaves the content security policy alone; valid
// agents still run; and a host page's generic tokens neither reach the inspector nor are replaced by it.
import type { Page } from '@playwright/test';
import { startPython, startStatic } from '../hosted/serving';
import { AGENT_REPLY, expect, expectAllowlisted, open, send, test, type Site } from '../hosted/support';

const THEME = {
  light: {
    '--agui-accent': 'rgb(0, 80, 200)',
    '--agui-accent-contrast': 'rgb(255, 255, 255)',
    '--agui-bg': 'rgb(250, 240, 230)',
    '--agui-fg': 'rgb(20, 20, 60)',
    '--agui-radius': '2px',
    '--agui-density': '0.9',
    '--agui-font-sans': 'Georgia, serif',
    '--agui-font-mono': '"Courier New", monospace',
  },
  dark: {
    '--agui-accent': 'rgb(147, 197, 253)',
    '--agui-accent-contrast': 'rgb(10, 20, 40)',
    '--agui-bg': 'rgb(10, 20, 40)',
    '--agui-fg': 'rgb(230, 240, 255)',
    '--agui-radius': '14px',
  },
};

/** What the shell computes to, read from the elements a theme map is meant to restyle. */
const look = (page: Page) =>
  page.evaluate(() => {
    const mountEl = document.getElementById('root') as HTMLElement;
    const mark = getComputedStyle(document.querySelector('.agui-app-mark') as Element);
    const shell = getComputedStyle(mountEl);
    // Layout snaps lengths to 1/64 px; one decimal is what the maps say.
    const tenth = (length: string) => `${Math.round(parseFloat(length) * 10) / 10}px`;
    return { accent: mark.backgroundColor, onAccent: mark.color, radius: tenth(mark.borderTopLeftRadius), width: tenth(mark.width), background: shell.backgroundColor, text: shell.color, font: shell.fontFamily };
  });

const LIGHT = { accent: 'rgb(0, 80, 200)', onAccent: 'rgb(255, 255, 255)', radius: '1.4px', width: '25.2px', background: 'rgb(250, 240, 230)', text: 'rgb(20, 20, 60)' };
// The dark map names no density, so dark returns to the stylesheet's 1.
const DARK = { accent: 'rgb(147, 197, 253)', onAccent: 'rgb(10, 20, 40)', radius: '9.8px', width: '28px', background: 'rgb(10, 20, 40)', text: 'rgb(230, 240, 255)' };

/** Polls, because the shell eases between values for a moment after a change. */
async function expectLook(page: Page, wanted: Record<string, string>, font?: string): Promise<void> {
  await expect.poll(() => look(page).then(({ font: _, ...rest }) => rest)).toEqual(wanted);
  if (font !== undefined) expect((await look(page)).font).toContain(font);
}

const metas = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
const warnings = (page: Page) => page.getByRole('status', { name: 'Configuration warnings' });

const hostedConfig = (theme: unknown) => (o: { agent: { origin: string } }) => ({ version: 0, agents: [{ id: 'support', name: 'Support assistant', url: `${o.agent.origin}/agent` }], theme });
const embeddedConfig = (theme: unknown) => () => ({ version: 0, agents: [{ id: 'support', name: 'Support assistant', url: '/agent' }], theme });

// ---------------------------------------------------------------------------------------------
// Both maps, in each deployment
// ---------------------------------------------------------------------------------------------

for (const mode of ['hosted', 'embedded'] as const) {
  test(`${mode}: the light and dark maps restyle the shell by system preference and by the theme switch, and omitted values keep their defaults`, async ({ page, openSite, requested, violations }) => {
    const site = await openSite(mode === 'hosted' ? { config: hostedConfig(THEME) } : { hosting: () => null, config: embeddedConfig(THEME) });
    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, site);
    await expect(warnings(page)).toHaveCount(0);
    await expectLook(page, LIGHT, 'Georgia');

    // The system preference changes while the page is open.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectLook(page, DARK);
    expect((await look(page)).font, 'the dark map names no font, so the default stack is back').not.toContain('Georgia');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectLook(page, LIGHT, 'Georgia');

    // The switch forces a mode whatever the system says, and flips back.
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expectLook(page, DARK);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expectLook(page, LIGHT, 'Georgia');
    await page.emulateMedia({ colorScheme: 'light' });

    // The derived tokens follow the overridden public ones, in the views as well as the shell.
    const sendButton = page.getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeVisible();
    await expect.poll(() => sendButton.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(0, 80, 200)');

    // Nothing the theme does reaches the network or the policy.
    expect(await violations()).toEqual([]);
    expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
    expect(requested.map((url) => new URL(url).pathname).filter((p) => p.endsWith('.json'))).toEqual(['/hosting-config.json', '/config.json']);
    expect(await metas(page)).toHaveLength(2);
  });

  test(`${mode}: a dark page opens straight in the dark map`, async ({ page, openSite }) => {
    const site = await openSite(mode === 'hosted' ? { config: hostedConfig(THEME) } : { hosting: () => null, config: embeddedConfig(THEME) });
    await page.emulateMedia({ colorScheme: 'dark' });
    await open(page, site);
    await expectLook(page, DARK);
  });
}

test('a missing map leaves its mode on the defaults, and a missing theme leaves both', async ({ page, openSite }) => {
  const themed = await openSite({ config: hostedConfig({ light: THEME.light }) });
  const plain = await openSite({ config: (o) => ({ version: 0, agents: [{ id: 'support', url: `${o.agent.origin}/agent` }] }) });
  const defaults: Record<string, unknown> = {};
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, plain);
    await page.waitForTimeout(300);
    defaults[scheme] = await look(page);
    await expect(warnings(page)).toHaveCount(0);
  }
  expect(defaults.light).not.toEqual(defaults.dark);

  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page, themed);
  await page.waitForTimeout(300);
  expect(await look(page), 'no dark map: dark defaults').toEqual(defaults.dark);
  await expect(warnings(page)).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await expectLook(page, LIGHT, 'Georgia');
});

// ---------------------------------------------------------------------------------------------
// Rejected overrides: visible, nonfatal, inert
// ---------------------------------------------------------------------------------------------

const UNSAFE = {
  light: {
    '--agui-accent': 'url(https://evil.example/pixel.png)',
    '--agui-accent-contrast': 'URL (https://evil.example/pixel.png)',
    '--agui-tint-hue': 'image-set(url(https://evil.example/a.png) 1x)',
    '--agui-tint-chroma': 'IMAGE-SET (https://evil.example/a.png 1x)',
    '--agui-bg': '@import "https://evil.example/x.css"',
    '--agui-fg': 'red; background: blue',
    '--agui-radius': '4px } body { display: none',
    '--agui-density': '{',
    '--agui-font-sans': 'ur\\6c(https://evil.example/f.woff2)',
    '--agui-font-mono': 'src(https://evil.example/f.woff2)',
  },
  dark: {
    '--bg': 'red',
    '--fg': 'red',
    '--muted': 'red',
    '--acc': 'red',
    '--r': '99px',
    '--agui-private': 'red',
    color: 'red',
    '--agui-radius': 8,
    '--agui-density': '0.9',
  },
  sepia: { '--agui-accent': 'red' },
};

for (const mode of ['hosted', 'embedded'] as const) {
  test(`${mode}: every unsafe form and every unknown or private name is a visible warning that applies nothing, and the agent still runs`, async ({ page, openSite, requested, violations }) => {
    const site = await openSite(mode === 'hosted' ? { config: hostedConfig(UNSAFE) } : { hosting: () => null, config: embeddedConfig(UNSAFE) });
    const baseline = await openSite(mode === 'hosted' ? { config: hostedConfig(undefined) } : { hosting: () => null, config: embeddedConfig(undefined) });
    const swap = (policy: string, from: Site) => policy.replaceAll(from.agent.origin, 'AGENT');

    await page.emulateMedia({ colorScheme: 'light' });
    await open(page, baseline);
    const defaults = await look(page);
    const policy = swap((await metas(page))[1] ?? '', baseline);

    const opened = requested.length;
    await page.goto(site.page.origin);
    await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();

    // One visible, nonfatal warning per rejected override: 10 unsafe values, 7 bad names, 1 bad type, 1 unknown map.
    const region = warnings(page);
    await expect(region).toBeVisible();
    await expect(region.locator('.agui-finding--warn')).toHaveCount(19);
    const text = (await region.textContent()) ?? '';
    for (const name of [...Object.keys(UNSAFE.light), '--bg', '--fg', '--muted', '--acc', '--r', '--agui-private', '"color"', '"sepia"']) expect(text, name).toContain(name);
    expect(text).not.toContain('evil.example');
    expect(await page.getByRole('alert').count(), 'a warning is not a startup failure').toBe(0);

    // Nothing rejected is applied. The one valid dark override is, and only in dark.
    expect(await look(page)).toEqual(defaults);
    expect(await page.evaluate(() => document.documentElement.getAttribute('style') ?? '')).toBe('');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => look(page).then((value) => value.width)).toBe('25.2px');
    expect(await page.evaluate(() => document.documentElement.getAttribute('style'))).toBe('--agui-density: 0.9;');
    await page.emulateMedia({ colorScheme: 'light' });

    // The valid agent still runs.
    await send(page, 'hello');
    await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
    expect(mode === 'hosted' ? site.agent.seen.map((request) => request.path) : site.page.seen.filter((request) => request.method === 'POST').map((request) => request.path)).toEqual(['/agent']);

    // No request for a rejected value, no policy change, no violation.
    expect(requested.filter((url) => url.includes('evil'))).toEqual([]);
    expectAllowlisted(requested.slice(opened), [site.page.origin, site.agent.origin]);
    expect(site.foreign.seen).toEqual([]);
    const metaNow = await metas(page);
    expect(metaNow).toHaveLength(2);
    expect(swap(metaNow[1] ?? '', site)).toBe(policy);
    expect(metaNow[1]).not.toMatch(/unsafe-eval|unsafe-inline|evil/);
    expect(await violations()).toEqual([]);
  });
}

test('a theme of the wrong shape is one visible warning and the agents are listed', async ({ page, openSite }) => {
  for (const theme of ['cobalt', [], { light: 'red', dark: ['--agui-accent'] }]) {
    const site = await openSite({ config: hostedConfig(theme) });
    await open(page, site);
    await expect(warnings(page).locator('.agui-finding--warn')).toHaveCount(Array.isArray(theme) || typeof theme === 'string' ? 1 : 2);
    await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${site.agent.origin}/agent`);
    expect(await page.getByRole('alert').count()).toBe(0);
  }
});

// ---------------------------------------------------------------------------------------------
// The mount, the host page, and what floats above it
// ---------------------------------------------------------------------------------------------

test('the shell paints on #root, which covers the viewport; body and html paint nothing, light and dark, desktop and phone', async ({ page, openSite }) => {
  const site = await openSite({ config: hostedConfig(undefined) });
  for (const scheme of ['light', 'dark'] as const) {
    for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, site);
      const facts = await page.evaluate(() => {
        const mountEl = document.getElementById('root') as HTMLElement;
        const box = mountEl.getBoundingClientRect();
        return {
          box: [box.left, box.top, box.width, box.height],
          view: [0, 0, window.innerWidth, window.innerHeight],
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          htmlBackground: getComputedStyle(document.documentElement).backgroundColor,
          bodyFont: getComputedStyle(document.body).fontSize,
          rootBackground: getComputedStyle(mountEl).backgroundColor,
          scrolls: document.documentElement.scrollHeight > window.innerHeight || document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const where = `${scheme} ${size.width}px`;
      expect(facts.box, where).toEqual(facts.view);
      expect(facts.bodyBackground, where).toBe('rgba(0, 0, 0, 0)');
      expect(facts.htmlBackground, where).toBe('rgba(0, 0, 0, 0)');
      expect(facts.bodyFont, 'the body keeps the browser default; the shell font is set on #root').toBe('16px');
      expect(facts.rootBackground, where).not.toBe('rgba(0, 0, 0, 0)');
      expect(facts.scrolls, where).toBe(false);
    }
  }
});

const HOST_CSS = `
:root, body {
  --bg: rgb(255, 0, 0); --fg: rgb(0, 255, 0); --muted: rgb(0, 0, 255); --acc: rgb(255, 0, 255); --r: 77px;
  --sunk: rgb(255, 255, 0); --hover: rgb(0, 255, 255); --line: rgb(255, 128, 0); --line-2: rgb(128, 0, 255);
  --u: 33px; --pop: 0 0 0 9px rgb(255, 0, 0); --scrim: rgb(255, 0, 0); --l-fam: 0.1; --l-sem: 0.1;
}
body { background: rgb(255, 0, 0); color: rgb(0, 255, 0); }
`;

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: host generic tokens do not reach the inspector, and the inspector keeps its theme and floating layers in the mount`, async ({ page, openSite, violations }) => {
    const site = await openSite({ config: hostedConfig(THEME), files: { '/host.css': { type: 'text/css', body: HOST_CSS } } });
    await page.emulateMedia({ colorScheme: scheme });

    /** Opens the three floating layers in turn and reads how each looks and where it sits. */
    const layers = async () => {
      const read = (selector: string) =>
        page.locator(selector).first().evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            inMount: element.closest('#root') !== null,
            look: ['background-color', 'color', 'border-top-left-radius', 'box-shadow', 'font-family', 'font-size'].map((prop) => style.getPropertyValue(prop)).join('|'),
          };
        });
      await page.getByRole('button', { name: 'Authentication: no token' }).click();
      const popover = await read('[popover]:popover-open');
      await page.getByRole('textbox', { name: 'Token' }).fill('synthetic-token-7f3a91');
      await page.keyboard.press('Escape');
      await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(`${site.agent.origin}/agent?other=1`);
      await page.getByRole('button', { name: 'Use endpoint' }).click();
      await expect(page.getByText('Token cleared')).toBeVisible();
      const toast = await read('.agui-toast');
      await page.getByRole('button', { name: 'Export session' }).click();
      await expect(page.getByRole('dialog', { name: 'Export this session' })).toBeVisible();
      const dialog = await read('dialog[open]');
      const backdrop = await page.locator('dialog[open]').evaluate((element) => getComputedStyle(element, '::backdrop').backgroundColor);
      await page.keyboard.press('Escape');
      return { popover, toast, dialog, backdrop };
    };

    await page.goto(site.page.origin);
    await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
    const plain = await layers();
    const plainShell = await look(page);
    expect([plain.popover.inMount, plain.toast.inMount, plain.dialog.inMount], 'every floating layer is a descendant of the mount').toEqual([true, true, true]);

    await page.goto(site.page.origin);
    await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
    await page.addStyleTag({ url: `${site.page.origin}/host.css` });
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim())).toBe('rgb(255, 0, 0)');
    for (const [name, value] of Object.entries({ '--fg': 'rgb(0, 255, 0)', '--muted': 'rgb(0, 0, 255)', '--acc': 'rgb(255, 0, 255)', '--r': '77px', '--u': '33px' })) {
      expect(await page.evaluate((property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(), name), `the host keeps its ${name}`).toBe(value);
    }
    // The inspector's own derivations and its configured theme are what they were.
    await page.waitForTimeout(300);
    expect(await look(page)).toEqual(plainShell);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('root') as HTMLElement).getPropertyValue('--bg').trim())).not.toBe('rgb(255, 0, 0)');

    const hostile = await layers();
    expect(hostile.popover).toEqual(plain.popover);
    expect(hostile.toast).toEqual(plain.toast);
    expect(hostile.dialog).toEqual(plain.dialog);
    expect(hostile.backdrop).toBe(plain.backdrop);
    expect(JSON.stringify(hostile)).not.toContain('rgb(255, 0, 0)');
    expect(await violations()).toEqual([]);
  });
}

// ---------------------------------------------------------------------------------------------
// The Python helper, and generic static serving of its configuration
// ---------------------------------------------------------------------------------------------

test.describe('the Python helper', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('serves the maps in config.json, the page applies them in both modes, and the same config works from a generic static server', async ({ page, dist, requested, violations }) => {
    const python = await startPython(dist, { theme: THEME });
    try {
      const served = await fetch(`${python.origin}/agui-inspector/config.json`).then((response) => response.text());
      expect(JSON.parse(served)).toEqual({ version: 0, agents: [{ id: 'demo', url: '/agents/demo/stream', name: 'Demo agent' }], theme: THEME });

      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(`${python.origin}/agui-inspector/`);
      await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
      await expectLook(page, LIGHT, 'Georgia');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectLook(page, DARK);
      await page.emulateMedia({ colorScheme: 'light' });
      await expectLook(page, LIGHT, 'Georgia');
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
      await expectLook(page, DARK);
      await page.getByRole('button', { name: 'Switch to light theme' }).click();
      await expectLook(page, LIGHT, 'Georgia');
      await expect(warnings(page)).toHaveCount(0);

      await send(page, 'hello');
      await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      expect(new Set(requested.map((url) => new URL(url).origin))).toEqual(new Set([python.origin]));
      expect(await violations()).toEqual([]);

      // The same file, produced by Python, beside the same assets on a server that knows nothing about either.
      const generic = await startStatic(dist, served);
      try {
        const urls: string[] = [];
        page.on('request', (request) => urls.push(request.url()));
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(generic.origin);
        await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
        await expectLook(page, LIGHT, 'Georgia');
        await page.emulateMedia({ colorScheme: 'dark' });
        await expectLook(page, DARK);
        await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue('/agents/demo/stream');
        expect(urls.filter((url) => !url.startsWith(`${generic.origin}/`))).toEqual([]);
        expect(generic.requested.filter((p) => p.endsWith('.json')).sort()).toEqual(['/config.json', '/hosting-config.json']);
      } finally {
        await generic.close();
      }
    } finally {
      python.stop();
    }
  });

  test('delivers rejected overrides unchanged, and the page warns instead of failing', async ({ page, dist, requested, violations }) => {
    const python = await startPython(dist, { theme: UNSAFE });
    try {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(`${python.origin}/agui-inspector/`);
      await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
      await expect(warnings(page).locator('.agui-finding--warn')).toHaveCount(19);
      expect(await page.getByRole('alert').count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.getAttribute('style') ?? '')).toBe('');
      await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue('/agents/demo/stream');
      await send(page, 'hello');
      await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      expect(requested.filter((url) => url.includes('evil'))).toEqual([]);
      expect(new Set(requested.map((url) => new URL(url).origin))).toEqual(new Set([python.origin]));
      expect(await violations()).toEqual([]);
    } finally {
      python.stop();
    }
  });
});
