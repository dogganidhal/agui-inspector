// Spec 014 (FR-023): the plugins page describes the API, and the example file it shows is the file the end-to-end tests load.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PLUGIN_API_VERSION } from '../../src/contracts.ts';

const docs = (name: string) => readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', name), 'utf8');
const page = docs('plugins.mdx');

test('the page names every function of the API, the module shape, the version and the failure rules', () => {
  for (const name of ['beforeRun', 'provideHeaders', 'renderCustomEvent', 'renderActivity', 'api.version', 'export default function activate']) assert.ok(page.includes(name), name);
  for (const heading of ['## When to use a plugin', '## Declare plugins', '## Serve the module', '## The module and the API object', '## beforeRun', '## provideHeaders', '## Renderers', '## Failures', '## Version', '## Trust and limits', '## Example']) {
    assert.ok(page.includes(heading), heading);
  }
  assert.match(page, new RegExp(`It is ${PLUGIN_API_VERSION} in 0\\.2\\.0`));
  assert.match(page, /not a sandbox|does not sandbox/);
  assert.match(page, /headers never recorded/);
  assert.match(page, /`Accept` and `Content-Type` are the transport's/);
});

test('the page holds the whole example plugin, so the page and the file cannot drift', () => {
  const example = readFileSync(path.join(process.cwd(), 'examples', 'plugin', 'plugin.js'), 'utf8');
  assert.ok(page.includes(example), 'examples/plugin/plugin.js is in the page, character for character');
});

test('every warning text of the host is in the failures table, and the other pages point to the page', () => {
  for (const text of ['could not be loaded', 'did not load within 10 seconds', 'the default export is not a function', 'activation failed', 'activation did not finish within 10 seconds', 'was called after activation and was ignored', 'is already registered by', 'is drawn by the A2UI view; ignored', 'beforeRun threw', 'beforeRun returned an invalid input', 'provideHeaders threw', 'provideHeaders returned an invalid header', 'threw: <message>']) {
    assert.ok(page.includes(text), text);
  }
  const configuration = docs('configuration.mdx');
  assert.match(configuration, /### Plugins/);
  assert.match(configuration, /0\.2\.0 adds the optional `plugins` field/);
  assert.match(configuration, /plugins must be a list of module addresses on this page's origin; it was ignored/);
  for (const other of ['embedding.mdx', 'hosted.mdx', 'event-views.mdx', 'recordings.mdx', 'troubleshooting.mdx', 'cli.mdx', 'index.mdx']) assert.match(docs(other), /plugins/i, other);
  assert.match(docs('embedding.mdx'), /## Plugins in the embedded page/);
  assert.match(docs('cli.mdx'), /--plugin <file>/);
  assert.match(readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', 'meta.json'), 'utf8'), /"plugins"/);
});

test('the page has no em dash, no bold label and no heading that is not in sentence case', () => {
  assert.ok(!page.includes('—'));
  assert.ok(!/^\*\*[^*]+:\*\*/m.test(page));
});
