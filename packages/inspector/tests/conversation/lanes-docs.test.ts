// Spec 009 (FR-024, SC-012): the docs describe subagent lanes and the timeline: what a lane holds, the statuses, what the
// axis means, the jumps, the keys, and how live runs and imported recordings behave. The wiring page names the shared list.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const page = (name: string) => readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', name), 'utf8');
const events = page('event-views.mdx');
const lanes = events.slice(events.indexOf('## Subagent lanes'), events.indexOf('\n## State\n'));

test('the event views page has a section for lanes and the timeline, between the snapshots and the state', () => {
  assert.ok(lanes.length > 1000, 'the section exists');
  assert.match(lanes, /^## Subagent lanes/);
  assert.match(lanes, /## Subagent timeline/);
});

test('it explains what a lane holds and how lanes nest', () => {
  assert.match(lanes, /one lane for each subagent in each run/);
  assert.match(lanes, /`subagentRunId`/);
  assert.match(lanes, /`parentSubagentRunId`/);
  assert.match(lanes, /Subagents that run in parallel get separate lanes/);
  assert.match(lanes, /State events carry a `subagentRunId` too, but they are not in the conversation/);
  assert.match(lanes, /Whole messages in a run's input or in a `MESSAGES_SNAPSHOT` stay where they were in 0\.1\.0/);
});

test('it lists the six statuses with their words and glyphs', () => {
  for (const [word, glyph] of [['Running', '▸'], ['Finished', '✓'], ['Suspended', '‖'], ['Error', '✕'], ['Stopped by you', '■'], ['No end event', '?']]) {
    assert.ok(lanes.includes(`| ${word} | \`${glyph}\` |`), `${word} and ${glyph}`);
  }
  assert.match(lanes, /Start not received/);
  assert.match(lanes, /not seen in this run/);
  assert.match(lanes, /Continued/);
  assert.match(lanes, /A failed subagent does not fail its run/);
});

test('it says the timeline uses arrival offsets and not the event timestamp, and what each axis is', () => {
  assert.match(lanes, /offsets at which frames arrived/);
  assert.match(lanes, /optional `timestamp` of an event is not used/);
  assert.match(lanes, /Each run has its own axis/);
  assert.match(lanes, /first 100 subagent rows/);
});

test('it documents the jumps and every key', () => {
  assert.match(lanes, /Show in timeline/);
  assert.match(lanes, /Replaced transcript/);
  for (const key of ['Down arrow', 'Up arrow', 'Home', 'End', 'Enter or Space']) assert.match(lanes, new RegExp(`\\| ${key} \\|`), key);
  assert.match(lanes, /one tab stop/);
});

test('it says live runs and imported recordings behave the same and nothing is sent or stored', () => {
  assert.match(lanes, /a running bar grows with every frame/);
  assert.match(lanes, /same lanes and the same timeline as the live capture/);
  assert.match(lanes, /recordings from 0\.1\.0 work too/);
  assert.match(lanes, /sends no request, writes nothing to browser storage and does not change the recording/);
});

test('the other pages point at it', () => {
  const internals = page('internals.mdx');
  assert.match(internals, /`model\.subagents`/);
  assert.match(internals, /`timelineOf\(model\)`/);
  assert.match(page('inspection.mdx'), /subagent lanes and their timeline/);
  assert.match(events, /\[Subagent lanes\]\(#subagent-lanes\)/);
});

test('the new text has no em dash', () => {
  const internals = page('internals.mdx');
  const wiring = internals.slice(internals.indexOf('The projection also lists every subagent lane'), internals.indexOf('`ConversationView` and `StateView` also take'));
  assert.ok(wiring.length > 100);
  for (const [name, text] of [['lanes section', lanes], ['wiring paragraph', wiring]] as const) assert.doesNotMatch(text, /[—–]/, name);
});
