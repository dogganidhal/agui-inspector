// L04 T038 (SC-009): the 5,000-frame responsiveness benchmark, through the real UI.
//
// A production-minified host with the full pinned A2UI v0.9 renderer bundled in is served from one
// loopback origin; a scripted agent on another origin sends the frozen fixture, ten exchanges of
// 500 frames at 50 frames a second, in the planned 1/7/64/4096-byte chunk cycle. From t=20 s a
// trusted Playwright interaction lands every 400 ms: filter changes and raw-frame expansions, each
// timed in the page from the input handler to the paint after the commit that answers it. Capture
// is never paused. Afterwards the retained frames are compared with the frozen manifest.
//
// Run with `npm run test:benchmark`. Only the plan's runner can certify the 200 ms threshold; any
// other machine gets the same numbers and a PENDING verdict.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
import { bundleHost, root, serveSite, type Site } from '../e2e/inspection/support.ts';
import { generateFixture } from './generate.ts';
import {
  FAMILY_KEYS,
  IN_PAGE_TIMER,
  PLAN,
  SUBSTRINGS,
  arrivedIn,
  benchFrames,
  classOf,
  classStats,
  describeEnvironment,
  expectedDetail,
  expectedRows,
  expectedShown,
  formatReport,
  judge,
  percentile,
  plannedRetainedAt,
  planInteractions,
  type FilterState,
  type RunResult,
  type Sample,
} from './render-measurement.ts';

const manifest = JSON.parse(readFileSync(path.join(import.meta.dirname, 'manifest.json'), 'utf8')) as { exchanges: Array<{ sha256: string; frameCount: number }> };
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CHUNK_SIZES = [1, 7, 64, 4096];
/** The list reporter holds stdout until the test ends; this shows where a long run is. */
const progress = (line: string) => process.stderr.write(`${line}\n`);

/** Streams exchange `index` of the fixture at 50 frames a second, flushing every chunk on its own. */
function benchmarkRoutes(): (pathname: string, response: ServerResponse) => boolean {
  const fixture = generateFixture();
  return (pathname, response) => {
    const match = /^\/bench\/(\d+)$/.exec(pathname);
    const exchange = match ? fixture[Number(match[1])] : undefined;
    if (!exchange) return false;
    response.socket?.setNoDelay(true);
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    void (async () => {
      const start = performance.now();
      let turn = 0;
      for (const [k, frame] of exchange.frames.entries()) {
        const wait = start + (k * 1000) / PLAN.framesPerSecond - performance.now();
        if (wait > 1) await sleep(wait);
        const bytes = Buffer.from(frame.envelope, 'utf8');
        for (let at = 0; at < bytes.length; turn += 1) {
          const size = CHUNK_SIZES[turn % CHUNK_SIZES.length] as number;
          response.write(bytes.subarray(at, at + size));
          at += size;
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      response.end();
    })();
    return true;
  };
}

/** The production host: what the app is bundled as, plus the full A2UI renderer the budget counts. */
const hostWithRenderer = `
  import './tests/inspection/host.tsx';
  import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9';
  import { MessageProcessor } from '@a2ui/web_core/v0_9';
  import { HttpAgent } from '@ag-ui/client';
  import { EventSchemas, RunAgentInputSchema } from '@ag-ui/core/schemas';
  import { RENDER_A2UI_TOOL } from '@ag-ui/a2ui-middleware';
  globalThis.__representative = { A2uiSurface, basicCatalog, MessageProcessor, HttpAgent, EventSchemas, RunAgentInputSchema, RENDER_A2UI_TOOL };
`;

interface Harness {
  filter: { families: Set<string>; query: string; issues: boolean };
  /** Older exchanges the harness opened, 0-based. */
  opened: Set<number>;
  openFrame: string | undefined;
}

async function oneRun(browser: Browser, site: Site, label: string, log: (line: string) => void): Promise<RunResult> {
  const context = await browser.newContext({ viewport: PLAN.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(IN_PAGE_TIMER);
  const integrity: string[] = [];
  const complain = (message: string) => {
    if (integrity.length < 20) integrity.push(message);
  };
  const plan = planInteractions();
  const fixture = benchFrames();

  await page.goto(site.pageOrigin);
  await page.waitForFunction(() => '__host' in window);
  const benchStart = await page.evaluate(() => {
    const w = window as unknown as { __host: { runBenchmark(): Promise<void> }; __done: boolean };
    const started = performance.now();
    w.__done = false;
    void w.__host.runBenchmark().then(() => (w.__done = true));
    return started;
  });
  const startedAt = performance.now();

  const state: Harness = { filter: { families: new Set(), query: '', issues: false }, opened: new Set(), openFrame: undefined };
  const asFilter = (): FilterState => ({ families: new Set(state.filter.families), query: state.filter.query, issues: state.filter.issues });
  const sampleCount = () => page.evaluate(() => (window as unknown as { __measure: { count(): number } }).__measure.count());
  const arm = (name: string) => page.evaluate((value) => (window as unknown as { __measure: { arm(label: string): void } }).__measure.arm(value), name);
  const search = page.getByRole('searchbox', { name: 'Filter frames by type or content' });

  async function sampleAfter(name: string, before: number, action: () => Promise<void>): Promise<Sample | undefined> {
    await arm(name);
    await action();
    try {
      await page.waitForFunction((n) => (window as unknown as { __measure: { count(): number } }).__measure.count() > n, before, { timeout: 5_000, polling: 5 });
    } catch {
      complain(`${name}: no committed render answered the input within 5 s`);
      return undefined;
    }
    return (await page.evaluate(() => (window as unknown as { __measure: { samples(): Sample[] } }).__measure.samples())).at(-1);
  }

  const resetFilters = async () => {
    if (state.filter.query !== '') await search.fill('');
    for (const family of [...state.filter.families]) await page.locator(`[data-family-chip="${family}"]`).click();
    if (state.filter.issues) await page.locator('[data-issues-chip]').click();
    state.filter = { families: new Set(), query: '', issues: false };
  };
  const visibleIds = () => page.locator('[data-frame-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-frame-row') as string));
  const closeOpened = async () => {
    // A frame opened earlier can be hidden by a filter that came after; show it again, then close it.
    if (state.openFrame !== undefined && (await page.locator(`[data-frame-row="${state.openFrame}"]`).count()) === 0) await resetFilters();
    state.openFrame = undefined;
    const open = page.locator('[data-frame-row][aria-expanded="true"]');
    while ((await open.count()) > 0) await open.first().click();
    for (const exchange of state.opened) await page.locator(`[data-exchange-header="exchange-${exchange + 1}"]`).click();
    state.opened.clear();
  };

  const filterSamples: number[] = [];
  const expansionSamples: number[] = [];
  const lateness: number[] = [];
  let executed = 0;
  let lateMinimum = Infinity;
  let peakHeap: number | null = null;

  /**
   * Everything that does not belong in the timed interval happens here, before the planned moment:
   * closing what an earlier expansion opened, finding a frame of the wanted kind, scrolling it into
   * view. What it returns is only the input itself and the checks to run on the answer.
   */
  async function prepare(item: ReturnType<typeof planInteractions>[number], name: string): Promise<{ stillValid(): Promise<boolean>; act(): Promise<Sample | undefined>; check(sample: Sample): Promise<void> } | undefined> {
    const before = await sampleCount();
    if (item.class === 'filter') {
      const turn = Math.floor(item.ordinal / 3);
      let input: () => Promise<void>;
      let applied: () => void;
      if (item.variant === 'type') {
        const family = FAMILY_KEYS[turn % FAMILY_KEYS.length] as string;
        input = () => page.locator(`[data-family-chip="${family}"]`).click();
        applied = () => void (state.filter.families.delete(family) || state.filter.families.add(family));
      } else if (item.variant === 'substring') {
        const query = SUBSTRINGS[turn % SUBSTRINGS.length] as string;
        input = () => search.fill(query);
        applied = () => void (state.filter.query = query);
      } else {
        input = () => page.locator('[data-issues-chip]').click();
        applied = () => void (state.filter.issues = !state.filter.issues);
      }
      return {
        stillValid: async () => true,
        act: async () => {
          const sample = await sampleAfter(name, before, input);
          applied();
          return sample;
        },
        check: async (sample) => {
          const expanded = new Set<number>([...state.opened, sample.exchanges - 1]);
          const shown = expectedShown(asFilter(), sample.total);
          const rows = expectedRows(asFilter(), sample.total, expanded);
          if (sample.shown !== shown) complain(`${name}: the page says ${sample.shown} frames shown, the fixture says ${shown} of ${sample.total}`);
          if (sample.rows !== rows) complain(`${name}: the page lists ${sample.rows} rows, the fixture says ${rows}`);
        },
      };
    }

    await closeOpened();
    const wanted = item.variant as 'normal' | 'malformed' | 'large';
    const pick = async (): Promise<string | undefined> => {
      const candidates = (await visibleIds()).filter((id) => {
        const [, x, i] = /^exchange-(\d+):frame-(\d+)$/.exec(id) ?? [];
        const found = x === undefined ? undefined : fixture[Number(x) - 1]?.[Number(i)];
        return found !== undefined && classOf(found) === wanted;
      });
      return candidates.length === 0 ? undefined : candidates[Math.floor(item.ordinal / 3) % candidates.length];
    };
    let id = await pick();
    if (id === undefined && (state.filter.query !== '' || state.filter.families.size > 0 || state.filter.issues)) {
      await resetFilters();
      id = await pick();
    }
    if (id === undefined) {
      // Nothing of this kind has arrived in the open exchange yet: open the newest older one that has one.
      const total = (await page.getByTestId('frames').getAttribute('data-frame-total').then(Number)) || 0;
      const newest = (await page.locator('[data-exchange-header]').count()) - 1;
      for (let exchange = newest - 1; exchange >= 0 && id === undefined; exchange -= 1) {
        if ((fixture[exchange] ?? []).slice(0, arrivedIn(exchange, total)).some((frame) => classOf(frame) === wanted)) {
          await page.locator(`[data-exchange-header="exchange-${exchange + 1}"]`).click();
          state.opened.add(exchange);
          await page.locator(`[data-exchange="exchange-${exchange + 1}"] [data-frame-row]`).first().waitFor();
          id = await pick();
        }
      }
    }
    if (id === undefined) {
      complain(`${name}: no ${wanted} frame has arrived to open`);
      return undefined;
    }
    const chosen = id;
    const row = page.locator(`[data-frame-row="${chosen}"]`);
    await row.scrollIntoViewIfNeeded();
    const readyBefore = await sampleCount();
    return {
      // A new exchange closes the one that was open by default, and its rows go with it.
      stillValid: async () => (await row.count()) > 0,
      act: async () => {
        const sample = await sampleAfter(name, readyBefore, () => row.click());
        state.openFrame = chosen;
        return sample;
      },
      check: async () => {
        const [, x, i] = /^exchange-(\d+):frame-(\d+)$/.exec(chosen) as RegExpExecArray;
        const frame = fixture[Number(x) - 1]?.[Number(i)] as NonNullable<(typeof fixture)[number][number]>;
        const detail = page.locator(`[data-frame-detail="${chosen}"] pre`);
        if ((await row.getAttribute('aria-expanded')) !== 'true') complain(`${name}: ${chosen} is not expanded`);
        if (!(await detail.isVisible())) complain(`${name}: the raw content of ${chosen} is not visible`);
        else if ((await detail.textContent()) !== expectedDetail(frame)) complain(`${name}: the raw content of ${chosen} differs from the fixture`);
      },
    };
  }

  for (const item of plan) {
    const name = `${item.index}:${item.class}:${item.variant}`;
    progress(`${label} ${name}`);
    let ready = await prepare(item, name);
    const wait = startedAt + item.atMs - performance.now();
    if (wait > 1) await sleep(wait);
    if (ready && !(await ready.stillValid())) ready = await prepare(item, name);
    const sample = ready ? await ready.act() : undefined;
    if (sample && ready) await ready.check(sample);

    if (sample) {
      (item.class === 'filter' ? filterSamples : expansionSamples).push(sample.ms);
      lateness.push(Math.max(0, sample.handlerAt - (benchStart + item.atMs)));
      executed += 1;
      if (item.index >= PLAN.interactions - PLAN.lateInteractions) lateMinimum = Math.min(lateMinimum, sample.total);
      if (sample.heapBytes !== null) peakHeap = Math.max(peakHeap ?? 0, sample.heapBytes);
      if (sample.total < plannedRetainedAt(item.atMs) - 100) complain(`${name}: only ${sample.total} frames retained, the schedule has sent about ${plannedRetainedAt(item.atMs)}`);
    }
  }
  if (!Number.isFinite(lateMinimum) || lateMinimum < PLAN.lateRetainedMinimum) complain(`the last ${PLAN.lateInteractions} interactions ran with only ${lateMinimum} retained frames, at least ${PLAN.lateRetainedMinimum} are required`);

  // Capture is never paused: wait for the last exchange to finish, then compare what was retained.
  await page.waitForFunction(() => (window as unknown as { __done: boolean }).__done, undefined, { timeout: 60_000, polling: 100 });
  const retained = await page.evaluate(() => {
    const session = (window as unknown as { __host: { snapshot(): { exchanges: Array<{ id: string; elapsedMs?: number }>; frames: Array<{ exchangeId: string; classification: string; envelope: string; offsetMs: number; index: number }> } } }).__host.snapshot();
    return { exchanges: session.exchanges, frames: session.frames.map((frame) => ({ exchangeId: frame.exchangeId, classification: frame.classification, envelope: frame.envelope, offsetMs: frame.offsetMs, index: frame.index })) };
  });
  const dataFrames = retained.frames.filter((frame) => frame.classification === 'data');
  let hashesMatch = retained.exchanges.length === manifest.exchanges.length;
  let drift = 0;
  retained.exchanges.forEach((exchange, at) => {
    const own = retained.frames.filter((frame) => frame.exchangeId === exchange.id);
    if (own.length !== manifest.exchanges[at]?.frameCount || sha256(own.map((frame) => frame.envelope).join('')) !== manifest.exchanges[at]?.sha256) hashesMatch = false;
    for (const frame of own) drift = Math.max(drift, Math.abs(frame.offsetMs - (frame.index * 1000) / PLAN.framesPerSecond));
  });
  if (dataFrames.length !== PLAN.frames) complain(`${dataFrames.length} data frames retained, exactly ${PLAN.frames} are required`);
  if (!hashesMatch) complain('the retained frames do not match the manifest in count, order or hashes');
  if (filterSamples.length !== 100 || expansionSamples.length !== 100) complain(`${filterSamples.length} filter and ${expansionSamples.length} expansion samples, 100 of each are required`);

  await context.close();
  const result: RunResult = {
    label,
    filters: classStats(filterSamples),
    expansions: classStats(expansionSamples),
    retained: { dataFrames: dataFrames.length, exchanges: retained.exchanges.length, hashesMatch, lateMinimumRetained: Number.isFinite(lateMinimum) ? lateMinimum : 0 },
    schedule: { planned: plan.length, executed, maxLatenessMs: Math.max(0, ...lateness), p95LatenessMs: percentile(lateness, 0.95) },
    arrival: { exchangeMs: retained.exchanges.map((exchange) => exchange.elapsedMs ?? NaN), maxOffsetDriftMs: drift },
    peakHeapBytes: peakHeap,
    integrity,
  };
  log(`${label}: filters ${result.filters.within}/${result.filters.count} within ${PLAN.thresholdMs} ms (p95 ${result.filters.p95.toFixed(1)}), expansions ${result.expansions.within}/${result.expansions.count} (p95 ${result.expansions.p95.toFixed(1)})`);
  return result;
}

test('5,000 retained frames: filter changes and raw expansions through the full renderer-enabled host', async ({ browser }, testInfo) => {
  test.setTimeout(PLAN.measuredRuns * 30 * 60 * 1000);
  const quick = process.env.BENCHMARK_QUICK === '1';
  const procedure = quick ? { warmUps: 0, measured: 1 } : { warmUps: PLAN.warmUpRuns, measured: PLAN.measuredRuns };

  const bundle = await bundleHost({ contents: hostWithRenderer });
  const { site, stop } = await serveSite(bundle, benchmarkRoutes());
  try {
    const log = (line: string) => console.log(line);
    const warmUp: RunResult[] = [];
    const measured: RunResult[] = [];
    for (let n = 0; n < procedure.warmUps; n += 1) warmUp.push(await oneRun(browser, site, `warm-up ${n + 1}`, log));
    for (let n = 0; n < procedure.measured; n += 1) measured.push(await oneRun(browser, site, `measured ${n + 1}`, log));

    const playwright = (JSON.parse(readFileSync(path.join(root, 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')) as { version: string }).version;
    const environment = describeEnvironment({ version: browser.version(), headed: process.env.BENCHMARK_HEADED === '1', playwright });
    const verdict = judge(measured, environment, procedure);
    const report = { environment, procedure, warmUp, measured, verdict };
    const dir = path.join(root, '.build', 'benchmark');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n${formatReport(report)}`);
    await testInfo.attach('report.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    // Measurement integrity always has to hold. The 200 ms thresholds are enforced on the required runner only.
    expect(verdict.integrity, verdict.reasons.join('\n')).toBe(true);
    if (verdict.runnerGaps.length === 0 && verdict.procedureComplete) expect(verdict.sc009, verdict.reasons.join('\n')).toBe('passed');
  } finally {
    await stop();
    rmSync(bundle.dir, { recursive: true, force: true });
  }
});
