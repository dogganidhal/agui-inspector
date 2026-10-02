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
// answer is an error body to keep as text, never an event stream.
//
// Event-stream bytes go to the sink as they arrive. Splitting them into frames is the frame
// reader's job; the recorder invents no frames, events or outcomes, including when a run is stopped.
import type {
  Exchange,
  ExchangeId,
  ExchangePatch,
  Finding,
  FindingKind,
  JsonValue,
  RecordedRequest,
  Recorder,
  TransportState,
} from '../../contracts.ts';

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

export function createRecorder(sink: RecorderSink, clock: RecorderClock = browserClock): Recorder {
  let exchanges = 0;
  let findings = 0;

  return {
    async record(request: RecordedRequest, send: () => Promise<Response>): Promise<Response> {
      const id = `exchange-${(exchanges += 1)}`;
      const dispatchedAt = clock.now();
      let captureFailed = false;

      const addFinding = (kind: FindingKind, message: string) => {
        try {
          sink.addFinding({ id: `finding-${(findings += 1)}`, kind, message, subject: { type: 'exchange', id } });
        } catch {
          // The sink is what failed; there is nowhere left to report to.
        }
      };
      /** A sink failure is reported once as a capture finding. It never reaches the client. */
      const guard = (step: () => void) => {
        try {
          step();
        } catch (error) {
          if (!captureFailed) addFinding('capture', `Capture failed: ${describe(error)}`);
          captureFailed = true;
        }
      };
      const finish = (transport: TransportState, patch: ExchangePatch = {}) =>
        guard(() => sink.updateExchange(id, { ...patch, transport, elapsedMs: clock.now() - dispatchedAt }));
      const fail = (error: unknown, patch: ExchangePatch = {}) => {
        if (isAbort(error)) return finish('user-stopped', patch);
        const message = describe(error);
        addFinding('transport', message);
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
        throw error;
      }

      const streaming = request.responseKind === 'sse' && response.ok;
      guard(() => sink.updateExchange(id, { status: response.status, transport: streaming ? 'streaming' : 'reading' }));

      let branch: Response;
      try {
        branch = response.clone();
      } catch (error) {
        // The client still gets its response; the exchange keeps its last known state.
        addFinding('capture', `Response body could not be captured: ${describe(error)}`);
        return response;
      }

      void (async () => {
        const reader = branch.body?.getReader();
        if (!reader) return finish('completed');
        const decoder = new TextDecoder();
        let body = '';
        let failure: { error: unknown } | undefined;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!streaming) body += decoder.decode(value, { stream: true });
            else if (!captureFailed) guard(() => sink.appendChunk(id, value, clock.now() - dispatchedAt));
          }
        } catch (error) {
          failure = { error };
        }
        const patch: ExchangePatch = streaming ? {} : { responseBody: body + decoder.decode() };
        if (failure) fail(failure.error, patch);
        else finish('completed', patch);
      })();

      return response;
    },
  };
}
