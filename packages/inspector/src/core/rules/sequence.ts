// Which sequence rule a protocol-client rejection belongs to. Framework-free.
//
// The protocol client stays the only judge of order: the inspector runs no sequence check of its own. The client
// reports a violation as an AGUIError with free text and no code, so the text is the only handle. Each pattern is
// anchored on the wording of @ag-ui/client 1.0.1, and tests/rules/sequence.test.ts pins every one to the message the
// real client raises for the rule's fixture. A message that no pattern matches, because a client release reworded or
// added a check, is `sequence.unclassified`: it still becomes a finding.
import type { CatalogueRuleId } from './catalogue.ts';

type SequenceRule = Extract<CatalogueRuleId, `sequence.${string}`>;

// The owner rule comes first: its messages also start with "Cannot send '...'".
export const SEQUENCE_PATTERNS: ReadonlyArray<readonly [SequenceRule, RegExp]> = [
  ['sequence.owner-mismatch', /does not match the (message|tool call) '|does not match its parent message|that step is open under|is owned by '/],
  ['sequence.first-event', /^First event must be 'RUN_STARTED'/],
  ['sequence.event-after-run-finished', /^Cannot send event type '[^']*': The run has already finished/],
  ['sequence.event-after-run-error', /^Cannot send event type '[^']*': The run has already errored/],
  ['sequence.run-started-while-active', /^Cannot send 'RUN_STARTED' while a run is still active/],
  ['sequence.run-finished-while-open', /^Cannot send 'RUN_FINISHED' while .+ are still active/],
  ['sequence.text-message-already-open', /^Cannot send 'TEXT_MESSAGE_START' event: A text message with ID/],
  ['sequence.text-message-not-open', /^Cannot send 'TEXT_MESSAGE_(CONTENT|END)' event: No active text message/],
  ['sequence.tool-call-already-open', /^Cannot send 'TOOL_CALL_START' event: A tool call with ID/],
  ['sequence.tool-call-not-open', /^Cannot send 'TOOL_CALL_(ARGS|END)' event: No active tool call/],
  ['sequence.step-already-open', /^Step ".*" is already active for 'STEP_STARTED'/],
  ['sequence.step-not-open', /^Cannot send 'STEP_FINISHED' for step ".*" that was not started/],
  ['sequence.reasoning-span-already-open', /^Cannot send 'REASONING_START' event: A reasoning span with ID/],
  ['sequence.reasoning-span-not-open', /^Cannot send 'REASONING_END' event: No active reasoning span/],
  ['sequence.reasoning-message-already-open', /^Cannot send 'REASONING_MESSAGE_START' event: A reasoning message with ID/],
  ['sequence.reasoning-message-not-open', /^Cannot send '(REASONING_MESSAGE_CONTENT|REASONING_MESSAGE_END)' event: No active reasoning message/],
  ['sequence.subagent-already-active', /^Cannot send 'SUBAGENT_STARTED': subagent '.*' is already active/],
  ['sequence.subagent-id-reused', /^Cannot send 'SUBAGENT_STARTED': subagent '.*' has already finished in this run/],
  ['sequence.subagent-parent-unknown', /^Cannot send 'SUBAGENT_STARTED': parentSubagentRunId '.*' has not been started/],
  ['sequence.subagent-not-active', /^Cannot send '(SUBAGENT_FINISHED|SUBAGENT_ERROR)': no active subagent found/],
];

/** The rule for the full, unclipped message of a client `AGUIError`. */
export function sequenceRuleOf(message: string): SequenceRule {
  return SEQUENCE_PATTERNS.find(([, pattern]) => pattern.test(message))?.[0] ?? 'sequence.unclassified';
}
