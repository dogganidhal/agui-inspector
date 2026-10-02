// Builds the public demo into its own directory, apart from the ordinary static assets (P03, FR-001,
// FR-006, FR-012, FR-013). It reuses the app build unchanged, then adds only what the demo needs: its
// page, bootstrap, stylesheet, the sibling service worker, the hosting file and the examples'
// configuration with the deployment origin and sub-path in front of its endpoint and preparation references.
// Nothing here writes to packages/inspector/dist, so the npm package and the Python wheel cannot pick
// up a demo file.
// Usage: node scripts/build-demo.mjs [--outdir .build/public-demo] [--base-path /agui-inspector/] [--origin https://dogganidhal.github.io]
//
// Why the origin: a hosted page refuses any endpoint that is not an absolute URL, so the examples' URLs
// carry the origin the page is served from. The worker answers only same-origin requests, so a build whose
// origin differs from the serving origin would send example requests out of the page. Build for the
// origin you serve from (the default is the authorized Pages site); the Pages workflow passes its own.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { buildApp, bundleOptions, defaultOutdir } from './build.mjs';

const root = path.resolve(import.meta.dirname, '..');
const demoDir = path.join(root, 'demo');
const scratchRoot = path.join(root, '.build');

export const DEFAULT_OUTDIR = path.join(scratchRoot, 'public-demo');
export const DEFAULT_BASE_PATH = '/agui-inspector/';
export const DEFAULT_ORIGIN = 'https://dogganidhal.github.io';
/** The examples' configuration as the page reads it. There is deliberately no `config.json`. */
export const EXAMPLES_FILE = 'examples.json';
/** Everything a demo build must hold; a missing one fails the build rather than shipping a broken page. */
export const DEMO_FILES = Object.freeze([
  'index.html',
  'app.js',
  'app.css',
  'bootstrap.js',
  'demo.css',
  'service-worker.js',
  'hosting-config.json',
  EXAMPLES_FILE,
]);

/** Source references in demo/config.json that the build turns into base-path URLs. */
const DEMO_PREFIX = '__demo__/';

/**
 * An absolute path on the site that starts and ends with `/`: `/` or `/name/`. Plain segments only, so
 * the result can never carry an origin, credentials, a query, a fragment, an escape or a traversal.
 * @param {string} value
 */
export function normalizeBasePath(value) {
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(value) || /(?:^|\/)\.\.?(?:\/|$)/.test(value)) {
    throw new Error(`--base-path must be an absolute path with a trailing slash such as /agui-inspector/, got "${value}"`);
  }
  return value;
}

/**
 * One origin written alone: HTTPS, or plain HTTP to localhost or 127.0.0.1 for a local preview, the same
 * boundary the hosted page enforces. No credentials, path, query or fragment, and no trailing slash.
 * @param {string} value
 */
export function normalizeOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const loopback = url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
  if (url === undefined || url.origin !== value || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error(`--origin must be one origin such as https://owner.github.io (http only for localhost or 127.0.0.1), without a path, credentials, query or fragment, got "${value}"`);
  }
  return value;
}

/**
 * Where the demo may be written: a directory of its own under `.build`. The build empties it first, so
 * it must never be `.build` itself, the ordinary dist or anything outside the scratch directory.
 * @param {string} value
 */
export function checkOutdir(value) {
  if (value === '') throw new Error('--outdir must not be empty');
  const resolved = path.resolve(root, value);
  const inside = path.relative(scratchRoot, resolved);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`--outdir must be a directory inside ${path.relative(root, scratchRoot)}/, got "${value}"`);
  }
  if (resolved === defaultOutdir || resolved.startsWith(`${defaultOutdir}${path.sep}`)) {
    throw new Error('--outdir must not be the ordinary package build directory');
  }
  return resolved;
}

/**
 * @param {readonly string[]} argv
 * @returns {{ outdir: string, basePath: string, origin: string }}
 */
export function parseDemoArgs(argv) {
  /** @type {Record<string, string>} */
  const given = {};
  const args = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index] ?? '';
    const value = args[index + 1];
    if (flag !== '--outdir' && flag !== '--base-path' && flag !== '--origin') throw new Error(`unknown argument "${flag}"; expected --outdir <dir>, --base-path <path> or --origin <origin>`);
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag in given) throw new Error(`${flag} was given twice`);
    given[flag] = value;
  }
  return {
    outdir: checkOutdir(given['--outdir'] ?? DEFAULT_OUTDIR),
    basePath: normalizeBasePath(given['--base-path'] ?? DEFAULT_BASE_PATH),
    origin: normalizeOrigin(given['--origin'] ?? DEFAULT_ORIGIN),
  };
}

/**
 * The checked-in demo configuration with the origin and base path in front of each endpoint and
 * preparation path. Only those references change: `{{threadId}}`-style templates, bodies and every other
 * field are kept as written, and a reference that is not demo-relative is an error, never silently left alone.
 * @param {string} text the contents of demo/config.json
 * @param {string} origin a normalized origin
 * @param {string} basePath a normalized base path
 */
export function prefixDemoConfig(text, origin, basePath) {
  /** @param {unknown} value @param {string} where */
  const prefixed = (value, where) => {
    if (typeof value !== 'string' || !value.startsWith(DEMO_PREFIX)) throw new Error(`${where} must be a demo-relative reference starting with ${DEMO_PREFIX}`);
    return `${origin}${basePath}${value}`;
  };
  const config = JSON.parse(text);
  for (const [index, agent] of config.agents.entries()) {
    const where = `agents[${index}]`;
    agent.url = prefixed(agent.url, `${where}.url`);
    if (typeof agent.capabilities === 'string') throw new Error(`${where}.capabilities must be inline: a URL there would not be prefixed`);
    for (const [step, request] of (agent.preset?.prepare ?? []).entries()) request.path = prefixed(request.path, `${where}.preset.prepare[${step}].path`);
  }
  const out = JSON.stringify(config, null, 2);
  if (out.includes(`"${DEMO_PREFIX}`)) throw new Error(`a ${DEMO_PREFIX} reference was left without the base path`);
  return `${out}\n`;
}

/** The shared app is imported from the demo's own `app.js`, so the bootstrap carries none of it. */
const sharedAppExternal = {
  name: 'shared-app-external',
  /** @param {import('esbuild').PluginBuild} b */
  setup(b) {
    const app = path.join(root, 'packages', 'inspector', 'src', 'app', 'index.tsx');
    b.onResolve({ filter: /app[\\/]index\.tsx$/ }, (args) => (path.resolve(args.resolveDir, args.path) === app ? { path: './app.js', external: true } : undefined));
  },
};

/**
 * @param {{ outdir?: string, basePath?: string, origin?: string }} [options]
 * @returns {Promise<string>} the directory written
 */
export async function buildDemo({ outdir = DEFAULT_OUTDIR, basePath = DEFAULT_BASE_PATH, origin = DEFAULT_ORIGIN } = {}) {
  const target = checkOutdir(outdir);
  // Prefix first: a bad option or checked-in config fails before anything is written.
  const examples = prefixDemoConfig(readFileSync(path.join(demoDir, 'config.json'), 'utf8'), normalizeOrigin(origin), normalizeBasePath(basePath));
  JSON.parse(readFileSync(path.join(demoDir, 'hosting-config.json'), 'utf8'));

  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  await buildApp(target);
  await build({
    ...bundleOptions(target),
    entryPoints: { bootstrap: path.join(demoDir, 'bootstrap.ts') },
    plugins: [sharedAppExternal],
  });
  // A classic script bundle: the worker is registered without `type: 'module'` and imports nothing at run time.
  await build({
    ...bundleOptions(target),
    format: 'iife',
    entryPoints: { 'service-worker': path.join(demoDir, 'service-worker.ts') },
  });
  copyFileSync(path.join(demoDir, 'index.html'), path.join(target, 'index.html'));
  copyFileSync(path.join(demoDir, 'demo.css'), path.join(target, 'demo.css'));
  copyFileSync(path.join(demoDir, 'hosting-config.json'), path.join(target, 'hosting-config.json'));
  writeFileSync(path.join(target, EXAMPLES_FILE), examples);

  const missing = DEMO_FILES.filter((file) => !existsSync(path.join(target, file)));
  if (missing.length > 0) throw new Error(`the demo build is missing ${missing.join(', ')}`);
  if (existsSync(path.join(target, 'config.json'))) throw new Error('the demo build must not ship a config.json');
  return target;
}

if (path.basename(process.argv[1] ?? '') === 'build-demo.mjs') {
  try {
    const { outdir, basePath, origin } = parseDemoArgs(process.argv.slice(2));
    await buildDemo({ outdir, basePath, origin });
    console.log(`built the public demo into ${path.relative(root, outdir)} for ${origin}${basePath}`);
  } catch (error) {
    console.error(`build-demo: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
