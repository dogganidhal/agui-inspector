// Spec 019: the guide for coding agents ships with the page, says what an agent needs, holds nothing secret, and the
// docs page shows it as it is served.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8');
const guide = read('packages', 'inspector', 'public', 'llms.txt');
const docs = (name: string) => read('website', 'content', 'docs', name);
const page = docs('agent-guide.mdx');
const DOCS = 'https://dogganidhal.github.io/agui-inspector/docs/';

/** Text that looks like a credential: a scheme with a literal value, or an Authorization header not taken from the environment. */
function credentialLike(text: string): string[] {
  const found = [
    ...text.matchAll(/\b(?:Bearer|Basic)\s+(?![$<{])[A-Za-z0-9._~+/=-]{4,}/g),
    ...text.matchAll(/Authorization:\s*(?!\$|Bearer \$|Basic \$|<)\S+/gi),
    ...text.matchAll(/\b(?:password|token|secret|api[_-]?key)\s*[=:]\s*(?![$<])\S+/gi),
  ];
  return found.map((match) => match[0]);
}

test('the guide follows the llms.txt shape: a title, a summary, sections and links to the docs', () => {
  assert.match(guide, /^# agui-inspector\n\n> \S/);
  for (const heading of ['## Where things are', '## Open the page for a person', '## Drive an agent yourself', '## Credentials', '## Docs']) {
    assert.ok(guide.includes(`\n${heading}\n`), heading);
  }
  assert.match(guide, /^- \[[^\]]+\]\(https:\/\/\S+\): /m, 'the docs section is a list of links with notes');
  assert.ok(!guide.includes('```'), 'indented code only, so the docs page can show it in one fenced block');
});

test('the guide says where the page and the agents are, how to link and how to drive an agent', () => {
  for (const fact of [
    'the directory this file is in',
    '`config.json`',
    '#agent=<id>&message=<text>',
    'never sends by itself',
    'npx agui-inspector run --target',
    'npx agui-inspector mcp --target',
    'never at the page',
    'Node.js 24 or newer',
    '--header "Authorization: $AGENT_AUTH"',
    `${DOCS}launch-links/`,
    `${DOCS}agent-guide/`,
    `${DOCS}tests-and-agents/`,
  ]) {
    assert.ok(guide.includes(fact), fact);
  }
});

test('the guide holds no credential, no host value and no em dash', () => {
  assert.deepEqual(credentialLike(guide), []);
  assert.ok(!guide.includes('—'));
  // Example endpoints are loopback only: the guide names no real host.
  for (const url of guide.match(/https?:\/\/[^\s)`"]+/g) ?? []) {
    assert.match(url, /^(http:\/\/127\.0\.0\.1:|https:\/\/dogganidhal\.github\.io\/agui-inspector\/docs\/)/, url);
  }
});

test('the page points to the guide with the link relation of the llms.txt proposal', () => {
  assert.match(read('packages', 'inspector', 'src', 'app', 'index.html'), /<link rel="describedby" type="text\/plain" href="llms\.txt" \/>/);
});

test('the build copies public/, where the guide lives, next to the page', () => {
  // The built file itself is checked in packages/python/tests/test_distribution.py, in dist/, the wheel and the sdist.
  assert.match(read('scripts', 'build.mjs'), /cpSync\(publicDir, outdir, \{ recursive: true \}\)/);
});

test('the docs page holds the whole guide, so the page and the file cannot drift', () => {
  assert.ok(page.includes(`\`\`\`text\n${guide}\`\`\``), 'packages/inspector/public/llms.txt is in the page, character for character');
});

test('the docs page has a block for each setup, each naming the guide, and none holds a credential', () => {
  for (const heading of ['### Python server with the embedded inspector', '### JavaScript server with a helper', '### The command']) {
    const start = page.indexOf(heading);
    assert.ok(start > 0, heading);
    const block = /```markdown\n([\s\S]*?)```/.exec(page.slice(start))?.[1] ?? '';
    assert.match(block, /llms\.txt/, heading);
    assert.match(block, /agui-inspector (run|mcp)/, heading);
    assert.deepEqual(credentialLike(block), [], heading);
  }
  assert.deepEqual(credentialLike(page), []);
  assert.ok(!page.includes('—'));
  assert.ok(!/^\*\*[^*]+:\*\*/m.test(page));
});

test('the other pages and the startup output point to the guide', () => {
  for (const other of ['tests-and-agents.mdx', 'embedding.mdx', 'cli.mdx']) assert.match(docs(other), /\(\.\/agent-guide\.mdx\)/, other);
  assert.match(read('website', 'content', 'docs', 'meta.json'), /"agent-guide"/);
  assert.match(docs('embedding.mdx'), /disable it outside development; guide for coding agents at \/agui-inspector\/llms\.txt/);
  assert.match(docs('cli.mdx'), /guide for coding agents: http:\/\/127\.0\.0\.1:4747\/llms\.txt/);
  assert.match(read('packages', 'inspector', 'README.md'), /llms\.txt/);
  assert.match(read('packages', 'python', 'src', 'agui_inspector', '__init__.py'), /<path>\/llms\.txt/);
  for (const helper of ['express.ts', 'hono.ts', 'next.ts']) {
    assert.match(read('packages', 'inspector', 'src', 'server', helper), /`<path>\/llms\.txt`/, helper);
  }
});
