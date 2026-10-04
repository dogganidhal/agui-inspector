// The v0.8 scenario data of the reference agent (spec 008, FR-019): every message is one the v0.8 protocol
// accepts, the real v0.8 processor shows both surfaces, and the continuations extend the list as the contract says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { A2uiMessageProcessor, A2uiMessageSchema } from '@a2ui/web_core/v0_8';
import {
  STANDARD_V08_CATALOG_ID,
  THIRD_PARTY_HOST,
  mixedSurfaces,
  v08Continuation,
  v08Surfaces,
  type UserAction,
} from '../../examples/reference-agent/a2ui-scenarios.ts';

const submit: UserAction = {
  name: 'submit_expense',
  surfaceId: 'expense',
  sourceComponentId: 'submit',
  context: { amount: '42.50', category: ['meals'], receipt: true, urgency: 3 },
  timestamp: '2026-10-04T10:00:00.000Z',
};
const withdraw: UserAction = { name: 'withdraw_expense', surfaceId: 'status', sourceComponentId: 'withdraw', context: { status: 'Waiting for review' }, timestamp: submit.timestamp };

const kinds = (operations: readonly object[]) => operations.map((operation) => Object.keys(operation).join(','));

test('every v0.8 message passes the strict v0.8 schema and carries no version', () => {
  for (const operation of [...v08Surfaces, ...v08Continuation(v08Surfaces, submit), ...v08Continuation(v08Surfaces, withdraw)]) {
    const parsed = A2uiMessageSchema.safeParse(operation);
    assert.equal(parsed.success, true, parsed.success ? '' : JSON.stringify(parsed.error.issues));
    assert.equal('version' in operation, false);
  }
});

test('the story is six messages: components, data and a root for each of two surfaces', () => {
  assert.deepEqual(kinds(v08Surfaces), ['surfaceUpdate', 'dataModelUpdate', 'beginRendering', 'surfaceUpdate', 'dataModelUpdate', 'beginRendering']);
  assert.equal((v08Surfaces[2] as { beginRendering: { catalogId?: string } }).beginRendering.catalogId, undefined, 'expense names no catalog');
  assert.equal((v08Surfaces[5] as { beginRendering: { catalogId?: string } }).beginRendering.catalogId, STANDARD_V08_CATALOG_ID);
});

test('a real v0.8 processor shows both surfaces after the six messages', () => {
  const processor = new A2uiMessageProcessor();
  processor.processMessages(structuredClone(v08Surfaces) as never);
  assert.deepEqual([...processor.getSurfaces().keys()], ['expense', 'status']);
  const status = processor.getSurfaces().get('status')!;
  assert.equal(status.dataModel.get('status'), 'Waiting for review');
});

test('a surface is not visible before beginRendering names its root', () => {
  const processor = new A2uiMessageProcessor();
  processor.processMessages(structuredClone(v08Surfaces.slice(0, 2)) as never);
  assert.deepEqual([...processor.getSurfaces().keys()], []);
});

test('submit_expense keeps the first six messages, changes the status and adds a line that shows the context', () => {
  const answer = v08Continuation(v08Surfaces, submit);
  assert.deepEqual(answer.slice(0, 6), v08Surfaces);
  assert.deepEqual(kinds(answer.slice(6)), ['dataModelUpdate', 'surfaceUpdate']);
  const processor = new A2uiMessageProcessor();
  processor.processMessages(structuredClone(answer) as never);
  assert.deepEqual([...processor.getSurfaces().keys()], ['expense', 'status']);
  assert.equal(processor.getSurfaces().get('status')!.dataModel.get('status'), 'Submitted 42.50 for meals');
  assert.match(JSON.stringify(answer.at(-1)), /Received submit_expense from submit on expense: .*42\.50/);
});

test('withdraw_expense keeps the first six messages, removes the form and changes the status', () => {
  const answer = v08Continuation(v08Surfaces, withdraw);
  assert.deepEqual(answer.slice(0, 6), v08Surfaces);
  assert.deepEqual(answer.slice(6), [{ deleteSurface: { surfaceId: 'expense' } }, { dataModelUpdate: { surfaceId: 'status', contents: [{ key: 'status', valueString: 'Withdrawn' }] } }]);
  const processor = new A2uiMessageProcessor();
  processor.processMessages(structuredClone(answer) as never);
  assert.deepEqual([...processor.getSurfaces().keys()], ['status']);
});

test('the continuation is a pure function of the action and the list it is given', () => {
  assert.deepEqual(v08Continuation(v08Surfaces, submit), v08Continuation(v08Surfaces, submit));
  assert.notDeepEqual(v08Continuation(v08Surfaces, submit), v08Continuation(v08Surfaces, { ...submit, context: { ...submit.context, amount: '7' } }));
  const before = JSON.stringify(v08Surfaces);
  v08Continuation(v08Surfaces, submit);
  assert.equal(JSON.stringify(v08Surfaces), before, 'the first list is never changed');
});

test('a submit with no category says so', () => {
  assert.match(JSON.stringify(v08Continuation(v08Surfaces, { ...submit, context: { amount: '5', category: null } })), /Submitted 5 for no category/);
});

test('the mixed list holds both versions, with one surface id in both', () => {
  const versions = mixedSurfaces.map((operation) => ('version' in operation ? 'v0.9' : 'v0.8'));
  assert.deepEqual(versions, ['v0.9', 'v0.9', 'v0.8', 'v0.8', 'v0.9', 'v0.9', 'v0.8', 'v0.8']);
  for (const operation of mixedSurfaces.filter((entry) => !('version' in entry))) assert.equal(A2uiMessageSchema.safeParse(operation).success, true);
});

test('no address in any v0.8 scenario can resolve', () => {
  const everything = JSON.stringify([v08Surfaces, mixedSurfaces, v08Continuation(v08Surfaces, submit)]);
  const addresses = (everything.match(/https?:\/\/[^"\\\s)]+/g) ?? []).filter((address) => address !== STANDARD_V08_CATALOG_ID && !address.startsWith('https://a2ui.org/specification/'));
  assert.deepEqual(addresses, []);
  assert.ok(THIRD_PARTY_HOST.endsWith('.invalid'));
});
