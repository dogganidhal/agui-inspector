// The Node-side helpers and the command line tool stay out of the browser bundle and out of React and the frameworks
// (FR-013, FR-015 of feature 006, FR-020 of feature 005).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { bundleOptions } from '../../../../scripts/build.mjs';

const inspector = path.join(process.cwd(), 'packages', 'inspector');
const serverDir = path.join(inspector, 'src', 'server');
const cliDir = path.join(inspector, 'src', 'cli');

test('the page bundle has no input from src/server or src/cli and no trace of the helpers or the command', async () => {
  // The same options and entry as `npm run build`, kept in memory.
  const result = await build({
    ...bundleOptions('unused'),
    entryPoints: { app: path.join(inspector, 'src', 'app', 'index.tsx') },
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some((input) => input.endsWith('src/app/index.tsx')), 'the build bundled the app');
  assert.deepEqual(inputs.filter((input) => input.includes('src/server/') || input.includes('src/cli/') || input.endsWith('static-path.js')), []);
  const bundle = result.outputFiles.find((file) => file.path.endsWith('.js'))!.text;
  assert.doesNotMatch(bundle, /is enabled and mounted at/);
  assert.doesNotMatch(bundle, /createInspectorHandler|resolveMount|inspectorRoute|mountInspector/);
  assert.doesNotMatch(bundle, /node:(?:http|https|fs|path|url|util|stream)/);
  assert.doesNotMatch(bundle, /unknown command|agui-inspector listening on|could not reach/);
});

test('no helper source imports React, a web framework or anything outside the package', () => {
  const sources = readdirSync(serverDir).filter((name) => name.endsWith('.ts'));
  assert.ok(sources.length >= 2, 'the helper sources are there');
  for (const name of sources) {
    const text = readFileSync(path.join(serverDir, name), 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith('node:') || specifier.startsWith('./') || specifier === '../static-path.js', `${name} imports ${specifier}`);
    }
  }
});

test('no command source imports React, a web framework, a package from the registry or anything outside src/cli and src/server', () => {
  const sources = readdirSync(cliDir).filter((name) => name.endsWith('.ts'));
  assert.ok(sources.length >= 5, 'the command sources are there');
  for (const name of sources) {
    const text = readFileSync(path.join(cliDir, name), 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
    for (const specifier of specifiers) {
      assert.ok(specifier.startsWith('node:') || /^\.\/[a-z]+\.ts$/.test(specifier) || /^\.\.\/server\/(?:core|node)\.ts$/.test(specifier), `${name} imports ${specifier}`);
    }
  }
});
