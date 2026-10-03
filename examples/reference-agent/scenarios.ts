// The one environment-neutral source of the reference agent's answers (P02, FR-002, FR-003). Each
// producer is a pure function from an already parsed run input to a response descriptor: a status, a
// content type, the exact body bytes in the order they are written, and whether the body then closes or
// stays open until the caller goes away. The Node fixture servers and the browser service worker both
// turn the same descriptor into a real HTTP response, so a browser example and a Node fixture cannot
// drift apart. No headers, credentials, I/O or timers reach a producer; validation, CORS, logging and
// cancellation belong to the adapters, and so does pacing: pacing.ts turns a descriptor into a timed one
// where an adapter chooses to, and no producer sleeps. A producer may only say, as data, that its answer
// is meant to be watched slowly. Imports nothing from Node, React or a worker.
// Erasable TypeScript only, so Node can run it directly.
import { continuation, formSurface, type UserAction } from './a2ui-scenarios.ts';
import { baselineRun, runError, type RunIds } from './protocol-fixtures.ts';
import type { ScenarioEnding } from './recorder-fixtures.ts';

const encoder = new TextEncoder();

/** What the last user message asks the interactive agent to do. Anything else gets a plain reply. Quick messages follow this order. */
export const SCENARIOS = {
  interrupt: 'interrupt',
  tools: 'tools',
  slow: 'slow',
  neverFinishes: 'never finishes',
  state: 'state',
  broken: 'broken',
} as const;

export const INTERRUPTS = [
  {
    id: 'i-approve',
    reason: 'approval',
    message: 'Approve the refund of 25.00?',
    responseSchema: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, note: { type: 'string' } } },
  },
  { id: 'i-contact', reason: 'input', message: 'Which contact should the agent use?' },
] as const;

/** The parts of a run input the producers read. The adapter has already checked the two identifiers. */
export interface RunInput extends RunIds {
  readonly messages?: readonly { readonly role?: string; readonly content?: unknown; readonly toolCallId?: string }[];
  readonly resume?: readonly { readonly interruptId: string; readonly status: string; readonly payload?: unknown }[];
  readonly forwardedProps?: { readonly a2uiAction?: { readonly userAction?: object } };
}

/**
 * A response as data. `chunks` are written in order; `hold-until-abort` leaves the body open after the last one.
 * `delaysMs[i]` is the pause before `chunks[i]`; a producer leaves it out, and an adapter that paces fills it in.
 * `pacing: 'slow'` asks the pacing layer for its slow profile instead of the natural one; it is a hint, not a timer.
 */
export interface ScenarioResponse {
  readonly status: number;
  readonly contentType: string;
  readonly chunks: readonly Uint8Array[];
  readonly delaysMs?: readonly number[];
  readonly pacing?: 'slow';
  readonly ending: Extract<ScenarioEnding, 'close' | 'hold-until-abort'>;
}

const SSE = 'text/event-stream';

/** The `slow` scenario's reply: a few sentences, long enough that the slow profile takes it 6 to 10 seconds. */
const SLOW_REPLY =
  'This reply is slow on purpose. A busy model can take several seconds to write a long answer, and the inspector records every frame as it arrives. The run finishes by itself when the last word lands. Press Stop at any point to cancel it and keep what has arrived.';

/** One server-sent frame, as the Node fixtures have always written it: `data:`, compact JSON, blank line. */
const frame = (event: object): Uint8Array => encoder.encode(`data: ${JSON.stringify(event)}\n\n`);

const sse = (events: readonly object[], ending: ScenarioResponse['ending'] = 'close'): ScenarioResponse => ({
  status: 200,
  contentType: SSE,
  chunks: events.map(frame),
  ending,
});

/** A small JSON body with a status: the shape of every error the adapters answer. */
export function jsonResponse(status: number, body: unknown): ScenarioResponse {
  return { status, contentType: 'application/json', chunks: [encoder.encode(JSON.stringify(body))], ending: 'close' };
}

const started = ({ threadId, runId }: RunIds) => ({ type: 'RUN_STARTED', threadId, runId });
const finished = ({ threadId, runId }: RunIds, outcome: object = { type: 'success' }) => ({ type: 'RUN_FINISHED', threadId, runId, outcome });
const say = (messageId: string, delta: string) => [
  { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
  { type: 'TEXT_MESSAGE_CONTENT', messageId, delta },
  { type: 'TEXT_MESSAGE_END', messageId },
];

/** The CLI fixture server's `/agent`: one plain reply, identical on every call. */
export function referenceRunResponse(ids: RunIds): ScenarioResponse {
  return sse([started(ids), ...say('msg-1', 'Hello from the reference agent.'), finished(ids)]);
}

function lastUserText(input: RunInput): string {
  const content = (input.messages ?? []).filter((message) => message.role === 'user').at(-1)?.content;
  return typeof content === 'string' ? content : '';
}

/**
 * The interactive agent. A resume answers the interrupts, tool results answer the tool calls, a surface
 * action is acknowledged, and otherwise the last user message picks the scenario, in that order.
 */
export function interactiveResponse(input: RunInput): ScenarioResponse {
  const { runId } = input;
  const open = started(input);
  const done = finished(input);
  const tools = (input.messages ?? []).filter((message) => message.role === 'tool');
  const action = input.forwardedProps?.a2uiAction?.userAction as { name?: unknown } | null | undefined;

  if (input.resume !== undefined) {
    const answers = input.resume.map((entry) => `${entry.interruptId}=${entry.status}${entry.payload === undefined ? '' : `:${JSON.stringify(entry.payload)}`}`).join(', ');
    return sse([open, ...say(`m-${runId}`, `Resumed with ${answers}`), done]);
  }
  if (tools.length > 0) {
    const results = tools.map((tool) => `${tool.toolCallId}=${String(tool.content)}`).join(', ');
    return sse([open, ...say(`m-${runId}`, `Tool results: ${results}`), done]);
  }
  if (typeof action === 'object' && action !== null) return sse([open, ...say(`m-${runId}`, `Action received: ${String(action.name)}`), done]);

  switch (lastUserText(input)) {
    case SCENARIOS.interrupt:
      return sse([open, ...say(`m-${runId}`, 'I need two answers before I can continue.'), finished(input, { type: 'interrupt', interrupts: INTERRUPTS })]);
    case SCENARIOS.tools:
      return sse([
        open,
        { type: 'TOOL_CALL_START', toolCallId: 'c-color', toolCallName: 'pick_color' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c-color', delta: '{"choices":' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c-color', delta: '["red","teal"]}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c-color' },
        { type: 'TOOL_CALL_START', toolCallId: 'c-size', toolCallName: 'pick_size' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c-size', delta: '{"max":3}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c-size' },
        done,
      ]);
    case SCENARIOS.slow:
      // A longer reply that an adapter streams slowly; it still finishes on its own.
      return { ...sse([open, ...say(`m-${runId}`, SLOW_REPLY), done]), pacing: 'slow' };
    case SCENARIOS.neverFinishes:
      // Streams a little and then stays open until the client goes away: no message end, no terminal event.
      return sse([open, ...say(`m-${runId}`, 'This response stays open until you press Stop.').slice(0, 2)], 'hold-until-abort');
    case SCENARIOS.state:
      return sse([
        open,
        { type: 'STATE_SNAPSHOT', snapshot: { counter: 1, items: ['a'] } },
        { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/counter', value: 2 }, { op: 'add', path: '/items/-', value: 'b' }] },
        done,
      ]);
    case SCENARIOS.broken:
      // Damage in the middle of an otherwise valid run, then the run carries on.
      return {
        ...sse([]),
        chunks: [
          frame(open),
          frame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 'no start event' }),
          encoder.encode('data: {not json at all\n\n'),
          frame({ type: 'STEP_STARTED', stepName: 'after the damage' }),
          frame({ type: 'STEP_FINISHED', stepName: 'after the damage' }),
          frame(done),
        ],
      };
    default:
      return sse([open, ...say(`m-${runId}`, 'Hello from the reference agent.'), done]);
  }
}

const A2UI_ACTIVITY = { messageId: 'a2ui-surface-1', activityType: 'a2ui-surface' } as const;

const isUserAction = (value: unknown): value is UserAction => {
  const candidate = value as Partial<Record<keyof UserAction, unknown>> | null;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.name === 'string' &&
    typeof candidate.surfaceId === 'string' &&
    typeof candidate.sourceComponentId === 'string' &&
    typeof candidate.context === 'object' &&
    candidate.context !== null &&
    typeof candidate.timestamp === 'string'
  );
};

/**
 * The A2UI agent: the form as an activity snapshot, or, for a run that carries a surface action in the
 * normal `forwardedProps.a2uiAction` envelope, the form extended by the existing continuation. The same
 * activity is replaced, so the surface changes in place.
 */
export function a2uiResponse(input: RunInput): ScenarioResponse {
  const userAction = input.forwardedProps?.a2uiAction?.userAction;
  const operations = isUserAction(userAction) ? continuation(formSurface, userAction) : formSurface;
  return sse([started(input), { type: 'ACTIVITY_SNAPSHOT', ...A2UI_ACTIVITY, content: { a2ui_operations: operations }, replace: true }, finished(input)]);
}

const fromScenario = (scenario: { readonly chunks: readonly Uint8Array[] }): ScenarioResponse => ({ status: 200, contentType: SSE, chunks: scenario.chunks, ending: 'close' });

/** The baseline protocol run (30 of the 31 types, mixed delimiters, uneven chunks) for the supplied identifiers. */
export const baselineResponse = (ids: RunIds): ScenarioResponse => fromScenario(baselineRun(ids));

/** `RUN_STARTED` then `RUN_ERROR`: the 31st type. */
export const runErrorResponse = (ids: RunIds): ScenarioResponse => fromScenario(runError(ids));
