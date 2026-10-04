// Replies and actions (FR-023, FR-024, FR-025). Framework-free: plain data in, plain data out.
//
// A run can end owing the user something: answers to interrupts, or results for client tool calls.
// The next run may not start until every one of them has an answer. This module holds that barrier as
// an immutable value the runtime keeps, builds the exact protocol shapes the continuation carries
// (the upstream resume entries, tool messages) and checks the one thing a surface action must be.
//
// Resolve and Cancel are protocol answers; they are not the Stop control, which ends a connection.
// Nothing here sends anything or invents an event. An answer exists only when the user gave it, or when
// the profile the user wrote says to give it (`automate`): that goes through the same states a manual
// answer does, so the continuation it builds is the one a manual answer builds.
import type { Message, ResumeEntry, ToolMessage, Interrupt } from '@ag-ui/core';
import { buildResumeArray } from '@ag-ui/client';
import type { A2uiAction, AutomaticReplies, ClientProfileSettings, InterruptAnswer, JsonValue, ObservedOutcome, RunRecordId, ToolResultDraft } from '../../contracts.ts';
import { fail, isJsonObject, isRecord, ok, type Result } from '../config/validation.ts';
import { seedFromSchema } from './schema.ts';

export interface PendingReplies {
  readonly runRecordId?: RunRecordId;
  /** The interrupts as the run reported them; resume entries are built from these. */
  readonly source: readonly Interrupt[];
  readonly interrupts: readonly InterruptAnswer[];
  readonly toolResults: readonly ToolResultDraft[];
}

export const NO_REPLIES: PendingReplies = { source: [], interrupts: [], toolResults: [] };

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
// Automatic answers. The profile's wishes, applied to what a run left waiting.
// ---------------------------------------------------------------------------------------------

/** Automatic continuations in a row after which the profile stops answering and the developer decides. */
export const AUTOMATIC_REPLY_LIMIT = 10;

export type Automation = Pick<ClientProfileSettings, 'interruptReply' | 'interruptPayloads' | 'toolResults'>;

/**
 * What the profile answers for these replies; the same value when it answers nothing. Resolve answers with the
 * payload mapped to the interrupt's reason, as written, or keeps the starting answer drawn from the schema;
 * Cancel carries none. A tool call gets the text mapped to its tool's name. Only replies that still wait are
 * touched, and each answer is marked automatic. The reason and the tool name come from the agent, so both
 * lookups are by own key: a name like `constructor` finds nothing.
 */
export function automate(replies: PendingReplies, automation: Automation): PendingReplies {
  const { interruptReply, interruptPayloads, toolResults: scripts } = automation;
  let changed = false;
  const interrupts =
    interruptReply === undefined
      ? replies.interrupts
      : replies.interrupts.map((answer): InterruptAnswer => {
          if (answer.status !== 'unanswered') return answer;
          changed = true;
          if (interruptReply === 'cancel') return { ...answer, status: 'cancelled', automatic: true };
          const reason = replies.source.find((interrupt) => interrupt.id === answer.interruptId)?.reason;
          const mapped = reason !== undefined && interruptPayloads !== undefined && Object.hasOwn(interruptPayloads, reason);
          return { ...answer, draft: mapped ? structuredClone(interruptPayloads[reason] as JsonValue) : answer.draft, status: 'resolved', automatic: true };
        });
  const toolResults =
    scripts === undefined
      ? replies.toolResults
      : replies.toolResults.map((draft): ToolResultDraft => {
          if (draft.status !== 'pending' || draft.toolName === '' || !Object.hasOwn(scripts, draft.toolName)) return draft;
          changed = true;
          return { ...draft, resultDraft: scripts[draft.toolName] as string, status: 'answered', automatic: true };
        });
  return changed ? { ...replies, interrupts, toolResults } : replies;
}

/** The ids of the replies the inspector answered, or undefined when it answered none. */
export function automaticReplies(replies: PendingReplies): AutomaticReplies | undefined {
  const interruptIds = replies.interrupts.filter((answer) => answer.automatic).map((answer) => answer.interruptId);
  const toolCallIds = replies.toolResults.filter((draft) => draft.automatic).map((draft) => draft.toolCallId);
  return interruptIds.length + toolCallIds.length > 0 ? { interruptIds, toolCallIds } : undefined;
}

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
