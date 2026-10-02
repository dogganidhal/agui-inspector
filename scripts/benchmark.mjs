// 5,000-frame benchmark status. Usage: npm run test:benchmark [-- --strict] [--manifest <file>]
//
// This script verifies what runs anywhere: the frozen fixture still matches its committed manifest.
// It cannot measure UI responsiveness. Filter and expansion latency is a browser measurement on the
// physical runner in tests/benchmarks/profile.md, supplied by slice L04. Until then the status is
// PENDING and SC-009 is NOT PASSED; no timer that bypasses the UI is accepted as a substitute.
// --strict exits non-zero while anything is pending (the integrated-release gate).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildManifest, generateFixture } from '../tests/benchmarks/generate.ts';

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

  const need = 'needs the benchmark UI (slice L04) and the physical runner in tests/benchmarks/profile.md';
  console.log(`UI responsiveness filters: PENDING, no measurements (${need})`);
  console.log(`UI responsiveness expansions: PENDING, no measurements (${need})`);
  console.log('SC-009 NOT PASSED: responsiveness is pending, and CI timings never certify the 200 ms threshold.');
  return argv.includes('--strict') ? 1 : 0;
}

if (path.basename(process.argv[1] ?? '') === 'benchmark.mjs') process.exit(main(process.argv.slice(2)));
