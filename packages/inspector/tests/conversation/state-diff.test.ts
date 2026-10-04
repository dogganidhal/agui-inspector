// What a state change did: the net differences between two states (specs/010-state-history, FR-002, FR-003, SC-002).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonValue } from '../../src/contracts.ts';
import { diffStates, type Difference } from '../../src/core/projection/state-diff.ts';

const diff = (before: JsonValue, after: JsonValue) => diffStates(before, after).map((d) => [d.kind, d.path]);

test('added, removed and changed members each get one difference with their values', () => {
  const differences = diffStates({ keep: 1, gone: true, round: 0 }, { keep: 1, round: 1, fresh: 'x' });
  assert.deepEqual(differences, [
    { kind: 'removed', path: '/gone', before: true },
    { kind: 'changed', path: '/round', before: 0, after: 1 },
    { kind: 'added', path: '/fresh', after: 'x' },
  ]);
});

test('an added or removed value is one difference, not one per leaf', () => {
  assert.deepEqual(diff({}, { a: { b: [1, 2], c: { d: 1 } } }), [['added', '/a']]);
  assert.deepEqual(diff({ a: { b: [1, 2] } }, {}), [['removed', '/a']]);
});

test('nested changes carry the full path', () => {
  assert.deepEqual(diff({ a: { b: [{ c: 1 }] } }, { a: { b: [{ c: 2 }] } }), [['changed', '/a/b/0/c']]);
});

test('arrays compare by position: an append adds, a removal at the head changes what follows and removes the tail', () => {
  assert.deepEqual(diff({ items: ['a'] }, { items: ['a', 'b'] }), [['added', '/items/1']]);
  assert.deepEqual(diff({ items: ['a', 'b', 'c'] }, { items: ['b', 'c'] }), [['changed', '/items/0'], ['changed', '/items/1'], ['removed', '/items/2']]);
});

test('a move is a removal and an addition, and a copy is an addition', () => {
  assert.deepEqual(diff({ a: 1 }, { b: 1 }), [['removed', '/a'], ['added', '/b']]);
  assert.deepEqual(diff({ a: 1 }, { a: 1, b: 1 }), [['added', '/b']]);
});

test('equal states, a different key order and a replace with an equal value have no difference', () => {
  assert.deepEqual(diffStates({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }), []);
  assert.deepEqual(diffStates(null, null), []);
  assert.deepEqual(diffStates([], []), []);
});

test('a change of kind replaces the whole value at that path', () => {
  assert.deepEqual(diff({ a: { b: 1 } }, { a: [1] }), [['changed', '/a']]);
  assert.deepEqual(diff({ a: 1 }, { a: null }), [['changed', '/a']]);
  assert.deepEqual(diff({ a: '1' }, { a: 1 }), [['changed', '/a']]);
});

test('the root has the empty path, and any JSON value can be the state', () => {
  assert.deepEqual(diffStates({ a: 1 }, [1]), [{ kind: 'changed', path: '', before: { a: 1 }, after: [1] }]);
  assert.deepEqual(diffStates('a', 'b'), [{ kind: 'changed', path: '', before: 'a', after: 'b' }]);
  assert.deepEqual(diff(null, { a: 1 }), [['changed', '']]);
});

test('keys that look like pointer syntax are escaped, and __proto__ is data', () => {
  assert.deepEqual(diff({ 'a/b': 1, 'c~d': 1 }, { 'a/b': 2, 'c~d': 2 }), [['changed', '/a~1b'], ['changed', '/c~0d']]);
  const before = JSON.parse('{"__proto__": 1}') as JsonValue;
  const after = JSON.parse('{"__proto__": 2}') as JsonValue;
  assert.deepEqual(diffStates(before, after), [{ kind: 'changed', path: '/__proto__', before: 1, after: 2 }]);
  assert.deepEqual(diffStates(before, before), []);
  assert.equal(({} as { polluted?: unknown }).polluted, undefined);
});

test('a subtree deeper than 100 levels compares without recursion, so no depth can overflow the stack', () => {
  const nest = (leaf: JsonValue, depth: number, extra?: JsonValue): JsonValue => {
    let value = leaf;
    for (let i = 0; i < depth; i += 1) value = extra === undefined ? { n: value } : { n: value, extra };
    return value;
  };
  // Deep enough to overflow any call stack, so this fails with a RangeError on any runner if a comparison recurses.
  const DEPTH = 200_000;
  const differences = diffStates(nest(1, DEPTH), nest(2, DEPTH));
  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.kind, 'changed');
  assert.equal(differences[0]?.path.length > 0, true);
  assert.deepEqual(diffStates(nest(1, DEPTH), nest(1, DEPTH)), [], 'equal deep values are not a difference, though they are different objects');
  // Past the cap, key order still does not matter and a deep sibling that did not change is not reported.
  const swapped = (value: JsonValue): JsonValue => ({ extra: 0, deep: value });
  assert.deepEqual(diffStates({ deep: nest(1, DEPTH, 0), extra: 0, shallow: 1 }, { ...(swapped(nest(1, DEPTH, 0)) as object), shallow: 2 } as JsonValue), [{ kind: 'changed', path: '/shallow', before: 1, after: 2 }]);
});

test('past the depth cap nothing is serialized, so no runtime has to recurse through the subtree', () => {
  const nest = (leaf: JsonValue): JsonValue => {
    let value = leaf;
    for (let i = 0; i < 1000; i += 1) value = { n: value };
    return value;
  };
  const stringify = JSON.stringify;
  let calls = 0;
  JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
    calls += 1;
    return stringify(...args);
  }) as typeof JSON.stringify;
  try {
    assert.equal(diffStates(nest(1), nest(2)).length, 1);
    assert.deepEqual(diffStates(nest(1), nest(1)), []);
  } finally {
    JSON.stringify = stringify;
  }
  assert.equal(calls, 0);
});

// ---- applying a diff to `before` gives `after` (SC-002) ----

type Container = JsonValue[] | { [key: string]: JsonValue };

function unescape(path: string): string[] {
  return path === '' ? [] : path.slice(1).split('/').map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function applyDiff(before: JsonValue, differences: readonly Difference[]): JsonValue {
  let root = structuredClone(before);
  // Removals first, last position first, so removing an array item does not move one still to be removed.
  const ordered = [...differences.filter((d) => d.kind === 'removed').reverse(), ...differences.filter((d) => d.kind !== 'removed')];
  for (const difference of ordered) {
    const tokens = unescape(difference.path);
    if (tokens.length === 0) {
      root = structuredClone((difference as { after: JsonValue }).after);
      continue;
    }
    let parent = root as Container;
    for (const token of tokens.slice(0, -1)) parent = (parent as { [key: string]: JsonValue })[token] as Container;
    const last = tokens[tokens.length - 1] as string;
    if (difference.kind === 'removed') {
      if (Array.isArray(parent)) parent.splice(Number(last), 1);
      else delete parent[last];
    } else if (Array.isArray(parent)) parent[Number(last)] = structuredClone(difference.after);
    else Object.defineProperty(parent, last, { value: structuredClone(difference.after), enumerable: true, writable: true, configurable: true });
  }
  return root;
}

const equal = (a: JsonValue, b: JsonValue): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const members = value as { [key: string]: JsonValue };
    return Object.fromEntries(Object.keys(members).sort().map((key) => [key, canonical(members[key] as JsonValue)]));
  }
  return value;
}

/** A small deterministic generator, so the test never depends on the clock. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(rng: () => number, depth: number): JsonValue {
  const pick = rng();
  if (depth <= 0 || pick < 0.4) return [0, 1, 'a', 'b', true, false, null, 2.5][Math.floor(rng() * 8)] as JsonValue;
  const size = Math.floor(rng() * 4);
  if (pick < 0.7) return Array.from({ length: size }, () => generate(rng, depth - 1));
  return Object.fromEntries(Array.from({ length: size }, (_, i) => [`k${Math.floor(rng() * 5)}${i % 2}`, generate(rng, depth - 1)]));
}

function mutate(rng: () => number, value: JsonValue, depth: number): JsonValue {
  const pick = rng();
  if (pick < 0.15 || depth <= 0) return generate(rng, 2);
  if (Array.isArray(value)) {
    const next = value.map((item) => (rng() < 0.4 ? mutate(rng, item, depth - 1) : item));
    if (rng() < 0.3) next.splice(Math.floor(rng() * (next.length + 1)), 0, generate(rng, 1));
    if (rng() < 0.3 && next.length > 0) next.splice(Math.floor(rng() * next.length), 1);
    return next;
  }
  if (typeof value === 'object' && value !== null) {
    const members = value as { [key: string]: JsonValue };
    const next: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(members)) if (rng() > 0.2) next[key] = rng() < 0.4 ? mutate(rng, members[key] as JsonValue, depth - 1) : (members[key] as JsonValue);
    if (rng() < 0.4) next[`n${Math.floor(rng() * 4)}`] = generate(rng, 1);
    return next;
  }
  return rng() < 0.5 ? generate(rng, 1) : value;
}

test('applying the diff to the state before gives the state after, for 300 generated changes', () => {
  const rng = random(10);
  let nonEmpty = 0;
  for (let i = 0; i < 300; i += 1) {
    let before = generate(rng, 3);
    while (typeof before !== 'object' || before === null) before = generate(rng, 3);
    const after = mutate(rng, before, 3);
    const differences = diffStates(before, after);
    if (differences.length > 0) nonEmpty += 1;
    assert.ok(equal(applyDiff(before, differences), after), `case ${i}: ${JSON.stringify(before)} to ${JSON.stringify(after)}`);
    assert.equal(differences.length === 0, equal(before, after), `case ${i}: no differences exactly when the states are equal`);
  }
  assert.ok(nonEmpty > 150, 'the generator makes real changes');
});
