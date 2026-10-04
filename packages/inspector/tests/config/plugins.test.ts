// Spec 014 (FR-001 to FR-003): the optional `plugins` in config.json. An entry is a module address that must resolve to
// the page's own origin, so the reader is given the page and judges the resolved URL. Every rejected entry is dropped
// alone with one warning that names the field and the position and never repeats the value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, type Result } from '../../src/core/config/index.ts';

const PAGE = { origin: 'https://inspector.example', baseUrl: 'https://inspector.example/tools/inspector/' };
const AGENTS = [{ id: 'support', url: '/agents/support/stream' }];
const file = (plugins: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ version: 0, agents: AGENTS, ...(plugins !== undefined && { plugins }), ...extra });
function must<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error);
  return result.value;
}
const parse = (plugins: unknown, extra?: Record<string, unknown>, page = PAGE) => must(parseConfig(file(plugins, extra), page));

const ignored = (index: number, reason: string) => `plugins[${index}] ${reason}; it was ignored`;
const NOT_A_LIST = "plugins must be a list of module addresses on this page's origin; it was ignored";

test('no plugins: no field and no warning, and an empty list is the same', () => {
  for (const plugins of [undefined, []]) {
    const parsed = parse(plugins);
    assert.equal(parsed.plugins, undefined);
    assert.deepEqual(parsed.warnings, []);
    assert.deepEqual(parsed.agents, AGENTS);
  }
});

test('valid entries become resolved addresses in the order written, with a query and a fragment kept', () => {
  const parsed = parse(['plugins/a.js', '/static/b.js', 'https://inspector.example/c.js?v=3#x', '../up.js']);
  assert.deepEqual(parsed.plugins, [
    'https://inspector.example/tools/inspector/plugins/a.js',
    'https://inspector.example/static/b.js',
    'https://inspector.example/c.js?v=3#x',
    'https://inspector.example/tools/up.js',
  ]);
  assert.deepEqual(parsed.warnings, []);
});

test('entries are read against the page, not against anything else', () => {
  const elsewhere = { origin: 'http://127.0.0.1:4747', baseUrl: 'http://127.0.0.1:4747/' };
  assert.deepEqual(parse(['plugins/a.js'], undefined, elsewhere).plugins, ['http://127.0.0.1:4747/plugins/a.js']);
  assert.deepEqual(parse(['https://inspector.example/a.js'], undefined, elsewhere).plugins, undefined);
});

test('each rejected entry is one warning that names its position, and the other entries stay', () => {
  const rejected: Array<[unknown, string]> = [
    [7, 'must be a nonempty string'],
    [null, 'must be a nonempty string'],
    ['', 'must be a nonempty string'],
    ['   ', 'must be a nonempty string'],
    ['https://other.example/a.js', 'must be a path on this origin'],
    ['//other.example/a.js', 'must be a path on this origin'],
    ['http://inspector.example/a.js', 'must be a path on this origin'],
    ['https://inspector.example:8443/a.js', 'must be a path on this origin'],
    ['data:text/javascript,export default 1', 'must be a path on this origin'],
    ['blob:https://inspector.example/x', 'must be a path on this origin'],
    ['javascript:alert(1)', 'must be a path on this origin'],
    ['file:///a.js', 'must be a path on this origin'],
    ['https://user:pw@inspector.example/a.js', 'must not contain credentials (user:password@)'],
    ['http://[', 'is not a valid URL'],
    ['/\\other.example/a.js', 'must not contain a backslash or a control character'],
    ['a\\b.js', 'must not contain a backslash or a control character'],
    ['a\tb.js', 'must not contain a backslash or a control character'],
    ['a\nb.js', 'must not contain a backslash or a control character'],
    ['a\u0000b.js', 'must not contain a backslash or a control character'],
    ['a\u007fb.js', 'must not contain a backslash or a control character'],
  ];
  for (const [value, reason] of rejected) {
    const parsed = parse(['good.js', value, 'also-good.js']);
    assert.deepEqual(parsed.warnings, [ignored(1, reason)], JSON.stringify(value));
    assert.deepEqual(parsed.plugins, ['https://inspector.example/tools/inspector/good.js', 'https://inspector.example/tools/inspector/also-good.js'], JSON.stringify(value));
  }
});

test('plugins that is not a list is ignored with one warning', () => {
  for (const plugins of ['x.js', { 0: 'x.js' }, null, 7, true]) {
    const parsed = parse(plugins);
    assert.deepEqual(parsed.warnings, [NOT_A_LIST], JSON.stringify(plugins));
    assert.equal(parsed.plugins, undefined);
  }
});

test('a repeated address keeps the first and warns for each later entry', () => {
  const parsed = parse(['a.js', 'a.js', './a.js', '/tools/inspector/a.js', 'b.js']);
  assert.deepEqual(parsed.plugins, ['https://inspector.example/tools/inspector/a.js', 'https://inspector.example/tools/inspector/b.js']);
  assert.deepEqual(parsed.warnings, [1, 2, 3].map((index) => `plugins[${index}] repeats an earlier entry; it was ignored`));
});

test('no warning holds a rejected value', () => {
  const secret = 'synthetic-secret-7f3a91';
  const parsed = parse([`https://${secret}.example/a.js`, `${secret}\\x.js`, `https://user:${secret}@inspector.example/a.js`, `javascript:${secret}`, `//${secret}.example/a.js`]);
  assert.equal(parsed.warnings.length, 5);
  for (const warning of parsed.warnings) assert.ok(!warning.includes(secret), warning);
});

test('a bad plugins value changes nothing else, and its warnings come after the theme, brand and catalog alias ones', () => {
  const parsed = parse([7], {
    theme: { light: { '--agui-accent': 'url(https://other.example/x)' } },
    brand: { name: '   ' },
    catalogAliases: { 'old-id': 'not-bundled' },
  });
  assert.deepEqual(parsed.agents, AGENTS);
  assert.equal(parsed.plugins, undefined);
  const at = (text: string) => parsed.warnings.findIndex((warning) => warning.startsWith(text));
  assert.ok(at('theme.light') >= 0 && at('brand.name') > at('theme.light') && at('catalogAliases') > at('brand.name') && at('plugins[0]') > at('catalogAliases'), parsed.warnings.join('\n'));
  assert.equal(parsed.warnings.length, 4);
});

test('plugins is an allowed top-level key and an unknown one is still an error', () => {
  assert.equal(parseConfig(file(['a.js']), PAGE).ok, true);
  const unknown = parseConfig(file(['a.js'], { plugin: ['a.js'] }), PAGE);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.error, /unknown field "plugin"/);
});

test('a file with no page is read with a placeholder origin, where only a path can pass', () => {
  const parsed = must(parseConfig(file(['a.js', 'https://other.example/a.js'])));
  assert.equal(parsed.plugins?.length, 1);
  assert.equal(parsed.warnings.length, 1);
});
