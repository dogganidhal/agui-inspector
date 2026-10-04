// Spec 003 (FR-001 to FR-013, SC-001 to SC-006): the adopter's name and logo in the top bar of the assembled
// application. The page under test is the production build, served hosted, embedded, by the Python helper and by a
// generic static server (the npm assets); the agents are scripted and model-free. What this proves: the same brand
// gives the same top bar in every mode, in light and dark and under the switch; each rejected value is one visible
// nonfatal warning that starts no request to another origin and leaves the policy alone; a logo that does not
// load shows the default mark and says so; and a long name or a wide logo keeps the bar on its row.
import type { Page } from '@playwright/test';
import { startPython, startStatic } from '../hosted/serving';
import { AGENT_REPLY, expect, expectAllowlisted, send, test, type Site } from '../hosted/support';

const svg = (fill: string, width = 120, height = 28) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
const LIGHT_LOGO = svg('#c2410c');
const DARK_LOGO = svg('#7dd3fc');
const FILES = {
  '/static/acme.svg': { type: 'image/svg+xml', body: LIGHT_LOGO },
  '/static/acme-dark.svg': { type: 'image/svg+xml', body: DARK_LOGO },
  '/static/not-an-image.svg': { type: 'text/plain', body: 'this is not an image' },
};
const BRAND = { name: 'Acme Console', logo: '/static/acme.svg', logoDark: '/static/acme-dark.svg' };
const FAILED = 'brand.logo could not be loaded; the default mark is shown';

const heading = (page: Page) => page.getByRole('heading', { level: 1 });
const visibleLogos = (page: Page) => page.locator('.agui-app-logo-img:visible');
const defaultMark = (page: Page) => page.locator('.agui-app-mark:visible');
const warnings = (page: Page) => page.getByRole('status', { name: 'Configuration warnings' });
const warn = (page: Page) => warnings(page).locator('.agui-finding--warn');
const metas = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));

/** One logo is on screen, loaded, and is the one wanted; the default mark is not. */
async function expectLogo(page: Page, src: string): Promise<void> {
  await expect(visibleLogos(page)).toHaveCount(1);
  await expect.poll(() => visibleLogos(page).evaluate((image) => (image as HTMLImageElement).currentSrc)).toBe(src);
  await expect.poll(() => visibleLogos(page).evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(defaultMark(page)).toHaveCount(0);
}

async function expectDefault(page: Page, name = 'agui-inspector'): Promise<void> {
  await expect(heading(page)).toHaveText(name);
  await expect(defaultMark(page)).toHaveCount(1);
  await expect(visibleLogos(page)).toHaveCount(0);
}

const hostedConfig = (extra: () => object) => (o: { agent: { origin: string } }) => ({ version: 0, agents: [{ id: 'support', name: 'Support assistant', url: `${o.agent.origin}/agent` }], ...extra() });
const embeddedConfig = (extra: () => object) => () => ({ version: 0, agents: [{ id: 'support', url: '/agent' }], ...extra() });

// ---------------------------------------------------------------------------------------------
// The same top bar in every mode, in light and dark
// ---------------------------------------------------------------------------------------------

for (const mode of ['hosted', 'embedded'] as const) {
  test(`${mode}: the name and logo replace the default ones in light and dark, by system preference and by the switch, with the policy and the network unchanged`, async ({ page, openSite, requested, violations }) => {
    const options = (extra: object) => (mode === 'hosted' ? { config: hostedConfig(() => extra), files: FILES } : { hosting: () => null, config: embeddedConfig(() => extra), files: FILES });
    const baseline = await openSite(options({}));
    const site = await openSite(options({ brand: BRAND }));
    const swap = (policy: string, from: Site) => policy.replaceAll(from.agent.origin, 'AGENT');

    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(baseline.page.origin);
    await expectDefault(page);
    await expect(warnings(page)).toHaveCount(0);
    const policy = swap((await metas(page))[1] ?? '', baseline);

    const opened = requested.length;
    await page.goto(site.page.origin);
    await expect(heading(page)).toHaveText('Acme Console');
    const [light, dark] = [`${site.page.origin}/static/acme.svg`, `${site.page.origin}/static/acme-dark.svg`];
    await expectLogo(page, light);
    await expect(warnings(page)).toHaveCount(0);

    // The system preference changes while the page is open, and the switch forces a mode whatever it says.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectLogo(page, dark);
    await page.emulateMedia({ colorScheme: 'light' });
    await expectLogo(page, light);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expectLogo(page, dark);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expectLogo(page, light);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expectLogo(page, dark);
    await page.emulateMedia({ colorScheme: 'light' });
    await expectLogo(page, dark);

    // Both images were requested when the page started, so a switch never waits for one.
    const mine = requested.slice(opened);
    expect(mine).toContain(light);
    expect(mine).toContain(dark);
    expect(mine.filter((url) => url.endsWith('.json')).map((url) => new URL(url).pathname)).toEqual(['/hosting-config.json', '/config.json']);
    expectAllowlisted(mine, [site.page.origin, site.agent.origin]);
    expect(site.foreign.seen).toEqual([]);

    // The policy is the one a page with no brand has, and the page still works.
    const now = await metas(page);
    expect(now).toHaveLength(2);
    expect(swap(now[1] ?? '', site)).toBe(policy);
    expect(now[1]).toContain("img-src 'self' data:");
    await send(page, 'hello');
    await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
    expect(await violations()).toEqual([]);
  });
}

test('a logo may be a relative path, an absolute path, a full URL on the page origin or a data URI, and a logo alone leaves the name', async ({ page, openSite }) => {
  let brand: object = {};
  const site = await openSite({ config: hostedConfig(() => ({ brand })), files: FILES });
  const DATA = `data:image/svg+xml;base64,${Buffer.from(LIGHT_LOGO).toString('base64')}`;
  for (const [written, shown] of [
    ['static/acme.svg', `${site.page.origin}/static/acme.svg`],
    ['/static/acme.svg', `${site.page.origin}/static/acme.svg`],
    [`${site.page.origin}/static/acme.svg?v=3`, `${site.page.origin}/static/acme.svg?v=3`],
    [DATA, DATA],
  ] as const) {
    brand = { logo: written };
    await page.goto(site.page.origin);
    await expect(heading(page)).toHaveText('agui-inspector');
    await expectLogo(page, shown);
    await expect(warnings(page)).toHaveCount(0);
  }
  brand = { name: 'Acme Console' };
  await page.goto(site.page.origin);
  await expectDefault(page, 'Acme Console');
});

test('npm static assets: a generic static server shows the same brand', async ({ page, dist }) => {
  const config = JSON.stringify({ version: 0, agents: [{ id: 'demo', url: '/agents/demo/stream' }], brand: BRAND });
  const generic = await startStatic(dist, config, FILES);
  try {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(generic.origin);
    await expect(heading(page)).toHaveText('Acme Console');
    await expectLogo(page, `${generic.origin}/static/acme.svg`);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectLogo(page, `${generic.origin}/static/acme-dark.svg`);
    expect(urls.filter((url) => !url.startsWith(`${generic.origin}/`))).toEqual([]);
  } finally {
    await generic.close();
  }
});

// ---------------------------------------------------------------------------------------------
// The Python helper
// ---------------------------------------------------------------------------------------------

test.describe('the Python helper', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  test('serves the brand, the host serves the logo from its own route, and a mount with no brand keeps the default', async ({ page, dist, requested, violations }) => {
    const python = await startPython(dist, { brand: { name: 'Acme Console', logo: '/static/acme.svg', logo_dark: '/static/acme-dark.svg' }, assets: { 'acme.svg': LIGHT_LOGO, 'acme-dark.svg': DARK_LOGO } });
    try {
      const served = await fetch(`${python.origin}/agui-inspector/config.json`).then((response) => response.json());
      expect(served).toEqual({ version: 0, agents: [{ id: 'demo', url: '/agents/demo/stream', name: 'Demo agent' }], brand: BRAND });

      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto(`${python.origin}/agui-inspector/`);
      await expect(heading(page)).toHaveText('Acme Console');
      await expectLogo(page, `${python.origin}/static/acme.svg`);
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectLogo(page, `${python.origin}/static/acme-dark.svg`);
      await expect(warnings(page)).toHaveCount(0);
      await send(page, 'hello');
      await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      expect(new Set(requested.map((url) => new URL(url).origin))).toEqual(new Set([python.origin]));
      expect(await violations()).toEqual([]);
    } finally {
      python.stop();
    }

    const plain = await startPython(dist);
    try {
      expect(await fetch(`${plain.origin}/agui-inspector/config.json`).then((response) => response.json())).not.toHaveProperty('brand');
      await page.goto(`${plain.origin}/agui-inspector/`);
      await expectDefault(page);
      await expect(warnings(page)).toHaveCount(0);
    } finally {
      plain.stop();
    }
  });

  test('delivers a bad brand unchanged, and the page warns for each field instead of failing', async ({ page, dist, requested }) => {
    const python = await startPython(dist, { brand: { name: '  ', logo: 'https://other.example/x.png', logo_dark: '//other.example/y.png' } });
    try {
      await page.goto(`${python.origin}/agui-inspector/`);
      await expect(heading(page)).toHaveText('agui-inspector');
      await expect(warn(page)).toHaveCount(3);
      await expectDefault(page);
      expect(await page.getByRole('alert').count()).toBe(0);
      await send(page, 'hello');
      await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
      expect(requested.filter((url) => url.includes('other.example'))).toEqual([]);
      expect(new Set(requested.map((url) => new URL(url).origin))).toEqual(new Set([python.origin]));
    } finally {
      python.stop();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Rejected values: visible, nonfatal, inert
// ---------------------------------------------------------------------------------------------

test('every rejected value is a visible warning, the other fields and the agent still work, and nothing is requested from another origin', async ({ page, openSite, requested, violations }) => {
  let extra: object = {};
  const site = await openSite({ config: hostedConfig(() => extra), files: FILES });
  const baseline = await openSite({ config: hostedConfig(() => ({})) });
  const foreignHost = new URL(site.foreign.origin).host;
  const pageHost = new URL(site.page.origin).host;
  const swap = (policy: string, from: Site) => policy.replaceAll(from.agent.origin, 'AGENT');
  await page.goto(baseline.page.origin);
  const policy = swap((await metas(page))[1] ?? '', baseline);

  // [brand, warnings it gives, the name on screen, whether the valid logo shows]
  const cases: Array<[string, object, number, string, boolean]> = [
    ['a logo on another origin', { name: 'Acme', logo: `${site.foreign.origin}/logo.png` }, 1, 'Acme', false],
    ['a scheme-relative logo', { name: 'Acme', logo: `//${foreignHost}/logo.png` }, 1, 'Acme', false],
    ['a backslash', { name: 'Acme', logo: `/\\${foreignHost}/logo.png` }, 1, 'Acme', false],
    ['a tab inside the slashes', { name: 'Acme', logo: `/\t/${foreignHost}/logo.png` }, 1, 'Acme', false],
    ['javascript:', { name: 'Acme', logo: 'javascript:alert(1)' }, 1, 'Acme', false],
    ['a data: URI that is not an image', { name: 'Acme', logo: 'data:text/html,<p>hi</p>' }, 1, 'Acme', false],
    ['credentials in the URL', { name: 'Acme', logo: `http://user:pw@${pageHost}/static/acme.svg` }, 1, 'Acme', false],
    ['a logo that is not a string', { name: 'Acme', logo: 7 }, 1, 'Acme', false],
    ['an empty name beside a valid logo', { name: '', logo: '/static/acme.svg' }, 1, 'agui-inspector', true],
    ['an unknown field', { name: 'Acme', title: 'x' }, 1, 'Acme', false],
    ['a dark logo with no logo', { name: 'Acme', logoDark: '/static/acme-dark.svg' }, 1, 'Acme', false],
    ['a dark logo on another origin', { logo: '/static/acme.svg', logoDark: `${site.foreign.origin}/dark.png` }, 1, 'agui-inspector', true],
    ['every field wrong', { name: ' ', logo: `${site.foreign.origin}/a.png`, logoDark: `${site.foreign.origin}/b.png` }, 3, 'agui-inspector', false],
    ['a brand that is a string', 'Acme' as unknown as object, 1, 'agui-inspector', false],
    ['a brand that is null', null as unknown as object, 1, 'agui-inspector', false],
    ['a brand that is a list', [] as unknown as object, 1, 'agui-inspector', false],
  ];
  for (const [label, brand, count, name, logo] of cases) {
    extra = { brand };
    await page.goto(site.page.origin);
    await expect(heading(page), label).toHaveText(name);
    await expect(warn(page), label).toHaveCount(count);
    if (logo) await expectLogo(page, `${site.page.origin}/static/acme.svg`);
    else await expectDefault(page, name);
    const text = (await warnings(page).textContent()) ?? '';
    for (const value of [foreignHost, 'logo.png', 'user:pw', 'alert(1)']) expect(text, `${label}: a warning never repeats a value`).not.toContain(value);
    expect(await page.getByRole('alert').count(), `${label}: a warning is not a startup failure`).toBe(0);
    expect((await metas(page)).map((meta) => swap(meta, site)).slice(1), label).toEqual([policy]);
  }
  // A theme problem and a brand problem together both show, theme first.
  extra = { theme: { sepia: {} }, brand: { logo: `${site.foreign.origin}/logo.png` } };
  await page.goto(site.page.origin);
  await expect(warn(page)).toHaveCount(2);
  await expect(warn(page).first()).toContainText('theme');
  await expect(warn(page).last()).toContainText('brand.logo');

  // The agent still runs, and nothing went to the other origin.
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.foreign.seen).toEqual([]);
  expect(requested.filter((url) => url.startsWith(site.foreign.origin) || url.includes('other.example'))).toEqual([]);
  expect(await violations()).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// A valid logo that does not load
// ---------------------------------------------------------------------------------------------

test('a logo that is missing, is not an image or redirects to another origin shows the default mark and a warning', async ({ page, openSite }) => {
  const files: Record<string, { type: string; body: string; redirect?: string }> = { ...FILES };
  let brand: object = {};
  const site = await openSite({ config: hostedConfig(() => ({ brand })), files });
  files['/go'] = { type: 'text/plain', body: '', redirect: `${site.foreign.origin}/logo.png` };
  for (const logo of ['/missing.svg', '/static/not-an-image.svg', '/go']) {
    brand = { name: 'Acme', logo };
    await page.goto(site.page.origin);
    await expect(warn(page), logo).toHaveCount(1);
    await expect(warnings(page), logo).toContainText(FAILED);
    await expectDefault(page, 'Acme');
    expect(site.foreign.seen, logo).toEqual([]);
  }
});

test('a dark logo that is missing warns at once, and only the dark theme shows the default mark', async ({ page, openSite }) => {
  let brand: object = { logo: '/static/acme.svg', logoDark: '/missing-dark.svg' };
  const site = await openSite({ config: hostedConfig(() => ({ brand })), files: FILES });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(site.page.origin);
  await expect(warn(page)).toHaveCount(1);
  await expect(warnings(page)).toContainText('brand.logoDark could not be loaded; the default mark is shown');
  await expectLogo(page, `${site.page.origin}/static/acme.svg`);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(defaultMark(page)).toHaveCount(1);
  await expect(visibleLogos(page)).toHaveCount(0);
  brand = { logo: '/static/acme.svg' };
  await page.goto(site.page.origin);
  await expectLogo(page, `${site.page.origin}/static/acme.svg`);
});

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

test('a very long name and a very wide logo keep the top bar on its row, on a desktop and on a phone', async ({ page, openSite }) => {
  const wide = `data:image/svg+xml;base64,${Buffer.from(svg('#c2410c', 2000, 20)).toString('base64')}`;
  let brand: object = {};
  const site = await openSite({ config: hostedConfig(() => ({ brand })) });
  const facts = () =>
    page.evaluate(() => {
      const bar = (document.querySelector('.agui-app-bar') as HTMLElement).getBoundingClientRect();
      const name = document.querySelector('.agui-app-brand h1') as HTMLElement;
      const image = document.querySelector('.agui-app-logo-img') as HTMLElement | null;
      return {
        barHeight: Math.round(bar.height),
        brandTop: Math.round((document.querySelector('.agui-app-brand') as HTMLElement).getBoundingClientRect().top),
        cut: name.scrollWidth > name.clientWidth,
        logoWidth: image === null ? 0 : image.getBoundingClientRect().width,
        scrolls: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
    await page.setViewportSize(size);
    brand = {};
    await page.goto(site.page.origin);
    await expect(heading(page)).toHaveText('agui-inspector');
    const plain = await facts();
    brand = { name: 'N'.repeat(300), logo: wide };
    await page.goto(site.page.origin);
    await expect(heading(page)).toHaveText('N'.repeat(300));
    await expect(visibleLogos(page)).toHaveCount(1);
    const branded = await facts();
    const where = `${size.width}px`;
    expect(branded.barHeight, where).toBe(plain.barHeight);
    expect(branded.brandTop, where).toBe(plain.brandTop);
    expect(branded.cut, `${where}: the name is cut with an ellipsis`).toBe(true);
    expect(branded.logoWidth, where).toBeLessThanOrEqual(Math.min(160, size.width * 0.3) + 0.5);
    expect(branded.scrolls, where).toBe(false);
  }
});
