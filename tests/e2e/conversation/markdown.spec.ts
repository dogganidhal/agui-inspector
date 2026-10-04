// Spec 012 (US1 to US4, FR-005 to FR-011, FR-013, SC-002 to SC-004): Markdown on demand in a real browser. The
// fixture host streams scripted events through the real frame reader and store, as events.spec.ts does, but this page is
// served with the production content security policy (`contentSecurityPolicy()`, not events.spec.ts's `script-src` only),
// so a violation of `style-src` or `img-src` would really show. A script canary, a violation listener and a request log
// watch hostile text; hashes of the recording and the markup of the evidence nodes watch the toggle itself.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';
import { contentSecurityPolicy } from '../../../packages/inspector/src/app/security.ts';
import { HOSTILE } from '../../../packages/inspector/tests/conversation/hostile.ts';

/** The script API packages/inspector/tests/conversation/fixture.tsx puts on window, as far as this spec uses it. */
interface Conversation {
  open(id: string, options?: { input?: object }): void;
  push(exchangeId: string, event: object | string, offsetMs: number): void;
  close(exchangeId: string, transport?: string): void;
  session(): unknown;
}

declare global {
  interface Window {
    __pwned?: number;
    __violations: Array<{ directive: string; blocked: string }>;
  }
}

/** `page.evaluate` sends the function text to the page, so it cannot call a helper from this file: it casts `window` itself. */
type Host = Window & { __conversation: Conversation };

const root = path.resolve(import.meta.dirname, '..', '..', '..');

interface Site {
  origin: string;
}

const test = base.extend<object, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'markdown-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'conversation', 'fixture.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>conversation fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
      };
      let origin = '';
      const server: Server = createServer((request, response) => {
        const hit = files[new URL(request.url ?? '/', 'http://x').pathname];
        // The policy the app puts on itself when it is embedded: this page's own origin and nothing else.
        const policy = contentSecurityPolicy({ mode: 'embedded', pageOrigin: origin, allowedOrigins: [] });
        response.writeHead(hit ? 200 : 404, { 'content-type': hit?.[0] ?? 'text/plain', 'content-security-policy': policy });
        response.end(hit?.[1] ?? 'not found');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      await use({ origin });
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

const STARTED = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const FINISHED = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } };

/**
 * The violation log is in place before any script of the page runs. zod probes `new Function('')` once, inside a try/catch,
 * to choose its non-JIT path, and the policy reports the blocked probe. Nothing is evaluated, so `violations` leaves that
 * one out, as tests/e2e/hosted/support.ts does, and every other kind of violation is a failure.
 */
const violations = async (page: Page) => (await page.evaluate(() => window.__violations)).filter((violation) => violation.blocked !== 'eval');

async function open(page: Page, site: Site, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.addInitScript(() => {
    window.__violations = [];
    document.addEventListener('securitypolicyviolation', (event) => window.__violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
  });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(site.origin);
  await page.waitForFunction(() => '__conversation' in window);
}

const start = (page: Page, id: string, runId = id) =>
  page.evaluate(([exchange, run]) => (window as Host).__conversation.open(exchange as string, { input: { threadId: 't1', runId: run as string } }), [id, runId]);

const send = (page: Page, id: string, events: ReadonlyArray<object | string>, from = 10) =>
  page.evaluate(([exchange, list, offset]) => (list as Array<object | string>).forEach((event, i) => (window as Host).__conversation.push(exchange as string, event, (offset as number) + i * 10)), [id, events, from]);

const end = (page: Page, id: string) => page.evaluate((exchange) => (window as Host).__conversation.close(exchange, 'completed'), id);

const say = (id: string, text: string, role = 'assistant') => [
  { type: 'TEXT_MESSAGE_START', messageId: id, role },
  { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text },
  { type: 'TEXT_MESSAGE_END', messageId: id },
];

const section = (page: Page) => page.locator('[data-view="conversation"]');
const markdownButton = (page: Page) => page.getByRole('button', { name: 'Markdown', exact: true });
const plainButton = (page: Page) => page.getByRole('button', { name: 'Plain text', exact: true });
const messages = (page: Page) => page.locator('[data-view="conversation"] [data-entry="message"]');

/** A SHA-256 of what the page recorded, read through the same snapshot the views read. */
const recording = async (page: Page) => createHash('sha256').update(await page.evaluate(() => JSON.stringify((window as Host).__conversation.session()))).digest('hex');

// ---- the default and the control ----

test('a fresh page is plain text, and the control turns Markdown on and off', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...say('m1', '# Title\n\n- *one*\n- **two**\n\n`code`'), FINISHED]);
  await end(page, 'ex1');

  await expect(section(page)).toHaveAttribute('data-text-mode', 'plain');
  await expect(page.getByRole('group', { name: 'Message text' })).toBeVisible();
  await expect(plainButton(page)).toHaveAttribute('aria-pressed', 'true');
  const body = messages(page).locator('.agui-conv-body');
  await expect(body).toHaveText('# Title\n\n- *one*\n- **two**\n\n`code`');
  await expect(body.locator('.agui-md')).toHaveCount(0);

  await markdownButton(page).click();
  await expect(section(page)).toHaveAttribute('data-text-mode', 'markdown');
  await expect(markdownButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(body.getByRole('heading', { name: 'Title', level: 3 })).toBeVisible();
  await expect(body.getByRole('listitem')).toHaveText(['one', 'two']);
  await expect(body.locator('em')).toHaveText('one');
  await expect(body.locator('strong')).toHaveText('two');
  await expect(body.locator('code')).toHaveText('code');

  await plainButton(page).click();
  await expect(body).toHaveText('# Title\n\n- *one*\n- **two**\n\n`code`');
  await expect(body.locator('.agui-md')).toHaveCount(0);
});

test('the control is there for an empty conversation, and a reload starts in plain text', async ({ page, site }) => {
  await open(page, site);
  await expect(page.getByText('No conversation yet')).toBeVisible();
  await markdownButton(page).click();
  await expect(section(page)).toHaveAttribute('data-text-mode', 'markdown');
  await page.reload();
  await page.waitForFunction(() => '__conversation' in window);
  await expect(section(page)).toHaveAttribute('data-text-mode', 'plain');
});

test('a tool message and everything that is not message or reasoning text stays as it was', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'tool1', role: 'tool', toolCallId: 'none', content: '{"k": *1*}' }, { id: 'u1', role: 'user', content: '*user*' }] },
    { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'search' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"q": "*x*"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'c1' },
    { type: 'CUSTOM', name: 'note', value: '**custom**' },
    FINISHED,
  ]);
  await end(page, 'ex1');
  const everything = section(page).locator('[data-entry="tool"], [data-entry="custom"], [data-role="tool"] .agui-conv-body');
  await expect(everything).toHaveCount(3);
  const before = await everything.allInnerTexts();
  const markup = () => everything.evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
  const beforeMarkup = await markup();
  await markdownButton(page).click();
  await expect(messages(page).filter({ hasText: 'user' }).locator('em')).toHaveText('user');
  expect(await everything.allInnerTexts()).toEqual(before);
  expect(await markup()).toEqual(beforeMarkup);
  await expect(page.locator('[data-role="tool"] .agui-md')).toHaveCount(0);
});

// ---- hostile text ----

test('hostile text with Markdown on: nothing runs, nothing is requested, no policy is violated', async ({ page, site, context }) => {
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));

  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...HOSTILE.flatMap((text, i) => say(`m${i}`, text)), FINISHED]);
  await end(page, 'ex1');
  await expect(messages(page)).toHaveCount(HOSTILE.length);
  await markdownButton(page).click();
  await expect(section(page)).toHaveAttribute('data-text-mode', 'markdown');
  await expect(messages(page).locator('.agui-md')).not.toHaveCount(0);
  // Something has to have been drawn for the last sample too before the page is read.
  await expect(messages(page).last()).toBeVisible();

  const found = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll('[data-view="conversation"] [data-entry="message"] .agui-conv-body')];
    const inside = (selector: string) => bodies.flatMap((body) => [...body.querySelectorAll(selector)]);
    return {
      active: inside('img, iframe, script, style, form, input, object, embed, video, audio, source, link, svg, base, meta').map((node) => node.tagName),
      styled: inside('[style]').length,
      handlers: inside('*').flatMap((node) => node.getAttributeNames().filter((name) => name.startsWith('on'))),
      hrefs: inside('a').map((node) => node.getAttribute('href')),
      opener: inside('a').map((node) => node.getAttribute('rel')),
      pwned: window.__pwned,
    };
  });
  expect(found.active).toEqual([]);
  expect(found.styled).toBe(0);
  expect(found.handlers).toEqual([]);
  expect(found.pwned).toBeUndefined();
  expect(await violations(page)).toEqual([]);
  for (const href of found.hrefs) expect(href).toMatch(/^(https?:|mailto:)/);
  for (const rel of found.opener) expect(rel).toBe('noopener noreferrer');
  expect(problems).toEqual([]);
  expect(requests.filter((url) => new URL(url).origin !== site.origin), 'every request went to the page\'s own origin').toEqual([]);
});

test('a table with column alignment draws no inline style, which the page policy would block', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...say('m1', '| left | mid | right |\n|:--|:-:|--:|\n| 1 | 2 | 3 |'), FINISHED]);
  await end(page, 'ex1');
  await expect(messages(page)).toHaveCount(1);
  await markdownButton(page).click();
  const cell = messages(page).locator('td[data-align="right"]');
  await expect(cell).toHaveText('3');
  expect(await cell.evaluate((node) => getComputedStyle(node).textAlign)).toBe('right');
  expect(await violations(page), 'an inline style would be reported against style-src').toEqual([]);
});

test('an allowed link opens only when activated, in a tab that cannot reach back, with no referrer', async ({ page, site, context }) => {
  const reached: Array<{ url: string; referer: string | undefined }> = [];
  await context.route('https://example.test/**', (route) => {
    reached.push({ url: route.request().url(), referer: route.request().headers().referer });
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>landing</title><p>landing</p>' });
  });
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...say('m1', 'See [the docs](https://example.test/landing) now.'), FINISHED]);
  await end(page, 'ex1');
  await markdownButton(page).click();
  const link = messages(page).getByRole('link', { name: 'the docs' });
  await expect(link).toHaveAttribute('href', 'https://example.test/landing');
  await expect(messages(page).locator('.agui-md-dest')).toHaveText('(https://example.test/landing)');
  expect(reached, 'nothing is requested before the link is activated').toEqual([]);

  const before = await recording(page);
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe('https://example.test/landing');
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  expect(reached).toEqual([{ url: 'https://example.test/landing', referer: undefined }]);
  expect(page.url()).toBe(`${site.origin}/`);
  expect(await recording(page), 'the capture is still in the page, untouched').toBe(before);
});

// ---- live text, the recording, the evidence ----

test('text that is still streaming formats as it grows, and the mode and the recording survive', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  const delta = (text: string) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: text });
  await send(page, 'ex1', [STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, delta('# Plan\n\n```ts\nconst a')]);
  await markdownButton(page).click();
  const body = messages(page).locator('.agui-conv-body');
  await expect(body.getByRole('heading', { name: 'Plan' })).toBeVisible();
  await expect(body.locator('pre')).toHaveText('const a');
  await expect(body.locator('.agui-md')).toBeVisible();
  await expect(messages(page).locator('.agui-caret')).toBeVisible();

  await send(page, 'ex1', [delta(' = 1;\n```\n\n| a | b |\n|'), delta('---|---|\n| 1 | 2 |\n')], 50);
  await expect(body.locator('pre')).toHaveText('const a = 1;');
  await expect(body.getByRole('table')).toBeVisible();
  await expect(body.getByRole('cell')).toHaveText(['1', '2']);

  await send(page, 'ex1', [{ type: 'TEXT_MESSAGE_END', messageId: 'm1' }, FINISHED], 80);
  await end(page, 'ex1');
  await expect(messages(page).locator('.agui-caret')).toHaveCount(0);

  // The recording, and the nodes that hold the evidence, are the same in both modes.
  const evidence = () => messages(page).locator('.agui-conv-who, .agui-conv-deltas').evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
  const onRecording = await recording(page);
  const onEvidence = await evidence();
  await plainButton(page).click();
  await expect(body.locator('.agui-md')).toHaveCount(0);
  expect(await recording(page)).toBe(onRecording);
  expect(await evidence()).toEqual(onEvidence);
  await markdownButton(page).click();
  await expect(body.locator('.agui-md')).toBeVisible();
  expect(await recording(page)).toBe(onRecording);
  expect(await evidence()).toEqual(onEvidence);
  await expect(messages(page).getByText('2 deltas').or(messages(page).getByText('3 deltas'))).toBeVisible();

  // A later run keeps the mode and its text formats too.
  await start(page, 'ex2', 'r2');
  await send(page, 'ex2', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, ...say('m2', 'second **run**'), { type: 'RUN_FINISHED', threadId: 't1', runId: 'r2', outcome: { type: 'success' } }]);
  await end(page, 'ex2');
  await expect(section(page)).toHaveAttribute('data-text-mode', 'markdown');
  await expect(messages(page).last().locator('strong')).toHaveText('run');
});

test('reasoning text formats, and chunk text opened by a chunk event keeps its tag', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'REASONING_START', messageId: 'rs1' },
    { type: 'REASONING_MESSAGE_START', messageId: 'rs1', role: 'reasoning' },
    { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rs1', delta: 'because `x` and **y**' },
    { type: 'REASONING_MESSAGE_END', messageId: 'rs1' },
    { type: 'REASONING_END', messageId: 'rs1' },
    { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm9', role: 'assistant', delta: 'from a *chunk*' },
    FINISHED,
  ]);
  await end(page, 'ex1');
  await markdownButton(page).click();
  const reasoning = page.locator('[data-entry="reasoning"] .agui-md');
  await expect(reasoning.locator('code')).toHaveText('x');
  await expect(reasoning.locator('strong')).toHaveText('y');
  await expect(messages(page).locator('em')).toHaveText('chunk');
  await expect(messages(page).getByText('from TEXT_MESSAGE_CHUNK')).toBeVisible();
});

// ---- keyboard, structure, small screens, contrast ----

const LONG_CODE = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
const WIDE_TABLE = `| ${Array.from({ length: 12 }, (_, i) => `column_number_${i + 1}`).join(' | ')} |\n|${'---|'.repeat(12)}\n| ${Array.from({ length: 12 }, (_, i) => `value_${i + 1}`).join(' | ')} |`;
const RICH = `# Top\n\n## Next\n\nA [link](https://example.test/a) in text.\n\n- one\n- two\n\n\`\`\`ts\n${LONG_CODE}\n\`\`\`\n\n${WIDE_TABLE}\n`;

async function focusSequence(page: Page, steps: number): Promise<string[]> {
  const seen: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => {
      const node = document.activeElement;
      return node ? `${node.tagName.toLowerCase()}|${node.getAttribute('role') ?? ''}|${node.getAttribute('aria-label') ?? ''}|${(node.textContent ?? '').trim().slice(0, 20)}` : 'none';
    }));
  }
  return seen;
}

test('the whole flow works from the keyboard: control, link, scrollable code and table, and back', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...say('m1', RICH), FINISHED]);
  await end(page, 'ex1');

  await page.keyboard.press('Tab');
  await expect(plainButton(page)).toBeFocused();
  expect(await plainButton(page).evaluate((node) => getComputedStyle(node).outlineStyle), 'the focus ring is drawn').not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(markdownButton(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(markdownButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(section(page)).toHaveAttribute('data-text-mode', 'markdown');

  const stops = await focusSequence(page, 3);
  expect(stops[0]).toMatch(/^a\|\|\|link/);
  expect(stops[1]).toMatch(/^pre\|region\|Code, ts\|/);
  expect(stops[2]).toMatch(/^div\|region\|Table\|/);

  // The code block is focusable, so the keyboard scrolls it.
  await page.keyboard.press('Shift+Tab');
  const code = page.locator('.agui-md pre.agui-code');
  await expect(code).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(() => code.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  const table = page.locator('.agui-md-scroll');
  await expect(table).toBeFocused();
  for (let i = 0; i < 6; i += 1) await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

  // Back to plain text, with the keyboard alone.
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(markdownButton(page)).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(plainButton(page)).toBeFocused();
  await page.keyboard.press('Space');
  await expect(section(page)).toHaveAttribute('data-text-mode', 'plain');
  await expect(plainButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('headings, lists, tables and links keep their native roles, and the page outline holds', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...say('m1', RICH), FINISHED]);
  await end(page, 'ex1');
  await markdownButton(page).click();
  const body = messages(page).locator('.agui-conv-body');
  await expect(body.getByRole('heading', { name: 'Top', level: 3 })).toBeVisible();
  await expect(body.getByRole('heading', { name: 'Next', level: 4 })).toBeVisible();
  await expect(body.getByRole('list')).toHaveCount(1);
  await expect(body.getByRole('table')).toHaveCount(1);
  await expect(body.getByRole('columnheader')).toHaveCount(12);
  await expect(body.getByRole('link', { name: 'link' })).toHaveAttribute('target', '_blank');
  await expect(section(page).locator('h1')).toHaveCount(0);
  await expect(section(page).locator('h2')).toHaveCount(1);
});

test('a narrow screen scrolls a wide table and a long code line inside their own boxes, not the page', async ({ page, site }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, ...say('m1', `${WIDE_TABLE}\n\n\`\`\`\n${'x'.repeat(300)}\n\`\`\``), FINISHED]);
  await end(page, 'ex1');
  await markdownButton(page).click();
  const table = page.locator('.agui-md-scroll');
  await expect(table).toBeVisible();
  expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth), 'the table scrolls in its box').toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'the page does not scroll sideways').toBe(true);
});

type Rgb = readonly [number, number, number];
const luminance = ([r, g, b]: Rgb) => {
  const linear = (value: number) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};
const contrast = (a: Rgb, b: Rgb) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

/** The computed text color and the opaque background painted behind it, as sRGB, read through a canvas pixel. */
const paint = (locator: Locator) =>
  locator.evaluate((node) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const rgba = (css: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
    };
    let at: Element | null = node;
    const fills: number[][] = [];
    while (at) {
      const fill = rgba(getComputedStyle(at).backgroundColor);
      if (fill[3] > 0) fills.push(fill);
      if (fill[3] === 255) break;
      at = at.parentElement;
    }
    const background = fills.reverse().reduce((base, top) => [0, 1, 2].map((i) => Math.round((top[i] as number) * ((top[3] as number) / 255) + (base[i] as number) * (1 - (top[3] as number) / 255))));
    const color = rgba(getComputedStyle(node).color);
    return { foreground: [color[0], color[1], color[2]] as Rgb, background: background as unknown as Rgb };
  });

for (const scheme of ['light', 'dark'] as const) {
  test(`the address, the image note and the link keep AA contrast in the ${scheme} theme`, async ({ page, site }) => {
    await open(page, site, scheme);
    await start(page, 'ex1');
    await send(page, 'ex1', [STARTED, ...say('m1', 'A [link](https://example.test/a) and ![alt](https://example.test/p.png).'), FINISHED]);
    await end(page, 'ex1');
    await markdownButton(page).click();
    for (const selector of ['.agui-md-link', '.agui-md-dest', '.agui-md-inert']) {
      const { foreground, background } = await paint(page.locator(`.agui-md ${selector}`).first());
      expect(contrast(foreground, background), `${selector} in ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
