// Builds the one static asset set: index.html plus external JS, and, unless --outdir is given, the Node-side code
// (server helpers and command line tool, packages/inspector/lib). Usage: npm run build [-- --outdir <dir>]
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const packageDir = path.join(root, 'packages', 'inspector');
export const defaultOutdir = path.join(packageDir, 'dist');

// @ag-ui/a2ui-middleware imports Node's `crypto` at module scope, but the inspector only reads
// its RENDER_A2UI_TOOL declaration. Resolve that import to a browser stand-in instead of
// shipping a Node built-in reference or re-declaring the upstream tool.
const cryptoShim = `
export const randomUUID = () => globalThis.crypto.randomUUID();
export const createHash = () => { throw new Error('createHash is not available in the browser bundle'); };
`;

/** @type {import('esbuild').Plugin} */
export const browserCryptoShim = {
  name: 'browser-crypto-shim',
  setup(b) {
    b.onResolve({ filter: /^crypto$/ }, () => ({ path: 'crypto', namespace: 'crypto-shim' }));
    b.onLoad({ filter: /.*/, namespace: 'crypto-shim' }, () => ({ contents: cryptoShim, loader: 'js' }));
  },
};

/** Shared by the app build and the compatibility tests so both bundle the same way. */
export function bundleOptions(/** @type {string} */ outdir) {
  return /** @satisfies {import('esbuild').BuildOptions} */ ({
    bundle: true,
    outdir,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    jsx: 'automatic',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [browserCryptoShim],
    logLevel: 'warning',
  });
}

export async function buildApp(/** @type {string} */ outdir = defaultOutdir) {
  if (outdir === defaultOutdir) rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const result = await build({
    ...bundleOptions(outdir),
    entryPoints: { app: path.join(packageDir, 'src', 'app', 'index.tsx') },
    metafile: true,
  });
  copyFileSync(path.join(packageDir, 'src', 'app', 'index.html'), path.join(outdir, 'index.html'));
  // Deployment files that sit beside the page, such as hosting-config.json, ship unchanged.
  const publicDir = path.join(packageDir, 'public');
  if (existsSync(publicDir)) cpSync(publicDir, outdir, { recursive: true });
  return result;
}

/**
 * Compiles the Express, Hono and Next.js helpers (src/server) and the command line tool (src/cli) to JavaScript and
 * declarations in lib/, which the npm package ships. Node does not strip types from installed packages, so TypeScript
 * cannot ship as it is. Throws when an `exports` or `bin` target of the package that points into lib/ was not written.
 */
export function buildServer() {
  const lib = path.join(packageDir, 'lib');
  rmSync(lib, { recursive: true, force: true });
  const run = spawnSync('npm', ['exec', '--', 'tsc', '-p', path.join(packageDir, 'tsconfig.server.json')], { cwd: root, stdio: 'inherit' });
  if (run.error) throw new Error(`could not run tsc: ${run.error.message}`);
  if (run.status !== 0) throw new Error('tsc failed to build the server helpers');
  const { exports, bin = {} } = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  const targets = [...Object.values(exports).flatMap((entry) => (typeof entry === 'string' ? [entry] : Object.values(entry))), ...Object.values(bin)];
  for (const target of targets.filter((file) => file.startsWith('./lib/'))) {
    if (!existsSync(path.join(packageDir, target))) throw new Error(`exports or bin target ${target} is missing from packages/inspector/lib`);
  }
}

if (path.basename(process.argv[1] ?? '') === 'build.mjs') {
  const flag = process.argv.indexOf('--outdir');
  const outdir = flag > 0 && process.argv[flag + 1] ? path.resolve(process.argv[flag + 1] ?? '') : defaultOutdir;
  await buildApp(outdir);
  console.log(`built ${path.relative(root, outdir) || '.'}`);
  if (flag < 0) {
    buildServer();
    console.log('built packages/inspector/lib');
  }
}
