// F03 T009: the bundle budget accounts for every shipped asset and fails above either limit.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, test } from 'node:test';
import { LIMITS, evaluate, gzipSize, measure } from '../../../../scripts/bundle-budget.mjs';

const root = process.cwd();
const script = path.join(root, 'scripts', 'bundle-budget.mjs');

let scratch = '';
before(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'agui-inspector-budget-'));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

/** A fresh directory holding the given files (path -> contents). */
function assets(name: string, files: Record<string, Buffer | string>): string {
  const dir = path.join(scratch, name);
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), contents);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Deterministic bytes that gzip cannot shrink (xorshift32), so gzip size is close to raw size. */
function incompressible(length: number): Buffer {
  const out = Buffer.alloc(length);
  let state = 0x2545f491;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

function run(dir: string) {
  const result = spawnSync(process.execPath, [script, '--dir', dir], { cwd: root, encoding: 'utf8' });
  const out = result.stdout + result.stderr;
  return { status: result.status, out, failures: out.split('\n').filter((line) => line.startsWith('FAIL ')) };
}

test('limits are the decimal 2,000,000 minified and 600,000 gzip bytes of the constitution', () => {
  assert.deepEqual({ ...LIMITS }, { bytes: 2_000_000, gzipBytes: 600_000 });
});

test('a total exactly at either limit passes', () => {
  assert.deepEqual(evaluate({ bytes: 2_000_000, gzipBytes: 600_000 }), { ok: true, failures: [] });
  assert.equal(evaluate({ bytes: 0, gzipBytes: 0 }).ok, true);
});

test('one byte over the minified limit fails, naming it', () => {
  const { ok, failures } = evaluate({ bytes: 2_000_001, gzipBytes: 600_000 });
  assert.equal(ok, false);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!, /minified.*2,000,001.*2,000,000/);
});

test('one byte over the gzip limit fails, naming it', () => {
  const { ok, failures } = evaluate({ bytes: 2_000_000, gzipBytes: 600_001 });
  assert.equal(ok, false);
  assert.equal(failures.length, 1);
  assert.match(failures[0]!, /gzip.*600,001.*600,000/);
});

test('both limits over reports both failures', () => {
  const { ok, failures } = evaluate({ bytes: 3_000_000, gzipBytes: 900_000 });
  assert.equal(ok, false);
  assert.equal(failures.length, 2);
});

test('gzip size uses a fixed header: no mtime, so it never depends on file times', () => {
  const body = Buffer.from('const a = "synthetic";\n'.repeat(500));
  assert.equal(gzipSize(body), gzipSync(body, { level: 6 }).length);
  const header = gzipSync(body, { level: 6 }).subarray(0, 10);
  assert.deepEqual([...header.subarray(4, 8)], [0, 0, 0, 0], 'mtime field of the gzip header is zero');

  const dir = assets('mtime', { 'app.js': body });
  const first = measure(dir);
  utimesSync(path.join(dir, 'app.js'), new Date(2001, 0, 1), new Date(2001, 0, 1));
  assert.deepEqual(measure(dir), first);
});

test('measure counts every file, nested chunks and non-script assets included, sorted by path', () => {
  const dir = assets('complete', {
    'index.html': '<!doctype html>',
    'app.js': 'a'.repeat(1000),
    'chunks/renderer-ABC123.js': 'b'.repeat(2000),
    'assets/renderer.css': 'c'.repeat(300),
    'assets/catalog.json': '{}',
    'assets/font.woff2': incompressible(4096),
    'assets/logo.svg': '<svg/>',
  });
  const result = measure(dir);
  assert.deepEqual(
    result.files.map((file) => file.path),
    ['app.js', 'assets/catalog.json', 'assets/font.woff2', 'assets/logo.svg', 'assets/renderer.css', 'chunks/renderer-ABC123.js', 'index.html'],
  );
  assert.equal(result.bytes, 15 + 1000 + 2000 + 300 + 2 + 4096 + 6);
  assert.equal(result.bytes, result.files.reduce((sum, file) => sum + file.bytes, 0));
  assert.equal(result.gzipBytes, result.files.reduce((sum, file) => sum + file.gzipBytes, 0), 'gzip is summed per file');
  assert.ok(result.files.every((file) => file.gzipBytes > 0));
});

test('gzip is summed per file, not taken over one combined archive', () => {
  const same = Buffer.from('const shared = "synthetic";\n'.repeat(200));
  const result = measure(assets('per-file', { 'a.js': same, 'b.js': same }));
  assert.equal(result.gzipBytes, 2 * gzipSize(same));
  assert.ok(result.gzipBytes > gzipSize(Buffer.concat([same, same])));
});

test('source maps are the only excluded files', () => {
  const dir = assets('maps', { 'app.js': 'x', 'app.js.map': 'm'.repeat(5000), 'chunks/a.js.map': 'm', 'notes.txt': 'kept' });
  assert.deepEqual(measure(dir).files.map((file) => file.path), ['app.js', 'notes.txt']);
});

test('an unreadable inventory is an error, never an empty pass', () => {
  assert.throws(() => measure(path.join(scratch, 'does-not-exist')), /does not exist|not a directory/);
  assert.throws(() => measure(assets('empty', {})), /no shipped assets/);
  assert.throws(() => measure(assets('only-maps', { 'app.js.map': '{}' })), /no shipped assets/);
});

test('the command exits 0 under the limits and prints every file and both totals', () => {
  const dir = assets('cli-ok', { 'index.html': '<html/>', 'app.js': 'a'.repeat(1000), 'chunks/lazy.js': 'b'.repeat(500) });
  const { status, out } = run(dir);
  assert.equal(status, 0, out);
  for (const file of ['index.html', 'app.js', 'chunks/lazy.js']) assert.ok(out.includes(file), `lists ${file}`);
  assert.match(out, /total +1,507 /);
  assert.match(out, /gzip bytes/);
  assert.match(out, /bundle budget: PASS/);
});

test('the command exits 1 above the minified limit only', () => {
  const dir = assets('cli-raw', { 'app.js': Buffer.alloc(2_000_001, 0x61) });
  const { status, out, failures } = run(dir);
  assert.equal(status, 1, out);
  assert.equal(failures.length, 1, out);
  assert.match(failures[0]!, /minified total 2,000,001/);
});

test('the command exits 1 above the gzip limit only', () => {
  // 1,000,000 incompressible bytes gzip to about 1,000,000 bytes: over 600,000, under 2,000,000.
  const dir = assets('cli-gzip', { 'app.js': incompressible(1_000_000) });
  const { status, out, failures } = run(dir);
  assert.equal(status, 1, out);
  assert.equal(failures.length, 1, out);
  assert.match(failures[0]!, /gzip total/);
});

test('the command exits 1 with both failures when both limits are exceeded', () => {
  const dir = assets('cli-both', { 'app.js': incompressible(2_000_001) });
  const { status, out, failures } = run(dir);
  assert.equal(status, 1, out);
  assert.equal(failures.length, 2, out);
});

test('exactly 2,000,000 minified bytes passes through the command', () => {
  const dir = assets('cli-equal', { 'app.js': Buffer.alloc(2_000_000, 0x61) });
  const { status, out } = run(dir);
  assert.equal(status, 0, out);
});

test('the command fails when the asset directory is missing or empty', () => {
  const missing = run(path.join(scratch, 'nope'));
  assert.equal(missing.status, 1);
  assert.match(missing.out, /npm run build/);
  assert.equal(run(assets('cli-empty', {})).status, 1);
});

test('the real scaffold build is counted completely: html and script, nothing skipped', () => {
  const dir = path.join(scratch, 'scaffold');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build.mjs'), '--outdir', dir], { cwd: root, stdio: 'pipe' });
  const result = measure(dir);
  assert.deepEqual(result.files.map((file) => file.path), ['app.js', 'index.html']);
  assert.equal(evaluate(result).ok, true);
  const { status, out } = run(dir);
  assert.equal(status, 0, out);
});

test('the representative build includes the pinned v0.9 renderer and reports headroom, not certification', () => {
  const scaffold = measure(path.join(scratch, 'scaffold'));
  const result = spawnSync(process.execPath, [script, '--representative'], { cwd: root, encoding: 'utf8' });
  const out = result.stdout + result.stderr;
  assert.equal(result.status, 0, out);
  assert.match(out, /headroom/i);
  assert.match(out, /not certified/i);
  assert.match(out, /a2ui v0\.9 renderer/i);

  const representative = measure(path.join(root, '.build', 'representative'));
  assert.ok(representative.files.some((file) => file.path === 'index.html'));
  assert.ok(representative.files.some((file) => file.path.endsWith('.js')));
  assert.ok(
    representative.bytes > scaffold.bytes + 100_000,
    `the renderer, client and schemas add real weight (${representative.bytes} vs ${scaffold.bytes})`,
  );
  assert.equal(evaluate(representative).ok, true);
});
