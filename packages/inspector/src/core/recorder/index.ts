// The wire recorder. Framework-free: no React, no DOM beyond fetch/streams/TextDecoder.
//
// It records one exchange per request: method, path, the exact request body, status, duration and
// how the transport ended. The response is cloned the moment it arrives; the clone is drained on
// its own while the original goes back to the protocol client untouched, so a slow or failing
// client cannot lose or delay evidence and the recorder cannot alter what the client reads.
//
// The recorder is told what it needs (RecordedRequest) and reads nothing else: no request object,
// no request or response headers. The caller says whether an event stream is expected; the
// response's content type is never consulted. Only the status decides one thing: a non-2xx
// answer is an error body to keep as text, never an event stream. An event stream is server-sent events or,
// when the caller asked for the protobuf encoding, binary frames; the exchange says which (`encoding`).
//
// Event-stream bytes go to the sink as they arrive. Splitting them into frames is the frame
// reader's job; the recorder invents no frames, events or outcomes, including when a run is stopped.
//
// Capture has its own lifetime, apart from the request and from the protocol client: it ends when the
// response body ends, fails or is stopped, and `onEnd` tells the caller when. A caller that passes a
// signal can stop it. Once the signal aborts, the recorder keeps what it already read, reads and keeps
// nothing more, and marks the exchange `user-stopped`, even if the response body never notices the abort.
import type {
  Exchange,
  ExchangeId,
  ExchangePatch,
  Finding,
  JsonValue,
  RecordedRequest,
  Recorder,
  TransportState,
} from '../../contracts.ts';
import { kindOf, type CatalogueRuleId } from '../rules/catalogue.ts';

export interface RecorderSink {
  appendExchange(exchange: Exchange): void;
  updateExchange(id: ExchangeId, patch: ExchangePatch): void;
  addFinding(finding: Finding): void;
  /**
   * Raw event-stream bytes in arrival order, stamped with milliseconds since request dispatch.
   * The exchange's last update (transport `completed`, `transport-error` or `user-stopped`) always
   * follows the last chunk and marks the end of the stream.
   */
  appendChunk(exchangeId: ExchangeId, bytes: Uint8Array, offsetMs: number): void;
}

export interface RecorderClock {
  /** Monotonic milliseconds, `performance.now()` in a browser. */
  now(): number;
  /** Wall-clock epoch milliseconds. */
  epoch(): number;
}

/** `record` may also take these; the frozen interface needs no more than two parameters. */
export interface CaptureOptions {
  /** Aborting it stops capture: the exchange becomes `user-stopped` and nothing read after that is kept. */
  readonly signal?: AbortSignal;
  /** Called once, after the exchange's last update, however capture ended. */
  readonly onEnd?: () => void;
}

export interface CaptureRecorder extends Recorder {
  record(request: RecordedRequest, send: () => Promise<Response>, capture?: CaptureOptions): Promise<Response>;
}

const browserClock: RecorderClock = { now: () => performance.now(), epoch: () => Date.now() };

function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

/** Name and message only: never the error object, its cause or a request. */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function parseJson(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

export function createRecorder(sink: RecorderSink, clock: RecorderClock = browserClock): CaptureRecorder {
  let exchanges = 0;
  let findings = 0;

  return {
    async record(request: RecordedRequest, send: () => Promise<Response>, capture: CaptureOptions = {}): Promise<Response> {
      const id = `exchange-${(exchanges += 1)}`;
      const dispatchedAt = clock.now();
      let captureFailed = false;

      const addFinding = (rule: CatalogueRuleId, message: string) => {
        try {
          sink.addFinding({ id: `finding-${(findings += 1)}`, kind: kindOf(rule), rule, message, subject: { type: 'exchange', id } });
        } catch {
          // The sink is what failed; there is nowhere left to report to.
        }
      };
      /** A sink failure is reported once as a capture finding. It never reaches the client. */
      const guard = (step: () => void) => {
        try {
          step();
        } catch (error) {
          if (!captureFailed) addFinding('capture.failed', `Capture failed: ${describe(error)}`);
          captureFailed = true;
        }
      };
      /** Capture is over, whichever way it ended. Each path below reaches this once; a failing listener changes nothing. */
      const end = () => {
        try {
          capture.onEnd?.();
        } catch {
          // The caller's bookkeeping must not reach the recording or the client.
        }
      };
      const finish = (transport: TransportState, patch: ExchangePatch = {}) =>
        guard(() => sink.updateExchange(id, { ...patch, transport, elapsedMs: clock.now() - dispatchedAt }));
      const fail = (error: unknown, patch: ExchangePatch = {}) => {
        if (isAbort(error)) return finish('user-stopped', patch);
        const message = describe(error);
        addFinding('transport.failed', message);
        finish('transport-error', { ...patch, transportError: message });
      };

      const parsedBody = request.body === undefined ? undefined : parseJson(request.body);
      guard(() =>
        sink.appendExchange({
          id,
          kind: request.kind,
          ...(request.runId !== undefined && { runId: request.runId }),
          method: request.method,
          path: request.path,
          ...(request.body !== undefined && { requestBody: request.body }),
          ...(parsedBody !== undefined && { requestBodyJson: parsedBody }),
          // Told by the caller, never read from a header: the answer is read in the encoding that was asked for.
          ...(request.responseKind === 'protobuf' && { encoding: 'protobuf' as const }),
          startedAt: clock.epoch(),
          transport: 'sending',
          frameIds: [],
        }),
      );

      let response: Response;
      try {
        response = await send();
      } catch (error) {
        fail(error);
        end();
        throw error;
      }

      const streaming = request.responseKind !== 'response' && response.ok;
      guard(() => sink.updateExchange(id, { status: response.status, transport: streaming ? 'streaming' : 'reading' }));

      let branch: Response;
      try {
        branch = response.clone();
      } catch (error) {
        // The client still gets its response; the exchange keeps its last known state.
        addFinding('capture.response-not-captured', `Response body could not be captured: ${describe(error)}`);
        end();
        return response;
      }

      void (async () => {
        const reader = branch.body?.getReader();
        if (!reader) {
          finish('completed');
          return end();
        }
        const decoder = new TextDecoder();
        let body = '';
        let failure: { error: unknown } | undefined;
        // The signal is what ends the connection. The recorder only stops reading and keeping: it does not
        // cancel the clone, so a source that has not noticed the abort is left to its owner.
        const { signal } = capture;
        const aborted = signal && new Promise<undefined>((resolve) => (signal.aborted ? resolve(undefined) : signal.addEventListener('abort', () => resolve(undefined), { once: true })));
        try {
          while (!signal?.aborted) {
            const next = await (aborted ? Promise.race([reader.read(), aborted]) : reader.read());
            if (signal?.aborted || next === undefined || next.done) break;
            if (!streaming) body += decoder.decode(next.value, { stream: true });
            else if (!captureFailed) guard(() => sink.appendChunk(id, next.value, clock.now() - dispatchedAt));
          }
        } catch (error) {
          failure = { error };
        }
        const patch: ExchangePatch = streaming ? {} : { responseBody: body + decoder.decode() };
        if (signal?.aborted) finish('user-stopped', patch);
        else if (failure) fail(failure.error, patch);
        else finish('completed', patch);
        end();
      })();

      return response;
    },
  };
}
