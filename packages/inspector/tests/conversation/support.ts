// Test support for the conversation lane: scripted exchanges played through the real frame reader
// and session store, so projections are checked against genuine F05 evidence, not hand-built frames.
// Also used by the browser fixture host. Not a test file.
import type { RunAgentInput } from '@ag-ui/core';
import type { Exchange, InspectionSession, Run, Scheduler, SessionStore, TransportState } from '../../src/contracts.ts';
import { createFrameReader, type FrameReader } from '../../src/core/frames/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const encoder = new TextEncoder();

export interface ScriptedExchange {
  readonly input?: Partial<RunAgentInput>;
  readonly kind?: Exchange['kind'];
  readonly transport?: TransportState;
}

export interface Harness {
  readonly store: SessionStore;
  /** Starts an exchange; with `input`, also records the run it carries. */
  open(id: string, options?: ScriptedExchange): void;
  /** One SSE data frame (an object is serialized; a string is sent as-is), stamped with its offset. */
  push(exchangeId: string, event: object | string, offsetMs: number): void;
  /** Wire text exactly as it should arrive, delimiters included. */
  pushWire(exchangeId: string, text: string, offsetMs: number): void;
  /** Ends the stream: the reader ends and the exchange reaches `transport`. */
  close(exchangeId: string, transport?: TransportState, elapsedMs?: number): void;
  session(): InspectionSession;
}

/** Notifies synchronously unless given a scheduler; the browser host passes requestAnimationFrame. */
export function harness(schedule: Scheduler = (callback) => callback()): Harness {
  const store = createSessionStore({ schedule });
  const readers = new Map<string, FrameReader>();
  let clock = 0;
  return {
    store,
    open(id, options = {}) {
      const input = options.input;
      const runRecordId = input ? `run-${id}` : undefined;
      store.appendExchange({
        id,
        kind: options.kind ?? 'conversation',
        ...(runRecordId && { runId: runRecordId }),
        method: 'POST',
        path: '/agent',
        ...(input && { requestBody: JSON.stringify(input), requestBodyJson: input as never }),
        startedAt: 1_700_000_000_000 + clock++,
        transport: options.transport ?? 'streaming',
        frameIds: [],
      });
      if (input && runRecordId) {
        const full: RunAgentInput = { threadId: 't1', runId: id, state: {}, messages: [], tools: [], context: [], forwardedProps: {}, ...input };
        const run: Run = { id: runRecordId, threadId: full.threadId, runId: full.runId, input: full, exchangeId: id, startedAt: 1_700_000_000_000, outcome: { kind: 'unknown' } };
        store.upsertRun(run);
      }
      readers.set(id, createFrameReader(store, id));
    },
    push(exchangeId, event, offsetMs) {
      const text = typeof event === 'string' ? event : JSON.stringify(event);
      readers.get(exchangeId)?.push(encoder.encode(`data: ${text}\n\n`), offsetMs);
    },
    pushWire(exchangeId, text, offsetMs) {
      readers.get(exchangeId)?.push(encoder.encode(text), offsetMs);
    },
    close(exchangeId, transport = 'completed', elapsedMs) {
      readers.get(exchangeId)?.end();
      store.updateExchange(exchangeId, { transport, ...(elapsedMs !== undefined && { elapsedMs }) });
    },
    session: () => store.snapshot(),
  };
}

/** One conversation exchange with `events` at 10 ms steps, closed unless `live`. */
export function sessionOf(events: ReadonlyArray<object | string>, options: ScriptedExchange & { live?: boolean } = {}): InspectionSession {
  const h = harness();
  h.open('ex1', options);
  events.forEach((event, i) => h.push('ex1', event, (i + 1) * 10));
  if (!options.live) h.close('ex1', options.transport ?? 'completed', (events.length + 1) * 10);
  return h.session();
}

export const RUN_STARTED = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' } as const;
export const RUN_FINISHED = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } } as const;
