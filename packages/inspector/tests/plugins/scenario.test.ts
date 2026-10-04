// Spec 014 (FR-022): the reference agent's plugin scenario, the one the example plugin and the renderer tests run against.
// A custom event and an activity of a type of its own, valid on the wire, in a run that finishes; the public demo's quick
// messages and the frozen bytes of the other scenarios stay as they are (tests/demo/scenarios.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventSchemas } from '@ag-ui/core/schemas';
import { interactiveResponse, PLUGINS, SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';

const events = (message: string) =>
  interactiveResponse({ threadId: 't1', runId: 'r1', messages: [{ role: 'user', content: message }] }).chunks.map((chunk) => JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /, '').trim()) as { type: string });

test('the plugins message gives a custom event, an activity and its delta between a start and a finish, all valid events', () => {
  const run = events(PLUGINS);
  assert.deepEqual(run.map((event) => event.type), ['RUN_STARTED', 'CUSTOM', 'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  for (const event of run) assert.equal(EventSchemas.safeParse(event).success, true, event.type);
  assert.deepEqual(run[1], { type: 'CUSTOM', name: 'example.note', value: { text: 'Synthetic note' } });
  assert.deepEqual(run[2], { type: 'ACTIVITY_SNAPSHOT', messageId: 'plan-1', activityType: 'example-plan', content: { steps: ['Read', 'Write'] }, replace: true });
  assert.deepEqual(run[3], { type: 'ACTIVITY_DELTA', messageId: 'plan-1', activityType: 'example-plan', patch: [{ op: 'add', path: '/steps/-', value: 'Review' }] });
});

test('it is not a quick message of the public demo, and any other message is still a plain reply', () => {
  assert.ok(!(Object.values(SCENARIOS) as string[]).includes(PLUGINS));
  assert.deepEqual(events('anything else').map((event) => event.type), ['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
});
