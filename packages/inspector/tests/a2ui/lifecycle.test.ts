// FX11 (FR-020): the pre-paint lifecycle of an `a2ui-surface` activity, as `@ag-ui/a2ui-middleware`
// 0.0.11 stamps it, read without altering the content, and what the view shows for each state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, Fragment, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { JsonValue } from '../../src/contracts.ts';
import { readLifecycle } from '../../src/core/a2ui/lifecycle.ts';
import { a2uiActivity } from '../../src/views/a2ui/index.tsx';
import { formSurface } from '../../../../examples/reference-agent/a2ui-scenarios.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
const error = { code: 'unresolved_child', path: 'components[2].children[0]', message: "Child 'ghost' does not exist" };

test('building, retrying and failed are read the way the middleware writes them', () => {
  assert.deepEqual(readLifecycle({ status: 'building' }), { status: 'building', details: [], debugExposure: 'collapsed' });
  assert.deepEqual(readLifecycle({ status: 'building', progressTokens: 40 }), { status: 'building', progressTokens: 40, details: [], debugExposure: 'collapsed' });
  assert.deepEqual(readLifecycle(json({ status: 'retrying', attempt: 2, maxAttempts: 3, errors: [error], debugExposure: 'verbose' })), {
    status: 'retrying',
    attempt: 2,
    maxAttempts: 3,
    details: ["components[2].children[0]: Child 'ghost' does not exist"],
    debugExposure: 'verbose',
  });
  const failed = readLifecycle(json({ status: 'failed', error: 'gave up', maxAttempts: 2, attempts: [{ attempt: 1, ok: false, errors: [error] }, { attempt: 2, ok: false, errors: [] }] }));
  assert.deepEqual(failed, {
    status: 'failed',
    error: 'gave up',
    attempt: 2,
    maxAttempts: 2,
    details: ["Attempt 1 · components[2].children[0]: Child 'ghost' does not exist"],
    debugExposure: 'collapsed',
  });
});

test('the attempt count is accepted as a number too, and odd values are dropped, never thrown on', () => {
  assert.equal(readLifecycle({ status: 'failed', attempts: 3, maxAttempts: 3 })?.attempt, 3);
  const odd = readLifecycle(json({ status: 'retrying', attempt: 'two', maxAttempts: -1, errors: [1, null, 'plain', { message: 'only a message' }, { path: 'p' }], debugExposure: 'loud' }));
  assert.deepEqual(odd, { status: 'retrying', attempt: undefined, details: ['plain', 'only a message'], debugExposure: 'collapsed' });
});

test('content that declares no lifecycle this view knows is not a lifecycle', () => {
  for (const content of [null, 'building', ['building'], {}, { status: 'rendered' }, { status: 'cooking' }, { status: 1 }]) assert.equal(readLifecycle(json(content)), undefined);
});

const noAction = () => undefined;
const markup = (content: JsonValue, renderEnabled = true) =>
  renderToStaticMarkup(createElement(Fragment, null, a2uiActivity({ messageId: 'm1', activityType: 'a2ui-surface', content }, { renderEnabled, onAction: noAction })));

test('each state shows its own status: building is a status, retrying a warning, failed an alert', () => {
  const building = markup({ status: 'building', progressTokens: 120 });
  assert.match(building, /data-status="building"/);
  assert.match(building, /role="status"/);
  assert.match(building, /about 120 tokens so far/);
  assert.doesNotMatch(building, /No A2UI operations yet|role="alert"/);

  const retrying = markup(json({ status: 'retrying', attempt: 2, maxAttempts: 3, errors: [error] }));
  assert.match(retrying, /data-status="retrying"/);
  assert.match(retrying, /agui-finding--warn/);
  assert.match(retrying, /Attempt 2 of 3/);
  assert.match(retrying, /Validation errors \(1\)/);
  assert.doesNotMatch(retrying, /role="alert"|\sopen=""/);

  const failed = markup(json({ status: 'failed', error: 'The UI failed validation', attempts: [1, 2, 3].map((attempt) => ({ attempt, ok: false, errors: [error] })), maxAttempts: 3 }));
  assert.match(failed, /data-status="failed"/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /agui-finding--err/);
  assert.match(failed, /The UI failed validation/);
  assert.match(failed, /3 of 3 attempts used/);
  assert.match(failed, /Validation errors \(3\)/);
});

test('debugExposure decides whether the error detail is shown, hidden or open', () => {
  const content = (debugExposure: string) => json({ status: 'retrying', attempt: 1, maxAttempts: 3, errors: [error], debugExposure });
  assert.doesNotMatch(markup(content('hidden')), /Validation errors/);
  assert.match(markup(content('verbose')), /<details[^>]*\sopen=""/);
  assert.doesNotMatch(markup(content('collapsed')), /<details[^>]*\sopen=""/);
});

test('operations win over a lifecycle, and an unknown status keeps the plain note', () => {
  const entry = (content: JsonValue) => ({ messageId: 'm1', activityType: 'a2ui-surface', content });
  const painted = a2uiActivity(entry(json({ status: 'building', a2ui_operations: formSurface })), { renderEnabled: true, onAction: noAction }) as ReactElement<{ lifecycle?: unknown }>;
  assert.equal(painted.props.lifecycle, undefined, 'the operations are drawn and the lifecycle is not passed on');
  assert.match(markup({ status: 'cooking' }), /No A2UI operations yet/);
});
