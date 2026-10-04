// FR-001, FR-002: the version of each entry is read from the entry, and an entry that is neither v0.8 nor
// v0.9 is refused at its position with the entry as received. The texts are the ones in
// specs/008-a2ui-v08-and-aliases/contracts/a2ui-operations.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JsonValue } from '../../src/contracts.ts';
import { classify, surfaceKey } from '../../src/core/a2ui/operations.ts';

const NOT_AN_OBJECT = 'This operation is not an object.';
const NO_VERSION = 'This operation has no version and no v0.8 message name. A2UI v0.9 operations declare "version": "v0.9".';
const declares = (value: string) => `This operation declares version ${value}. A2UI v0.9 operations declare "v0.9", and v0.8 messages have no version.`;

const sorted = (operations: JsonValue[], offset?: number) => {
  const { entries, refused } = classify(operations, offset);
  return { versions: entries.map((entry) => `${entry.index}:${entry.version}`), refused: refused.map((issue) => [issue.index, issue.message]) };
};

test('an object that declares v0.9 is v0.9, whatever it holds', () => {
  const { versions, refused } = sorted([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'c' } },
    { version: 'v0.9', deleteSurface: { surfaceId: 's' } },
    { version: 'v0.9', nonsense: true },
  ]);
  assert.deepEqual(versions, ['0:v0.9', '1:v0.9', '2:v0.9']);
  assert.deepEqual(refused, []);
});

test('an object with no version and a v0.8 message name is v0.8', () => {
  const { versions, refused } = sorted([
    { beginRendering: { surfaceId: 's', root: 'r' } },
    { surfaceUpdate: { surfaceId: 's', components: [] } },
    { dataModelUpdate: { surfaceId: 's', contents: [] } },
    { deleteSurface: { surfaceId: 's' } },
  ]);
  assert.deepEqual(versions, ['0:v0.8', '1:v0.8', '2:v0.8', '3:v0.8']);
  assert.deepEqual(refused, []);
});

test('deleteSurface is in both versions and the version key decides', () => {
  const { versions } = sorted([{ deleteSurface: { surfaceId: 's' } }, { version: 'v0.9', deleteSurface: { surfaceId: 's' } }]);
  assert.deepEqual(versions, ['0:v0.8', '1:v0.9']);
});

test('a message with two v0.8 kinds, or a v0.8 name and a v0.9 name, is still v0.8: the v0.8 check refuses it', () => {
  const { versions } = sorted([
    { beginRendering: { surfaceId: 's', root: 'r' }, surfaceUpdate: { surfaceId: 's', components: [] } },
    { beginRendering: { surfaceId: 's', root: 'r' }, createSurface: { surfaceId: 's', catalogId: 'c' } },
  ]);
  assert.deepEqual(versions, ['0:v0.8', '1:v0.8']);
});

test('three refusals, each with its own text and its position', () => {
  const { versions, refused } = sorted([
    'text',
    { createSurface: { surfaceId: 's', catalogId: 'c' } },
    { version: 'v0.8', beginRendering: { surfaceId: 's', root: 'r' } },
    { version: 'v0.10', createSurface: {} },
    { version: 9 },
    { version: null },
    [],
    null,
    {},
  ]);
  assert.deepEqual(versions, []);
  assert.deepEqual(refused, [
    [0, NOT_AN_OBJECT],
    [1, NO_VERSION],
    [2, declares('v0.8')],
    [3, declares('v0.10')],
    [4, declares('9')],
    [5, declares('null')],
    [6, NOT_AN_OBJECT],
    [7, NOT_AN_OBJECT],
    [8, NO_VERSION],
  ]);
});

test('a refusal carries the entry as received', () => {
  const entry = { version: 'v0.8', beginRendering: { surfaceId: 's', root: 'r' } };
  const { refused } = classify([entry]);
  assert.equal(refused[0]?.source, 'operation');
  assert.equal(refused[0]?.operation, entry, 'the very object, not a copy');
});

test('a hostile declared version is cut', () => {
  const { refused } = classify([{ version: 'v'.repeat(500) }]);
  assert.ok((refused[0]?.message.length ?? 0) < 200);
  assert.ok(refused[0]?.message.includes('…'));
});

test('positions continue from an offset', () => {
  assert.deepEqual(sorted([{ version: 'v0.9' }, 'x', { surfaceUpdate: {} }], 4), { versions: ['4:v0.9', '6:v0.8'], refused: [[5, NOT_AN_OBJECT]] });
});

test('surfaceKey names the version and the surface id of every message kind', () => {
  const key = (operation: JsonValue) => {
    const [entry] = classify([operation]).entries;
    return entry === undefined ? 'refused' : surfaceKey(entry);
  };
  assert.equal(key({ version: 'v0.9', createSurface: { surfaceId: 'a', catalogId: 'c' } }), 'v0.9:a');
  assert.equal(key({ version: 'v0.9', updateComponents: { surfaceId: 'b', components: [] } }), 'v0.9:b');
  assert.equal(key({ version: 'v0.9', updateDataModel: { surfaceId: 'c' } }), 'v0.9:c');
  assert.equal(key({ version: 'v0.9', deleteSurface: { surfaceId: 'd' } }), 'v0.9:d');
  assert.equal(key({ beginRendering: { surfaceId: 'e', root: 'r' } }), 'v0.8:e');
  assert.equal(key({ surfaceUpdate: { surfaceId: 'f', components: [] } }), 'v0.8:f');
  assert.equal(key({ dataModelUpdate: { surfaceId: 'g' } }), 'v0.8:g');
  assert.equal(key({ deleteSurface: { surfaceId: 'h' } }), 'v0.8:h');
});

test('the same surface id in two versions gives two keys', () => {
  const [v08, v09] = classify([{ surfaceUpdate: { surfaceId: 'same', components: [] } }, { version: 'v0.9', createSurface: { surfaceId: 'same', catalogId: 'c' } }]).entries;
  assert.notEqual(surfaceKey(v08!), surfaceKey(v09!));
});

test('a shape that names no surface has no key', () => {
  const key = (operation: JsonValue) => surfaceKey(classify([operation]).entries[0]!);
  assert.equal(key({ version: 'v0.9', createSurface: { surfaceId: 5 } }), undefined);
  assert.equal(key({ version: 'v0.9', createSurface: 'x' }), undefined);
  assert.equal(key({ version: 'v0.9', other: { surfaceId: 's' } }), undefined);
  assert.equal(key({ beginRendering: null }), undefined);
});
