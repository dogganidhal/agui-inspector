// The catalog id table (FR-011, FR-014, FR-015): the two bundled catalogs, the one built-in alias and a
// config's aliases, all read the same way. The warnings for a bad config alias are in tests/config/aliases.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basicCatalog } from '@a2ui/react/v0_9';
import { A2uiMessageSchema } from '@a2ui/web_core/v0_8';
import { BASIC_V09, BUILT_IN_ALIASES, KNOWN_CATALOGS, STANDARD_V08, catalogIds, isBuiltIn, resolves } from '../../src/core/a2ui/catalogs.ts';

const MIDDLEWARE = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

test('the two literals are the ids the renderer packages name', () => {
  assert.equal(BASIC_V09, basicCatalog.id);
  // The v0.8 schema describes the default for a surface that names no catalog.
  const description = A2uiMessageSchema.innerType().shape.beginRendering.unwrap().shape.catalogId.description ?? '';
  assert.ok(description.includes(`(${STANDARD_V08})`), description);
});

test('the table knows two catalogs and one built-in alias, each for one version', () => {
  assert.deepEqual(KNOWN_CATALOGS, { [BASIC_V09]: 'v0.9', [STANDARD_V08]: 'v0.8' });
  assert.deepEqual(BUILT_IN_ALIASES, { [MIDDLEWARE]: BASIC_V09 });
  for (const id of [BASIC_V09, STANDARD_V08, MIDDLEWARE]) assert.equal(isBuiltIn(id), true, id);
  assert.equal(isBuiltIn('https://catalog.invalid/custom.json'), false);
});

test('with no config the v0.9 ids are the basic id and the middleware default, and v0.8 has its standard id', () => {
  assert.deepEqual(catalogIds('v0.9'), [BASIC_V09, MIDDLEWARE]);
  assert.deepEqual(catalogIds('v0.8'), [STANDARD_V08]);
  assert.equal(resolves('v0.9', MIDDLEWARE), true, 'the middleware default is a row of the table, not a rule');
  assert.equal(resolves('v0.8', MIDDLEWARE), false);
});

test('a configured alias serves the version of its target and no other', () => {
  const configured = { 'https://catalog.invalid/old/basic.json': BASIC_V09, 'https://catalog.invalid/old/standard.json': STANDARD_V08 };
  assert.deepEqual(catalogIds('v0.9', configured), [BASIC_V09, MIDDLEWARE, 'https://catalog.invalid/old/basic.json']);
  assert.deepEqual(catalogIds('v0.8', configured), [STANDARD_V08, 'https://catalog.invalid/old/standard.json']);
  assert.equal(resolves('v0.9', 'https://catalog.invalid/old/basic.json', configured), true);
  assert.equal(resolves('v0.8', 'https://catalog.invalid/old/basic.json', configured), false, 'an alias of the v0.9 catalog is not a v0.8 catalog');
  assert.equal(resolves('v0.9', 'https://catalog.invalid/old/standard.json', configured), false);
});

test('matching is exact: a slash, another scheme or another case is not an alias', () => {
  const configured = { 'https://catalog.invalid/old/basic.json': BASIC_V09 };
  for (const near of ['https://catalog.invalid/old/basic.json/', 'http://catalog.invalid/old/basic.json', 'https://CATALOG.invalid/old/basic.json', `${BASIC_V09}/`, ` ${MIDDLEWARE}`]) {
    assert.equal(resolves('v0.9', near, configured), false, near);
  }
});

test('an alias never chains and a target that is no known catalog never resolves', () => {
  const configured = { first: 'second', second: BASIC_V09, third: 'not-a-catalog', [MIDDLEWARE]: STANDARD_V08 };
  assert.equal(resolves('v0.9', 'first', configured), false, 'first maps to another alias');
  assert.equal(resolves('v0.9', 'second', configured), true);
  assert.equal(resolves('v0.9', 'third', configured), false);
  assert.equal(resolves('v0.8', MIDDLEWARE, configured), false, 'a built-in alias keeps its own target');
  assert.equal(resolves('v0.9', MIDDLEWARE, configured), true);
});

test('names that are properties of Object.prototype are not ids', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(resolves('v0.9', name, {}), false, name);
    assert.equal(resolves('v0.9', name), false, name);
    assert.equal(isBuiltIn(name), false, name);
  }
  const configured = Object.fromEntries([['__proto__', BASIC_V09]]);
  assert.equal(resolves('v0.9', '__proto__', configured), true, 'an own property named __proto__ is data');
  assert.deepEqual(catalogIds('v0.9', configured), [BASIC_V09, MIDDLEWARE, '__proto__']);
});
