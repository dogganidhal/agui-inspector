// Clear session in the inspection header (specs/017) as markup: present only when the host offers it, named for
// assistive technology, and disabled with its reason. Pressing it and the confirmation are in tests/e2e/hosted/clear.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionControls, type SessionControlsProps } from '../../src/views/inspection/session.tsx';

const noop = () => undefined;
const html = (props: Partial<SessionControlsProps> = {}) =>
  renderToStaticMarkup(createElement(SessionControls, { exchangeCount: 0, frameCount: 0, onExport: noop, onImport: noop, onReadError: noop, ...props }));
/** The opening tag of the button whose text is Clear session, or undefined. */
const clearButton = (markup: string) => markup.match(/<button[^>]*>(?:(?!<\/button>).)*Clear session<\/button>/)?.[0];

test('without a clear callback there is no Clear session control', () => {
  assert.equal(clearButton(html()), undefined);
});

test('the control is named Clear session and is enabled when nothing blocks it', () => {
  const button = clearButton(html({ onClear: noop }));
  assert.ok(button);
  assert.doesNotMatch(button, /disabled/);
  assert.doesNotMatch(button, /title=/);
});

test('a blocked control is disabled and carries the reason as its description', () => {
  const button = clearButton(html({ onClear: noop, clearBlocked: 'Stop the run first: a response is still being recorded' }));
  assert.ok(button);
  assert.match(button, /disabled=""/);
  assert.match(button, /title="Stop the run first: a response is still being recorded"/);
});

test('the control comes after Export session and Import session', () => {
  const markup = html({ onClear: noop });
  const at = (text: string) => markup.indexOf(text);
  assert.ok(at('Export session') < at('Import session') && at('Import session') < at('Clear session'));
});
