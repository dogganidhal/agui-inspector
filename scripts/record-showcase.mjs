// Records the showcase loop for the README and the docs: three scenes played on the public demo, once per theme.
// Each scene is captured frame by frame with the Chromium screencast, then ffmpeg joins the scenes with short fades
// and img2webp writes the animated WebP. It replaces docs/images/showcase-<theme>.webp, which the README shows, and
// website/public/docs/showcase-<theme>.mp4, which the docs site plays. The frames stay in --out until the end.
//
//   node scripts/record-showcase.mjs [--url <demo page>] [--out <dir>]
//
// Needs Playwright's Chromium (npx playwright install chromium), ffmpeg and img2webp on the PATH.
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://dogganidhal.github.io/agui-inspector/' },
    out: { type: 'string', default: '.build/showcase' },
  },
});
const out = path.resolve(values.out);
const root = path.resolve(import.meta.dirname, '..');
const VIEWPORT = { width: 1200, height: 780 };
const FPS = 30;
const FADE = 0.5;
const WEBP = { width: 2400, fps: 12 };

/** Readies the page for filming: a visible pointer, since a click nobody sees reads as magic, and no demo notice strip. */
function stage() {
  addEventListener('DOMContentLoaded', () => {
    // The strip belongs to the demo page, not to the inspector this shows. CSSOM, not a style attribute: the page's
    // policy refuses inline styles.
    for (const strip of document.querySelectorAll('.demo-strip')) strip.style.display = 'none';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('viewBox', '0 0 22 22');
    const arrow = document.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M3 2 L3 18 L7.5 13.8 L10.6 20.4 L13.4 19.1 L10.4 12.6 L16.4 12.6 Z');
    arrow.setAttribute('fill', '#111');
    arrow.setAttribute('stroke', '#fff');
    arrow.setAttribute('stroke-width', '1.5');
    arrow.setAttribute('stroke-linejoin', 'round');
    svg.append(arrow);
    Object.assign(svg.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', display: 'none', transformOrigin: '3px 2px', transition: 'transform 90ms' });
    document.documentElement.append(svg);
    addEventListener('mousemove', (event) => Object.assign(svg.style, { display: 'block', left: `${event.clientX - 3}px`, top: `${event.clientY - 2}px` }), true);
    addEventListener('mousedown', () => (svg.style.transform = 'scale(0.8)'), true);
    addEventListener('mouseup', () => (svg.style.transform = ''), true);
  });
}

const pause = (page, ms) => page.waitForTimeout(ms);
const quick = (page, text) => page.getByRole('button', { name: text, exact: true });
const finished = (page) => page.locator('[data-view="conversation"]').getByText('Finished', { exact: true }).first().waitFor({ timeout: 20_000 });

/** Moves the pointer to the target with an eased glide, as a hand would, then clicks there. */
async function click(page, locator) {
  await locator.waitFor();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`nothing to click: ${locator}`);
  const from = page.pointerAt;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps = Math.round(Math.min(36, Math.max(14, Math.hypot(to.x - from.x, to.y - from.y) / 18)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * ease, from.y + (to.y - from.y) * ease);
    await pause(page, 14);
  }
  page.pointerAt = to;
  await pause(page, 160);
  await page.mouse.down();
  await pause(page, 80);
  await page.mouse.up();
}

const SCENES = {
  /** A run, one frame's bytes as received, then the request that started it. */
  async hello(page) {
    await pause(page, 700);
    await click(page, quick(page, 'Hello there'));
    await finished(page);
    await pause(page, 900);
    await click(page, page.locator('[data-frame-row]').filter({ hasText: '"Hello"' }).first());
    await pause(page, 1800);
    await click(page, page.locator('summary', { hasText: 'RunAgentInput' }).first());
    await pause(page, 2400);
  },
  /** Frames arriving live, on the timeline and in the list, until the run finishes by itself. */
  async slow(page) {
    await pause(page, 600);
    await click(page, quick(page, 'slow'));
    await finished(page);
    await pause(page, 1500);
  },
  /** An A2UI surface: the agent draws a form, the browser checks it, and submitting it sends the next run. */
  async a2ui(page) {
    await pause(page, 500);
    await click(page, page.getByRole('banner').getByRole('button', { name: /^Agent / }));
    await pause(page, 800);
    await click(page, page.getByRole('banner').getByRole('listitem').getByRole('button', { name: /A2UI showcase/ }));
    await pause(page, 600);
    await click(page, quick(page, 'Open a support ticket'));
    const form = page.locator('[data-surface="ticket"]');
    await form.getByRole('heading', { name: 'Contact support' }).waitFor();
    await pause(page, 1000);
    const email = form.getByRole('textbox', { name: 'Email' });
    await click(page, email);
    await email.pressSequentially('ana@example.com', { delay: 55 });
    const description = form.getByRole('textbox', { name: 'What happened?' });
    await click(page, description);
    await description.pressSequentially('The export button does nothing after the update.', { delay: 32 });
    // The rest of the form is below the pane's fold; scroll the way a reader would before sending.
    const send = form.getByRole('button', { name: 'Send ticket' });
    await send.evaluate((button) => button.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await pause(page, 900);
    await click(page, send);
    await page.getByRole('heading', { name: 'Ticket received' }).waitFor();
    await pause(page, 2800);
  },
};

/** Plays one scene in a fresh context and writes it as a constant-rate image sequence; returns its pattern and length in seconds. */
async function capture(browser, theme, name) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: theme });
  await context.addInitScript(stage);
  const page = await context.newPage();
  await page.goto(values.url);
  await quick(page, 'Hello there').waitFor({ timeout: 30_000 });
  page.pointerAt = { x: VIEWPORT.width * 0.42, y: VIEWPORT.height * 0.62 };
  await page.mouse.move(page.pointerAt.x, page.pointerAt.y);
  await pause(page, 400);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, time: metadata.timestamp ?? Date.now() / 1000 });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: VIEWPORT.width * 2, maxHeight: VIEWPORT.height * 2 });
  await pause(page, 150);
  await SCENES[name](page).catch(async (error) => {
    await page.screenshot({ path: path.join(out, `failed-${theme}-${name}.png`) });
    throw error;
  });
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await context.close();

  // The screencast sends a frame only when the page changes, so each tick of the constant rate links the latest one.
  const dir = path.join(out, 'frames', theme, name);
  mkdirSync(path.join(dir, 'raw'), { recursive: true });
  const raw = (index) => path.join(dir, 'raw', `${index}.png`);
  frames.forEach((frame, index) => writeFileSync(raw(index), Buffer.from(frame.data, 'base64')));
  const start = frames[0].time;
  const ticks = Math.round((end - start) * FPS);
  for (let tick = 0, index = 0; tick < ticks; tick++) {
    while (frames[index + 1] !== undefined && frames[index + 1].time - start <= tick / FPS) index++;
    linkSync(raw(index), path.join(dir, `${String(tick).padStart(5, '0')}.png`));
  }
  console.log(`${theme} ${name}: ${frames.length} frames, ${(ticks / FPS).toFixed(1)} s`);
  return { pattern: path.join(dir, '%05d.png'), seconds: ticks / FPS };
}

/** Joins the scenes with fades into the MP4, and into the frames img2webp turns into the WebP. */
function compose(theme, scenes) {
  const inputs = scenes.flatMap((scene) => ['-framerate', String(FPS), '-i', scene.pattern]);
  const graph = scenes.map((_, i) => `[${i}:v]format=yuv444p,setsar=1[s${i}]`);
  let last = 's0';
  let offset = 0;
  for (let i = 1; i < scenes.length; i++) {
    offset += scenes[i - 1].seconds - FADE;
    graph.push(`[${last}][s${i}]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  graph.push(`[${last}]split[m][w]`, '[m]format=yuv420p[mp4]', `[w]fps=${WEBP.fps},scale=${WEBP.width}:-2:flags=lanczos,format=rgb24[webp]`);
  const webpFrames = path.join(out, 'frames', theme, 'webp');
  mkdirSync(webpFrames, { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph.join(';'),
    '-map', '[mp4]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', path.join(root, 'website', 'public', 'docs', `showcase-${theme}.mp4`),
    '-map', '[webp]', path.join(webpFrames, '%05d.png')], { stdio: 'inherit' });

  const files = readdirSync(webpFrames).sort().map((file) => path.join(webpFrames, file));
  const args = path.join(out, 'frames', theme, 'img2webp.txt');
  writeFileSync(args, ['-loop', '0', '-mixed', '-d', String(Math.round(1000 / WEBP.fps)), '-q', '80', '-m', '6', ...files, '-o', path.join(root, 'docs', 'images', `showcase-${theme}.webp`)].join('\n'));
  execFileSync('img2webp', [args], { stdio: 'inherit' });
}

rmSync(out, { recursive: true, force: true });
// The flag, not the context's deviceScaleFactor: the screencast ignores the emulated scale and sends 1x frames.
const browser = await chromium.launch({ args: ['--force-device-scale-factor=2'] });
try {
  for (const theme of /** @type {const} */ (['light', 'dark'])) {
    const scenes = [];
    for (const name of Object.keys(SCENES)) scenes.push(await capture(browser, theme, name));
    compose(theme, scenes);
  }
} finally {
  await browser.close();
}
rmSync(path.join(out, 'frames'), { recursive: true, force: true });
console.log('wrote docs/images/showcase-*.webp and website/public/docs/showcase-*.mp4');
