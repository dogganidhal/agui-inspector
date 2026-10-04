// The state history: a list of every snapshot and delta of the thread, and for the selected one the state after it, the
// diff of what it did and the operations. Composes F06 primitives.
//
// Everything shown here is derived from the recorded frames and labelled so. Nothing is written to the session. The
// list is a listbox with one tab stop: the down arrow goes to an older point, the up arrow to a newer one, Home to
// the newest and End to the oldest. An option cannot hold a control, so the frame reference button sits in the detail.
import { memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { FrameId, JsonValue, RawFrame } from '../../contracts';
import type { PatchOperationView, StateChange, StateModel } from '../../core/projection/index';
import type { Difference } from '../../core/projection/state-diff';
import { pointAt, pointCount } from '../../core/projection/state-history';
import { Button, CodeBlock, FamilyDot, Finding, Label, Tag } from '../theme/primitives';
import { Disclosure, FrameRef, formatOffset } from './shared';

/** Past this many rows a list shows a button for the rest, so one change cannot flood the pane. */
const SHOWN = 100;
/** A longer value shows shortened, with the full value one disclosure away. */
const SHORT_VALUE = 80;
/** The key of the starting state's row. Every other row is keyed by its frame id. */
const START = 'start';

const compact = (value: JsonValue): string => JSON.stringify(value) ?? 'undefined';
const pretty = (value: JsonValue | undefined): string => JSON.stringify(value, null, 2) ?? 'undefined';

/** What a change did, in one line, from its operations alone. */
export function summaryOf(change: StateChange): string {
  if (change.type === 'STATE_SNAPSHOT') return 'Replaced the state';
  const [first, ...rest] = change.operations ?? [];
  if (first === undefined) return 'Empty delta';
  return rest.length === 0 ? `${first.op} ${first.path}` : `${first.op} ${first.path} and ${rest.length} more`;
}

/** Row keys, newest first: a frame id for each change, then the starting state's key when the history has one. */
export const pointKeys = (model: StateModel): string[] => {
  const keys: string[] = model.changes.map((change) => change.frameId);
  if (pointCount(model) > keys.length) keys.push(START);
  return keys;
};

/** The index a stored selection points at. No selection, or one that is gone, is the newest point. */
export function selectedIndex(model: StateModel, key: string | undefined): number {
  if (key === undefined) return 0;
  const index = pointKeys(model).indexOf(key);
  return index < 0 ? 0 : index;
}

/** The first rows of a list, and a button for the rest. Give it a key per point so the button resets on selection. */
function Capped<T>({ items, children }: { items: readonly T[]; children(item: T, index: number): ReactNode }): ReactElement {
  const [all, setAll] = useState(false);
  return (
    <>
      {(all ? items : items.slice(0, SHOWN)).map(children)}
      {!all && items.length > SHOWN && (
        <li>
          <Button small onClick={() => setAll(true)}>
            {`Show ${items.length - SHOWN} more`}
          </Button>
        </li>
      )}
    </>
  );
}

function Value({ value, label }: { value: JsonValue; label: string }): ReactElement {
  const text = compact(value);
  if (text.length <= SHORT_VALUE) return <span className="agui-conv-mono agui-conv-value">{text}</span>;
  return (
    <Disclosure className="agui-conv-longvalue" summary={<span className="agui-conv-mono agui-conv-value">{`${text.slice(0, SHORT_VALUE)}…`}</span>}>
      <CodeBlock text={pretty(value)} aria-label={`Full ${label} value`} />
    </Disclosure>
  );
}

// The word and the sign say the kind. A stripe in the semantic color repeats it; the text stays in the neutral tag, which reaches AA in both themes.
const SIGNS = { added: '+', removed: '-', changed: '~' } as const;

function DifferenceRow({ difference }: { difference: Difference }): ReactElement {
  return (
    <li className="agui-conv-diff" data-kind={difference.kind}>
      <Tag variant="line">{`${SIGNS[difference.kind]} ${difference.kind}`}</Tag>
      <span className="agui-conv-mono">{difference.path === '' ? '(root)' : difference.path}</span>
      {difference.kind === 'removed' && <Value value={difference.before} label="removed" />}
      {difference.kind === 'added' && <Value value={difference.after} label="added" />}
      {difference.kind === 'changed' && (
        <>
          <span className="agui-conv-muted">was</span>
          <Value value={difference.before} label="old" />
          <span className="agui-conv-muted">now</span>
          <Value value={difference.after} label="new" />
        </>
      )}
    </li>
  );
}

export function DiffList({ diff }: { diff: readonly Difference[] }): ReactElement {
  if (diff.length === 0) return <p className="agui-conv-empty">No net change.</p>;
  return (
    <ul className="agui-conv-diffs" aria-label="State diff">
      <Capped items={diff}>{(difference, i) => <DifferenceRow key={i} difference={difference} />}</Capped>
    </ul>
  );
}

function Operation({ operation }: { operation: PatchOperationView }): ReactElement {
  return (
    <li className="agui-conv-op">
      <Tag variant="line">{operation.op}</Tag>
      <span className="agui-conv-mono">{operation.path}</span>
      {operation.from !== undefined && <span className="agui-conv-mono agui-conv-muted">from {operation.from}</span>}
      {operation.value !== undefined && <Value value={operation.value} label="operation" />}
    </li>
  );
}

/**
 * One point: the state after it, the diff of its change and the operations it carried. Pure, so any point can be
 * rendered on its own. The latest point is the current state the next run carries. An older one says it is a past
 * state, and `onLatest` returns to the latest.
 */
export function StateDetail({ model, index, frames, onLatest }: { model: StateModel; index: number; frames: ReadonlyMap<FrameId, RawFrame>; onLatest(): void }): ReactElement {
  const point = pointAt(model, index);
  const { change } = point;
  const latest = index === 0;
  const stateLabel = latest ? 'Current state' : 'State at the selected point';
  return (
    <div className="agui-conv-detail" data-point={latest ? 'latest' : 'past'}>
      {!latest && (
        <div className="agui-conv-banner" data-part="state-banner">
          <Tag variant="warn">Past state</Tag>
          <span>{`${index} newer ${index === 1 ? 'change' : 'changes'}`}</span>
          <Button small onClick={onLatest}>
            Back to latest
          </Button>
        </div>
      )}
      <div className="agui-conv-state-h">
        {latest ? <Label>Current state</Label> : <Label>{change === undefined ? 'Starting state' : `State after ${change.type}`}</Label>}
        {change !== undefined && (
          <>
            {latest && <span className="agui-conv-muted">{`after ${change.type}`}</span>}
            {change.runId !== undefined && <Tag variant="line">{change.runId}</Tag>}
            <span className="agui-conv-mono agui-conv-muted">{formatOffset(change.offsetMs)}</span>
            <FrameRef frameId={change.frameId} frames={frames} />
          </>
        )}
      </div>
      <p className="agui-conv-muted agui-conv-note">
        {latest
          ? 'Derived from the snapshots and deltas below. Sent as state in the next run.'
          : change === undefined
            ? 'The state the first run sent as its input, before any state event.'
            : 'Derived from the recorded frames, not received. The next run does not carry this state.'}
      </p>
      {point.state === undefined ? <p className="agui-conv-empty">No state yet. A state snapshot or a run input provides it.</p> : <CodeBlock text={pretty(point.state)} aria-label={stateLabel} />}
      {change?.error !== undefined && (
        <Finding variant="err" kind="State delta">
          {change.error}. The state above is the last valid one.
        </Finding>
      )}
      {point.firstState && <p className="agui-conv-empty">First state of the thread. Shown in full.</p>}
      {point.diff !== undefined && (
        <>
          <Label>Diff</Label>
          <DiffList key={change?.frameId} diff={point.diff} />
        </>
      )}
      {change?.type === 'STATE_DELTA' && change.operations !== undefined && change.operations.length > 0 && (
        <Disclosure defaultOpen summary={<span className="agui-conv-muted">{`Operations (${change.operations.length})`}</span>}>
          <ul className="agui-conv-ops" aria-label="Delta operations">
            <Capped key={change.frameId} items={change.operations}>
              {(operation, i) => <Operation key={i} operation={operation} />}
            </Capped>
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

const rowId = (base: string, key: string): string => `${base}-${key}`;

/** Only plain values, so a row is skipped when it is unchanged: every projection builds new change objects. */
interface RowProps {
  readonly id: string;
  readonly pointKey: string;
  readonly selected: boolean;
  /** Absent for the starting state. */
  readonly type?: StateChange['type'];
  readonly offsetMs?: number;
  readonly runId?: string;
  readonly frameIndex?: number;
  readonly summary?: string;
  readonly applied?: boolean;
  onSelect(key: string): void;
}

/** One row. Memoized, so selecting a row renders two rows and a new change renders one, not all 5,000. */
const PointRow = memo(function PointRow({ id, pointKey, selected, type, offsetMs, runId, frameIndex, summary, applied = true, onSelect }: RowProps): ReactElement {
  return (
    <li id={id} role="option" aria-selected={selected} className="agui-conv-point" onClick={() => onSelect(pointKey)}>
      {type === undefined || offsetMs === undefined ? (
        <>
          <FamilyDot family="state" hollow />
          <b>Starting state</b>
          <span className="agui-conv-muted">Sent in the first run's input</span>
        </>
      ) : (
        <>
          <span className="agui-conv-mono agui-conv-muted">{formatOffset(offsetMs)}</span>
          <FamilyDot family="state" />
          <b className="agui-conv-mono">{type}</b>
          {runId !== undefined && <Tag variant="line">{runId}</Tag>}
          {frameIndex !== undefined && <span className="agui-conv-mono agui-conv-evidence">{`frame #${frameIndex}`}</span>}
          <span className="agui-conv-muted agui-conv-value">{summary}</span>
          {!applied && <Tag variant="err">not applied</Tag>}
        </>
      )}
    </li>
  );
});

/** The history, newest first. `selectedKey` is the row that is selected, and `onSelect` gets the key of the row chosen. */
export function PointList({
  model,
  frames,
  selectedKey,
  onSelect,
  listRef,
}: {
  model: StateModel;
  frames: ReadonlyMap<FrameId, RawFrame>;
  selectedKey: string;
  onSelect(key: string): void;
  listRef?: RefObject<HTMLUListElement | null>;
}): ReactElement {
  const base = useId();
  const keys = useMemo(() => pointKeys(model), [model]);
  // A selection moved by key scrolls its row into view. One made by pointer or by a new change does not move the list.
  const scrollTo = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (scrollTo.current !== selectedKey) return;
    scrollTo.current = undefined;
    document.getElementById(rowId(base, selectedKey))?.scrollIntoView?.({ block: 'nearest' });
  }, [base, selectedKey]);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = keys.indexOf(selectedKey);
    const moves: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: keys.length - 1 };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const key = keys[Math.min(Math.max(target, 0), keys.length - 1)];
    if (key === undefined || key === selectedKey) return;
    scrollTo.current = key;
    onSelect(key);
  };

  return (
    <ul ref={listRef} role="listbox" aria-label="State history" tabIndex={0} aria-activedescendant={rowId(base, selectedKey)} className="agui-conv-history" onKeyDown={onKeyDown}>
      {keys.map((key, i) => {
        const change = model.changes[i];
        const frameIndex = change === undefined ? undefined : frames.get(change.frameId)?.index;
        return (
          <PointRow
            key={key}
            id={rowId(base, key)}
            pointKey={key}
            selected={key === selectedKey}
            onSelect={onSelect}
            {...(change !== undefined && { type: change.type, offsetMs: change.offsetMs, summary: summaryOf(change), applied: change.applied })}
            {...(change?.runId !== undefined && { runId: change.runId })}
            {...(frameIndex !== undefined && { frameIndex })}
          />
        );
      })}
    </ul>
  );
}
