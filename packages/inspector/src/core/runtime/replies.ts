// Replies and actions (FR-023, FR-024, FR-025). Framework-free: plain data in, plain data out.
//
// A run can end owing the user something: answers to interrupts, or results for client tool calls.
// The next run may not start until every one of them has an answer. This module holds that barrier as
// an immutable value the runtime keeps, builds the exact protocol shapes the continuation carries
// (the upstream resume entries, tool messages) and checks the one thing a surface action must be.
//
// Resolve and Cancel are protocol answers; they are not the Stop control, which ends a connection.
// Nothing here sends anything or invents an event. An answer exists only when the user gave it.
import type { Message, ResumeEntry, ToolMessage, Interrupt } from '@ag-ui/core';
import { buildResumeArray } from '@ag-ui/client';
import type { A2uiAction, InterruptAnswer, JsonObject, JsonValue, ObservedOutcome, RunRecordId, ToolResultDraft } from '../../contracts.ts';
import { fail, isJsonObject, isJsonValue, isRecord, ok, type Result } from '../config/validation.ts';

export interface PendingReplies {
  readonly runRecordId?: RunRecordId;
  /** The interrupts as the run reported them; resume entries are built from these. */
  readonly source: readonly Interrupt[];
  readonly interrupts: readonly InterruptAnswer[];
  readonly toolResults: readonly ToolResultDraft[];
}

export const NO_REPLIES: PendingReplies = { source: [], interrupts: [], toolResults: [] };

// ---------------------------------------------------------------------------------------------
// Prefilling an answer from a response schema, and checking it against one
// ---------------------------------------------------------------------------------------------

type Schema = Readonly<Record<string, unknown>>;
const asSchema = (value: unknown): Schema | undefined => (isRecord(value) ? value : undefined);
const MAX_DEPTH = 8;

function typeOf(schema: Schema): string | undefined {
  const { type } = schema;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null') ?? 'null';
  return schema.properties !== undefined ? 'object' : schema.items !== undefined ? 'array' : undefined;
}

/**
 * A starting answer for an interrupt: the schema's `default`, `const` or first `enum` value where it
 * names one, otherwise the empty value of the declared type, with object properties filled in. The
 * result is a draft the user edits, never an answer by itself.
 */
export function seedFromSchema(schema: JsonObject | undefined, depth = 0): JsonValue {
  const spec = asSchema(schema);
  if (spec === undefined) return {};
  if (isJsonValue(spec.default) && 'default' in spec) return spec.default;
  if ('const' in spec && isJsonValue(spec.const)) return spec.const;
  if (Array.isArray(spec.enum) && spec.enum.length > 0 && isJsonValue(spec.enum[0])) return spec.enum[0];
  const choice = [spec.oneOf, spec.anyOf].find(Array.isArray);
  if (choice !== undefined && asSchema(choice[0]) !== undefined && depth < MAX_DEPTH) return seedFromSchema(choice[0] as JsonObject, depth + 1);

  switch (typeOf(spec)) {
    case 'object': {
      const properties = asSchema(spec.properties) ?? {};
      return depth >= MAX_DEPTH ? {} : Object.fromEntries(Object.entries(properties).map(([name, sub]) => [name, seedFromSchema(asSchema(sub) as JsonObject, depth + 1)]));
    }
    case 'array':
      return [];
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return depth === 0 ? {} : null;
  }
}

const describeType: Record<string, string> = {
  string: 'text',
  number: 'a number',
  integer: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
  null: 'null',
};

function kindOf(value: JsonValue): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

function matchesType(value: JsonValue, type: string): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return kindOf(value) === type;
}

/**
 * The first way `value` misses `schema`, or undefined. Covers the keywords an answer form needs: type,
 * enum, const, required, properties and items. It is a hint for the person editing, not a validator:
 * the protocol carries the schema opaquely, so a miss warns and never stops an answer being sent.
 */
export function checkAgainstSchema(value: JsonValue, schema: JsonObject | undefined, path = 'The answer', depth = 0): string | undefined {
  const spec = asSchema(schema);
  if (spec === undefined || depth > MAX_DEPTH) return undefined;
  const types = Array.isArray(spec.type) ? spec.type.filter((entry): entry is string => typeof entry === 'string') : typeof spec.type === 'string' ? [spec.type] : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    return `${path} must be ${types.map((type) => describeType[type] ?? type).join(' or ')}. The interrupt's response schema requires it.`;
  }
  if (Array.isArray(spec.enum) && !spec.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    return `${path} must be one of ${spec.enum.map((option) => JSON.stringify(option)).join(', ')}. The interrupt's response schema requires it.`;
  }
  if ('const' in spec && JSON.stringify(spec.const) !== JSON.stringify(value)) {
    return `${path} must be ${JSON.stringify(spec.const)}. The interrupt's response schema requires it.`;
  }
  if (isRecord(value)) {
    const required = Array.isArray(spec.required) ? spec.required.filter((name): name is string => typeof name === 'string') : [];
    const missing = required.find((name) => !(name in value));
    if (missing !== undefined) return `${path === 'The answer' ? '' : `${path}.`}${missing} is required. The interrupt's response schema requires it.`;
    const properties = asSchema(spec.properties) ?? {};
    for (const [name, sub] of Object.entries(properties)) {
      if (!(name in value)) continue;
      const problem = checkAgainstSchema(value[name] as JsonValue, asSchema(sub) as JsonObject, path === 'The answer' ? name : `${path}.${name}`, depth + 1);
      if (problem) return problem;
    }
  }
  if (Array.isArray(value) && asSchema(spec.items) !== undefined) {
    for (const [index, item] of value.entries()) {
      const problem = checkAgainstSchema(item, spec.items as JsonObject, `${path}[${index}]`, depth + 1);
      if (problem) return problem;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// What a finished run leaves to answer
// ---------------------------------------------------------------------------------------------

function toolDraft(runRecordId: RunRecordId, toolCallId: string, messages: readonly Message[]): ToolResultDraft {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    const call = message.toolCalls?.find((candidate) => candidate.id === toolCallId);
    if (!call) continue;
    const argumentsText = call.function.arguments;
    let parsed: { value: JsonValue } | { error: string };
    try {
      parsed = { value: JSON.parse(argumentsText) as JsonValue };
    } catch (error) {
      parsed = { error: `Arguments are not valid JSON (${error instanceof SyntaxError ? error.message : 'parse failed'})` };
    }
    return {
      runId: runRecordId,
      toolCallId,
      toolName: call.function.name,
      argumentsText,
      ...('value' in parsed ? { argumentsParsed: parsed.value } : { argumentsError: parsed.error }),
      resultDraft: '',
      status: 'pending',
    };
  }
  // The run named a call the client never saw start. It is still owed a result; nothing is invented about it.
  return { runId: runRecordId, toolCallId, toolName: '', argumentsText: '', resultDraft: '', status: 'pending' };
}

/** The replies owed after a run with this observed outcome. Success names its pending tool calls. */
export function repliesFor(runRecordId: RunRecordId, outcome: ObservedOutcome, messages: readonly Message[]): PendingReplies {
  if (outcome.kind === 'interrupt') {
    return {
      runRecordId,
      source: outcome.interrupts,
      interrupts: outcome.interrupts.map((interrupt) => ({
        runId: runRecordId,
        interruptId: interrupt.id,
        ...(interrupt.responseSchema !== undefined && { responseSchema: interrupt.responseSchema }),
        draft: seedFromSchema(interrupt.responseSchema),
        status: 'unanswered',
      })),
      toolResults: [],
    };
  }
  if (outcome.kind === 'success' && outcome.pendingToolCallIds.length > 0) {
    return { runRecordId, source: [], interrupts: [], toolResults: outcome.pendingToolCallIds.map((id) => toolDraft(runRecordId, id, messages)) };
  }
  return NO_REPLIES;
}

// ---------------------------------------------------------------------------------------------
// Editing and answering. An answer, once given, is final until the next run starts.
// ---------------------------------------------------------------------------------------------

function changeInterrupt(replies: PendingReplies, interruptId: string, change: (answer: InterruptAnswer) => InterruptAnswer): Result<PendingReplies> {
  const answer = replies.interrupts.find((candidate) => candidate.interruptId === interruptId);
  if (!answer) return fail(`There is no waiting interrupt ${interruptId}`);
  if (answer.status !== 'unanswered') return fail(`Interrupt ${interruptId} is already ${answer.status}`);
  return ok({ ...replies, interrupts: replies.interrupts.map((candidate) => (candidate === answer ? change(answer) : candidate)) });
}

export const draftInterrupt = (replies: PendingReplies, interruptId: string, draft: JsonValue): Result<PendingReplies> =>
  changeInterrupt(replies, interruptId, (answer) => ({ ...answer, draft }));

export const answerInterrupt = (replies: PendingReplies, interruptId: string, status: 'resolved' | 'cancelled'): Result<PendingReplies> =>
  changeInterrupt(replies, interruptId, (answer) => ({ ...answer, status }));

function changeTool(replies: PendingReplies, toolCallId: string, change: (draft: ToolResultDraft) => ToolResultDraft): Result<PendingReplies> {
  const draft = replies.toolResults.find((candidate) => candidate.toolCallId === toolCallId);
  if (!draft) return fail(`There is no pending tool call ${toolCallId}`);
  if (draft.status === 'answered') return fail(`Tool call ${toolCallId} already has a result`);
  return ok({ ...replies, toolResults: replies.toolResults.map((candidate) => (candidate === draft ? change(draft) : candidate)) });
}

export const draftToolResult = (replies: PendingReplies, toolCallId: string, text: string): Result<PendingReplies> =>
  changeTool(replies, toolCallId, (draft) => ({ ...draft, resultDraft: text }));

export const submitToolResult = (replies: PendingReplies, toolCallId: string): Result<PendingReplies> =>
  changeTool(replies, toolCallId, (draft) => ({ ...draft, status: 'answered' }));

// ---------------------------------------------------------------------------------------------
// The barrier
// ---------------------------------------------------------------------------------------------

export interface Remaining {
  readonly interrupts: number;
  readonly toolResults: number;
}

export function remaining(replies: PendingReplies): Remaining {
  return {
    interrupts: replies.interrupts.filter((answer) => answer.status === 'unanswered').length,
    toolResults: replies.toolResults.filter((draft) => draft.status === 'pending').length,
  };
}

/** True when something is owed, whether or not it has been answered yet. */
export const owesReplies = (replies: PendingReplies): boolean => replies.interrupts.length + replies.toolResults.length > 0;

/** True while any interrupt or tool call still lacks its answer: no run may start. */
export function isBlocked(replies: PendingReplies): boolean {
  const left = remaining(replies);
  return left.interrupts + left.toolResults > 0;
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Why the next run cannot start, in the words of the composer notice; undefined when nothing blocks it. */
export function waitingNotice(replies: PendingReplies): string | undefined {
  const left = remaining(replies);
  const parts = [
    left.interrupts > 0 && `${plural(left.interrupts, 'interrupt')} waiting. Answer ${left.interrupts === 1 ? 'it' : 'them'} to continue the run.`,
    left.toolResults > 0 && `${plural(left.toolResults, 'tool call')} waiting for ${left.toolResults === 1 ? 'a result' : 'results'}. Enter ${left.toolResults === 1 ? 'it' : 'them'} to continue the run.`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * The upstream resume entries for the answered interrupts: `resolved` carries the draft as its payload,
 * `cancelled` carries none. The upstream builder refuses a missing answer, which is the barrier again.
 */
export function resumeEntries(replies: PendingReplies): Result<ResumeEntry[] | undefined> {
  if (replies.interrupts.length === 0) return ok(undefined);
  const left = remaining(replies);
  if (left.interrupts > 0) return fail(`${plural(left.interrupts, 'interrupt')} still ${left.interrupts === 1 ? 'has' : 'have'} no answer`);
  try {
    const responses = Object.fromEntries(
      replies.interrupts.map((answer) => [
        answer.interruptId,
        answer.status === 'cancelled' ? ({ status: 'cancelled' } as const) : ({ status: 'resolved', payload: answer.draft } as const),
      ]),
    );
    return ok(buildResumeArray([...replies.source], responses));
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

/** The tool messages for the answered calls, in the order the run left them. */
export function toolMessages(replies: PendingReplies, newId: () => string): Result<ToolMessage[]> {
  const left = remaining(replies);
  if (left.toolResults > 0) return fail(`${plural(left.toolResults, 'tool call')} still ${left.toolResults === 1 ? 'has' : 'have'} no result`);
  return ok(replies.toolResults.map((draft): ToolMessage => ({ id: newId(), role: 'tool', toolCallId: draft.toolCallId, content: draft.resultDraft })));
}

// ---------------------------------------------------------------------------------------------
// Surface actions
// ---------------------------------------------------------------------------------------------

/**
 * Checks an action callback is the A2UI v0.9 user-action envelope: name, surface id, source component
 * id, a JSON context and the renderer's timestamp, all present. Those five fields are copied as given;
 * the timestamp comes from the renderer and is never replaced by the inspector's clock.
 */
export function checkA2uiAction(value: unknown): Result<A2uiAction> {
  if (!isRecord(value)) return fail('An A2UI action must be an object with name, surfaceId, sourceComponentId, context and timestamp');
  for (const field of ['name', 'surfaceId', 'sourceComponentId', 'timestamp'] as const) {
    if (typeof value[field] !== 'string' || value[field] === '') return fail(`An A2UI action needs a nonempty ${field}`);
  }
  if (!isJsonObject(value.context)) return fail('An A2UI action needs a context that is a JSON object');
  return ok({
    name: value.name as string,
    surfaceId: value.surfaceId as string,
    sourceComponentId: value.sourceComponentId as string,
    context: value.context,
    timestamp: value.timestamp as string,
  });
}
