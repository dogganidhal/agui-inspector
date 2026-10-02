// F01 T003/T005: the explicit build produces one static asset set with external scripts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const root = process.cwd();
let outdir = '';

before(() => {
  outdir = mkdtempSync(path.join(tmpdir(), 'agui-inspector-build-'));
  execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs'), '--outdir', outdir], { cwd: root, stdio: 'pipe' });
});
after(() => rmSync(outdir, { recursive: true, force: true }));

test('the build emits index.html and one script, nothing else', () => {
  assert.deepEqual(readdirSync(outdir).sort(), ['app.js', 'index.html']);
});

test('index.html loads scripts only from its own origin and has no inline script', () => {
  const html = readFileSync(path.join(outdir, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0]![1]!, /\btype="module"/);
  assert.match(scripts[0]![1]!, /\bsrc="\.\/app\.js"/);
  assert.equal(scripts[0]![2], '', 'no inline script body');
  assert.doesNotMatch(html, /\bon[a-z]+=/i, 'no inline event handlers');
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//, 'no remote asset');
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|\*/);
  assert.match(html, /<div id="root">/);
});

test('the bundle is a single minified module with no source map reference or Node built-in', () => {
  const script = readFileSync(path.join(outdir, 'app.js'), 'utf8');
  assert.ok(script.length > 10_000);
  assert.doesNotMatch(script, /sourceMappingURL/);
  assert.doesNotMatch(script, /\bfrom\s*["']node:/);
  assert.match(script, /getElementById\(["']root["']\)/, 'boots into #root');
});

test('the shipped HTML is the source HTML, copied unchanged', () => {
  assert.equal(
    readFileSync(path.join(outdir, 'index.html'), 'utf8'),
    readFileSync(path.join(root, 'packages/inspector/src/app/index.html'), 'utf8'),
  );
});
