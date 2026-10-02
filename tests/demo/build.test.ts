// P03 T012, T013, T015, T016: the public demo is a separate build of the one shared app, within the same
// budgets, and nothing of it reaches the ordinary dist or an npm archive. Also the review of the two
// workflows: pull requests build and test only, and the Pages workflow deploys from main alone.
//
// Self-contained and independent of a prior `npm run build`: every output goes to a named directory under
// .build that this file creates and removes. The builds run as the commands CI and the workflow run, in
// child processes: the unit runner bundles this file elsewhere, so a script's own location is not the repository's. The same checks on the real npm archive and the Python
// wheel live in packages/python/tests/test_distribution.py, which runs after the package build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { parseConfig } from '../../packages/inspector/src/core/config/index.ts';
import { parseHostingConfig } from '../../packages/inspector/src/app/security.ts';
import { DEFAULT_BASE_PATH, DEFAULT_ORIGIN, DEMO_FILES, EXAMPLES_FILE, normalizeBasePath, normalizeOrigin, prefixDemoConfig } from '../../scripts/build-demo.mjs';
import { evaluate, LIMITS, measure } from '../../scripts/bundle-budget.mjs';
import { planSteps } from '../../scripts/ci.mjs';

const repo = process.cwd();
mkdirSync(path.join(repo, '.build'), { recursive: true });
const scratch = mkdtempSync(path.join(repo, '.build', 'demo-build-test-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const demoDir = path.join(scratch, 'demo');
const ordinaryBefore = path.join(scratch, 'ordinary-before');
const ordinaryAfter = path.join(scratch, 'ordinary-after');

const defaultOutdir = path.join(repo, 'packages', 'inspector', 'dist');
const run = (script: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' });
function build(script: 'scripts/build.mjs' | 'scripts/build-demo.mjs', ...args: string[]) {
  const done = run(script, ...args);
  assert.equal(done.status, 0, `${script} ${args.join(' ')}\n${done.stdout}${done.stderr}`);
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** Every file under `dir`: relative posix path to the hash of its bytes. */
function tree(dir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
      .sort()
      .map((file) => [file, sha256(readFileSync(path.join(dir, file)))]),
  );
}
const read = (dir: string, file: string) => readFileSync(path.join(dir, file), 'utf8');
const source = (file: string) => readFileSync(path.join(repo, file), 'utf8');

// What only the demo may hold. A hit in any ordinary asset, npm archive or wheel is a leak.
const DEMO_ONLY_NAMES = ['service-worker.js', 'bootstrap.js', 'demo.css', EXAMPLES_FILE];
const DEMO_ONLY_MARKERS = ['agui-demo-hello', 'agui-demo-ready', '__demo__', 'serviceWorker', 'service-worker'];

before(() => {
  // Ordinary build, then the demo, then the ordinary build again: the demo build must leave no trace on it.
  build('scripts/build.mjs', '--outdir', ordinaryBefore);
  build('scripts/build-demo.mjs', '--outdir', demoDir, '--base-path', DEFAULT_BASE_PATH, '--origin', DEFAULT_ORIGIN);
  build('scripts/build.mjs', '--outdir', ordinaryAfter);
});

// ---------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------

test('the complete demo set and the complete ordinary set each meet both budgets', () => {
  const demo = measure(demoDir);
  // Every shipped asset counts, the worker, bootstrap, stylesheets and both JSON files included.
  assert.deepEqual(demo.files.map((file) => file.path).sort(), [...DEMO_FILES].sort());
  assert.deepEqual(evaluate(demo, LIMITS), { ok: true, failures: [] }, `demo: ${demo.bytes} bytes, ${demo.gzipBytes} gzip`);
  const ordinary = measure(ordinaryAfter);
  assert.deepEqual(evaluate(ordinary, LIMITS), { ok: true, failures: [] }, `ordinary: ${ordinary.bytes} bytes, ${ordinary.gzipBytes} gzip`);
  assert.ok(demo.bytes > ordinary.bytes, 'the demo set is the ordinary set plus the demo assets');
});

// ---------------------------------------------------------------------------------------------
// Isolation and dependency separation
// ---------------------------------------------------------------------------------------------

test('the ordinary build is byte-for-byte the same before and after a demo build, and holds no demo asset', () => {
  const before = tree(ordinaryBefore);
  assert.deepEqual(tree(ordinaryAfter), before);
  assert.deepEqual(Object.keys(before).sort(), ['app.css', 'app.js', 'hosting-config.json', 'index.html']);
  for (const file of Object.keys(before)) {
    const text = read(ordinaryAfter, file);
    for (const marker of DEMO_ONLY_MARKERS) assert.equal(text.includes(marker), false, `${file} mentions ${marker}`);
  }
  assert.equal(read(ordinaryAfter, 'hosting-config.json'), source('packages/inspector/public/hosting-config.json'));
  assert.equal(/id="root"/.test(read(ordinaryAfter, 'index.html')), true);
});

test('the demo build never writes to the ordinary package directory', () => {
  const snapshot = () => (existsSync(defaultOutdir) ? JSON.stringify(tree(defaultOutdir)) : 'absent');
  const sameAsBefore = snapshot();
  build('scripts/build-demo.mjs', '--outdir', path.join(scratch, 'second'), '--base-path', '/x/');
  assert.equal(snapshot(), sameAsBefore);
  for (const name of DEMO_ONLY_NAMES) assert.equal(existsSync(path.join(defaultOutdir, name)), false, name);
});

test('the demo shares the app: app.js and app.css are the ordinary bytes, and the other bundles carry none of it', () => {
  const ordinary = tree(ordinaryAfter);
  const demo = tree(demoDir);
  assert.equal(demo['app.js'], ordinary['app.js']);
  assert.equal(demo['app.css'], ordinary['app.css']);

  const bootstrap = read(demoDir, 'bootstrap.js');
  assert.match(bootstrap, /from\s*"\.\/app\.js"/, 'the bootstrap imports the shared app module');
  assert.doesNotMatch(bootstrap, /react|a2ui|zod/i, 'no renderer or framework is bundled twice');
  assert.ok(bootstrap.length < 10_000, `the bootstrap is ${bootstrap.length} bytes`);

  const worker = read(demoDir, 'service-worker.js');
  assert.doesNotMatch(worker, /\breact\b|react-dom|createRoot|mountApp|A2uiSurface|MessageProcessor|(^|[^\w.])document\./, 'the worker has no app, renderer or DOM code');
  assert.doesNotMatch(worker, /^\s*(import|export)\b/m, 'a classic script, so it needs no module worker');
  assert.match(worker, /^(?:"use strict";)?\(\(\)=>\{/, 'one self-contained script');

  const app = read(demoDir, 'app.js');
  for (const marker of ['agui-demo-hello', 'serviceWorker', 'service-worker', '__demo__']) assert.equal(app.includes(marker), false, `app.js mentions ${marker}`);
});

test('only the demo page registers the worker, with the sibling script, this directory and no HTTP cache', () => {
  const bootstrap = source('demo/bootstrap.ts');
  assert.match(bootstrap, /register\(WORKER, \{ scope: '\.\/', updateViaCache: 'none' \}\)/);
  assert.match(bootstrap, /const WORKER = '\.\/service-worker\.js'/);
  assert.match(bootstrap, /const WAIT_MS = 10_000/);
  // A page that is already controlled looks for a newer worker itself, and a worker that cannot be updated is not trusted.
  assert.match(bootstrap, /registration\.update\(\)/);
  assert.match(bootstrap, /an older version of the example worker is in control and could not be updated/);
  // The handshake literals mirror demo/service-worker.ts exactly.
  const worker = source('demo/service-worker.ts');
  assert.match(worker, /const HELLO = 'agui-demo-hello'/);
  assert.match(worker, /const READY = \{ type: 'agui-demo-ready', version: 1, ready: true \} as const/);
  assert.match(bootstrap, /const HELLO = 'agui-demo-hello'/);
  assert.match(bootstrap, /const READY_TYPE = 'agui-demo-ready'/);
  assert.match(bootstrap, /const READY_VERSION = 1/);
  // Examples are chosen through the examples' file only; the demo build ships no `config.json`.
  assert.match(bootstrap, new RegExp(`const EXAMPLES_CONFIG = '${EXAMPLES_FILE.replace('.', '\\.')}'`));
  assert.equal(existsSync(path.join(demoDir, 'config.json')), false);
  // No fake fetch, reload, polling, storage or example request in the page start.
  assert.doesNotMatch(bootstrap, /location\.reload|globalThis\.fetch\s*=|window\.fetch\s*=|setInterval|localStorage\.setItem|caches\.|indexedDB|\.fetch\(/);
});

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

test('the demo page has no #root, one module script, worker-src self and no prefetch or external asset', () => {
  const html = read(demoDir, 'index.html');
  assert.equal(html, source('demo/index.html'));
  // The shared app auto-mounts into #root when the page has one; the demo mounts it once itself.
  assert.doesNotMatch(html, /id="root"/);
  assert.match(html, /id="demo-mount"/);
  const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1] ?? '';
  assert.equal(csp, "script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'");
  assert.doesNotMatch(csp, /unsafe|\*|http/);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'the policy precedes every script');
  assert.deepEqual([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]), ['<script type="module" src="./bootstrap.js">']);
  assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>|\son\w+=|style=|<style/, 'no inline script or style');
  assert.doesNotMatch(html, /rel="(prefetch|preload|preconnect|dns-prefetch|prerender|modulepreload)"/);
  // Native, labelled status outside the app root, and the one link out: explicit navigation, not a fetch.
  assert.match(html, /<p id="demo-status" role="status">Preparing the browser-local examples…<\/p>/);
  const external = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(external, ['https://github.com/dogganidhal/agui-inspector/blob/main/docs/embedding.md']);
  assert.match(html, /<a href="https:\/\/github\.com\/dogganidhal\/agui-inspector\/blob\/main\/docs\/embedding\.md" rel="noopener noreferrer">Embedding guide<\/a>/);
  assert.equal(existsSync(path.join(repo, 'docs', 'embedding.md')), true, 'the linked guide exists in the repository');
  assert.match(html, /scripted agents that run inside this page[\s\S]*type its URL in the connection bar/);
});

test('the stylesheet takes the strip colors from the public --agui properties and adds no asset', () => {
  const css = read(demoDir, 'demo.css');
  assert.match(css, /var\(--agui-bg\)/);
  assert.match(css, /var\(--agui-fg\)/);
  assert.doesNotMatch(css, /url\(|@import|@font-face/);
});

// ---------------------------------------------------------------------------------------------
// Hosting file and examples' configuration
// ---------------------------------------------------------------------------------------------

test('the hosting file is the checked-in hosted opt-in and passes the real parser; the ordinary one stays embedded', () => {
  const text = read(demoDir, 'hosting-config.json');
  assert.equal(text, source('demo/hosting-config.json'));
  const parsed = parseHostingConfig(text);
  assert.deepEqual(parsed.ok && parsed.value, { mode: 'hosted', allowedOrigins: [], allowVisitorTargets: true });
  const ordinary = parseHostingConfig(read(ordinaryAfter, 'hosting-config.json'));
  assert.deepEqual(ordinary.ok && ordinary.value, { mode: 'embedded', allowedOrigins: [] });
});

test('the examples file has the origin and base path in front of every endpoint and preparation, templates intact', () => {
  const sourceText = source('demo/config.json');
  const sourceHash = sha256(sourceText);
  const text = read(demoDir, EXAMPLES_FILE);
  const parsed = parseConfig(text);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
  const config = JSON.parse(text);
  assert.deepEqual(config.agents.map((agent: { url: string }) => agent.url), [
    'https://dogganidhal.github.io/agui-inspector/__demo__/agent/interactive',
    'https://dogganidhal.github.io/agui-inspector/__demo__/agent/a2ui',
    'https://dogganidhal.github.io/agui-inspector/__demo__/agent/protocol/baseline',
    'https://dogganidhal.github.io/agui-inspector/__demo__/agent/protocol/run-error',
  ]);
  assert.deepEqual(config.agents[0].preset.prepare.map((step: { method: string; path: string }) => `${step.method} ${step.path}`), [
    'PUT https://dogganidhal.github.io/agui-inspector/__demo__/prepare/sessions/{{threadId}}',
    'POST https://dogganidhal.github.io/agui-inspector/__demo__/prepare/warm',
  ]);
  assert.deepEqual(config.agents[0].preset.prepare.map((step: { body: unknown }) => step.body), [{ thread: '{{threadId}}' }, { run: '{{runId}}' }]);
  // Nothing but those references changed.
  const strip = (value: { agents: Array<{ url: string; preset?: { prepare?: Array<{ path: string }> } }> }) => {
    for (const agent of value.agents) {
      agent.url = '';
      for (const step of agent.preset?.prepare ?? []) step.path = '';
    }
    return value;
  };
  assert.deepEqual(strip(config), strip(JSON.parse(sourceText)));
  assert.equal(sha256(source('demo/config.json')), sourceHash, 'the checked-in file is not rewritten');
  assert.doesNotMatch(text, /"__demo__\//);
});

test('another origin and base path are applied to the same references, and a stray reference is an error', () => {
  const sourceText = source('demo/config.json');
  const nested = JSON.parse(prefixDemoConfig(sourceText, 'https://example.org', '/tools/inspector/'));
  assert.equal(nested.agents[2].url, 'https://example.org/tools/inspector/__demo__/agent/protocol/baseline');
  assert.equal(JSON.parse(prefixDemoConfig(sourceText, 'http://127.0.0.1:4173', '/')).agents[0].url, 'http://127.0.0.1:4173/__demo__/agent/interactive');
  const withUrl = (url: unknown) => JSON.stringify({ version: 0, agents: [{ id: 'a', url }] });
  for (const url of ['https://elsewhere.example/agent', '/agent', 'agent/interactive', undefined, 3]) {
    assert.throws(() => prefixDemoConfig(withUrl(url), DEFAULT_ORIGIN, '/agui-inspector/'), /demo-relative/, String(url));
  }
  const prepare = (path: unknown) => JSON.stringify({ version: 0, agents: [{ id: 'a', url: '__demo__/a', preset: { prepare: [{ method: 'POST', path }] } }] });
  assert.throws(() => prefixDemoConfig(prepare('https://elsewhere.example/warm'), DEFAULT_ORIGIN, '/agui-inspector/'), /prepare\[0\]\.path must be a demo-relative/);
  const capabilities = JSON.stringify({ version: 0, agents: [{ id: 'a', url: '__demo__/a', capabilities: '__demo__/capabilities' }] });
  assert.throws(() => prefixDemoConfig(capabilities, DEFAULT_ORIGIN, '/agui-inspector/'), /capabilities must be inline/);
});

test('a local preview built for its own origin points every example at that origin, so none can leave the page', () => {
  const origin = 'http://127.0.0.1:4173';
  const outdir = path.join(scratch, 'preview');
  build('scripts/build-demo.mjs', '--outdir', outdir, '--origin', origin);
  const config = read(outdir, EXAMPLES_FILE);
  const urls = [...config.matchAll(/"(?:url|path)": "([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(urls.length, 6);
  for (const url of urls) assert.ok(url.startsWith(`${origin}/agui-inspector/__demo__/`), url);
  // Only the origin differs between that build and the default one.
  assert.equal(config.replaceAll(origin, DEFAULT_ORIGIN), read(demoDir, EXAMPLES_FILE));
  assert.deepEqual(tree(outdir), { ...tree(demoDir), [EXAMPLES_FILE]: sha256(config) });
});

// ---------------------------------------------------------------------------------------------
// Strict arguments
// ---------------------------------------------------------------------------------------------

test('the base path is an absolute path with a trailing slash and nothing else', () => {
  for (const good of ['/', '/agui-inspector/', '/a/b/', '/a.b_c~d-e/']) assert.equal(normalizeBasePath(good), good);
  const bad = [
    '', 'agui-inspector/', '/agui-inspector', 'https://owner.github.io/agui-inspector/', '//evil.example/', '/a//b/', '/a/../b/', '/../', '/a/./b/',
    '/a?x=1/', '/a#frag/', 'user@host/', '/a%2e%2e/', '/a b/', '/a\\b/', '/a:b/', '/{{x}}/',
  ];
  for (const value of bad) assert.throws(() => normalizeBasePath(value), /--base-path/, JSON.stringify(value));
});

test('the origin is one origin, HTTPS or plain HTTP to localhost or 127.0.0.1, and nothing else', () => {
  for (const good of ['https://dogganidhal.github.io', 'https://www.example.com', 'https://example.org:8443', 'http://localhost:4173', 'http://127.0.0.1:4173', 'http://localhost']) {
    assert.equal(normalizeOrigin(good), good);
  }
  const bad = [
    '', 'dogganidhal.github.io', 'https://dogganidhal.github.io/', 'https://dogganidhal.github.io/agui-inspector/', 'https://user:pass@example.org', 'https://user@example.org',
    'https://example.org?x=1', 'https://example.org#frag', 'http://example.org', 'http://192.168.1.5:8080', 'http://[::1]:4173', 'http://127.0.0.2:4173', 'http://foo.localhost:4173',
    'ftp://example.org', 'file:///tmp', 'javascript:alert(1)', 'data:text/plain,x', '//example.org', 'https://EXAMPLE.org', 'https://example.org:443', 'https://exa mple.org', '*',
  ];
  for (const value of bad) assert.throws(() => normalizeOrigin(value), /--origin must be one origin/, JSON.stringify(value));
});

test('arguments are strict: unknown, missing, repeated and out-of-bounds values fail before anything is written', () => {
  const marker = path.join(scratch, 'untouched');
  mkdirSync(marker);
  writeFileSync(path.join(marker, 'keep.txt'), 'keep');
  const refused = (argv: string[], message: RegExp) => {
    const done = run('scripts/build-demo.mjs', ...argv);
    assert.equal(done.status, 1, argv.join(' '));
    assert.match(done.stderr, message, argv.join(' '));
    assert.match(done.stderr, /^build-demo: /);
    assert.equal(done.stdout, '', 'nothing is reported as built');
  };
  refused(['--outdir'], /--outdir needs a value/);
  refused(['--base-path'], /--base-path needs a value/);
  refused(['--outdir', '--base-path', '/x/'], /--outdir needs a value/);
  refused(['--out', 'x'], /unknown argument "--out"/);
  refused(['positional'], /unknown argument "positional"/);
  refused(['--unknown'], /unknown argument/);
  refused(['--outdir', '.build/a', '--outdir', '.build/b'], /--outdir was given twice/);
  refused(['--base-path', '/a/', '--base-path', '/b/'], /--base-path was given twice/);
  refused(['--base-path', 'agui-inspector'], /--base-path must be an absolute path/);
  refused(['--origin'], /--origin needs a value/);
  refused(['--origin', 'https://a.example', '--origin', 'https://b.example'], /--origin was given twice/);
  refused(['--origin', 'https://example.org/agui-inspector/'], /--origin must be one origin/);
  refused(['--origin', 'http://example.org'], /--origin must be one origin/);
  // The output directory is emptied first, so it may only be a directory of its own under .build.
  for (const outdir of ['', '.', '.build', '..', '../elsewhere', '/tmp/demo', 'packages/inspector/dist', '.build/../packages', '.build/../dist', marker.replace(`${path.sep}.build${path.sep}`, `${path.sep}`)]) {
    refused(['--outdir', outdir], /--outdir/);
  }
  refused(['--outdir', path.relative(repo, defaultOutdir)], /--outdir/);
  assert.equal(readFileSync(path.join(marker, 'keep.txt'), 'utf8'), 'keep');
  assert.equal(existsSync(defaultOutdir) ? existsSync(path.join(defaultOutdir, 'bootstrap.js')) : false, false);
});

test('the defaults are .build/public-demo, /agui-inspector/ and the Pages origin, and a leading -- is tolerated like the other scripts', () => {
  const source = readFileSync(path.join(repo, 'scripts', 'build-demo.mjs'), 'utf8');
  assert.match(source, /DEFAULT_OUTDIR = path\.join\(scratchRoot, 'public-demo'\)/);
  assert.equal(DEFAULT_BASE_PATH, '/agui-inspector/');
  assert.equal(DEFAULT_ORIGIN, 'https://dogganidhal.github.io');
  const done = run('scripts/build-demo.mjs', '--', '--outdir', path.relative(repo, path.join(scratch, 'dashed')), '--base-path', '/x/');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /built the public demo into .*dashed for https:\/\/dogganidhal\.github\.io\/x\//);
  assert.equal(JSON.parse(read(path.join(scratch, 'dashed'), EXAMPLES_FILE)).agents[0].url, 'https://dogganidhal.github.io/x/__demo__/agent/interactive');
});

// ---------------------------------------------------------------------------------------------
// The npm archive
// ---------------------------------------------------------------------------------------------

test('an npm archive of the ordinary package holds the app and none of the demo', () => {
  // The workspace manifest and its license files, with the ordinary build as `dist`: the same `files`
  // list and `npm pack --ignore-scripts` as the real package, in a directory this test owns.
  const pkg = path.join(scratch, 'package');
  const out = path.join(scratch, 'pack');
  mkdirSync(path.join(pkg, 'src'), { recursive: true });
  mkdirSync(out);
  for (const file of ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'src/static-path.js']) cpSync(path.join(repo, 'packages', 'inspector', file), path.join(pkg, file));
  cpSync(ordinaryAfter, path.join(pkg, 'dist'), { recursive: true });

  const pack = spawnSync('npm', ['pack', pkg, '--ignore-scripts', '--pack-destination', out], { cwd: scratch, encoding: 'utf8' });
  assert.equal(pack.status, 0, pack.stderr);
  // The last line npm prints is the file name; its JSON output differs between npm versions.
  const tarball = path.join(out, pack.stdout.trim().split('\n').at(-1)!);
  const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  const names = listing.stdout.split('\n').filter(Boolean);
  assert.ok(names.includes('package/dist/index.html') && names.includes('package/dist/app.js'), names.join(', '));
  for (const name of DEMO_ONLY_NAMES) assert.equal(names.some((entry) => entry.endsWith(`/${name}`)), false, name);
  const unpacked = path.join(out, 'unpacked');
  mkdirSync(unpacked);
  assert.equal(spawnSync('tar', ['-xzf', tarball, '-C', unpacked]).status, 0);
  for (const [file] of Object.entries(tree(unpacked))) {
    if (!/\.(js|css|html|json)$/.test(file)) continue;
    const text = read(unpacked, file);
    for (const marker of DEMO_ONLY_MARKERS) assert.equal(text.includes(marker), false, `${file} mentions ${marker}`);
  }
});

// ---------------------------------------------------------------------------------------------
// CI wiring
// ---------------------------------------------------------------------------------------------

const names = (steps: ReturnType<typeof planSteps>) => steps.map((step) => step.name);
const step = (steps: ReturnType<typeof planSteps>, name: string) => {
  const found = steps.find((candidate) => candidate.name === name);
  assert.ok(found, `step ${name} is planned`);
  return found;
};

test('the PR gate runs the demo typechecks, the demo build with its budget and fails closed when they cannot run', () => {
  const steps = planSteps(repo);
  assert.deepEqual(names(steps), ['typecheck', 'demo typecheck', 'unit tests', 'build', 'bundle budget', 'demo build and budget', 'end-to-end tests', 'python tests']);
  assert.deepEqual(step(steps, 'demo typecheck').commands, [
    ['npm', 'exec', '--', 'tsc', '-p', 'demo/tsconfig.json'],
    ['npm', 'exec', '--', 'tsc', '-p', 'demo/tsconfig.worker.json'],
  ]);
  assert.deepEqual(step(steps, 'demo build and budget').commands, [
    ['node', 'scripts/build-demo.mjs', '--outdir', '.build/public-demo', '--base-path', '/agui-inspector/'],
    ['node', 'scripts/bundle-budget.mjs', '--dir', '.build/public-demo'],
  ]);
  assert.deepEqual(steps.map((s) => s.status), ['run', 'run', 'run', 'run', 'run', 'run', 'run', 'run']);
  // The package build comes before the Python step, whose tests open the real archive and wheel.
  assert.ok(names(steps).indexOf('build') < names(steps).indexOf('python tests'));
});

test('a repository that has the demo worker but not the rest of the demo fails the gate; one without the worker is unchanged', () => {
  const fixture = (files: string[]) => {
    const dir = mkdtempSync(path.join(scratch, 'plan-'));
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), '');
    }
    return dir;
  };
  assert.deepEqual(names(planSteps(fixture([]))), ['typecheck', 'unit tests', 'build', 'bundle budget', 'end-to-end tests', 'python tests']);

  const partial = planSteps(fixture(['demo/service-worker.ts', 'demo/tsconfig.worker.json']));
  assert.equal(step(partial, 'demo typecheck').status, 'fail');
  assert.match(step(partial, 'demo typecheck').detail, /demo\/tsconfig\.json/);
  assert.equal(step(partial, 'demo build and budget').status, 'fail');
  assert.match(step(partial, 'demo build and budget').detail, /scripts\/build-demo\.mjs/);

  const noTests = planSteps(fixture(['demo/service-worker.ts', 'demo/tsconfig.worker.json', 'demo/tsconfig.json', 'scripts/build-demo.mjs']));
  assert.equal(step(noTests, 'demo unit tests').status, 'fail');
  assert.match(step(noTests, 'demo unit tests').detail, /tests\/demo/);
  assert.equal(step(planSteps(repo), 'unit tests').status, 'run');
  assert.equal(names(planSteps(repo)).includes('demo unit tests'), false, 'present tests are run by the unit tests step');
});

test('pull request CI deploys nothing and gains no Pages permission', () => {
  const ci = source('.github/workflows/ci.yml');
  const configured = ci.replace(/^\s*#.*$/gm, ''); // what the workflow does, not what its comments say
  assert.match(ci, /^on:\n {2}pull_request:\n/m);
  assert.doesNotMatch(ci, /^\s*(push|workflow_dispatch|schedule|release):/m);
  assert.match(ci, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(configured, /pages|id-token|deploy|upload-pages-artifact|environment:|actions: write|contents: write/i);
  assert.match(ci, /npm run check:ci/);
});

// ---------------------------------------------------------------------------------------------
// The Pages workflow
// ---------------------------------------------------------------------------------------------

const PAGES = '.github/workflows/pages.yml';
const jobBlock = (text: string, job: string) => text.match(new RegExp(`^ {2}${job}:\\n((?: {4}.*\\n|\\n)+)`, 'm'))?.[1] ?? '';

test('the Pages workflow runs for main only: a push to main or a manual run that refuses any other ref', () => {
  const text = source(PAGES);
  const triggers = text.match(/^on:\n((?: {2}.*\n|\n)+)/m)?.[1] ?? '';
  assert.deepEqual(triggers.match(/^ {2}(\w+):/gm)?.map((t) => t.trim()), ['push:', 'workflow_dispatch:']);
  assert.match(triggers, /push:\n {4}branches: \[main\]\n/);
  assert.doesNotMatch(text, /pull_request|pull_request_target|schedule:|workflow_run|tags:|release:/);
  // Both jobs refuse a manual run from any other branch.
  for (const job of ['build', 'deploy']) assert.match(jobBlock(text, job), /^ {4}if: github\.ref == 'refs\/heads\/main'$/m, `${job} is main-only`);
});

test('the Pages workflow gives the build job read access and the deploy job Pages access only, serialized', () => {
  const text = source(PAGES);
  const permissions = (block: string) => block.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m)?.[1]?.trim().split('\n').map((line) => line.trim()).filter((line) => !line.startsWith('#'));
  const build = jobBlock(text, 'build');
  const deploy = jobBlock(text, 'deploy');
  // Reading the Pages site's origin and path needs `pages: read`; nothing in the build job can write.
  assert.deepEqual(permissions(build), ['contents: read', 'pages: read']);
  assert.deepEqual(permissions(deploy), ['pages: write', 'id-token: write']);
  assert.match(text, /^permissions: \{\}$/m, 'nothing is granted by default');
  assert.match(deploy, /^ {4}needs: build$/m);
  assert.match(deploy, /^ {4}environment:\n {6}name: github-pages\n {6}url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}$/m);
  assert.match(text, /^concurrency:\n {2}group: pages\n {2}cancel-in-progress: false$/m, 'deployments are serialized, never cancelled midway');
  // The deploying job runs no repository code, only the deploy action.
  assert.doesNotMatch(deploy, /run:|actions\/checkout|npm /);
  assert.match(deploy, /id: deployment/);
});

test('the Pages workflow validates and uploads only the isolated demo directory, with locked installs and pinned actions', () => {
  const text = source(PAGES);
  const build = jobBlock(text, 'build');
  const order = [
    'npm ci --ignore-scripts',
    'actions/configure-pages@',
    'node scripts/build-demo.mjs --outdir .build/public-demo',
    'node scripts/bundle-budget.mjs --dir .build/public-demo',
    'npm run test:unit -- tests/demo/build.test.ts',
    'actions/upload-pages-artifact@',
  ].map((needle) => {
    assert.ok(build.includes(needle), `${needle} is a step`);
    return build.indexOf(needle);
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'install, site settings, build, budget, checks, then upload');
  // The origin and base path come from the site's own settings, so a fork deploys with its own; no literal host.
  assert.match(build, /uses: actions\/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5\n\s+id: pages\n(?!\s+with:)/, 'pinned, and no input: it cannot enable Pages');
  assert.match(build, /node scripts\/build-demo\.mjs --outdir \.build\/public-demo --origin "\$PAGES_ORIGIN" --base-path "\$PAGES_BASE_PATH\/"/);
  assert.match(build, /PAGES_ORIGIN: \$\{\{ steps\.pages\.outputs\.origin \}\}\n\s+PAGES_BASE_PATH: \$\{\{ steps\.pages\.outputs\.base_path \}\}/);
  assert.doesNotMatch(text, /dogganidhal|github\.io/, 'no literal host in the workflow');
  assert.match(build, /uses: actions\/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4\n\s+with:\n\s+path: \.build\/public-demo\n/);
  assert.match(text, /uses: actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4\n/);
  assert.match(build, /persist-credentials: false/);
  assert.doesNotMatch(text, /npm (?:ci|install)(?![^\n]*--ignore-scripts)/);
  // The same checkout and setup-node pins as the pull request workflow.
  const pins = (file: string) => [...source(file).matchAll(/uses:\s*(actions\/(?:checkout|setup-node)@\S+ # \S+)/g)].map((m) => m[1]);
  assert.deepEqual(pins(PAGES), pins('.github/workflows/ci.yml').slice(0, 2));
  for (const [, ref] of text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)) assert.match(ref!, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, ref);
});

test('the Pages workflow neither enables Pages, nor ships a package, tags or releases, nor reads a secret', () => {
  const text = source(PAGES);
  assert.doesNotMatch(text, /enablement|gh api|gh repo|gh release|git tag|git push|npm publish|uv publish|twine|provenance|attest/i);
  assert.doesNotMatch(text, /\bpublish\b|pypi/i);
  assert.doesNotMatch(text, /secrets\.|packages: write|contents: write|attestations/);
  assert.doesNotMatch(text, /pull_request/);
});

// ---------------------------------------------------------------------------------------------
// The documentation says what the build does
// ---------------------------------------------------------------------------------------------

test('the demo guide states the public URL, the matching-origin rule, the commands and the separate authorization', () => {
  const doc = source('docs/public-demo.md');
  assert.match(doc, /https:\/\/dogganidhal\.github\.io\/agui-inspector\//);
  assert.match(doc, /\*\*Build for the origin you serve from\.\*\*/);
  assert.match(doc, /node scripts\/build-demo\.mjs --outdir \.build\/public-demo --base-path \/agui-inspector\//);
  assert.match(doc, /--origin http:\/\/127\.0\.0\.1:4173/);
  assert.match(doc, /The workflow does not turn Pages on/);
  assert.match(doc, /\[embedding guide\]\(https:\/\/github\.com\/dogganidhal\/agui-inspector\/blob\/main\/docs\/embedding\.md\)/);
  for (const topic of ['localhost', 'CORS', 'IPv6', 'reload the page', 'Export session', '10 seconds']) assert.ok(doc.includes(topic), topic);
  const development = source('docs/development.md');
  for (const command of [
    'npm exec -- tsc -p demo/tsconfig.json',
    'npm exec -- tsc -p demo/tsconfig.worker.json',
    'node scripts/build-demo.mjs --outdir .build/public-demo --base-path /agui-inspector/',
    'node scripts/bundle-budget.mjs --dir .build/public-demo',
  ]) assert.ok(development.includes(command), command);
});
