// L02 T028: the manual behavior is documented where the runtime and the views are, and the document
// keeps the rules a reader relies on (barriers, token handling, no fabricated events).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const doc = readFileSync(path.join(process.cwd(), 'docs', 'conversation.md'), 'utf8');

test('docs/conversation.md covers each control and barrier', () => {
  for (const heading of ['## Where requests go', '## The token', '## Sending a run', '## Replies', '### Interrupts', '### Client tool calls', '### Surface actions', '## Raw submissions']) {
    assert.ok(doc.includes(heading), heading);
  }
  for (const phrase of ['Stop', 'New thread', 'Quick messages', 'no terminal event is made up', 'does not follow redirects|Never followed', 'G-07']) {
    assert.match(doc, new RegExp(phrase), phrase);
  }
});

test('the document contains no em or en dashes and no bold decoration', () => {
  assert.doesNotMatch(doc, /[—–]/);
  assert.doesNotMatch(doc, /\*\*/);
});
