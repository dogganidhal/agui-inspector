// Natural pacing for the scripted agents (FX9). One transform over a scenario response, applied where an
// adapter serves it, so no scenario writes a delay by hand and a new scenario is paced without knowing
// about it. A run that used to arrive in a millisecond, whole messages in one frame, streams the way a
// model does: a think latency after RUN_STARTED, streamed text, reasoning and tool-call arguments cut into
// small deltas at a token interval, longer pauses before a new step, a tool result, or a state or surface
// update.
//
// What changes is only chunking and timing. Event types and their order are untouched, and the pieces of
// a delta join back into it exactly. Only a stream the response opened is cut: a delta with no start, as
// the broken scenario sends on purpose, stays the one frame it was. Frames that are not events (invalid
// JSON) and wire fragments (the protocol fixtures' uneven chunks and mixed delimiters, whose point is the
// bytes) pass through as they are; fragments get no pause either. Pauses are a function of the chunk's
// position, never of a clock or a random number, so a run is reproducible. Nothing here sleeps: `pace`
// only writes `delaysMs`, and an adapter plays them with `deliver` and a sleep, which a unit test
// replaces with a fake clock.
// Environment-neutral: no Node, React or worker imports. Erasable TypeScript only, so Node can run it.
import type { ScenarioResponse } from './scenarios.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Inclusive bounds in milliseconds; the pause is picked from it by position. */
export type Range = readonly [min: number, max: number];

export interface PaceProfile {
  /** After RUN_STARTED, before the first event: the model reading the request. */
  readonly think: Range;
  /** Between the pieces of one streamed message or argument list, and before the event that closes it. */
  readonly token: Range;
  /** Before a new message, tool call, step or other beginning. */
  readonly step: Range;
  /** From a tool call to its result. */
  readonly tool: Range;
  /** Before a state or activity (surface) update. */
  readonly update: Range;
}

export const NATURAL_PACE: PaceProfile = { think: [300, 900], token: [20, 60], step: [150, 400], tool: [400, 900], update: [250, 600] };

/** The deltas that stream: text and reasoning in word-sized pieces, tool-call arguments a few characters at a time. */
const STREAMED = new Set(['TEXT_MESSAGE_CONTENT', 'REASONING_MESSAGE_CONTENT', 'TOOL_CALL_ARGS']);
const OPENS = new Set(['TEXT_MESSAGE_START', 'REASONING_MESSAGE_START', 'TOOL_CALL_START']);
const CLOSES = new Set(['TEXT_MESSAGE_END', 'REASONING_MESSAGE_END', 'TOOL_CALL_END']);

/** A repeatable value in [0, 1) for a position (Fibonacci hashing): the pauses vary without a clock or a random source. */
const unit = (index: number): number => (Math.imul(index + 1, 0x9e3779b1) >>> 0) / 2 ** 32;
const within = ([min, max]: Range, index: number): number => Math.round(min + unit(index) * (max - min));

/** Word-sized pieces. Whitespace stays with the word it leads, so the pieces join back into the text. */
const words = (text: string): string[] => text.match(/\s*\S+|\s+/g) ?? [text];

const SLICE_SIZES = [4, 6, 9, 5];

/** Arguments are not words: cut a few characters at a time, never between the halves of a surrogate pair. */
function slices(text: string): string[] {
  const pieces: string[] = [];
  for (let at = 0; at < text.length; ) {
    let end = Math.min(text.length, at + SLICE_SIZES[pieces.length % SLICE_SIZES.length]!);
    if (end < text.length && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) end += 1;
    pieces.push(text.slice(at, end));
    at = end;
  }
  return pieces;
}

/** One chunk of the output. A `frame` is a whole `data:` frame; anything else is a fragment of the wire. */
interface Part {
  readonly bytes: Uint8Array;
  readonly frame: boolean;
  /** The event type, when the frame is an event. */
  readonly type?: string;
}

/** The framing the producers write: `data:`, compact JSON on one line, a blank line. */
const FRAME = /^data: ([^\n]*)\n\n$/;

/** `open` holds the streams this response has started and not ended: `TEXT:m1`, `REASONING:m2`, `TOOL:c1`. */
function partsOf(chunk: Uint8Array, open: Set<string>): Part[] {
  const match = FRAME.exec(decoder.decode(chunk));
  if (match === null) return [{ bytes: chunk, frame: false }];
  let event: unknown;
  try {
    event = JSON.parse(match[1]!);
  } catch {
    return [{ bytes: chunk, frame: true }];
  }
  if (typeof event !== 'object' || event === null) return [{ bytes: chunk, frame: true }];
  const { type, delta, messageId, toolCallId } = event as { type?: unknown; delta?: unknown; messageId?: unknown; toolCallId?: unknown };
  if (typeof type !== 'string') return [{ bytes: chunk, frame: true }];
  const stream = `${type.split('_', 1)[0]}:${String(messageId ?? toolCallId)}`;
  if (OPENS.has(type)) open.add(stream);
  else if (CLOSES.has(type)) open.delete(stream);
  const pieces = open.has(stream) && STREAMED.has(type) && typeof delta === 'string' ? (type === 'TOOL_CALL_ARGS' ? slices(delta) : words(delta)) : [];
  // A delta that does not split keeps its original bytes.
  if (pieces.length < 2) return [{ bytes: chunk, frame: true, type }];
  return pieces.map((piece) => ({ bytes: encoder.encode(`data: ${JSON.stringify({ ...event, delta: piece })}\n\n`), frame: true, type }));
}

/** The range the pause before an event comes from, given what came just before it. */
function gap(type: string | undefined, previous: string | undefined, profile: PaceProfile): Range | undefined {
  // The run is announced at once; the first thing after it is the model thinking.
  if (previous === undefined) return undefined;
  if (previous === 'RUN_STARTED') return profile.think;
  switch (type) {
    case 'TOOL_CALL_RESULT':
      return profile.tool;
    case 'STATE_SNAPSHOT':
    case 'STATE_DELTA':
    case 'MESSAGES_SNAPSHOT':
    case 'ACTIVITY_SNAPSHOT':
    case 'ACTIVITY_DELTA':
      return profile.update;
    case 'TEXT_MESSAGE_CONTENT':
    case 'REASONING_MESSAGE_CONTENT':
    case 'TOOL_CALL_ARGS':
    case 'TEXT_MESSAGE_END':
    case 'REASONING_MESSAGE_END':
    case 'REASONING_END':
    case 'TOOL_CALL_END':
    case 'STEP_FINISHED':
    case 'RUN_FINISHED':
      return profile.token;
    default:
      return profile.step;
  }
}

/** The response with streamed deltas cut into pieces and a pause before each chunk. Status, type and ending are kept. */
export function pace(response: ScenarioResponse, profile: PaceProfile = NATURAL_PACE): ScenarioResponse {
  const chunks: Uint8Array[] = [];
  const delaysMs: number[] = [];
  const open = new Set<string>();
  let previous: string | undefined;
  for (const original of response.chunks) {
    for (const part of partsOf(original, open)) {
      const range = part.frame ? gap(part.type, previous, profile) : undefined;
      delaysMs.push(range === undefined ? 0 : within(range, chunks.length));
      chunks.push(part.bytes);
      if (part.frame) previous = part.type ?? 'frame';
    }
  }
  return { ...response, chunks, delaysMs };
}

/** Resolves after `ms`, or as soon as `signal` aborts, whichever is first. Never rejects. */
export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

/** The two timer functions a sleep needs: the page's or worker's global scope has them, and so does a test's fake clock. */
export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const sleepOn =
  (timers: Timers = globalThis): Sleep =>
  (ms, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) return resolve();
      let timer: unknown;
      const done = () => {
        timers.clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      };
      timer = timers.setTimeout(done, ms);
      signal.addEventListener('abort', done, { once: true });
    });

/**
 * Hands each chunk to `write` after its pause. Resolves true when every chunk was written, false when
 * `signal` aborted first; nothing is written once it has aborted, so a cancelled reader is never fed.
 */
export async function deliver(
  response: Pick<ScenarioResponse, 'chunks' | 'delaysMs'>,
  write: (chunk: Uint8Array) => void,
  sleep: Sleep,
  signal: AbortSignal,
): Promise<boolean> {
  for (const [index, chunk] of response.chunks.entries()) {
    const wait = response.delaysMs?.[index] ?? 0;
    if (wait > 0) await sleep(wait, signal);
    if (signal.aborted) return false;
    write(chunk);
  }
  return !signal.aborted;
}
