// L03 T030/T032: the JSON Patch (RFC 6902) applier behind state deltas and activity patches. A patch
// that cannot be applied is an error result, never a partial update: the caller keeps the last valid value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonValue } from '../../src/contracts.ts';
import { applyJsonPatch, applyStateDelta } from '../../src/core/projection/patch.ts';

const ok = (document: JsonValue, patch: readonly object[]): JsonValue => {
  const result = applyJsonPatch(document, patch as never);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
};
const fails = (document: JsonValue, patch: readonly object[]): string => {
  const result = applyJsonPatch(document, patch as never);
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
};

test('add sets an object member and inserts into an array', () => {
  assert.deepEqual(ok({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }]), { a: 1, b: 2 });
  assert.deepEqual(ok({ list: [1, 3] }, [{ op: 'add', path: '/list/1', value: 2 }]), { list: [1, 2, 3] });
  assert.deepEqual(ok({ list: [1] }, [{ op: 'add', path: '/list/-', value: 2 }]), { list: [1, 2] });
});

test('add at the root replaces the whole document', () => {
  assert.deepEqual(ok({ a: 1 }, [{ op: 'add', path: '', value: [1] }]), [1]);
});

test('remove and replace need an existing target', () => {
  assert.deepEqual(ok({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  assert.deepEqual(ok({ list: [1, 2, 3] }, [{ op: 'remove', path: '/list/1' }]), { list: [1, 3] });
  assert.deepEqual(ok({ a: 1 }, [{ op: 'replace', path: '/a', value: 'x' }]), { a: 'x' });
  assert.match(fails({ a: 1 }, [{ op: 'remove', path: '/missing' }]), /remove/);
  assert.match(fails({ a: 1 }, [{ op: 'replace', path: '/missing', value: 1 }]), /replace/);
});

test('move and copy use a from location; copy does not alias', () => {
  assert.deepEqual(ok({ a: 1 }, [{ op: 'move', from: '/a', path: '/b' }]), { b: 1 });
  const copied = ok({ a: { n: 1 } }, [{ op: 'copy', from: '/a', path: '/b' }]) as { a: object; b: object };
  assert.deepEqual(copied, { a: { n: 1 }, b: { n: 1 } });
  assert.notEqual(copied.a, copied.b);
  assert.match(fails({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b/c' }]), /move/);
});

test('test passes on deep equality regardless of key order and fails otherwise', () => {
  assert.deepEqual(ok({ a: { x: 1, y: [1, 2] } }, [{ op: 'test', path: '/a', value: { y: [1, 2], x: 1 } }]), { a: { x: 1, y: [1, 2] } });
  assert.match(fails({ a: 1 }, [{ op: 'test', path: '/a', value: 2 }]), /test/);
});

test('pointer escapes ~0 and ~1 are decoded', () => {
  assert.deepEqual(ok({ 'a/b': 1, 'c~d': 2 }, [{ op: 'replace', path: '/a~1b', value: 9 }, { op: 'replace', path: '/c~0d', value: 8 }]), { 'a/b': 9, 'c~d': 8 });
});

test('operations apply in order and the input is never mutated', () => {
  const input = { a: [1] };
  const out = ok(input, [{ op: 'add', path: '/a/-', value: 2 }, { op: 'add', path: '/b', value: { n: 1 } }, { op: 'replace', path: '/b/n', value: 5 }]);
  assert.deepEqual(out, { a: [1, 2], b: { n: 5 } });
  assert.deepEqual(input, { a: [1] });
});

test('a failing operation fails the whole patch with its position', () => {
  const message = fails({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }, { op: 'remove', path: '/nope' }]);
  assert.match(message, /operation 2/);
});

test('bad array indexes, bad pointers and unknown operations are errors', () => {
  assert.match(fails({ list: [1] }, [{ op: 'add', path: '/list/5', value: 1 }]), /index/);
  assert.match(fails({ list: [1] }, [{ op: 'replace', path: '/list/01', value: 1 }]), /index/);
  assert.match(fails({ a: 1 }, [{ op: 'add', path: 'a', value: 1 }]), /pointer/);
  assert.match(fails({ a: 1 }, [{ op: 'frobnicate', path: '/a' }]), /operation/);
  assert.match(fails({ a: 1 }, [{ op: 'add', path: '/x/y', value: 1 }]), /add/);
});

test('a __proto__ member is data, never the prototype', () => {
  const out = ok({}, [{ op: 'add', path: '/__proto__', value: { polluted: true } }]) as Record<string, unknown>;
  assert.equal(Object.hasOwn(out, '__proto__'), true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
});

test('a state delta with no state yet applies to an empty object', () => {
  const result = applyStateDelta(undefined, [{ op: 'add', path: '/a', value: 1 }] as never);
  assert.deepEqual(result.ok && result.value, { a: 1 });
});

test('a state delta that fails reports why and leaves its input alone', () => {
  const state = { a: 1 };
  const result = applyStateDelta(state, [{ op: 'replace', path: '/a', value: 2 }, { op: 'remove', path: '/missing' }] as never);
  assert.equal(result.ok, false);
  assert.deepEqual(state, { a: 1 });
});
