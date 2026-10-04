// F07 T014 (FR-009, FR-022): the sequence rules. The protocol client reports a violation as free text with no code, so
// every pattern is pinned here to the message that the real client raises for the rule's fixture, and a message that no
// pattern knows is `sequence.unclassified`. A client bump that rewords a message fails this test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGUIError, HttpAgent } from '@ag-ui/client';
import { ruleFixtures, started, stream, finished } from '../../../../examples/reference-agent/rule-fixtures.ts';
import { scenarioBytes, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import { RULES } from '../../src/core/rules/catalogue.ts';
import { SEQUENCE_PATTERNS, sequenceRuleOf } from '../../src/core/rules/sequence.ts';
import { AGENT, eventStream, rig } from '../runtime/support.ts';

const decoder = new TextDecoder();

/** What the real protocol client says when it is given the scenario's stream. */
async function clientMessage(scenario: RecorderScenario): Promise<string | undefined> {
  const text = decoder.decode(scenarioBytes(scenario));
  const agent = new HttpAgent({ url: AGENT, threadId: 't-rule', fetch: async () => eventStream(text) });
  let message: string | undefined;
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    await agent.runAgent({ runId: 'r-rule' }, { onRunFailed: ({ error }) => void (message = error instanceof AGUIError ? error.message : `not an AGUIError: ${String(error)}`) });
  } catch {
    // The failure reached the subscriber; the rejection of runAgent carries the same error.
  } finally {
    console.warn = warn;
  }
  return message;
}

const sequenceRules = RULES.filter((rule) => rule.family === 'sequence' && rule.id !== 'sequence.unclassified');

test('the catalogue has 20 sequence rules besides the fallback, and each has a pattern and a fixture', () => {
  assert.equal(sequenceRules.length, 20);
  assert.deepEqual(SEQUENCE_PATTERNS.map(([rule]) => rule).sort(), sequenceRules.map((rule) => rule.id).sort());
  for (const rule of sequenceRules) assert.ok(rule.id in ruleFixtures, `${rule.id} has a fixture`);
});

for (const { id } of sequenceRules) {
  test(`${id}: the real client raises a message that only this rule's pattern matches`, async () => {
    const fixture = ruleFixtures[id as keyof typeof ruleFixtures];
    assert.ok(fixture && 'scenario' in fixture && fixture.via === 'client');
    const message = await clientMessage(fixture.scenario);
    assert.ok(message !== undefined && !message.startsWith('not an AGUIError'), `the client rejects the stream: ${String(message)}`);
    assert.deepEqual(
      SEQUENCE_PATTERNS.filter(([, pattern]) => pattern.test(message)).map(([rule]) => rule),
      [id],
      message,
    );
    assert.equal(sequenceRuleOf(message), id);
  });
}

test('a message that no pattern knows is sequence.unclassified', () => {
  assert.equal(sequenceRuleOf("Cannot send 'SOMETHING_NEW' for a reason this version has no rule for"), 'sequence.unclassified');
  assert.equal(sequenceRuleOf(''), 'sequence.unclassified');
});

test('the finding on the run keeps the client message, clipped, and a stream with two violations gets one finding for the first', async () => {
  const twice = stream('twice', [started, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' }, { type: 'TOOL_CALL_END', toolCallId: 'c1' }, finished]);
  const text = decoder.decode(scenarioBytes(twice));
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? eventStream(text) : undefined)]);
  runtime.selectAgent({ id: 'support', name: 'Support', url: AGENT });
  await runtime.send('break the rules twice');
  const session = await settle();
  const findings = session.findings.filter((finding) => finding.kind === 'sequence');
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.subject.type]), [['sequence.text-message-not-open', 'run']]);
  assert.match(findings[0]!.message, /^Cannot send 'TEXT_MESSAGE_CONTENT' event: No active text message found/);
  assert.equal(session.frames.length, 4, 'every frame is still captured and read');
});
