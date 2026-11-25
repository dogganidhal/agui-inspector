// The v0.8 renderer's action (spec 008, FR-007), and the JSON a context becomes (spec 020, FR-012): the same five fields as a v0.9 action, a context that is
// plain JSON even when the data model held a Map, and nothing that is not an action.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { droppedMessage, fromV08Action, jsonContext } from '../../src/core/a2ui/actions.ts';

const base = { name: 'go', surfaceId: 's', sourceComponentId: 'b', timestamp: '2026-10-04T10:00:00.000Z' };

test('a v0.8 userAction becomes the five-field action', () => {
  const action = fromV08Action({ userAction: { ...base, context: { a: '1', b: 2, c: true, d: null } } })?.action;
  assert.deepEqual(action, { ...base, context: { a: '1', b: 2, c: true, d: null } });
  assert.deepEqual(Object.keys(action!).sort(), ['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
});

test('no context is an empty one', () => {
  assert.deepEqual(fromV08Action({ userAction: base })?.action.context, {});
});

test('a Map from the v0.8 data model is written as an object, deeply', () => {
  const nested = new Map<string, unknown>([['inner', new Map([['k', 'v']])], ['list', [new Map([['x', 1]])]]]);
  const action = fromV08Action({ userAction: { ...base, context: { whole: nested, plain: 'x' } } })?.action;
  assert.deepEqual(action?.context, { whole: { inner: { k: 'v' }, list: [{ x: 1 }] }, plain: 'x' });
  assert.equal(JSON.stringify(action?.context), '{"whole":{"inner":{"k":"v"},"list":[{"x":1}]},"plain":"x"}');
});

test('the context is a copy: what the user types next cannot change it', () => {
  const source = { list: ['a'], deep: { n: 1 } };
  const action = fromV08Action({ userAction: { ...base, context: source } })?.action;
  source.list.push('b');
  source.deep.n = 2;
  assert.deepEqual(action?.context, { list: ['a'], deep: { n: 1 } });
});

test('a message that is not a user action is not an action', () => {
  assert.equal(fromV08Action({ error: { message: 'x' } } as never), undefined);
  assert.equal(fromV08Action({}), undefined);
});

test('a context entry with no value is left out and named, at any depth, as JSON.stringify leaves it out; null stays', () => {
  const context = { name: 'Ada', missing: undefined, kept: null, deep: { gone: undefined, here: 1 }, list: ['a', undefined, null], fn: () => 1 };
  const { context: written, dropped } = jsonContext(context);
  assert.deepEqual(written, JSON.parse(JSON.stringify(context)));
  assert.deepEqual(written, { name: 'Ada', kept: null, deep: { here: 1 }, list: ['a', null, null] });
  assert.deepEqual(dropped, ['missing', 'deep.gone', 'list[1]', 'fn']);
  assert.deepEqual(jsonContext({ a: 1, b: [2], c: { d: 'x' } }).dropped, [], 'a full context drops nothing');
});

test('a v0.8 context entry with no value is left out too, so the action still goes', () => {
  const built = fromV08Action({ userAction: { ...base, context: { note: undefined, count: 1 } } });
  assert.deepEqual(built?.action.context, { count: 1 });
  assert.deepEqual(built?.dropped, ['note']);
});

test('a key named __proto__ stays data', () => {
  const { context } = jsonContext(JSON.parse('{"__proto__": {"x": 1}}'));
  assert.deepEqual(Object.keys(context), ['__proto__']);
  assert.equal(Object.getPrototypeOf(context), Object.prototype);
});

test('the note names the action, its button and every entry left out', () => {
  const action = { ...base, context: {} };
  assert.equal(droppedMessage(action, ['x']), 'Action go from b was sent without x: the context bound it to no value, and JSON has none to send.');
  assert.match(droppedMessage(action, ['x', 'deep.y']), /without x, deep\.y: the context bound them/);
});
