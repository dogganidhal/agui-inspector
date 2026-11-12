// Structural assertions for headless sessions (feature 018). Each throws node:assert's AssertionError with `expected` and
// `actual`, so every test runner reports it. With AGUI_INSPECTOR_SAVE_ON_FAILURE naming a directory, a failure saves the
// session file there and the message names it.
import { AssertionError } from 'node:assert';
import type { JsonValue } from '../contracts.ts';
import { writeFailureFile, type ReadonlySession } from './session.ts';

export type Pattern = string | RegExp;

const matches = (pattern: Pattern | undefined, value: string | undefined): boolean =>
  pattern === undefined || (value !== undefined && (typeof pattern === 'string' ? value === pattern : pattern.test(value)));

let saved = 0;

function fail(session: ReadonlySession, assertion: string, message: string, expected: unknown, actual: unknown): never {
  let text = message;
  const directory = process.env['AGUI_INSPECTOR_SAVE_ON_FAILURE'];
  if (directory !== undefined && directory !== '') {
    saved += 1;
    try {
      text += `. The session was saved to ${writeFailureFile(directory, `agui-inspector-${assertion}-${process.pid}-${saved}.json`, session)}`;
    } catch {
      text += '. The session could not be saved';
    }
  }
  throw new AssertionError({ message: text, expected, actual, operator: assertion });
}

const describe = (pattern: Pattern | undefined) => (pattern === undefined ? 'any' : String(pattern));

function messagesOf(session: ReadonlySession) {
  return session.conversation().entries.flatMap((entry) => (entry.kind === 'message' ? [{ role: entry.role, text: entry.text }] : []));
}

export interface MessageQuery {
  readonly role?: 'assistant' | 'user' | 'tool' | 'system' | 'developer';
  readonly text?: Pattern;
}

export function assertMessage(session: ReadonlySession, query: MessageQuery): void {
  const all = messagesOf(session);
  if (!all.some((message) => matches(query.role, message.role) && matches(query.text, message.text))) {
    fail(session, 'assertMessage', `No ${query.role ?? ''} message matches ${describe(query.text)}`.replace('  ', ' '), query, all);
  }
}

export function assertNoMessage(session: ReadonlySession, query: MessageQuery): void {
  const found = messagesOf(session).filter((message) => matches(query.role, message.role) && matches(query.text, message.text));
  if (found.length > 0) fail(session, 'assertNoMessage', `${found.length} message(s) match ${describe(query.text)}`, query, found);
}

export function assertPendingInterrupt(session: ReadonlySession, query: { readonly reason?: Pattern } = {}): void {
  const { interrupts } = session.pending();
  if (!interrupts.some((interrupt) => matches(query.reason, interrupt.reason))) {
    fail(session, 'assertPendingInterrupt', `No pending interrupt with reason ${describe(query.reason)}`, query, interrupts);
  }
}

export function assertPendingToolCall(session: ReadonlySession, query: { readonly name: Pattern }): void {
  const { toolCalls } = session.pending();
  if (!toolCalls.some((call) => matches(query.name, call.name))) fail(session, 'assertPendingToolCall', `No pending tool call named ${describe(query.name)}`, query, toolCalls);
}

export function assertFinding(session: ReadonlySession, ruleId: string): void {
  const rules = session.findings().map((finding) => finding.rule);
  if (!rules.includes(ruleId)) fail(session, 'assertFinding', `No finding for rule ${ruleId}`, ruleId, rules);
}

/** No finding for this rule, or with no rule id, no finding at all. */
export function assertNoFinding(session: ReadonlySession, ruleId?: string): void {
  const found = session.findings().filter((finding) => ruleId === undefined || finding.rule === ruleId);
  if (found.length > 0) fail(session, 'assertNoFinding', `${found.length} finding(s)${ruleId === undefined ? '' : ` for rule ${ruleId}`}`, [], found);
}

export interface SurfaceQuery {
  readonly surfaceId?: string;
  readonly component: { readonly type: string; readonly props?: Readonly<Record<string, JsonValue | RegExp>> };
}

export function assertSurface(session: ReadonlySession, query: SurfaceQuery): void {
  const surfaces = session.surfaces().filter((surface) => query.surfaceId === undefined || surface.surfaceId === query.surfaceId);
  const found = surfaces.some((surface) =>
    surface.components.some(
      (component) =>
        component.type === query.component.type &&
        Object.entries(query.component.props ?? {}).every(([key, want]) => {
          const have = component.props[key];
          return want instanceof RegExp ? typeof have === 'string' && want.test(have) : partial(want, have);
        }),
    ),
  );
  if (!found) fail(session, 'assertSurface', `No ${query.component.type} component matches on ${query.surfaceId ?? 'any surface'}`, query, surfaces);
}

/** `want` is contained in `have`: objects by their keys, arrays element by element with the same length. */
function partial(want: JsonValue | undefined, have: JsonValue | undefined): boolean {
  if (Array.isArray(want)) return Array.isArray(have) && have.length === want.length && want.every((item, index) => partial(item, have[index]));
  if (want !== null && typeof want === 'object') {
    return have !== null && typeof have === 'object' && !Array.isArray(have) && Object.entries(want).every(([key, value]) => partial(value, (have as Record<string, JsonValue>)[key]));
  }
  return want === have;
}

export function assertState(session: ReadonlySession, expected: JsonValue): void {
  const state = session.state();
  if (!partial(expected, state)) fail(session, 'assertState', 'The state does not contain the expected value', expected, state ?? null);
}
