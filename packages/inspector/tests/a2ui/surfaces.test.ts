// L05 T039 (FR-020, FR-025, FR-030, FR-037; US3.4): A2UI v0.9 surfaces through the official renderer
// packages. The session is driven with operation lists the way an activity's snapshots and deltas
// change them; the view is checked statically (disabled, unknown activity, malformed input). Clicking,
// typing and the network allowlist run in the browser in tests/e2e/a2ui/surfaces.spec.ts.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { basicCatalog } from '@a2ui/react/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { ComponentContext, GenericBinder, peekValue, type SurfaceModel } from '@a2ui/web_core/v0_9';
import type { A2uiAction, JsonValue } from '../../src/contracts.ts';
import { createSurfaceSession } from '../../src/core/a2ui/index.ts';
import { applyJsonPatch } from '../../src/core/projection/patch.ts';
import { A2UI_ACTIVITY_TYPE, A2uiView, a2uiActivity } from '../../src/views/a2ui/index.tsx';
import { createBundledCatalog } from '../../src/views/a2ui/catalog.tsx';
import {
  BASIC_CATALOG_ID,
  deleteForm,
  externalResources,
  formSurface,
  malformedOperations,
  secondSurface,
  THIRD_PARTY_HOST,
} from '../../../../examples/reference-agent/a2ui-scenarios.ts';

const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value));

function session() {
  const actions: A2uiAction[] = [];
  const host = createSurfaceSession<ReactComponentImplementation>({
    catalog: createBundledCatalog,
    onAction: (action) => void actions.push(action),
  });
  return { host, actions };
}

const data = (surface: SurfaceModel<ReactComponentImplementation>, pointer: string): unknown => peekValue(surface.dataModel.getSignal(pointer));

test('the bundled catalog is the official basic catalog, not a fetched or aliased one', () => {
  assert.equal(BASIC_CATALOG_ID, basicCatalog.id);
  const bundled = createBundledCatalog(() => undefined);
  assert.equal(bundled.id, basicCatalog.id);
  assert.equal(bundled.protocolVersion, basicCatalog.protocolVersion);
  assert.deepEqual([...bundled.components.keys()], [...basicCatalog.components.keys()]);
  assert.deepEqual([...bundled.functions.keys()], [...basicCatalog.functions.keys()]);
});

test('create and update operations build a surface with its components and data', () => {
  const { host } = session();
  host.apply(json(formSurface));
  const { surfaces, issues } = host.snapshot();
  assert.deepEqual(issues, []);
  assert.deepEqual(surfaces.map((surface) => surface.id), ['form']);
  const surface = surfaces[0]!;
  assert.equal(surface.componentsModel.get('send')?.type, 'Button');
  assert.equal(data(surface, '/note'), 'first draft');
  assert.equal(data(surface, '/count'), 1);
});

test('appended updates change the surface in place; the user keeps what they typed', () => {
  const { host } = session();
  host.apply(json(formSurface));
  const before = host.snapshot().surfaces[0]!;
  before.dataModel.set('/note', 'typed by the user');

  host.apply(json([...formSurface, { version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/count', value: 7 } }]));
  const after = host.snapshot().surfaces[0]!;
  assert.equal(after, before, 'the same surface model: nothing was rebuilt');
  assert.equal(data(after, '/count'), 7);
  assert.equal(data(after, '/note'), 'typed by the user');
});

test('changing a bound value never alters the operations the session was handed', () => {
  const { host } = session();
  const operations = json(formSurface) as JsonValue[];
  const received = json(operations);
  host.apply(operations);
  const before = host.snapshot().surfaces[0]!;
  before.dataModel.set('/note', 'typed by the user');
  before.dataModel.set('/count', 99);
  before.dataModel.set('/extra/deep', { added: true });
  assert.deepEqual(operations, received, 'what the agent sent is still what the list holds');

  // The same list again (the view re-applies on every render) is still a no-op, not a rebuild.
  let notified = 0;
  host.subscribe(() => void notified++);
  host.apply(operations);
  assert.equal(host.snapshot().surfaces[0], before);
  assert.equal(notified, 0);

  // An extended list keeps the typed value and still leaves every entry as received.
  const appended = [...operations, { version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/other', value: 'later' } }];
  host.apply(appended);
  assert.equal(host.snapshot().surfaces[0], before, 'nothing was rebuilt');
  assert.equal(data(before, '/note'), 'typed by the user');
  assert.equal(data(before, '/other'), 'later');
  assert.deepEqual(appended.slice(0, -1), received);
  assert.deepEqual(appended.at(-1), { version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/other', value: 'later' } });
});

test('the issues keep the offending entry as received, not a copy the renderer touched', () => {
  const { host } = session();
  const operations = json([...formSurface, { version: 'v0.9', updateComponents: { surfaceId: 'ghost', components: [] } }]) as JsonValue[];
  host.apply(operations);
  const [issue] = host.snapshot().issues;
  assert.equal(issue?.index, 3);
  assert.equal(issue?.operation, operations[3], 'the very entry the session was handed');
});

test('applying the same operations again changes nothing and notifies nobody', () => {
  const { host } = session();
  host.apply(json(formSurface));
  const snapshot = host.snapshot();
  let notified = 0;
  host.subscribe(() => void notified++);
  host.apply(json(formSurface));
  assert.equal(host.snapshot(), snapshot);
  assert.equal(notified, 0);
});

test('a second surface joins and a delete removes only its own surface', () => {
  const { host } = session();
  host.apply(json([...formSurface, ...secondSurface]));
  assert.deepEqual(host.snapshot().surfaces.map((surface) => surface.id), ['form', 'status']);
  host.apply(json([...formSurface, ...secondSurface, deleteForm]));
  assert.deepEqual(host.snapshot().surfaces.map((surface) => surface.id), ['status']);
  assert.deepEqual(host.snapshot().issues, []);
});

test('a delta that rewrites an earlier operation rebuilds from the operations as they now stand', () => {
  const { host } = session();
  const content = json({ a2ui_operations: formSurface });
  host.apply((content as { a2ui_operations: JsonValue }).a2ui_operations);
  const first = host.snapshot().surfaces[0]!;

  const patched = applyJsonPatch(content, [{ op: 'replace', path: '/a2ui_operations/2/updateDataModel/value/note', value: 'from a delta' }]);
  assert.ok(patched.ok);
  host.apply((patched.value as { a2ui_operations: JsonValue }).a2ui_operations);
  const second = host.snapshot().surfaces[0]!;
  assert.notEqual(second, first, 'history changed, so the surface was rebuilt');
  assert.equal(data(second, '/note'), 'from a delta');
  assert.deepEqual(host.snapshot().issues, []);
});

test('subscribers hear about surface changes once per apply, with a fresh snapshot', () => {
  const { host } = session();
  const seen: number[] = [];
  host.subscribe(() => void seen.push(host.snapshot().surfaces.length));
  host.apply(json([...formSurface, ...secondSurface]));
  assert.deepEqual(seen, [2]);
  host.apply(json([...formSurface, ...secondSurface, deleteForm]));
  assert.deepEqual(seen, [2, 1]);
});

test('malformed operations are each reported with their position; the rest still render', () => {
  const { host } = session();
  const operations = json(malformedOperations);
  host.apply(operations);
  const { surfaces, issues } = host.snapshot();

  assert.deepEqual(surfaces.map((surface) => surface.id), ['ok'], 'the valid operations around the bad ones were applied');
  assert.deepEqual(issues.map((issue) => issue.index), [1, 2, 3, 4, 5]);
  assert.ok(issues.every((issue) => issue.source === 'operation'));
  assert.match(issues[0]!.message, /not an object/i);
  assert.match(issues[1]!.message, /version/i);
  assert.match(issues[2]!.message, /v0\.8/);
  assert.match(issues[2]!.message, /v0\.9/, 'says which version is supported');
  assert.match(issues[3]!.message, /catalog/i);
  assert.match(issues[4]!.message, /ghost/);
  assert.deepEqual(issues[0]!.operation, 'not an object', 'the offending operation is kept for inspection');
  assert.deepEqual(operations, json(malformedOperations), 'the received operations are never altered');
  assert.equal(surfaces[0]!.componentsModel.get('root')?.properties.text, 'Survivor');
});

test('operations that are not a list are one visible issue and no surface', () => {
  const { host } = session();
  for (const operations of [{ a2ui_operations: [] }, 'text', 7, true]) {
    host.apply(json(operations));
    assert.deepEqual(host.snapshot().surfaces, []);
    assert.equal(host.snapshot().issues.length, 1);
    assert.match(host.snapshot().issues[0]!.message, /list/);
  }
  host.apply(json(formSurface));
  assert.deepEqual(host.snapshot().issues, [], 'a good list clears the earlier issue');
  assert.equal(host.snapshot().surfaces.length, 1);
});

test('an empty list is no surface and no issue', () => {
  const { host } = session();
  host.apply([]);
  assert.deepEqual(host.snapshot().surfaces, []);
  assert.deepEqual(host.snapshot().issues, []);
});

test('an action carries exactly name, surface, component, context and the renderer timestamp', async () => {
  const { host, actions } = session();
  host.apply(json(formSurface));
  const surface = host.snapshot().surfaces[0]!;
  const before = Date.now();
  await surface.dispatchAction(
    { event: { name: 'send_note', context: { note: { path: '/note' }, count: { path: '/count' } } }, catalogId: BASIC_CATALOG_ID, userMessage: 'extra' },
    'send',
  );
  assert.equal(actions.length, 1);
  const action = actions[0]!;
  assert.deepEqual(Object.keys(action).sort(), ['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  assert.equal(action.name, 'send_note');
  assert.equal(action.surfaceId, 'form');
  assert.equal(action.sourceComponentId, 'send');
  assert.match(action.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(action.timestamp) >= before - 1000 && Date.parse(action.timestamp) <= Date.now() + 1000);
  assert.deepEqual(action.context, { note: { path: '/note' }, count: { path: '/count' } }, 'the context is passed on as the renderer supplied it');
});

test('an action keeps the data it carried when the user clicked, whatever they type next', async () => {
  const { host, actions } = session();
  const operations = json(formSurface) as Array<{ updateComponents?: { components: Array<{ id: string; action?: { event: { context: unknown } } }> } }>;
  operations[1]!.updateComponents!.components.find((component) => component.id === 'send')!.action!.event.context = { everything: { path: '/' } };
  host.apply(operations as unknown as JsonValue);
  const surface = host.snapshot().surfaces[0]!;
  const binder = new GenericBinder(new ComponentContext(surface, 'send', '/'), basicCatalog.components.get('Button')!.schema);
  (binder.snapshot as { action(): void }).action();
  binder.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(actions[0]!.context, { everything: { note: 'first draft', count: 1 } });
  surface.dataModel.set('/note', 'typed after the click');
  assert.deepEqual(actions[0]!.context, { everything: { note: 'first draft', count: 1 } });
});

test('a surface that was rebuilt away no longer reports actions', async () => {
  const { host, actions } = session();
  host.apply(json(formSurface));
  const stale = host.snapshot().surfaces[0]!;
  host.apply(json([...formSurface.slice(0, 2), ...formSurface.slice(2)].map((operation, at) => (at === 2 ? { ...operation, extra: true } : operation))));
  assert.notEqual(host.snapshot().surfaces[0], stale);
  await stale.dispatchAction({ event: { name: 'late', context: {} } }, 'send');
  assert.equal(actions.length, 0);
  await host.snapshot().surfaces[0]!.dispatchAction({ event: { name: 'now', context: {} } }, 'send');
  assert.deepEqual(actions.map((action) => action.name), ['now']);
});

test('openUrl from a surface is refused and reported; the official function would have opened the page', () => {
  const opened: string[] = [];
  const globals = globalThis as { window?: unknown };
  const saved = globals.window;
  globals.window = { open: (url: string) => void opened.push(url), location: { href: 'http://127.0.0.1/' } };
  try {
    const target = { url: `http://${THIRD_PARTY_HOST}/page` };
    const context = undefined as never;
    basicCatalog.functions.get('openUrl')!.execute(target, context);
    assert.deepEqual(opened, [`http://${THIRD_PARTY_HOST}/page`], 'control: the unguarded function opens it');

    opened.length = 0;
    const reports: Array<{ kind: string; url: string }> = [];
    const guarded = createBundledCatalog((blocked) => void reports.push(blocked));
    guarded.functions.get('openUrl')!.execute(target, context);
    assert.deepEqual(opened, []);
    assert.deepEqual(reports, [{ kind: 'openUrl', url: `http://${THIRD_PARTY_HOST}/page` }]);
  } finally {
    globals.window = saved;
  }
});

test('a blocked openUrl becomes a visible issue on the session', async () => {
  const { host } = session();
  host.apply(json(externalResources));
  const surface = host.snapshot().surfaces[0]!;
  const open = surface.componentsModel.get('open')!;
  assert.ok(open, 'the button exists');
  const catalogFunctions = surface.defaultCatalog.functions.get('openUrl')!;
  catalogFunctions.execute({ url: `http://${THIRD_PARTY_HOST}/page` }, undefined as never);
  const issue = host.snapshot().issues.at(-1)!;
  assert.equal(issue.source, 'blocked');
  assert.match(issue.message, new RegExp(THIRD_PARTY_HOST));
});

// --- the view, rendered statically -------------------------------------------------------------

const noAction = () => undefined;
const view = (props: { operations: JsonValue; renderEnabled: boolean }) =>
  renderToStaticMarkup(createElement(A2uiView, { activityId: 'a2ui-surface-1', operations: props.operations, renderEnabled: props.renderEnabled, onAction: noAction }));

test('with rendering off the operations stay inspectable as JSON and nothing is rendered or fetched', () => {
  const markup = view({ operations: json(externalResources), renderEnabled: false });
  assert.match(markup, /data-view="a2ui"/);
  assert.match(markup, /data-status="json-only"/);
  assert.match(markup, /createSurface/);
  assert.match(markup, /updateComponents/);
  assert.match(markup, /Rendering is off/);
  assert.doesNotMatch(markup, /<img|<video|<audio|<button/);
});

test('rendering off keeps malformed operations visible too, without judging them', () => {
  const markup = view({ operations: json(malformedOperations), renderEnabled: false });
  assert.match(markup, /not an object/);
  assert.match(markup, /beginRendering/);
  assert.doesNotMatch(markup, /role="alert"/);
});

test('an activity without operations says so instead of showing an error', () => {
  const markup = view({ operations: null, renderEnabled: true });
  assert.match(markup, /No A2UI operations yet/);
  assert.doesNotMatch(markup, /role="alert"/);
});

test('operations that are not a list are a visible error naming the problem', () => {
  const markup = view({ operations: 'oops', renderEnabled: true });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /list/);
  assert.match(markup, /oops/, 'the received value is shown');
});

test('only a2ui-surface activities get a rendered view; every other type stays JSON in its card', () => {
  const entry = (activityType: string, content: JsonValue) => ({ messageId: 'm1', activityType, content });
  assert.equal(A2UI_ACTIVITY_TYPE, 'a2ui-surface');
  assert.equal(a2uiActivity(entry('PLAN', { a2ui_operations: json(formSurface) }), { renderEnabled: true, onAction: noAction }), undefined);
  assert.equal(a2uiActivity(entry('a2ui-surface-v1', {}), { renderEnabled: true, onAction: noAction }), undefined);
  assert.notEqual(a2uiActivity(entry('a2ui-surface', { a2ui_operations: json(formSurface) }), { renderEnabled: true, onAction: noAction }), undefined);
  // A lifecycle snapshot (status: building) has no operations yet; it still gets the view, which says what it is doing.
  const building = a2uiActivity(entry('a2ui-surface', { status: 'building' }), { renderEnabled: true, onAction: noAction });
  assert.match(renderToStaticMarkup(createElement(Fragment, null, building)), /data-status="building"/);
  const empty = a2uiActivity(entry('a2ui-surface', {}), { renderEnabled: true, onAction: noAction });
  assert.match(renderToStaticMarkup(createElement(Fragment, null, empty)), /No A2UI operations yet/);
  // Disabled rendering still hands over the view, which shows the JSON.
  const off = a2uiActivity(entry('a2ui-surface', { a2ui_operations: json(formSurface) }), { renderEnabled: false, onAction: noAction });
  assert.match(renderToStaticMarkup(createElement(Fragment, null, off)), /json-only/);
});

// --- boundaries ---------------------------------------------------------------------------------

function sourcesUnder(directory: string): Array<{ file: string; text: string }> {
  const root = path.join(process.cwd(), 'packages', 'inspector', 'src', directory);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => ({ file: entry.name, text: readFileSync(path.join(root, entry.name), 'utf8') }));
}

test('the A2UI core stays framework-free and independent of the optional render tool', () => {
  for (const { file, text } of sourcesUnder('core/a2ui')) {
    assert.doesNotMatch(text, /from 'react|from "react|@a2ui\/react/, `${file} must not import React or the React renderer`);
    assert.doesNotMatch(text, /a2ui-middleware|RENDER_A2UI_TOOL/, `${file}: rendering is not tied to the optional tool declaration`);
  }
  for (const { file, text } of sourcesUnder('views/a2ui')) {
    assert.doesNotMatch(text, /a2ui-middleware|RENDER_A2UI_TOOL|injectA2uiTool/, `${file}: rendering is not tied to the optional tool declaration`);
  }
});

test('nothing in the A2UI sources fetches, opens or sends anything on its own', () => {
  for (const { file, text } of [...sourcesUnder('core/a2ui'), ...sourcesUnder('views/a2ui')]) {
    assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|sendBeacon|window\.open|new WebSocket|new EventSource|@import/, file);
    assert.doesNotMatch(text, /https?:\/\//, `${file} names no remote address`);
  }
});

test('the stylesheet takes colors, radii and fonts from the theme tokens and loads nothing', () => {
  const css = readFileSync(path.join(process.cwd(), 'packages/inspector/src/views/a2ui/a2ui.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'no hex colors');
  assert.doesNotMatch(css, /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i, 'no literal color functions');
  assert.doesNotMatch(css, /@import|url\(|https?:/, 'nothing is loaded from the stylesheet');
  for (const [, value] of css.matchAll(/border(?:-[a-z]+)*-radius\s*:\s*([^;}]+)/g)) {
    assert.match(value ?? '', /^(0|50%|var\(--r(-sm|-xs)?\))$/, `radius ${value} comes from the scale`);
  }
  for (const [, value] of css.matchAll(/font(?:-family)?\s*:\s*([^;}]+)/g)) {
    assert.match(value ?? '', /inherit|var\(--agui-font-(sans|mono)\)/, `font ${value} comes from the font tokens`);
  }
});

test('docs/a2ui.md states v0.9-only support, the bundled catalog and the blocked resources', () => {
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'a2ui.md'), 'utf8');
  assert.match(doc, /Only A2UI v0\.9 is supported/);
  assert.ok(doc.includes(BASIC_CATALOG_ID));
  for (const name of ['Image', 'Video', 'AudioPlayer', 'openUrl', 'forwardedProps.a2uiAction.userAction', 'renderA2ui', 'injectA2uiTool']) {
    assert.ok(doc.includes(name), `${name} is documented`);
  }
});
