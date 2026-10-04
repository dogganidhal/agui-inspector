// The run waterfall in a real browser (specs/011-run-waterfall, US1, US3, US4, US5, SC-004, SC-005, SC-008, SC-010). The
// fixture host streams the reference agent's delegation run through the real frame reader and store into the real
// Inspection view, so each check is about what a developer sees and can do: watch rows grow while frames arrive, read a
// stopped run, walk the tree with the keyboard alone, follow a row to its frames, and stay responsive on the 5,000-frame
// workload.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { delegationRun, type TimedEvent } from '../../../examples/reference-agent/delegation-run.ts';
import { generateFixture } from '../../benchmarks/generate.ts';
import { bundleOptions } from '../../../scripts/build.mjs';

type Waterfall = Window['__waterfall'];
declare global {
  interface Window {
    __waterfall: {
      open(id: string, options?: { input?: object; transport?: string }): void;
      push(exchangeId: string, event: object | string, offsetMs: number): void;
      close(exchangeId: string, transport?: string, elapsedMs?: number): void;
      play(id: string, events: readonly TimedEvent[], options?: { threadId?: string; live?: boolean; transport?: string; elapsedMs?: number }): void;
      loadWorkload(exchanges: ReadonlyArray<{ id: string; runId: string; envelopes: readonly string[] }>): void;
      setThread(threadId: string | undefined): void;
      session(): { frames: unknown[] };
    };
    __keyAt: number;
  }
}

const root = path.resolve(import.meta.dirname, '..', '..', '..');

interface Site {
  origin: string;
}

const test = base.extend<{ requested: string[] }, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'waterfall-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'inspection', 'waterfall-fixture.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>waterfall fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
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
  requested: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await use(urls);
  },
});

const DELEGATION = delegationRun({ threadId: 't1', runId: 'ex1' });

const inspectionTabs = (page: Page) => page.getByRole('group', { name: 'Inspection view' });
const tree = (page: Page) => page.getByRole('tree', { name: 'Run waterfall' });
const rows = (page: Page) => tree(page).getByRole('treeitem');
const row = (page: Page, name: RegExp | string) => tree(page).getByRole('treeitem', { name });
const details = (page: Page) => page.getByRole('region', { name: 'Row details' });

async function open(page: Page, site: Site): Promise<void> {
  await page.goto(site.origin);
  await page.waitForFunction(() => '__waterfall' in window);
}
const showWaterfall = async (page: Page) => {
  await inspectionTabs(page).getByRole('button', { name: 'Waterfall', exact: true }).click();
  await expect(page.locator('[data-view="waterfall"]')).toBeVisible();
};
const play = (page: Page, id: string, events: readonly TimedEvent[], options: Parameters<Waterfall['play']>[2] = {}) =>
  page.evaluate(([exchange, list, opts]) => window.__waterfall.play(exchange as string, list as TimedEvent[], opts as never), [id, events, options] as const);
const startLive = (page: Page, id: string) => page.evaluate((exchange) => window.__waterfall.open(exchange, { input: { threadId: 't1', runId: exchange } }), id);
const pushOne = (page: Page, id: string, { atMs, event }: TimedEvent) => page.evaluate(([exchange, at, body]) => window.__waterfall.push(exchange as string, body as object, at as number), [id, atMs, event] as const);
const names = (locator: Locator) => locator.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));

/** Presses Tab until the locator has focus, so the test never uses the pointer. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`focus never reached ${String(target)}`);
}
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');

test('rows appear as frames arrive, and a bar closes when its end frame arrives', async ({ page, site }) => {
  await open(page, site);
  await showWaterfall(page);
  await expect(page.getByText('No run in this thread yet.')).toBeVisible();
  await startLive(page, 'ex1');

  const upTo = (count: number) => DELEGATION.slice(0, count);
  const index = (type: string, key?: string) => DELEGATION.findIndex(({ event }) => event.type === type && (key === undefined || Object.values(event).includes(key)));

  for (const event of upTo(index('STEP_STARTED', 'plan') + 1)) await pushOne(page, 'ex1', event);
  await expect(row(page, /^run, ex1,/)).toContainText('Streaming');
  await expect(row(page, /^step, plan,/)).toContainText('running', { timeout: 1000 });

  for (const event of DELEGATION.slice(index('STEP_STARTED', 'plan') + 1, index('TEXT_MESSAGE_START', 'm-plan') + 1)) await pushOne(page, 'ex1', event);
  await expect(row(page, /^text, assistant,/)).toHaveAttribute('data-open', 'true', { timeout: 1000 });
  await expect(row(page, /^text, assistant,/)).toContainText('running');

  const endAt = index('TEXT_MESSAGE_END', 'm-plan');
  for (const event of DELEGATION.slice(index('TEXT_MESSAGE_START', 'm-plan') + 1, endAt + 1)) await pushOne(page, 'ex1', event);
  await expect(row(page, /^text, assistant,/)).toHaveAttribute('aria-label', 'text, assistant, level 3, started +0.350, ended +0.450, 100 ms', { timeout: 1000 });
  await expect(row(page, /^text, assistant,/)).not.toHaveAttribute('data-open', /.*/);
  await expect(row(page, /^step, plan,/)).toContainText('running', { timeout: 1000 });

  for (const event of DELEGATION.slice(endAt + 1)) await pushOne(page, 'ex1', event);
  await page.evaluate(() => window.__waterfall.close('ex1', 'completed', 1900));
  await expect(row(page, /^run, ex1,/)).toContainText('Finished');
  await expect(row(page, /^run, ex1,/)).toHaveAttribute('aria-label', /ended \+1\.800, 1\.70 s/);
  await expect(page.locator('[data-open="true"]')).toHaveCount(0);
});

test('a stream cut before RUN_FINISHED leaves open rows that say no end seen and no end time', async ({ page, site }) => {
  await open(page, site);
  await showWaterfall(page);
  await play(page, 'ex1', DELEGATION.slice(0, 24), { transport: 'user-stopped' });
  await expect(row(page, /^run, ex1,/)).toContainText('Stopped by you');
  await expect(row(page, /^subagent, researcher,/)).toContainText('no end seen');
  const openRows = page.locator('[role="treeitem"][data-open="true"]');
  await expect.poll(async () => (await names(rows(page))).filter((label) => label.includes('no end seen')).length).toBeGreaterThan(1);
  const labels = await names(rows(page));
  expect(labels.filter((label) => label.includes('running'))).toEqual([]);
  expect(labels.filter((label) => label.includes('no end seen') && label.includes('ended +'))).toEqual([]);
  await expect(openRows).not.toHaveCount(0);
});

test('a selection and a closed step stay as they were while more frames arrive', async ({ page, site }) => {
  await open(page, site);
  await showWaterfall(page);
  await startLive(page, 'ex1');
  for (const event of DELEGATION.slice(0, 30)) await pushOne(page, 'ex1', event);
  await row(page, /^step, research,/).click();
  await row(page, /^step, research,/).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, /^step, research,/)).toHaveAttribute('aria-expanded', 'false');
  const before = await rows(page).count();

  await page.evaluate(() => {
    for (let i = 0; i < 100; i += 1) window.__waterfall.push('ex1', { type: 'CUSTOM', name: 'tick', value: i }, 3000 + i);
  });
  for (const event of DELEGATION.slice(30)) await pushOne(page, 'ex1', event);
  await expect(row(page, /^step, answer,/)).toBeVisible();
  await expect(row(page, /^step, research,/)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, /^step, research,/)).toHaveAttribute('aria-expanded', 'false');
  expect(await rows(page).count()).toBeGreaterThan(before - 1);
  await expect(details(page)).toContainText('research');
});

test('from the keyboard alone: reach the tree, walk every row, open and close a step, jump to both ends', async ({ page, site, requested }) => {
  await open(page, site);
  await showWaterfall(page);
  await play(page, 'ex1', DELEGATION, { elapsedMs: 1900 });
  await expect(rows(page)).toHaveCount(16);

  const first = rows(page).first();
  await tabTo(page, first);
  expect(await first.evaluate((node) => getComputedStyle(node).outlineStyle), 'focus is visible').not.toBe('none');
  // One tab stop for the whole tree: the next Tab leaves it.
  await page.keyboard.press('Tab');
  expect(await tree(page).evaluate((node) => node.contains(document.activeElement))).toBe(false);
  await page.keyboard.press('Shift+Tab');
  await expect(first).toBeFocused();

  const labels = await names(rows(page));
  expect(labels[0]).toMatch(/^run, ex1, level 1, started \+0\.100, ended \+1\.800/);
  expect(labels.some((label) => label.startsWith('text, assistant, level 6,')), 'the deepest row, in the inner subagent run, is level 6').toBe(true);
  for (let i = 0; i < labels.length; i += 1) {
    if (i > 0) await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe(labels[i]);
    await expect(rows(page).nth(i)).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page).filter({ has: page.locator('xpath=self::*[@tabindex="0"]') })).toHaveCount(1);
    await expect(details(page)).toHaveAttribute('data-details', (await rows(page).nth(i).getAttribute('data-row-id')) ?? '');
  }
  await page.keyboard.press('ArrowDown');
  expect(await focused(page), 'no wrap past the last row').toBe(labels.at(-1));

  await page.keyboard.press('Home');
  expect(await focused(page)).toBe(labels[0]);
  await page.keyboard.press('End');
  expect(await focused(page)).toBe(labels.at(-1));

  // A step: left closes it, right opens it, right again steps into it, left from a child steps out.
  await row(page, /^step, research,/).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, /^step, research,/)).toHaveAttribute('aria-expanded', 'false');
  await expect(rows(page)).toHaveCount(8);
  await page.keyboard.press('ArrowRight');
  await expect(row(page, /^step, research,/)).toHaveAttribute('aria-expanded', 'true');
  await expect(rows(page)).toHaveCount(16);
  await page.keyboard.press('ArrowRight');
  expect(await focused(page)).toMatch(/^tool, search_documents, level 3,/);
  await page.keyboard.press('ArrowRight');
  expect(await focused(page), 'the subagent run is inside the call that started it').toMatch(/^subagent, researcher, level 4,/);
  // Left closes an open row first and steps to the parent from a closed one.
  await page.keyboard.press('ArrowLeft');
  await expect(row(page, /^subagent, researcher,/)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toMatch(/^tool, search_documents, level 3,/);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await focused(page)).toMatch(/^step, research, level 2,/);

  // Typing in the composer does not move the tree.
  const composer = page.getByRole('textbox', { name: 'Composer' });
  await composer.focus();
  await page.keyboard.type('abc');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await expect(composer).toHaveValue('abc');
  await expect(row(page, /^step, research,/)).toHaveAttribute('aria-selected', 'true');
  expect(requested.filter((url) => !url.startsWith(site.origin))).toEqual([]);
});

test('Enter and the frame buttons show the row in the frames list, and the waterfall keeps its selection and closed rows', async ({ page, site }) => {
  await open(page, site);
  await showWaterfall(page);
  await play(page, 'ex1', DELEGATION, { elapsedMs: 1900 });
  await row(page, /^step, plan,/).focus();
  await page.keyboard.press('ArrowLeft');
  await row(page, /^tool, search_documents,/).focus();
  await page.keyboard.press('Enter');

  await expect(inspectionTabs(page).getByRole('button', { name: 'Frames', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('TOOL_CALL_START');
  await expect(current).toBeFocused();

  await showWaterfall(page);
  await expect(row(page, /^tool, search_documents,/)).toHaveAttribute('aria-selected', 'true');
  await expect(row(page, /^step, plan,/)).toHaveAttribute('aria-expanded', 'false');

  await row(page, /^subagent, researcher,/).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-current="true"]')).toContainText('SUBAGENT_STARTED');
  await showWaterfall(page);
  await row(page, /^tool, search_documents,/).focus();

  const last = details(page).getByRole('button', { name: /^Show frame #\d+ in the frames list$/ }).last();
  await expect(details(page)).toContainText('Arguments complete');
  await last.click();
  await expect(page.locator('[aria-current="true"]')).toContainText('TOOL_CALL_RESULT');
});

test('a new thread starts the waterfall again', async ({ page, site }) => {
  await open(page, site);
  await showWaterfall(page);
  await play(page, 'ex1', DELEGATION, { elapsedMs: 1900 });
  await row(page, /^step, plan,/).click();
  await expect(row(page, /^step, plan,/)).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => window.__waterfall.setThread('t2'));
  await expect(page.getByText('No run in this thread yet.')).toBeVisible();
  await expect(details(page)).toContainText('Select a row');
  await page.evaluate(() => window.__waterfall.setThread('t1'));
  await expect(rows(page)).toHaveCount(16);
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(0);
});

test('the 5,000-frame workload opens fast and keyboard moves stay under 200 ms', async ({ page, site }) => {
  await open(page, site);
  const exchanges = generateFixture().map((exchange) => ({ id: `bench-${exchange.index}`, runId: exchange.runId, envelopes: exchange.frames.map((frame) => frame.envelope) }));
  await page.evaluate((list) => window.__waterfall.loadWorkload(list), exchanges);
  await page.waitForFunction(() => window.__waterfall.session().frames.length === 5000);

  const clicked = Date.now();
  await showWaterfall(page);
  await expect(rows(page).first()).toBeVisible();
  const opened = Date.now() - clicked;
  console.log(`waterfall tab over 5,000 frames: opened in ${opened} ms, ${await rows(page).count()} rows visible`);
  expect(opened, 'opening the tab').toBeLessThan(1000);

  await page.evaluate(() => document.addEventListener('keydown', () => (window.__keyAt = performance.now()), true));
  await rows(page).first().focus();
  const samples: number[] = [];
  for (let i = 0; i < 100; i += 1) {
    await page.keyboard.press(i % 20 < 10 ? 'ArrowDown' : 'ArrowUp');
    samples.push(await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - window.__keyAt))))));
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor(samples.length * 0.95) - 1] as number;
  console.log(`waterfall key moves over 5,000 frames: p95 ${p95.toFixed(1)} ms, max ${samples.at(-1)?.toFixed(1)} ms`);
  expect(p95, 'the 95th percentile of a key move').toBeLessThan(200);
});

// ---------------------------------------------------------------------------------------------
// Contrast (FR-016, SC-010): the text of the waterfall and its bars, in both default themes, at WCAG 2.2 AA
// ---------------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
const AA_TEXT = 4.5;
const AA_GRAPHIC = 3;

/** WCAG 2.2 relative luminance of an opaque sRGB color. */
function luminance([r, g, b]: Rgb): number {
  const linear = (value: number) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The foreground and the effective background of every element the locator matches, in sRGB: each CSS color goes through a
 * canvas pixel, and translucent fills are composited up to the first opaque one. A background image cannot be measured
 * this way, so it throws instead of guessing (the text of the waterfall never sits on one).
 */
const paint = (locator: Locator) =>
  locator.evaluateAll((nodes) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const toRgba = (css: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data as unknown as [number, number, number, number];
      return [r, g, b, a / 255];
    };
    const over = (top: number[], base: number[]): number[] => {
      const alpha = top[3] as number;
      return [0, 1, 2].map((i) => (top[i] as number) * alpha + (base[i] as number) * (1 - alpha)).concat(1);
    };
    return nodes.map((node) => {
      const fills: number[][] = [];
      let opaque = false;
      for (let at: Element | null = node; at && !opaque; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== 'none') throw new Error(`${at.tagName} paints a background image`);
        const fill = toRgba(style.backgroundColor);
        if ((fill[3] as number) > 0) fills.push(fill);
        opaque = fill[3] === 1;
      }
      if (!opaque) throw new Error('no opaque background behind the text');
      const background = fills.reverse().reduce((base, fill) => over(fill, base));
      const color = toRgba(getComputedStyle(node).color);
      const foreground = over(color, background);
      return { text: (node.textContent ?? '').trim(), foreground: foreground.slice(0, 3).map(Math.round) as unknown as Rgb, background: background.slice(0, 3).map(Math.round) as unknown as Rgb };
    });
  });

/** The color a theme token resolves to under the page's current theme, and the color of the first track. */
const graphics = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const toRgb = (css: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const root = document.getElementById('root') as HTMLElement;
    const token = (name: string): number[] => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      root.append(probe);
      const rgb = toRgb(getComputedStyle(probe).color);
      probe.remove();
      return rgb;
    };
    const track = document.querySelector('.agui-wf-track') as HTMLElement;
    return { track: toRgb(getComputedStyle(track).backgroundColor), tokens: Object.fromEntries(['--f-text', '--f-reason', '--f-tool', '--f-neutral'].map((name) => [name, token(name)])) };
  });

/** Every text of the waterfall under AA, and every bar color against its track. */
async function expectReadable(page: Page): Promise<void> {
  const text = page.locator(
    '.agui-wf-kind, .agui-wf-label, .agui-wf-subject, .agui-wf-time, .agui-wf-time .agui-tag, .agui-wf-axis-track span, .agui-wf-details h4 span, .agui-wf-details .agui-tag, .agui-wf-details dt, .agui-wf-details dd, .agui-wf-details p, .agui-wf-ref',
  );
  const painted = await paint(text);
  expect(painted.length).toBeGreaterThan(30);
  const low = painted.filter(({ text: words, foreground, background }) => words !== '' && contrast(foreground, background) < AA_TEXT).map(({ text: words, foreground, background }) => `"${words}" ${foreground} on ${background}`);
  expect(low, 'text below 4.5:1').toEqual([]);
  const selected = await paint(page.locator('.agui-wf-row[aria-selected="true"] .agui-wf-label'));
  expect(contrast(selected[0]!.foreground, selected[0]!.background), 'the selected row').toBeGreaterThanOrEqual(AA_TEXT);
  const { track, tokens } = await graphics(page);
  for (const [name, color] of Object.entries(tokens)) expect(contrast(color as unknown as Rgb, track as unknown as Rgb), `${name} against the track`).toBeGreaterThanOrEqual(AA_GRAPHIC);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`the text and the bars of the waterfall reach AA contrast in the default ${scheme} theme, and open, waiting and error states are words`, async ({ page, site }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, site);
    await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);
    await showWaterfall(page);

    // A run stopped by the user, with open rows. Ids are unique within a thread, so the finished run is in another thread.
    await play(page, 'ex1', delegationRun({ threadId: 't1', runId: 'ex1' }).slice(0, 24), { transport: 'user-stopped' });
    await row(page, /^tool, search_documents,/).click();
    await expect(details(page)).toContainText('Arguments complete');
    await expectReadable(page);
    await expect(row(page, /^run, ex1,/)).toContainText('Stopped by you');
    await expect(rows(page).filter({ hasText: 'no end seen' }).first()).toBeVisible();

    // A finished run with a call that waits for its result.
    await play(page, 'ex2', delegationRun({ threadId: 't2', runId: 'ex2' }), { threadId: 't2', elapsedMs: 1900 });
    await page.evaluate(() => window.__waterfall.setThread('t2'));
    await row(page, /^tool, pick_color,/).click();
    await expect(details(page)).toContainText('waiting for result');
    await expectReadable(page);
    await expect(row(page, /^run, ex2,/)).toContainText('Finished');
    await expect(row(page, /^tool, pick_color,/)).toContainText('waiting for result');
  });
}
