// L03 T033 / constitution VI: adding protocol support updates views, fixtures and documentation
// together, so the mapping document must name every baseline event type.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { EventType } from '@ag-ui/core';

const doc = readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', 'event-views.mdx'), 'utf8');

for (const type of Object.values(EventType)) {
  test(`the event views page maps ${type}`, () => {
    assert.ok(doc.includes(`\`${type}\``), `${type} is missing from the mapping table`);
  });
}

test('the document keeps the received versus derived distinction and the opaque-value rule', () => {
  assert.match(doc, /## Received and derived/);
  assert.match(doc, /not decoded/);
  assert.match(doc, /Markdown is not interpreted/);
});

test('the state history is described, with its keys, its diff kinds and its labels', () => {
  assert.match(doc, /### State history/);
  assert.match(doc, /### Read a diff/);
  assert.match(doc, /### Move through the history/);
  for (const key of ['Down arrow', 'Up arrow', 'Home', 'End']) assert.ok(doc.includes(`| ${key} |`), `${key} is missing from the key table`);
  for (const label of ['`+ added`', '`- removed`', '`~ changed`', 'Past state', 'Back to latest', 'No net change']) assert.ok(doc.includes(label), `${label} is missing`);
});
