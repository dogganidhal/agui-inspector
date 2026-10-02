// Builds the one static asset set: index.html plus external JS. Usage: npm run build [-- --outdir <dir>]
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
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
  return result;
}

if (path.basename(process.argv[1] ?? '') === 'build.mjs') {
  const flag = process.argv.indexOf('--outdir');
  const outdir = flag > 0 && process.argv[flag + 1] ? path.resolve(process.argv[flag + 1] ?? '') : defaultOutdir;
  await buildApp(outdir);
  console.log(`built ${path.relative(root, outdir) || '.'}`);
}
