// Deterministic protocol fixtures for the frame reader and the store: one valid event for each of the
// 31 baseline types, a coherent run that uses them, invalid data classes, sequence violations and
// streams that never reach a terminal event. Model-free and offline. Streams are recorder scenarios,
// so the same bytes can be played through the recorder, the reader and the store.
// Erasable TypeScript only, so Node can run it directly.
import type { EventType } from '@ag-ui/core';
import type { JsonObject } from '../../packages/inspector/src/contracts.ts';
import { fragment, type RecorderScenario } from './recorder-fixtures.ts';

const encoder = new TextEncoder();
const json = JSON.stringify;

const THREAD = 't-proto';
const RUN = 'r-proto';
// Multibyte on purpose: a one-byte chunk can end inside a code point.
const TEXT = 'héllo wörld, 你好 🙂';

/** One schema-valid event per baseline type. The key is the type; the tests check that none is missing. */
export const eventFixtures = {
  RUN_STARTED: { type: 'RUN_STARTED', threadId: THREAD, runId: RUN },
  RUN_FINISHED: { type: 'RUN_FINISHED', threadId: THREAD, runId: RUN, outcome: { type: 'success' }, result: { summary: TEXT } },
  RUN_ERROR: { type: 'RUN_ERROR', message: 'synthetic failure', code: 'synthetic_error' },
  STEP_STARTED: { type: 'STEP_STARTED', stepName: 'plan' },
  STEP_FINISHED: { type: 'STEP_FINISHED', stepName: 'plan' },
  TEXT_MESSAGE_START: { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
  TEXT_MESSAGE_CONTENT: { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: TEXT },
  TEXT_MESSAGE_END: { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
  TEXT_MESSAGE_CHUNK: { type: 'TEXT_MESSAGE_CHUNK', messageId: 'm2', role: 'assistant', delta: TEXT },
  TOOL_CALL_START: { type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'search_documents', parentMessageId: 'm1' },
  TOOL_CALL_ARGS: { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"query":"synthetic"}' },
  TOOL_CALL_END: { type: 'TOOL_CALL_END', toolCallId: 'tc1' },
  TOOL_CALL_CHUNK: { type: 'TOOL_CALL_CHUNK', toolCallId: 'tc2', toolCallName: 'fetch_resource', delta: '{"resource":"synthetic"}' },
  TOOL_CALL_RESULT: { type: 'TOOL_CALL_RESULT', messageId: 'tm1', toolCallId: 'tc1', content: 'synthetic result', role: 'tool' },
  REASONING_START: { type: 'REASONING_START', messageId: 'rs1' },
  REASONING_MESSAGE_START: { type: 'REASONING_MESSAGE_START', messageId: 'rs1', role: 'reasoning' },
  REASONING_MESSAGE_CONTENT: { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rs1', delta: TEXT },
  REASONING_MESSAGE_END: { type: 'REASONING_MESSAGE_END', messageId: 'rs1' },
  REASONING_MESSAGE_CHUNK: { type: 'REASONING_MESSAGE_CHUNK', messageId: 'rs2', delta: TEXT },
  REASONING_END: { type: 'REASONING_END', messageId: 'rs1' },
  REASONING_ENCRYPTED_VALUE: { type: 'REASONING_ENCRYPTED_VALUE', subtype: 'message', entityId: 'rs1', encryptedValue: 'c3ludGhldGljLW9wYXF1ZQ==' },
  STATE_SNAPSHOT: { type: 'STATE_SNAPSHOT', snapshot: { round: 0, items: ['a'] } },
  STATE_DELTA: { type: 'STATE_DELTA', delta: [{ op: 'add', path: '/round', value: 1 }] },
  MESSAGES_SNAPSHOT: {
    type: 'MESSAGES_SNAPSHOT',
    messages: [
      { id: 'u1', role: 'user', content: 'Synthetic request' },
      { id: 'a1', role: 'assistant', content: TEXT },
    ],
  },
  ACTIVITY_SNAPSHOT: { type: 'ACTIVITY_SNAPSHOT', messageId: 'act1', activityType: 'synthetic-progress', content: { title: 'Synthetic' }, replace: true },
  ACTIVITY_DELTA: { type: 'ACTIVITY_DELTA', messageId: 'act1', activityType: 'synthetic-progress', patch: [{ op: 'add', path: '/revision', value: 1 }] },
  SUBAGENT_STARTED: { type: 'SUBAGENT_STARTED', subagentRunId: 'sub1', name: 'synthetic-researcher', description: 'Synthetic delegated task', parentToolCallId: 'tc1' },
  SUBAGENT_FINISHED: { type: 'SUBAGENT_FINISHED', subagentRunId: 'sub1', result: { summary: 'done' }, outcome: { type: 'success' } },
  SUBAGENT_ERROR: { type: 'SUBAGENT_ERROR', subagentRunId: 'sub2', message: 'synthetic subagent failure', code: 'synthetic_failure' },
  CUSTOM: { type: 'CUSTOM', name: 'synthetic.custom', value: { note: 'custom' } },
  RAW: { type: 'RAW', source: 'synthetic', event: { provider: 'synthetic' } },
} as const satisfies Record<keyof typeof EventType, JsonObject>;

/** What the reader must say about data that is not a valid AG-UI event. */
export interface InvalidCase {
  /** The SSE data value. */
  readonly data: string;
  readonly jsonVerdict: 'valid' | 'invalid';
  readonly schemaVerdict: 'invalid' | 'unknown-type' | 'not-applicable';
  /** The type the reader can still identify, if any. */
  readonly eventType?: string;
}

export const invalidCases = {
  /** JSON cut off inside a string. */
  truncatedJson: { data: '{"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"cut', jsonVerdict: 'invalid', schemaVerdict: 'not-applicable' },
  prose: { data: 'not json at all', jsonVerdict: 'invalid', schemaVerdict: 'not-applicable' },
  /** `data:` with nothing after it is an empty data value, not a missing event. */
  emptyData: { data: '', jsonVerdict: 'invalid', schemaVerdict: 'not-applicable' },
  trailingText: { data: '{"type":"CUSTOM"} trailing text', jsonVerdict: 'invalid', schemaVerdict: 'not-applicable' },
  /** A type this baseline does not know. Kept, never dropped. */
  unknownType: { data: json({ type: 'SYNTHETIC_FUTURE_EVENT', sequence: 1 }), jsonVerdict: 'valid', schemaVerdict: 'unknown-type', eventType: 'SYNTHETIC_FUTURE_EVENT' },
  /** A known type with a field of the wrong type. */
  wrongFieldType: { data: json({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 7 }), jsonVerdict: 'valid', schemaVerdict: 'invalid', eventType: 'TEXT_MESSAGE_CONTENT' },
  missingField: { data: json({ type: 'TOOL_CALL_START', toolCallId: 'tc1' }), jsonVerdict: 'valid', schemaVerdict: 'invalid', eventType: 'TOOL_CALL_START' },
  noType: { data: json({ messageId: 'm1', delta: 'x' }), jsonVerdict: 'valid', schemaVerdict: 'invalid' },
  nonStringType: { data: json({ type: 7 }), jsonVerdict: 'valid', schemaVerdict: 'invalid' },
  notAnObject: { data: '42', jsonVerdict: 'valid', schemaVerdict: 'invalid' },
  jsonNull: { data: 'null', jsonVerdict: 'valid', schemaVerdict: 'invalid' },
  jsonArray: { data: '[1,2]', jsonVerdict: 'valid', schemaVerdict: 'invalid' },
} as const satisfies Record<string, InvalidCase>;

// ---- wire building -------------------------------------------------------------------------------

const MIXED = ['\n\n', '\r\n\r\n', '\r\r'];

/** `data:` frames, one per value, cycling through the given delimiters. */
export function dataFrames(delimiters: readonly string[], ...data: readonly string[]): string {
  return data.map((text, index) => `data: ${text}${delimiters[index % delimiters.length]}`).join('');
}

const event = (type: keyof typeof EventType): string => json(eventFixtures[type]);

const conversation = {
  kind: 'conversation',
  method: 'POST',
  path: '/agent',
  body: json({ threadId: THREAD, runId: RUN, messages: [], state: {}, tools: [], context: [], forwardedProps: {} }),
  responseKind: 'sse',
} as const;

function stream(name: string, text: string, sizes: readonly number[] = [64]): RecorderScenario {
  return { name, request: conversation, status: 200, announcedContentType: 'text/event-stream', chunks: fragment(encoder.encode(text), sizes), ending: 'close' };
}

/** The event families of the baseline in one coherent run (everything but RUN_ERROR; see runError). */
const baselineOrder = [
  'RUN_STARTED', 'STEP_STARTED',
  'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TEXT_MESSAGE_CHUNK',
  'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT', 'TOOL_CALL_CHUNK',
  'REASONING_START', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END',
  'REASONING_MESSAGE_CHUNK', 'REASONING_ENCRYPTED_VALUE', 'REASONING_END',
  'STATE_SNAPSHOT', 'STATE_DELTA', 'MESSAGES_SNAPSHOT', 'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA',
  'SUBAGENT_STARTED', 'SUBAGENT_ERROR', 'SUBAGENT_FINISHED', 'CUSTOM', 'RAW',
  'STEP_FINISHED', 'RUN_FINISHED',
] as const satisfies readonly (keyof typeof EventType)[];

export const baselineRunTypes: readonly string[] = baselineOrder;

export const protocolScenarios = {
  /** Thirty of the 31 types in a plausible run, with LF, CRLF and CR delimiters, cut into uneven chunks. */
  baselineRun: stream('baseline-run', dataFrames(MIXED, ...baselineOrder.map(event)), [1, 7, 64, 4096]),
  /** The one baseline type the run above leaves out: a run that fails. */
  runError: stream('run-error', dataFrames(['\n\n'], event('RUN_STARTED'), event('RUN_ERROR'))),
  /** Valid frames around every invalid class: the stream keeps going and ends correctly. */
  invalidFrames: stream(
    'invalid-frames',
    dataFrames(
      MIXED,
      event('RUN_STARTED'),
      invalidCases.truncatedJson.data,
      invalidCases.unknownType.data,
      invalidCases.wrongFieldType.data,
      event('TEXT_MESSAGE_START'),
      invalidCases.prose.data,
      invalidCases.missingField.data,
      event('RUN_FINISHED'),
    ),
    [3, 64],
  ),
  /** Every event is schema-valid; the order is not. Only the protocol client can tell, so the reader says nothing. */
  sequenceViolations: stream(
    'sequence-violations',
    dataFrames(
      ['\n\n'],
      event('RUN_STARTED'),
      json({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-never-started', delta: 'orphan' }),
      json({ type: 'TEXT_MESSAGE_END', messageId: 'm-never-started' }),
      json({ type: 'TOOL_CALL_ARGS', toolCallId: 'tc-never-started', delta: '{}' }),
      event('RUN_FINISHED'),
    ),
  ),
  /** Comments, keepalives, field-only blocks and blank lines around and inside data frames. */
  controlEvidence: stream(
    'control-evidence',
    [
      ': keepalive\n\n',
      `event: ping\nid: 7\nretry: 1000\n\n`,
      `data: ${event('RUN_STARTED')}\n\n`,
      ': another keepalive\r\n\r\n',
      '\n',
      `: note inside a data block\ndata: ${event('TEXT_MESSAGE_START')}\nid: 8\n\n`,
      `data: ${event('RUN_FINISHED')}\n\n`,
    ].join(''),
    [5, 1, 64],
  ),
} as const satisfies Record<string, RecorderScenario>;

const startedAndContent = [event('RUN_STARTED'), event('TEXT_MESSAGE_START'), event('TEXT_MESSAGE_CONTENT')];
const finishedWithoutRunId = json({ type: 'RUN_FINISHED', threadId: THREAD, outcome: { type: 'success' } });

/** Streams that end with the connection healthy, but without an observed RUN_FINISHED or RUN_ERROR. */
export const missingTerminalScenarios = {
  /** Events, then the server closes. */
  closedAfterContent: stream('closed-after-content', dataFrames(['\n\n'], ...startedAndContent)),
  /** The server sends nothing at all. */
  emptyStream: stream('empty-stream', ''),
  /** A RUN_FINISHED lookalike that fails the schema (no runId) does not count. */
  lookalikeFinished: stream('lookalike-finished', dataFrames(['\n\n'], event('RUN_STARTED'), finishedWithoutRunId)),
  /** Text that mentions RUN_FINISHED but is not JSON does not count. */
  lookalikeNonJson: stream('lookalike-non-json', dataFrames(['\n\n'], event('RUN_STARTED'), '{"type":"RUN_FINISHED"')),
  /** A valid RUN_FINISHED cut before its closing blank line was never dispatched. */
  truncatedFinished: stream('truncated-finished', `${dataFrames(['\n\n'], event('RUN_STARTED'))}data: ${event('RUN_FINISHED')}\n`),
  /** The envelope is cut inside a multibyte character. */
  truncatedMidCharacter: {
    ...stream('truncated-mid-character', dataFrames(['\n\n'], event('RUN_STARTED'))),
    chunks: [
      ...fragment(encoder.encode(dataFrames(['\n\n'], event('RUN_STARTED'))), [64]),
      encoder.encode(`data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"h${'é'}`).slice(0, -1),
    ],
  },
} as const satisfies Record<string, RecorderScenario>;
