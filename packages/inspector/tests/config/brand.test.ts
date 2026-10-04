// Spec 003 (FR-001 to FR-008): the optional `brand` in config.json. A logo is accepted only when it resolves to
// the page's own origin or is a `data:` image, so the reader is given the page and judges the resolved URL.
// Every rejected field is dropped alone with one warning that names the field and never repeats the value.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, type Result } from '../../src/core/config/index.ts';

const PAGE = { origin: 'https://inspector.example', baseUrl: 'https://inspector.example/tools/inspector/' };
const AGENTS = [{ id: 'support', url: '/agents/support/stream' }];
const file = (brand: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ version: 0, agents: AGENTS, ...(brand !== undefined && { brand }), ...extra });
function must<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(result.error);
  return result.value;
}
const parse = (brand: unknown, extra?: Record<string, unknown>) => must(parseConfig(file(brand, extra), PAGE));

const SVG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>";
const ORIGIN_MESSAGE = 'brand.logo must be a path on this origin or a data:image URI; it was ignored';

test('no brand: no field and no warning', () => {
  const parsed = parse(undefined);
  assert.equal(parsed.brand, undefined);
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.agents, AGENTS);
});

test('valid shapes: a name only, a logo only, both, and with a dark logo', () => {
  for (const [brand, expected] of [
    [{ name: 'Acme Console' }, { name: 'Acme Console' }],
    [{ logo: '/static/acme.svg' }, { logo: 'https://inspector.example/static/acme.svg' }],
    [{ name: 'Acme', logo: '/a.svg' }, { name: 'Acme', logo: 'https://inspector.example/a.svg' }],
    [{ name: 'Acme', logo: '/a.svg', logoDark: '/b.svg' }, { name: 'Acme', logo: 'https://inspector.example/a.svg', logoDark: 'https://inspector.example/b.svg' }],
  ] as const) {
    const parsed = parse(brand);
    assert.deepEqual(parsed.brand, expected, JSON.stringify(brand));
    assert.deepEqual(parsed.warnings, [], JSON.stringify(brand));
  }
});

test('an empty brand is valid and changes nothing', () => {
  const parsed = parse({});
  assert.equal(parsed.brand, undefined);
  assert.deepEqual(parsed.warnings, []);
});

test('a logo may be a path, a full URL on the page origin, or a data image', () => {
  const accepted: Array<[string, string]> = [
    ['logo.svg', 'https://inspector.example/tools/inspector/logo.svg'],
    ['./logo.svg', 'https://inspector.example/tools/inspector/logo.svg'],
    ['../logo.svg', 'https://inspector.example/tools/logo.svg'],
    ['/static/logo.svg', 'https://inspector.example/static/logo.svg'],
    ['https://inspector.example/a.png?v=3#x', 'https://inspector.example/a.png?v=3#x'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ['DATA:IMAGE/PNG;base64,AAAA', 'data:IMAGE/PNG;base64,AAAA'],
  ];
  for (const [written, resolved] of accepted) {
    const parsed = parse({ logo: written });
    assert.deepEqual(parsed.brand, { logo: resolved }, written);
    assert.deepEqual(parsed.warnings, [], written);
  }
  assert.equal(parse({ logo: SVG }).brand?.logo, new URL(SVG).href);
});

test('a relative logo is read against the page, never against another file', () => {
  const parsed = must(parseConfig(file({ logo: 'logo.svg' }), { origin: 'https://inspector.example', baseUrl: 'https://inspector.example/' }));
  assert.equal(parsed.brand?.logo, 'https://inspector.example/logo.svg');
});

/** The same text can mean another origin once a URL parser strips tabs and newlines or reads a backslash as a slash. */
const OTHER_ORIGIN = [
  'https://other.example/l.png',
  'http://inspector.example/l.png',
  'https://inspector.example:8443/l.png',
  '//other.example/l.png',
  '/\\other.example/l.png',
  '\\\\other.example\\l.png',
  '/\t/other.example/l.png',
  '/\n/other.example/l.png',
  'jav\tascript:alert(1)',
  'javascript:alert(1)',
  'blob:https://inspector.example/0b1c',
  'file:///etc/logo.png',
  'ftp://inspector.example/l.png',
  'data:text/html,<p>hi</p>',
  'data:application/json,{}',
  'data:,image/png',
  ' data:text/html,x',
];

test('a logo on another origin, with another scheme or hidden behind URL parsing is rejected with one warning', () => {
  for (const logo of OTHER_ORIGIN) {
    const parsed = parse({ name: 'Acme', logo });
    assert.deepEqual(parsed.brand, { name: 'Acme' }, JSON.stringify(logo));
    assert.deepEqual(parsed.warnings, [ORIGIN_MESSAGE], JSON.stringify(logo));
    assert.deepEqual(parsed.agents, AGENTS, JSON.stringify(logo));
  }
});

test('a logo with credentials, or that is not a URL, or is not a nonempty string is rejected', () => {
  assert.deepEqual(parse({ logo: 'https://user:pw@inspector.example/l.png' }).warnings, ['brand.logo must not contain credentials (user:password@); it was ignored']);
  assert.deepEqual(parse({ logo: 'http://[' }).warnings, ['brand.logo is not a valid URL; it was ignored']);
  for (const logo of ['', 7, null, true, ['/a.svg'], { href: '/a.svg' }]) {
    const parsed = parse({ name: 'Acme', logo });
    assert.deepEqual(parsed.warnings, ['brand.logo must be a nonempty string; it was ignored'], JSON.stringify(logo));
    assert.deepEqual(parsed.brand, { name: 'Acme' });
  }
});

test('a dark logo follows the same rules and is kept only with a valid logo', () => {
  const kept = parse({ logo: '/a.svg', logoDark: 'https://other.example/b.svg' });
  assert.deepEqual(kept.brand, { logo: 'https://inspector.example/a.svg' });
  assert.deepEqual(kept.warnings, ['brand.logoDark must be a path on this origin or a data:image URI; it was ignored']);

  for (const brand of [{ logoDark: '/b.svg' }, { logo: 'https://other.example/a.svg', logoDark: '/b.svg' }]) {
    const parsed = parse({ name: 'Acme', ...brand });
    assert.deepEqual(parsed.brand, { name: 'Acme' }, JSON.stringify(brand));
    assert.equal(parsed.warnings.at(-1), 'brand.logoDark needs a valid brand.logo; it was ignored', JSON.stringify(brand));
  }
});

test('a name must be a string with a character that is not whitespace', () => {
  for (const name of ['', '   ', '\t\n', 7, null, ['Acme'], { text: 'Acme' }]) {
    const parsed = parse({ name, logo: '/a.svg' });
    assert.deepEqual(parsed.warnings, ['brand.name must be a nonempty string; it was ignored'], JSON.stringify(name));
    assert.deepEqual(parsed.brand, { logo: 'https://inspector.example/a.svg' });
  }
  assert.deepEqual(parse({ name: '<b>Acme</b>' }).brand, { name: '<b>Acme</b>' });
});

test('a brand that is not an object is ignored with one warning, and the agents still load', () => {
  for (const brand of [null, 'Acme', 7, true, [], [{ name: 'Acme' }]]) {
    const parsed = parse(brand);
    assert.equal(parsed.brand, undefined, JSON.stringify(brand));
    assert.deepEqual(parsed.warnings, ['brand must be an object with optional "name", "logo" and "logoDark"; it was ignored'], JSON.stringify(brand));
    assert.deepEqual(parsed.agents, AGENTS);
  }
});

test('an unknown field is one warning, and the valid fields stay', () => {
  const parsed = parse({ name: 'Acme', title: 'x', Logo: '/b.svg' });
  assert.deepEqual(parsed.brand, { name: 'Acme' });
  assert.deepEqual(parsed.warnings, [
    'brand: "title" is not a brand field (use "name", "logo" or "logoDark"); it was ignored',
    'brand: "Logo" is not a brand field (use "name", "logo" or "logoDark"); it was ignored',
  ]);
  const long = parse({ ['x'.repeat(100)]: 1 }).warnings.join('');
  assert.ok(long.includes(`"${'x'.repeat(48)}…"`) && !long.includes('x'.repeat(49)), 'the field name is shortened');
});

test('a warning never repeats the rejected value', () => {
  const secret = 'https://other.example/very-secret-path.png';
  const warnings = parse({ name: ' ', logo: secret, logoDark: secret }).warnings.join('\n');
  assert.ok(!warnings.includes('other.example') && !warnings.includes('very-secret-path'), warnings);
  const credentials = parse({ logo: 'https://admin:hunter2@inspector.example/l.png' }).warnings.join('\n');
  assert.ok(!credentials.includes('hunter2') && !credentials.includes('admin'), credentials);
});

test('theme warnings come first and the brand warnings follow, as name, logo, logoDark; the theme and the agents are unaffected', () => {
  const parsed = parse({ logo: 'https://other.example/a.png', name: '' }, { theme: { sepia: {}, light: { '--agui-radius': '2px' } } });
  assert.deepEqual(parsed.theme, { light: { '--agui-radius': '2px' } });
  assert.equal(parsed.warnings.length, 3);
  assert.match(parsed.warnings[0] ?? '', /^theme: "sepia"/);
  assert.match(parsed.warnings[1] ?? '', /^brand\.name /);
  assert.match(parsed.warnings[2] ?? '', /^brand\.logo /);
  assert.deepEqual(parsed.agents, AGENTS);
});

test('brand is an allowed top-level key and any other unknown key is still an error', () => {
  assert.equal(parseConfig(file({ name: 'Acme' }, { themes: {} }), PAGE).ok, false);
  assert.equal(parseConfig(file({ name: 'Acme' }), PAGE).ok, true);
});

test('without a page only a path or a data image is accepted, since only those cannot leave the page', () => {
  const bare = (brand: unknown) => must(parseConfig(file(brand)));
  assert.equal(bare({ logo: '/static/a.svg' }).brand?.logo?.endsWith('/static/a.svg'), true);
  assert.equal(bare({ logo: 'data:image/png;base64,AAAA' }).warnings.length, 0);
  assert.equal(bare({ logo: 'https://other.example/a.png' }).warnings.length, 1);
  assert.equal(bare({ logo: '//other.example/a.png' }).warnings.length, 1);
});
