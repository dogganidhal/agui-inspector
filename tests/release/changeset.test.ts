// Releases: changesets version the Python package through a private package.json, and scripts/changeset-version.mjs
// copies that version into pyproject.toml and uv.lock. These checks fail when the copies drift apart or the setup is
// loosened in a way that would silently stop versioning or start publishing to npm.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { setProjectVersion } from '../../scripts/changeset-version.mjs';

const repo = process.cwd();
const read = (file: string) => readFileSync(path.join(repo, file), 'utf8');
const pyproject = read('packages/python/pyproject.toml');

test('setProjectVersion changes the project version line and nothing else', () => {
  const next = setProjectVersion(pyproject, '1.2.3');
  assert.match(next, /^version = "1\.2\.3"$/m);
  assert.equal(next.replace('version = "1.2.3"', pyproject.match(/^version = ".*"$/m)![0]), pyproject);
});

test('setProjectVersion accepts only a plain x.y.z version and a single version line', () => {
  for (const bad of ['1.2', '1.2.3-beta.0', '1.2.3rc1', 'v1.2.3', '']) assert.throws(() => setProjectVersion(pyproject, bad), /plain x\.y\.z/, bad);
  assert.throws(() => setProjectVersion('[project]\nname = "x"\n', '1.0.0'), /exactly one version line/);
  assert.throws(() => setProjectVersion('version = "1.0.0"\nversion = "1.0.0"\n', '1.0.0'), /exactly one version line/);
});

test('the version holder, pyproject.toml and uv.lock carry the same version', () => {
  const holder = JSON.parse(read('packages/python/package.json'));
  const lock = read('packages/python/uv.lock').match(/^name = "agui-inspector"\nversion = "(.*)"$/m)?.[1];
  assert.equal(pyproject.match(/^version = "(.*)"$/m)?.[1], holder.version);
  assert.equal(lock, holder.version);
});

test('the Python version holder is private, so changesets can never publish it to npm', () => {
  const holder = JSON.parse(read('packages/python/package.json'));
  assert.equal(holder.private, true);
  assert.deepEqual(JSON.parse(read('package.json')).workspaces, ['packages/inspector', 'packages/python']);
});

test('the changeset config versions and tags the private Python holder and leaves the npm package alone', () => {
  const config = JSON.parse(read('.changeset/config.json'));
  assert.deepEqual(config.privatePackages, { version: true, tag: true });
  assert.deepEqual(config.ignore, ['agui-inspector']);
  assert.equal(config.baseBranch, 'main');
  assert.equal(config.commit, false);
});
