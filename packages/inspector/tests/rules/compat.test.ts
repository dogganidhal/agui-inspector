// F07 T025 (FR-013, FR-016, FR-022): the older event versions the client accepts. `upgradeFrame` mirrors the compatibility
// step of @ag-ui/client 1.0.1 on a copy. This test is what keeps the mirror honest: every shape goes through the real
// HttpAgent, which must accept it, and the copy must equal the event the client delivers. A client bump that changes
// what the client upgrades fails here, in either direction.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HttpAgent } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import { eventFixtures } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { sse } from '../runtime/support.ts';
import { upgradeFrame } from '../../src/core/rules/frame-rules.ts';
import type { CatalogueRuleId } from '../../src/core/rules/catalogue.ts';

const T = 't-compat';
const R = 'r-compat';
const S = { type: 'RUN_STARTED', threadId: T, runId: R };
const F = { type: 'RUN_FINISHED', threadId: T, runId: R };
const input = (extra: object) => ({ threadId: T, runId: R, state: {}, messages: [], tools: [], context: [], forwardedProps: {}, ...extra });
const png = { type: 'image', source: { type: 'data', value: 'AAAA', mimeType: 'image/png' } };

interface Played {
  readonly failure: string | undefined;
  readonly delivered: readonly Record<string, unknown>[];
  readonly warnings: readonly string[];
}

/** The real client reads the events from a stub fetch, as the page's client reads a response. */
async function play(events: readonly object[]): Promise<Played> {
  const warnings: string[] = [];
  const warn = console.warn;
  const error = console.error;
  console.warn = (...parts: unknown[]) => void warnings.push(parts.join(' '));
  console.error = () => undefined;
  let failure: string | undefined;
  const delivered: Record<string, unknown>[] = [];
  try {
    const agent = new HttpAgent({ url: 'https://agent.example/run', threadId: T, fetch: async () => new Response(sse(events), { status: 200 }) });
    await agent.runAgent(
      { runId: R },
      {
        onEvent: ({ event }) => void delivered.push(event as unknown as Record<string, unknown>),
        onRunFailed: ({ error: reason }) => void (failure = reason instanceof Error ? `${reason.name}: ${reason.message.slice(0, 120)}` : String(reason)),
      },
    );
  } catch {
    // The failure reached the subscriber too.
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return { failure, delivered, warnings };
}

/** The ids that the client mints for converted THINKING events differ from the copy's placeholder; nothing else may. */
const sameUpToIds = (value: unknown): unknown => {
  const text = JSON.stringify(value, (key, nested) => (key === 'messageId' && typeof nested === 'string' && /^(upgraded-thinking-event|[0-9a-f]{8}-[0-9a-f-]{27})$/.test(nested) ? '<minted>' : nested));
  return JSON.parse(text);
};

interface Shape {
  readonly name: string;
  /** The whole stream, with its own RUN_STARTED and RUN_FINISHED. */
  readonly events: readonly object[];
  /** For each event of the stream, the compat rules that apply to it. */
  readonly rules: readonly (readonly CatalogueRuleId[])[];
  /** False when the client expands the event (a chunk), so the delivered events are not one for one. */
  readonly compare?: boolean;
}

const nothing: CatalogueRuleId[] = [];
const SHAPES: readonly Shape[] = [
  {
    name: 'the five THINKING events, with a title on the first',
    events: [S, { type: 'THINKING_START', title: 'planning' }, { type: 'THINKING_TEXT_MESSAGE_START' }, { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'hm' }, { type: 'THINKING_TEXT_MESSAGE_END' }, { type: 'THINKING_END' }, { ...F, outcome: { type: 'success' } }],
    rules: [nothing, ['compat.retired-event-type'], ['compat.retired-event-type'], ['compat.retired-event-type'], ['compat.retired-event-type'], ['compat.retired-event-type'], nothing],
  },
  { name: 'RUN_FINISHED with result null', events: [S, { ...F, result: null }], rules: [nothing, ['compat.null-optional-field']] },
  { name: 'RUN_FINISHED with outcome null', events: [S, { ...F, outcome: null }], rules: [nothing, ['compat.null-optional-field']] },
  { name: 'RUN_FINISHED with result and outcome null', events: [S, { ...F, result: null, outcome: null }], rules: [nothing, ['compat.null-optional-field']] },
  { name: 'rawEvent null on RUN_STARTED', events: [{ ...S, rawEvent: null }, F], rules: [['compat.null-optional-field'], nothing] },
  { name: 'rawEvent null on CUSTOM', events: [S, { type: 'CUSTOM', name: 'n', value: 1, rawEvent: null }, F], rules: [nothing, ['compat.null-optional-field'], nothing] },
  { name: 'TOOL_CALL_START with parentMessageId null', events: [S, { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'x', parentMessageId: null }, { type: 'TOOL_CALL_END', toolCallId: 'c1' }, F], rules: [nothing, ['compat.null-optional-field'], nothing, nothing] },
  { name: 'TOOL_CALL_CHUNK with parentMessageId null', events: [S, { type: 'TOOL_CALL_CHUNK', toolCallId: 'c1', toolCallName: 'x', delta: '{}', parentMessageId: null }, F], rules: [nothing, ['compat.null-optional-field'], nothing], compare: false },
  { name: 'SUBAGENT_FINISHED with result null', events: [S, { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'n' }, { type: 'SUBAGENT_FINISHED', subagentRunId: 's1', result: null }, F], rules: [nothing, nothing, ['compat.null-optional-field'], nothing] },
  { name: 'RUN_STARTED.input.forwardedProps null', events: [{ ...S, input: input({ forwardedProps: null }) }, F], rules: [['compat.null-optional-field'], nothing] },
  { name: 'RUN_STARTED.input tool parameters null', events: [{ ...S, input: input({ tools: [{ name: 'a', description: 'd', parameters: null }] }) }, F], rules: [['compat.null-optional-field'], nothing] },
  { name: 'RUN_STARTED.input resume payload null', events: [{ ...S, input: input({ resume: [{ interruptId: 'i1', status: 'resolved', payload: null }] }) }, F], rules: [['compat.null-optional-field'], nothing] },
  { name: 'RUN_STARTED.input image part with metadata null', events: [{ ...S, input: input({ messages: [{ id: 'u1', role: 'user', content: [{ ...png, metadata: null }] }] }) }, F], rules: [['compat.null-optional-field'], nothing] },
  { name: 'MESSAGES_SNAPSHOT image part with metadata null', events: [S, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ ...png, metadata: null }] }] }, F], rules: [nothing, ['compat.null-optional-field'], nothing] },
  { name: 'RUN_STARTED.input binary part with data', events: [{ ...S, input: input({ messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'image/png', data: 'AAAA' }] }] }) }, F], rules: [['compat.legacy-binary-content'], nothing] },
  { name: 'MESSAGES_SNAPSHOT binary part with data', events: [S, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'image/png', data: 'AAAA' }] }] }, F], rules: [nothing, ['compat.legacy-binary-content'], nothing] },
  { name: 'MESSAGES_SNAPSHOT binary part with url and filename', events: [S, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'application/pdf', url: 'https://x.example/y.pdf', filename: 'y.pdf' }] }] }, F], rules: [nothing, ['compat.legacy-binary-content'], nothing] },
  { name: 'MESSAGES_SNAPSHOT binary parts of audio and video type', events: [S, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'audio/mpeg', data: 'AAAA' }, { type: 'binary', mimeType: 'video/mp4', url: 'https://x.example/v.mp4' }] }] }, F], rules: [nothing, ['compat.legacy-binary-content'], nothing] },
  { name: 'MESSAGES_SNAPSHOT binary part that the message already holds as a media part', events: [S, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [png, { type: 'binary', mimeType: 'image/png', data: 'AAAA' }] }] }, F], rules: [nothing, ['compat.legacy-binary-content'], nothing] },
  { name: 'a message with a metadata null and a binary part', events: [S, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ ...png, metadata: null }, { type: 'binary', mimeType: 'image/jpeg', data: 'BBBB' }] }] }, F], rules: [nothing, ['compat.null-optional-field', 'compat.legacy-binary-content'], nothing] },
];

for (const shape of SHAPES) {
  test(`${shape.name}: the client accepts it, and the upgraded copy is what the client delivers`, async () => {
    const played = await play(shape.events);
    assert.equal(played.failure, undefined, 'the real client accepts the stream');
    assert.ok(played.warnings.some((line) => line.includes('[ag-ui][compat]')), 'and says that it upgraded something');

    const upgraded = shape.events.map((event) => upgradeFrame(event));
    assert.deepEqual(upgraded.map((result) => result.hits.map((hit) => hit.rule)), shape.rules);
    if (shape.compare !== false) {
      assert.equal(played.delivered.length, shape.events.length, 'one delivered event for each event of the stream');
      assert.deepEqual(sameUpToIds(upgraded.map((result) => result.value)), sameUpToIds(played.delivered));
    }
    // Every message names a field or a type, never a value.
    for (const { hits } of upgraded) for (const hit of hits) assert.ok(hit.message.length < 400 && !/AAAA|BBBB|synthetic/.test(hit.message), hit.message);
  });
}

const REJECTED: ReadonlyArray<readonly [string, readonly object[]]> = [
  ['metadata null on an event', [S, { type: 'CUSTOM', name: 'n', value: 1, metadata: null }, F]],
  ['subagentRunId null', [S, { type: 'CUSTOM', name: 'n', value: 1, subagentRunId: null }, F]],
  ['a string outcome', [S, { ...F, outcome: 'success' }]],
  ['a float timestamp', [S, { type: 'CUSTOM', name: 'n', value: 1, timestamp: 1.5 }, F]],
];

for (const [name, events] of REJECTED) {
  test(`${name}: the client rejects it, so the copy is not upgraded and no compat rule applies`, async () => {
    const played = await play(events);
    assert.notEqual(played.failure, undefined, 'the real client rejects the stream');
    for (const event of events) {
      const { value, hits } = upgradeFrame(event);
      assert.equal(value, event, 'the same object: nothing to copy');
      assert.deepEqual(hits, []);
    }
  });
}

test('a binary part with only an id: the client cannot convert it and strips it with a warning, so the copy is not upgraded and the frame stays a schema failure', async () => {
  const snapshot = { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'image/png', id: 'file-1' }] }] };
  const played = await play([S, snapshot, F]);
  assert.equal(played.failure, undefined, 'the run goes on');
  assert.ok(played.warnings.some((line) => line.includes('cannot be converted to a modern media part')));
  assert.deepEqual((played.delivered[1] as { messages: Array<{ content: unknown[] }> }).messages[0]!.content, [], 'what the client keeps has no part');
  const { value, hits } = upgradeFrame(snapshot);
  assert.equal(value, snapshot);
  assert.deepEqual(hits, [], 'no compat rule: nothing was converted');
});

const VERSIONS: ReadonlyArray<readonly [string | undefined, CatalogueRuleId | undefined]> = [
  [undefined, undefined],
  ['1.0', undefined],
  ['0.9', undefined],
  ['0.0.39', 'compat.protocol-version-unreadable'],
  ['1.1', 'compat.protocol-version-newer'],
  ['2.0', 'compat.protocol-version-newer'],
  ['10.0', 'compat.protocol-version-newer'],
  ['1.0.1', 'compat.protocol-version-unreadable'],
  ['1', 'compat.protocol-version-unreadable'],
  ['abc', 'compat.protocol-version-unreadable'],
  ['v1.0', 'compat.protocol-version-unreadable'],
  ['', 'compat.protocol-version-unreadable'],
];

for (const [declared, rule] of VERSIONS) {
  test(`protocolVersion ${declared === undefined ? 'absent' : JSON.stringify(declared)}: ${rule ?? 'no finding'}, and the client warns exactly when there is one`, async () => {
    const started = { ...S, ...(declared !== undefined && { protocolVersion: declared }) };
    const played = await play([started, F]);
    assert.equal(played.failure, undefined, 'no version fails the run');
    const warned = played.warnings.some((line) => line.includes('cannot interpret') || line.includes('Unrecognised material'));
    assert.equal(warned, rule !== undefined, played.warnings.join(' | '));
    assert.deepEqual(upgradeFrame(started).hits.map((hit) => hit.rule), rule === undefined ? [] : [rule]);
    assert.equal(upgradeFrame(started).value, started, 'a version rule changes nothing');
  });
}

test('a clean frame costs no copy, and a frame that is upgraded is never changed in place', () => {
  for (const type of Object.values(EventType)) {
    const event = eventFixtures[type];
    assert.equal(upgradeFrame(event).value, event, `${type} is returned as it is`);
    assert.deepEqual(upgradeFrame(event).hits, [], type);
  }
  const deepFreeze = <T>(value: T): T => {
    if (typeof value === 'object' && value !== null) for (const nested of Object.values(value)) deepFreeze(nested);
    return Object.freeze(value);
  };
  for (const shape of SHAPES) {
    for (const event of shape.events) {
      const frozen = deepFreeze(structuredClone(event));
      const before = JSON.stringify(frozen);
      upgradeFrame(frozen);
      assert.equal(JSON.stringify(frozen), before, shape.name);
    }
  }
});

test('data that is not an event object is returned as it is', () => {
  for (const value of [null, 42, 'THINKING_START', [{ type: 'THINKING_START' }], { type: 7 }, {}]) {
    const result = upgradeFrame(value);
    assert.equal(result.value, value);
    assert.deepEqual(result.hits, []);
  }
});

test('many nulls are listed once, with the first few paths and a count, and a deep value costs no stack', () => {
  const tools = Array.from({ length: 50 }, (_, index) => ({ name: `t${index}`, description: 'd', parameters: null }));
  const { hits } = upgradeFrame({ ...S, input: input({ tools }) });
  assert.deepEqual(hits.map((hit) => hit.rule), ['compat.null-optional-field']);
  assert.match(hits[0]!.message, /RUN_STARTED\.input\.tools\[0\]\.parameters, .*tools\[4\]\.parameters and 45 more are null/);

  let deep: unknown = 'leaf';
  for (let level = 0; level < 5_000; level += 1) deep = { next: deep };
  assert.deepEqual(upgradeFrame({ type: 'CUSTOM', name: 'n', value: deep }).hits, []);
});
