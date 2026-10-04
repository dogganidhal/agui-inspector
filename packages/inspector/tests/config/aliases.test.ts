// The optional `catalogAliases` field of config.json (FR-013, FR-016): kept when valid, warned about and dropped
// entry by entry when not, and never a reason for the file to fail. Warning texts are the ones in
// specs/008-a2ui-v08-and-aliases/contracts/config-catalog-aliases.md.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../../src/core/config/index.ts';
import { BASIC_V09, STANDARD_V08 } from '../../src/core/a2ui/catalogs.ts';

const MIDDLEWARE = 'https://a2ui.org/specification/v0_9/basic_catalog.json';
const file = (catalogAliases: unknown) => JSON.stringify({ version: 0, agents: [{ id: 'support', url: '/agents/support/stream' }], catalogAliases });

/** The parsed config of a text that must load. */
function loaded(text: string) {
  const parsed = parseConfig(text);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.error);
  return (parsed as { ok: true; value: Extract<ReturnType<typeof parseConfig>, { ok: true }>['value'] }).value;
}

test('valid aliases of either version are kept and nothing is warned about', () => {
  const aliases = { 'https://catalog.invalid/old/basic.json': BASIC_V09, 'https://catalog.invalid/old/standard.json': STANDARD_V08 };
  const parsed = loaded(file(aliases));
  assert.deepEqual(parsed.catalogAliases, aliases);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.agents.map((agent) => agent.id), ['support']);
});

test('a file without the field, or with an empty one, has no catalogAliases', () => {
  const bare = loaded(JSON.stringify({ agents: [{ id: 'a', url: '/a' }] }));
  assert.equal('catalogAliases' in bare, false);
  const empty = loaded(file({}));
  assert.equal('catalogAliases' in empty, false);
  assert.deepEqual(empty.warnings, []);
});

test('each bad entry is a warning with its own text, and the file still loads with its agents', () => {
  const cases: [string, unknown, string][] = [
    ['an empty key', { '': BASIC_V09 }, 'catalogAliases: "" is not a catalog id; it was ignored'],
    ['a bundled id as a key', { [BASIC_V09]: STANDARD_V08 }, `catalogAliases: "${BASIC_V09}" is already a built-in catalog id; it was ignored`],
    ['the v0.8 id as a key', { [STANDARD_V08]: BASIC_V09 }, `catalogAliases: "${STANDARD_V08}" is already a built-in catalog id; it was ignored`],
    ['the built-in alias as a key', { [MIDDLEWARE]: STANDARD_V08 }, `catalogAliases: "${MIDDLEWARE}" is already a built-in catalog id; it was ignored`],
    ['a value that is not a string', { old: 3 }, 'catalogAliases: "old" must map to a catalog id (a string); it was ignored'],
    ['a value that is null', { old: null }, 'catalogAliases: "old" must map to a catalog id (a string); it was ignored'],
    ['a value that is not a bundled id', { old: 'https://catalog.invalid/new.json' }, 'catalogAliases: "old" maps to "https://catalog.invalid/new.json", which is not a catalog this inspector bundles; it was ignored'],
    ['a value that is another alias', { first: 'second', second: BASIC_V09 }, 'catalogAliases: "first" maps to "second", which is not a catalog this inspector bundles; it was ignored'],
    ['a value that is the built-in alias', { old: MIDDLEWARE }, `catalogAliases: "old" maps to "${MIDDLEWARE}", which is not a catalog this inspector bundles; it was ignored`],
  ];
  for (const [label, aliases, warning] of cases) {
    const parsed = loaded(file(aliases));
    assert.ok(parsed.warnings.includes(warning), `${label}: ${parsed.warnings.join(' | ')}`);
    assert.deepEqual(parsed.agents.map((agent) => agent.id), ['support'], label);
  }
});

test('a good entry next to a bad one is kept', () => {
  const parsed = loaded(file({ '': BASIC_V09, good: STANDARD_V08, old: 7 }));
  assert.deepEqual(parsed.catalogAliases, { good: STANDARD_V08 });
  assert.equal(parsed.warnings.length, 2);
});

test('a field that is not an object is one warning and is ignored', () => {
  for (const bad of [3, 'basic', null, true, [BASIC_V09], [{ old: BASIC_V09 }]]) {
    const parsed = loaded(file(bad));
    assert.equal('catalogAliases' in parsed, false, JSON.stringify(bad));
    assert.deepEqual(parsed.warnings, ['catalogAliases must be an object from a catalog id to a bundled catalog id; it was ignored'], JSON.stringify(bad));
  }
});

test('a long id in a warning is cut so a hostile file cannot flood the page, and a real id is not', () => {
  const long = `https://catalog.invalid/${'a'.repeat(200)}`;
  const [warning] = loaded(file({ [long]: 5 })).warnings;
  assert.ok(warning !== undefined && warning.length < 220, warning);
  assert.ok(warning?.includes('…'), warning);
  const [target] = loaded(file({ old: `${STANDARD_V08}x` })).warnings;
  assert.ok(target?.includes(`${STANDARD_V08}x`), 'the ids of the bundled catalogs show whole');
});

test('a key named __proto__ stays plain data and does not touch the prototype', () => {
  const parsed = loaded(`{"agents":[{"id":"a","url":"/a"}],"catalogAliases":{"__proto__":"${BASIC_V09}","other":"${STANDARD_V08}"}}`);
  assert.ok(Object.hasOwn(parsed.catalogAliases ?? {}, '__proto__'));
  assert.equal(Object.getPrototypeOf(parsed.catalogAliases), Object.prototype);
  assert.equal(({} as Record<string, unknown>)['other'], undefined);
});

test('the field is the only new key: an unknown top-level key still fails the file', () => {
  const parsed = parseConfig(JSON.stringify({ agents: [{ id: 'a', url: '/a' }], catalogAlias: {} }));
  assert.equal(parsed.ok, false);
});
