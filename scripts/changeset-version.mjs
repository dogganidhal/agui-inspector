// The version command of the release workflow's "Version Packages" pull request. Usage: node scripts/changeset-version.mjs
// 1. `changeset version` bumps packages/python/package.json, which only holds the Python package's version, and writes
//    its CHANGELOG.md from the pending changesets.
// 2. The new version is copied into packages/python/pyproject.toml, and `uv lock` refreshes uv.lock, which records it too.
// Nothing here tags, publishes or pushes anything.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pythonProject = path.join(root, 'packages', 'python');

/**
 * Returns `pyproject` with its project version set to `version`. Only a plain x.y.z is accepted: semver, PEP 440 and
 * the release tag spell a pre-release differently, and the release workflow compares them as strings.
 */
export function setProjectVersion(/** @type {string} */ pyproject, /** @type {string} */ version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" is not a plain x.y.z version`);
  if (pyproject.match(/^version = ".*"$/gm)?.length !== 1) throw new Error('pyproject.toml must have exactly one version line');
  return pyproject.replace(/^version = ".*"$/m, () => `version = "${version}"`);
}

if (path.basename(process.argv[1] ?? '') === 'changeset-version.mjs') {
  const run = (/** @type {string} */ command, /** @type {string[]} */ args) => {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw new Error(`could not run ${command}: ${result.error.message}`);
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  run('npm', ['exec', '--', 'changeset', 'version']);
  const { version } = JSON.parse(readFileSync(path.join(pythonProject, 'package.json'), 'utf8'));
  const pyproject = path.join(pythonProject, 'pyproject.toml');
  writeFileSync(pyproject, setProjectVersion(readFileSync(pyproject, 'utf8'), version));
  run('uv', ['lock', '--project', pythonProject]);
  console.log(`python package version is ${version}`);
}
