// F01 T005: the npm static-asset location export.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();

test('staticAssetsPath names the absolute built-asset directory of the package', () => {
  // Run the real source module: bundled test code would change import.meta.url.
  const printed = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { staticAssetsPath } from ${JSON.stringify(path.join(root, 'packages/inspector/src/static-path.js'))}; process.stdout.write(staticAssetsPath);`,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(printed, path.join(root, 'packages', 'inspector', 'dist'));
  assert.ok(path.isAbsolute(printed));
});

test('the package keeps the static path as its main export, and its one bin is the command line tool', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'packages/inspector/package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
    bin?: unknown;
  };
  assert.equal(pkg.exports['.'], './src/static-path.js');
  assert.deepEqual(pkg.bin, { 'agui-inspector': './lib/cli/main.js' });
});
