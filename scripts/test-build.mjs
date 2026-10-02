// Compiles TypeScript unit tests with esbuild, then runs them with `node --test`.
// Usage: npm run test:unit -- [path ...]   (files or directories; default: packages tests)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, '.build', 'tests');
const testFile = /\.test\.tsx?$/;

function collect(target) {
  const full = path.resolve(root, target);
  if (!existsSync(full)) throw new Error(`test path not found: ${target}`);
  if (statSync(full).isFile()) return testFile.test(full) ? [full] : [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const child = path.join(target, entry.name);
    return entry.isDirectory() ? collect(child) : testFile.test(entry.name) ? [path.resolve(root, child)] : [];
  });
}

const selectors = process.argv.slice(2).filter((arg) => arg !== '--');
const roots = selectors.length > 0 ? selectors : ['packages', 'tests'].filter((dir) => existsSync(path.join(root, dir)));
const entryPoints = [...new Set(roots.flatMap(collect))].sort();
if (entryPoints.length === 0) {
  // An empty selection is a failure, never a pass.
  console.error(`test-build: no *.test.ts(x) files found under: ${roots.join(', ')}`);
  process.exit(1);
}

rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints,
  outbase: root,
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  jsx: 'automatic',
  sourcemap: 'inline',
  logLevel: 'warning',
});

const compiled = entryPoints.map((file) => path.join(outdir, path.relative(root, file).replace(/\.tsx?$/, '.mjs')));
const run = spawnSync(process.execPath, ['--test', '--enable-source-maps', ...compiled], { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
