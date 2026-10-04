// L04 T036 (FR-034, FR-035, FR-036, FR-039; SC-007): version-0 session files. Export writes an
// explicit field list, so nothing outside the contract can leak into a file; import validates the
// whole file before anything is committed and never starts a request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Exchange, InspectionSession, RawFrame } from '../../src/contracts.ts';
import { projectConversation } from '../../src/core/projection/index.ts';
import { parseSession, restoreSession, serializeSession, SESSION_FILE_NAME } from '../../src/core/session-files/index.ts';
import { eventFixtures, richSession } from './support.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const fileOf = async () => JSON.parse(serializeSession(await richSession())) as { version: number; session: Record<string, any[]> };
const rejects = (file: unknown, pattern: RegExp) => {
  const result = parseSession(JSON.stringify(file));
  assert.equal(result.ok, false, 'the file must be rejected');
  if (!result.ok) assert.match(result.error, pattern);
};

test('the file is a version-0 envelope with the whole session in order', async () => {
  const session = await richSession();
  const file = JSON.parse(serializeSession(session));
  assert.deepEqual(Object.keys(file), ['version', 'session']);
  assert.equal(file.version, 0);
  assert.deepEqual(Object.keys(file.session), ['id', 'exchanges', 'runs', 'frames', 'findings', 'derived']);
  assert.equal(file.session.frames.length, session.frames.length);
  const types = new Set(session.frames.map((frame) => frame.eventType));
  assert.deepEqual(Object.keys(eventFixtures).filter((type) => !types.has(type)), [], 'the sample holds all 31 event types');
  assert.ok(session.frames.some((frame) => frame.classification === 'control') && session.frames.some((frame) => frame.jsonVerdict === 'invalid'));
  assert.equal(SESSION_FILE_NAME, 'agui-inspector-session.json');
});

test('a round trip preserves text, order, time and run input, and a second export is byte-identical', async () => {
  const session = await richSession();
  const text = serializeSession(session);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.deepEqual(result.session, session);
  assert.equal(serializeSession(result.session), text);

  const store = restoreSession(result.session);
  assert.deepEqual(store.snapshot(), session);
  // Frames keep their original envelope text exactly, delimiters included, in arrival order.
  assert.deepEqual(store.snapshot().frames.map((frame) => frame.envelope), session.frames.map((frame) => frame.envelope));
  assert.deepEqual(store.snapshot().frames.map((frame) => frame.offsetMs), session.frames.map((frame) => frame.offsetMs));
  assert.deepEqual(store.snapshot().runs[0]?.input, session.runs[0]?.input);
  assert.equal(store.snapshot().exchanges.find((exchange) => exchange.kind === 'raw')?.requestBody, '{ "threadId" :17 }');
});

test('the replies the inspector answered are marked on the run, survive a round trip, and a file without the mark still imports', async () => {
  const session = await richSession();
  assert.equal(session.runs.some((run) => 'automaticReplies' in run), false, 'a session of replies the developer gave has no mark');
  assert.equal(JSON.stringify(JSON.parse(serializeSession(session)).session.runs).includes('automaticReplies'), false, 'and exports none');

  const marked = clone(session);
  const first = marked.runs[0];
  assert.ok(first);
  (marked.runs as unknown as Array<Record<string, unknown>>)[0] = { ...first, automaticReplies: { interruptIds: ['i-approve', 'i-contact'], toolCallIds: ['c-1'] } };
  const text = serializeSession(marked);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.deepEqual(result.session.runs[0]?.automaticReplies, { interruptIds: ['i-approve', 'i-contact'], toolCallIds: ['c-1'] });
  assert.deepEqual(result.session, marked);
  assert.equal(serializeSession(result.session), text, 'a second export is byte-identical');
  assert.deepEqual(restoreSession(result.session).snapshot().runs[0]?.automaticReplies, { interruptIds: ['i-approve', 'i-contact'], toolCallIds: ['c-1'] });

  const plain = parseSession(serializeSession(session));
  assert.ok(plain.ok, 'a file written before the mark existed imports');
});

test('findings with rule ids and runs with automaticReplies round-trip together through one export and import', async () => {
  const marked = clone(await richSession());
  (marked.runs as unknown as Array<Record<string, unknown>>)[0] = { ...marked.runs[0]!, automaticReplies: { interruptIds: ['i-approve'], toolCallIds: ['c-1'] } };
  assert.ok(marked.findings.length > 0 && marked.findings.every((finding) => finding.rule !== undefined));

  const text = serializeSession(marked);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.deepEqual(result.session, marked, 'both the rules and the marks come back');
  assert.equal(serializeSession(result.session), text, 'and a second export is byte-identical');
  const restored = restoreSession(result.session).snapshot();
  assert.deepEqual(restored.findings.map((finding) => finding.rule), marked.findings.map((finding) => finding.rule));
  assert.deepEqual(restored.runs[0]?.automaticReplies, { interruptIds: ['i-approve'], toolCallIds: ['c-1'] });
});

test('import rejects an automaticReplies that is not two lists of nonempty strings, naming the run', async () => {
  const bad = async (value: unknown) => {
    const file = await fileOf();
    file.session.runs![0] = { ...file.session.runs![0], automaticReplies: value };
    return file;
  };
  rejects(await bad('i-1'), /runs\[0\]: automaticReplies must be an object/);
  rejects(await bad(null), /runs\[0\]: automaticReplies must be an object/);
  rejects(await bad({ interruptIds: [] }), /runs\[0\]: automaticReplies: missing "toolCallIds"/);
  rejects(await bad({ interruptIds: [], toolCallIds: [], extra: [] }), /runs\[0\]: automaticReplies: unknown field "extra"/);
  rejects(await bad({ interruptIds: [1], toolCallIds: [] }), /runs\[0\]: automaticReplies: interruptIds must be an array of strings/);
  rejects(await bad({ interruptIds: [], toolCallIds: 'c-1' }), /runs\[0\]: automaticReplies: toolCallIds must be an array of strings/);
  rejects(await bad({ interruptIds: [''], toolCallIds: [] }), /runs\[0\]: automaticReplies: interruptIds must hold nonempty strings/);
});

test('the file contains no header, credential or volatile connection field, even if a record carries one', async () => {
  const session = await richSession();
  const dirty = clone(session) as any;
  for (const record of [...dirty.exchanges, ...dirty.runs, ...dirty.frames, ...dirty.findings, ...dirty.derived]) {
    record.headers = { Authorization: 'Bearer SECRET-TOKEN' };
    record.requestHeaders = { Cookie: 'sid=SECRET-COOKIE' };
    record.auth = { headerName: 'Authorization', token: 'SECRET-TOKEN' };
  }
  dirty.abortController = {};
  dirty.connection = { targetUrl: 'https://example.test', auth: { token: 'SECRET-TOKEN' } };
  const text = serializeSession(dirty as InspectionSession);
  assert.equal(text, serializeSession(session));
  assert.doesNotMatch(text, /SECRET|requestHeaders|"headers"|"auth"|abortController|targetUrl/);
});

test('import rejects malformed JSON, wrong versions and incomplete envelopes with a visible reason', async () => {
  const file = await fileOf();
  assert.match((parseSession('{not json') as { error: string }).error, /not valid JSON/i);
  assert.match((parseSession('') as { error: string }).error, /not valid JSON/i);
  rejects([], /envelope/i);
  rejects({ ...file, version: 1 }, /version 1.*version 0|unsupported version/i);
  rejects({ ...file, version: '0' }, /version/i);
  const { version: _version, ...noVersion } = file;
  rejects(noVersion, /version/i);
  rejects({ version: 0 }, /session/i);
  rejects({ version: 0, session: { ...file.session, frames: undefined } }, /frames/i);
  rejects({ ...file, extra: true }, /unknown field.*extra/i);
});

test('import rejects header-bearing, credential-bearing and unknown record fields', async () => {
  for (const [field, value] of [['headers', {}], ['requestHeaders', {}], ['responseHeaders', {}], ['Authorization', 'x'], ['cookie', 'x'], ['auth', { token: 'x' }], ['token', 'x']] as const) {
    for (const collection of ['exchanges', 'frames', 'runs', 'findings', 'derived'] as const) {
      const file = await fileOf();
      file.session[collection]![0]![field] = value;
      rejects(file, new RegExp(`${collection}\\[0\\].*header or credential field.*${field}`, 'i'));
    }
  }
  const file = await fileOf();
  file.session.exchanges![0]!.somethingElse = 1;
  rejects(file, /exchanges\[0\].*unknown field.*somethingElse/i);
  const derived = await fileOf();
  derived.session.derived![0]!.index = 3;
  rejects(derived, /derived\[0\].*unknown field.*index/i);
});

test('import allows header-like words inside payloads, which are evidence and not record fields', async () => {
  const session = await richSession();
  const frame = session.frames.find((candidate) => candidate.jsonVerdict === 'valid' && candidate.classification === 'data')!;
  const payload = JSON.stringify({ type: 'CUSTOM', name: 'headers', value: { headers: { accept: 'x' }, authorization: 'echoed by the server' } });
  const edited = { ...clone(session), frames: session.frames.map((candidate) => (candidate === frame ? { ...frame, data: payload, parsed: JSON.parse(payload), eventType: 'CUSTOM' } : candidate)) };
  const result = parseSession(serializeSession(edited));
  assert.ok(result.ok, 'payload text is not a header field');
});

test('a finding keeps its rule through export and import, and a 0.1.0 file without rules still opens', async () => {
  const session = await richSession();
  assert.ok(session.findings.length > 0 && session.findings.every((finding) => finding.rule !== undefined), 'every finding the inspector created has a rule');
  const file = JSON.parse(serializeSession(session)) as { session: { findings: Array<Record<string, unknown>> } };
  assert.deepEqual(Object.keys(file.session.findings[0]!), ['id', 'kind', 'rule', 'message', 'subject']);
  const again = parseSession(JSON.stringify(file));
  assert.ok(again.ok);
  assert.deepEqual(again.session.findings.map((finding) => finding.rule), session.findings.map((finding) => finding.rule));

  // What 0.1.0 wrote: the same findings with no `rule`.
  for (const finding of file.session.findings) delete finding.rule;
  const old = parseSession(JSON.stringify(file));
  assert.ok(old.ok, 'a 0.1.0 session opens');
  assert.ok(old.session.findings.length > 0 && old.session.findings.every((finding) => !('rule' in finding)), 'nothing is invented for an old finding');
  assert.equal(serializeSession(old.session).includes('"rule"'), false, 'and nothing is written for it');
});

test('import accepts a well-formed rule that this version does not know and the compat and capability kinds, and rejects a bad rule', async () => {
  const withRule = async (patch: Record<string, unknown>) => {
    const file = await fileOf();
    Object.assign(file.session.findings![0]!, patch);
    return file;
  };
  const kind = (await fileOf()).session.findings![0]!.kind as string;
  assert.ok(parseSession(JSON.stringify(await withRule({ rule: `${kind}.from-a-newer-version` }))).ok, 'unknown but well formed');
  for (const family of ['compat', 'capability']) {
    const result = parseSession(JSON.stringify(await withRule({ kind: family, rule: `${family}.something` })));
    assert.ok(result.ok, `${family} findings open`);
  }
  rejects(await withRule({ rule: 'Not A Rule' }), /findings\[0\].*rule must be <family>\.<problem>/);
  rejects(await withRule({ rule: 7 }), /findings\[0\].*rule must be <family>\.<problem>/);
  rejects(await withRule({ rule: `${kind === 'json' ? 'schema' : 'json'}.invalid` }), /findings\[0\].*rule family must match kind/);
  rejects(await withRule({ severity: 'high' }), /findings\[0\].*unknown field.*severity/i);
});

test('import rejects invalid references', async () => {
  const frameRef = await fileOf();
  frameRef.session.exchanges![1]!.frameIds![0] = 'no-such-frame';
  rejects(frameRef, /exchanges\[1\].*frameIds.*no-such-frame/i);

  const exchangeRef = await fileOf();
  exchangeRef.session.frames![0]!.exchangeId = 'no-such-exchange';
  rejects(exchangeRef, /frames\[0\].*exchange.*no-such-exchange/i);

  const runRef = await fileOf();
  runRef.session.runs![0]!.exchangeId = 'no-such-exchange';
  rejects(runRef, /runs\[0\].*exchange.*no-such-exchange/i);

  const findingRef = await fileOf();
  findingRef.session.findings![0]!.subject = { type: 'frame', id: 'no-such-frame' };
  rejects(findingRef, /findings\[0\].*frame.*no-such-frame/i);

  const runFinding = await fileOf();
  runFinding.session.findings!.find((finding) => finding.subject.type === 'run')!.subject.id = 'no-such-run';
  rejects(runFinding, /findings\[\d+\].*run.*no-such-run/i);

  const derivedRef = await fileOf();
  derivedRef.session.derived![0]!.sources = ['no-such-frame'];
  rejects(derivedRef, /derived\[0\].*no-such-frame/i);

  const unattributed = await fileOf();
  unattributed.session.derived![0]!.sources = [];
  rejects(unattributed, /derived\[0\].*identified.*source/i);

  const stray = await fileOf();
  stray.session.exchanges![1]!.frameIds!.pop();
  rejects(stray, /frame .* is not listed|frameIds/i);

  const twice = await fileOf();
  twice.session.exchanges![2]!.frameIds![0] = twice.session.exchanges![1]!.frameIds![0]!;
  rejects(twice, /frameIds|exchange/i);
});

test('import rejects duplicate ids', async () => {
  for (const collection of ['exchanges', 'frames', 'runs', 'findings', 'derived'] as const) {
    const file = await fileOf();
    const items = file.session[collection]!;
    if (items.length < 2) {
      items.push(clone(items[0]));
    } else {
      items[1]!.id = items[0]!.id;
    }
    rejects(file, new RegExp(`${collection}.*duplicate.*id`, 'i'));
  }
});

test('import rejects invalid index, order and timing data', async () => {
  const index = await fileOf();
  const second = index.session.frames!.find((frame) => frame.index === 1)!;
  second.index = 5;
  rejects(index, /frames\[\d+\].*index 5.*expected 1/i);

  const offsets = await fileOf();
  const later = offsets.session.frames!.find((frame) => frame.index === 3)!;
  later.offsetMs = 0;
  offsets.session.frames!.find((frame) => frame.index === 2 && frame.exchangeId === later.exchangeId)!.offsetMs = 9999;
  rejects(offsets, /frames\[\d+\].*offset.*monotonic|backwards/i);

  for (const bad of [-1, 'soon', null]) {
    const negative = await fileOf();
    negative.session.frames![0]!.offsetMs = bad;
    rejects(negative, /frames\[0\].*offsetMs/i);
  }

  const start = await fileOf();
  start.session.exchanges![0]!.startedAt = 'yesterday';
  rejects(start, /exchanges\[0\].*startedAt/i);

  const elapsed = await fileOf();
  elapsed.session.exchanges![0]!.elapsedMs = -5;
  rejects(elapsed, /exchanges\[0\].*elapsedMs/i);

  const ended = await fileOf();
  ended.session.runs![0]!.endedAt = ended.session.runs![0]!.startedAt - 1;
  rejects(ended, /runs\[0\].*endedAt/i);

  const order = await fileOf();
  order.session.frames!.reverse();
  rejects(order, /frames|frameIds|index/i);
});

test('import rejects frames that contradict themselves', async () => {
  const verdict = await fileOf();
  const valid = verdict.session.frames!.find((frame) => frame.jsonVerdict === 'valid')!;
  valid.jsonVerdict = 'invalid';
  rejects(verdict, /frames\[\d+\].*jsonVerdict/i);

  const text = await fileOf();
  const parsed = text.session.frames!.find((frame) => frame.jsonVerdict === 'valid' && frame.classification === 'data')!;
  parsed.parsed = { type: 'SOMETHING_ELSE' };
  rejects(text, /frames\[\d+\].*parsed.*data/i);

  const classification = await fileOf();
  const control = classification.session.frames!.find((frame) => frame.classification === 'control')!;
  control.data = 'data text on a control frame';
  rejects(classification, /frames\[\d+\].*data/i);

  const provenance = await fileOf();
  provenance.session.frames![0]!.provenance = 'derived';
  rejects(provenance, /frames\[0\].*provenance/i);
});

/** The recording from issue #42: a snapshot the event schema rejects, filed as valid. Synthetic data only. */
function snapshotRecording(schemaVerdict: 'valid' | 'invalid') {
  const event = { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'bad-message', role: 'assistant', content: [null] }] };
  const data = JSON.stringify(event);
  return {
    version: 0,
    session: {
      id: 'audit',
      runs: [],
      findings: [],
      derived: [],
      exchanges: [{ id: 'e', kind: 'conversation', method: 'POST', path: '/agent', startedAt: 1, transport: 'completed', frameIds: ['f'] }],
      frames: [
        { id: 'f', exchangeId: 'e', index: 0, classification: 'data', data, envelope: `data: ${data}\n\n`, parsed: event, offsetMs: 1, eventType: event.type, summary: 'invalid snapshot', jsonVerdict: 'valid', schemaVerdict, provenance: 'raw' },
      ],
    },
  };
}

test('import rejects a frame that claims a valid event but holds one the schema rejects, naming the frame and the field', () => {
  const claimedValid = parseSession(JSON.stringify(snapshotRecording('valid')));
  assert.equal(claimedValid.ok, false, 'the verdict contradicts the data');
  if (!claimedValid.ok) {
    assert.match(claimedValid.error, /frames\[0\]/);
    assert.match(claimedValid.error, /schemaVerdict "valid"/);
    assert.match(claimedValid.error, /messages\.0\.content: invalid_type/, 'names where the data misses the schema');
    assert.doesNotMatch(claimedValid.error, /bad-message/, 'names fields, not received values');
  }

  const unknown = snapshotRecording('valid');
  unknown.session.frames[0]!.data = '{"type":"NOT_AN_EVENT"}';
  unknown.session.frames[0]!.parsed = { type: 'NOT_AN_EVENT' } as never;
  rejects(unknown, /frames\[0\].*schemaVerdict "valid".*NOT_AN_EVENT/);

  const noType = snapshotRecording('valid');
  noType.session.frames[0]!.data = '{"hello":1}';
  noType.session.frames[0]!.parsed = { hello: 1 } as never;
  rejects(noType, /frames\[0\].*schemaVerdict "valid"/);
});

test('the same snapshot filed with the verdict the reader gives it is preserved as sent, and projecting it does not throw', () => {
  const file = snapshotRecording('invalid');
  const result = parseSession(JSON.stringify(file));
  assert.ok(result.ok, 'a correctly classified malformed frame is evidence, not an import error');
  assert.deepEqual(result.session.frames, file.session.frames);
  assert.deepEqual(JSON.parse(serializeSession(result.session)).session.frames, file.session.frames);
  assert.doesNotThrow(() => projectConversation(restoreSession(result.session).snapshot()));
});

test('correctly classified malformed, unknown and non-JSON frames import unchanged', async () => {
  const session = await richSession();
  const verdicts = new Set(session.frames.map((frame) => `${frame.jsonVerdict}/${frame.schemaVerdict}`));
  for (const kind of ['invalid/not-applicable', 'valid/invalid', 'valid/unknown-type', 'valid/valid']) assert.ok(verdicts.has(kind), `the sample holds a ${kind} frame`);
  const text = serializeSession(session);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.equal(serializeSession(result.session), text);
  assert.doesNotThrow(() => projectConversation(result.session));
});

test('import rejects a run input that is not a run input and a path with credentials', async () => {
  const input = await fileOf();
  input.session.runs![0]!.input = { threadId: 7 };
  rejects(input, /runs\[0\].*input/i);

  const path = await fileOf();
  path.session.exchanges![0]!.path = 'https://user:pass@example.test/agent';
  rejects(path, /exchanges\[0\].*path.*credentials/i);
});

test('a failed import changes nothing: the old session is still there and no store is built', async () => {
  const session = await richSession();
  const store = restoreSession(session);
  const before = JSON.stringify(store.snapshot());
  const result = parseSession('{"version":0,"session":{"id":"x","exchanges":[{}],"runs":[],"frames":[],"findings":[],"derived":[]}}');
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(store.snapshot()), before);
});

test('import starts no request', async () => {
  const text = serializeSession(await richSession());
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (...args: unknown[]) => {
    calls.push(String(args[0]));
    throw new Error('import must not fetch');
  }) as typeof fetch;
  try {
    const result = parseSession(text);
    assert.ok(result.ok);
    restoreSession(result.session);
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(calls, []);
});

test('an empty session exports and imports', () => {
  const empty: InspectionSession = { id: 'empty', exchanges: [], runs: [], frames: [], findings: [], derived: [] };
  const result = parseSession(serializeSession(empty));
  assert.ok(result.ok);
  assert.deepEqual(result.session, empty);
  assert.deepEqual(restoreSession(result.session).snapshot(), empty);
});

/** A synthetic recording: `counts[i]` frames in exchange i, written round-robin so the exchanges interleave on the wire. */
function syntheticSession(counts: readonly number[]): InspectionSession {
  const frameIds = counts.map((): string[] => []);
  const frames: RawFrame[] = [];
  for (let round = 0; round < Math.max(...counts); round += 1) {
    counts.forEach((count, e) => {
      if (round >= count) return;
      const data = JSON.stringify({ type: 'CUSTOM', name: 'tick', value: round });
      const id = `exchange-${e}:frame-${round}`;
      frameIds[e]!.push(id);
      frames.push({ id, exchangeId: `exchange-${e}`, index: round, classification: 'data', envelope: `data: ${data}\n\n`, data, offsetMs: round * 3, eventType: 'CUSTOM', summary: 'CUSTOM tick', jsonVerdict: 'valid', schemaVerdict: 'valid', parsed: JSON.parse(data), provenance: 'raw' });
    });
  }
  const exchanges: Exchange[] = counts.map((_, e) => ({ id: `exchange-${e}`, kind: 'raw', method: 'POST', path: '/agent', startedAt: 1_700_000_000_000 + e, transport: 'completed', frameIds: frameIds[e]! }));
  return { id: 'synthetic', exchanges, runs: [], frames, findings: [], derived: [] };
}

/** The number of array-iterator steps (spread, for...of, Array.from) taken while `run` executes. */
function iteratorSteps(run: () => void): number {
  const original = Array.prototype[Symbol.iterator];
  let steps = 0;
  Array.prototype[Symbol.iterator] = function (this: unknown[]) {
    const inner = original.call(this);
    return { next: () => ((steps += 1), inner.next()), [Symbol.iterator]() { return this; } };
  } as typeof original;
  try {
    run();
  } finally {
    Array.prototype[Symbol.iterator] = original;
  }
  return steps;
}

test('one large exchange imports with the same ids, order, timings and raw data, and broken frame lists are still rejected', () => {
  const session = syntheticSession([5000]);
  const text = serializeSession(session);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.deepEqual(result.session, session);
  assert.equal(serializeSession(result.session), text);
  assert.deepEqual(result.session.exchanges[0]?.frameIds, session.frames.map((frame) => frame.id));

  const file = () => JSON.parse(text) as { session: Record<string, any[]> };

  const missing = file();
  missing.session.exchanges![0]!.frameIds!.pop();
  rejects(missing, /exchanges\[0\].*arrival order/i);

  const misordered = file();
  const ids = misordered.session.exchanges![0]!.frameIds!;
  [ids[2500], ids[2501]] = [ids[2501], ids[2500]];
  rejects(misordered, /exchanges\[0\].*arrival order/i);

  const duplicated = file();
  duplicated.session.exchanges![0]!.frameIds![4999] = duplicated.session.exchanges![0]!.frameIds![0];
  rejects(duplicated, /exchanges\[0\].*arrival order/i);
});

test('frames interleaved from several exchanges are grouped per exchange, and cross-exchange lists are still rejected', () => {
  const session = syntheticSession([40, 25, 40]);
  assert.notDeepEqual(session.frames.slice(0, 3).map((frame) => frame.exchangeId), Array(3).fill(session.frames[0]!.exchangeId));
  const text = serializeSession(session);
  const result = parseSession(text);
  assert.ok(result.ok);
  assert.deepEqual(result.session, session);
  assert.deepEqual(result.session.exchanges.map((exchange) => exchange.frameIds.length), [40, 25, 40]);

  const file = () => JSON.parse(text) as { session: Record<string, any[]> };
  const crossed = file();
  crossed.session.exchanges![0]!.frameIds![0] = crossed.session.exchanges![1]!.frameIds![0];
  rejects(crossed, /exchanges\[0\].*belongs to exchange "exchange-1"/i);

  const swapped = file();
  const ids = swapped.session.exchanges![1]!.frameIds!;
  [ids[3], ids[4]] = [ids[4], ids[3]];
  rejects(swapped, /exchanges\[1\].*arrival order/i);

  const short = file();
  short.session.exchanges![2]!.frameIds!.pop();
  rejects(short, /exchanges\[2\].*arrival order/i);

  const unknown = file();
  unknown.session.exchanges![0]!.frameIds![5] = 'no-such-frame';
  rejects(unknown, /exchanges\[0\].*no-such-frame/i);
});

test('import groups frame ids in one pass: iterator work grows with the frame count, not its square', () => {
  const steps = (frames: number) => {
    const text = serializeSession(syntheticSession([frames]));
    return iteratorSteps(() => assert.ok(parseSession(text).ok));
  };
  const small = steps(1000);
  const large = steps(2000);
  assert.ok(large < small * 3, `doubling the frames took ${large} iterator steps against ${small}; linear work is about twice`);
});
