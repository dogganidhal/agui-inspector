// SC-009 measurement helpers: the planned interaction schedule, the in-page generation-linked
// timer, the oracle that says what the page must show, the statistics and the verdict.
//
// A sample runs from the trusted input event handler in the page to the paint opportunity after the
// React commit that answers it (two nested requestAnimationFrame callbacks). The commit is told
// apart from every other render by a generation counter the view bumps in the same commit as the
// user's action (data-generation on the frames list), so a render caused by arriving frames can
// never be mistaken for the answer to an input. Nothing here times a reducer or a Node loop.
//
// Erasable TypeScript only, so Node can run it directly (scripts/benchmark.mjs imports it).
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { EventType } from '@ag-ui/core';
import { generateFixture, type Frame } from './generate.ts';

// ---- the plan ---------------------------------------------------------------------------------

/** plan.md, "Interaction schedule" and "Measurement". */
export const PLAN = {
  startMs: 20_000,
  intervalMs: 400,
  interactions: 200,
  framesPerSecond: 50,
  frames: 5_000,
  exchanges: 10,
  /** The last 50 interactions need at least this many retained frames. */
  lateRetainedMinimum: 4_000,
  lateInteractions: 50,
  thresholdMs: 200,
  /** At least this many of the 100 samples of each class must be within the threshold. */
  requiredWithin: 95,
  warmUpRuns: 1,
  measuredRuns: 3,
  viewport: { width: 1440, height: 900 },
} as const;

export type InteractionClass = 'filter' | 'expansion';
export type FilterVariant = 'type' | 'substring' | 'issues';
export type ExpansionVariant = 'normal' | 'malformed' | 'large';

export interface Planned {
  readonly index: number;
  /** Milliseconds after the first request is dispatched. */
  readonly atMs: number;
  readonly class: InteractionClass;
  readonly variant: FilterVariant | ExpansionVariant;
  /** Position among interactions of the same class, from 0. */
  readonly ordinal: number;
}

export const FILTER_VARIANTS: readonly FilterVariant[] = ['type', 'substring', 'issues'];
export const EXPANSION_VARIANTS: readonly ExpansionVariant[] = ['normal', 'malformed', 'large'];
export const FAMILY_KEYS = ['run', 'step', 'text', 'tool', 'reasoning', 'state', 'activity', 'subagent', 'ext'] as const;

/** 33 substrings: some match nearly every frame, some a family, one matches nothing. */
export const SUBSTRINGS: readonly string[] = [
  'type', 'delta', 'a', 'e', 'message', 'tool', 'state', 'reasoning', 'activity', 'step', 'run-0',
  'thr-001', 'msg', 'call', 'TEXT_MESSAGE', 'TOOL_CALL', 'REASONING', 'STATE_', 'ACTIVITY', 'SUBAGENT',
  'CUSTOM', 'RAW', 'snapshot', 'patch', 'encrypted', 'json', 'unknown', 'x', '0', '1', '7', 'synthetic', 'zzz-matches-nothing',
];

/** Filters and expansions alternate, one every 400 ms from t=20 s through t=99.6 s. */
export function planInteractions(): Planned[] {
  return Array.from({ length: PLAN.interactions }, (_, index) => {
    const isFilter = index % 2 === 0;
    const ordinal = Math.floor(index / 2);
    return {
      index,
      atMs: PLAN.startMs + index * PLAN.intervalMs,
      class: isFilter ? 'filter' : 'expansion',
      variant: (isFilter ? FILTER_VARIANTS : EXPANSION_VARIANTS)[ordinal % 3] as FilterVariant | ExpansionVariant,
      ordinal,
    };
  });
}

/** Frames the server has sent by `atMs` when it sends exactly framesPerSecond from the first request. */
export const plannedRetainedAt = (atMs: number) => Math.min(PLAN.frames, Math.floor((atMs * PLAN.framesPerSecond) / 1000));

// ---- the oracle: what the page must show ------------------------------------------------------

const BASELINE_TYPES = new Set<string>(Object.values(EventType));
const FAMILY_OF_PREFIX: Readonly<Record<string, string>> = {
  RUN: 'run', STEP: 'step', TEXT: 'text', TOOL: 'tool', REASONING: 'reasoning', STATE: 'state', MESSAGES: 'state',
  ACTIVITY: 'activity', SUBAGENT: 'subagent', CUSTOM: 'ext', RAW: 'ext',
};

export interface FilterState {
  readonly families: ReadonlySet<string>;
  readonly query: string;
  readonly issues: boolean;
}
export const NO_FILTER: FilterState = { families: new Set(), query: '', issues: false };

export interface BenchFrame {
  readonly exchange: number;
  readonly index: number;
  /** The id the page gives the frame row. */
  readonly id: string;
  readonly frame: Frame;
  /** The type the page reads off the wire, when the data is JSON with a string type. */
  readonly eventType: string | undefined;
  readonly family: string | undefined;
  readonly issue: boolean;
  readonly dataBytes: number;
}

let cached: BenchFrame[][] | undefined;
/** The fixture frames, by exchange, as the page numbers them. */
export function benchFrames(): BenchFrame[][] {
  return (cached ??= generateFixture().map((exchange) =>
    exchange.frames.map((frame, index) => {
      let eventType: string | undefined;
      if (frame.kind !== 'non-json') {
        const type = (JSON.parse(frame.data) as { type?: unknown }).type;
        if (typeof type === 'string') eventType = type;
      }
      const family = eventType !== undefined && BASELINE_TYPES.has(eventType) ? FAMILY_OF_PREFIX[eventType.split('_')[0] ?? ''] : undefined;
      return { exchange: exchange.index, index, id: `exchange-${exchange.index + 1}:frame-${index}`, frame, eventType, family, issue: frame.kind !== 'valid', dataBytes: Buffer.byteLength(frame.data) };
    }),
  ));
}

export function matchesFilter(item: BenchFrame, filter: FilterState): boolean {
  if (filter.families.size > 0 && (item.family === undefined || !filter.families.has(item.family))) return false;
  if (filter.issues && !item.issue) return false;
  if (filter.query !== '') {
    const query = filter.query.toLowerCase();
    if (!(item.eventType ?? '').toLowerCase().includes(query) && !item.frame.data.toLowerCase().includes(query)) return false;
  }
  return true;
}

/** Frames of exchange `exchange` that have arrived when `total` frames have been retained overall. */
export const arrivedIn = (exchange: number, total: number) => Math.max(0, Math.min(500, total - exchange * 500));

/** How many retained frames the page must report as shown for this filter. */
export function expectedShown(filter: FilterState, total: number): number {
  let shown = 0;
  for (const [exchange, frames] of benchFrames().entries()) {
    for (const item of frames.slice(0, arrivedIn(exchange, total))) if (matchesFilter(item, filter)) shown += 1;
  }
  return shown;
}

/** How many frame rows are in the DOM: the matching arrived frames of every expanded exchange. */
export function expectedRows(filter: FilterState, total: number, expanded: ReadonlySet<number>): number {
  let rows = 0;
  for (const exchange of expanded) {
    for (const item of (benchFrames()[exchange] ?? []).slice(0, arrivedIn(exchange, total))) if (matchesFilter(item, filter)) rows += 1;
  }
  return rows;
}

export type ExpansionClass = ExpansionVariant;
export function classOf(item: BenchFrame): ExpansionClass | undefined {
  if (item.frame.kind === 'non-json') return 'malformed';
  if (item.frame.kind === 'valid' && item.dataBytes >= 16_000) return 'large';
  if (item.frame.kind === 'valid' && item.dataBytes < 4_096) return 'normal';
  return undefined;
}

/** What the page shows for an opened frame: formatted JSON, or the text as received. */
export function expectedDetail(item: BenchFrame): string {
  return item.frame.kind === 'non-json' ? item.frame.data : JSON.stringify(JSON.parse(item.frame.data), null, 2);
}

// ---- the in-page timer ------------------------------------------------------------------------

export interface Sample {
  readonly label: string;
  /** Handler to paint opportunity, milliseconds. */
  readonly ms: number;
  /** performance.now() at the input handler, in the page's clock. */
  readonly handlerAt: number;
  readonly startGeneration: number;
  readonly generation: number;
  /** Read in the commit that answered the input. */
  readonly total: number;
  readonly shown: number;
  readonly rows: number;
  /** Exchange headers on the page; the newest one is open unless the user chose otherwise. */
  readonly exchanges: number;
  readonly heapBytes: number | null;
}

/**
 * Installed before the page's own scripts. `arm(label)` waits for the next trusted input event; its
 * capture-phase handler runs before the page's own, so its timestamp is the start of the input. The
 * sample ends after the commit whose data-generation is newer than the one seen at the start.
 */
export const IN_PAGE_TIMER = `(() => {
  const state = { armed: null, pending: null, samples: [] };
  const root = () => document.querySelector('[data-testid="frames"]');
  const read = (name) => Number(root()?.getAttribute(name) ?? NaN);
  function finish(commitGeneration) {
    const pending = state.pending;
    state.pending = null;
    const facts = {
      generation: commitGeneration,
      total: read('data-frame-total'),
      shown: read('data-frame-shown'),
      rows: document.querySelectorAll('[data-frame-row]').length,
      exchanges: document.querySelectorAll('[data-exchange-header]').length,
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const paintedAt = performance.now();
      state.samples.push({
        label: pending.label,
        ms: paintedAt - pending.handlerAt,
        handlerAt: pending.handlerAt,
        startGeneration: pending.startGeneration,
        ...facts,
        heapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
      });
    }));
  }
  new MutationObserver(() => {
    if (!state.pending) return;
    const generation = read('data-generation');
    if (generation > state.pending.startGeneration) finish(generation);
  }).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-generation'] });
  for (const type of ['click', 'input', 'keydown']) {
    document.addEventListener(type, (event) => {
      if (!state.armed || !event.isTrusted) return;
      state.pending = { label: state.armed, handlerAt: performance.now(), startGeneration: read('data-generation') };
      state.armed = null;
    }, true);
  }
  window.__measure = {
    arm: (label) => { state.armed = label; },
    samples: () => state.samples,
    count: () => state.samples.length,
    now: () => performance.now(),
  };
})();`;

// ---- statistics -------------------------------------------------------------------------------

/** Nearest-rank percentile. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] as number;
}

export interface ClassStats {
  readonly count: number;
  readonly p95: number;
  readonly max: number;
  readonly within: number;
  readonly percentWithin: number;
}

export function classStats(samplesMs: readonly number[], thresholdMs: number = PLAN.thresholdMs): ClassStats {
  const within = samplesMs.filter((ms) => ms <= thresholdMs).length;
  return {
    count: samplesMs.length,
    p95: percentile(samplesMs, 0.95),
    max: samplesMs.length === 0 ? NaN : Math.max(...samplesMs),
    within,
    percentWithin: samplesMs.length === 0 ? 0 : (within / samplesMs.length) * 100,
  };
}

/** A class passes with at least 95 of its 100 samples within the threshold; a missing sample fails it. */
export const classPasses = (stats: ClassStats) => stats.count === 100 && stats.within >= PLAN.requiredWithin;

// ---- runs, environment and verdict ------------------------------------------------------------

export interface RunResult {
  readonly label: string;
  readonly filters: ClassStats;
  readonly expansions: ClassStats;
  readonly retained: { readonly dataFrames: number; readonly exchanges: number; readonly hashesMatch: boolean; readonly lateMinimumRetained: number };
  readonly schedule: { readonly planned: number; readonly executed: number; readonly maxLatenessMs: number; readonly p95LatenessMs: number };
  readonly arrival: { readonly exchangeMs: readonly number[]; readonly maxOffsetDriftMs: number };
  readonly peakHeapBytes: number | null;
  /** Anything that makes the measurement untrustworthy: wrong content, wrong count, missing samples. */
  readonly integrity: readonly string[];
}

export interface Environment {
  readonly platform: string;
  readonly osRelease: string;
  readonly macOsVersion: string | null;
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly memoryGiB: number;
  readonly node: string;
  readonly browser: string;
  readonly playwright: string;
  readonly headed: boolean;
  readonly viewport: { width: number; height: number };
}

export function describeEnvironment(browser: { version: string; headed: boolean; playwright: string }): Environment {
  let macOsVersion: string | null = null;
  if (process.platform === 'darwin') {
    try {
      macOsVersion = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
    } catch {
      macOsVersion = null;
    }
  }
  return {
    platform: `${process.platform}/${process.arch}`,
    osRelease: os.release(),
    macOsVersion,
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    memoryGiB: Math.round(os.totalmem() / 1024 ** 3),
    node: process.version,
    browser: browser.version,
    playwright: browser.playwright,
    headed: browser.headed,
    viewport: PLAN.viewport,
  };
}

/** The plan's runner: Mac mini M2, 8 cores, 16 GB, macOS 15.7, headed Chromium 153.0.8010.12, Playwright 1.63.0, 1440x900. */
export function runnerGaps(env: Environment): string[] {
  const gaps: string[] = [];
  if (env.platform !== 'darwin/arm64') gaps.push(`platform ${env.platform}, not darwin/arm64`);
  if (!/Apple M2$/.test(env.cpuModel)) gaps.push(`CPU ${env.cpuModel}, not Apple M2`);
  if (env.cpuCount !== 8) gaps.push(`${env.cpuCount} CPU cores, not 8`);
  if (env.memoryGiB !== 16) gaps.push(`${env.memoryGiB} GiB of memory, not 16`);
  if (!/^15\.7(\.|$)/.test(env.macOsVersion ?? '')) gaps.push(`macOS ${env.macOsVersion ?? 'unknown'}, not 15.7`);
  if (!/(^|\/)153\.0\.8010\.12$/.test(env.browser)) gaps.push(`browser ${env.browser}, not Chromium 153.0.8010.12`);
  if (env.playwright !== '1.63.0') gaps.push(`Playwright ${env.playwright}, not 1.63.0`);
  if (!env.headed) gaps.push('headless, not a headed foreground window');
  if (env.viewport.width !== 1440 || env.viewport.height !== 900) gaps.push('viewport is not 1440x900');
  return gaps;
}

export interface Verdict {
  /** Every measured run kept exactly 5,000 frames in order with matching hashes and a complete, trustworthy set of samples. */
  readonly integrity: boolean;
  /** Every measured run met both 95/100 thresholds. Meaningful as a release claim only on the required runner. */
  readonly thresholds: boolean;
  readonly procedureComplete: boolean;
  readonly runnerGaps: readonly string[];
  /** SC-009 is claimed passed only when everything above holds on the required runner. */
  readonly sc009: 'passed' | 'not-passed' | 'pending';
  readonly reasons: readonly string[];
}

export function judge(measured: readonly RunResult[], env: Environment, procedure: { warmUps: number; measured: number }): Verdict {
  const gaps = runnerGaps(env);
  const reasons: string[] = [];
  const integrity = measured.length > 0 && measured.every((run) => run.integrity.length === 0);
  for (const run of measured) for (const problem of run.integrity) reasons.push(`${run.label}: ${problem}`);
  const thresholds = measured.length > 0 && measured.every((run) => classPasses(run.filters) && classPasses(run.expansions));
  for (const run of measured) {
    if (!classPasses(run.filters)) reasons.push(`${run.label}: ${run.filters.within}/${run.filters.count} filter changes within ${PLAN.thresholdMs} ms (need ${PLAN.requiredWithin}/100)`);
    if (!classPasses(run.expansions)) reasons.push(`${run.label}: ${run.expansions.within}/${run.expansions.count} expansions within ${PLAN.thresholdMs} ms (need ${PLAN.requiredWithin}/100)`);
  }
  const procedureComplete = procedure.warmUps === PLAN.warmUpRuns && procedure.measured === PLAN.measuredRuns && measured.length === PLAN.measuredRuns;
  if (!procedureComplete) reasons.push(`procedure incomplete: ${procedure.warmUps} warm-up and ${measured.length} measured runs, the plan requires ${PLAN.warmUpRuns} and ${PLAN.measuredRuns}`);
  for (const gap of gaps) reasons.push(`not the required runner: ${gap}`);
  const sc009 = !integrity || !thresholds ? (gaps.length === 0 && procedureComplete ? 'not-passed' : 'pending') : gaps.length === 0 && procedureComplete ? 'passed' : 'pending';
  return { integrity, thresholds, procedureComplete, runnerGaps: gaps, sc009, reasons };
}

const ms = (value: number) => (Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'n/a');
const stats = (name: string, s: ClassStats) => `  ${name.padEnd(11)} n=${s.count}  p95 ${ms(s.p95)}  max ${ms(s.max)}  within ${PLAN.thresholdMs} ms: ${s.within}/${s.count} (${s.percentWithin.toFixed(0)}%)`;

export function formatReport(report: { environment: Environment; warmUp: readonly RunResult[]; measured: readonly RunResult[]; verdict: Verdict }): string {
  const { environment: env, verdict } = report;
  const lines = [
    `SC-009 benchmark, ${PLAN.frames.toLocaleString('en-US')} frames, ${env.platform}, ${env.cpuModel} (${env.cpuCount} cores, ${env.memoryGiB} GiB), macOS ${env.macOsVersion ?? 'n/a'}, ${env.browser} ${env.headed ? 'headed' : 'headless'}, Playwright ${env.playwright}, Node ${env.node}`,
  ];
  for (const [kind, runs] of [['warm-up (discarded)', report.warmUp], ['measured', report.measured]] as const) {
    for (const run of runs) {
      lines.push(
        `${kind} run ${run.label}: retained ${run.retained.dataFrames} frames in ${run.retained.exchanges} exchanges, hashes ${run.retained.hashesMatch ? 'match' : 'DO NOT MATCH'}; schedule ${run.schedule.executed}/${run.schedule.planned} executed, lateness p95 ${ms(run.schedule.p95LatenessMs)} max ${ms(run.schedule.maxLatenessMs)}; arrival drift max ${ms(run.arrival.maxOffsetDriftMs)}; peak heap ${run.peakHeapBytes === null ? 'n/a' : `${(run.peakHeapBytes / 1024 ** 2).toFixed(0)} MiB`} (diagnostic)`,
        stats('filters', run.filters),
        stats('expansions', run.expansions),
      );
      for (const problem of run.integrity) lines.push(`  INTEGRITY: ${problem}`);
    }
  }
  lines.push(`integrity: ${verdict.integrity ? 'ok' : 'FAILED'}; thresholds on this machine: ${verdict.thresholds ? 'met' : 'not met'}`);
  lines.push(
    verdict.sc009 === 'passed'
      ? 'SC-009: PASSED on the required runner (the bundle budget is a separate check: npm run build && npm run check:bundle).'
      : verdict.sc009 === 'not-passed'
        ? 'SC-009: NOT PASSED on the required runner.'
        : 'SC-009: PENDING. These timings are reported for information; only the required runner in tests/benchmarks/profile.md can certify the 200 ms threshold.',
  );
  for (const reason of verdict.reasons) lines.push(`  - ${reason}`);
  return lines.join('\n');
}
