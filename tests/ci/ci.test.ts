// F02 T006-T008: the PR gate runs every introduced suite, reports absent ones as pending, and the
// workflow can only run checks on pull requests, never publish.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { planSteps, runPlan, type Step } from '../../scripts/ci.mjs';

const repo = process.cwd();
const roots: string[] = [];
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture(files: string[] = []) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-inspector-ci-'));
  roots.push(dir);
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), '');
  }
  return dir;
}

const byName = (steps: Step[], name: string) => {
  const step = steps.find((candidate) => candidate.name === name);
  assert.ok(step, `step ${name} is planned`);
  return step;
};

test('with only the scaffold, the three present checks run and the rest are pending', () => {
  const steps = planSteps(fixture());
  assert.deepEqual(steps.map((s) => s.name), ['typecheck', 'unit tests', 'build', 'bundle budget', 'end-to-end tests', 'python tests']);
  assert.deepEqual(steps.slice(0, 3).map((s) => s.status), ['run', 'run', 'run']);
  assert.deepEqual(byName(steps, 'unit tests').commands, [['npm', 'run', 'test:unit']]);
  for (const name of ['bundle budget', 'end-to-end tests', 'python tests']) {
    const step = byName(steps, name);
    assert.equal(step.status, 'pending', name);
    assert.deepEqual(step.commands, [], `${name} must not carry a command that could report success`);
    assert.match(step.detail, /not introduced/i, name);
  }
});

test('the budget check is required as soon as its script exists, after the build', () => {
  const steps = planSteps(fixture(['scripts/bundle-budget.mjs']));
  assert.equal(byName(steps, 'bundle budget').status, 'run');
  assert.deepEqual(byName(steps, 'bundle budget').commands, [['npm', 'run', 'check:bundle']]);
  assert.ok(steps.findIndex((s) => s.name === 'build') < steps.findIndex((s) => s.name === 'bundle budget'));
});

test('end-to-end tests are required once a spec exists; an empty directory stays pending', () => {
  assert.equal(byName(planSteps(fixture(['tests/e2e/.gitkeep'])), 'end-to-end tests').status, 'pending');
  const steps = planSteps(fixture(['tests/e2e/runtime/send.spec.ts']));
  assert.equal(byName(steps, 'end-to-end tests').status, 'run');
  assert.deepEqual(byName(steps, 'end-to-end tests').commands, [['npm', 'run', 'test:e2e']]);
});

test('python tests are required once the package exists, and an empty suite fails', () => {
  const withTests = byName(planSteps(fixture(['packages/python/pyproject.toml', 'packages/python/tests/test_serve.py'])), 'python tests');
  assert.equal(withTests.status, 'run');
  assert.deepEqual(withTests.commands, [
    ['uv', 'sync', '--project', 'packages/python', '--locked', '--extra', 'embedded', '--group', 'test'],
    ['uv', 'run', '--project', 'packages/python', 'python', '-m', 'unittest', 'discover', '-s', 'packages/python/tests'],
  ]);
  const empty = byName(planSteps(fixture(['packages/python/pyproject.toml'])), 'python tests');
  assert.equal(empty.status, 'fail');
  assert.match(empty.detail, /no tests/i);
});

const run = (name: string): Step => ({ name, status: 'run', detail: '', commands: [['do', name]] });
const pending = (name: string): Step => ({ name, status: 'pending', detail: 'not introduced', commands: [] });

test('pending alone passes the default gate, is reported, and fails the strict gate', () => {
  const steps = [run('a'), pending('b')];
  const lenient = runPlan(steps, { exec: () => 0, strict: false, log: () => {} });
  assert.equal(lenient.exitCode, 0);
  assert.deepEqual(lenient.results.map((r) => r.outcome), ['passed', 'pending']);
  const strict = runPlan(steps, { exec: () => 0, strict: true, log: () => {} });
  assert.equal(strict.exitCode, 1);
});

test('a failing command stops the plan and the failure propagates', () => {
  const ran: string[] = [];
  const outcome = runPlan([run('a'), run('b'), run('c')], {
    exec: (argv) => (ran.push(argv.join(' ')), argv[1] === 'b' ? 3 : 0),
    strict: false,
    log: () => {},
  });
  assert.equal(outcome.exitCode, 1);
  assert.deepEqual(ran, ['do a', 'do b']);
  assert.deepEqual(outcome.results.map((r) => r.outcome), ['passed', 'failed', 'not run']);
});

test('an introduced suite that cannot run fails even without a failing command', () => {
  const outcome = runPlan([{ name: 'py', status: 'fail', detail: 'no tests', commands: [] }], { exec: () => 0, strict: false, log: () => {} });
  assert.equal(outcome.exitCode, 1);
});

test('the workflow runs on pull requests only, with read-only access and no publishing', () => {
  const file = path.join(repo, '.github/workflows/ci.yml');
  assert.ok(existsSync(file), '.github/workflows/ci.yml exists');
  const text = readFileSync(file, 'utf8');
  const triggers = text.match(/^on:\n((?:[ \t]+.*\n|\n)+)/m)?.[1] ?? '';
  assert.deepEqual(triggers.match(/^ {2}(\w+):/gm)?.map((t) => t.trim()), ['pull_request:']);
  assert.match(text, /^permissions:\n {2}contents: read\n/m);
  assert.doesNotMatch(text, /id-token|contents: write|packages: write|attestations/);
  assert.doesNotMatch(text, /npm publish|uv publish|twine|gh release|git tag|git push|provenance/i);
  assert.doesNotMatch(text, /secrets\./);
  assert.match(text, /npm ci --ignore-scripts/);
  assert.match(text, /npm run check:ci/);
  assert.doesNotMatch(text, /npm (?:ci|install)(?![^\n]*--ignore-scripts)/);
});

test('every workflow action is pinned to a full commit SHA', () => {
  const text = readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf8');
  const uses = [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]!);
  assert.ok(uses.length > 0);
  for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, ref);
});

test('the root exposes check:ci, stays private and MIT, and carries no publish script', () => {
  const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:ci'], 'node scripts/ci.mjs');
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'MIT');
  assert.equal(Object.keys(pkg.scripts).some((name) => /publish|release|version/.test(name)), false);
  assert.match(readFileSync(path.join(repo, 'LICENSE'), 'utf8'), /^MIT License\n\nCopyright \(c\) 2026 Nidhal Dogga\n/);
});
