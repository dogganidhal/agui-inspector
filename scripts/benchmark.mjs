// 5,000-frame benchmark. Usage: npm run test:benchmark [-- --measure] [--strict] [--manifest <file>]
//
// By default it verifies what runs anywhere, in seconds: the frozen fixture against its committed
// manifest and the planned interaction schedule against the plan. Responsiveness is not measured,
// so SC-009 is reported PENDING / NOT PASSED. `--measure` then runs the real browser benchmark
// (tests/benchmarks/interaction.spec.ts: one warm-up and three measured runs of about 105 s each,
// through the production-built host with the full renderer). Latency is only certified on the
// physical runner in tests/benchmarks/profile.md; on any other machine the timings are reported
// and SC-009 stays PENDING. No timer that bypasses the UI is accepted. Environment:
// BENCHMARK_HEADED=1 on the required runner; BENCHMARK_QUICK=1 for one measured run without a
// warm-up (never a pass).
// --strict exits non-zero unless SC-009 passed (the integrated-release gate).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildManifest, generateFixture } from '../tests/benchmarks/generate.ts';
import { FILTER_VARIANTS, PLAN, planInteractions } from '../tests/benchmarks/render-measurement.ts';

const root = path.resolve(import.meta.dirname, '..');
const fmt = (/** @type {number} */ n) => n.toLocaleString('en-US');

/**
 * First place the regenerated fixture departs from the committed manifest, or undefined.
 * @param {Record<string, any>} committed
 * @param {Record<string, any>} actual
 */
function firstDifference(committed, actual) {
  const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);
  for (const key of Object.keys({ ...committed, ...actual })) {
    if (key !== 'exchanges' && !same(committed[key], actual[key])) return `${key} differs`;
  }
  const count = Math.max(committed.exchanges?.length ?? 0, actual.exchanges.length);
  for (let i = 0; i < count; i++) {
    const [was, now] = [committed.exchanges?.[i] ?? {}, actual.exchanges[i] ?? {}];
    for (const key of Object.keys({ ...was, ...now })) {
      if (!same(was[key], now[key])) return `exchange ${i}: ${key} differs`;
    }
  }
  return undefined;
}

/** The planned schedule is exactly the plan's. Returns the first departure, or undefined. */
function scheduleProblem() {
  const plan = planInteractions();
  const count = (/** @type {string} */ variant) => plan.filter((item) => item.variant === variant).length;
  if (plan.length !== PLAN.interactions) return `${plan.length} interactions planned, the plan has ${PLAN.interactions}`;
  if (plan[0]?.atMs !== 20_000 || plan.at(-1)?.atMs !== 99_600) return 'the schedule does not run from t=20 s through t=99.6 s';
  if (plan.some((item, at) => item.atMs !== 20_000 + at * 400 || item.class !== (at % 2 === 0 ? 'filter' : 'expansion'))) return 'interactions are not 400 ms apart and alternating';
  const filters = FILTER_VARIANTS.map(count);
  if (filters.join() !== '34,33,33' || ['normal', 'malformed', 'large'].map(count).join() !== '34,33,33') return 'the class cycles are not 34/33/33';
  const late = plan.slice(-PLAN.lateInteractions);
  if (late.some((item) => Math.floor((item.atMs * PLAN.framesPerSecond) / 1000) < PLAN.lateRetainedMinimum)) return 'the last 50 interactions would run with fewer than 4,000 frames retained';
  return undefined;
}

function main(/** @type {string[]} */ argv) {
  const flag = argv.indexOf('--manifest');
  const manifestPath = flag >= 0 && argv[flag + 1] ? path.resolve(argv[flag + 1] ?? '') : path.join(root, 'tests', 'benchmarks', 'manifest.json');
  const committed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const actual = buildManifest(generateFixture());

  const difference = firstDifference(committed, actual);
  if (difference) {
    console.error(`fixture does not match ${path.relative(root, manifestPath)}: ${difference}`);
    console.error('The fixture is frozen. Only a reviewed profile change may regenerate it: node tests/benchmarks/generate.ts --write');
    return 1;
  }
  console.log(
    `fixture verified: ${actual.exchanges.length} exchanges, ${fmt(actual.frameCount)} frames (${fmt(actual.schemaValidFrames)} schema-valid, ${fmt(actual.invalidFrames)} invalid), ` +
      `${fmt(actual.wireBytes)} wire bytes, sha256 ${actual.sha256}`,
  );

  const problem = scheduleProblem();
  if (problem) {
    console.error(`interaction schedule does not match the plan: ${problem}`);
    return 1;
  }
  console.log(`schedule verified: ${PLAN.interactions} interactions, one every ${PLAN.intervalMs} ms from t=20 s through t=99.6 s, filters and expansions alternating, last ${PLAN.lateInteractions} with at least ${fmt(PLAN.lateRetainedMinimum)} frames retained`);

  const strict = argv.includes('--strict');
  const reportPath = path.join(root, '.build', 'benchmark', 'report.json');
  if (!argv.includes('--measure')) {
    const need = 'run `npm run test:benchmark -- --measure` on the physical runner in tests/benchmarks/profile.md';
    console.log(`UI responsiveness filters: PENDING, no measurements (${need})`);
    console.log(`UI responsiveness expansions: PENDING, no measurements (${need})`);
    console.log('SC-009 NOT PASSED: responsiveness is pending, and CI timings never certify the 200 ms threshold.');
    return strict ? 1 : 0;
  }

  rmSync(reportPath, { force: true });
  const run = spawnSync('npx', ['playwright', 'test', '-c', 'tests/benchmarks/playwright.config.ts'], { cwd: root, stdio: 'inherit', env: process.env });
  if (run.error || run.status !== 0 || !existsSync(reportPath)) {
    console.error(run.error ? `could not start the browser benchmark: ${run.error.message}` : 'the browser benchmark failed its integrity checks or did not finish; see the output above');
    console.log('SC-009 NOT PASSED: no trustworthy measurement.');
    return 1;
  }
  const { verdict } = JSON.parse(readFileSync(reportPath, 'utf8'));
  console.log(`report: ${path.relative(root, reportPath)}`);
  if (verdict.sc009 === 'passed') console.log('SC-009 PASSED on the required runner.');
  else if (verdict.sc009 === 'pending') console.log('SC-009 PENDING: timings reported for this machine only; the required runner has not been used.');
  else console.log('SC-009 NOT PASSED on the required runner.');
  return strict ? (verdict.sc009 === 'passed' ? 0 : 1) : verdict.sc009 === 'not-passed' ? 1 : 0;
}

if (path.basename(process.argv[1] ?? '') === 'benchmark.mjs') process.exit(main(process.argv.slice(2)));
