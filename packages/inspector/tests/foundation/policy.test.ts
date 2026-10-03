// F01 T001/T005: install, dependency and release policy as executable checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const json = (file: string) => JSON.parse(read(file)) as Record<string, any>;

const manifests = ['package.json', 'packages/inspector/package.json', 'packages/python/package.json'];
// The docs site installs on its own, from its own lockfile, so it is checked apart from the workspace.
const website = 'website/package.json';
const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish'];

function dependenciesOf(manifest: string): Array<[name: string, version: string, manifest: string]> {
  const pkg = json(manifest);
  return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].flatMap((field) =>
    Object.entries((pkg[field] ?? {}) as Record<string, string>).map(([name, version]): [string, string, string] => [name, version, manifest]),
  );
}

function directDependencies(): Array<[name: string, version: string, manifest: string]> {
  return manifests.flatMap(dependenciesOf);
}

test('manifests are private MIT packages with no bin, publish config or lifecycle scripts', () => {
  for (const manifest of [...manifests, website]) {
    const pkg = json(manifest);
    assert.equal(pkg.private, true, `${manifest} is private`);
    assert.equal(pkg.license, 'MIT', `${manifest} is MIT licensed`);
    for (const forbidden of ['licenses', 'publishConfig', 'bin']) {
      assert.equal(forbidden in pkg, false, `${manifest} has no ${forbidden}`);
    }
    for (const script of lifecycle) assert.equal(script in (pkg.scripts ?? {}), false, `${manifest} has no ${script} script`);
  }
  assert.equal(json('packages/inspector/package.json').name, 'agui-inspector');
  assert.deepEqual(json('package.json').workspaces, ['packages/inspector', 'packages/python']);
});

test('LICENSE is MIT with the exact copyright line and the package copies equal the root files', () => {
  const license = read('LICENSE');
  assert.match(license, /^MIT License\n/);
  assert.deepEqual(license.split('\n').filter((line) => line.startsWith('Copyright')), ['Copyright (c) 2026 Nidhal Dogga']);
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
    assert.equal(read(`packages/inspector/${file}`), read(file), `packages/inspector/${file} equals the root copy`);
    assert.equal(read(`packages/python/${file}`), read(file), `packages/python/${file} equals the root copy`);
  }
});

test('every direct dependency is pinned to an exact version', () => {
  const deps = [...directDependencies(), ...dependenciesOf(website)];
  assert.ok(deps.length >= 14);
  for (const [name, version, manifest] of deps) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} in ${manifest} must be an exact version, got ${version}`);
  }
});

test('the committed lockfile resolves every direct dependency to its pinned version from the public registry', () => {
  const lock = json('package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  const packages = lock.packages as Record<string, { version: string; resolved?: string; link?: boolean; hasInstallScript?: boolean }>;
  for (const [name, version] of directDependencies()) {
    const locked = packages[`node_modules/${name}`];
    assert.ok(locked, `${name} is locked`);
    assert.equal(locked.version, version, `${name} locked at the manifest version`);
  }
  for (const [location, entry] of Object.entries(packages)) {
    if (entry.resolved && !entry.link) assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${location} resolves from the public registry`);
  }
  assert.doesNotMatch(JSON.stringify(lock), /codeartifact|tokenHelper|_authToken/);
});

test('the docs site lockfile resolves its pinned dependencies from the public registry', () => {
  const lock = json('website/package-lock.json');
  assert.equal(lock.lockfileVersion, 3);
  const packages = lock.packages as Record<string, { version: string; resolved?: string; link?: boolean }>;
  for (const [name, version] of dependenciesOf(website)) assert.equal(packages[`node_modules/${name}`]?.version, version, `${name} locked at ${version}`);
  for (const [location, entry] of Object.entries(packages)) {
    if (entry.resolved && !entry.link) assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${location} resolves from the public registry`);
  }
  assert.doesNotMatch(JSON.stringify(lock), /codeartifact|tokenHelper|_authToken/);
});

test('installation runs no lifecycle scripts', () => {
  for (const npmrc of ['.npmrc', 'website/.npmrc']) {
    assert.match(read(npmrc), /^ignore-scripts=true$/m, npmrc);
    assert.match(read(npmrc), /^save-exact=true$/m, npmrc);
  }
});

test('the esbuild binary is functional although its postinstall never ran', () => {
  const version = execFileSync(path.join(root, 'node_modules/.bin/esbuild'), ['--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, json('package.json').devDependencies.esbuild);
});

test('the TypeScript configuration is strict', () => {
  const options = json('tsconfig.json').compilerOptions;
  assert.equal(options.strict, true);
  assert.equal(options.noUncheckedIndexedAccess, true);
  assert.equal(options.noEmit, true);
});

test('the dependencies page records purpose and rejected alternative for every direct dependency', () => {
  const doc = read('website/content/docs/dependencies.mdx');
  for (const [name, version] of [...directDependencies(), ...dependenciesOf(website)]) {
    const row = doc.split('\n').find((line) => line.includes(`\`${name}\``) && line.includes(version));
    assert.ok(row, `${name} ${version} has a row on the dependencies page`);
    assert.ok(row.includes(version), `${name} row records ${version}`);
    assert.equal(row.split('|').filter((cell) => cell.trim() !== '').length >= 4, true, `${name} row has purpose and alternative cells`);
  }
});

test('contracts and sources stay framework-free where required and never evaluate code', () => {
  assert.doesNotMatch(read('packages/inspector/src/contracts.ts'), /from\s+['"](?:react|react-dom)(?:\/[^'"]*)?['"]/);
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : /\.(?:tsx?|js)$/.test(name) ? [full] : [];
    });
  for (const file of walk(path.join(root, 'packages/inspector/src'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\beval\s*\(|new\s+Function\s*\(/, `${file} must not evaluate code`);
  }
});

test('the development page documents every root command and the missing validation infrastructure', () => {
  const doc = read('website/content/docs/development.mdx');
  for (const script of Object.keys(json('package.json').scripts)) {
    assert.ok(doc.includes(`npm run ${script}`), `the development page documents npm run ${script}`);
  }
  assert.match(doc, /npm ci --ignore-scripts/);
  assert.match(doc, /not yet|missing|pending/i, 'absent suites are reported as missing, not passing');
});
