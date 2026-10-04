// Spec 004 (US3): the conversation says which replies the inspector gave from the profile and which the developer
// gave, in the run that carried them and on each tool result. The mark comes from the recorded run; the request
// body, which the projection reads the rest from, never says it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AutomaticReplies, ConversationViewProps } from '../../src/contracts.ts';
import { ConversationView } from '../../src/views/conversation/index.tsx';
import { harness } from './support.ts';

const noop = () => undefined;
const started = (runId: string) => ({ type: 'RUN_STARTED', threadId: 't1', runId });
const finished = (runId: string, outcome: object = { type: 'success' }) => ({ type: 'RUN_FINISHED', threadId: 't1', runId, outcome });

function render(automaticReplies?: AutomaticReplies): string {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1' } });
  const first = [
    started('r1'),
    { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'pick_color' },
    { type: 'TOOL_CALL_END', toolCallId: 'c1' },
    { type: 'TOOL_CALL_START', toolCallId: 'c2', toolCallName: 'pick_size' },
    { type: 'TOOL_CALL_END', toolCallId: 'c2' },
    finished('r1', { type: 'success', pendingToolCallIds: ['c1', 'c2'] }),
  ];
  for (const [i, event] of first.entries()) h.push('ex1', event, (i + 1) * 10);
  h.close('ex1');
  h.open('ex2', {
    input: {
      threadId: 't1',
      runId: 'r2',
      resume: [{ interruptId: 'i1', status: 'resolved', payload: {} }],
      messages: [{ id: 'tr1', role: 'tool', toolCallId: 'c1', content: 'teal' }, { id: 'tr2', role: 'tool', toolCallId: 'c2', content: 'by hand' }],
    },
    ...(automaticReplies !== undefined && { automaticReplies }),
  });
  h.push('ex2', started('r2'), 10);
  h.close('ex2');
  const props: ConversationViewProps = { store: h.store, interrupts: [], toolResults: [], onDraftInterrupt: noop, onAnswerInterrupt: noop, onDraftToolResult: noop, onSubmitToolResult: noop, onContinue: noop };
  return renderToStaticMarkup(<ConversationView {...props} />);
}

test('a scripted tool result reads "automatic", a typed one reads "entered by you", and the run lists what was automatic', () => {
  const markup = render({ interruptIds: ['i1'], toolCallIds: ['c1'] });
  assert.equal((markup.match(/Result(?:<!-- -->)? · automatic/g) ?? []).length, 1);
  assert.equal((markup.match(/Result(?:<!-- -->)? · entered by you/g) ?? []).length, 1);
  assert.match(markup, /Carried:[\s\S]*resume · 1 answer[\s\S]*automatic · i1, c1/);
});

test('without a recorded mark every reply reads as given by the developer', () => {
  const markup = render();
  assert.doesNotMatch(markup, /automatic/i);
  assert.equal((markup.match(/Result(?:<!-- -->)? · entered by you/g) ?? []).length, 2);
});
