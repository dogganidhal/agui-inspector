// L04 T036 (FR-034, FR-035, FR-036, FR-039; SC-007): version-0 session files. Export writes an
// explicit field list, so nothing outside the contract can leak into a file; import validates the
// whole file before anything is committed and never starts a request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InspectionSession } from '../../src/contracts.ts';
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
