// L03 T032 (FR-019, US5.1): the current state and each delta's operations, the message-snapshot
// replacement marker, and projection errors that never cost raw evidence.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { JsonValue } from '../../src/contracts.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { applyJsonPatch } from '../../src/core/projection/patch.ts';
import { ConversationView } from '../../src/views/conversation/index.tsx';
import { StateView } from '../../src/views/conversation/state.tsx';
import { StateDetail, selectedIndex, summaryOf } from '../../src/views/conversation/state-history.tsx';
import { RUN_FINISHED, RUN_STARTED, harness, sessionOf } from './support.ts';

const snapshot = (value: object) => ({ type: 'STATE_SNAPSHOT', snapshot: value });
const delta = (...ops: object[]) => ({ type: 'STATE_DELTA', delta: ops });

function scripted(events: ReadonlyArray<object | string>, options: Parameters<typeof sessionOf>[1] = {}) {
  const h = harness();
  h.open('ex1', options);
  events.forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  h.close('ex1');
  return h;
}
const stateHtml = (h: ReturnType<typeof harness>) => renderToStaticMarkup(createElement(StateView, { store: h.store }));
/** One point of the history, rendered on its own: 0 is the newest change. */
const detailHtml = (h: ReturnType<typeof harness>, index: number) =>
  renderToStaticMarkup(createElement(StateDetail, { model: projectConversation(h.session()).state, index, frames: new Map(h.session().frames.map((frame) => [frame.id, frame])), onLatest() {} }));
const conversationHtml = (h: ReturnType<typeof harness>) =>
  renderToStaticMarkup(
    createElement(ConversationView, { store: h.store, interrupts: [], toolResults: [], onDraftInterrupt() {}, onAnswerInterrupt() {}, onDraftToolResult() {}, onSubmitToolResult() {}, onContinue() {} }),
  );

test('the current state is the last snapshot with every delta applied in order', () => {
  const model = projectConversation(
    sessionOf([
      RUN_STARTED,
      snapshot({ round: 0, items: ['a'], gone: true, name: 'x' }),
      delta({ op: 'add', path: '/items/-', value: 'b' }, { op: 'replace', path: '/round', value: 1 }),
      delta({ op: 'remove', path: '/gone' }, { op: 'move', from: '/name', path: '/title' }, { op: 'copy', from: '/title', path: '/alias' }, { op: 'test', path: '/round', value: 1 }),
      RUN_FINISHED,
    ]),
  );
  assert.deepEqual(model.state.current, { round: 1, items: ['a', 'b'], title: 'x', alias: 'x' });
  assert.deepEqual(model.state.changes.map((change) => change.type), ['STATE_DELTA', 'STATE_DELTA', 'STATE_SNAPSHOT'], 'newest first');
});

test('a later snapshot replaces the state and earlier deltas no longer matter', () => {
  const model = projectConversation(sessionOf([RUN_STARTED, snapshot({ a: 1 }), delta({ op: 'add', path: '/b', value: 2 }), snapshot({ c: 3 }), RUN_FINISHED]));
  assert.deepEqual(model.state.current, { c: 3 });
});

test('state carries across runs of the same thread and starts from the first run input', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1', state: { seeded: true } } });
  h.push('ex1', RUN_STARTED, 10);
  h.push('ex1', delta({ op: 'add', path: '/a', value: 1 }), 20);
  h.push('ex1', RUN_FINISHED, 30);
  h.close('ex1');
  h.open('ex2', { input: { threadId: 't1', runId: 'r2', state: { seeded: true, a: 1 } } });
  h.push('ex2', { type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, 10);
  h.push('ex2', delta({ op: 'add', path: '/b', value: 2 }), 20);
  assert.deepEqual(projectConversation(h.session()).state.current, { seeded: true, a: 1, b: 2 });
});

test('a new thread starts from its own state: the earlier thread is retained but not current', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 'old', runId: 'r1', state: {} } });
  h.push('ex1', { type: 'RUN_STARTED', threadId: 'old', runId: 'r1' }, 10);
  h.push('ex1', snapshot({ old: true }), 20);
  h.close('ex1');
  h.open('ex2', { input: { threadId: 'new', runId: 'r2', state: {} } });
  h.push('ex2', { type: 'RUN_STARTED', threadId: 'new', runId: 'r2' }, 10);
  const model = projectConversation(h.session());
  assert.equal(model.threadId, 'new');
  assert.deepEqual(model.state.current, {});
  assert.deepEqual(model.state.changes, []);
  assert.equal(h.session().exchanges.length, 2, 'the earlier exchange is still in the session');
  assert.equal(h.session().frames.filter((frame) => frame.eventType === 'STATE_SNAPSHOT').length, 1, 'and so is its evidence');
});

test('each delta lists its operations with op, path and value', () => {
  const h = scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 }, { op: 'move', from: '/a', path: '/b' })]);
  const html = stateHtml(h);
  assert.match(html, /Sent as state in the next run/);
  assert.match(html, /aria-label="Delta operations"/);
  assert.match(html, /replace<\/span><span class="agui-conv-mono">\/n<\/span>.*?2/);
  assert.match(html, /from \/a/);
  assert.ok(html.lastIndexOf('STATE_DELTA') < html.lastIndexOf('STATE_SNAPSHOT'), 'the history lists the newest change first');
});

test('a delta that cannot be applied is shown with its error, the state stays valid and the evidence is untouched', () => {
  const h = scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/missing', value: 2 }), delta({ op: 'add', path: '/ok', value: true })]);
  const before = JSON.stringify(h.session().frames);
  const model = projectConversation(h.session());
  assert.deepEqual(model.state.current, { n: 1, ok: true }, 'later deltas still apply to the last valid state');
  assert.deepEqual(model.state.changes.map((change) => change.applied), [true, false, true]);
  assert.match(model.state.changes[1]?.error ?? '', /replace/);
  assert.equal(model.issues.length, 1);

  assert.match(stateHtml(h), /not applied/, 'the history row says so');
  const html = detailHtml(h, 1);
  assert.match(html, /last valid one/);
  assert.match(html, /No net change\./);
  assert.equal(JSON.stringify(h.session().frames), before, 'projection never writes to the raw frames');
  const failed = h.session().frames.find((frame) => frame.eventType === 'STATE_DELTA')!;
  assert.equal(failed.schemaVerdict, 'valid', 'a delta that does not fit the state is still a valid, received frame');
});

test('with no state event and no run input there is no state to show', () => {
  const html = stateHtml(scripted([RUN_STARTED, RUN_FINISHED]));
  assert.match(html, /No state yet/);
});

test('state values are shown as data, never interpreted', () => {
  const html = stateHtml(scripted([RUN_STARTED, snapshot({ note: '<script>alert(1)</script>' })]));
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;/);
});

// ---- message snapshots ----

test('a message snapshot replaces the transcript, with a marker that lists added and removed messages', () => {
  const h = scripted([
    RUN_STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'old', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'old', delta: 'before the snapshot' },
    { type: 'TEXT_MESSAGE_END', messageId: 'old' },
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'old', role: 'assistant', content: 'before the snapshot' }, { id: 'fresh', role: 'user', content: 'new message' }] },
  ]);
  const model = projectConversation(h.session());
  const marker = model.entries.find((entry) => entry.kind === 'snapshot');
  assert.ok(marker && marker.kind === 'snapshot');
  assert.deepEqual(marker.added.map((message) => message.id), ['fresh']);
  assert.deepEqual(marker.removed, []);
  assert.equal(marker.count, 2);
  const html = conversationHtml(h);
  assert.match(html, /Transcript replaced by MESSAGES_SNAPSHOT/);
  assert.match(html, /1 added/);
  assert.match(html, /0 removed/);
  assert.match(html, /new message/);
});

test('messages the snapshot leaves out are listed as removed, with their text', () => {
  const h = scripted([
    RUN_STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'gone', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'gone', delta: 'dropped text' },
    { type: 'TEXT_MESSAGE_END', messageId: 'gone' },
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'kept', role: 'user', content: 'only this' }] },
  ]);
  const marker = projectConversation(h.session()).entries.find((entry) => entry.kind === 'snapshot');
  assert.ok(marker && marker.kind === 'snapshot');
  assert.deepEqual(marker.removed.map((message) => [message.id, message.role, message.text]), [['gone', 'assistant', 'dropped text']]);
  assert.equal(projectConversation(h.session()).entries.some((entry) => entry.kind === 'message' && entry.messageId === 'gone'), false, 'the replaced message leaves the transcript');
});

test('snapshot messages carry their tool calls and results', () => {
  const model = projectConversation(
    sessionOf([
      RUN_STARTED,
      {
        type: 'MESSAGES_SNAPSHOT',
        messages: [
          { id: 'a', role: 'assistant', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":1}' } }] },
          { id: 't', role: 'tool', toolCallId: 'c1', content: 'found' },
        ],
      },
    ]),
  );
  const tool = model.entries.find((entry) => entry.kind === 'tool');
  assert.ok(tool && tool.kind === 'tool');
  assert.deepEqual([tool.name, tool.argsParsed, tool.result?.content, tool.result?.origin], ['lookup', { q: 1 }, 'found', 'snapshot']);
});

// ---- conversation view output ----

test('projection issues are shown with a pointer to the frame, and the frame stays in the frames list', () => {
  const h = scripted([RUN_STARTED, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ghost', delta: 'x' }]);
  const html = conversationHtml(h);
  assert.match(html, /never started/);
  assert.match(html, /still in the frames list/);
  assert.equal(h.session().frames.some((frame) => frame.eventType === 'TEXT_MESSAGE_CONTENT'), true);
});

test('text is escaped, never parsed as markup or markdown', () => {
  const payload = '<img src=x onerror=alert(1)> **bold** <script>x</script>';
  const h = scripted([RUN_STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: payload }]);
  const html = conversationHtml(h);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; \*\*bold\*\*/);
  assert.equal(html.includes('<strong>'), false);
});

test('encrypted reasoning shows subtype, entity and size, says it is not decoded, and never prints the value', () => {
  const value = 'c3ludGhldGljLW9wYXF1ZQ==';
  const h = scripted([RUN_STARTED, { type: 'REASONING_ENCRYPTED_VALUE', subtype: 'message', entityId: 'rs1', encryptedValue: value }]);
  const html = conversationHtml(h);
  assert.match(html, /Encrypted reasoning/);
  assert.match(html, /message/);
  assert.match(html, /rs1/);
  assert.match(html, /24 bytes/);
  assert.match(html, /not decoded/);
  assert.equal(html.includes(value), false);
  assert.equal(html.includes(Buffer.from(value, 'base64').toString('utf8')), false, 'and no decoded form either');
});

test('applying a patch never changes the document it was given', () => {
  const document: JsonValue = { a: { b: [1] } };
  applyJsonPatch(document, [{ op: 'add', path: '/a/b/-', value: 2 }]);
  assert.deepEqual(document, { a: { b: [1] } });
});

// ---- state history: the diff, the rows and a past point (specs/010-state-history) ----

const KINDS_RUN = [
  RUN_STARTED,
  snapshot({ round: 0, items: ['a'], gone: true, name: 'x' }),
  delta({ op: 'add', path: '/items/-', value: 'b' }, { op: 'replace', path: '/round', value: 1 }, { op: 'remove', path: '/gone' }, { op: 'move', from: '/name', path: '/title' }, { op: 'copy', from: '/title', path: '/alias' }, { op: 'test', path: '/round', value: 1 }),
];

test('each difference carries its kind as a word and a sign, so removing color loses nothing', () => {
  const html = detailHtml(scripted(KINDS_RUN), 0);
  for (const label of ['+ added', '- removed', '~ changed']) assert.ok(html.includes(label), label);
  assert.match(html, /aria-label="State diff"/);
  const kinds = [...html.matchAll(/data-kind="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(kinds.sort(), ['added', 'added', 'added', 'changed', 'removed', 'removed'], 'the net effect of six operations: a move is a removal and an addition, a copy an addition, a test nothing');
  assert.match(html, /\/items\/1/);
  assert.match(html, /was<\/span>.*?0.*?now<\/span>.*?1/, 'a change shows the value before and after');
});

test('a delta with no net effect says so, and a snapshot shows what it replaced', () => {
  const h = scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 1 }), snapshot({ c: 3 })]);
  assert.match(detailHtml(h, 1), /No net change\./);
  assert.doesNotMatch(detailHtml(h, 1), /aria-label="State diff"/);
  const replaced = detailHtml(h, 0);
  assert.deepEqual([...replaced.matchAll(/data-kind="(\w+)"/g)].map((match) => match[1]), ['removed', 'added']);
  assert.match(replaced, /\/n/);
  assert.match(replaced, /\/c/);
});

test('the first state of a thread is shown in full without a diff', () => {
  const html = detailHtml(scripted([RUN_STARTED, snapshot({ a: 1 }), delta({ op: 'add', path: '/b', value: 2 })]), 1);
  assert.match(html, /First state of the thread\. Shown in full\./);
  assert.doesNotMatch(html, /agui-conv-diffs|No net change/);
  assert.match(html, /&quot;a&quot;/);
});

test('a long value is shortened and the full value stays out of the page until it is opened', () => {
  const long = 'x'.repeat(200);
  const html = detailHtml(scripted([RUN_STARTED, snapshot({}), delta({ op: 'add', path: '/note', value: long })]), 0);
  const diff = html.slice(html.indexOf('aria-label="State diff"'), html.indexOf('</ul>', html.indexOf('aria-label="State diff"')));
  assert.ok(diff.includes(`${'x'.repeat(79)}…`), 'the first 80 characters of the JSON text, quote included');
  assert.equal(diff.includes('x'.repeat(80)), false, 'the diff does not hold the full value while the disclosure is closed');
  assert.match(diff, /<details/);
  const operations = html.slice(html.indexOf('aria-label="Delta operations"'));
  assert.equal(operations.includes('x'.repeat(80)), false, 'nor do the operations');
});

test('a diff of more than 100 differences shows 100 and a button for the rest', () => {
  const wide = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`k${i}`, i]));
  const html = detailHtml(scripted([RUN_STARTED, snapshot({}), snapshot(wide)]), 0);
  assert.equal([...html.matchAll(/data-kind="added"/g)].length, 100);
  assert.match(html, /<button[^>]*>Show 150 more<\/button>/);
});

test('the operations show with each delta and the derived note is on every point', () => {
  const h = scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 }, { op: 'add', path: '/m', value: 3 })]);
  const latest = detailHtml(h, 0);
  assert.match(latest, /Operations \(2\)/);
  assert.match(latest, /aria-label="Delta operations"/);
  assert.match(latest, /Derived from the snapshots and deltas below/);
  assert.match(latest, /aria-label="Current state"/);
  assert.match(detailHtml(h, 1), /Derived from the recorded frames, not received/);
  assert.doesNotMatch(detailHtml(h, 1), /Delta operations/, 'a snapshot has no operations');
});

test('every row says what its change did, from its operations alone', () => {
  const model = projectConversation(
    sessionOf([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 }), delta({ op: 'replace', path: '/n', value: 3 }, { op: 'add', path: '/m', value: 1 }), delta()]),
  );
  assert.deepEqual(model.state.changes.map(summaryOf), ['Empty delta', 'replace /n and 1 more', 'replace /n', 'Replaced the state']);
  const html = stateHtml(scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 })]));
  assert.match(html, /role="listbox" aria-label="State history"/);
  assert.match(html, /role="option" aria-selected="true"/);
  assert.match(html, /Replaced the state/);
});

test('the latest point is the current state and says so, with no banner', () => {
  const h = scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 })]);
  const html = stateHtml(h);
  assert.match(html, /data-point="latest"/);
  assert.match(html, /Current state/);
  assert.match(html, /Sent as state in the next run/);
  assert.doesNotMatch(html, /state-banner|Past state|Back to latest/);
});

test('a past point shows its own state and diff, says it is a past state and offers the way back', () => {
  const h = scripted([RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 }), delta({ op: 'replace', path: '/n', value: 3 })]);
  const html = detailHtml(h, 1);
  assert.match(html, /data-point="past"/);
  assert.match(html, /data-part="state-banner"/);
  assert.match(html, /Past state/);
  assert.match(html, /1 newer change</);
  assert.match(html, /<button[^>]*>Back to latest<\/button>/);
  assert.match(html, /State after STATE_DELTA/);
  assert.match(html, /aria-label="State at the selected point"/);
  assert.match(html, /&quot;n&quot;<\/span><span class="agui-j-p">:<\/span> <span class="agui-j-n">2</);
  assert.doesNotMatch(html, /Sent as state in the next run/);
  assert.match(detailHtml(h, 2), /2 newer changes/);
});

test('the starting state is the oldest point, shown in full without a diff', () => {
  const h = scripted([RUN_STARTED, delta({ op: 'add', path: '/a', value: 1 })], { input: { threadId: 't1', runId: 'r1', state: { seeded: true } } });
  const html = detailHtml(h, 1);
  assert.match(html, /Starting state/);
  assert.match(html, /seeded/);
  assert.doesNotMatch(html, /agui-conv-diffs|No net change|First state/);
  assert.match(stateHtml(h), /Starting state/);
});

test('a snapshot between delta groups gives the right state at each point', () => {
  const h = scripted([RUN_STARTED, snapshot({ a: 1 }), delta({ op: 'add', path: '/b', value: 2 }), snapshot({ c: 3 }), delta({ op: 'add', path: '/d', value: 4 })]);
  const has = (index: number, key: string) => detailHtml(h, index).includes(`&quot;${key}&quot;`);
  assert.deepEqual([has(0, 'c'), has(0, 'd'), has(0, 'a')], [true, true, false]);
  assert.deepEqual([has(1, 'c'), has(1, 'd')], [true, false]);
  assert.deepEqual([has(2, 'a'), has(2, 'b'), has(2, 'c')], [true, true, false]);
});

test('a stored selection becomes an index: none or a missing key is the newest point, and it grows as newer changes arrive', () => {
  const h = harness();
  h.open('ex1', { input: { threadId: 't1', runId: 'r1', state: {} } });
  [RUN_STARTED, snapshot({ n: 1 }), delta({ op: 'replace', path: '/n', value: 2 }), delta({ op: 'replace', path: '/n', value: 3 })].forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  const state = projectConversation(h.session()).state;
  const key = state.changes[2]?.frameId;
  assert.equal(selectedIndex(state, undefined), 0);
  assert.equal(selectedIndex(state, 'gone'), 0);
  assert.equal(selectedIndex(state, key), 2);
  assert.equal(selectedIndex(state, 'start'), 3, 'the starting state is the oldest point');
  h.push('ex1', delta({ op: 'replace', path: '/n', value: 4 }), 100);
  assert.equal(selectedIndex(projectConversation(h.session()).state, key), 3, 'one newer change pushes the same change one row down');
});

test('a thread without a starting state has no starting-state key', () => {
  const state = projectConversation(sessionOf([RUN_STARTED, snapshot({ a: 1 })])).state;
  assert.equal(selectedIndex(state, 'start'), 0);
});
