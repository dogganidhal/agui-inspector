// The PR gate. Runs every introduced check in order and reports suites that do not exist yet as
// pending, never as passed. Usage: npm run check:ci [-- --strict]
// --strict also fails on pending suites: that is the full integrated-MVP gate.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * @typedef {{ name: string, status: 'run' | 'pending' | 'fail', detail: string, commands: string[][] }} Step
 * `run` executes `commands`; `pending` means the suite is not introduced yet and has no command;
 * `fail` means the suite exists but cannot run meaningfully.
 */

/** @param {string} dir @param {RegExp} pattern */
function listFiles(dir, pattern) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => pattern.test(file));
}

/** @returns {Step[]} */
export function planSteps(/** @type {string} */ root = repoRoot) {
  const at = (/** @type {string[]} */ ...parts) => path.join(root, ...parts);
  /** @type {(name: string, command: string[]) => Step} */
  const always = (name, command) => ({ name, status: 'run', detail: '', commands: [command] });
  /** @type {(name: string, what: string) => Step} */
  const pending = (name, what) => ({ name, status: 'pending', detail: `not introduced yet: ${what}`, commands: [] });

  const budget = existsSync(at('scripts', 'bundle-budget.mjs'))
    ? always('bundle budget', ['npm', 'run', 'check:bundle'])
    : pending('bundle budget', 'scripts/bundle-budget.mjs (slice F03)');

  const e2e = listFiles(at('tests', 'e2e'), /\.spec\.ts$/).length > 0
    ? always('end-to-end tests', ['npm', 'run', 'test:e2e'])
    : pending('end-to-end tests', 'a spec under tests/e2e');

  /** @type {Step} */
  let python = pending('python tests', 'packages/python');
  if (existsSync(at('packages', 'python', 'pyproject.toml'))) {
    python = listFiles(at('packages', 'python', 'tests'), /(^|[\\/])test_[^\\/]*\.py$/).length > 0
      ? {
          name: 'python tests',
          status: 'run',
          detail: '',
          commands: [
            ['uv', 'sync', '--project', 'packages/python', '--locked', '--extra', 'embedded', '--group', 'test'],
            ['uv', 'run', '--project', 'packages/python', 'python', '-m', 'unittest', 'discover', '-s', 'packages/python/tests'],
          ],
        }
      : { name: 'python tests', status: 'fail', detail: 'packages/python exists but has no tests', commands: [] };
  }

  return [
    always('typecheck', ['npm', 'run', 'typecheck']),
    always('unit tests', ['npm', 'run', 'test:unit']),
    always('build', ['npm', 'run', 'build']),
    budget,
    e2e,
    python,
  ];
}

/** @typedef {{ name: string, outcome: 'passed' | 'failed' | 'pending' | 'not run', detail: string }} Result */

/**
 * @param {Step[]} steps
 * @param {{ exec: (argv: string[]) => number, strict: boolean, log: (line: string) => void }} io
 */
export function runPlan(steps, { exec, strict, log }) {
  /** @type {Result[]} */
  const results = [];
  let failed = false;
  for (const step of steps) {
    if (step.status === 'pending') {
      results.push({ name: step.name, outcome: 'pending', detail: step.detail });
      continue;
    }
    if (failed) {
      results.push({ name: step.name, outcome: 'not run', detail: 'an earlier step failed' });
      continue;
    }
    if (step.status === 'fail') {
      failed = true;
      results.push({ name: step.name, outcome: 'failed', detail: step.detail });
      continue;
    }
    log(`\n== ${step.name}`);
    const bad = step.commands.find((argv) => {
      log(`$ ${argv.join(' ')}`);
      return exec(argv) !== 0;
    });
    failed = bad !== undefined;
    results.push(bad ? { name: step.name, outcome: 'failed', detail: `${bad.join(' ')} exited non-zero` } : { name: step.name, outcome: 'passed', detail: '' });
  }

  log('\n== summary');
  for (const { name, outcome, detail } of results) log(`${outcome.toUpperCase().padEnd(8)} ${name}${detail ? ` (${detail})` : ''}`);
  const pendingCount = results.filter((r) => r.outcome === 'pending').length;
  if (pendingCount > 0) log(`${pendingCount} suite(s) pending: not introduced yet, so not counted as passing.`);
  const exitCode = failed || (strict && pendingCount > 0) ? 1 : 0;
  if (exitCode === 1 && !failed) log('strict gate: pending suites are not allowed.');
  return { results, exitCode };
}

/** @param {string[]} argv */
function execInherit([command, ...args]) {
  const run = spawnSync(command ?? '', args, { cwd: repoRoot, stdio: 'inherit' });
  if (run.error) console.error(`could not start ${command}: ${run.error.message}`);
  return run.status ?? 1;
}

if (path.basename(process.argv[1] ?? '') === 'ci.mjs') {
  const { exitCode } = runPlan(planSteps(), { exec: execInherit, strict: process.argv.includes('--strict'), log: console.log });
  process.exit(exitCode);
}
