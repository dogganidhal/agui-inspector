// Shared scaffolding for the inspection tests: a recorded session built through the real recorder,
// frame reader and store, plus the run, finding and derived records the capture layers add later.
// Not a test file (no .test suffix), so the test build only imports it.
import { dataFrames, eventFixtures, invalidCases, protocolScenarios } from '../../../../examples/reference-agent/protocol-fixtures.ts';
import { fragment, scenarioSend, type RecorderScenario } from '../../../../examples/reference-agent/recorder-fixtures.ts';
import type { InspectionSession, RecordedRequest, SessionStore } from '../../src/contracts.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const encoder = new TextEncoder();

export const conversationRequest = (body: string, runId?: string): RecordedRequest => ({
  kind: 'conversation',
  method: 'POST',
  path: '/agent',
  body,
  responseKind: 'sse',
  ...(runId !== undefined && { runId }),
});

/** A scenario that answers `request` with `wire` in uneven chunks. */
export function wireScenario(name: string, request: RecordedRequest, wire: string, sizes: readonly number[] = [64]): RecorderScenario {
  return { name, request, status: 200, announcedContentType: 'text/event-stream', chunks: fragment(encoder.encode(wire), sizes), ending: 'close' };
}

/** One recorder, one store; the clock ticks once per call so offsets and start times are deterministic. */
export function pipeline() {
  const store = createSessionStore();
  let tick = 0;
  const recorder = createRecorder(createFrameSink(store), { now: () => (tick += 1), epoch: () => 1_700_000_000_000 + tick * 10 });
  return { store, recorder };
}

async function untilEnded(store: SessionStore, id: string) {
  const over = ['completed', 'transport-error', 'user-stopped'];
  while (!over.includes(store.snapshot().exchanges.find((exchange) => exchange.id === id)?.transport ?? '')) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Plays scenarios one after another and resolves once every exchange has ended. */
export async function capture(...scenarios: RecorderScenario[]): Promise<SessionStore> {
  const { store, recorder } = pipeline();
  for (const [index, scenario] of scenarios.entries()) {
    const response = await recorder.record(scenario.request, scenarioSend(scenario));
    await response.arrayBuffer();
    await untilEnded(store, `exchange-${index + 1}`);
  }
  return store;
}

const runInput = (threadId: string, runId: string) =>
  JSON.stringify({ threadId, runId, state: {}, messages: [{ id: 'u1', role: 'user', content: 'hi' }], tools: [], context: [], forwardedProps: {} });

/**
 * A session with every kind of record: a preparation exchange, a conversation run with all 31
 * event types, a stream with invalid and control evidence, a raw submission the server rejected,
 * a run with its outcome, additive findings and one client-derived chunk expansion.
 */
export async function richSession(): Promise<InspectionSession> {
  const preparation: RecorderScenario = {
    name: 'prepare',
    request: { kind: 'preparation', method: 'POST', path: '/sessions', body: '{"user":"synthetic"}', responseKind: 'response' },
    status: 200,
    announcedContentType: 'application/json',
    chunks: [encoder.encode('{"session":"prepared"}')],
    ending: 'close',
  };
  const raw: RecorderScenario = {
    name: 'raw',
    request: { kind: 'raw', method: 'POST', path: '/agent', body: '{ "threadId" :17 }', responseKind: 'sse' },
    status: 422,
    announcedContentType: 'application/json',
    chunks: [encoder.encode('{"error":"threadId must be a string"}')],
    ending: 'close',
  };
  const store = await capture(
    preparation,
    { ...protocolScenarios.baselineRun, request: conversationRequest(runInput('t-proto', 'r-proto'), 'run-rec-1') },
    protocolScenarios.invalidFrames,
    protocolScenarios.controlEvidence,
    protocolScenarios.runError,
    raw,
  );
  const before = store.snapshot();
  const baseline = before.exchanges[1]!;
  const chunk = before.frames.find((frame) => frame.exchangeId === baseline.id && frame.eventType === 'TEXT_MESSAGE_CHUNK')!;
  store.upsertRun({
    id: 'run-rec-1',
    threadId: 't-proto',
    runId: 'r-proto',
    input: JSON.parse(runInput('t-proto', 'r-proto')),
    exchangeId: baseline.id,
    startedAt: baseline.startedAt,
    endedAt: baseline.startedAt + 120,
    outcome: { kind: 'success', pendingToolCallIds: [] },
  });
  store.addFinding({ id: 'run-rec-1:sequence', kind: 'sequence', message: 'Message m2 was not started', subject: { type: 'run', id: 'run-rec-1' } });
  store.appendDerived({
    id: 'derived-1',
    provenance: 'derived',
    derivation: 'chunk-expansion',
    sources: [chunk.id],
    attribution: 'identified',
    eventType: 'TEXT_MESSAGE_CONTENT',
    label: 'Expanded from TEXT_MESSAGE_CHUNK',
    value: { messageId: 'm2', delta: 'héllo' },
  });
  return store.snapshot();
}

/** The data text of every wire frame in `types`, for tests that need frames of chosen types only. */
export const wireOf = (...data: string[]) => dataFrames(['\n\n'], ...data);

export { eventFixtures, invalidCases };
