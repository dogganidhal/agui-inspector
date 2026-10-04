// L04 T034 (FR-010, FR-012, FR-017; US1.2 to US1.4): the frames view model and its markup.
// The model is plain TypeScript; the markup is checked as static HTML, and the interactive
// behavior (typing, clicking, copying) is covered by tests/e2e/inspection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventType } from '@ag-ui/core';
import { futureEventFrame, garbageFrame } from '../../../../examples/reference-agent/protobuf-fixtures.ts';
import { frameProtobuf } from '../../../../examples/reference-agent/protobuf.ts';
import { recorderScenarios, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { InspectionSession, RawFrame } from '../../src/contracts.ts';
import { createProtobufFrameReader } from '../../src/core/frames/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import {
  FAMILIES,
  NO_FILTER,
  copyFramesJson,
  exchangeRows,
  familyOf,
  frameMatches,
  indexSession,
  isFiltering,
  listExchanges,
  receivedSize,
  summarizeFrame,
  typeLabel,
  type FrameFilter,
} from '../../src/views/inspection/model.ts';
import { FramesPanel } from '../../src/views/inspection/frames.tsx';
import { capture, conversationRequest, eventFixtures, invalidCases, richSession, wireOf, wireScenario } from './support.ts';

const TYPES = Object.keys(eventFixtures);
const filter = (patch: Partial<FrameFilter>): FrameFilter => ({ ...NO_FILTER, ...patch });

/** One real frame for each fixture, taken through the recorder, reader and store. */
async function framesByType(): Promise<Map<string, RawFrame>> {
  const store = await capture(wireScenario('all', conversationRequest('{}'), wireOf(...TYPES.map((type) => JSON.stringify(eventFixtures[type as keyof typeof eventFixtures])))));
  return new Map(store.snapshot().frames.map((frame) => [frame.eventType!, frame]));
}

const expectedSummaries: Record<string, string> = {
  RUN_STARTED: 'r-proto',
  RUN_FINISHED: 'success',
  RUN_ERROR: 'synthetic_error · synthetic failure',
  STEP_STARTED: 'plan',
  STEP_FINISHED: 'plan',
  TEXT_MESSAGE_START: 'm1 · assistant',
  TEXT_MESSAGE_CONTENT: 'm1 "héllo wörld, 你好 🙂"',
  TEXT_MESSAGE_END: 'm1',
  TEXT_MESSAGE_CHUNK: 'm2 "héllo wörld, 你好 🙂"',
  TOOL_CALL_START: 'search_documents · tc1',
  TOOL_CALL_ARGS: 'tc1 "{\\"query\\":\\"synthetic\\"}"',
  TOOL_CALL_END: 'tc1',
  TOOL_CALL_CHUNK: 'fetch_resource · tc2 "{\\"resource\\":\\"synthetic\\"}"',
  TOOL_CALL_RESULT: 'tc1 → synthetic result',
  REASONING_START: 'rs1',
  REASONING_MESSAGE_START: 'rs1 · reasoning',
  REASONING_MESSAGE_CONTENT: 'rs1 "héllo wörld, 你好 🙂"',
  REASONING_MESSAGE_END: 'rs1',
  REASONING_MESSAGE_CHUNK: 'rs2 "héllo wörld, 你好 🙂"',
  REASONING_END: 'rs1',
  REASONING_ENCRYPTED_VALUE: 'message · rs1 · 24 B · not decoded',
  STATE_SNAPSHOT: 'snapshot · round, items',
  STATE_DELTA: 'add /round',
  MESSAGES_SNAPSHOT: '2 messages',
  ACTIVITY_SNAPSHOT: 'synthetic-progress · act1',
  ACTIVITY_DELTA: 'synthetic-progress · 1 op',
  SUBAGENT_STARTED: 'synthetic-researcher · sub1',
  SUBAGENT_FINISHED: 'sub1',
  SUBAGENT_ERROR: 'sub2 · synthetic subagent failure',
  CUSTOM: 'synthetic.custom = {"note":"custom"}',
  RAW: 'synthetic',
};

test('all 31 event types have a frames-list summary, family and type label', async () => {
  assert.equal(TYPES.length, 31);
  assert.deepEqual(TYPES.slice().sort(), Object.values(EventType).slice().sort());
  const frames = await framesByType();
  for (const type of TYPES) {
    const frame = frames.get(type);
    assert.ok(frame, `${type} frame captured`);
    assert.equal(frame.schemaVerdict, 'valid', `${type} fixture is valid`);
    assert.equal(summarizeFrame(frame), expectedSummaries[type], `${type} summary`);
    assert.equal(typeLabel(frame), type);
    assert.ok(familyOf(type), `${type} has a family`);
  }
  assert.deepEqual(Object.keys(expectedSummaries).sort(), TYPES.slice().sort());
});

test('families group the 31 types as the design lists them, and run, step, subagent and custom stay neutral', () => {
  assert.deepEqual(FAMILIES.map((family) => family.key), ['run', 'step', 'text', 'tool', 'reasoning', 'state', 'activity', 'subagent', 'ext']);
  const grouped = new Map<string, string[]>();
  for (const type of TYPES) grouped.set(familyOf(type)!, [...(grouped.get(familyOf(type)!) ?? []), type]);
  assert.deepEqual(grouped.get('run'), ['RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR']);
  assert.deepEqual(grouped.get('state'), ['STATE_SNAPSHOT', 'STATE_DELTA', 'MESSAGES_SNAPSHOT']);
  assert.deepEqual(grouped.get('ext'), ['CUSTOM', 'RAW']);
  // Only the 31 baseline types belong to a family; anything else is reachable by search and by the issues filter.
  assert.equal(familyOf('SOMETHING_NEW'), undefined);
  assert.equal(familyOf(undefined), undefined);
  for (const family of FAMILIES) assert.equal(family.hollow, ['run', 'step', 'subagent', 'ext'].includes(family.key));
});

test('the run summaries name outcomes, interrupts, pending tool calls and parents', async () => {
  const wire = [
    { type: 'RUN_STARTED', threadId: 't', runId: 'r2', parentRunId: 'r1' },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r2', outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }, { id: 'i2', reason: 'approval' }] } },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r2', outcome: { type: 'success', pendingToolCallIds: ['a', 'b', 'c'] } },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r2', outcome: { type: 'success', pendingToolCallIds: ['a'] } },
    { type: 'RUN_FINISHED', threadId: 't', runId: 'r2', outcome: { type: 'cancelled' } },
    { type: 'RUN_ERROR', message: 'x'.repeat(100) },
  ].map((event) => JSON.stringify(event));
  const store = await capture(wireScenario('runs', conversationRequest('{}'), wireOf(...wire)));
  assert.deepEqual(
    store.snapshot().frames.map(summarizeFrame),
    ['r2  ← r1', 'interrupt · 2 waiting', 'success · 3 pending tool calls', 'success · 1 pending tool call', 'cancelled', `${'x'.repeat(55)}…`],
  );
});

test('long values are cut at about 56 characters and newlines stay escaped', async () => {
  const store = await capture(
    wireScenario('long', conversationRequest('{}'), wireOf(JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: `line one\nline two ${'y'.repeat(100)}` }))),
  );
  const summary = summarizeFrame(store.snapshot().frames[0]!);
  assert.match(summary, /^m1 "line one\\nline two y+…"$/);
  assert.ok(summary.length <= 'm1 '.length + 56 + 3);
});

test('malformed frames keep their evidence and are summarized without trusting their shape', async () => {
  const store = await capture(
    wireScenario(
      'malformed',
      conversationRequest('{}'),
      wireOf(
        invalidCases.prose.data,
        invalidCases.truncatedJson.data,
        invalidCases.unknownType.data,
        invalidCases.wrongFieldType.data,
        invalidCases.missingField.data,
        invalidCases.noType.data,
        invalidCases.notAnObject.data,
        invalidCases.jsonNull.data,
        invalidCases.jsonArray.data,
        invalidCases.emptyData.data,
      ),
    ),
  );
  const frames = store.snapshot().frames;
  assert.equal(frames.length, 10);
  assert.deepEqual(frames.map(typeLabel), ['unparsed', 'unparsed', 'SYNTHETIC_FUTURE_EVENT', 'TEXT_MESSAGE_CONTENT', 'TOOL_CALL_START', 'untyped', 'untyped', 'untyped', 'untyped', 'unparsed']);
  assert.equal(summarizeFrame(frames[0]!), 'unparsed · 15 bytes');
  assert.equal(summarizeFrame(frames[9]!), 'unparsed · 0 bytes');
  for (const frame of frames) assert.equal(typeof summarizeFrame(frame), 'string');
  // A known type with a wrong field falls back to the reader's own summary, never to a guess.
  assert.equal(summarizeFrame(frames[3]!), frames[3]!.summary);
  assert.equal(summarizeFrame(frames[2]!), frames[2]!.summary);
  // The frames themselves are untouched by being summarized.
  assert.equal(frames[0]!.data, 'not json at all');
});

test('a summary never throws, whatever the fields of a frame hold', async () => {
  const frames = await framesByType();
  const weird: unknown[] = [null, 7, true, [], {}, [1, { a: 1 }], { toString: 1 }, 'x'.repeat(5000), '', '\u0000'];
  for (const [type, frame] of frames) {
    for (const key of Object.keys(frame.parsed as object)) {
      for (const value of weird) {
        const parsed = { ...(frame.parsed as object), [key]: value };
        const hostile: RawFrame = { ...frame, parsed: parsed as RawFrame['parsed'], data: JSON.stringify(parsed) };
        const summary = summarizeFrame(hostile);
        assert.equal(typeof summary, 'string', `${type}.${key}`);
        assert.ok(summary.length < 400, `${type}.${key} stays short`);
      }
    }
  }
});

test('control and partial evidence has its own labels and is never given an event type', async () => {
  const session = await richSession();
  const control = session.frames.find((frame) => frame.classification === 'control')!;
  assert.equal(typeLabel(control), 'control');
  assert.equal(summarizeFrame(control), control.summary);
  const partial = (await capture(wireScenario('cut', conversationRequest('{}'), 'data: {"type":"RUN_STAR'))).snapshot().frames[0]!;
  assert.equal(partial.classification, 'partial');
  assert.equal(typeLabel(partial), 'partial');
});

test('filters match type, content and issues, case-insensitively and together', async () => {
  const session = await richSession();
  const index = indexSession(session);
  const matching = (patch: Partial<FrameFilter>) => session.frames.filter((frame) => frameMatches(frame, index.issuesOf(frame), filter(patch)));

  assert.equal(matching({}).length, session.frames.length, 'no filter shows every frame, control evidence included');

  const text = matching({ families: new Set(['text']) });
  assert.ok(text.length > 0 && text.every((frame) => familyOf(frame.eventType) === 'text'));

  const several = matching({ families: new Set(['text', 'tool']) });
  assert.equal(several.length, text.length + matching({ families: new Set(['tool']) }).length);

  const content = matching({ query: 'SYNTHETIC-RESEARCHER' });
  assert.ok(content.length > 0 && content.every((frame) => frame.data!.toLowerCase().includes('synthetic-researcher')));

  assert.deepEqual(matching({ query: 'run_finished' }).map((frame) => frame.eventType).filter((type, at, all) => all.indexOf(type) === at), ['RUN_FINISHED']);
  assert.equal(matching({ query: 'no frame says this' }).length, 0);

  const issues = matching({ issuesOnly: true });
  assert.ok(issues.length >= 5, 'json and schema findings');
  assert.ok(issues.every((frame) => index.issuesOf(frame) > 0));
  assert.ok(session.frames.filter((frame) => frame.jsonVerdict === 'invalid').every((frame) => issues.includes(frame)));

  const both = matching({ issuesOnly: true, query: 'future' });
  assert.deepEqual(both.map((frame) => frame.eventType), ['SYNTHETIC_FUTURE_EVENT']);

  // Control evidence has no type or issue; only a text query can reach it.
  assert.ok(matching({ families: new Set(['text']) }).every((frame) => frame.classification === 'data'));
  assert.ok(matching({ query: 'keepalive' }).every((frame) => frame.classification === 'control' && frame.envelope.includes('keepalive')));
  assert.ok(matching({ query: 'keepalive' }).length > 0);
});

test('exchanges are listed newest first, with counts that follow the filter', async () => {
  const session = await richSession();
  const index = indexSession(session);
  assert.deepEqual(index.newestFirst.map((entry) => entry.exchange.id), session.exchanges.map((exchange) => exchange.id).reverse());
  assert.equal(index.newestFirst[0]!.exchange.kind, 'raw');

  const baseline = index.newestFirst.find((entry) => entry.exchange.kind === 'conversation' && entry.runLabel === 'r-proto')!;
  assert.equal(baseline.dataFrames, 30);
  assert.equal(exchangeRows(baseline, NO_FILTER).shown, 30);
  const filtered = exchangeRows(baseline, filter({ families: new Set(['tool']) }));
  assert.equal(filtered.shown, 5);
  assert.equal(filtered.rows.filter((row) => row.type === 'frame').length, 5);
  assert.equal(index.dataFrames, session.frames.filter((frame) => frame.classification === 'data').length);
  assert.equal(index.issues, index.newestFirst.reduce((sum, entry) => sum + entry.issues, 0));
  assert.equal(index.issues, session.findings.length, 'every finding is counted once, on the exchange it concerns');
});

test('family counts cover data frames only', async () => {
  const session = await richSession();
  const index = indexSession(session);
  let total = 0;
  for (const family of FAMILIES) total += index.familyCounts.get(family.key) ?? 0;
  const typed = session.frames.filter((frame) => frame.classification === 'data' && TYPES.includes(frame.eventType ?? ''));
  assert.equal(total, typed.length, 'frames with an unknown or missing type belong to no family');
  assert.ok(typed.length < index.dataFrames);
});

test('original chunk events stay in the list, with the expansion beside them marked derived and linked back', async () => {
  const session = await richSession();
  const index = indexSession(session);
  const entry = index.newestFirst.find((candidate) => candidate.runLabel === 'r-proto')!;
  const rows = exchangeRows(entry, NO_FILTER).rows;
  const at = rows.findIndex((row) => row.type === 'frame' && row.frame.eventType === 'TEXT_MESSAGE_CHUNK');
  assert.ok(at >= 0, 'the original chunk is listed');
  const next = rows[at + 1]!;
  assert.equal(next.type, 'derived');
  assert.equal(next.type === 'derived' && next.entry.provenance, 'derived');
  assert.deepEqual(next.type === 'derived' && next.entry.sources, [(rows[at] as { frame: RawFrame }).frame.id]);
  assert.equal('index' in (next as object), false);
  assert.equal('offsetMs' in ((next as { entry: object }).entry), false);

  // A filter that hides the chunk does not hide an expansion that matches on its own.
  const onlyExpansion = exchangeRows(entry, filter({ query: 'expanded from' })).rows;
  assert.deepEqual(onlyExpansion.map((row) => row.type), ['derived']);
  // And one that matches the chunk by type shows both.
  const chunkRows = exchangeRows(entry, filter({ query: 'text_message_chunk' })).rows.map((row) => row.type);
  assert.deepEqual(chunkRows, ['frame', 'derived']);
});

test('a derived entry whose source cannot be identified is listed apart, not attached to a guess', async () => {
  const store = await capture(wireScenario('one', conversationRequest('{}'), wireOf(JSON.stringify(eventFixtures.RUN_STARTED))));
  store.appendDerived({ id: 'd-amb', provenance: 'derived', derivation: 'projection', sources: [], attribution: 'ambiguous', eventType: 'STATE_DELTA', label: 'State after delta' });
  const index = indexSession(store.snapshot());
  assert.deepEqual(index.unattributed.map((entry) => entry.id), ['d-amb']);
  assert.deepEqual(exchangeRows(index.newestFirst[0]!, NO_FILTER).rows.map((row) => row.type), ['frame']);
});

test('copying an exchange gives its original frame records in arrival order, and only those', async () => {
  const session = await richSession();
  const index = indexSession(session);
  for (const entry of index.newestFirst) {
    const copied = JSON.parse(copyFramesJson(entry)) as RawFrame[];
    const expected = session.frames.filter((frame) => frame.exchangeId === entry.exchange.id);
    assert.deepEqual(copied, expected, entry.exchange.id);
    assert.deepEqual(copied.map((frame) => frame.index), expected.map((_, at) => at));
    assert.ok(copied.every((frame) => frame.provenance === 'raw'));
  }
  const withDerived = index.newestFirst.find((entry) => entry.runLabel === 'r-proto')!;
  assert.ok(!copyFramesJson(withDerived).includes('Expanded from'), 'client-derived entries are not copied as frames');
});

const render = (session: InspectionSession, patch: Partial<Parameters<typeof FramesPanel>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(FramesPanel, {
      session,
      filter: NO_FILTER,
      openExchanges: new Map<string, boolean>(),
      openFrames: new Set<string>(),
      onFilter: () => {},
      onToggleExchange: () => {},
      onToggleFrame: () => {},
      onCopy: () => {},
      ...patch,
    }),
  );

test('the newest exchange is expanded first and older ones are collapsed', async () => {
  const session = await richSession();
  const html = render(session);
  const headers = [...html.matchAll(/data-exchange-header="([^"]+)"[^>]*aria-expanded="(true|false)"/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(headers.map(([id]) => id), session.exchanges.map((exchange) => exchange.id).reverse());
  assert.deepEqual(headers.map(([, open]) => open), ['true', 'false', 'false', 'false', 'false', 'false']);
  // Only the expanded exchange builds frame rows.
  assert.equal((html.match(/data-frame-row=/g) ?? []).length, 0, 'the raw exchange has no frames');
  assert.match(html, /Raw body, sent unchanged/);
  assert.match(html, /422/);
  assert.match(html, /threadId must be a string/);
});

test('an exchange the user opened shows its rows: offsets, types, summaries, verdicts, derived links', async () => {
  const session = await richSession();
  const baseline = session.exchanges[1]!;
  const html = render(session, { openExchanges: new Map([[baseline.id, true]]), openFrames: new Set(['derived-1']) });
  assert.equal((html.match(/data-frame-row=/g) ?? []).length, 30);
  assert.match(html, /\+0\.\d{3}/, 'offsets as +s.mmm');
  assert.match(html, /TEXT_MESSAGE_CHUNK/);
  assert.match(html, /derived/);
  assert.match(html, /Not on the wire/i);
  assert.match(html, /data-derived-from="exchange-2:frame-\d+"/);
  assert.match(html, /<button[^>]*data-frame-row="exchange-2:frame-0"[^>]*aria-expanded="false"/);
});

test('an expanded frame shows its findings and its raw text as received', async () => {
  const session = await richSession();
  const invalid = session.exchanges[2]!;
  const bad = session.frames.find((frame) => frame.exchangeId === invalid.id && frame.jsonVerdict === 'invalid')!;
  const html = render(session, { openExchanges: new Map([[invalid.id, true]]), openFrames: new Set([bad.id]) });
  assert.match(html, /Data is not valid JSON/);
  assert.match(html, /as received/);
  assert.match(html, new RegExp(bad.data!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '&quot;')));
  assert.match(html, /unparsed/);
});

test('a finding shows its rule id after its label in the frame detail and on the exchange, and one without a rule shows as before', async () => {
  const session = await richSession();
  const invalid = session.exchanges[2]!;
  const bad = session.frames.find((frame) => frame.exchangeId === invalid.id && frame.jsonVerdict === 'invalid')!;
  const runExchange = session.runs.find((run) => run.id === 'run-rec-1')!.exchangeId;
  const html = render(session, { openExchanges: new Map([[invalid.id, true], [runExchange, true]]), openFrames: new Set([bad.id]) });
  assert.match(html, /<code>json\.invalid<\/code>/, 'the frame detail names the rule');
  assert.match(html, /<code>sequence\.text-message-not-open<\/code>/, 'the run finding on the exchange names the rule');
  assert.match(html, /<span class="agui-fr-ver"><span class="agui-tag agui-tag--err">json<\/span>/, 'the frame row keeps its short kind tag');

  const old: InspectionSession = {
    ...session,
    findings: session.findings.map(({ rule: _rule, ...rest }) => rest),
  };
  const before = render(old, { openExchanges: new Map([[invalid.id, true]]), openFrames: new Set([bad.id]) });
  assert.doesNotMatch(before, /<code>/, 'a 0.1.0 finding has no rule to show');
  assert.match(before, /Data is not valid JSON/);
});

test('compat and capability findings use the warning styling of sequence findings, the other kinds the error styling', async () => {
  const session = await richSession();
  const subject = { type: 'frame', id: session.frames.find((frame) => frame.classification === 'data')!.id } as const;
  const kinds = { compat: 'compat.null-optional-field', capability: 'capability.state-delta-unsupported', sequence: 'sequence.first-event', json: 'json.invalid', capture: 'capture.failed' } as const;
  const findings = Object.entries(kinds).map(([kind, rule]) => ({ id: `x-${kind}`, kind: kind as keyof typeof kinds, rule, message: `message of ${kind}`, subject }));
  const html = render({ ...session, findings: [...session.findings, ...findings] }, { openExchanges: new Map([[session.frames.find((frame) => frame.id === subject.id)!.exchangeId, true]]), openFrames: new Set([subject.id]) });
  const variantOf = (kind: string) => html.match(new RegExp(`agui-finding--(\\w+)[^>]*>(?:(?!</div>)[\\s\\S])*message of ${kind}`))?.[1];
  assert.deepEqual(
    Object.keys(kinds).map((kind) => [kind, variantOf(kind)]),
    [['compat', 'warn'], ['capability', 'warn'], ['sequence', 'warn'], ['json', 'err'], ['capture', 'err']],
  );
  // On the frame row, a frame whose first finding is a compat or capability finding has a warning tag.
  const exchangeId = session.frames.find((frame) => frame.id === subject.id)!.exchangeId;
  const rowTag = (kind: keyof typeof kinds) => {
    const only = { ...session, findings: [findings.find((finding) => finding.kind === kind)!] };
    const row = render(only, { openExchanges: new Map([[exchangeId, true]]) }).match(new RegExp(`data-frame-row="${subject.id}"[^>]*>[\\s\\S]*?<span class="agui-fr-ver"><span class="agui-tag agui-tag--(\\w+)">${kind}</span>`));
    return row?.[1];
  };
  assert.deepEqual((['compat', 'capability', 'json'] as const).map(rowTag), ['warn', 'warn', 'err']);
});

test('filters show counts and shown/total on every exchange header', async () => {
  const session = await richSession();
  assert.doesNotMatch(render(session), /\d+\/\d+ frames/);
  const html = render(session, { filter: filter({ families: new Set(['tool']) }) });
  assert.match(html, /data-exchange-header="exchange-2"[^>]*>[\s\S]*?5\/30 frames/);
  assert.match(html, /aria-pressed="true"[^>]*>[\s\S]{0,200}Tools/);
  const none = render(session, { filter: filter({ query: 'zzz' }), openExchanges: new Map([[session.exchanges[1]!.id, true]]) });
  assert.match(none, /No frames match the filter/, 'an expanded exchange without matches says so');
});

test('with no exchanges the list says so', () => {
  const empty: InspectionSession = { id: 'e', exchanges: [], runs: [], frames: [], findings: [], derived: [] };
  assert.match(render(empty), /No exchanges yet/);
});

test('the list carries the state a measurement needs: totals, shown and the interaction generation', async () => {
  const session = await richSession();
  const html = render(session, { generation: 7, openExchanges: new Map([[session.exchanges[1]!.id, true]]) });
  assert.match(html, /data-testid="frames"[^>]*data-generation="7"/);
  assert.match(html, /data-frame-total="\d+"/);
  assert.match(html, /data-frame-shown="\d+"/);
});

// ---------------------------------------------------------------------------------------------
// FX7: hiding the preparation exchanges
// ---------------------------------------------------------------------------------------------

const prepared = (path: string): RecorderScenario => ({
  name: 'prepare-ok',
  request: { kind: 'preparation', method: 'POST', path, body: '{}', responseKind: 'response' },
  status: 200,
  announcedContentType: 'application/json',
  chunks: [new TextEncoder().encode('{"ok":true}')],
  ending: 'close',
});
const idsOf = (listed: ReturnType<typeof listExchanges>) => listed.exchanges.map(({ entry }) => entry.exchange.id);
const hidePreparation = filter({ showPreparation: false });

test('hiding preparation drops only the preparation exchanges that went well, and no count moves', async () => {
  const session = await richSession();
  const index = indexSession(session);
  const every = listExchanges(index, NO_FILTER);
  assert.deepEqual(idsOf(every), index.newestFirst.map((entry) => entry.exchange.id), 'preparation is listed by default');

  const hidden = listExchanges(index, hidePreparation);
  assert.deepEqual(idsOf(hidden), index.newestFirst.filter((entry) => entry.exchange.kind !== 'preparation').map((entry) => entry.exchange.id));
  assert.equal(hidden.exchanges.length, every.exchanges.length - 1);
  assert.deepEqual(hidden.exchanges.map(({ shown }) => shown), every.exchanges.filter(({ entry }) => entry.exchange.kind !== 'preparation').map(({ shown }) => shown));
  assert.equal(hidden.shown, every.shown);

  // A view-only choice: the index, and so every total, is the recording's.
  assert.equal(index.preparations, 1);
  assert.equal(index.failedPreparations, 0);
  assert.equal(index.newestFirst.length, session.exchanges.length);
  assert.equal(index.dataFrames, session.frames.filter((frame) => frame.classification === 'data').length);
  assert.equal(isFiltering(hidePreparation), false, 'frame counts keep their plain form');
});

test('a failed preparation stays listed while preparation is hidden, and no other filter can drop an exchange', async () => {
  const store = await capture(
    prepared('/ok'),
    recorderScenarios.errorTextBody,
    { ...recorderScenarios.transportFailure, request: { kind: 'preparation', method: 'POST', path: '/down', responseKind: 'response' } },
    wireScenario('run', conversationRequest('{}'), wireOf(JSON.stringify(eventFixtures.RUN_STARTED))),
    prepared('/flagged'),
    prepared('/ok-too'),
  );
  store.addFinding({ id: 'f-flagged', kind: 'capture', message: 'Response body could not be captured', subject: { type: 'exchange', id: 'exchange-5' } });
  const index = indexSession(store.snapshot());

  assert.equal(index.preparations, 5);
  assert.equal(index.failedPreparations, 3, 'a 503, a transport failure and a finding');
  // Newest first. Only the two clean preparation exchanges (1 and 6) go.
  assert.deepEqual(idsOf(listExchanges(index, hidePreparation)), ['exchange-5', 'exchange-4', 'exchange-3', 'exchange-2']);

  // Text, family and Issues narrow frames. They never decide which exchanges are listed.
  const narrowed = filter({ query: 'zzz-matches-nothing', families: new Set(['tool']), issuesOnly: true });
  assert.deepEqual(idsOf(listExchanges(index, narrowed)), idsOf(listExchanges(index, NO_FILTER)));
  assert.deepEqual(idsOf(listExchanges(index, { ...narrowed, showPreparation: false })), ['exchange-5', 'exchange-4', 'exchange-3', 'exchange-2']);
});

const chip = (html: string) => html.match(/<button[^>]*data-preparation-chip[^>]*>[\s\S]*?<\/button>/)?.[0] ?? '';

test('the Preparation chip counts the preparation exchanges and toggles with aria-pressed', async () => {
  const session = await richSession();
  const on = chip(render(session));
  assert.match(on, /aria-pressed="true"/, 'shown by default');
  assert.match(on, />Preparation<span class="agui-count">1<\/span>/);
  assert.doesNotMatch(on, /data-has-issues="true"/);

  const off = render(session, { filter: hidePreparation });
  assert.match(chip(off), /aria-pressed="false"/);
  assert.match(chip(off), /agui-count">1</, 'the count is the session\'s, not the list\'s');
  assert.doesNotMatch(off, /data-exchange-header="exchange-1"/);
  assert.match(off, /data-exchange-header="exchange-2"/);
  assert.match(render(session), /data-exchange-header="exchange-1"/);
});

test('the chip turns red for a failed preparation, which stays in the list', async () => {
  const store = await capture(recorderScenarios.errorTextBody);
  const html = render(store.snapshot(), { filter: hidePreparation });
  assert.match(chip(html), /data-has-issues="true"/);
  assert.match(html, /data-exchange-header="exchange-1"/);
  assert.match(html, /503/);
  assert.doesNotMatch(html, /Only preparation requests/);
});

test('hidden preparation does not leave the newest listed exchange collapsed, and an all-preparation session says why', async () => {
  const store = await capture(wireScenario('run', conversationRequest('{}'), wireOf(JSON.stringify(eventFixtures.RUN_STARTED))), prepared('/ok'));
  const session = store.snapshot();
  const opens = (html: string) => [...html.matchAll(/data-exchange-header="([^"]+)"[^>]*aria-expanded="(true|false)"/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(opens(render(session)), ['exchange-2:true', 'exchange-1:false']);
  assert.deepEqual(opens(render(session, { filter: hidePreparation })), ['exchange-1:true']);

  const only = render((await capture(prepared('/ok'))).snapshot(), { filter: hidePreparation });
  assert.match(only, /Only preparation requests so far, and they are hidden\. Turn on the Preparation chip/);
  assert.doesNotMatch(only, /No exchanges yet/);
});

// ---- binary frames (spec 013, FR-014) --------------------------------------------------------------

/** Frames of a protobuf exchange through the real reader: whole frames, one per entry. */
function binaryFrames(...frames: Uint8Array[]): RawFrame[] {
  const out: RawFrame[] = [];
  const reader = createProtobufFrameReader({ appendFrame: (frame) => void out.push(frame), addFinding: () => undefined }, 'exchange-1');
  frames.forEach((bytes, at) => reader.push(bytes, (at + 1) * 10));
  reader.end();
  return out;
}

test('a binary frame has the label and summary of the same event over server-sent events, for all 31 types', () => {
  for (const type of TYPES) {
    const [frame] = binaryFrames(frameProtobuf(eventFixtures[type as keyof typeof eventFixtures]));
    assert.equal(frame!.schemaVerdict, 'valid', `${type} decodes to a valid event`);
    assert.equal(summarizeFrame(frame!), expectedSummaries[type], `${type} summary`);
    assert.equal(typeLabel(frame!), type);
  }
});

test('a binary frame with no event is labelled undecodable or unknown event, and keeps the reader\'s summary', () => {
  const [garbage, future] = binaryFrames(garbageFrame, futureEventFrame);
  assert.equal(typeLabel(garbage!), 'undecodable');
  assert.equal(summarizeFrame(garbage!), garbage!.summary);
  assert.match(garbage!.summary, /Not a decodable protobuf event · 7 bytes/);
  assert.equal(typeLabel(future!), 'unknown event');
  assert.match(summarizeFrame(future!), /Event from a later protocol/);
  const partial = binaryFrames(frameProtobuf(eventFixtures.RUN_STARTED).slice(0, 6)).find((frame) => frame.classification === 'partial')!;
  assert.equal(typeLabel(partial), 'partial');
  assert.equal(summarizeFrame(partial), partial.summary);
});

test('the received size of a frame is its bytes, for text and binary frames', () => {
  const bytes = frameProtobuf(eventFixtures.TEXT_MESSAGE_CONTENT);
  assert.equal(receivedSize(binaryFrames(bytes)[0]!), bytes.length);
  assert.equal(receivedSize({ ...binaryFrames(bytes)[0]!, bytes: undefined, envelope: 'data: é\n\n' } as RawFrame), 'data: é\n\n'.length + 1, 'text counts encoded characters');
});

test('the filter finds a binary frame by event type and by decoded content, and not by its bytes', () => {
  const frames = binaryFrames(frameProtobuf(eventFixtures.TEXT_MESSAGE_CONTENT), frameProtobuf(eventFixtures.STEP_STARTED), garbageFrame);
  const matching = (patch: Partial<FrameFilter>) => frames.filter((frame) => frameMatches(frame, 0, filter(patch)));
  assert.equal(matching({ query: 'text_message_content' }).length, 1);
  assert.equal(matching({ query: 'WÖRLD' }).length, 1, 'content of the decoded event, case-insensitively');
  assert.equal(matching({ query: 'plan' }).length, 1);
  assert.equal(matching({ query: 'ffffff' }).length, 0, 'the hexadecimal text is not searched');
  assert.equal(matching({ families: new Set(['text']) }).length, 1);
  assert.equal(matching({}).length, frames.length);
});

function protobufSession(...frames: Uint8Array[]): InspectionSession {
  const store = createSessionStore({ schedule: (callback) => callback() });
  store.appendExchange({ id: 'exchange-1', kind: 'conversation', method: 'POST', path: '/agent', status: 200, startedAt: 1_700_000_000_000, transport: 'streaming', encoding: 'protobuf', frameIds: [] });
  const reader = createProtobufFrameReader(store, 'exchange-1');
  frames.forEach((bytes, at) => reader.push(bytes, (at + 1) * 10));
  reader.end();
  store.updateExchange('exchange-1', { transport: 'completed', elapsedMs: 100 });
  return store.snapshot();
}

test('the markup marks a protobuf exchange and its binary frames, and shows the bytes and the decoded event in the detail', () => {
  const large = frameProtobuf({ ...eventFixtures.TEXT_MESSAGE_CONTENT, delta: 'x'.repeat(5000) });
  const session = protobufSession(frameProtobuf(eventFixtures.RUN_STARTED), large, garbageFrame);
  const html = render(session);
  assert.match(html, />protobuf</, 'the exchange says it was read as protobuf');
  assert.equal((html.match(/data-frame-binary/g) ?? []).length, 3, 'every row of the exchange is binary');
  assert.match(html, /agui-tag[^>]*>binary</);

  const open = render(session, { openFrames: new Set(session.frames.map((frame) => frame.id)) });
  assert.match(open, /Bytes · \d+ B as received/);
  assert.match(open, /aria-label="Frame bytes as hexadecimal text"/);
  assert.match(open, /aria-label="Frame bytes as hexadecimal text">00 00 00 18 /, 'the hexadecimal text starts with the four length bytes (24 for RUN_STARTED)');
  assert.match(open, /the first 4096 shown, \d+ not shown/, 'a large frame says how much is not shown');
  assert.match(open, /aria-label="Decoded event"/);
  assert.match(open, /Copy bytes/);
  assert.match(open, /Copy event/);
  assert.match(open, /Not a decodable protobuf event/);
  assert.match(open, /<code>binary\.undecodable-frame<\/code>/, 'a binary finding names its rule, like any other');
  assert.equal((open.match(/aria-label="Decoded event"/g) ?? []).length, 2, 'the undecodable frame has no decoded block');
  assert.equal(copyFramesJson(indexSession(session).newestFirst[0]!).includes('"bytes"'), true, 'copy frames as JSON carries the bytes');
});

test('a server-sent-events exchange shows no protobuf mark', async () => {
  const html = render(await richSession());
  assert.doesNotMatch(html, />protobuf</);
  assert.doesNotMatch(html, /data-frame-binary/);
});
