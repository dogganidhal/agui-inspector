// The state view and the message-snapshot marker (FR-019, design.md: State). Composes F06 primitives.
//
// The state shown is derived: snapshots and deltas applied in arrival order to the last valid value. The view is a
// history. The latest point is the current state, and any older point can be selected to read the state after it and the
// diff of that change (specs/010-state-history). A delta that cannot be applied is listed with its error and leaves
// the state as it was; the raw frame stays in the frames list either way.
import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import type { EvidenceTarget, FrameId, RawFrame, SessionStore } from '../../contracts';
import type { MessageBrief, SnapshotEntry } from '../../core/projection/index';
import { Label, Tag } from '../theme/primitives';
import { PointList, StateDetail, pointKeys, selectedIndex } from './state-history';
import { Disclosure, FrameRef, RevealProvider, useProjection } from './shared';

/**
 * The current state as the next run will carry it, and the history that built it. The selection is the key of a
 * change, or none to follow the latest. A new store or thread starts a new scope, which drops it.
 */
export function StateView({ store, threadId, onReveal }: { store: SessionStore; threadId?: string; onReveal?(target: EvidenceTarget): void }): ReactElement {
  const { model, frames } = useProjection(store, threadId);
  const { state } = model;
  const scope = useMemo(() => ({}), [store, threadId]);
  const [picked, setPicked] = useState<{ scope: object; key: string }>();
  const listRef = useRef<HTMLUListElement>(null);
  const newest = state.changes[0]?.frameId;
  const newestRef = useRef(newest);
  newestRef.current = newest;

  const index = selectedIndex(state, picked?.scope === scope ? picked.key : undefined);
  // Choosing the newest row is following the latest: new changes then show without an action.
  const select = useCallback((key: string) => setPicked(key === newestRef.current ? undefined : { scope, key }), [scope]);
  const toLatest = useCallback(() => {
    setPicked(undefined);
    // The button leaves with the banner, so focus goes to the list instead of the page.
    listRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="state-heading" data-view="state" className="agui-conv-state">
      <h2 id="state-heading">State</h2>
      <RevealProvider value={onReveal}>
        <StateDetail model={state} index={index} frames={frames} onLatest={toLatest} />
      </RevealProvider>
      {state.changes.length === 0 ? (
        <p className="agui-conv-empty">No state events in this thread.</p>
      ) : (
        <>
          <Label>History</Label>
          <p className="agui-conv-hint">Down arrow selects an older point, up arrow a newer one, Home the newest and End the oldest.</p>
          <PointList model={state} frames={frames} selectedKey={pointKeys(state)[index] ?? ''} onSelect={select} listRef={listRef} />
        </>
      )}
    </section>
  );
}

function BriefList({ label, items }: { label: string; items: readonly MessageBrief[] }): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <ul className="agui-conv-briefs" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <Tag variant="line">{item.role}</Tag> <span className="agui-conv-mono">{item.id}</span>
          {item.text !== '' && <span className="agui-conv-muted agui-conv-value"> {item.text}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A divider in the run header's style: the transcript above it was replaced, and what changed is one click away. */
export function SnapshotMarker({ entry, frames }: { entry: SnapshotEntry; frames: ReadonlyMap<FrameId, RawFrame> }): ReactElement {
  return (
    <div className="agui-conv-snapshot" data-entry="snapshot">
      <div className="agui-conv-rulehead">
        <b>Transcript replaced by MESSAGES_SNAPSHOT</b>
        <Tag variant="ok">{entry.added.length} added</Tag>
        <Tag variant="warn">{entry.removed.length} removed</Tag>
        <Tag variant="line">{entry.count} in snapshot</Tag>
        {entry.frames[0] !== undefined && <FrameRef frameId={entry.frames[0]} frames={frames} />}
        <span className="agui-conv-rule" />
      </div>
      {(entry.added.length > 0 || entry.removed.length > 0) && (
        <Disclosure summary={<span className="agui-conv-muted">Added and removed messages</span>}>
          <BriefList label="Added messages" items={entry.added} />
          <BriefList label="Removed messages" items={entry.removed} />
        </Disclosure>
      )}
    </div>
  );
}
