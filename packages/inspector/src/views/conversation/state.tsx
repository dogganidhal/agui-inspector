// The state view and the message-snapshot marker (FR-019, design.md: State). Composes F06 primitives.
//
// The state shown is derived: snapshots and deltas applied in arrival order to the last valid value.
// A delta that cannot be applied is listed with its error and leaves the state as it was; the raw
// frame stays in the frames list either way.
import type { ReactElement } from 'react';
import type { FrameId, JsonValue, RawFrame, SessionStore } from '../../contracts';
import type { MessageBrief, PatchOperationView, SnapshotEntry, StateChange } from '../../core/projection/index';
import { Card, CardBody, CardHeader, CodeBlock, FamilyDot, Finding, Label, Tag } from '../theme/primitives';
import { Disclosure, FrameRef, formatOffset, useProjection } from './shared';

const pretty = (value: JsonValue | undefined): string => JSON.stringify(value, null, 2) ?? 'undefined';
const compact = (value: JsonValue): string => JSON.stringify(value) ?? '';

function Operation({ operation }: { operation: PatchOperationView }): ReactElement {
  return (
    <li className="agui-conv-op">
      <Tag variant="line">{operation.op}</Tag>
      <span className="agui-conv-mono">{operation.path}</span>
      {operation.from !== undefined && <span className="agui-conv-mono agui-conv-muted">from {operation.from}</span>}
      {operation.value !== undefined && <span className="agui-conv-mono agui-conv-muted agui-conv-value">{compact(operation.value)}</span>}
    </li>
  );
}

function Change({ change, frames }: { change: StateChange; frames: ReadonlyMap<FrameId, RawFrame> }): ReactElement {
  return (
    <li className="agui-conv-change" data-applied={change.applied}>
      <div className="agui-conv-change-h">
        <span className="agui-conv-mono agui-conv-muted">{formatOffset(change.offsetMs)}</span>
        <FamilyDot family="state" />
        <b className="agui-conv-mono">{change.type}</b>
        {change.runId !== undefined && <Tag variant="line">{change.runId}</Tag>}
        {!change.applied && <Tag variant="err">not applied</Tag>}
        <FrameRef frameId={change.frameId} frames={frames} />
      </div>
      {change.type === 'STATE_SNAPSHOT' && change.snapshot !== undefined && (
        <Disclosure summary={<span className="agui-conv-muted">Replaced the state</span>}>
          <CodeBlock text={pretty(change.snapshot)} aria-label="State snapshot" />
        </Disclosure>
      )}
      {change.operations && (
        <ul className="agui-conv-ops" aria-label="Delta operations">
          {change.operations.map((operation, i) => (
            <Operation key={i} operation={operation} />
          ))}
        </ul>
      )}
      {change.error !== undefined && (
        <Finding variant="err" kind="State delta">
          {change.error}. The state above is the last valid one.
        </Finding>
      )}
    </li>
  );
}

/** The current state as the next run will carry it, and every snapshot and delta that built it. */
export function StateView({ store }: { store: SessionStore }): ReactElement {
  const { model, frames } = useProjection(store);
  const { current, changes } = model.state;
  return (
    <section aria-labelledby="state-heading" data-view="state" className="agui-conv-state">
      <h2 id="state-heading">State</h2>
      <div className="agui-conv-state-h">
        <Label>Current state</Label>
        <span className="agui-conv-muted">Derived from the snapshots and deltas below. Sent as state in the next run.</span>
      </div>
      {current === undefined ? <p className="agui-conv-empty">No state yet. A state snapshot or a run input provides it.</p> : <CodeBlock text={pretty(current)} aria-label="Current state" />}
      <Label>Snapshots and deltas</Label>
      {changes.length === 0 ? (
        <p className="agui-conv-empty">No state events in this thread.</p>
      ) : (
        <ol className="agui-conv-changes">
          {changes.map((change) => (
            <Change key={change.frameId} change={change} frames={frames} />
          ))}
        </ol>
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
