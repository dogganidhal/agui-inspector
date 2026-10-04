// Spec 008 (FR-001 to FR-005, FR-012, FR-017): the session reads a list of both versions. v0.9 entries still
// become surface models. v0.8 entries are checked and handed on, in order, for the v0.8 renderer, and the
// received list is never altered. Drawing is in tests/e2e/a2ui/v08.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { A2uiAction, JsonValue } from '../../src/contracts.ts';
import { STANDARD_V08 } from '../../src/core/a2ui/catalogs.ts';
import { createSurfaceSession } from '../../src/core/a2ui/index.ts';
import { createBundledCatalogs } from '../../src/views/a2ui/catalog.tsx';
import { BASIC_CATALOG_ID, formSurface, mixedSurfaces, v08Surfaces } from '../../../../examples/reference-agent/a2ui-scenarios.ts';

const json = <T = JsonValue>(value: unknown): T => JSON.parse(JSON.stringify(value));

function session(aliases?: Record<string, string>) {
  const actions: A2uiAction[] = [];
  const host = createSurfaceSession<ReactComponentImplementation>({
    catalog: createBundledCatalogs,
    onAction: (action) => void actions.push(action),
    ...(aliases !== undefined && { aliases }),
  });
  return { host, actions };
}

const positions = (host: ReturnType<typeof session>['host']) => host.snapshot().v08.messages.map((entry) => entry.index);

test('v0.8 messages are accepted in order with their positions and are not v0.9 surfaces', () => {
  const { host } = session();
  host.apply(json(v08Surfaces));
  const { surfaces, issues, v08 } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(surfaces, [], 'the v0.8 renderer draws these, not the v0.9 models');
  assert.deepEqual(positions(host), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(v08.messages.map((entry) => entry.message), json(v08Surfaces));
});

test('a v0.8 message the strict schema refuses is reported at its position, as received, and the rest still apply', () => {
  const bad = [
    { surfaceUpdate: { surfaceId: 's', components: [] } },
    { beginRendering: { surfaceId: 's' } },
    { beginRendering: { surfaceId: 's', root: 'r' }, deleteSurface: { surfaceId: 's' } },
    { deleteSurface: { surfaceId: 's' }, extra: true },
    { dataModelUpdate: { surfaceId: 's' } },
  ];
  const { host } = session();
  const operations = json([v08Surfaces[0], ...bad, v08Surfaces[2]]) as JsonValue[];
  host.apply(operations);
  const { issues, v08 } = host.snapshot();
  assert.deepEqual(issues.map((issue) => issue.index), [1, 2, 3, 4, 5]);
  assert.match(issues[0]!.message, /^surfaceUpdate\.components: /);
  assert.match(issues[1]!.message, /^beginRendering\.root: /);
  assert.equal(issues[2]!.message, 'A2UI Protocol message must have exactly one of: surfaceUpdate, dataModelUpdate, beginRendering, deleteSurface.');
  assert.match(issues[3]!.message, /Unrecognized key/);
  assert.match(issues[4]!.message, /^dataModelUpdate\.contents: /);
  assert.ok(issues.every((issue, at) => issue.source === 'operation' && issue.operation === operations[at + 1]), 'each issue holds the very entry received');
  assert.deepEqual(v08.messages.map((entry) => entry.index), [0, 6], 'the valid messages around them are kept');
});

test('a v0.8 message that names no catalog, the standard one or an alias is accepted', () => {
  const begin = (catalogId?: string) => ({ beginRendering: { surfaceId: 's', root: 'r', ...(catalogId !== undefined && { catalogId }) } });
  const aliased = session({ 'https://catalog.invalid/old/standard.json': STANDARD_V08 });
  aliased.host.apply(json([begin(), begin(STANDARD_V08), begin('https://catalog.invalid/old/standard.json')]));
  assert.deepEqual(aliased.host.snapshot().issues, []);
  assert.deepEqual(positions(aliased.host), [0, 1, 2]);
});

test('a v0.8 catalog id that is not known is "Catalog not found" with the entry as received, and the message is not handed on', () => {
  for (const id of ['https://catalog.invalid/custom.json', `${STANDARD_V08}/`, STANDARD_V08.toUpperCase(), BASIC_CATALOG_ID, 'https://a2ui.org/specification/v0_9/basic_catalog.json']) {
    const { host } = session({ 'https://catalog.invalid/old/basic.json': BASIC_CATALOG_ID });
    const operations = json([{ beginRendering: { surfaceId: 's', catalogId: id, root: 'r' } }]) as JsonValue[];
    host.apply(operations);
    const [issue] = host.snapshot().issues;
    assert.equal(issue?.message, `Catalog not found: ${id}`, id);
    assert.equal(issue?.operation, operations[0], id);
    assert.deepEqual(positions(host), [], id);
  }
});

test('an alias of the v0.9 catalog is not a v0.8 catalog, and an alias of the v0.8 one is not a v0.9 catalog', () => {
  const aliases = { 'https://catalog.invalid/old/basic.json': BASIC_CATALOG_ID, 'https://catalog.invalid/old/standard.json': STANDARD_V08 };
  const { host } = session(aliases);
  host.apply(json([
    { beginRendering: { surfaceId: 'a', catalogId: 'https://catalog.invalid/old/basic.json', root: 'r' } },
    { version: 'v0.9', createSurface: { surfaceId: 'b', catalogId: 'https://catalog.invalid/old/standard.json' } },
  ]));
  assert.deepEqual(host.snapshot().issues.map((issue) => issue.message), [
    'Catalog not found: https://catalog.invalid/old/basic.json',
    'Catalog not found: https://catalog.invalid/old/standard.json',
  ]);
});

test('surfaces are ordered by when the list first names them, across versions, and one id in two versions is two surfaces', () => {
  const { host } = session();
  host.apply(json(mixedSurfaces));
  const { surfaces, issues, order, v08 } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(order, ['v0.9:nine', 'v0.8:eight', 'v0.9:same', 'v0.8:same']);
  assert.deepEqual(surfaces.map((surface) => surface.id), ['nine', 'same']);
  assert.deepEqual(v08.messages.map((entry) => entry.index), [2, 3, 6, 7], 'positions count the v0.9 entries between them');
});

test('two bad entries in a mixed list are exactly two issues with their positions, and every valid surface is kept', () => {
  const { host } = session();
  host.apply(json([...mixedSurfaces.slice(0, 4), 'text', { version: 'v0.8', beginRendering: { surfaceId: 'x', root: 'r' } }, ...mixedSurfaces.slice(4)]));
  const { issues, surfaces, v08 } = host.snapshot();
  assert.deepEqual(issues.map((issue) => issue.index), [4, 5]);
  assert.equal(issues[0]!.message, 'This operation is not an object.');
  assert.match(issues[1]!.message, /^This operation declares version v0\.8\./);
  assert.deepEqual(surfaces.map((surface) => surface.id), ['nine', 'same']);
  assert.equal(v08.messages.length, 4);
});

test('an unchanged v0.8 list does nothing and notifies nobody', () => {
  const { host } = session();
  host.apply(json(v08Surfaces));
  const snapshot = host.snapshot();
  let notified = 0;
  host.subscribe(() => void notified++);
  host.apply(json(v08Surfaces));
  assert.equal(host.snapshot(), snapshot);
  assert.equal(notified, 0);
});

test('an appended v0.8 tail adds only its messages, with positions that continue, in the same epoch', () => {
  const { host } = session();
  host.apply(json(v08Surfaces.slice(0, 3)));
  const { epoch } = host.snapshot().v08;
  host.apply(json(v08Surfaces));
  const { v08 } = host.snapshot();
  assert.equal(v08.epoch, epoch, 'nothing was rebuilt');
  assert.deepEqual(v08.messages.map((entry) => entry.index), [0, 1, 2, 3, 4, 5]);
});

test('a rewritten earlier message starts a new epoch with the list as it now stands', () => {
  const { host } = session();
  host.apply(json(v08Surfaces));
  const { epoch } = host.snapshot().v08;
  const rewritten = json(v08Surfaces) as Array<{ dataModelUpdate?: { contents: Array<{ valueString?: string }> } }>;
  rewritten[1]!.dataModelUpdate!.contents[0]!.valueString = '99';
  host.apply(rewritten as JsonValue);
  const { v08 } = host.snapshot();
  assert.equal(v08.epoch, epoch + 1);
  assert.equal(v08.messages.length, 6, 'replayed once, not added to the old ones');
  assert.match(JSON.stringify(v08.messages[1]), /"99"/);
});

test('a list that is not a list releases the v0.8 messages too', () => {
  const { host } = session();
  host.apply(json(v08Surfaces));
  host.apply('text' as JsonValue);
  assert.deepEqual(host.snapshot().v08.messages, []);
  assert.deepEqual(host.snapshot().order, []);
  assert.equal(host.snapshot().issues.length, 1);
});

test('the renderer can report a message it refused, and the issue holds the entry at its position', () => {
  const { host } = session();
  const operations = json(v08Surfaces) as JsonValue[];
  host.apply(operations);
  let notified = 0;
  host.subscribe(() => void notified++);
  host.refused(3, operations[3]!, new Error('Circular dependency for component "root".'));
  const [issue] = host.snapshot().issues;
  assert.equal(notified, 1);
  assert.deepEqual([issue?.source, issue?.index, issue?.message], ['operation', 3, 'Circular dependency for component "root".']);
  assert.equal(issue?.operation, operations[3]);
});

test('the received v0.8 list is never altered, and the fed messages are the entries themselves for the renderer to copy', () => {
  const { host } = session();
  const operations = json(v08Surfaces) as JsonValue[];
  const received = json(operations);
  host.apply(operations);
  host.apply([...operations, { dataModelUpdate: { surfaceId: 'status', contents: [{ key: 'status', valueString: 'later' }] } }]);
  assert.deepEqual(operations, received);
});

test('v0.9 and v0.8 entries interleave without disturbing each other', () => {
  const { host } = session();
  host.apply(json([...formSurface.slice(0, 2), v08Surfaces[0], formSurface[2], v08Surfaces[1], v08Surfaces[2]]));
  const { surfaces, issues, v08 } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(surfaces.map((surface) => surface.id), ['form']);
  assert.deepEqual(v08.messages.map((entry) => entry.index), [2, 4, 5]);
});

test('a list of 200 v0.8 messages is applied in one pass and heard once', () => {
  const messages = Array.from({ length: 200 }, (_, at) => ({ dataModelUpdate: { surfaceId: 's', contents: [{ key: `k${at}`, valueString: `${at}` }] } }));
  const { host } = session();
  let notified = 0;
  host.subscribe(() => void notified++);
  const started = performance.now();
  host.apply(json(messages));
  assert.equal(notified, 1);
  assert.equal(host.snapshot().v08.messages.length, 200);
  assert.ok(performance.now() - started < 1000, 'no quadratic work');
});
