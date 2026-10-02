// Stages the npm static assets into the Python package, checksums them and builds the wheel and sdist.
// Usage: npm run package:python [-- --no-build] [--stage-only] [--out-dir <dir>]
//   --no-build    use the existing packages/inspector/dist instead of running the build first
//   --stage-only  stop after staging and verifying; do not run `uv build`
//   --out-dir     where the wheel and sdist go (default packages/python/dist)
// The wheel and sdist ship packages/python/LICENSE and THIRD_PARTY_NOTICES.txt (pyproject license-files);
// they must be byte-identical to the repository root copies, so a stale copy stops the build.
// Nothing here publishes, uploads, tags or releases anything.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from './build.mjs';
import { staticAssetsPath } from '../packages/inspector/src/static-path.js';

const root = path.resolve(import.meta.dirname, '..');
const pythonProject = path.join(root, 'packages', 'python');
const packageDir = path.join(pythonProject, 'src', 'agui_inspector');
const stagedDir = path.join(packageDir, 'static');
const checksumFile = path.join(packageDir, 'static.sha256');

const licenseFiles = ['LICENSE', 'THIRD_PARTY_NOTICES.txt'];

/** Fails when a packaged license file differs from the root copy: uv_build cannot read files outside the project. */
function verifyLicenseFiles() {
  for (const file of licenseFiles) {
    const expected = readFileSync(path.join(root, file));
    if (!readFileSync(path.join(pythonProject, file)).equals(expected)) {
      throw new Error(`packages/python/${file} differs from ${file}; copy the root file over it`);
    }
  }
}

/** Sorted `[relative posix path, sha256]` pairs for every file under `dir`. */
function checksums(/** @type {string} */ dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
    .map((file) => /** @type {const} */ ([file, createHash('sha256').update(readFileSync(path.join(dir, file))).digest('hex')]));
}

/** Copies the npm assets into the package and proves the copy is byte-identical. Returns the checksums. */
function stageStaticAssets(/** @type {string} */ source = staticAssetsPath) {
  if (!existsSync(path.join(source, 'index.html'))) {
    throw new Error(`${source} has no index.html; run "npm run build" first`);
  }
  rmSync(stagedDir, { recursive: true, force: true });
  cpSync(source, stagedDir, { recursive: true });
  const expected = checksums(source);
  writeFileSync(checksumFile, expected.map(([file, sum]) => `${sum}  ${file}\n`).join(''));
  const staged = JSON.stringify(checksums(stagedDir));
  if (staged !== JSON.stringify(expected)) throw new Error('the staged assets differ from the npm static assets');
  return expected;
}

if (path.basename(process.argv[1] ?? '') === 'package-python.mjs') {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const flag = args.indexOf('--out-dir');
  const outDir = path.resolve(flag >= 0 && args[flag + 1] ? args[flag + 1] ?? '' : path.join(pythonProject, 'dist'));
  if (!args.includes('--no-build')) await buildApp();
  verifyLicenseFiles();
  const staged = stageStaticAssets();
  console.log(`staged ${staged.length} static files into ${path.relative(root, stagedDir)}`);
  if (!args.includes('--stage-only')) {
    mkdirSync(outDir, { recursive: true });
    for (const stale of readdirSync(outDir)) {
      if (/^agui_inspector-.*(\.whl|\.tar\.gz)$/.test(stale)) rmSync(path.join(outDir, stale));
    }
    const build = spawnSync('uv', ['build', '--project', pythonProject, '--out-dir', outDir], { cwd: root, stdio: 'inherit' });
    if (build.error) throw new Error(`could not run uv: ${build.error.message}`);
    if (build.status !== 0) process.exit(build.status ?? 1);
    console.log(`built ${readdirSync(outDir).join(', ')} in ${path.relative(root, outDir) || '.'}`);
  }
}
