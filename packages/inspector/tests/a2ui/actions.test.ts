// The v0.8 renderer's action (spec 008, FR-007): the same five fields as a v0.9 action, a context that is
// plain JSON even when the data model held a Map, and nothing that is not an action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromV08Action } from '../../src/core/a2ui/actions.ts';

const base = { name: 'go', surfaceId: 's', sourceComponentId: 'b', timestamp: '2026-10-04T10:00:00.000Z' };

test('a v0.8 userAction becomes the five-field action', () => {
  const action = fromV08Action({ userAction: { ...base, context: { a: '1', b: 2, c: true, d: null } } });
  assert.deepEqual(action, { ...base, context: { a: '1', b: 2, c: true, d: null } });
  assert.deepEqual(Object.keys(action!).sort(), ['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
});

test('no context is an empty one', () => {
  assert.deepEqual(fromV08Action({ userAction: base })?.context, {});
});

test('a Map from the v0.8 data model is written as an object, deeply', () => {
  const nested = new Map<string, unknown>([['inner', new Map([['k', 'v']])], ['list', [new Map([['x', 1]])]]]);
  const action = fromV08Action({ userAction: { ...base, context: { whole: nested, plain: 'x' } } });
  assert.deepEqual(action?.context, { whole: { inner: { k: 'v' }, list: [{ x: 1 }] }, plain: 'x' });
  assert.equal(JSON.stringify(action?.context), '{"whole":{"inner":{"k":"v"},"list":[{"x":1}]},"plain":"x"}');
});

test('the context is a copy: what the user types next cannot change it', () => {
  const source = { list: ['a'], deep: { n: 1 } };
  const action = fromV08Action({ userAction: { ...base, context: source } });
  source.list.push('b');
  source.deep.n = 2;
  assert.deepEqual(action?.context, { list: ['a'], deep: { n: 1 } });
});

test('a message that is not a user action is not an action', () => {
  assert.equal(fromV08Action({ error: { message: 'x' } } as never), undefined);
  assert.equal(fromV08Action({}), undefined);
});
