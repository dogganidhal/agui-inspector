// Spec 011 (FR-019, SC-011): the docs describe the waterfall, its open rows and its keys, and the pages that describe the
// inspection pane and the event views point at it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { KIND_WORD, TREE_KEYS } from '../../src/views/inspection/waterfall-model.ts';

const page = (name: string) => readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', name), 'utf8');
const inspection = page('inspection.mdx');
const waterfall = inspection.slice(inspection.indexOf('## Waterfall'), inspection.indexOf('## Arriving from the conversation'));

test('the inspection page has a Waterfall section that says what a row is, what open means and what times are', () => {
  assert.ok(waterfall.length > 0, 'a Waterfall section before "Arriving from the conversation"');
  for (const word of Object.values(KIND_WORD)) assert.ok(waterfall.includes(`\`${word}\``), `the kind word ${word}`);
  for (const text of ['running', 'no end seen', 'waiting for result', 'answered by the client', 'arrival times', 'never makes up an end']) assert.ok(waterfall.includes(text), text);
  assert.match(waterfall, /never changes it and never sends a request/);
});

test('the Waterfall section lists every key of the tree', () => {
  for (const key of ['Down, Up', 'Right', 'Left', 'Home, End', 'Enter']) assert.ok(waterfall.includes(`| ${key} |`), key);
  assert.equal(TREE_KEYS.size, 7, 'the docs table covers the seven keys: Down, Up, Right, Left, Home, End and Enter');
});

test('the event views and internals pages point at the waterfall and name its modules', () => {
  assert.match(page('event-views.mdx'), /\[waterfall\]\(\.\/inspection\.mdx#waterfall\)/);
  const internals = page('internals.mdx');
  assert.match(internals, /## Waterfall wiring/);
  for (const name of ['buildWaterfall', 'WaterfallPanel', 'visibleRows', 'treeKey', 'MESSAGES_SNAPSHOT']) assert.ok(internals.includes(name), name);
});
