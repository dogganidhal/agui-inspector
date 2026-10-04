// One nested delegation run, as data: three steps, a reasoning message, text messages (one built from
// chunks), three tool calls (two answered by the server, one left for the client) and, unless asked to leave
// them out, three subagent runs: `sub-a` started by a tool call, `sub-b` started by `sub-a`, and `sub-c`,
// which fails. Every event comes with the offset in milliseconds at which it is meant to arrive, so a unit
// test, the browser fixture host and a scripted server all read the same timing.
// A pure producer shared by tests. It is not a demo scenario and it is not served by `scenarios.ts`.
// Erasable TypeScript only, so Node can run it directly.
import type { RunIds } from './protocol-fixtures.ts';

export interface TimedEvent {
  /** Arrival offset in milliseconds from the moment the request is sent. */
  readonly atMs: number;
  readonly event: Record<string, unknown>;
}

export interface DelegationOptions {
  /** Default true. False leaves out the three subagent runs and every event they produced. */
  readonly subagents?: boolean;
}

/** The arrival offset of the last event, which is `RUN_FINISHED`. */
export const DELEGATION_END_MS = 1800;

/**
 * The run, in arrival order.
 *
 *   plan      150 to 460   reasoning think-1 (200 to 310), text m-plan (350 to 450)
 *   research  500 to 1500  tool tc-search (520 to 1400, arguments complete at 560), text m-note (580 to 1250),
 *                          sub-a (600 to 1200: text m-a, tool tc-fetch 800 to 900, sub-b 920 to 1150 with m-b),
 *                          sub-c (1300 to 1350, ends in an error)
 *   answer    1550 to 1760 text m-answer from chunks (1600 to 1650), tool tc-pick (1700 to 1720, no result)
 */
export function delegationRun({ threadId, runId }: RunIds, { subagents = true }: DelegationOptions = {}): readonly TimedEvent[] {
  const script: Array<readonly [atMs: number, event: Record<string, unknown>, inSubagent?: true]> = [
    [100, { type: 'RUN_STARTED', threadId, runId }],
    [150, { type: 'STEP_STARTED', stepName: 'plan' }],
    [200, { type: 'REASONING_START', messageId: 'think-1' }],
    [210, { type: 'REASONING_MESSAGE_START', messageId: 'think-1', role: 'reasoning' }],
    [260, { type: 'REASONING_MESSAGE_CONTENT', messageId: 'think-1', delta: 'Plan the work.' }],
    [300, { type: 'REASONING_MESSAGE_END', messageId: 'think-1' }],
    [310, { type: 'REASONING_END', messageId: 'think-1' }],
    [350, { type: 'TEXT_MESSAGE_START', messageId: 'm-plan', role: 'assistant' }],
    [400, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-plan', delta: 'I will research this.' }],
    [450, { type: 'TEXT_MESSAGE_END', messageId: 'm-plan' }],
    [460, { type: 'STEP_FINISHED', stepName: 'plan' }],
    [500, { type: 'STEP_STARTED', stepName: 'research' }],
    [520, { type: 'TOOL_CALL_START', toolCallId: 'tc-search', toolCallName: 'search_documents', parentMessageId: 'm-plan' }],
    [540, { type: 'TOOL_CALL_ARGS', toolCallId: 'tc-search', delta: '{"query":"agui"}' }],
    [560, { type: 'TOOL_CALL_END', toolCallId: 'tc-search' }],
    [580, { type: 'TEXT_MESSAGE_START', messageId: 'm-note', role: 'assistant' }],
    [600, { type: 'SUBAGENT_STARTED', subagentRunId: 'sub-a', name: 'researcher', description: 'Reads the documents', parentToolCallId: 'tc-search' }, true],
    [620, { type: 'TEXT_MESSAGE_START', messageId: 'm-a', role: 'assistant', subagentRunId: 'sub-a' }, true],
    [650, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-note', delta: 'Working on it.' }],
    [700, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-a', delta: 'Reading three documents.', subagentRunId: 'sub-a' }, true],
    [780, { type: 'TEXT_MESSAGE_END', messageId: 'm-a', subagentRunId: 'sub-a' }, true],
    [800, { type: 'TOOL_CALL_START', toolCallId: 'tc-fetch', toolCallName: 'fetch_page', subagentRunId: 'sub-a' }, true],
    [820, { type: 'TOOL_CALL_ARGS', toolCallId: 'tc-fetch', delta: '{"url":"https://example.invalid/page"}', subagentRunId: 'sub-a' }, true],
    [840, { type: 'TOOL_CALL_END', toolCallId: 'tc-fetch', subagentRunId: 'sub-a' }, true],
    [900, { type: 'TOOL_CALL_RESULT', toolCallId: 'tc-fetch', messageId: 'r-fetch', content: 'page text', subagentRunId: 'sub-a' }, true],
    [920, { type: 'SUBAGENT_STARTED', subagentRunId: 'sub-b', name: 'summarizer', parentSubagentRunId: 'sub-a' }, true],
    [940, { type: 'TEXT_MESSAGE_START', messageId: 'm-b', role: 'assistant', subagentRunId: 'sub-b' }, true],
    [1000, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-b', delta: 'Short summary.', subagentRunId: 'sub-b' }, true],
    [1100, { type: 'TEXT_MESSAGE_END', messageId: 'm-b', subagentRunId: 'sub-b' }, true],
    [1150, { type: 'SUBAGENT_FINISHED', subagentRunId: 'sub-b' }, true],
    [1200, { type: 'SUBAGENT_FINISHED', subagentRunId: 'sub-a' }, true],
    [1250, { type: 'TEXT_MESSAGE_END', messageId: 'm-note' }],
    [1300, { type: 'SUBAGENT_STARTED', subagentRunId: 'sub-c', name: 'checker' }, true],
    [1350, { type: 'SUBAGENT_ERROR', subagentRunId: 'sub-c', message: 'checker failed', code: 'check_failed' }, true],
    [1400, { type: 'TOOL_CALL_RESULT', toolCallId: 'tc-search', messageId: 'r-search', content: '3 documents' }],
    [1500, { type: 'STEP_FINISHED', stepName: 'research' }],
    [1550, { type: 'STEP_STARTED', stepName: 'answer' }],
    [1600, { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm-answer', role: 'assistant', delta: 'Here is ' }],
    [1650, { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm-answer', delta: 'the answer.' }],
    [1700, { type: 'TOOL_CALL_START', toolCallId: 'tc-pick', toolCallName: 'pick_color' }],
    [1710, { type: 'TOOL_CALL_ARGS', toolCallId: 'tc-pick', delta: '{"choices":["red","teal"]}' }],
    [1720, { type: 'TOOL_CALL_END', toolCallId: 'tc-pick' }],
    [1760, { type: 'STEP_FINISHED', stepName: 'answer' }],
    [DELEGATION_END_MS, { type: 'RUN_FINISHED', threadId, runId, outcome: { type: 'success' } }],
  ];
  return script.filter(([, , inSubagent]) => subagents || inSubagent !== true).map(([atMs, event]) => ({ atMs, event }));
}
