// US5 (FR-001, FR-013, FR-016, SC-008): the built package, the way a host uses it. Run after `npm run build`: it needs
// `packages/inspector/lib`, which is why these checks are here and not in the unit tests that run before the build.
// The entries are resolved through the package name (the workspace link), so the `exports` map is what is tested.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const packageDir = path.join(root, 'packages', 'inspector');
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
  dependencies: Record<string, string>;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
};
const entries = { './express': 'mountInspector', './hono': 'mountInspector', './next': 'inspectorRoute' } as const;

const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('exports lists the static path and the three helpers, each with types and an ES module, and every target exists', () => {
  expect(manifest.exports).toEqual({
    '.': './src/static-path.js',
    './express': { types: './lib/server/express.d.ts', default: './lib/server/express.js' },
    './hono': { types: './lib/server/hono.d.ts', default: './lib/server/hono.js' },
    './next': { types: './lib/server/next.d.ts', default: './lib/server/next.js' },
  });
  for (const name of ['express', 'hono', 'next']) {
    for (const extension of ['js', 'd.ts']) expect(readdirSync(path.join(packageDir, 'lib', 'server'))).toContain(`${name}.${extension}`);
  }
});

test('the manifest adds no web framework and no peer dependency', () => {
  expect(Object.keys(manifest.dependencies).filter((name) => /^(express|hono|next|@hono|connect|koa|fastify)/.test(name))).toEqual([]);
  expect(manifest.peerDependencies).toBeUndefined();
  expect(manifest.optionalDependencies).toBeUndefined();
});

test('the compiled files import only node built-ins and their own files, with no .ts specifier left', () => {
  for (const file of readdirSync(path.join(packageDir, 'lib'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.js'))) {
    const text = readFileSync(path.join(packageDir, 'lib', file), 'utf8');
    const specifiers = [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:') || /^\.\.?\/.*\.js$/.test(specifier), `${file} imports ${specifier}`).toBe(true);
    }
  }
});

for (const [entry, name] of Object.entries(entries)) {
  test(`${entry} loads with import() and with require() through the package name`, () => {
    const specifier = `agui-inspector${entry.slice(1)}`;
    expect(node(['--input-type=module', '-e', `const m = await import(${JSON.stringify(specifier)}); process.stdout.write(typeof m.${name});`])).toBe('function');
    expect(node(['-e', `process.stdout.write(typeof require(${JSON.stringify(specifier)}).${name});`])).toBe('function');
  });
}

test('a TypeScript project under NodeNext checks the arguments, and the internal option is not in the declarations', () => {
  const dir = path.join(root, '.build', 'consumer');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  /** Compiles one file of its own under strict NodeNext, resolving the helpers through the package `exports`. */
  const compile = (name: string, source: string) => {
    writeFileSync(path.join(dir, name), source);
    writeFileSync(
      path.join(dir, `${name}.tsconfig.json`),
      JSON.stringify({ compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023', noEmit: true, types: ['node'] }, include: [name] }),
    );
    return spawnSync('npm', ['exec', '--', 'tsc', '--pretty', 'false', '-p', path.join(dir, `${name}.tsconfig.json`)], { cwd: root, encoding: 'utf8' });
  };

  const agents = "[{ id: 'support', url: '/agents/support/stream', name: 'Support', capabilities: '/agents/support/capabilities' }]";
  const good = compile(
    'good.ts',
    `import express from 'express';
import { Hono } from 'hono';
import { mountInspector as mountExpress } from 'agui-inspector/express';
import { mountInspector as mountHono } from 'agui-inspector/hono';
import { inspectorRoute } from 'agui-inspector/next';

const agents = ${agents};
const theme = { light: { '--agui-accent': '#2563eb' } };
mountExpress(express(), { agents, enabled: process.env.NODE_ENV !== 'production', path: '/tools/inspect', theme });
mountExpress(express.Router(), { agents, enabled: true });
mountHono(new Hono(), { agents, enabled: true, theme });
mountHono(new Hono().basePath('/api'), { agents, enabled: true });
export const { GET, HEAD } = inspectorRoute({ agents, enabled: true, theme });
`,
  );
  expect(good.status, good.stdout + good.stderr).toBe(0);

  const bad: Record<string, [source: string, error: RegExp]> = {
    'missing-url.ts': ["import { mountInspector } from 'agui-inspector/express';\nimport express from 'express';\nmountInspector(express(), { agents: [{ id: 'a' }] });\n", /Property 'url' is missing/],
    'internal-option.ts': ["import { mountInspector } from 'agui-inspector/hono';\nimport { Hono } from 'hono';\nmountInspector(new Hono(), { agents: [], assetsDir: '/tmp/x' });\n", /'assetsDir' does not exist in type/],
    'next-path.ts': ["import { inspectorRoute } from 'agui-inspector/next';\ninspectorRoute({ agents: [], path: '/x' });\n", /'path' does not exist in type/],
  };
  for (const [name, [source, error]] of Object.entries(bad)) {
    const result = compile(name, source);
    expect(result.status, `${name} must not compile`).not.toBe(0);
    expect(result.stdout + result.stderr, name).toMatch(error);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('the npm tarball ships the compiled helpers and the page, and no source or test of the helpers', () => {
  // For a workspace, `npm pack --json` prints an object keyed by package name.
  const packed = JSON.parse(execFileSync('npm', ['pack', '--workspace', 'packages/inspector', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as Record<string, { files: Array<{ path: string }> }>;
  const files = packed['agui-inspector']!.files.map((file) => file.path);
  for (const required of ['lib/server/core.js', 'lib/server/express.js', 'lib/server/express.d.ts', 'lib/server/hono.js', 'lib/server/hono.d.ts', 'lib/server/next.js', 'lib/server/next.d.ts', 'lib/server/node.js', 'lib/static-path.js', 'dist/index.html', 'dist/app.js', 'src/static-path.js', 'package.json']) {
    expect(files, required).toContain(required);
  }
  expect(files.filter((file) => /^(src\/server|tests|tsconfig)/.test(file) || file.endsWith('.ts') && !file.endsWith('.d.ts'))).toEqual([]);
  expect(readFileSync(path.join(packageDir, 'lib', 'server', 'core.d.ts'), 'utf8')).not.toContain('assetsDir');
});

test('the shipped helper, loaded with require() through the package name, serves the real page', () => {
  const script = `
    const express = require('express');
    const { mountInspector } = require('agui-inspector/express');
    const app = express();
    mountInspector(app, { agents: [{ id: 'a', url: '/a' }], enabled: true });
    const server = app.listen(0, '127.0.0.1', async () => {
      const origin = 'http://127.0.0.1:' + server.address().port;
      const redirect = await fetch(origin + '/agui-inspector?x=1', { redirect: 'manual' });
      const page = await fetch(origin + '/agui-inspector/index.html');
      const script = await fetch(origin + '/agui-inspector/app.js');
      const config = await fetch(origin + '/agui-inspector/config.json');
      process.stdout.write(JSON.stringify({
        redirect: [redirect.status, redirect.headers.get('location')],
        page: [page.status, (await page.text()).includes('<div id="root">'), page.headers.get('content-security-policy')],
        script: [script.status, script.headers.get('content-type'), (await script.arrayBuffer()).byteLength > 100000],
        config: await config.json(),
      }));
      server.close();
    });`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toContain('agui-inspector is enabled and mounted at /agui-inspector; disable it outside development');
  expect(JSON.parse(result.stdout)).toEqual({
    redirect: [307, 'agui-inspector/index.html?x=1'],
    page: [200, true, "script-src 'self'; object-src 'none'; base-uri 'none'"],
    script: [200, 'text/javascript; charset=utf-8', true],
    config: { version: 0, agents: [{ id: 'a', url: '/a' }] },
  });
});
