// One fixture that breaks each rule of the rule catalogue (specs/007-protocol-rule-catalogue, FR-021). Model-free and
// offline. A stream fixture is a recorder scenario, so the same bytes can be played through the recorder and the frame
// reader (`via: 'reader'`) or through the runtime and the real protocol client (`via: 'client'`). A fixture for a
// failure of the inspector's own machinery names the seam to break instead, and the test that plays it holds the
// injection. The conformance suite of the next minor reuses these fixtures.
// Streams use LF delimiters: the protocol client's own parser only reads LF.
// Erasable TypeScript only, so Node can run it directly.
import type { AgentCapabilities } from '@ag-ui/core';
import type { CatalogueRuleId } from '../../packages/inspector/src/core/rules/catalogue.ts';
import type { FindingSubject } from '../../packages/inspector/src/contracts.ts';
import { eventFixtures, invalidCases, missingTerminalScenarios } from './protocol-fixtures.ts';
import { fragment, type RecorderScenario } from './recorder-fixtures.ts';

const encoder = new TextEncoder();
const json = JSON.stringify;

/** Where a finding of the rule sits. A rule can have more than one: a bad frame also fails the client's run. */
export type Lands = FindingSubject['type'];

export type RuleFixture =
  | {
      readonly scenario: RecorderScenario;
      readonly via: 'reader' | 'client';
      /** Every subject the fixture must produce a finding of this rule on. */
      readonly lands: readonly Lands[];
      /** What the selected agent declares while the stream is read. */
      readonly declared?: AgentCapabilities;
    }
  | {
      /** The seam of the inspector's own machinery that the test breaks. */
      readonly injected: 'schema-check' | 'capture-sink' | 'capture-clone' | 'rule-step' | 'client-error';
      readonly lands: readonly Lands[];
    };

const THREAD = 't-rule';
const RUN = 'r-rule';

/** Events with the identifiers of the fixtures' run. */
export const started = { type: 'RUN_STARTED', threadId: THREAD, runId: RUN } as const;
export const finished = { type: 'RUN_FINISHED', threadId: THREAD, runId: RUN, outcome: { type: 'success' } } as const;

const runInput = json({ threadId: THREAD, runId: RUN, messages: [], state: {}, tools: [], context: [], forwardedProps: {} });

/** A stream of exactly these events, as LF-delimited `data:` frames, cut into uneven chunks. */
export function stream(name: string, events: readonly (object | string)[], overrides: Partial<RecorderScenario> = {}): RecorderScenario {
  const text = events.map((event) => `data: ${typeof event === 'string' ? event : json(event)}\n\n`).join('');
  return {
    name,
    request: { kind: 'conversation', method: 'POST', path: '/agent', body: runInput, responseKind: 'sse' },
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: fragment(encoder.encode(text), [37, 64]),
    ending: 'close',
    ...overrides,
  };
}

const client = (name: string, ...events: readonly object[]): RuleFixture => ({ scenario: stream(name, events), via: 'client', lands: ['run'] });

const text = (messageId: string, extra: object = {}) => ({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', ...extra });
const tool = (toolCallId: string) => ({ type: 'TOOL_CALL_START', toolCallId, toolCallName: 'search_documents' });
const subagent = (subagentRunId: string, extra: object = {}) => ({ type: 'SUBAGENT_STARTED', subagentRunId, name: 'researcher', ...extra });

/** Rules whose fixtures exist so far. Tightened to every catalogue id once the last family is in. */
export const ruleFixtures: Partial<Record<CatalogueRuleId, RuleFixture>> = {
  'json.invalid': {
    scenario: stream('rule-json-invalid', [started, invalidCases.truncatedJson.data, finished]),
    via: 'client',
    lands: ['frame', 'run'],
  },
  'schema.unknown-event-type': { scenario: stream('rule-schema-unknown-event-type', [started, invalidCases.unknownType.data, finished]), via: 'reader', lands: ['frame'] },
  'schema.invalid-event': { scenario: stream('rule-schema-invalid-event', [started, invalidCases.wrongFieldType.data, finished]), via: 'client', lands: ['frame', 'run'] },
  'schema.check-failed': { injected: 'schema-check', lands: ['frame'] },

  'terminal.missing': { scenario: missingTerminalScenarios.closedAfterContent, via: 'reader', lands: ['exchange'] },
  'transport.failed': { scenario: stream('rule-transport-failed', [], { ending: 'no-response' }), via: 'reader', lands: ['exchange'] },
  'capture.failed': { injected: 'capture-sink', lands: ['exchange'] },
  'capture.response-not-captured': { injected: 'capture-clone', lands: ['exchange'] },

  'sequence.first-event': client('rule-sequence-first-event', { type: 'CUSTOM', name: 'n', value: 1 }, finished),
  'sequence.event-after-run-finished': client('rule-sequence-event-after-run-finished', started, finished, { type: 'CUSTOM', name: 'n', value: 1 }),
  'sequence.event-after-run-error': client('rule-sequence-event-after-run-error', started, { type: 'RUN_ERROR', message: 'failed' }, { type: 'CUSTOM', name: 'n', value: 1 }),
  'sequence.run-started-while-active': client('rule-sequence-run-started-while-active', started, started, finished),
  'sequence.run-finished-while-open': client('rule-sequence-run-finished-while-open', started, text('m1'), finished),
  'sequence.text-message-already-open': client('rule-sequence-text-message-already-open', started, text('m1'), text('m1'), finished),
  'sequence.text-message-not-open': client('rule-sequence-text-message-not-open', started, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x' }, finished),
  'sequence.tool-call-already-open': client('rule-sequence-tool-call-already-open', started, tool('c1'), tool('c1'), finished),
  'sequence.tool-call-not-open': client('rule-sequence-tool-call-not-open', started, { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{}' }, finished),
  'sequence.step-already-open': client('rule-sequence-step-already-open', started, { type: 'STEP_STARTED', stepName: 'plan' }, { type: 'STEP_STARTED', stepName: 'plan' }, finished),
  'sequence.step-not-open': client('rule-sequence-step-not-open', started, { type: 'STEP_FINISHED', stepName: 'plan' }, finished),
  'sequence.reasoning-span-already-open': client('rule-sequence-reasoning-span-already-open', started, { type: 'REASONING_START', messageId: 'rs1' }, { type: 'REASONING_START', messageId: 'rs1' }, finished),
  'sequence.reasoning-span-not-open': client('rule-sequence-reasoning-span-not-open', started, { type: 'REASONING_END', messageId: 'rs1' }, finished),
  'sequence.reasoning-message-already-open': client(
    'rule-sequence-reasoning-message-already-open',
    started,
    { type: 'REASONING_MESSAGE_START', messageId: 'rs1', role: 'reasoning' },
    { type: 'REASONING_MESSAGE_START', messageId: 'rs1', role: 'reasoning' },
    finished,
  ),
  'sequence.reasoning-message-not-open': client('rule-sequence-reasoning-message-not-open', started, { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rs1', delta: 'x' }, finished),
  'sequence.subagent-already-active': client('rule-sequence-subagent-already-active', started, subagent('s1'), subagent('s1'), finished),
  'sequence.subagent-id-reused': client('rule-sequence-subagent-id-reused', started, subagent('s1'), { type: 'SUBAGENT_FINISHED', subagentRunId: 's1' }, subagent('s1'), finished),
  'sequence.subagent-parent-unknown': client('rule-sequence-subagent-parent-unknown', started, subagent('s1', { parentSubagentRunId: 's0' }), finished),
  'sequence.subagent-not-active': client('rule-sequence-subagent-not-active', started, { type: 'SUBAGENT_FINISHED', subagentRunId: 's1' }, finished),
  'sequence.owner-mismatch': client(
    'rule-sequence-owner-mismatch',
    started,
    text('m1', { subagentRunId: 'a' }),
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'x', subagentRunId: 'b' },
    finished,
  ),
  /** At 1.0.1 every message the client can raise has its own rule, so only a synthetic error reaches this one. */
  'sequence.unclassified': { injected: 'client-error', lands: ['run'] },

  'capture.rule-check-failed': { injected: 'rule-step', lands: ['frame'] },

  'compat.retired-event-type': {
    scenario: stream('rule-compat-retired-event-type', [
      started,
      { type: 'THINKING_START', title: 'planning' },
      { type: 'THINKING_TEXT_MESSAGE_START' },
      { type: 'THINKING_TEXT_MESSAGE_CONTENT', delta: 'hm' },
      { type: 'THINKING_TEXT_MESSAGE_END' },
      { type: 'THINKING_END' },
      finished,
    ]),
    via: 'reader',
    lands: ['frame'],
  },
  'compat.null-optional-field': { scenario: stream('rule-compat-null-optional-field', [started, { ...finished, result: null }]), via: 'reader', lands: ['frame'] },
  'compat.legacy-binary-content': {
    scenario: stream('rule-compat-legacy-binary-content', [
      started,
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: [{ type: 'binary', mimeType: 'image/png', data: 'AAAA' }] }] },
      finished,
    ]),
    via: 'reader',
    lands: ['frame'],
  },
  'compat.protocol-version-newer': { scenario: stream('rule-compat-protocol-version-newer', [{ ...started, protocolVersion: '2.0' }, finished]), via: 'reader', lands: ['frame'] },
  'compat.protocol-version-unreadable': { scenario: stream('rule-compat-protocol-version-unreadable', [{ ...started, protocolVersion: '1.0.1' }, finished]), via: 'reader', lands: ['frame'] },

  'capability.reasoning-unsupported': {
    scenario: stream('rule-capability-reasoning', [started, { type: 'REASONING_START', messageId: 'rs1' }, { type: 'REASONING_END', messageId: 'rs1' }, finished]),
    via: 'reader',
    lands: ['frame'],
    declared: { reasoning: { supported: false } },
  },
  'capability.interrupt-unsupported': {
    scenario: stream('rule-capability-interrupt', [started, { ...finished, outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval', message: 'Approve?' }] } }]),
    via: 'reader',
    lands: ['frame'],
    declared: { humanInTheLoop: { interrupts: false } },
  },
  'capability.state-delta-unsupported': {
    scenario: stream('rule-capability-state-delta', [started, eventFixtures.STATE_DELTA, finished]),
    via: 'reader',
    lands: ['frame'],
    declared: { state: { deltas: false } },
  },
  'capability.state-snapshot-unsupported': {
    scenario: stream('rule-capability-state-snapshot', [started, eventFixtures.STATE_SNAPSHOT, finished]),
    via: 'reader',
    lands: ['frame'],
    declared: { state: { snapshots: false } },
  },
};

/**
 * One stream for an agent whose declaration it breaks three times: a reasoning span, a state delta and an interrupt
 * outcome. The hosted end-to-end check serves it, and declares `reasoning.supported`, `state.deltas` and
 * `humanInTheLoop.interrupts` as `false` for the agent.
 */
export function contradictionEvents(ids: { readonly threadId: string; readonly runId: string }): readonly object[] {
  return [
    { type: 'RUN_STARTED', ...ids },
    { type: 'REASONING_START', messageId: 'rs1' },
    { type: 'REASONING_END', messageId: 'rs1' },
    eventFixtures.STATE_DELTA,
    { type: 'RUN_FINISHED', ...ids, outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval', message: 'Approve the refund?' }] } },
  ];
}
