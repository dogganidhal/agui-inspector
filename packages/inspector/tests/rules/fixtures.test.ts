// F07 T013 (FR-021, FR-022, SC-001): every rule has a fixture that breaks it, and playing the fixture produces a
// finding with exactly that rule on the right subject. Stream fixtures go through the real recorder and frame reader,
// or through the real runtime and the real protocol client when the client is the one that reports the rule. A fixture
// for a failure of the inspector's own machinery names the seam, and the injection for each seam is below.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGUIError } from '@ag-ui/core';
import { ruleFixtures, started, stream, type Lands, type RuleFixture } from '../../../../examples/reference-agent/rule-fixtures.ts';
import { scenarioBytes, scenarioSend } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { Finding, InspectionSession } from '../../src/contracts.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createRecorder, type RecorderSink } from '../../src/core/recorder/index.ts';
import { RULES, type CatalogueRuleId } from '../../src/core/rules/catalogue.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { AGENT, eventStream, rig } from '../runtime/support.ts';

const decoder = new TextDecoder();
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
  const text = decoder.decode(scenarioBytes(fixture.scenario));
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? eventStream(text) : undefined)]);
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
    case 'rule-step':
      throw new Error('the rule step has no fixture until the compat step exists');
    default:
      return seam satisfies never;
  }
}

const play = (fixture: RuleFixture) => ('injected' in fixture ? injected(fixture.injected) : fixture.via === 'client' ? viaClient(fixture) : viaReader(fixture));

const subjectsOf = (session: InspectionSession, rule: string): Lands[] => session.findings.filter((finding) => finding.rule === rule).map((finding) => finding.subject.type);

const entries = Object.entries(ruleFixtures) as Array<[CatalogueRuleId, RuleFixture]>;

for (const [rule, fixture] of entries) {
  if ('injected' in fixture && fixture.injected === 'rule-step') continue;
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

test('every rule of this phase has a fixture', () => {
  const missing = RULES.filter((rule) => rule.family !== 'compat' && rule.id !== 'capture.rule-check-failed' && !(rule.id in ruleFixtures)).map((rule) => rule.id);
  assert.deepEqual(missing, []);
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
