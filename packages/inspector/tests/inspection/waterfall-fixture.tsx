// The browser fixture host for the waterfall (spec 011): the real Inspection view over a real session store, fed by the
// real frame reader through a small script API on window. The specs stream scripted events in one at a time and look
// at what a user would see. Test support, never part of the shipped app.
import { useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { TimedEvent } from '../../../../examples/reference-agent/delegation-run.ts';
import { InspectionView } from '../../src/views/inspection/index.tsx';
import { harness } from '../conversation/support.ts';
// The stylesheets the assembly loads: the theme, then the view's own (the Inspection view imports its two).
import '../../src/views/theme/index.ts';

const host = harness((callback) => void requestAnimationFrame(callback));
const noop = () => undefined;

let setThread: (threadId: string | undefined) => void = noop;

function Page(): ReactElement {
  const [threadId, setThreadId] = useState<string | undefined>('t1');
  setThread = setThreadId;
  return (
    <main style={{ background: 'var(--bg)', color: 'var(--fg)', maxWidth: 760, minHeight: '100vh' }}>
      <textarea aria-label="Composer" rows={2} style={{ width: '100%' }} />
      <InspectionView store={host.store} {...(threadId !== undefined && { threadId })} onSendRaw={noop} onExportSession={noop} onImportSession={noop} />
    </main>
  );
}

export interface PlayOptions {
  readonly threadId?: string;
  /** Leave the exchange streaming. */
  readonly live?: boolean;
  readonly transport?: Parameters<typeof host.close>[1];
  readonly elapsedMs?: number;
}

declare global {
  interface Window {
    __waterfall: {
      open(id: string, options?: Parameters<typeof host.open>[1]): void;
      push(exchangeId: string, event: object | string, offsetMs: number): void;
      close(exchangeId: string, transport?: Parameters<typeof host.close>[1], elapsedMs?: number): void;
      /** Opens an exchange, pushes every event at its offset, and closes it unless `live`. */
      play(id: string, events: readonly TimedEvent[], options?: PlayOptions): void;
      /** The frozen benchmark workload: one exchange per entry, one thread, 7 ms between frames. */
      loadWorkload(exchanges: ReadonlyArray<{ id: string; runId: string; envelopes: readonly string[] }>): void;
      /** Points the view at another thread, as a new conversation thread does. */
      setThread(threadId: string | undefined): void;
      session(): ReturnType<typeof host.session>;
    };
  }
}

window.__waterfall = {
  open: (id, options) => host.open(id, options),
  push: (exchangeId, event, offsetMs) => host.push(exchangeId, event, offsetMs),
  close: (exchangeId, transport, elapsedMs) => host.close(exchangeId, transport, elapsedMs),
  play(id, events, options = {}) {
    host.open(id, { input: { threadId: options.threadId ?? 't1', runId: id }, ...(options.transport !== undefined && { transport: 'streaming' }) });
    for (const { atMs, event } of events) host.push(id, event, atMs);
    if (options.live !== true) host.close(id, options.transport ?? 'completed', options.elapsedMs);
  },
  loadWorkload(exchanges) {
    setThread('bench-thread');
    for (const { id, runId, envelopes } of exchanges) {
      host.open(id, { input: { threadId: 'bench-thread', runId } });
      envelopes.forEach((envelope, i) => host.pushWire(id, envelope, (i + 1) * 7));
      host.close(id);
    }
  },
  setThread: (threadId) => setThread(threadId),
  session: () => host.session(),
};

createRoot(document.getElementById('root') as HTMLElement).render(<Page />);
