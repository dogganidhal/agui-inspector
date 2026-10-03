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
