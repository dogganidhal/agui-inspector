// D03 T063 (FR-020, FR-025, FR-037; US3.4): the bundled catalog answers to exactly two ids, the
// renderer's basic catalog id and middleware 0.0.11's default one, and to no other. Both are driven
// through the real renderer models and action callback with no fetch and no change to the operations.
// Drawing in a browser is in tests/e2e/a2ui/surfaces.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basicCatalog } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { ComponentContext } from '@a2ui/web_core/v0_9';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { A2uiAction, JsonValue } from '../../src/contracts.ts';
import { STANDARD_V08 } from '../../src/core/a2ui/catalogs.ts';
import { createSurfaceSession } from '../../src/core/a2ui/index.ts';
import { parseConfig } from '../../src/core/config/index.ts';
import { createBundledCatalog, createBundledCatalogs } from '../../src/views/a2ui/catalog.tsx';
import {
  BASIC_CATALOG_ID,
  formSurface,
  THIRD_PARTY_HOST,
} from '../../../../examples/reference-agent/a2ui-scenarios.ts';

const MIDDLEWARE_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));

/** The same scenario, addressed to another catalog id. Only the id differs. */
const withCatalog = (operations: readonly Record<string, unknown>[], catalogId: string) =>
  operations.map((operation) => {
    const { createSurface } = operation as { createSurface?: Record<string, unknown> };
    return createSurface === undefined ? operation : { ...operation, createSurface: { ...createSurface, catalogId } };
  });

function session(aliases?: Record<string, string>) {
  const actions: A2uiAction[] = [];
  const host = createSurfaceSession<ReactComponentImplementation>({
    catalog: createBundledCatalogs,
    onAction: (action) => void actions.push(action),
    ...(aliases !== undefined && { aliases }),
  });
  return { host, actions };
}

/** Any network use during a test is a failure. */
function noFetch<T>(run: () => T): T {
  const globals = globalThis as { fetch?: unknown };
  const saved = globals.fetch;
  globals.fetch = () => {
    throw new Error('the catalog must not fetch');
  };
  try {
    return run();
  } finally {
    globals.fetch = saved;
  }
}

test('the two ids are the renderer basic catalog and the middleware default, nothing else', () => {
  assert.equal(BASIC_CATALOG_ID, 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json');
  const catalogs = createBundledCatalogs(() => undefined);
  assert.deepEqual(catalogs.map((catalog) => catalog.id), [basicCatalog.id, MIDDLEWARE_CATALOG_ID]);
  assert.equal(createBundledCatalog(() => undefined).id, basicCatalog.id, 'the single-catalog factory is unchanged');
});

test('the alias is the same guarded catalog under the middleware id', () => {
  const reports: Array<{ kind: string; url: string }> = [];
  const [basic, alias] = createBundledCatalogs((blocked) => void reports.push(blocked)) as [ReturnType<typeof createBundledCatalog>, ReturnType<typeof createBundledCatalog>];
  assert.equal(alias.protocolVersion, basic.protocolVersion);
  assert.deepEqual([...alias.components.keys()], [...basic.components.keys()]);
  assert.deepEqual([...alias.functions.keys()], [...basic.functions.keys()]);
  for (const [name, component] of basic.components) assert.equal(alias.components.get(name), component, `${name} is shared`);
  for (const [name, fn] of basic.functions) assert.equal(alias.functions.get(name), fn, `${name} is shared`);
  // The guard sits on the alias too: its openUrl reports instead of opening.
  alias.functions.get('openUrl')!.execute({ url: `http://${THIRD_PARTY_HOST}/page` }, undefined as never);
  assert.deepEqual(reports, [{ kind: 'openUrl', url: `http://${THIRD_PARTY_HOST}/page` }]);
});

for (const [label, catalogId] of [['renderer basic catalog id', BASIC_CATALOG_ID], ['middleware 0.0.11 default catalog id', MIDDLEWARE_CATALOG_ID]] as const) {
  test(`the ${label} renders, round-trips an action and rewrites nothing`, async () => {
    const operations = json(withCatalog(formSurface, catalogId));
    const received = JSON.stringify(operations);
    const { host, actions } = session();
    noFetch(() => host.apply(operations));
    const { surfaces, issues } = host.snapshot();
    assert.deepEqual(issues, []);
    assert.deepEqual(surfaces.map((surface) => surface.id), ['form']);
    assert.equal(surfaces[0]!.defaultCatalog.id, catalogId);
    assert.equal(JSON.stringify(operations), received, 'the received operations are never altered');

    await surfaces[0]!.dispatchAction({ event: { name: 'send_note', context: { note: { path: '/note' }, count: { path: '/count' } } } }, 'send');
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.name, 'send_note');
    assert.equal(actions[0]!.surfaceId, 'form');
    assert.equal(actions[0]!.sourceComponentId, 'send');
    assert.deepEqual(actions[0]!.context, { note: { path: '/note' }, count: { path: '/count' } });
  });
}

test('any other catalog id, including a lookalike, is still a visible error', () => {
  for (const unknown of [
    'https://a2ui.org/specification/v0_9/basic_catalog.json/',
    'https://a2ui.org/specification/v0_8/basic_catalog.json',
    'https://a2ui.org/specification/v0_9/catalogs/basic/catalog',
    'basic_catalog.json',
    'https://catalog.invalid/custom.json',
  ]) {
    const { host } = session();
    noFetch(() => host.apply(json(withCatalog(formSurface, unknown))));
    const { surfaces, issues } = host.snapshot();
    assert.deepEqual(surfaces.map((surface) => surface.id), [], unknown);
    assert.ok(issues.some((issue) => issue.source === 'operation' && /catalog/i.test(issue.message)), `${unknown} is reported`);
  }
});

test('both ids can address surfaces in the same activity', () => {
  const { host } = session();
  const first = withCatalog(formSurface, BASIC_CATALOG_ID);
  const second = withCatalog(formSurface, MIDDLEWARE_CATALOG_ID).map((operation) => JSON.parse(JSON.stringify(operation).replaceAll('"form"', '"form-2"')));
  host.apply(json([...first, ...second]));
  assert.deepEqual(host.snapshot().issues, []);
  assert.deepEqual(host.snapshot().surfaces.map((surface) => surface.id), ['form', 'form-2']);
});

test('an unlisted component type resolves to an error stand-in with the entry as received, and the catalog still lists only its own', () => {
  for (const catalog of createBundledCatalogs(() => undefined)) {
    const listed = [...catalog.components.keys()];
    assert.equal(catalog.components.has('Hologram'), false, 'the stand-in is an answer, not an entry');
    const standIn = catalog.components.get('Hologram')!;
    assert.equal(standIn.name, 'Hologram');
    assert.equal(catalog.components.get('Hologram'), standIn, 'the same stand-in each time');
    assert.deepEqual([...catalog.components.keys()], listed, 'asking for it adds nothing to the catalog');
    assert.equal(catalog.components.get('Text'), createBundledCatalog(() => undefined).components.get('Text'), 'a listed type is still itself');
  }

  const { host } = session();
  host.apply(json([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: BASIC_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Hologram', depth: 3, children: ['x'] }] } },
  ]));
  const surface = host.snapshot().surfaces[0]!;
  assert.deepEqual(host.snapshot().issues, [], 'the surface raises no second report; the stand-in is the message');
  const standIn = surface.defaultCatalog.components.get('Hologram')!;
  const markup = renderToStaticMarkup(createElement(standIn.render, { context: new ComponentContext(surface, 'root', '/'), buildChild: () => null }));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Unknown component type: Hologram/);
  assert.match(markup, /agui-finding--err/);
  assert.match(markup, /As received/);
  assert.match(markup, /Received component root/);
  assert.match(markup, /depth/);
  assert.doesNotMatch(markup, /color:\s*red/);
});

// ---- configured aliases (spec 008, FR-012 to FR-017) ---------------------------------------------------

const FORMER = 'https://catalog.invalid/old/basic.json';
const FORMER_V08 = 'https://catalog.invalid/old/standard.json';

/** What a page does with a config file: parse it, and give its aliases to the session. */
function fromConfig(catalogAliases: unknown) {
  const text = JSON.stringify({ agents: [{ id: 'a', url: '/a' }], catalogAliases });
  const parsed = parseConfig(text);
  assert.equal(parsed.ok, true);
  return session(parsed.ok ? parsed.value.catalogAliases : undefined);
}

test('createBundledCatalogs builds one catalog per alias id, all sharing the guarded components and functions', () => {
  const reports: Array<{ kind: string; url: string }> = [];
  const [basic, ...aliases] = createBundledCatalogs((blocked) => void reports.push(blocked), [MIDDLEWARE_CATALOG_ID, FORMER]);
  assert.deepEqual(aliases.map((catalog) => catalog.id), [MIDDLEWARE_CATALOG_ID, FORMER]);
  for (const alias of aliases) {
    for (const [name, component] of basic!.components) assert.equal(alias.components.get(name), component, `${name} is shared`);
    alias.functions.get('openUrl')!.execute({ url: `http://${THIRD_PARTY_HOST}/page` }, undefined as never);
  }
  assert.equal(reports.length, 2, 'the guard sits on every alias');
  assert.deepEqual(createBundledCatalogs(() => undefined, []).map((catalog) => catalog.id), [basicCatalog.id], 'no alias ids, no alias catalogs');
});

test('a configured alias renders, round-trips an action and rewrites nothing', async () => {
  const operations = json(withCatalog(formSurface, FORMER));
  const received = JSON.stringify(operations);
  const { host, actions } = fromConfig({ [FORMER]: BASIC_CATALOG_ID });
  noFetch(() => host.apply(operations));
  const { surfaces, issues } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(surfaces.map((surface) => surface.id), ['form']);
  assert.equal(surfaces[0]!.defaultCatalog.id, FORMER, 'the surface answers to the id the agent sent');
  assert.equal(JSON.stringify(operations), received);
  await surfaces[0]!.dispatchAction({ event: { name: 'send_note', context: { note: { path: '/note' } } } }, 'send');
  assert.equal(actions.length, 1);
});

test('without the alias the same id is "Catalog not found" with the entry as received', () => {
  const operations = json(withCatalog(formSurface, FORMER)) as JsonValue[];
  const { host } = fromConfig(undefined);
  host.apply(operations);
  const { surfaces, issues } = host.snapshot();
  assert.deepEqual(surfaces, []);
  const refusal = issues.find((issue) => issue.index === 0);
  assert.equal(refusal?.message, `Catalog not found: ${FORMER}`);
  assert.deepEqual(refusal?.operation, operations[0]);
});

test('near misses of a configured alias, and an alias of the other version, are still errors', () => {
  const aliases = { [FORMER]: BASIC_CATALOG_ID, [FORMER_V08]: STANDARD_V08 };
  for (const near of [`${FORMER}/`, FORMER.replace('https', 'http'), FORMER.toUpperCase(), FORMER_V08]) {
    const { host } = fromConfig(aliases);
    noFetch(() => host.apply(json(withCatalog(formSurface, near))));
    assert.deepEqual(host.snapshot().surfaces, [], near);
    assert.equal(host.snapshot().issues.find((issue) => issue.index === 0)?.message, `Catalog not found: ${near}`, near);
  }
});

test('an alias that names another alias does not chain, and a bad entry does not take the good one with it', () => {
  const { host } = fromConfig({ first: 'second', second: BASIC_CATALOG_ID, [FORMER]: BASIC_CATALOG_ID });
  host.apply(json(withCatalog(formSurface, 'first')));
  assert.deepEqual(host.snapshot().surfaces, []);
  const other = fromConfig({ first: 'second', second: BASIC_CATALOG_ID, [FORMER]: BASIC_CATALOG_ID });
  other.host.apply(json(withCatalog(formSurface, FORMER)));
  assert.deepEqual(other.host.snapshot().surfaces.map((surface) => surface.id), ['form']);
});

test('the middleware default still resolves with no config and is not replaced by a config alias', () => {
  const { host } = fromConfig({ [MIDDLEWARE_CATALOG_ID]: STANDARD_V08 });
  host.apply(json(withCatalog(formSurface, MIDDLEWARE_CATALOG_ID)));
  assert.deepEqual(host.snapshot().issues, []);
  assert.deepEqual(host.snapshot().surfaces.map((surface) => surface.id), ['form']);
});
