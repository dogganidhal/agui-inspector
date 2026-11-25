// Spec 020: A2UI 1.0 surfaces. Version detection, the 1.0 basic catalog and a configured alias of it, the stand-in
// for a component the catalog lacks, and the action envelope a 1.0 button sends, driven through the session and the
// official processor with the reference agent's card. Drawing in a browser is in tests/e2e/a2ui/v10.spec.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ComponentContext } from '@a2ui/web_core';
import { basicCatalog as basicCatalogV10 } from '@a2ui/web_core/catalogs/basic/v1';
import type { WebComponentImplementation } from '@a2ui/web_core/universal';
import type { ReactCatalogComponent } from '@a2ui/react';
import type { A2uiAction, JsonValue } from '../../src/contracts.ts';
import { createSurfaceSession, surfaceVersion } from '../../src/core/a2ui/index.ts';
import { classify, surfaceKey, type Entry } from '../../src/core/a2ui/operations.ts';
import { parseConfig } from '../../src/core/config/index.ts';
import { rendererCapabilities } from '../../src/core/profiles/index.ts';
import { createBundledCatalogs } from '../../src/views/a2ui/catalog.tsx';
import { UNKNOWN_TAG } from '../../src/views/a2ui/components.tsx';
import { AGENT_V10_CATALOG_ID, BASIC_CATALOG_ID, BASIC_V10_CATALOG_ID, formSurface, v10Card, v10Continuation } from '../../../../examples/reference-agent/a2ui-scenarios.ts';
import { V10_CARD_MESSAGE, a2uiResponse } from '../../../../examples/reference-agent/scenarios.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));
const ALIASES = { [AGENT_V10_CATALOG_ID]: BASIC_V10_CATALOG_ID };

function session(aliases?: Record<string, string>) {
  const actions: A2uiAction[] = [];
  const host = createSurfaceSession<ReactCatalogComponent>({
    catalog: createBundledCatalogs,
    onAction: (action) => void actions.push(action),
    ...(aliases !== undefined && { aliases }),
  });
  return { host, actions };
}

/** What a user's click on a button does: the renderer resolves the action against the data model, then dispatches it. */
async function click(surface: ReturnType<ReturnType<typeof session>['host']['snapshot']>['surfaces'][number], componentId: string): Promise<void> {
  const context = new ComponentContext(surface, componentId);
  const action = surface.componentsModel.get(componentId)!.properties['action'];
  await context.dispatchAction(context.dataContext.resolveAction(action as never) as Record<string, unknown>);
}

test('an entry that declares "1.0" is 1.0, and its surface key names the version', () => {
  const items = classify(json([{ version: '1.0', createSurface: { surfaceId: 'a', catalogId: 'c' } }, { version: '1.0', deleteSurface: { surfaceId: 'a' } }]) as JsonValue[]);
  assert.deepEqual(items.map((item) => ('version' in item ? item.version : item.message)), ['1.0', '1.0']);
  assert.equal(surfaceKey(items[0] as Entry), '1.0:a');
  for (const near of ['v1.0', '1.0.0', '1', 1]) {
    const [refused] = classify(json([{ version: near, createSurface: { surfaceId: 'a' } }]) as JsonValue[]);
    assert.equal('source' in refused! && refused.source, 'operation', String(near));
  }
});

test('with the alias, the agent catalog id draws the card with the 1.0 basic catalog and rewrites nothing', () => {
  const operations = json(v10Card);
  const received = JSON.stringify(operations);
  const { host } = session(ALIASES);
  host.apply(operations);
  const { surfaces, issues, order } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(surfaces.map((surface) => [surface.id, surfaceVersion(surface), surface.defaultCatalog?.id]), [['visit', '1.0', AGENT_V10_CATALOG_ID]]);
  assert.deepEqual(order, ['1.0:visit']);
  assert.deepEqual([...surfaces[0]!.componentsModel.entries].map(([id, component]) => `${id}:${component.type}`), [
    'root:Card', 'body:Column', 'title:Text', 'name:TextField', 'slot:ChoicePicker', 'rating:StarRating', 'confirm_label:Text', 'confirm:Button',
  ]);
  assert.equal(JSON.stringify(operations), received, 'the received operations are never altered');
});

test('without the alias the agent catalog id is "Catalog not found" with the entry as received', () => {
  const operations = json(v10Card) as JsonValue[];
  const { host } = session();
  host.apply(operations);
  const { surfaces, issues } = host.snapshot();
  assert.deepEqual(surfaces, []);
  assert.equal(issues[0]?.message, `Catalog not found: ${AGENT_V10_CATALOG_ID}`);
  assert.deepEqual(issues[0]?.operation, operations[0]);
});

test('an alias read from config.json serves the 1.0 catalog, and an alias of the v0.9 catalog does not', () => {
  const parsed = parseConfig(JSON.stringify({ agents: [{ id: 'a', url: '/a' }], catalogAliases: ALIASES }));
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.catalogAliases, ALIASES);
  const { host } = session(parsed.value.catalogAliases);
  host.apply(json(v10Card));
  assert.deepEqual(host.snapshot().issues, []);

  const wrong = session({ [AGENT_V10_CATALOG_ID]: BASIC_CATALOG_ID });
  wrong.host.apply(json(v10Card));
  assert.deepEqual(wrong.host.snapshot().surfaces, [], 'a 1.0 surface cannot use the v0.9 catalog');
  assert.match(wrong.host.snapshot().issues[0]?.message ?? '', /Catalog not found|catalog/i);
});

test('a component the catalog lacks is kept and stands in as the flagged element, whatever its properties', () => {
  const { host } = session(ALIASES);
  host.apply(json(v10Card));
  const surface = host.snapshot().surfaces[0]!;
  const rating = surface.componentsModel.get('rating')!;
  assert.equal(rating.type, 'StarRating');
  assert.deepEqual(rating.properties, { stars: 4, label: 'Rate the last visit' }, 'its properties as sent');
  const standIn = surface.defaultCatalog!.components.get('StarRating') as WebComponentImplementation;
  assert.equal(standIn.tagName, UNKNOWN_TAG);
  assert.equal(surface.defaultCatalog!.components.has('StarRating'), false, 'the catalog still lists only its own');
  assert.equal(host.snapshot().issues.length, 0, 'the stand-in is the message; nothing else is reported');
});

test('a 1.0 button sends the five-field envelope with its @path context resolved and copied at the click', async () => {
  const { host, actions } = session(ALIASES);
  host.apply(json(v10Card));
  const surface = host.snapshot().surfaces[0]!;
  surface.dataModel.set('/name', 'Grace');
  await click(surface, 'confirm');
  assert.equal(actions.length, 1);
  const [action] = actions;
  assert.deepEqual(Object.keys(action!).sort(), ['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  assert.equal(action!.name, 'confirm_booking');
  assert.equal(action!.surfaceId, 'visit');
  assert.equal(action!.sourceComponentId, 'confirm');
  assert.deepEqual(action!.context, { name: 'Grace', slot: ['morning'], source: 'card' });
  surface.dataModel.set('/slot', ['afternoon']);
  assert.deepEqual(action!.context['slot'], ['morning'], 'a later edit does not reach the sent envelope');
});

test('v0.9 and 1.0 surfaces share one list and keep the order the list names them', () => {
  const { host } = session(ALIASES);
  host.apply(json([...v10Card, ...formSurface]));
  const { surfaces, order, issues } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(order, ['1.0:visit', 'v0.9:form']);
  assert.deepEqual(surfaces.map((surface) => `${surfaceVersion(surface)}:${surface.id}`).sort(), ['1.0:visit', 'v0.9:form']);
});

test('an appended 1.0 updateComponents applies only the tail and keeps what the user typed', () => {
  const { host } = session(ALIASES);
  host.apply(json(v10Card));
  const surface = host.snapshot().surfaces[0]!;
  surface.dataModel.set('/name', 'typed');
  const action: A2uiAction = { name: 'confirm_booking', surfaceId: 'visit', sourceComponentId: 'confirm', context: { name: 'typed' }, timestamp: '2026-11-25T10:00:00.000Z' };
  host.apply(json(v10Continuation(v10Card, action)));
  assert.equal(host.snapshot().surfaces[0], surface, 'the same surface');
  assert.equal(surface.dataModel.get('/name'), 'typed');
  assert.equal(surface.componentsModel.get('echo')?.type, 'Text');
});

// ---- the reference agent's 1.0 card (spec 020) ------------------------------------------------------------

const decoder = new TextDecoder();
const events = (forwardedProps: Record<string, unknown>, text?: string) =>
  decoder
    .decode(Buffer.concat(a2uiResponse({ threadId: 't', runId: 'r', messages: text === undefined ? [] : [{ role: 'user', content: text }], forwardedProps } as never).chunks))
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as { type: string; content?: { a2ui_operations?: unknown }; delta?: string });

test('the agent sends its 1.0 card only to a client that declares its catalog id for 1.0', () => {
  const withAlias = events({ a2uiRendererCapabilities: rendererCapabilities(ALIASES) }, V10_CARD_MESSAGE);
  assert.deepEqual(withAlias.find((event) => event.type === 'ACTIVITY_SNAPSHOT')?.content?.a2ui_operations, json(v10Card));

  const bare = events({ a2uiRendererCapabilities: rendererCapabilities() }, V10_CARD_MESSAGE);
  assert.equal(bare.some((event) => event.type === 'ACTIVITY_SNAPSHOT'), false);
  assert.match(bare.map((event) => event.delta ?? '').join(''), /does not declare https:\/\/example\.com\/catalogs\/chat\/v1\.0\/catalog\.json/);
});

test('a run that carries the card\'s action, with messages: [], gets the card back with the envelope shown', () => {
  const userAction: A2uiAction = { name: 'confirm_booking', surfaceId: 'visit', sourceComponentId: 'confirm', context: { name: 'Ada', slot: ['morning'], source: 'card' }, timestamp: '2026-11-25T10:00:00.000Z' };
  const snapshot = events({ a2uiAction: { userAction } }).find((event) => event.type === 'ACTIVITY_SNAPSHOT');
  assert.deepEqual(snapshot?.content?.a2ui_operations, json(v10Continuation(v10Card, userAction)));
});

test('the 1.0 basic catalog the inspector bundles is the renderer package\'s', () => {
  assert.equal(BASIC_V10_CATALOG_ID, basicCatalogV10.id);
  const v10 = createBundledCatalogs(() => undefined).find((catalog) => catalog.id === BASIC_V10_CATALOG_ID)!;
  assert.equal(v10.protocolVersion, '1.0');
  assert.deepEqual([...v10.components.keys()], [...basicCatalogV10.components.keys()]);
  for (const media of ['Image', 'Video', 'AudioPlayer']) assert.notEqual(v10.components.get(media), basicCatalogV10.components.get(media), `${media} loads nothing`);
  assert.notEqual(v10.functions.get('openUrl'), basicCatalogV10.functions.get('openUrl'), 'openUrl opens nothing');
});
