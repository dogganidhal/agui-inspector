// Deterministic wire scenarios for the recorder: fragmented and coalesced streams, error bodies,
// transport failures, a stream held open for a user abort. Model-free and offline.
// Each scenario names the request the recorder is told about and the response the "server" gives.
// Erasable TypeScript only, so Node can run it directly.
import type { ExchangeKind, ResponseKind } from '../../packages/inspector/src/contracts.ts';

const encoder = new TextEncoder();

/** What happens after the last chunk is delivered. */
export type ScenarioEnding =
  /** The body ends normally. */
  | 'close'
  /** The connection drops: reading the body rejects with a TypeError. */
  | 'network-error'
  /** The body stays open until the caller's signal aborts, then rejects with an AbortError. */
  | 'hold-until-abort'
  /** No response at all: the send rejects with a TypeError, as a failed browser fetch does. */
  | 'no-response';

export interface RecorderScenario {
  readonly name: string;
  readonly request: {
    readonly kind: ExchangeKind;
    readonly method: string;
    readonly path: string;
    readonly body?: string;
    readonly responseKind: ResponseKind;
  };
  readonly status: number;
  /** The `content-type` the server announces. The recorder must never consult it. */
  readonly announcedContentType: string;
  /** The body, exactly as it crosses the network, in arrival order. */
  readonly chunks: readonly Uint8Array[];
  readonly ending: ScenarioEnding;
}

/** The whole body as one byte array. */
export function scenarioBytes(scenario: RecorderScenario): Uint8Array {
  const bytes = new Uint8Array(scenario.chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of scenario.chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** Cuts bytes into chunks of the given sizes, cycling through them. */
export function fragment(bytes: Uint8Array, sizes: readonly number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let at = 0, turn = 0; at < bytes.length; turn += 1) {
    const size = sizes[turn % sizes.length] ?? bytes.length;
    chunks.push(bytes.slice(at, at + size));
    at += size;
  }
  return chunks;
}

const MIXED_DELIMITERS = ['\n\n', '\r\n\r\n', '\r\r'];

/** SSE data frames, cycling LF, CRLF and CR event delimiters. */
function frames(...data: readonly string[]): string {
  return framesWith(MIXED_DELIMITERS, ...data);
}

function framesWith(delimiters: readonly string[], ...data: readonly string[]): string {
  return data.map((text, index) => `data: ${text}${delimiters[index % delimiters.length]}`).join('');
}

const json = JSON.stringify;
const started = json({ type: 'RUN_STARTED', threadId: 't-rec', runId: 'r-rec' });
const messageStart = json({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' });
// Multibyte on purpose: a one-byte chunk can end inside a code point.
const content = json({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'héllo wörld, 你好 🙂' });
const messageEnd = json({ type: 'TEXT_MESSAGE_END', messageId: 'm1' });
const finished = json({ type: 'RUN_FINISHED', threadId: 't-rec', runId: 'r-rec', outcome: { type: 'success' } });

const validRun = encoder.encode(frames(started, messageStart, content, messageEnd, finished));
// The protocol client's own parser only accepts LF delimiters; recorder scenarios the client must
// read use this one so a client failure always comes from the content.
const validRunLf = encoder.encode(framesWith(['\n\n'], started, messageStart, content, messageEnd, finished));
const runInput = json({ threadId: 't-rec', runId: 'r-rec', messages: [], state: {}, tools: [], context: [], forwardedProps: {} });
const conversation = { kind: 'conversation', method: 'POST', path: '/agent', body: runInput, responseKind: 'sse' } as const;

export const recorderScenarios = {
  /** A valid run cut into single bytes: every boundary, including those inside delimiters and code points, is a split. */
  splitStream: {
    name: 'split-stream',
    request: conversation,
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: fragment(validRun, [1]),
    ending: 'close',
  },
  /** A valid run with LF delimiters, cut into uneven pieces: the protocol client can read it. */
  lfStream: {
    name: 'lf-stream',
    request: conversation,
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: fragment(validRunLf, [5, 1, 7, 1, 64]),
    ending: 'close',
  },
  /** The same run delivered as one chunk. */
  coalescedStream: {
    name: 'coalesced-stream',
    request: conversation,
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: [validRun],
    ending: 'close',
  },
  /** The server answers a run request with a JSON error instead of an event stream. */
  errorJsonBody: {
    name: 'error-json-body',
    request: conversation,
    status: 422,
    announcedContentType: 'application/json',
    chunks: [encoder.encode(json({ error: 'threadId and runId must be strings' }))],
    ending: 'close',
  },
  /** A failed preparation request: plain text, multibyte, split mid code point. */
  errorTextBody: {
    name: 'error-text-body',
    request: { kind: 'preparation', method: 'POST', path: '/sessions', body: json({ user: 'synthetic' }), responseKind: 'response' },
    status: 503,
    announcedContentType: 'text/plain',
    chunks: fragment(encoder.encode('service indisponible, réessayez plus tard 🙂'), [5, 1, 64]),
    ending: 'close',
  },
  /** The request never gets a response. */
  transportFailure: {
    name: 'transport-failure',
    request: conversation,
    status: 0,
    announcedContentType: '',
    chunks: [],
    ending: 'no-response',
  },
  /** The connection drops after two events and half of a third. */
  midStreamFailure: {
    name: 'mid-stream-failure',
    request: conversation,
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: [encoder.encode(frames(started, messageStart)), encoder.encode('data: {"type":"TEXT_MESS')],
    ending: 'network-error',
  },
  /** Two events, then silence until the user stops the run: no terminal event ever arrives. */
  heldOpen: {
    name: 'held-open',
    request: conversation,
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: [encoder.encode(frames(started, messageStart)), encoder.encode(frames(content).slice(0, 20))],
    ending: 'hold-until-abort',
  },
  /** Not JSON, then a schema-invalid event, then a sequence violation, then a valid ending. */
  malformedThenValid: {
    name: 'malformed-then-valid',
    request: conversation,
    status: 200,
    announcedContentType: 'text/event-stream',
    chunks: fragment(
      encoder.encode(
        framesWith(
          ['\n\n'],
          started,
          '{this is not json',
          json({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 7 }),
          json({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm-never-started', delta: 'orphan' }),
          finished,
        ),
      ),
      [3, 64],
    ),
    ending: 'close',
  },
} as const satisfies Record<string, RecorderScenario>;

function abortError(): DOMException {
  return new DOMException('This operation was aborted', 'AbortError');
}

/** The scenario's body: one chunk per pull, then the scenario's ending. */
export function scenarioBody(scenario: RecorderScenario, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = scenario.chunks[next];
      if (chunk !== undefined) {
        next += 1;
        return controller.enqueue(chunk);
      }
      if (scenario.ending === 'network-error') {
        // The failure arrives after the bytes before it were delivered, not in the same turn.
        return new Promise<void>((resolve) => setTimeout(() => (controller.error(new TypeError('network error')), resolve()), 0));
      }
      if (scenario.ending !== 'hold-until-abort') return controller.close();
      return new Promise<void>((resolve) => {
        const fail = () => (controller.error(abortError()), resolve());
        if (signal?.aborted) return fail();
        signal?.addEventListener('abort', fail, { once: true });
      });
    },
  });
}

/** A `send` for the recorder that plays the scenario. */
export function scenarioSend(scenario: RecorderScenario, signal?: AbortSignal): () => Promise<Response> {
  return async () => {
    if (scenario.ending === 'no-response') throw new TypeError('Failed to fetch');
    if (signal?.aborted) throw abortError();
    return new Response(scenarioBody(scenario, signal), {
      status: scenario.status,
      headers: { 'content-type': scenario.announcedContentType },
    });
  };
}
