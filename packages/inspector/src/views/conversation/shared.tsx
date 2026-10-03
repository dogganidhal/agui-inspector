// Small pieces the conversation and state views share. Composes F06 primitives; adds no styling of its own.
import { createContext, useContext, useMemo, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react';
import type { EvidenceTarget, FrameId, InspectionSession, RawFrame, SessionStore } from '../../contracts';
import { projectConversation, type ConversationModel } from '../../core/projection/index';
import { Icon } from '../theme/primitives';

export interface Projected {
  readonly session: InspectionSession;
  readonly model: ConversationModel;
  /** Frame by id, to name a source frame by its position in its exchange. */
  readonly frames: ReadonlyMap<FrameId, RawFrame>;
}

/** The session and everything projected from it, recomputed when the store or the thread changes. */
export function useProjection(store: SessionStore, threadId?: string): Projected {
  const session = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  return useMemo(
    () => ({ session, model: projectConversation(session, threadId), frames: new Map(session.frames.map((frame) => [frame.id, frame])) }),
    [session, threadId],
  );
}

/** Derived from frame offsets, never received: `1.24 s` or `38 ms`. */
export const formatMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

/** The frames list's offset format. */
export const formatOffset = (ms: number): string => `+${(ms / 1000).toFixed(3)}`;

export const DERIVED_NOTE = 'Derived from frame offsets, not received';

/**
 * The page's navigation action: it shows the evidence a reference points at in the frames list. Without one, as when a
 * view is mounted on its own, run ids and frame references stay plain text.
 */
const RevealContext = createContext<((target: EvidenceTarget) => void) | undefined>(undefined);
export const RevealProvider = RevealContext.Provider;
export const useReveal = () => useContext(RevealContext);

/** "frame #12": where the evidence for an entry sits in its exchange's raw frames. A button when the frame can be revealed. */
export function FrameRef({ frameId, frames }: { frameId: FrameId; frames: ReadonlyMap<FrameId, RawFrame> }): ReactElement {
  const reveal = useReveal();
  const frame = frames.get(frameId);
  if (frame === undefined) return <span className="agui-conv-mono agui-conv-evidence">frame</span>;
  const text = `frame #${frame.index}`;
  if (reveal === undefined) return <span className="agui-conv-mono agui-conv-evidence">{text}</span>;
  return (
    <button type="button" className="agui-conv-mono agui-conv-evidence agui-conv-ref" aria-label={`Show ${text} in the frames list`} onClick={() => reveal({ exchangeId: frame.exchangeId, frameId })}>
      {text}
    </button>
  );
}

/**
 * A native disclosure that renders its body only while open, so a collapsed group of 2,000 deltas
 * costs nothing. Open state lives here and survives re-renders while the group stays mounted.
 */
export function Disclosure({
  summary,
  defaultOpen = false,
  className,
  children,
}: {
  summary: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className={className} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="agui-conv-summary">
        <span className="agui-conv-chev" aria-hidden="true">
          <Icon name="chev" size={14} />
        </span>
        {summary}
      </summary>
      {open && children}
    </details>
  );
}
