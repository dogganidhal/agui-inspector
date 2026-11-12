// Feature 018, T006: the core runs in Node over real HTTP, with no page. Plain runs, interrupts, tool results and an A2UI
// v0.9 action against the reference agent, with a header the store must never hold. T013 turns this into the parity test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { basicCatalog, Catalog, ComponentContext } from '@a2ui/web_core/v0_9';
import { createInteractiveServer } from '../../../../examples/reference-agent/interactive-scenarios.ts';
import { a2uiResponse, SCENARIOS, type RunInput } from '../../../../examples/reference-agent/scenarios.ts';
import type { A2uiAction, JsonValue, TransportPolicy } from '../../src/contracts.ts';
import { createSurfaceSession } from '../../src/core/a2ui/index.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { createRuntime, type Runtime } from '../../src/core/runtime/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const SECRET = 'synthetic-header-018';

function headless(origin: string) {
  const policy: TransportPolicy = { mode: 'hosted', pageOrigin: origin, allowedOrigins: [] };
  const store = createSessionStore();
  const sent: string[] = [];
  const runtime = createRuntime({
    store,
    policy,
    settings: () => ({ profile: defaultProfile(), variables: {} }),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('x-test', SECRET);
      sent.push(String(input));
      return globalThis.fetch(input, { ...init, headers });
    },
  });
  runtime.setTarget(`${origin}/agent`);
  return { runtime, store, sent };
}

/** Resolves once capture has ended: the recorder's own end marker decides, not a timer. */
function idle(runtime: Runtime): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (!runtime.getState().capturing && !runtime.getState().running) {
        stop();
        resolve();
      }
    };
    const stop = runtime.subscribe(check);
    check();
  });
}

const bytesOf = (frames: readonly { data?: string }[]) => frames.map((frame) => frame.data ?? '').join('');

test('a plain run records every frame the server wrote, and the header reaches the server only', async () => {
  const server = await createInteractiveServer();
  try {
    const { runtime, store, sent } = headless(server.origin);
    await runtime.send(SCENARIOS.state);
    await idle(runtime);
    const session = store.snapshot();
    assert.equal(session.exchanges.length, 1);
    assert.ok(session.frames.length > 2, 'frames were recorded');
    const written = new TextDecoder().decode(server.sent()[0]);
    for (const frame of session.frames) assert.ok(written.includes(frame.data ?? '\u0000'), `frame ${frame.index} is in the bytes the server wrote`);
    assert.ok(sent.every((url) => url.startsWith(server.origin)), 'every request went to the target');
    assert.deepEqual(server.requests()[0]?.credentials, [], 'x-test is not a credential header the server lists');
    assert.doesNotMatch(JSON.stringify(session), new RegExp(SECRET), 'the store never holds the header');
  } finally {
    await server.close();
  }
});

test('an interrupt pauses the run, and answering both resumes it in a second recorded run', async () => {
  const server = await createInteractiveServer();
  try {
    const { runtime, store } = headless(server.origin);
    await runtime.send(SCENARIOS.interrupt);
    await idle(runtime);
    const pending = runtime.getState().interrupts.filter((answer) => answer.status === 'unanswered');
    assert.deepEqual(pending.map((answer) => answer.interruptId), ['i-approve', 'i-contact']);
    runtime.draftInterrupt('i-approve', { approved: true });
    await runtime.answerInterrupt('i-approve', 'resolved');
    await runtime.answerInterrupt('i-contact', 'cancelled');
    await idle(runtime);
    const session = store.snapshot();
    assert.equal(session.runs.length, 2, 'the continuation is its own run');
    const model = projectConversation(session);
    assert.match(JSON.stringify(model.entries), /Resumed with i-approve=resolved/);
  } finally {
    await server.close();
  }
});

test('client tool calls take results, and the continuation carries them', async () => {
  const server = await createInteractiveServer();
  try {
    const { runtime, store } = headless(server.origin);
    await runtime.send(SCENARIOS.tools);
    await idle(runtime);
    const ids = runtime.getState().toolResults.map((draft) => draft.toolCallId);
    assert.deepEqual(ids, ['c-color', 'c-size']);
    runtime.draftToolResult('c-color', 'teal');
    await runtime.submitToolResult('c-color');
    runtime.draftToolResult('c-size', '2');
    await runtime.submitToolResult('c-size');
    await idle(runtime);
    assert.match(JSON.stringify(projectConversation(store.snapshot()).entries), /Tool results: c-color=teal, c-size=2/);
  } finally {
    await server.close();
  }
});

test('an A2UI v0.9 surface builds without a DOM, and a button action reaches the server as the renderer would send it', async () => {
  const requests: RunInput[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const input = JSON.parse(body) as RunInput;
    requests.push(input);
    const reply = a2uiResponse(input);
    response.writeHead(reply.status, { 'content-type': reply.contentType });
    for (const chunk of reply.chunks) response.write(chunk);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const { runtime, store } = headless(origin);
    await runtime.send('show the form');
    await idle(runtime);

    const activity = projectConversation(store.snapshot()).entries.find((entry) => entry.kind === 'activity');
    assert.ok(activity !== undefined && activity.kind === 'activity');
    const operations = (activity.content as { a2ui_operations: JsonValue }).a2ui_operations;

    const actions: A2uiAction[] = [];
    const surfaces = createSurfaceSession({
      catalog: (_report, aliasIds) => [basicCatalog, ...aliasIds.map((id) => new Catalog(id, basicCatalog.protocolVersion, [...basicCatalog.components.values()], [...basicCatalog.functions.values()], basicCatalog.themeSchema))],
      onAction: (action) => actions.push(action),
    });
    surfaces.apply(operations);
    const form = surfaces.snapshot().surfaces.find((surface) => surface.id === 'form');
    assert.ok(form !== undefined, 'the form surface exists');
    assert.equal(form.componentsModel.get('send')?.type, 'Button');
    assert.equal(form.dataModel.get('/note'), 'first draft');

    form.dataModel.set('/note', 'edited');
    const button = form.componentsModel.get('send')!;
    // What the renderer's binder does for an event action: resolve the context against the data model, then dispatch.
    const context = new ComponentContext(form, 'send');
    await context.dispatchAction(context.dataContext.resolveAction(button.properties['action']) as Record<string, unknown>);
    assert.equal(actions.length, 1, 'the action reached onAction');

    await runtime.sendA2uiAction(actions[0]!);
    await idle(runtime);
    const userAction = requests[1]?.forwardedProps?.a2uiAction?.userAction as { name?: string; context?: Record<string, unknown> } | undefined;
    assert.equal(userAction?.name, 'send_note');
    assert.equal(userAction?.context?.['note'], 'edited');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
