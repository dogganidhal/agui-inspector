// #43: a run id and a frame reference are buttons that reveal their evidence when the page gives the views a
// reveal action, and the plain evidence text they were before when it does not (a view mounted on its own). The
// markup is checked here; clicking, the pane switch, focus and scrolling are in tests/e2e/hosted/reveal-evidence.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConversationViewProps } from '../../src/contracts.ts';
import { ConversationView } from '../../src/views/conversation/index.tsx';
import { StateView } from '../../src/views/conversation/state.tsx';
import { RUN_FINISHED, RUN_STARTED, harness } from './support.ts';

const orphan = { type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 'x' };

function scripted() {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  [RUN_STARTED, { type: 'STATE_SNAPSHOT', snapshot: { n: 1 } }, orphan, RUN_FINISHED].forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  h.close('ex1');
  return h;
}

const props = (h: ReturnType<typeof harness>): ConversationViewProps => ({
  store: h.store,
  interrupts: [],
  toolResults: [],
  onDraftInterrupt() {},
  onAnswerInterrupt() {},
  onDraftToolResult() {},
  onSubmitToolResult() {},
  onContinue() {},
});

test('with a reveal action the run id and the frame reference of a "Not shown" finding are named buttons', () => {
  const html = renderToStaticMarkup(createElement(ConversationView, { ...props(scripted()), onReveal() {} }));
  assert.match(html, /<button[^>]*type="button"[^>]*aria-label="Show the exchange of run r1 in the frames list"[^>]*>(?:(?!<\/button>).)*r1(?:(?!<\/button>).)*<\/button>/);
  assert.match(html, /<button[^>]*type="button"[^>]*aria-label="Show frame #2 in the frames list"[^>]*>frame #2<\/button>/);
  assert.match(html, /never started/);
});

test('the evidence token still colors the reference, so it keeps its contrast', () => {
  const html = renderToStaticMarkup(createElement(ConversationView, { ...props(scripted()), onReveal() {} }));
  assert.match(html, /<button[^>]*class="[^"]*\bagui-conv-evidence\b[^"]*"[^>]*>frame #2<\/button>/);
});

test('without a reveal action nothing is a button and the text is as before', () => {
  const html = renderToStaticMarkup(createElement(ConversationView, props(scripted())));
  // The Markdown control is a pair of buttons of its own; a reference is a button only when it can be revealed.
  assert.doesNotMatch(html, /<button[^>]*aria-label="Show /);
  assert.match(html, /<span class="agui-conv-mono agui-conv-evidence">frame #2<\/span>/);
  assert.match(html, /<b class="agui-conv-mono">r1<\/b>/);
});

test('the state view offers the same references', () => {
  const h = scripted();
  const withReveal = renderToStaticMarkup(createElement(StateView, { store: h.store, onReveal() {} }));
  assert.match(withReveal, /<button[^>]*aria-label="Show frame #1 in the frames list"[^>]*>frame #1<\/button>/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(StateView, { store: h.store })), /<button/);
});
