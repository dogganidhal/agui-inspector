// A scripted host for the inspection view, used by the end-to-end suite and the benchmark. It
// wires the real recorder, frame reader and store to the view and to a scripted target on another
// origin, and implements the three host callbacks the way an application would: raw sends go out
// through the recorder, export downloads the serialized store, import validates before swapping.
// It stands in for the L07 assembly without depending on it, and it never runs anything on import:
// a recording that is opened only ever displays.
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ExchangeKind, InspectionSession, ResponseKind, Run, SessionStore } from '../../src/contracts.ts';
import { createFrameSink } from '../../src/core/frames/index.ts';
import { createRecorder } from '../../src/core/recorder/index.ts';
import { parseSession, restoreSession, serializeSession, SESSION_FILE_NAME } from '../../src/core/session-files/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';
import { InspectionView } from '../../src/views/inspection/index.tsx';

export interface HostApi {
  /** Records one conversation exchange against the scripted target and reads it like a client. */
  run(path: string, body?: object): Promise<string>;
  /** Plays the ten benchmark exchanges one after another. */
  runBenchmark(): Promise<void>;
  /** Sets the in-memory token that the transport sends as a header. Nothing records it. */
  setToken(value: string | undefined): void;
  /** Points the transport at another origin, for the unreachable-target case. */
  setTarget(url: string): void;
  /** The store the view is showing. */
  store(): SessionStore;
  snapshot(): InspectionSession;
}

declare global {
  interface Window {
    __host: HostApi;
  }
}

const TERMINAL = ['completed', 'transport-error', 'user-stopped'];

function createLive(initialTarget: string) {
  let target = initialTarget;
  const store = createSessionStore();
  const recorder = createRecorder(createFrameSink(store));
  let token: string | undefined;
  let runs = 0;

  const post = (kind: ExchangeKind, path: string, body: string, responseKind: ResponseKind, runId?: string) =>
    recorder.record({ kind, method: 'POST', path, body, responseKind, ...(runId !== undefined && { runId }) }, () =>
      fetch(`${target}${path}`, {
        method: 'POST',
        body,
        credentials: 'omit',
        headers: { 'content-type': 'application/json', ...(token !== undefined && { authorization: `Bearer ${token}` }) },
      }),
    );

  async function run(path: string, input: object = {}): Promise<string> {
    runs += 1;
    const threadId = `thread-${runs}`;
    const runId = `run-${runs}`;
    const full = { threadId, runId, state: {}, messages: [{ id: `u${runs}`, role: 'user', content: 'hello' }], tools: [], context: [], forwardedProps: {}, ...input };
    const record = `record-${runs}`;
    const response = await post('conversation', path, JSON.stringify(full), 'sse', record);
    await response.arrayBuffer();
    const id = `exchange-${store.snapshot().exchanges.length}`;
    while (!TERMINAL.includes(store.snapshot().exchanges.find((exchange) => exchange.id === id)?.transport ?? '')) await new Promise((resolve) => setTimeout(resolve, 5));
    const exchange = store.snapshot().exchanges.find((candidate) => candidate.id === id)!;
    const entry: Run = { id: record, threadId, runId, input: full as Run['input'], exchangeId: id, startedAt: exchange.startedAt, outcome: { kind: 'unknown' } };
    store.upsertRun(entry);
    return id;
  }

  return {
    store,
    post,
    run,
    setToken: (value: string | undefined) => (token = value),
    setTarget: (url: string) => (target = url),
    async runBenchmark() {
      for (let index = 0; index < 10; index += 1) await run(`/bench/${index}`);
    },
  };
}

function Host({ target }: { target: string }): ReactElement {
  const live = useRef<ReturnType<typeof createLive>>(undefined);
  live.current ??= createLive(target);
  const [store, setStore] = useState<SessionStore>(live.current.store);
  const [error, setError] = useState<string>();
  const shown = useRef(store);
  shown.current = store;

  useEffect(() => {
    const current = live.current!;
    window.__host = {
      run: current.run,
      runBenchmark: current.runBenchmark,
      setToken: current.setToken,
      setTarget: current.setTarget,
      store: () => shown.current,
      snapshot: () => shown.current.snapshot(),
    };
  }, []);

  const onSendRaw = useCallback(
    (text: string) => {
      setError(undefined);
      live.current!.post('raw', '/agent', text, 'sse').then(
        (response) => void response.arrayBuffer().catch(() => undefined),
        (failure: unknown) => setError(`The request could not be sent: ${failure instanceof Error ? failure.message : String(failure)}`),
      );
    },
    [],
  );

  const onExportSession = useCallback(() => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([serializeSession(shown.current.snapshot())], { type: 'application/json' }));
    link.download = SESSION_FILE_NAME;
    link.click();
    URL.revokeObjectURL(link.href);
  }, []);

  const onImportSession = useCallback((text: string) => {
    const result = parseSession(text);
    if (!result.ok) return setError(`Import failed: ${result.error}`);
    setError(undefined);
    setStore(restoreSession(result.session));
  }, []);

  return <InspectionView store={store} {...(error !== undefined && { error })} onSendRaw={onSendRaw} onExportSession={onExportSession} onImportSession={onImportSession} />;
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<Host target={root.dataset.target ?? ''} />);
}
