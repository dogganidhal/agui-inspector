// The inspection pane: the frames list, the raw request editor and the session controls. It reads
// the shared store and reports user actions through the typed callbacks in InspectionViewProps;
// it never sends a request itself and never touches headers or credentials.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import type { EvidenceTarget, ExchangeId, InspectionViewProps } from '../../contracts.ts';
import { Button, Dialog, Editor, Finding, SegmentedControl, ToastRegion, useToasts } from '../theme/index.ts';
import { FramesPanel } from './frames.tsx';
import './inspection.css';
import { NO_FILTER, indexSession, revealEvidence, type FrameFilter } from './model.ts';
import { RawRequest } from './raw.tsx';
import { SessionControls } from './session.tsx';

type Tab = 'frames' | 'raw';

/** Optional hooks for the assembly. */
export interface InspectionViewExtras {
  /** Asks the frames list to show a run or frame. Each request is a new object, so asking for the same target again shows it again. */
  reveal?: EvidenceTarget;
}

export function InspectionView({ store, error, onSendRaw, onExportSession, onImportSession, reveal }: InspectionViewProps & InspectionViewExtras): ReactElement {
  const session = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  const [tab, setTab] = useState<Tab>('frames');
  const [filter, setFilter] = useState<FrameFilter>(NO_FILTER);
  const [openExchanges, setOpenExchanges] = useState<ReadonlyMap<ExchangeId, boolean>>(() => new Map());
  const [openFrames, setOpenFrames] = useState<ReadonlySet<string>>(() => new Set());
  const [generation, setGeneration] = useState(0);
  const [readError, setReadError] = useState<string>();
  const [manual, setManual] = useState<{ text: string; what: string }>();
  // A request that is already there when the view mounts is old: a remount, such as after a pane error, must not replay it.
  const [handled, setHandled] = useState(reveal);
  const [revealed, setRevealed] = useState<{ target: EvidenceTarget; filterCleared: boolean }>();
  const { toasts, toast } = useToasts();
  const root = useRef<HTMLElement>(null);

  // A request is applied while rendering, so the commit that shows the pane already holds the open rows.
  if (reveal !== undefined && reveal !== handled) {
    setHandled(reveal);
    const next = revealEvidence(indexSession(session), reveal, { filter, openExchanges, openFrames });
    setRevealed(next && { target: reveal, filterCleared: next.filterCleared });
    if (next !== undefined) {
      setTab('frames');
      setFilter(next.filter);
      setOpenExchanges(next.openExchanges);
      setOpenFrames(next.openFrames);
      setGeneration((value) => value + 1);
    }
  }
  // The list marks what was revealed with aria-current; that row (or exchange header) is what takes the focus.
  useEffect(() => {
    if (revealed === undefined) return;
    const target = root.current?.querySelector<HTMLElement>('[aria-current="true"]');
    target?.scrollIntoView({ block: 'center' });
    target?.focus({ preventScroll: true });
    if (revealed.filterCleared) toast(`Filter cleared to show the ${revealed.target.frameId === undefined ? 'exchange' : 'frame'}`);
  }, [revealed, toast]);

  // Each user action that changes what the list shows bumps the generation in the same commit, so a
  // measurement can tell the render that answers an input from any render a capture update caused.
  const onFilter = useCallback((next: FrameFilter) => {
    setFilter(next);
    setGeneration((value) => value + 1);
  }, []);
  const onToggleExchange = useCallback((id: ExchangeId, open: boolean) => {
    setOpenExchanges((current) => new Map(current).set(id, open));
    setGeneration((value) => value + 1);
  }, []);
  const onToggleFrame = useCallback((id: string) => {
    setOpenFrames((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setGeneration((value) => value + 1);
  }, []);
  const onCopy = useCallback(
    (text: string, what: string) => {
      navigator.clipboard.writeText(text).then(
        () => toast(`Copied ${what}`),
        // Without clipboard access the text is offered for copying by hand.
        () => setManual({ text, what }),
      );
    },
    [toast],
  );

  return (
    <section ref={root} aria-labelledby="inspection-heading" data-view="inspection" className="agui-ins">
      <div className="agui-ins-head">
        <h2 id="inspection-heading">Inspection</h2>
        <SegmentedControl
          label="Inspection view"
          value={tab}
          options={[
            { value: 'frames', label: 'Frames' },
            { value: 'raw', label: 'Raw request' },
          ]}
          onChange={(value) => setTab(value as Tab)}
        />
        <span className="agui-ins-spacer" />
        <SessionControls
          exchangeCount={session.exchanges.length}
          frameCount={session.frames.filter((frame) => frame.classification === 'data').length}
          onExport={onExportSession}
          onImport={(text) => {
            setReadError(undefined);
            onImportSession(text);
          }}
          onReadError={setReadError}
        />
      </div>
      {(error ?? readError) !== undefined && (
        <div role="alert" data-testid="inspection-error">
          <Finding variant="err" kind="Error">
            {error ?? readError}
          </Finding>
        </div>
      )}
      {tab === 'frames' && (
        <FramesPanel
          session={session}
          filter={filter}
          openExchanges={openExchanges}
          openFrames={openFrames}
          generation={generation}
          {...(revealed !== undefined && { revealed: revealed.target })}
          onFilter={onFilter}
          onToggleExchange={onToggleExchange}
          onToggleFrame={onToggleFrame}
          onCopy={onCopy}
        />
      )}
      <div hidden={tab !== 'raw'}>
        <RawRequest
          onSend={(text) => {
            onSendRaw(text);
            setTab('frames');
          }}
        />
      </div>
      <Dialog
        open={manual !== undefined}
        onClose={() => setManual(undefined)}
        title="Copy by hand"
        footer={<Button onClick={() => setManual(undefined)}>Close</Button>}
      >
        <p>The browser did not allow access to the clipboard. Select the text below and copy {manual?.what}.</p>
        <Editor readOnly aria-label="Text to copy" value={manual?.text ?? ''} onFocus={(event) => event.currentTarget.select()} />
      </Dialog>
      <ToastRegion toasts={toasts} />
    </section>
  );
}
