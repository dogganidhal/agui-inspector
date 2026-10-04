// Rules that read one parsed frame: capability consistency and the older event shapes the client accepts.
// Framework-free: no React, nothing but plain data.
//
// Nothing here changes a frame. The reader hands these functions the parsed value it already holds and gets
// back what applies; the frame, its text and its parsed value stay exactly as they arrived.
import { EventType, type AgentCapabilities } from '@ag-ui/core';
import type { CatalogueRuleId } from './catalogue.ts';

export interface RuleHit {
  readonly rule: CatalogueRuleId;
  readonly message: string;
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// Capability consistency
// ---------------------------------------------------------------------------------------------

/** The five event types that the protocol client still reads as `REASONING_*` events. */
export const RETIRED_THINKING_TYPES: ReadonlySet<string> = new Set([
  'THINKING_START',
  'THINKING_END',
  'THINKING_TEXT_MESSAGE_START',
  'THINKING_TEXT_MESSAGE_CONTENT',
  'THINKING_TEXT_MESSAGE_END',
]);

/** Every reasoning event of the baseline, and the retired types that the client reads as them. Fixed lists, so a hostile type name never reaches a message. */
const REASONING_TYPES: ReadonlySet<string> = new Set([...Object.values(EventType).filter((type) => type.startsWith('REASONING_')), ...RETIRED_THINKING_TYPES]);

/**
 * The capability rules that a frame breaks. A rule fires only when the agent declares its flag as exactly `false`:
 * an omitted flag means "not declared", not "unsupported". The event type is read whether or not the rest of the
 * event is valid, and a retired `THINKING_*` type counts as the reasoning event the client reads it as.
 */
export function capabilityRules(event: unknown, declared: AgentCapabilities | undefined): RuleHit[] {
  if (declared === undefined || !isObject(event) || typeof event.type !== 'string') return [];
  const { type } = event;
  const hits: RuleHit[] = [];
  const contradicts = (rule: CatalogueRuleId, what: string, flag: string) => hits.push({ rule, message: `${what} came from an agent that declares ${flag}: false` });

  if (declared.reasoning?.supported === false && REASONING_TYPES.has(type)) {
    contradicts('capability.reasoning-unsupported', type, 'reasoning.supported');
  }
  if (declared.humanInTheLoop?.interrupts === false && type === 'RUN_FINISHED' && isObject(event.outcome) && event.outcome.type === 'interrupt') {
    contradicts('capability.interrupt-unsupported', 'RUN_FINISHED with an interrupt outcome', 'humanInTheLoop.interrupts');
  }
  if (declared.state?.deltas === false && type === 'STATE_DELTA') contradicts('capability.state-delta-unsupported', type, 'state.deltas');
  if (declared.state?.snapshots === false && type === 'STATE_SNAPSHOT') contradicts('capability.state-snapshot-unsupported', type, 'state.snapshots');
  return hits;
}
