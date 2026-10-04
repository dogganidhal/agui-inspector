// The rule catalogue (specs/007-protocol-rule-catalogue). Framework-free: no React, no DOM.
//
// Every finding the inspector creates names one rule from this list. The ids are a public contract: the
// server suite and the rule pages of the next minor build on them. An id is never renamed, reused for another
// meaning or removed, and a split adds new ids and withdraws the old one. Adding a rule is not a breaking change.
//
// An id is `<family>.<problem>`. The family is the finding's kind, so a reader can group by it without a table.
import type { FindingKind } from '../../contracts.ts';

type Family = Exclude<FindingKind, 'projection'>;

export interface RuleDefinition {
  readonly id: string;
  readonly family: Family;
  /** One sentence. May be reworded when its meaning stays. */
  readonly summary: string;
}

export const RULES = [
  { id: 'json.invalid', family: 'json', summary: 'The data is not valid JSON.' },
  { id: 'schema.unknown-event-type', family: 'schema', summary: 'The event type is not in the supported baseline.' },
  { id: 'schema.invalid-event', family: 'schema', summary: 'The data is JSON but not a valid AG-UI event.' },
  { id: 'schema.check-failed', family: 'schema', summary: "The inspector's schema check failed on this frame. The frame is kept and marked invalid." },

  { id: 'sequence.first-event', family: 'sequence', summary: 'The stream starts with an event other than RUN_STARTED or RUN_ERROR.' },
  { id: 'sequence.event-after-run-finished', family: 'sequence', summary: 'An event follows RUN_FINISHED.' },
  { id: 'sequence.event-after-run-error', family: 'sequence', summary: 'An event follows RUN_ERROR.' },
  { id: 'sequence.run-started-while-active', family: 'sequence', summary: 'RUN_STARTED arrives while a run is active.' },
  {
    id: 'sequence.run-finished-while-open',
    family: 'sequence',
    summary: 'RUN_FINISHED arrives while a step, text message, reasoning span, reasoning message, tool call or subagent is open.',
  },
  { id: 'sequence.text-message-already-open', family: 'sequence', summary: 'A text message starts with an id that is already open.' },
  { id: 'sequence.text-message-not-open', family: 'sequence', summary: 'Content or an end arrives for a text message that is not open.' },
  { id: 'sequence.tool-call-already-open', family: 'sequence', summary: 'A tool call starts with an id that is already open.' },
  { id: 'sequence.tool-call-not-open', family: 'sequence', summary: 'Arguments or an end arrive for a tool call that is not open.' },
  { id: 'sequence.step-already-open', family: 'sequence', summary: 'A step starts that is already open.' },
  { id: 'sequence.step-not-open', family: 'sequence', summary: 'A step finishes that was not started.' },
  { id: 'sequence.reasoning-span-already-open', family: 'sequence', summary: 'A reasoning span starts with an id that is already open.' },
  { id: 'sequence.reasoning-span-not-open', family: 'sequence', summary: 'A reasoning span ends that is not open.' },
  { id: 'sequence.reasoning-message-already-open', family: 'sequence', summary: 'A reasoning message starts with an id that is already open.' },
  { id: 'sequence.reasoning-message-not-open', family: 'sequence', summary: 'Content or an end arrives for a reasoning message that is not open.' },
  { id: 'sequence.subagent-already-active', family: 'sequence', summary: 'A subagent starts that is already active.' },
  { id: 'sequence.subagent-id-reused', family: 'sequence', summary: 'A subagent starts with an id that already finished in this run.' },
  { id: 'sequence.subagent-parent-unknown', family: 'sequence', summary: 'A subagent starts under a parent subagent that was never started.' },
  { id: 'sequence.subagent-not-active', family: 'sequence', summary: 'A subagent finishes or fails that is not active.' },
  {
    id: 'sequence.owner-mismatch',
    family: 'sequence',
    summary: 'An event continues or finishes something under a different subagent than the one that opened it.',
  },
  { id: 'sequence.unclassified', family: 'sequence', summary: 'The client rejected the stream for a reason that no other sequence rule names.' },

  { id: 'terminal.missing', family: 'terminal', summary: 'The stream ended without a valid RUN_FINISHED or RUN_ERROR.' },

  { id: 'transport.failed', family: 'transport', summary: 'The request failed before a response, or the connection failed during the stream.' },

  { id: 'capture.failed', family: 'capture', summary: "The inspector's recording failed. Reported once." },
  { id: 'capture.response-not-captured', family: 'capture', summary: 'The response could not be copied for recording.' },
  { id: 'capture.rule-check-failed', family: 'capture', summary: 'A rule check failed on this frame. The frame is kept.' },

  { id: 'compat.retired-event-type', family: 'compat', summary: 'A retired THINKING_* event type. The client reads it as the matching REASONING_* event.' },
  { id: 'compat.null-optional-field', family: 'compat', summary: 'An optional field is null. The client reads it as absent.' },
  { id: 'compat.legacy-binary-content', family: 'compat', summary: 'A message holds a binary content part. The client converts it to a media part.' },
  { id: 'compat.protocol-version-newer', family: 'compat', summary: 'RUN_STARTED declares a protocol version newer than the client speaks.' },
  { id: 'compat.protocol-version-unreadable', family: 'compat', summary: 'RUN_STARTED declares a protocol version that is not written as major.minor.' },

  { id: 'capability.reasoning-unsupported', family: 'capability', summary: 'A reasoning event came from an agent that declares reasoning as unsupported.' },
  { id: 'capability.interrupt-unsupported', family: 'capability', summary: 'An interrupt outcome came from an agent that declares interrupts as unsupported.' },
  { id: 'capability.state-delta-unsupported', family: 'capability', summary: 'A state delta came from an agent that declares state deltas as unsupported.' },
  { id: 'capability.state-snapshot-unsupported', family: 'capability', summary: 'A state snapshot came from an agent that declares state snapshots as unsupported.' },
] as const satisfies readonly RuleDefinition[];

export type CatalogueRuleId = (typeof RULES)[number]['id'];

const BY_ID: ReadonlyMap<string, RuleDefinition> = new Map(RULES.map((rule) => [rule.id, rule]));

/** The rule this version knows by that id, if any. An id from a newer version is well formed and unknown. */
export const ruleOf = (id: string): RuleDefinition | undefined => BY_ID.get(id);

/** The kind of every finding of the rule: its family. */
export const kindOf = (rule: CatalogueRuleId): Family => rule.slice(0, rule.indexOf('.')) as Family;

export const RULE_ID_PATTERN = /^[a-z]+\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** The problem with a finding's rule, or `undefined` when it is a well-formed id of the finding's own family. */
export function checkRuleId(kind: FindingKind, rule: string): string | undefined {
  if (!RULE_ID_PATTERN.test(rule)) return 'rule must be <family>.<problem>';
  return rule.slice(0, rule.indexOf('.')) === kind ? undefined : 'rule family must match kind';
}
