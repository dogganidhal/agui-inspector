// L04 T038: the benchmark's own rules, checked without a browser: the planned schedule is exactly
// the plan's, the oracle agrees with the frozen manifest, the statistics and the verdict follow
// profile.md, and a machine other than the required runner can never produce a release pass.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  EXPANSION_VARIANTS,
  FAMILY_KEYS,
  FILTER_VARIANTS,
  NO_FILTER,
  PLAN,
  SUBSTRINGS,
  benchFrames,
  classOf,
  classPasses,
  classStats,
  expectedDetail,
  expectedRows,
  expectedShown,
  judge,
  percentile,
  plannedRetainedAt,
  planInteractions,
  runnerGaps,
  type Environment,
  type RunResult,
} from '../../../../tests/benchmarks/render-measurement.ts';

const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'tests', 'benchmarks', 'manifest.json'), 'utf8')) as { typeCounts: Record<string, number> };

test('the schedule is the plan: 200 interactions, one every 400 ms from 20 s through 99.6 s, filters and expansions alternating', () => {
  const plan = planInteractions();
  assert.equal(plan.length, 200);
  assert.deepEqual(plan.map((item) => item.index), Array.from({ length: 200 }, (_, at) => at));
  assert.equal(plan[0]!.atMs, 20_000);
  assert.equal(plan[199]!.atMs, 99_600);
  plan.forEach((item, at) => {
    assert.equal(item.atMs, 20_000 + at * 400);
    assert.equal(item.class, at % 2 === 0 ? 'filter' : 'expansion');
  });
  assert.equal(plan.filter((item) => item.class === 'filter').length, 100);
  assert.equal(plan.filter((item) => item.class === 'expansion').length, 100);
});

test('filters cycle 34 type selections, 33 substring searches and 33 issue toggles; expansions cycle normal, malformed and 16 KiB', () => {
  const plan = planInteractions();
  const count = (variant: string) => plan.filter((item) => item.variant === variant).length;
  assert.deepEqual(FILTER_VARIANTS, ['type', 'substring', 'issues']);
  assert.deepEqual([count('type'), count('substring'), count('issues')], [34, 33, 33]);
  assert.deepEqual(EXPANSION_VARIANTS, ['normal', 'malformed', 'large']);
  assert.deepEqual([count('normal'), count('malformed'), count('large')], [34, 33, 33]);
  assert.deepEqual(plan.slice(0, 12).map((item) => item.variant), ['type', 'normal', 'substring', 'malformed', 'issues', 'large', 'type', 'normal', 'substring', 'malformed', 'issues', 'large']);
  assert.equal(SUBSTRINGS.length, 33);
  assert.equal(new Set(SUBSTRINGS).size, 33, 'consecutive searches always change the text');
  assert.equal(FAMILY_KEYS.length, 9);
});

test('arrival is 50 frames a second, so the last 50 interactions run with at least 4,000 retained frames', () => {
  const plan = planInteractions();
  assert.equal(plannedRetainedAt(0), 0);
  assert.equal(plannedRetainedAt(20_000), 1_000);
  assert.equal(plannedRetainedAt(100_000), 5_000);
  assert.equal(plannedRetainedAt(200_000), 5_000);
  for (const item of plan.slice(-PLAN.lateInteractions)) assert.ok(plannedRetainedAt(item.atMs) >= PLAN.lateRetainedMinimum, `interaction ${item.index}`);
  assert.equal(plannedRetainedAt(plan[150]!.atMs), 4_000);
  assert.ok(plannedRetainedAt(plan[149]!.atMs) < 4_000);
});

test('the oracle reads the frozen fixture: 5,000 frames, the manifest type counts, 100 issues', () => {
  const frames = benchFrames();
  assert.equal(frames.length, 10);
  assert.ok(frames.every((exchange) => exchange.length === 500));
  const all = frames.flat();
  assert.equal(all.length, 5_000);
  assert.equal(all.filter((item) => item.issue).length, 100);
  assert.equal(all[0]!.id, 'exchange-1:frame-0');
  assert.equal(all[4_999]!.id, 'exchange-10:frame-499');
  const byType: Record<string, number> = {};
  for (const item of all) byType[item.frame.type] = (byType[item.frame.type] ?? 0) + 1;
  assert.deepEqual(byType, manifest.typeCounts);
  assert.equal(expectedShown(NO_FILTER, 5_000), 5_000);
  assert.equal(expectedShown(NO_FILTER, 1_234), 1_234);
  assert.equal(expectedShown({ ...NO_FILTER, issues: true }, 5_000), 100);
  const tools = expectedShown({ ...NO_FILTER, families: new Set(['tool']) }, 5_000);
  assert.equal(tools, all.filter((item) => item.family === 'tool').length);
  assert.ok(tools >= 60 + 400 + 60 + 80 + 60, 'at least every valid TOOL_CALL_* frame');
  assert.equal(expectedRows(NO_FILTER, 1_234, new Set([2])), 234);
  assert.equal(expectedRows(NO_FILTER, 1_234, new Set([0, 2])), 734);
  assert.equal(expectedRows({ ...NO_FILTER, query: 'zzz-matches-nothing' }, 5_000, new Set([0, 1])), 0);
});

test('every class of frame the expansions need exists, and each has a matching raw detail', () => {
  const all = benchFrames().flat();
  for (const wanted of EXPANSION_VARIANTS) {
    const found = all.filter((item) => classOf(item) === wanted);
    assert.ok(found.length >= 10, `${wanted}: ${found.length}`);
  }
  assert.ok(all.filter((item) => classOf(item) === 'large').every((item) => item.dataBytes >= 16_000));
  assert.ok(all.filter((item) => classOf(item) === 'malformed').every((item) => item.frame.kind === 'non-json'));
  const malformed = all.find((item) => classOf(item) === 'malformed')!;
  assert.equal(expectedDetail(malformed), malformed.frame.data);
  const large = all.find((item) => classOf(item) === 'large')!;
  assert.equal(expectedDetail(large), JSON.stringify(JSON.parse(large.frame.data), null, 2));
});

test('statistics: nearest-rank p95, counts within 200 ms, and a class passes at 95 of 100', () => {
  const values = Array.from({ length: 100 }, (_, at) => at + 1);
  assert.equal(percentile(values, 0.95), 95);
  assert.equal(percentile([5], 0.95), 5);
  assert.ok(Number.isNaN(percentile([], 0.95)));
  const stats = classStats(values.map((value) => value * 2), 200);
  assert.deepEqual({ count: stats.count, within: stats.within, max: stats.max, p95: stats.p95 }, { count: 100, within: 100, max: 200, p95: 190 });
  assert.equal(classPasses(stats), true);
  const exactly95 = classStats([...Array(95).fill(199), ...Array(5).fill(201)]);
  assert.equal(classPasses(exactly95), true);
  const only94 = classStats([...Array(94).fill(10), ...Array(6).fill(500)]);
  assert.equal(only94.within, 94);
  assert.equal(classPasses(only94), false);
  assert.equal(classPasses(classStats(Array(99).fill(1))), false, 'a missing sample fails the class');
  assert.equal(classPasses(classStats([])), false);
  assert.equal(classStats([200]).within, 1, '200 ms itself is within the limit');
});

const requiredRunner: Environment = {
  platform: 'darwin/arm64', osRelease: '24.6.0', macOsVersion: '15.7.1', cpuModel: 'Apple M2', cpuCount: 8, memoryGiB: 16,
  node: 'v24.0.0', browser: '153.0.8010.12', playwright: '1.63.0', headed: true, viewport: { width: 1440, height: 900 },
};
const goodRun = (label: string): RunResult => ({
  label,
  filters: classStats(Array(100).fill(40)),
  expansions: classStats(Array(100).fill(60)),
  retained: { dataFrames: 5_000, exchanges: 10, hashesMatch: true, lateMinimumRetained: 4_000 },
  schedule: { planned: 200, executed: 200, maxLatenessMs: 5, p95LatenessMs: 3 },
  arrival: { exchangeMs: Array(10).fill(10_000), maxOffsetDriftMs: 4 },
  peakHeapBytes: 1e8,
  integrity: [],
});
const full = { warmUps: 1, measured: 3 };

test('only the required runner with the full procedure and passing runs can pass SC-009', () => {
  assert.deepEqual(runnerGaps(requiredRunner), []);
  const runs = [goodRun('m1'), goodRun('m2'), goodRun('m3')];
  assert.equal(judge(runs, requiredRunner, full).sc009, 'passed');

  // The same numbers anywhere else are pending, with the reason listed.
  for (const [patch, gap] of [
    [{ cpuModel: 'Apple M3 Pro' }, /Apple M2/], [{ cpuCount: 12 }, /8/], [{ memoryGiB: 32 }, /16/], [{ macOsVersion: '14.5' }, /15\.7/],
    [{ browser: '140.0.1.2' }, /153\.0\.8010\.12/], [{ playwright: '1.62.0' }, /1\.63\.0/], [{ headed: false }, /headless/], [{ platform: 'linux/x64' }, /darwin\/arm64/],
    [{ viewport: { width: 1280, height: 720 } }, /1440x900/],
  ] as const) {
    const env = { ...requiredRunner, ...patch } as Environment;
    const verdict = judge(runs, env, full);
    assert.equal(verdict.sc009, 'pending', JSON.stringify(patch));
    assert.match(verdict.reasons.join('\n'), gap);
    assert.equal(verdict.integrity, true);
    assert.equal(verdict.thresholds, true);
  }
});

test('on the required runner a slow class, a short procedure or a broken run is not a pass', () => {
  const slow = { ...goodRun('m3'), filters: classStats([...Array(94).fill(50), ...Array(6).fill(400)]) };
  const slowVerdict = judge([goodRun('m1'), goodRun('m2'), slow], requiredRunner, full);
  assert.equal(slowVerdict.sc009, 'not-passed');
  assert.match(slowVerdict.reasons.join('\n'), /m3: 94\/100 filter changes within 200 ms/);

  assert.equal(judge([goodRun('m1')], requiredRunner, { warmUps: 0, measured: 1 }).sc009, 'pending');
  assert.equal(judge([goodRun('m1'), goodRun('m2'), goodRun('m3')], requiredRunner, { warmUps: 0, measured: 3 }).sc009, 'pending');

  const broken = { ...goodRun('m2'), retained: { dataFrames: 4_999, exchanges: 10, hashesMatch: false, lateMinimumRetained: 4_000 }, integrity: ['4999 data frames retained, exactly 5000 are required'] };
  const brokenVerdict = judge([goodRun('m1'), broken, goodRun('m3')], requiredRunner, full);
  assert.equal(brokenVerdict.integrity, false);
  assert.equal(brokenVerdict.sc009, 'not-passed');

  assert.equal(judge([], requiredRunner, full).sc009, 'pending', 'no measurement at all is pending');
});
