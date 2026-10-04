// FX12: the A2UI showcase. Every story is played through the real AG-UI client, the way the demo's page
// plays it: each answer is a stream the client accepts, the frame reader finds nothing wrong with, and
// whose activity ends up in the thread as the story says. The surfaces are then applied with the inspector's
// own session and bundled catalog, so "valid" means the renderer's processor took every operation. A
// follow-up step is built from nothing but the action it answers, so each test sends the action a browser
// would. Drawing, clicking and typing are in tests/e2e/public-demo/a2ui-showcase.spec.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { peekValue, type SurfaceModel } from '@a2ui/web_core/v0_9';
import type { ReactComponentImplementation } from '@a2ui/react/v0_9';
import { A2UIMiddleware } from '@ag-ui/a2ui-middleware';
import { HttpAgent, type AgentSubscriber } from '@ag-ui/client';
import { parseConfig } from '../../packages/inspector/src/core/config/index.ts';
import { createSurfaceSession, type SurfaceSession } from '../../packages/inspector/src/core/a2ui/index.ts';
import { createFrameReader } from '../../packages/inspector/src/core/frames/index.ts';
import { applyJsonPatch } from '../../packages/inspector/src/core/projection/patch.ts';
import { createBundledCatalog, createBundledCatalogs } from '../../packages/inspector/src/views/a2ui/catalog.tsx';
import type { Finding, JsonValue, RawFrame } from '../../packages/inspector/src/contracts.ts';
import { BASIC_CATALOG_ID, continuation, formSurface, THIRD_PARTY_HOST, type UserAction } from '../../examples/reference-agent/a2ui-scenarios.ts';
import {
  ACTIONS,
  MARKUP,
  RESTAURANTS,
  SEVERITY_ERROR,
  SHOWCASE,
  deployBoard,
  rolloutPatches,
  sandboxProbe,
  tableBooking,
  tableResults,
  ticketForm,
} from '../../examples/reference-agent/a2ui-showcase.ts';
import { a2uiResponse, type RunInput } from '../../examples/reference-agent/scenarios.ts';

type Ops = readonly unknown[];
type Surface = SurfaceModel<ReactComponentImplementation>;

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const decoder = new TextDecoder();

// ---- a thread played through the real client ----------------------------------------------------

interface Thread {
  readonly agent: HttpAgent;
  /** What each run's response put on the wire, in order. */
  readonly wires: string[];
  /** The types and activity contents of each run's events. */
  readonly runs: Array<Array<{ type: string; [key: string]: unknown }>>;
  /** Frames and findings the frame reader reported for each run's bytes. */
  readonly readings: Array<{ frames: RawFrame[]; findings: Finding[] }>;
  say(text: string): Promise<void>;
  act(action: Pick<UserAction, 'name' | 'surfaceId' | 'sourceComponentId' | 'context'>): Promise<void>;
  /** The operations of an activity as the thread holds them now. */
  ops(messageId: string): Ops;
  /** The content of an activity as the thread holds it now. */
  content(messageId: string): Record<string, unknown>;
}

let counter = 0;

function thread(): Thread {
  const wires: string[] = [];
  const runs: Thread['runs'] = [];
  const readings: Thread['readings'] = [];
  const agent = new HttpAgent({
    url: 'http://demo.invalid/agent/a2ui',
    threadId: 't-showcase',
    fetch: async (_url, init) => {
      const response = a2uiResponse(JSON.parse(String(init?.body)) as RunInput);
      const bytes = Buffer.concat(response.chunks);
      wires.push(decoder.decode(bytes));
      const reading: Thread['readings'][number] = { frames: [], findings: [] };
      const reader = createFrameReader({ appendFrame: (frame) => void reading.frames.push(frame), addFinding: (finding) => void reading.findings.push(finding) }, `exchange-${wires.length}`);
      reader.push(bytes, 0);
      reader.end();
      readings.push(reading);
      return new Response(bytes, { status: response.status, headers: { 'content-type': response.contentType } });
    },
  });
  const run = async (forwardedProps: Record<string, unknown> = {}) => {
    const events: Thread['runs'][number] = [];
    const subscriber: AgentSubscriber = { onEvent: ({ event }) => void events.push(event as never) };
    counter += 1;
    // A sequence the client rejects, or a patch it cannot apply, rejects the run: nothing is swallowed here.
    await agent.runAgent({ runId: `r-${counter}-${String(counter * 7919).padStart(4, '0')}`, forwardedProps }, subscriber);
    runs.push(events);
  };
  const find = (messageId: string) => {
    const message = agent.messages.find((candidate) => candidate.id === messageId) as { content?: Record<string, unknown> } | undefined;
    assert.ok(message, `the thread holds an activity ${messageId}`);
    return message.content ?? {};
  };
  return {
    agent,
    wires,
    runs,
    readings,
    async say(text) {
      agent.addMessage({ id: `u-${counter + 1}`, role: 'user', content: text });
      await run();
    },
    act: (action) => run({ a2uiAction: { userAction: { ...action, timestamp: '2026-10-03T09:00:00.000Z' } } }),
    ops: (messageId) => find(messageId)['a2ui_operations'] as Ops,
    content: find,
  };
}

const types = (events: Thread['runs'][number]) => events.map((event) => event.type);

/** The surfaces of an operation list, drawn by the inspector's session and bundled catalog. */
function draw(operations: Ops) {
  const host = createSurfaceSession<ReactComponentImplementation>({ catalog: createBundledCatalogs, onAction: () => undefined });
  host.apply(json(operations) as JsonValue);
  return { host, ...host.snapshot() };
}

const data = (surface: Surface, pointer: string): unknown => peekValue(surface.dataModel.getSignal(pointer));
const surfaceOf = (host: SurfaceSession<ReactComponentImplementation>, id: string): Surface => {
  const found = host.snapshot().surfaces.find((surface) => surface.id === id);
  assert.ok(found, `surface ${id}`);
  return found;
};
/** A list the session may keep: it stores a received data model object by reference, so what a user types changes it. */
const withHost = (host: SurfaceSession<ReactComponentImplementation>, operations: Ops) => {
  host.apply(json(operations) as JsonValue);
  return host.snapshot();
};

/** Everything a thread's reading of one run found: none of it may be a finding. */
const clean = (thread_: Thread) => {
  for (const [at, reading] of thread_.readings.entries()) {
    assert.deepEqual(reading.findings, [], `run ${at + 1} has no finding`);
    assert.ok(reading.frames.length > 0 && reading.frames.every((frame) => frame.schemaVerdict === 'valid' && frame.jsonVerdict === 'valid'), `run ${at + 1}: every frame is valid JSON and a valid event`);
  }
};

const action = (name: string, surfaceId: string, sourceComponentId: string, context: Record<string, unknown>) => ({ name, surfaceId, sourceComponentId, context });

// ---- every quick message --------------------------------------------------------------------------

test('every showcase message is answered by a stream the real client accepts, with no finding, and paints an activity', async () => {
  for (const message of Object.values(SHOWCASE)) {
    const t = thread();
    await t.say(message);
    clean(t);
    const activities = t.agent.messages.filter((candidate) => candidate.role === 'activity');
    assert.ok(activities.length > 0, `${message}: an activity`);
    assert.ok(activities.every((activity) => (activity as { activityType?: string }).activityType === 'a2ui-surface'), `${message}: A2UI only`);
    assert.equal(t.runs[0]![0]!.type, 'RUN_STARTED');
    assert.equal(t.runs[0]!.at(-1)!.type, 'RUN_FINISHED');
  }
});

test('the showcase is pure: the same input gives the same bytes, and a run id changes only ids made from it', () => {
  const input = (runId: string, text: string): RunInput => ({ threadId: 't-1', runId, messages: [{ role: 'user', content: text }] });
  const bytes = (runId: string, text: string) => decoder.decode(Buffer.concat(a2uiResponse(input(runId, text)).chunks));
  for (const message of Object.values(SHOWCASE)) {
    assert.equal(bytes('r-aaaa', message), bytes('r-aaaa', message), message);
  }
  // Stories that go on over several runs keep one activity id, so a later run changes the surface in place.
  for (const message of [SHOWCASE.findTable, SHOWCASE.supportTicket, SHOWCASE.deployBoard]) assert.equal(bytes('r-aaaa', message).replaceAll('r-aaaa', 'r-bbbb'), bytes('r-bbbb', message), message);
  // Stories that end in one run take their activity id from the run.
  for (const message of [SHOWCASE.selfRepair, SHOWCASE.neverValid, SHOWCASE.sandbox]) {
    assert.notEqual(bytes('r-aaaa', message), bytes('r-bbbb', message), message);
    assert.equal(bytes('r-aaaa', message).replaceAll('r-aaaa', 'r-bbbb'), bytes('r-bbbb', message), message);
  }
});

test('what the showcase does not name is the order form as before, and an action only its surfaces know is acknowledged', async () => {
  const ids = { threadId: 't-1', runId: 'r-1' };
  const body = (input: Partial<RunInput>) => decoder.decode(Buffer.concat(a2uiResponse({ ...ids, ...input }).chunks));
  const form = (operations: Ops) => body({}).replace(JSON.stringify(formSurface), JSON.stringify(operations));
  assert.equal(body({ messages: [{ role: 'user', content: 'Show the order form' }] }), body({}));
  assert.match(body({}), /"a2ui_operations":\[\{"version":"v0.9","createSurface":\{"surfaceId":"form"/);
  assert.equal(body({ messages: [{ role: 'user', content: 'something else entirely' }] }), body({}));
  assert.equal(body({ messages: [{ role: 'user', content: `  ${SHOWCASE.findTable.toUpperCase()} ` }] }), body({ messages: [{ role: 'user', content: SHOWCASE.findTable }] }), 'case and padding do not matter');

  const note: UserAction = { name: 'send_note', surfaceId: 'form', sourceComponentId: 'send', context: { note: 'n', count: 1 }, timestamp: '2026-10-02T10:00:00.000Z' };
  assert.equal(body({ forwardedProps: { a2uiAction: { userAction: note } } }), form(continuation(formSurface, note)), 'the form keeps its continuation');

  const choose = { ...note, name: 'choose_laptop', surfaceId: 'laptops', sourceComponentId: 'a-pick', context: { laptop: 'Atlas 14' } };
  const text = body({ forwardedProps: { a2uiAction: { userAction: choose } } });
  assert.match(text, /Action received: choose_laptop \{\\"laptop\\":\\"Atlas 14\\"\}/);
  assert.doesNotMatch(text, /ACTIVITY_/, 'text only: no surface of its own');
});

// ---- find a table ---------------------------------------------------------------------------------

test('find a table: results, a booking beside them, and a confirmation in place of both, each built from the action alone', async () => {
  const t = thread();
  await t.say(SHOWCASE.findTable);
  const id = 'a2ui-find-table';
  assert.deepEqual(t.ops(id), json(tableResults));
  const results = draw(t.ops(id));
  assert.deepEqual(results.issues, []);
  assert.deepEqual(results.surfaces.map((surface) => surface.id), ['results']);
  assert.deepEqual((data(results.surfaces[0]!, '/restaurants') as unknown[]).length, RESTAURANTS.length);
  assert.equal(results.surfaces[0]!.componentsModel.get('result-book')?.type, 'Button');

  // Book, as the browser sends it: the card's own fields from the template scope, the party size from the data model.
  const place = RESTAURANTS[2];
  await t.act(action(ACTIONS.bookTable, 'results', 'result-book', { restaurantId: place.id, restaurant: place.name, time: place.time, party: 4 }));
  const booked = t.ops(id);
  assert.deepEqual(booked.slice(0, tableResults.length), json(tableResults), 'the results come first, unchanged');
  assert.deepEqual(booked.slice(tableResults.length), json(tableBooking(place.id)));
  const before = surfaceOf(results.host, 'results');
  const beside = withHost(results.host, booked);
  assert.deepEqual(beside.issues, []);
  assert.deepEqual(beside.surfaces.map((surface) => surface.id), ['results', 'booking']);
  assert.ok(surfaceOf(results.host, 'results') === before, 'appended: the results were not rebuilt');
  assert.equal(data(surfaceOf(results.host, 'booking'), '/booking/restaurant'), place.name);
  assert.equal(data(surfaceOf(results.host, 'booking'), '/booking/guests'), '4', 'a text field holds text');

  // The form's own checks live on the renderer's side; Confirm names every value the server needs, by path.
  const confirm = surfaceOf(results.host, 'booking').componentsModel.get('booking-confirm')!.properties as { checks: Array<{ message: string }>; action: { event: { context: Record<string, unknown> } } };
  assert.equal(confirm.checks.length, 2);
  assert.deepEqual(confirm.action.event.context, {
    restaurantId: place.id,
    restaurant: { path: '/booking/restaurant' },
    guests: { path: '/booking/guests' },
    when: { path: '/booking/when' },
    seating: { path: '/booking/seating' },
    terms: { path: '/booking/terms' },
  });

  // Confirm, with what the form held: both surfaces go, a confirmation takes their place.
  await t.act(action(ACTIONS.confirmBooking, 'booking', 'booking-confirm', { restaurantId: place.id, restaurant: place.name, guests: '6', when: '2026-10-18T20:15', seating: ['terrace'], terms: true }));
  const done = t.ops(id);
  assert.deepEqual(done.slice(0, booked.length), booked, 'the earlier steps are rebuilt exactly');
  assert.deepEqual(done.slice(booked.length, booked.length + 2), [{ version: 'v0.9', deleteSurface: { surfaceId: 'results' } }, { version: 'v0.9', deleteSurface: { surfaceId: 'booking' } }]);
  const confirmed = withHost(results.host, done);
  assert.deepEqual(confirmed.issues, []);
  assert.deepEqual(confirmed.surfaces.map((surface) => surface.id), ['confirmation']);
  const run = String(t.runs.at(-1)![0]!['runId']);
  assert.deepEqual(data(confirmed.surfaces[0]!, '/confirmation'), {
    restaurant: place.name,
    when: '2026-10-18T20:15',
    guests: 6,
    seating: 'Terrace',
    deposit: place.deposit * 6,
    reference: `TB-${run.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}`,
  });
  clean(t);
});

test('find a table: cancel removes only the booking, and another booking starts from the results again', async () => {
  const t = thread();
  await t.say(SHOWCASE.findTable);
  await t.act(action(ACTIONS.cancelBooking, 'booking', 'booking-cancel', { restaurantId: 'r-verde' }));
  const cancelled = draw(t.ops('a2ui-find-table'));
  assert.deepEqual(cancelled.issues, []);
  assert.deepEqual(cancelled.surfaces.map((surface) => surface.id), ['results']);
  await t.act(action(ACTIONS.bookAnother, 'confirmation', 'done-again', {}));
  assert.deepEqual(t.ops('a2ui-find-table'), json(tableResults));
  clean(t);
});

test('find a table: whatever a client sends as context, the answer is still a surface the renderer takes', async () => {
  for (const context of [{}, { restaurantId: 42, party: {}, guests: [], when: 7, seating: 'terrace', terms: 'yes' }, { restaurantId: 'nowhere', guests: '99', seating: [3] }]) {
    for (const name of [ACTIONS.bookTable, ACTIONS.confirmBooking, ACTIONS.cancelBooking]) {
      const t = thread();
      await t.act(action(name, 'booking', 'x', context));
      const { issues } = draw(t.ops('a2ui-find-table'));
      assert.deepEqual(issues, [], `${name} ${JSON.stringify(context)}`);
    }
  }
});

// ---- support ticket ---------------------------------------------------------------------------------

test('support ticket: a rule only the server knows is answered by one data-model update, and what was typed stays', async () => {
  const t = thread();
  await t.say(SHOWCASE.supportTicket);
  const id = 'a2ui-support-ticket';
  assert.deepEqual(t.ops(id), json(ticketForm));
  const form = draw(t.ops(id));
  assert.deepEqual(form.issues, []);
  const surface = surfaceOf(form.host, 'ticket');
  assert.deepEqual(data(surface, '/ticket/severity'), ['medium']);
  assert.equal(data(surface, '/errors/severity'), '');
  surface.dataModel.set('/ticket/description', 'typed before the answer arrived');

  const submit = { email: 'ana@example.invalid', description: 'The checkout button does nothing.', severity: ['low'], urgency: 5, logs: true, when: '2026-10-02' };
  await t.act(action(ACTIONS.submitTicket, 'ticket', 'ticket-send', submit));
  const answered = t.ops(id);
  assert.deepEqual(answered.slice(0, ticketForm.length), json(ticketForm));
  const tail = answered.slice(ticketForm.length);
  assert.deepEqual(tail, [{ version: 'v0.9', updateDataModel: { surfaceId: 'ticket', path: '/errors/severity', value: SEVERITY_ERROR } }], 'one operation, and it only sets data');
  const after = withHost(form.host, answered);
  assert.deepEqual(after.issues, []);
  assert.ok(surfaceOf(form.host, 'ticket') === surface, 'appended: the form was not rebuilt');
  assert.equal(data(surface, '/errors/severity'), SEVERITY_ERROR);
  assert.equal(data(surface, '/ticket/description'), 'typed before the answer arrived');
  clean(t);
});

test('support ticket: any other combination is filed, and the reply time follows the urgency', async () => {
  for (const [severity, urgency, hours] of [[['medium'], 5, 1], [['low'], 3, 8], ['high', 4, 4], [['low'], 1, 48]] as const) {
    const t = thread();
    await t.act(action(ACTIONS.submitTicket, 'ticket', 'ticket-send', { email: 'ana@example.invalid', description: 'long enough to be sent', severity, urgency, logs: false, when: '2026-10-02' }));
    const filed = draw(t.ops('a2ui-support-ticket'));
    assert.deepEqual(filed.issues, [], `${JSON.stringify(severity)} ${urgency}`);
    assert.deepEqual(filed.surfaces.map((surface) => surface.id), ['ticket-done']);
    const done = data(filed.surfaces[0]!, '/done') as { number: string; email: string; hours: number };
    assert.equal(done.hours, hours);
    assert.equal(done.email, 'ana@example.invalid');
    assert.match(done.number, /^SUP-[0-9A-Z]{4}$/);
    clean(t);
  }
});

// ---- deploy board -----------------------------------------------------------------------------------

test('deploy board: one surface that keeps changing while the run streams, without being rebuilt, and a later run pauses it', async () => {
  const t = thread();
  await t.say(SHOWCASE.deployBoard);
  const id = 'a2ui-deploy-board';
  const run = t.runs[0]!;
  assert.deepEqual(types(run).filter((type, at, all) => type !== all[at - 1]), ['RUN_STARTED', 'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA', 'RUN_FINISHED']);
  const deltas = run.filter((event) => event.type === 'ACTIVITY_DELTA');
  assert.ok(deltas.length >= 3, 'at least three updates arrive after the surface');
  assert.equal(deltas.length, rolloutPatches().length);
  for (const delta of deltas) {
    const patch = delta['patch'] as Array<{ op: string; path: string; value: { version: string; updateDataModel: { surfaceId: string } } }>;
    assert.ok(patch.every((entry) => entry.op === 'add' && entry.path === '/a2ui_operations/-' && entry.value.version === 'v0.9' && 'updateDataModel' in entry.value), 'a patch only appends updateDataModel operations');
  }

  // As the view meets them: the activity after the snapshot, then after each delta.
  let content = json({ a2ui_operations: deployBoard }) as unknown as JsonValue;
  const host = createSurfaceSession<ReactComponentImplementation>({ catalog: createBundledCatalogs, onAction: () => undefined });
  host.apply(json((content as { a2ui_operations: JsonValue }).a2ui_operations));
  const surface = surfaceOf(host, 'deploy');
  surface.dataModel.set('/note', 'typed while it streams');
  const statuses: unknown[] = [data(surface, '/status')];
  for (const delta of deltas) {
    const patched = applyJsonPatch(content, delta['patch'] as never);
    assert.ok(patched.ok);
    content = patched.value;
    host.apply(json((content as { a2ui_operations: JsonValue }).a2ui_operations));
    assert.ok(surfaceOf(host, 'deploy') === surface, 'the same surface after every update');
    assert.equal(data(surface, '/note'), 'typed while it streams');
    statuses.push(data(surface, '/status'));
  }
  assert.deepEqual(host.snapshot().issues, []);
  assert.deepEqual(content, json({ a2ui_operations: t.ops(id) }), 'the client folded the same patches');
  assert.deepEqual([...new Set(statuses)], ['Queued', 'Running: Build image', 'Running: Run checks', 'Running: Canary at 10%', 'Running: Roll out to 50%']);
  assert.equal(data(surface, '/progress'), 60);
  assert.deepEqual((data(surface, '/stages') as Array<{ state: string }>).map((stage) => stage.state), ['done', 'done', 'done', 'running', 'waiting']);
  assert.equal((data(surface, '/logs') as unknown[]).length, 8);

  // Pause, with the progress and the note the board held: one patch, on the activity the first run painted.
  await t.act(action(ACTIONS.pauseDeploy, 'deploy', 'summary-pause', { release: '2.4.0', progress: 60, note: 'ship it after lunch' }));
  const second = t.runs[1]!;
  assert.deepEqual(types(second), ['RUN_STARTED', 'ACTIVITY_DELTA', 'RUN_FINISHED']);
  const paused = withHost(host, t.ops(id));
  assert.deepEqual(paused.issues, []);
  assert.ok(surfaceOf(host, 'deploy') === surface, 'and after the pause');
  assert.equal(data(surface, '/status'), 'Paused at 60%');
  assert.equal(data(surface, '/note'), 'typed while it streams');
  assert.equal(data(surface, '/stages/3/state'), 'paused');
  const logs = data(surface, '/logs') as Array<{ line: string }>;
  assert.equal(logs.length, 9, 'the pause line is appended after the last one');
  assert.equal(logs[8]!.line, 'Paused by you at 60%. Note: ship it after lunch');
  clean(t);
});

// ---- self-repair --------------------------------------------------------------------------------------

/** The middleware's own lifecycle for a render_a2ui call whose components are invalid: what it puts on the activity. */
async function middlewareActivity(events: object[]): Promise<Array<Record<string, unknown>>> {
  const stream = [{ type: 'RUN_STARTED', threadId: 't', runId: 'r' }, ...events, { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'success' } }];
  const agent = new HttpAgent({
    url: 'http://demo.invalid/agent',
    threadId: 't',
    fetch: async () => new Response(stream.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } }),
  });
  agent.use(new A2UIMiddleware({ injectA2UITool: true }));
  const seen: Array<Record<string, unknown>> = [];
  await agent.runAgent({ runId: 'r' }, { onActivitySnapshotEvent: ({ event }) => void seen.push(event.content as Record<string, unknown>) });
  return seen;
}

const activityContents = (events: Thread['runs'][number]) => events.filter((event) => event.type === 'ACTIVITY_SNAPSHOT').map((event) => event['content'] as Record<string, unknown>);
const lifecycle = (contents: Array<Record<string, unknown>>) => contents.map((content) => (typeof content['status'] === 'string' ? content['status'] : 'surface'));

test('self-repair: building, an invalid attempt, retrying, then the valid surface, all on one activity', async () => {
  const t = thread();
  await t.say(SHOWCASE.selfRepair);
  const [run] = t.runs;
  const contents = activityContents(run!);
  assert.deepEqual(lifecycle(contents), ['building', 'surface', 'retrying', 'surface']);
  assert.equal(new Set(run!.filter((event) => event.type === 'ACTIVITY_SNAPSHOT').map((event) => event['messageId'])).size, 1, 'one activity, replaced in place');
  assert.ok(run!.filter((event) => event.type === 'ACTIVITY_SNAPSHOT').every((event) => event['replace'] === true));

  // The invalid attempt leaves a child out. The processor takes it, as it takes anything it cannot judge; the tree is incomplete.
  const attempt = contents[1]!['a2ui_operations'] as Ops;
  const incomplete = draw(attempt);
  assert.deepEqual(incomplete.issues, []);
  const model = incomplete.surfaces[0]!.componentsModel;
  assert.deepEqual((model.get('summary')!.properties as { children: string[] }).children, ['card-a', 'card-b', 'card-c']);
  assert.equal(model.get('card-c'), undefined, 'card-c is referenced and was never sent');

  const retrying = contents[2]!;
  assert.deepEqual(retrying, {
    status: 'retrying',
    attempt: 2,
    maxAttempts: 3,
    errors: [{ code: 'unresolved_child', path: `components[${(attempt[1] as { updateComponents: { components: Array<{ id: string }> } }).updateComponents.components.findIndex((component) => component.id === 'summary')}].children[2]`, message: "Child reference 'card-c' does not match any component id" }],
  });

  const repaired = draw(contents[3]!['a2ui_operations'] as Ops);
  assert.deepEqual(repaired.issues, []);
  assert.ok(['card-a', 'card-b', 'card-c'].every((card) => repaired.surfaces[0]!.componentsModel.get(card) !== undefined), 'every card is there');
  assert.equal(repaired.surfaces[0]!.id, 'laptops');
  clean(t);
});

test('self-repair: a generation that never turns valid ends on failed, with the error, every attempt and the cap', async () => {
  const t = thread();
  await t.say(SHOWCASE.neverValid);
  const contents = activityContents(t.runs[0]!);
  assert.deepEqual(lifecycle(contents), ['building', 'surface', 'retrying', 'surface', 'retrying', 'surface', 'failed']);
  assert.deepEqual(contents.filter((content) => content['status'] === 'retrying').map((content) => [content['attempt'], content['maxAttempts']]), [[2, 3], [3, 3]]);
  const failed = contents.at(-1)!;
  assert.deepEqual(Object.keys(failed).sort(), ['attempts', 'error', 'maxAttempts', 'status']);
  assert.equal(failed['error'], 'Failed to generate valid A2UI after 3 attempt(s)');
  assert.equal(failed['maxAttempts'], 3);
  const attempts = failed['attempts'] as Array<{ attempt: number; ok: boolean; errors: Array<{ code: string; message: string }> }>;
  assert.deepEqual(attempts.map((entry) => [entry.attempt, entry.ok, entry.errors.length]), [[1, false, 1], [2, false, 1], [3, false, 1]]);
  assert.deepEqual(attempts.map((entry) => entry.errors[0]!.message.match(/'(.+)'/)![1]), ['card-c', 'b-body', 'a-pick'], 'each attempt slips differently');
  // No attempt is valid: each one draws an incomplete tree and the processor says nothing about it.
  for (const content of contents.filter((candidate) => 'a2ui_operations' in candidate)) assert.deepEqual(draw(content['a2ui_operations'] as Ops).issues, []);
  // The activity ends as the failure, and the thread says so in words: a surface that never appears would otherwise look like one still coming.
  assert.equal(t.content(String(t.runs[0]!.find((event) => event.type === 'ACTIVITY_SNAPSHOT')!['messageId']))['status'], 'failed');
  assert.match(t.agent.messages.filter((message) => message.role === 'assistant').map((message) => String(message.content)).join(' '), /nothing was drawn/);
  clean(t);
});

test('self-repair: the lifecycle is the one the middleware itself writes', async () => {
  const t = thread();
  await t.say(SHOWCASE.neverValid);
  const contents = activityContents(t.runs[0]!);
  const [building, firstAttempt, retrying] = contents as [Record<string, unknown>, { a2ui_operations: Ops }, Record<string, unknown>];

  // The first attempt's components, handed to the middleware as a render_a2ui call, are judged the same way.
  const components = (firstAttempt.a2ui_operations[1] as { updateComponents: { components: unknown[] } }).updateComponents.components;
  const written = await middlewareActivity([
    { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'render_a2ui' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: JSON.stringify({ surfaceId: 'laptops', components }) },
    { type: 'TOOL_CALL_END', toolCallId: 'c1' },
  ]);
  assert.deepEqual(written[0], building);
  assert.deepEqual(written.find((content) => content['status'] === 'retrying'), retrying);

  // Once the attempts run out the middleware turns the recovery envelope into the failed lifecycle; ours is that content.
  const failed = contents.at(-1)!;
  const exhausted = await middlewareActivity([
    { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'render_a2ui' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: JSON.stringify({ surfaceId: 'laptops', components }) },
    { type: 'TOOL_CALL_END', toolCallId: 'c1' },
    { type: 'TOOL_CALL_RESULT', messageId: 'tr-1', toolCallId: 'c1', content: JSON.stringify({ error: failed['error'], code: 'a2ui_recovery_exhausted', attempts: failed['attempts'] }) },
  ]);
  assert.deepEqual(exhausted.at(-1), failed);
});

// ---- sandbox probe -----------------------------------------------------------------------------------

test('sandbox probe: every refusal is reported at its position, the rest still draws, and every address is on the reserved host', async () => {
  const t = thread();
  await t.say(SHOWCASE.sandbox);
  const [id] = t.agent.messages.filter((message) => message.role === 'activity').map((message) => message.id);
  assert.match(String(id), /^a2ui-surface-sandbox-r-/);
  assert.deepEqual(t.ops(String(id)), json(sandboxProbe));

  const { surfaces, issues } = draw(sandboxProbe);
  // The intended findings, and only those: positions count from the start of the whole list.
  const first = sandboxProbe.findIndex((operation) => (operation as { createSurface?: { surfaceId?: string } }).createSurface?.surfaceId === 'ok');
  assert.deepEqual(
    issues.map((issue) => [issue.index! - first, issue.source, issue.message]),
    [
      [1, 'operation', 'This operation is not an object.'],
      [2, 'operation', 'This operation has no version and no v0.8 message name. A2UI v0.9 operations declare "version": "v0.9".'],
      [3, 'operation', 'This operation declares version v0.8. A2UI v0.9 operations declare "v0.9", and v0.8 messages have no version.'],
      [4, 'operation', 'Catalog not found: https://catalog.invalid/custom.json'],
      [5, 'operation', 'Surface not found for message: ghost'],
    ],
  );
  assert.deepEqual(surfaces.map((surface) => surface.id), ['media', 'plain', 'hologram', 'ok']);
  assert.equal(surfaces[3]!.componentsModel.get('root')?.properties['text'], 'Survivor');
  assert.equal(surfaces[1]!.componentsModel.get('root')?.properties['text'], MARKUP);
  // The unknown component is in the surface and not in the catalog: the renderer says so when it draws it.
  assert.equal(surfaces[2]!.componentsModel.get('hologram-1')?.type, 'Hologram');
  assert.equal(createBundledCatalog(() => undefined).components.has('Hologram'), false);
  // Media and openUrl are the existing fixtures: every address in the list is on a reserved host, so nothing it names can resolve.
  const addresses = (JSON.stringify(sandboxProbe).match(/https?:\/\/[^"\s)]+/g) ?? []).filter((address) => address !== BASIC_CATALOG_ID);
  assert.ok(addresses.length >= 5);
  assert.ok(addresses.every((address) => new URL(address).hostname.endsWith('.invalid')), addresses.join(' '));
  assert.ok(JSON.stringify(sandboxProbe).includes(THIRD_PARTY_HOST));
  clean(t);
});

// ---- nothing else leaves the module -----------------------------------------------------------------

test('no story names an address that could resolve, and outside the sandbox probe every operation speaks v0.9', async () => {
  for (const message of Object.values(SHOWCASE)) {
    const t = thread();
    await t.say(message);
    const everything = t.wires.join('');
    const addresses = (everything.match(/https?:\/\/[^"\\\s)]+/g) ?? []).filter((address) => address !== BASIC_CATALOG_ID);
    assert.ok(addresses.every((address) => new URL(address).hostname.endsWith('.invalid')), `${message}: ${addresses.join(' ')}`);
    const versions = new Set(everything.match(/\\?"version\\?":\\?"[^"\\]*/g));
    assert.deepEqual([...versions].every((version) => version.endsWith('v0.9')), message !== SHOWCASE.sandbox, message);
  }
});

// ---- the demo's configuration ---------------------------------------------------------------------------

test('the demo lists the showcase as the A2UI agent\'s quick messages, in order, and each one is answered', () => {
  const parsed = parseConfig(readFileSync(path.join(process.cwd(), 'demo', 'config.json'), 'utf8'));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  const agent = parsed.value.agents.find((candidate) => candidate.id === 'a2ui')!;
  assert.deepEqual(agent.preset!.quickMessages, [...Object.values(SHOWCASE), 'Show the order form']);
  assert.equal(agent.preset!.messages, 'turn');
  const bodies = agent.preset!.quickMessages!.map((message) => decoder.decode(Buffer.concat(a2uiResponse({ threadId: 't', runId: 'r-1', messages: [{ role: 'user', content: message }] }).chunks)));
  assert.equal(new Set(bodies).size, bodies.length, 'seven different answers');
  assert.match(String(agent.name), /^A2UI showcase/);

  // What it declares is what it does: it streams, calls no tool, and says what A2UI it speaks.
  const capabilities = agent.capabilities as Record<string, Record<string, unknown>>;
  assert.equal(capabilities.transport?.streaming, true);
  assert.equal(capabilities.tools?.supported, false);
  assert.deepEqual(capabilities.custom?.a2ui, { version: 'v0.9', catalog: 'basic', activityType: 'a2ui-surface', activityDeltas: true });
  for (const group of ['state', 'humanInTheLoop', 'multiAgent', 'reasoning']) assert.equal(capabilities[group], undefined, `${group} is not declared`);
});
