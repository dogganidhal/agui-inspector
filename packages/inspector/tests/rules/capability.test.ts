// F07 T016 and T022 (FR-010 to FR-012, FR-024, SC-003, SC-005): a frame that contradicts an explicit `false` in the
// selected agent's declared capabilities gets a finding, and nothing else does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { AgentCapabilities } from '@ag-ui/core';
import { baselineRun, protocolScenarios, runError } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { scenarioBytes } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import { ruleFixtures } from '../../../../examples/reference-agent/rule-fixtures.ts';
import { interactiveResponse, SCENARIOS } from '../../../../examples/reference-agent/scenarios.ts';
import type { AgentConfig } from '../../src/contracts.ts';
import { declaredOf, loadCapabilities } from '../../src/core/config/index.ts';
import { capabilityRules } from '../../src/core/rules/frame-rules.ts';
import { AGENT, eventStream, rig } from '../runtime/support.ts';

const rulesOf = (event: unknown, declared: AgentCapabilities | undefined) => capabilityRules(event, declared).map((hit) => hit.rule);

const REASONING = ['REASONING_START', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END', 'REASONING_MESSAGE_CHUNK', 'REASONING_END', 'REASONING_ENCRYPTED_VALUE'];
const RETIRED = ['THINKING_START', 'THINKING_END', 'THINKING_TEXT_MESSAGE_START', 'THINKING_TEXT_MESSAGE_CONTENT', 'THINKING_TEXT_MESSAGE_END'];
const interrupt = { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval' }] } };

const CASES = [
  ['capability.reasoning-unsupported', { type: 'REASONING_START', messageId: 'rs1' }, { reasoning: { supported: false } }, { reasoning: { supported: true } }, { reasoning: {} }],
  ['capability.interrupt-unsupported', interrupt, { humanInTheLoop: { interrupts: false } }, { humanInTheLoop: { interrupts: true } }, { humanInTheLoop: { supported: true } }],
  ['capability.state-delta-unsupported', { type: 'STATE_DELTA', delta: [] }, { state: { deltas: false } }, { state: { deltas: true } }, { state: { snapshots: true } }],
  ['capability.state-snapshot-unsupported', { type: 'STATE_SNAPSHOT', snapshot: {} }, { state: { snapshots: false } }, { state: { snapshots: true } }, { state: { deltas: true } }],
] as const;

for (const [rule, event, declaredFalse, declaredTrue, omitted] of CASES) {
  test(`${rule}: fires on false, and on nothing when the flag is true, omitted, its group is omitted or nothing is declared`, () => {
    assert.deepEqual(rulesOf(event, declaredFalse), [rule]);
    assert.deepEqual(rulesOf(event, declaredTrue), []);
    assert.deepEqual(rulesOf(event, omitted), []);
    assert.deepEqual(rulesOf(event, {}), []);
    assert.deepEqual(rulesOf(event, undefined), []);
    assert.match(capabilityRules(event, declaredFalse)[0]!.message, /came from an agent that declares [a-zA-Z.]+: false$/);
  });
}

test('every reasoning event, encrypted and chunk included, and every retired THINKING type fires the reasoning rule', () => {
  for (const type of [...REASONING, ...RETIRED]) assert.deepEqual(rulesOf({ type }, { reasoning: { supported: false } }), ['capability.reasoning-unsupported'], type);
  assert.deepEqual(rulesOf({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, { reasoning: { supported: false } }), [], 'a text reply from the same agent is fine');
  assert.deepEqual(rulesOf({ type: 'REASONING_FROM_THE_FUTURE' }, { reasoning: { supported: false } }), [], 'only the fixed list of reasoning types counts');
});

test('another flag does not stand in for the one a rule names', () => {
  assert.deepEqual(rulesOf(interrupt, { humanInTheLoop: { supported: false } }), []);
  assert.deepEqual(rulesOf({ type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'x' }, { tools: { supported: false } }), []);
  assert.deepEqual(rulesOf({ type: 'SUBAGENT_STARTED', subagentRunId: 's', name: 'n' }, { multiAgent: { supported: false } }), []);
  assert.deepEqual(rulesOf({ type: 'STATE_DELTA', delta: [] }, { state: { snapshots: false } }), []);
});

test('only an interrupt outcome of RUN_FINISHED is an interrupt', () => {
  const declared = { humanInTheLoop: { interrupts: false } };
  assert.deepEqual(rulesOf({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'success' } }, declared), []);
  assert.deepEqual(rulesOf({ type: 'RUN_FINISHED', threadId: 't', runId: 'r' }, declared), []);
  assert.deepEqual(rulesOf({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: null }, declared), []);
  assert.deepEqual(rulesOf({ type: 'RUN_ERROR', message: 'x', outcome: { type: 'interrupt' } }, declared), []);
});

test('the event type is read whether or not the rest of the event is valid, and data that is not an object gives nothing', () => {
  assert.deepEqual(rulesOf({ type: 'STATE_DELTA' }, { state: { deltas: false } }), ['capability.state-delta-unsupported'], 'no delta field');
  assert.deepEqual(rulesOf({ type: 'RUN_FINISHED', outcome: { type: 'interrupt' } }, { humanInTheLoop: { interrupts: false } }), ['capability.interrupt-unsupported'], 'no run id');
  for (const value of [42, null, [{ type: 'STATE_DELTA' }], 'STATE_DELTA', undefined, { type: 7 }]) assert.deepEqual(rulesOf(value, { state: { deltas: false } }), [], JSON.stringify(value));
});

test('one frame can break two rules, and no message repeats a received value', () => {
  const declared = { state: { deltas: false }, reasoning: { supported: false } };
  assert.deepEqual(rulesOf({ type: 'STATE_DELTA', delta: [] }, declared), ['capability.state-delta-unsupported']);
  const secret = 'synthetic-token-1234567890';
  for (const hit of capabilityRules({ type: 'REASONING_START', messageId: secret, delta: secret }, declared)) assert.ok(!hit.message.includes(secret));
});

// ---- behavior through the real runtime, the real reader and the real capabilities loader (T022) -----------------

const decoder = new TextDecoder();
const CAPABILITY_RULES = ['capability.reasoning-unsupported', 'capability.interrupt-unsupported', 'capability.state-delta-unsupported', 'capability.state-snapshot-unsupported'] as const;

/** Plays a fixture's stream through the real runtime with the declaration a configured agent would give. */
async function runWith(rule: (typeof CAPABILITY_RULES)[number], agent: AgentConfig, loaded?: AgentCapabilities) {
  const fixture = ruleFixtures[rule];
  assert.ok(fixture && 'scenario' in fixture);
  const text = decoder.decode(scenarioBytes(fixture.scenario));
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? eventStream(text) : undefined)]);
  runtime.selectAgent(agent);
  runtime.setDeclaredCapabilities(declaredOf(agent, loaded === undefined ? undefined : { source: 'url', url: String(agent.capabilities), groups: [], declared: loaded }));
  await runtime.send('hello');
  // A reasoning span has two events, so the rule can fire twice: one finding for each contradicting frame.
  return [...new Set((await settle()).findings.filter((finding) => finding.rule?.startsWith('capability.')).map((finding) => finding.rule))];
}

const flagOf = (rule: (typeof CAPABILITY_RULES)[number], value: boolean): AgentCapabilities => {
  const declared = (ruleFixtures[rule] as { declared: AgentCapabilities }).declared;
  const [group, flags] = Object.entries(declared)[0] as [string, Record<string, boolean>];
  return { [group]: Object.fromEntries(Object.keys(flags).map((key) => [key, value])) } as AgentCapabilities;
};

for (const rule of CAPABILITY_RULES) {
  test(`${rule}: through the runtime, a declaration given inline or by URL gives a finding on false and none on true or when omitted`, async () => {
    const inline = (capabilities: AgentCapabilities): AgentConfig => ({ id: 'a', name: 'A', url: AGENT, capabilities });
    assert.deepEqual(await runWith(rule, inline(flagOf(rule, false))), [rule], 'inline false');
    assert.deepEqual(await runWith(rule, inline(flagOf(rule, true))), [], 'inline true');
    assert.deepEqual(await runWith(rule, { id: 'a', name: 'A', url: AGENT }), [], 'no declaration');

    // By URL: read by the real loader, through a callback standing in for the guarded transport.
    const byUrl = { id: 'a', name: 'A', url: AGENT, capabilities: '/a/capabilities' } as const;
    const read = async (declared: AgentCapabilities) => {
      const result = await loadCapabilities(byUrl, async () => JSON.stringify(declared));
      assert.ok(result.ok);
      return result.value.declared;
    };
    assert.deepEqual(await runWith(rule, byUrl, await read(flagOf(rule, false))), [rule], 'URL false');
    assert.deepEqual(await runWith(rule, byUrl, await read(flagOf(rule, true))), [], 'URL true');
    assert.deepEqual(await runWith(rule, byUrl, await read({ identity: { name: 'x' } })), [], 'URL without the flag');
  });
}

test('a capabilities URL that failed to load, or has not loaded when the stream starts, gives no finding and no new error', async () => {
  const byUrl = { id: 'a', name: 'A', url: AGENT, capabilities: '/a/capabilities' } as const;
  const failed = await loadCapabilities(byUrl, async () => Promise.reject(new TypeError('offline')));
  assert.equal(failed.ok, false);
  const { runtime, settle } = rig([(call) => (call.path === '/run' ? eventStream(decoder.decode(scenarioBytes((ruleFixtures['capability.state-delta-unsupported'] as { scenario: Parameters<typeof scenarioBytes>[0] }).scenario))) : undefined)]);
  runtime.selectAgent(byUrl);
  runtime.setDeclaredCapabilities(declaredOf(byUrl, undefined));
  await runtime.send('hello');
  const session = await settle();
  assert.deepEqual(session.findings, []);
  assert.equal(runtime.getState().error, undefined);
});

test('no scenario of the reference agent and no demo agent produces a capability finding under its own declared capabilities', async () => {
  const demo = JSON.parse(readFileSync(path.join(process.cwd(), 'demo', 'config.json'), 'utf8')) as { agents: AgentConfig[] };
  const streams: string[] = [
    ...Object.values(protocolScenarios).map((scenario) => decoder.decode(scenarioBytes(scenario))),
    decoder.decode(scenarioBytes(baselineRun())),
    decoder.decode(scenarioBytes(runError())),
  ];
  const input = { threadId: 't', runId: 'r', messages: [{ role: 'user', content: '' }] };
  for (const scenario of Object.values(SCENARIOS)) {
    const reply = interactiveResponse({ ...input, messages: [{ role: 'user', content: scenario }] });
    if (reply.ending === 'close') streams.push(decoder.decode(Buffer.concat(reply.chunks)));
  }
  streams.push(decoder.decode(Buffer.concat(interactiveResponse(input).chunks)));
  assert.ok(streams.length > 10);

  for (const agent of demo.agents) {
    assert.ok(typeof agent.capabilities === 'object', `${agent.id} declares inline capabilities`);
    for (const text of streams) {
      const { runtime, settle } = rig([(call) => (call.path === '/run' ? eventStream(text) : undefined)]);
      runtime.selectAgent({ ...agent, url: AGENT });
      runtime.setDeclaredCapabilities(declaredOf(agent, undefined));
      await runtime.send('hello');
      const found = (await settle()).findings.filter((finding) => finding.rule?.startsWith('capability.'));
      assert.deepEqual(found, [], `${agent.id}: ${text.slice(0, 60)}`);
    }
  }
});

