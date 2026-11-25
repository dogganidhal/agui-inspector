// Feature 018, T008: A2UI v0.9 surfaces in a headless session, read, edited and fired as the renderer would.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENT_V10_CATALOG_ID, BASIC_CATALOG_ID, BASIC_V10_CATALOG_ID } from '../../../../examples/reference-agent/a2ui-scenarios.ts';
import { V10_CARD_MESSAGE } from '../../../../examples/reference-agent/scenarios.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { openSession } from '../../src/headless/session.ts';
import { serve, serveA2ui } from './support.ts';

test('a surface shows its catalog, its components with properties resolved against the data model, and its data', async () => {
  const served = await serveA2ui();
  try {
    const session = await openSession({ target: served.agent });
    await session.send('show the form');
    const [form] = session.surfaces();
    assert.equal(form?.surfaceId, 'form');
    assert.equal(form?.catalogId, BASIC_CATALOG_ID);
    assert.deepEqual(form?.dataModel, { note: 'first draft', count: 1 });
    const note = form?.components.find((component) => component.id === 'note');
    assert.equal(note?.type, 'TextField');
    assert.equal(note?.props['value'], 'first draft', 'a bound value reads from the data model');
    assert.equal(form?.components.find((component) => component.id === 'send')?.type, 'Button');
    session.close();
  } finally {
    await served.close();
  }
});

test('set changes the data model and sends nothing; fire sends the action with the edited value and waits', async () => {
  const served = await serveA2ui();
  try {
    const session = await openSession({ target: served.agent });
    await session.send('show the form');
    session.a2ui.set('form', '/note', 'edited');
    assert.equal(served.inputs.length, 1, 'set sends nothing');
    assert.deepEqual(session.surfaces()[0]?.dataModel, { note: 'edited', count: 1 });
    const step = await session.a2ui.fire('form', 'send');
    assert.equal(step.idle, true);
    const userAction = served.inputs[1]?.forwardedProps?.a2uiAction?.userAction as { name?: string; sourceComponentId?: string; context?: Record<string, unknown> };
    assert.equal(userAction.name, 'send_note');
    assert.equal(userAction.sourceComponentId, 'send');
    assert.deepEqual(userAction.context, { note: 'edited', count: 1 });
    const echo = session.surfaces()[0]?.components.find((component) => component.id === 'echo');
    assert.match(String(echo?.props['text']), /Received send_note from send on form/);
    session.close();
  } finally {
    await served.close();
  }
});

test('an unknown surface or component rejects without quoting anything', async () => {
  const served = await serveA2ui();
  try {
    const session = await openSession({ target: served.agent });
    await session.send('show the form');
    await assert.rejects(session.a2ui.fire('nope', 'send'), (error: Error) => error.message === 'No surface with that id');
    await assert.rejects(session.a2ui.fire('form', 'nope'), (error: Error) => error.message === 'No component with that id on the surface');
    await assert.rejects(session.a2ui.fire('form', 'title'), (error: Error) => error.message === 'The component has no action');
    assert.throws(() => session.a2ui.set('nope', '/x', 1), (error: Error) => error.message === 'No surface with that id');
    session.close();
  } finally {
    await served.close();
  }
});

const V = 'v0.9';
const activity = (operations: unknown[]) => ({ type: 'ACTIVITY_SNAPSHOT', messageId: 'a2ui-1', activityType: 'a2ui-surface', content: { a2ui_operations: operations }, replace: true });

function serveEvents(events: (input: { threadId: string; runId: string }) => object[]) {
  return serve((input, _request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const all = [{ type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId }, ...events(input), { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId }];
    response.end(all.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
}

test('an openUrl function call is refused and reported, and media loads nothing because nothing renders', async () => {
  const served = await serveEvents(() => [
    activity([
      { version: V, createSurface: { surfaceId: 'links', catalogId: BASIC_CATALOG_ID } },
      {
        version: V,
        updateComponents: {
          surfaceId: 'links',
          components: [
            { id: 'root', component: 'Column', children: ['open', 'picture'] },
            { id: 'open-label', component: 'Text', text: 'Open' },
            { id: 'open', component: 'Button', child: 'open-label', action: { functionCall: { call: 'openUrl', args: { url: 'https://third-party.invalid/x' } } } },
            { id: 'picture', component: 'Image', url: 'https://third-party.invalid/a.png' },
          ],
        },
      },
    ]),
  ]);
  try {
    const session = await openSession({ target: served.agent });
    await session.send('links');
    const step = await session.a2ui.fire('links', 'open');
    assert.equal(step.newFrames, 0, 'a function call sends no run');
    assert.equal(served.inputs.length, 1);
    assert.match(JSON.stringify(session.surfaces()[0]?.issues), /openUrl/);
    session.close();
  } finally {
    await served.close();
  }
});

test('a v0.8 surface keeps its frames and findings and has no surface view', async () => {
  const served = await serveEvents(() => [activity([{ beginRendering: { surfaceId: 'old', root: 'root' } }])]);
  try {
    const session = await openSession({ target: served.agent });
    await session.send('old');
    assert.ok(session.frames().length === 3);
    assert.deepEqual(session.surfaces(), []);
    session.close();
  } finally {
    await served.close();
  }
});

test('a 1.0 card on an aliased agent catalog id reads with @path bindings resolved, and fire sends its envelope', async () => {
  const served = await serveA2ui();
  try {
    // Turn mode, as an agent that reads only the new turn expects: the action run then carries no message.
    const session = await openSession({ target: served.agent, profile: { ...defaultProfile(), messageMode: 'turn' }, catalogAliases: { [AGENT_V10_CATALOG_ID]: BASIC_V10_CATALOG_ID } });
    await session.send(V10_CARD_MESSAGE);
    const caps = served.inputs[0]?.forwardedProps?.a2uiRendererCapabilities as Record<string, { supportedCatalogIds: string[] }>;
    assert.deepEqual(caps['1.0']?.supportedCatalogIds, [BASIC_V10_CATALOG_ID, AGENT_V10_CATALOG_ID], 'the alias is declared');
    const [card] = session.surfaces();
    assert.equal(card?.surfaceId, 'visit');
    assert.equal(card?.catalogId, AGENT_V10_CATALOG_ID);
    assert.equal(card?.components.find((component) => component.id === 'name')?.props['value'], 'Ada', 'an @path binding reads from the data model');
    assert.equal(card?.components.find((component) => component.id === 'rating')?.type, 'StarRating', 'a component the catalog lacks is kept');
    session.a2ui.set('visit', '/name', 'Grace');
    await session.a2ui.fire('visit', 'confirm');
    const second = served.inputs[1];
    assert.deepEqual(second?.messages, [], 'an action run sends no message');
    const userAction = second?.forwardedProps?.a2uiAction?.userAction as { name?: string; context?: Record<string, unknown> };
    assert.equal(userAction.name, 'confirm_booking');
    assert.deepEqual(userAction.context, { name: 'Grace', slot: ['morning'], source: 'card' });
    session.close();
  } finally {
    await served.close();
  }
});

test('a 1.0 button bound to a path the data model lacks still sends its action, without that entry, and the surface says so', async () => {
  const served = await serveEvents(() => [
    activity([
      {
        version: '1.0',
        createSurface: {
          surfaceId: 'gap',
          catalogId: BASIC_V10_CATALOG_ID,
          dataModel: { name: 'Ada' },
          components: [
            { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'go', context: { name: { '@path': '/name' }, missing: { '@path': '/nothing' } } } } },
            { id: 'label', component: 'Text', text: 'Go' },
          ],
        },
      },
    ]),
  ]);
  try {
    const session = await openSession({ target: served.agent });
    await session.send('gap');
    const step = await session.a2ui.fire('gap', 'root');
    assert.equal(step.error, undefined, 'the tap is not refused');
    const userAction = served.inputs[1]?.forwardedProps?.a2uiAction?.userAction as { name?: string; context?: Record<string, unknown> };
    assert.equal(userAction.name, 'go');
    assert.deepEqual(userAction.context, { name: 'Ada' }, 'the entry with no value is left out');
    const issues = session.surfaces()[0]?.issues ?? [];
    assert.deepEqual(issues.map((issue) => [issue.source, issue.message]), [['action', 'Action go from root was sent without missing: the context bound it to no value, and JSON has none to send.']]);
    session.close();
  } finally {
    await served.close();
  }
});
