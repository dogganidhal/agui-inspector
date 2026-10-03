// FX11 (FR-020; US3.4): the A2UI basic catalog, audited without a browser. The gallery fixture applies
// cleanly and uses all 18 components; the basic functions the demo needs produce the documented output
// through the real binder; and the CheckRule shape the pinned renderer accepts is the one the A2UI docs page
// states. What the components look like and how they behave is in tests/e2e/a2ui/components.spec.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { basicCatalog } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { ComponentContext, GenericBinder, MessageProcessor } from '@a2ui/web_core/v0_9';
import type { JsonValue } from '../../src/contracts.ts';
import { createSurfaceSession } from '../../src/core/a2ui/index.ts';
import { createBundledCatalog } from '../../src/views/a2ui/catalog.tsx';
import { COMPONENTS } from '../../src/views/a2ui/components.tsx';
import { BASIC_CATALOG_ID, galleryOperations, type Operation } from './gallery.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
const V = 'v0.9';

test('the gallery applies without a single issue and uses every one of the 18 basic components', () => {
  const host = createSurfaceSession<ReactComponentImplementation>({ catalog: createBundledCatalog, onAction: () => undefined });
  host.apply(json(galleryOperations));
  const { surfaces, issues } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(surfaces.map((surface) => surface.id), ['layout', 'inputs', 'functions']);
  const used = new Set(surfaces.flatMap((surface) => [...surface.componentsModel.entries].map(([, component]) => component.type)));
  assert.deepEqual([...used].sort(), [...basicCatalog.components.keys()].sort());
});

test('the inspector draws some components itself and keeps every official name, schema and the blocked media', () => {
  const bundled = createBundledCatalog(() => undefined);
  assert.deepEqual([...bundled.components.keys()], [...basicCatalog.components.keys()]);
  for (const name of Object.keys(COMPONENTS)) {
    const own = bundled.components.get(name)!;
    const official = basicCatalog.components.get(name)!;
    assert.notEqual(own, official, `${name} is the inspector's`);
    assert.equal(own.schema, official.schema, `${name} keeps the official schema, so operations apply unchanged`);
  }
  for (const name of ['Image', 'Video', 'AudioPlayer']) assert.notEqual(bundled.components.get(name), basicCatalog.components.get(name), `${name} stays blocked`);
  for (const name of ['Text', 'Column', 'Card', 'List', 'CheckBox', 'Slider', 'DateTimeInput']) assert.equal(bundled.components.get(name), basicCatalog.components.get(name), `${name} is the official one`);
});

/** The props the real binder resolves for one component of a one-surface list. */
function resolved(components: readonly Operation[], data: Record<string, unknown>, id = 'root') {
  const processor = new MessageProcessor<ReactComponentImplementation>([basicCatalog], () => undefined);
  const issues: string[] = [];
  try {
    processor.processMessages([
      { version: V, createSurface: { surfaceId: 's', catalogId: BASIC_CATALOG_ID } },
      { version: V, updateComponents: { surfaceId: 's', components } },
      { version: V, updateDataModel: { surfaceId: 's', value: data } },
    ] as never);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  const surface = [...processor.getSurfaces().values()][0]!;
  if (surface.componentsModel.get(id) === undefined) return { props: undefined, issues };
  const type = surface.componentsModel.get(id)!.type;
  const binder = new GenericBinder(new ComponentContext(surface, id, '/'), basicCatalog.components.get(type)!.schema);
  const props = binder.snapshot as Record<string, unknown>;
  binder.dispose();
  return { props, issues };
}

const text = (value: unknown, data: Record<string, unknown> = {}) => resolved([{ id: 'root', component: 'Text', text: value }], data).props?.['text'];
const call = (name: string, args: Record<string, unknown>) => ({ call: name, args, returnType: 'string' });

test('formatString, formatNumber, formatCurrency, formatDate and pluralize give the documented output', () => {
  const data = { name: 'Ada', total: 1234.5, when: '2026-10-03T23:30:00Z', none: 0, one: 1, many: 3 };
  assert.equal(text(call('formatString', { value: 'Hello ${/name}' }), data), 'Hello Ada');
  assert.equal(text(call('formatNumber', { value: { path: '/total' }, decimals: 2 }), data), '1,234.50');
  assert.equal(text(call('formatNumber', { value: { path: '/total' }, decimals: 0, grouping: false }), data), '1235');
  assert.equal(text(call('formatCurrency', { value: { path: '/total' }, currency: 'USD' }), data), '$1,234.50');
  assert.equal(text(call('formatCurrency', { value: { path: '/total' }, currency: 'EUR', decimals: 0 }), data), '€1,235');
  assert.equal(text(call('formatDate', { value: { path: '/when' }, format: 'EEEE, MMMM d, yyyy' }), data), 'Saturday, October 3, 2026');
  assert.equal(text(call('formatDate', { value: { path: '/when' }, format: 'yyyy-MM-dd HH:mm' }), data), '2026-10-03 23:30', 'dates are formatted in UTC');
  assert.equal(text(call('formatDate', { value: { path: '/when' }, format: 'h:mm a' }), data), '11:30 PM');
  const plural = (count: string) => call('pluralize', { value: { path: count }, zero: 'No seats', one: 'One seat', other: 'Some seats' });
  assert.deepEqual([text(plural('/none'), data), text(plural('/one'), data), text(plural('/many'), data)], ['No seats', 'One seat', 'Some seats']);
});

test('pluralize and formatString compose: the count goes in through formatString, not through pluralize arguments', () => {
  const data = { n: 3 };
  // pluralize arguments are plain strings: a ${...} in them is NOT interpolated.
  assert.equal(text(call('pluralize', { value: { path: '/n' }, one: '${/n} seat', other: '${/n} seats' }), data), '${/n} seats');
  // Wrapped in formatString, or called inside one, it is.
  assert.equal(text(call('pluralize', { value: { path: '/n' }, one: call('formatString', { value: '${/n} seat' }), other: call('formatString', { value: '${/n} seats' }) }), data), '3 seats');
  assert.equal(text(call('formatString', { value: "${/n} ${pluralize(value: ${/n}, one: 'seat', other: 'seats')}" }), data), '3 seats');
  assert.equal(text(call('formatString', { value: "Total ${formatCurrency(value: ${/n}, currency: 'USD')} on ${formatDate(value: '2026-10-03T00:00:00Z', format: 'MMM d')}" }), data), 'Total $3.00 on Oct 3');
});

/** What a Button reports for one rule: valid or not, and the messages that failed. */
function check(rule: unknown, data: Record<string, unknown>) {
  const { props, issues } = resolved(
    [
      { id: 'label', component: 'Text', text: 'go' },
      { id: 'root', component: 'Button', child: 'label', checks: [rule], action: { event: { name: 'go' } } },
    ],
    data,
  );
  return { issues, valid: props?.['isValid'], errors: props?.['validationErrors'] };
}

const rule = (condition: unknown) => ({ condition, message: 'no' });
const fn = (name: string, args: Record<string, unknown>) => ({ call: name, args });
const at = (pointer: string) => ({ path: pointer });

test('a check is valid when its condition is true; a failing one disables the button with its message', () => {
  const data = { a: 'ada@lovelace.dev', bad: 'ada@', blank: '', code: 'AB12', yes: true, no: false, n: 3 };
  const cases: Array<[string, unknown, boolean]> = [
    ['required, filled', fn('required', { value: at('/a') }), true],
    ['required, empty string', fn('required', { value: at('/blank') }), false],
    ['required, missing path', fn('required', { value: at('/missing') }), false],
    ['email, valid', fn('email', { value: at('/a') }), true],
    ['email, invalid', fn('email', { value: at('/bad') }), false],
    ['length, inside', fn('length', { value: at('/code'), min: 2, max: 5 }), true],
    ['length, too short', fn('length', { value: at('/code'), min: 5 }), false],
    ['length, too long', fn('length', { value: at('/code'), max: 3 }), false],
    ['regex, match', fn('regex', { value: at('/code'), pattern: '^[A-Z]+[0-9]+$' }), true],
    ['regex, no match', fn('regex', { value: at('/a'), pattern: '^[0-9]+$' }), false],
    ['numeric, inside', fn('numeric', { value: at('/n'), min: 1, max: 5 }), true],
    ['and, all true', fn('and', { values: [at('/yes'), fn('required', { value: at('/a') })] }), true],
    ['and, one false', fn('and', { values: [at('/no'), at('/yes')] }), false],
    ['or, one true', fn('or', { values: [at('/no'), at('/yes')] }), true],
    ['or, none true', fn('or', { values: [at('/no'), fn('email', { value: at('/bad') })] }), false],
    ['not, of false', fn('not', { value: at('/no') }), true],
    ['not, of true', fn('not', { value: at('/yes') }), false],
    ['a boolean literal', false, false],
    ['a path bound to a boolean', at('/yes'), true],
  ];
  for (const [label, condition, expected] of cases) {
    const result = check(rule(condition), data);
    assert.deepEqual(result.issues, [], label);
    assert.equal(result.valid, expected, label);
    assert.deepEqual(result.errors, expected ? [] : ['no'], label);
  }
});

test('the CheckRule shape is { condition, message } and nothing else: a bare call, a call beside a message or a missing message is rejected', () => {
  const bare = fn('required', { value: at('/a') });
  for (const [label, shape] of [
    ['a bare function call', bare],
    ['a call with a sibling message', { ...bare, message: 'no' }],
    ['a condition without a message', { condition: bare }],
    ['an unknown extra key', { condition: bare, message: 'no', severity: 'warn' }],
  ] as const) {
    const result = check(shape, { a: 'x' });
    assert.equal(result.issues.length, 1, `${label} is refused when the components are applied`);
    assert.match(result.issues[0]!, /Validation failed for component 'Button' \(root\): checks\.0[.:]/, label);
  }
  assert.deepEqual(check(rule(bare), { a: 'x' }).issues, []);
});

test('the A2UI page states the CheckRule shape and the function notes the audit settled', () => {
  const doc = readFileSync(path.join(process.cwd(), 'website', 'content', 'docs', 'a2ui.mdx'), 'utf8');
  for (const name of ['CheckRule', 'condition', 'message', 'formatString', 'formatNumber', 'formatCurrency', 'formatDate', 'pluralize', 'required', 'email', 'length', 'regex', 'and', 'or', 'not', 'building', 'retrying', 'failed']) {
    assert.ok(doc.includes(name), `${name} is documented`);
  }
});
