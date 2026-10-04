// Production bundle budget: every shipped client asset counts, and the build fails above either limit.
// Usage: npm run check:bundle [-- --dir <assets directory>]
//        npm run check:bundle:renderer   (representative build with the pinned v0.8 and v0.9 renderers)
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { bundleOptions, defaultOutdir } from './build.mjs';

const root = path.resolve(import.meta.dirname, '..');
const packageDir = path.join(root, 'packages', 'inspector');

/** Decimal bytes, from the constitution: 2 MB minified and 600 KB gzipped. */
export const LIMITS = Object.freeze({ bytes: 2_000_000, gzipBytes: 600_000 });

/**
 * @typedef {{ path: string, bytes: number, gzipBytes: number }} AssetSize
 * @typedef {{ files: AssetSize[], bytes: number, gzipBytes: number }} Measurement
 */

const fmt = (/** @type {number} */ n) => n.toLocaleString('en-US');

/**
 * Gzip size of one file. The zlib header carries no modification time (mtime is always 0) and the
 * level is fixed, so the number depends only on the bytes and the Node/zlib build.
 */
export function gzipSize(/** @type {Uint8Array} */ contents) {
  return gzipSync(contents, { level: 6 }).length;
}

/**
 * Sizes every file under `dir`, nested chunks and non-script assets included. Only source maps are
 * left out: they are not served to users. Anything else in the directory is shipped, so it counts.
 * @returns {Measurement}
 */
export function measure(/** @type {string} */ dir) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`asset directory does not exist or is not a directory: ${dir}`);
  }
  /** @type {AssetSize[]} */
  const files = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const full = path.join(entry.parentPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`symbolic link in the asset directory is not counted reliably: ${full}`);
    if (!entry.isFile() || entry.name.endsWith('.map')) continue;
    const contents = readFileSync(full);
    files.push({ path: path.relative(dir, full).split(path.sep).join('/'), bytes: contents.length, gzipBytes: gzipSize(contents) });
  }
  if (files.length === 0) throw new Error(`no shipped assets found in ${dir}`);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    files,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
  };
}

/**
 * A total equal to its limit passes; one byte more fails.
 * @param {{ bytes: number, gzipBytes: number }} totals
 * @param {{ bytes: number, gzipBytes: number }} limits
 */
export function evaluate(totals, limits = LIMITS) {
  /** @type {string[]} */
  const failures = [];
  if (totals.bytes > limits.bytes) failures.push(`minified total ${fmt(totals.bytes)} bytes exceeds the ${fmt(limits.bytes)} byte limit`);
  if (totals.gzipBytes > limits.gzipBytes) failures.push(`gzip total ${fmt(totals.gzipBytes)} bytes exceeds the ${fmt(limits.gzipBytes)} byte limit`);
  return { ok: failures.length === 0, failures };
}

/** Per-file and total sizes, then the limits and what is left under them. */
export function formatTable(/** @type {Measurement} */ measurement, limits = LIMITS) {
  const width = Math.max(...measurement.files.map((file) => file.path.length), 'headroom'.length);
  const row = (/** @type {string} */ name, /** @type {number | string} */ bytes, /** @type {number | string} */ gzip) =>
    `${name.padEnd(width)}  ${(typeof bytes === 'number' ? fmt(bytes) : bytes).padStart(11)}  ${(typeof gzip === 'number' ? fmt(gzip) : gzip).padStart(11)}`;
  return [
    row('file', 'bytes', 'gzip bytes'),
    ...measurement.files.map((file) => row(file.path, file.bytes, file.gzipBytes)),
    row('total', measurement.bytes, measurement.gzipBytes),
    row('limit', limits.bytes, limits.gzipBytes),
    row('headroom', limits.bytes - measurement.bytes, limits.gzipBytes - measurement.gzipBytes),
  ].join('\n');
}

/**
 * A build of what the final app will weigh most of: the scaffold app plus the pinned A2UI v0.8 and v0.9
 * renderers and the v0.9 catalog, A2UI core, the AG-UI client and event schemas, and the upstream render
 * tool. Writes the same `index.html` the real build ships. It is an estimate of renderer cost, not
 * the final application.
 */
export async function buildRepresentative(/** @type {string} */ outdir) {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  await build({
    ...bundleOptions(outdir),
    entryNames: 'app',
    stdin: {
      contents: `
        import './src/app/index.tsx';
        import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9';
        import { MessageProcessor } from '@a2ui/web_core/v0_9';
        import { A2UIProvider, A2UIRenderer } from '@a2ui/react/v0_8';
        import { A2uiMessageProcessor, A2uiMessageSchema } from '@a2ui/web_core/v0_8';
        import { HttpAgent } from '@ag-ui/client';
        import { EventSchemas, RunAgentInputSchema } from '@ag-ui/core/schemas';
        import { RENDER_A2UI_TOOL } from '@ag-ui/a2ui-middleware';
        globalThis.__representative = { A2uiSurface, basicCatalog, MessageProcessor, A2UIProvider, A2UIRenderer, A2uiMessageProcessor, A2uiMessageSchema, HttpAgent, EventSchemas, RunAgentInputSchema, RENDER_A2UI_TOOL };
      `,
      resolveDir: packageDir,
      sourcefile: 'app.tsx',
      loader: 'tsx',
    },
  });
  copyFileSync(path.join(packageDir, 'src', 'app', 'index.html'), path.join(outdir, 'index.html'));
}

async function main(/** @type {string[]} */ argv) {
  const representative = argv.includes('--representative');
  const flag = argv.indexOf('--dir');
  const dir = representative
    ? path.join(root, '.build', 'representative')
    : flag >= 0 && argv[flag + 1]
      ? path.resolve(argv[flag + 1] ?? '')
      : defaultOutdir;
  if (representative) await buildRepresentative(dir);

  let measurement;
  try {
    measurement = measure(dir);
  } catch (error) {
    console.error(`bundle budget: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Run `npm run build` first; an empty or missing build is a failure, not a pass.');
    return 1;
  }

  console.log(
    representative
      ? `bundle budget, representative build (scaffold app + pinned A2UI v0.8 and v0.9 renderers, A2UI core, AG-UI client and schemas): ${path.relative(root, dir)}`
      : `bundle budget: ${path.relative(root, dir) || '.'}`,
  );
  console.log(formatTable(measurement));
  const { ok, failures } = evaluate(measurement);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  if (representative) {
    console.log(
      `Renderer headroom: ${fmt(LIMITS.bytes - measurement.bytes)} minified bytes and ${fmt(LIMITS.gzipBytes - measurement.gzipBytes)} gzip bytes remain for the rest of the app.` +
        ' Reported, not certified as the final app size: `npm run build && npm run check:bundle` repeats the strict check on the real build.',
    );
  }
  console.log(ok ? 'bundle budget: PASS' : 'bundle budget: FAIL');
  return ok ? 0 : 1;
}

if (path.basename(process.argv[1] ?? '') === 'bundle-budget.mjs') {
  process.exit(await main(process.argv.slice(2)));
}
