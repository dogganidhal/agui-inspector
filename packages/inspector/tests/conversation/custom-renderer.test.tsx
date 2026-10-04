// Spec 014 (FR-014, FR-015; story 4): the conversation's seam for a custom event renderer. A custom event with a renderer
// becomes a card with the event's name, its frame reference and a Rendered/JSON switch. Without one, or when the renderer
// declines, the marker row is the one it always was. The activity card is unchanged. What a container really shows and the
// switch's behavior are in tests/e2e/plugins/renderers.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationViewProps } from '../../src/contracts.ts';
import type { ActivityEntry, CustomEntry } from '../../src/core/projection/index.ts';
import { ConversationView } from '../../src/views/conversation/index.tsx';
import { RUN_FINISHED, RUN_STARTED, harness, type Harness } from './support.ts';

const props = (h: Harness): ConversationViewProps => ({
  store: h.store,
  interrupts: [],
  toolResults: [],
  onDraftInterrupt() {},
  onAnswerInterrupt() {},
  onDraftToolResult() {},
  onSubmitToolResult() {},
  onContinue() {},
});

function played(events: ReadonlyArray<object>): Harness {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  events.forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  h.close('ex1', 'completed', (events.length + 1) * 10);
  return h;
}
const render = (h: Harness, extra: object = {}) => renderToStaticMarkup(createElement(ConversationView, { ...props(h), ...extra }));

const NOTE = { type: 'CUSTOM', name: 'example.note', value: { text: 'Synthetic note' } };
const OTHER = { type: 'CUSTOM', name: 'other.event', value: 1 };
const view = (entry: CustomEntry): ReactNode => createElement('p', { 'data-testid': 'plugin-view' }, `Note: ${entry.name}`);

test('a custom event with a renderer is a card with the name, the frame reference, the switch and the rendered view', () => {
  const html = render(played([RUN_STARTED, NOTE, RUN_FINISHED]), { renderCustom: (entry: CustomEntry) => (entry.name === 'example.note' ? view(entry) : undefined) });
  assert.match(html, /data-entry="custom"/);
  const card = html.slice(html.indexOf('data-entry="custom"'));
  assert.match(card, />CUSTOM</);
  assert.match(card, />example\.note</);
  assert.match(card, /data-testid="plugin-view">Note: example\.note</);
  assert.match(card, /role="group" aria-label="Custom event display"/);
  assert.ok(card.includes('Rendered') && card.includes('JSON'), 'the switch');
  assert.match(card, /frame #1/, 'a reference to the frame is there');
  assert.doesNotMatch(card.slice(0, card.indexOf('data-testid="plugin-view"')), /Synthetic note/, 'the JSON is behind the switch');
});

test('without a renderer, or when it returns nothing, the marker row is the one it always was', () => {
  const h = played([RUN_STARTED, NOTE, OTHER, RUN_FINISHED]);
  const plain = render(h);
  for (const extra of [{}, { renderCustom: () => undefined }, { renderCustom: () => null }]) {
    const html = render(h, extra);
    assert.equal(html, plain, JSON.stringify(Object.keys(extra)));
  }
  assert.match(plain, /class="agui-conv-marker" data-entry="custom"/);
  assert.match(plain, /\{&quot;text&quot;:&quot;Synthetic note&quot;\}/);
});

test('only the event the renderer takes becomes a card; another custom event stays a marker', () => {
  const html = render(played([RUN_STARTED, NOTE, OTHER, RUN_FINISHED]), { renderCustom: (entry: CustomEntry) => (entry.name === 'example.note' ? view(entry) : undefined) });
  assert.equal(html.match(/data-entry="custom"/g)?.length, 2);
  assert.equal(html.match(/class="agui-conv-marker" data-entry="custom"/g)?.length, 1);
  assert.equal(html.match(/data-testid="plugin-view"/g)?.length, 1);
});

test('renderActivity and renderCustom each get their entry, and the activity card behaves as before', () => {
  const seen: string[] = [];
  const html = render(
    played([RUN_STARTED, NOTE, { type: 'ACTIVITY_SNAPSHOT', messageId: 'plan-1', activityType: 'example-plan', content: { steps: ['Read'] }, replace: true }, RUN_FINISHED]),
    {
      renderCustom: (entry: CustomEntry) => (seen.push(`custom ${entry.name}`), undefined),
      renderActivity: (entry: ActivityEntry) => (seen.push(`activity ${entry.activityType}`), createElement('ol', { 'data-testid': 'plan' })),
    },
  );
  assert.deepEqual([...new Set(seen)].sort(), ['activity example-plan', 'custom example.note']);
  assert.match(html, /data-entry="activity" data-activity="plan-1"/);
  assert.match(html, /data-testid="plan"/);
});
