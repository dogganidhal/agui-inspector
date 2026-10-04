// F07 T013 (FR-021, FR-022, SC-001): every rule has a fixture that breaks it, and playing the fixture produces a
// finding with exactly that rule on the right subject. Stream fixtures go through the real recorder and frame reader,
// or through the real runtime and the real protocol client when the client is the one that reports the rule. A fixture
// for a failure of the inspector's own machinery names the seam, and the injection for each seam is below.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGUIError, type AgentCapabilities } from '@ag-ui/core';
import { ruleFixtures, started, stream, type Lands, type RuleFixture } from '../../../../examples/reference-agent/rule-fixtures.ts';
import { fragment, scenarioBytes, scenarioSend } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { Finding, InspectionSession } from '../../src/contracts.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createRecorder, type RecorderSink } from '../../src/core/recorder/index.ts';
import { RULES, type CatalogueRuleId } from '../../src/core/rules/catalogue.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { NO_FILTER, exchangeRows, indexSession, listExchanges } from '../../src/views/inspection/model.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { AGENT, eventStream, protobufBytes, rig } from '../runtime/support.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();
const support = { id: 'support', name: 'Support', url: AGENT } as const;

async function drain(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null) return;
  const reader = body.getReader();
  while (!(await reader.read()).done);
}

async function settled(store: ReturnType<typeof createSessionStore>): Promise<InspectionSession> {
  for (let i = 0; i < 200; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    const open = store.snapshot().exchanges.filter((exchange) => !['completed', 'transport-error', 'user-stopped'].includes(exchange.transport));
    if (open.length === 0) return store.snapshot();
  }
  throw new Error('exchanges did not settle');
}

/** The recorder and reader of the page, over a store, playing one scenario. */
async function viaReader(fixture: Extract<RuleFixture, { scenario: unknown }>): Promise<InspectionSession> {
  const store = createSessionStore({ schedule: (callback) => queueMicrotask(callback) });
  const recorder = createRecorder(createFrameSink(store, { declared: () => fixture.declared }));
  try {
    const response = await recorder.record(fixture.scenario.request, scenarioSend(fixture.scenario));
    await drain(response.body);
  } catch {
    // A scenario with no response rejects, as the browser's fetch does. The finding is what the test reads.
  }
  return settled(store);
}

/** The runtime, with the real protocol client, over a network that answers with the scenario's bytes. */
async function viaClient(fixture: Extract<RuleFixture, { scenario: unknown }>): Promise<InspectionSession> {
  // A protobuf scenario is asked for and answered as protobuf, so the runtime reads it with the client's binary parser.
  const protobuf = fixture.scenario.request.responseKind === 'protobuf';
  const text = decoder.decode(scenarioBytes(fixture.scenario));
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? (protobuf ? protobufBytes(scenarioBytes(fixture.scenario)) : eventStream(text)) : undefined)], protobuf ? { settings: { profile: { ...defaultProfile(), encoding: 'protobuf' } } } : {});
  runtime.selectAgent(support);
  await runtime.send('play the fixture');
  return settle();
}

/** Breaks one seam of the inspector's own machinery. */
async function injected(seam: Extract<RuleFixture, { injected: unknown }>['injected']): Promise<InspectionSession> {
  const store = createSessionStore({ schedule: (callback) => queueMicrotask(callback) });
  const clean = stream('clean', [started, { type: 'RUN_FINISHED', threadId: 't-rule', runId: 'r-rule', outcome: { type: 'success' } }]);
  switch (seam) {
    case 'schema-check': {
      const recorder = createRecorder(
        createFrameSink(store, {
          check: () => {
            throw new Error('validator exploded');
          },
        }),
      );
      await drain((await recorder.record(clean.request, scenarioSend(clean))).body);
      return settled(store);
    }
    case 'capture-sink': {
      const sink: RecorderSink = {
        ...createFrameSink(store),
        appendChunk() {
          throw new Error('reader exploded');
        },
      };
      await drain((await createRecorder(sink).record(clean.request, scenarioSend(clean))).body);
      return settled(store);
    }
    case 'capture-clone': {
      const recorder = createRecorder(createFrameSink(store));
      const response = new Response(decoder.decode(scenarioBytes(clean)));
      response.clone = () => {
        throw new TypeError('body already used');
      };
      await recorder.record(clean.request, async () => response);
      return store.snapshot();
    }
    case 'client-error': {
      // The client reports a rejection it has no rule for: a source that fails with an AGUIError nobody has seen.
      const { runtime, settle } = rig([
        () => {
          throw new AGUIError("Cannot send 'SOMETHING_NEW' for a reason this version has no rule for");
        },
      ]);
      runtime.selectAgent(support);
      await runtime.send('play the fixture');
      return settle();
    }
    case 'rule-step': {
      // A declaration whose read throws: the rule step fails on every JSON frame, and no frame is lost.
      const hostile = { get state(): never { throw new Error('getter exploded'); } } as AgentCapabilities;
      const recorder = createRecorder(createFrameSink(store, { declared: () => hostile }));
      await drain((await recorder.record(clean.request, scenarioSend(clean))).body);
      return settled(store);
    }
    default:
      return seam satisfies never;
  }
}

const play = (fixture: RuleFixture) => ('injected' in fixture ? injected(fixture.injected) : fixture.via === 'client' ? viaClient(fixture) : viaReader(fixture));

const subjectsOf = (session: InspectionSession, rule: string): Lands[] => session.findings.filter((finding) => finding.rule === rule).map((finding) => finding.subject.type);

const entries = Object.entries(ruleFixtures) as Array<[CatalogueRuleId, RuleFixture]>;

for (const [rule, fixture] of entries) {
  test(`${rule}: its fixture produces a finding with exactly that rule on ${fixture.lands.join(' and ')}`, async () => {
    const session = await play(fixture);
    const subjects = subjectsOf(session, rule);
    for (const lands of fixture.lands) assert.ok(subjects.includes(lands), `${rule} on a ${lands}; findings: ${JSON.stringify(session.findings.map((finding) => [finding.rule, finding.subject.type]))}`);
    // Every finding the inspector created names a rule of the catalogue, with that rule's family as its kind.
    for (const finding of session.findings) {
      const known = RULES.find((candidate) => candidate.id === finding.rule);
      assert.ok(known, `finding ${finding.id} names a catalogue rule, not ${String(finding.rule)}`);
      assert.equal(finding.kind, known.family, finding.id);
    }
  });
}

test('every rule has a fixture, and no fixture belongs to a rule that is not in the catalogue', () => {
  assert.deepEqual(RULES.filter((rule) => !(rule.id in ruleFixtures)).map((rule) => rule.id), []);
  assert.deepEqual(
    entries.filter(([rule]) => !RULES.some((candidate) => candidate.id === rule)),
    [],
    'no fixture for a rule that is not in the catalogue',
  );
});

test('a client rejection with no rule of its own keeps the client message in the finding', async () => {
  const session = await injected('client-error');
  const finding = session.findings.find((candidate): candidate is Finding => candidate.rule === 'sequence.unclassified');
  assert.ok(finding);
  assert.match(finding.message, /SOMETHING_NEW/);
  assert.deepEqual(finding.subject.type, 'run');
});

test('every compat fixture is accepted by the real protocol client: no failure and no finding on the run', async () => {
  const compat = entries.filter(([rule]) => rule.startsWith('compat.'));
  assert.equal(compat.length, 5);
  for (const [rule, fixture] of compat) {
    assert.ok('scenario' in fixture);
    const session = await viaClient(fixture);
    assert.deepEqual(session.findings.filter((finding) => finding.subject.type === 'run'), [], `${rule}: the client takes the stream`);
    assert.ok(session.findings.some((finding) => finding.rule === rule && finding.subject.type === 'frame'), `${rule}: and the frame still gets its finding`);
  }
});

test('the rule step failing costs no frame: the fixture keeps every frame, reads the next ones and says so on each', async () => {
  const session = await injected('rule-step');
  assert.equal(session.frames.length, 2);
  assert.deepEqual(session.frames.map((frame) => frame.schemaVerdict), ['valid', 'valid']);
  assert.deepEqual(session.findings.map((finding) => [finding.rule, finding.subject.type]), [['capture.rule-check-failed', 'frame'], ['capture.rule-check-failed', 'frame']]);
});

// ---- evidence and the 5,000-frame workload (FR-018, SC-004, SC-007) ----------------------------------------------

/** Reads the scenario's bytes with a reader built the way the page builds it, with or without a declaration. */
async function framesOf(scenario: Extract<RuleFixture, { scenario: unknown }>['scenario'], declared: AgentCapabilities | undefined) {
  const store = createSessionStore({ schedule: (callback) => queueMicrotask(callback) });
  // A clock that ticks once per call, so two reads of the same bytes have the same offsets.
  let tick = 0;
  const recorder = createRecorder(createFrameSink(store, { declared: () => declared }), { now: () => (tick += 1), epoch: () => 1_700_000_000_000 });
  try {
    await drain((await recorder.record(scenario.request, scenarioSend(scenario))).body);
  } catch {
    // A scenario with no response has no frames.
  }
  return settled(store);
}

const EVERYTHING_FALSE: AgentCapabilities = { reasoning: { supported: false }, state: { deltas: false, snapshots: false }, humanInTheLoop: { interrupts: false } };

test('frames are exactly what was received, whatever the agent declares: the same frames, the received bytes, and a parsed value that is the JSON of the data', async () => {
  for (const [rule, fixture] of entries) {
    if (!('scenario' in fixture)) continue;
    const plain = await framesOf(fixture.scenario, undefined);
    const judged = await framesOf(fixture.scenario, EVERYTHING_FALSE);
    assert.deepEqual(judged.frames, plain.frames, `${rule}: a declaration changes no frame`);
    if (fixture.scenario.request.responseKind === 'protobuf') {
      const kept = Buffer.concat(plain.frames.map((frame) => Buffer.from(frame.bytes ?? '', 'base64')));
      assert.deepEqual(new Uint8Array(kept), scenarioBytes(fixture.scenario), `${rule}: the frames hold the received bytes`);
      continue;
    }
    assert.equal(plain.frames.map((frame) => frame.envelope).join(''), decoder.decode(scenarioBytes(fixture.scenario)), `${rule}: the envelopes are the received bytes`);
    for (const frame of plain.frames) if (frame.data !== undefined && frame.jsonVerdict === 'valid') assert.deepEqual(frame.parsed, JSON.parse(frame.data), `${rule}: ${frame.id}`);
  }
});

test('5,000 frames that each break the declaration are all kept, each gets one finding, and the inspection model builds from them', async () => {
  const delta = { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/n', value: 1 }] };
  const events = [started, ...Array.from({ length: 4_998 }, () => delta), { type: 'RUN_FINISHED', threadId: 't-rule', runId: 'r-rule', outcome: { type: 'success' } }];
  const scenario = { ...stream('workload-state-deltas', events), chunks: fragment(encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')), [4096]) };
  const begun = Date.now();
  const plain = await framesOf(scenario, undefined);
  const judged = await framesOf(scenario, { state: { deltas: false } });
  assert.equal(plain.frames.length, 5_000);
  assert.deepEqual(judged.frames, plain.frames, 'the same 5,000 frames');
  assert.deepEqual(plain.findings, []);
  assert.equal(judged.findings.length, 4_998);
  assert.equal(new Set(judged.findings.map((finding) => finding.id)).size, 4_998);
  assert.ok(judged.findings.every((finding) => finding.rule === 'capability.state-delta-unsupported'));

  // The views build their model from the snapshot, with a finding on nearly every frame.
  const index = indexSession(judged);
  const [entry] = listExchanges(index, NO_FILTER).exchanges;
  assert.equal(exchangeRows(entry!.entry, { ...NO_FILTER, issuesOnly: true }).shown, 4_998);
  assert.equal(exchangeRows(entry!.entry, NO_FILTER).shown, 5_000);
  // Linear work: a generous ceiling that only a quadratic mistake would break, on a slow machine too.
  assert.ok(Date.now() - begun < 20_000, 'reading and indexing 5,000 findings is quick');
});
