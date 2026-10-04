// The waterfall (spec 011): the runs of the current thread as a tree of rows, each with a bar on its run's time axis,
// and a details area for the selected row. Controlled: what is selected and what is closed live in InspectionView, so
// this stays a function of its props. It reads the recording and never changes it or sends a request.
//
// The rows are an ARIA tree with one tab stop (a roving tabindex). Bars and axes are decoration: the label of each row
// says everything they show.
import { Fragment, useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import type { EvidenceTarget, FrameId, InspectionSession, RawFrame } from '../../contracts.ts';
import { buildWaterfall, type RowKind, type WaterfallRow, type WaterfallRun } from '../../core/projection/waterfall.ts';
import { FamilyDot, Icon, Tag } from '../theme/index.ts';
import type { Family } from '../theme/primitives.tsx';
import { formatDuration, formatOffset } from './model.ts';
import './waterfall.css';
import { KIND_WORD, TREE_KEYS, axisTicks, indexRows, openWord, rowLabel, segmentsOf, spanText, treeKey, visibleRows, type Known, type TreeKey, type VisibleRow } from './waterfall-model.ts';

/** What the user chose in the waterfall: the selected row, and the rows opened or closed against the defaults. */
export interface WaterfallChoices {
  readonly selected?: string;
  /** Rows other than runs that the user closed. */
  readonly closed: ReadonlySet<string>;
  /** An explicit choice per run row; without one only the newest run is open. */
  readonly openRuns: ReadonlyMap<string, boolean>;
}

export const NO_CHOICES: WaterfallChoices = { closed: new Set(), openRuns: new Map() };

export interface WaterfallPanelProps extends WaterfallChoices {
  readonly session: InspectionSession;
  readonly threadId?: string;
  onSelect(id: string): void;
  onToggle(row: WaterfallRow, open: boolean): void;
  /** Shows a run's exchange, or one of its frames, in the frames list. */
  onShowFrames(target: EvidenceTarget): void;
}

const FAMILY: Readonly<Record<RowKind, { family: Family; hollow: boolean }>> = {
  run: { family: 'neutral', hollow: true },
  step: { family: 'neutral', hollow: true },
  message: { family: 'text', hollow: false },
  reasoning: { family: 'reason', hollow: false },
  tool: { family: 'tool', hollow: false },
  subagent: { family: 'neutral', hollow: true },
};

const percent = (ms: number, axisMs: number): string => `${(Math.min(Math.max(ms / axisMs, 0), 1) * 100).toFixed(2)}%`;

export function WaterfallPanel({ session, threadId, selected, closed, openRuns, onSelect, onToggle, onShowFrames }: WaterfallPanelProps): ReactElement {
  const waterfall = useMemo(() => buildWaterfall(session, threadId), [session, threadId]);
  const rows = useMemo(() => visibleRows(waterfall, closed, openRuns), [waterfall, closed, openRuns]);
  const known = useMemo(() => indexRows(waterfall), [waterfall]);
  const frames = useMemo(() => new Map(session.frames.map((frame) => [frame.id, frame])), [session]);
  const refs = useRef(new Map<string, HTMLElement>());
  const focusNext = useRef<string>(undefined);

  // The tab stop is the selected row, or its nearest visible ancestor when a closed row hides it, or the first row.
  const position = new Map(rows.map((visible, index) => [visible.row.id, index]));
  let stop = 0;
  for (let id = selected; id !== undefined; id = known.get(id)?.parent) {
    const at = position.get(id);
    if (at !== undefined) {
      stop = at;
      break;
    }
  }

  // Moving focus by key selects the row; the focus follows once the new selection is on screen.
  useEffect(() => {
    const id = focusNext.current;
    focusNext.current = undefined;
    if (id !== undefined) refs.current.get(id)?.focus();
  });

  const setRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element === null) refs.current.delete(id);
    else refs.current.set(id, element);
  }, []);

  const show = (visible: VisibleRow) => onShowFrames({ exchangeId: visible.run.exchangeId, ...(visible.row.firstFrame !== undefined && { frameId: visible.row.firstFrame }) });

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    // Only a row reacts, so the buttons of the details area and the rest of the page keep their keys.
    if (target.getAttribute('role') !== 'treeitem' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !TREE_KEYS.has(event.key)) return;
    const index = rows.findIndex((visible) => visible.row.id === target.dataset.rowId);
    if (index < 0) return;
    event.preventDefault();
    const move = treeKey(rows, index, event.key as TreeKey);
    if (move.type === 'focus') {
      const next = rows[move.index]?.row.id;
      if (next === undefined) return;
      focusNext.current = next;
      onSelect(next);
    } else if (move.type === 'toggle') onToggle((rows[index] as VisibleRow).row, move.open);
    else if (move.type === 'show') show(rows[move.index] as VisibleRow);
  }

  const selectedRow = selected === undefined ? undefined : known.get(selected);

  return (
    <section data-view="waterfall" className="agui-wf" aria-labelledby="waterfall-heading">
      <h3 id="waterfall-heading">Waterfall</h3>
      {rows.length === 0 ? (
        <p className="agui-wf-empty">No run in this thread yet. Start a run to see its waterfall.</p>
      ) : (
        <div role="tree" aria-label="Run waterfall" className="agui-wf-tree" onKeyDown={onKeyDown}>
          {rows.map((visible, index) => (
            <Fragment key={visible.row.id}>
              <Row visible={visible} selected={visible.row.id === selected} tabbable={index === stop} setRef={setRef} onSelect={onSelect} onToggle={onToggle} />
              {visible.depth === 0 && visible.expanded && <Axis run={visible.run} />}
            </Fragment>
          ))}
        </div>
      )}
      <Details known={selectedRow} frames={frames} onShowFrames={onShowFrames} />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

interface RowProps {
  visible: VisibleRow;
  selected: boolean;
  tabbable: boolean;
  setRef(id: string, element: HTMLElement | null): void;
  onSelect(id: string): void;
  onToggle(row: WaterfallRow, open: boolean): void;
}

function Row({ visible, selected, tabbable, setRef, onSelect, onToggle }: RowProps): ReactElement {
  const { row, run, depth, expandable, expanded, posInSet, setSize } = visible;
  const { family, hollow } = FAMILY[row.kind];
  const span = row.endMs !== undefined ? spanText(row, run) : undefined;
  return (
    <div
      ref={(element) => setRef(row.id, element)}
      role="treeitem"
      className="agui-wf-row"
      tabIndex={tabbable ? 0 : -1}
      aria-level={depth + 1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-selected={selected}
      {...(expandable && { 'aria-expanded': expanded })}
      aria-label={rowLabel(visible)}
      data-row-id={row.id}
      data-kind={row.kind}
      data-run={run.exchangeId}
      {...(row.open && { 'data-open': 'true' })}
      onFocus={() => onSelect(row.id)}
      onClick={() => onSelect(row.id)}
    >
      <span className="agui-wf-name" style={{ paddingLeft: `calc(var(--u) * ${depth * 4})` }}>
        <span
          className="agui-wf-chev"
          aria-hidden="true"
          {...(expandable && {
            onClick: (event) => {
              event.stopPropagation();
              onToggle(row, !expanded);
            },
          })}
        >
          {expandable && <Icon name="chev" size={14} />}
        </span>
        <FamilyDot family={family} hollow={hollow} />
        <span className="agui-wf-kind">{KIND_WORD[row.kind]}</span>
        <span className="agui-wf-label" title={row.label}>
          {row.label}
        </span>
        {row.subject !== row.label && (
          <span className="agui-wf-subject" title={row.subject}>
            {row.subject}
          </span>
        )}
      </span>
      <span className="agui-wf-track" aria-hidden="true">
        {segmentsOf(visible).map((segment) => (
          <span
            key={segment.part}
            className="agui-wf-seg"
            data-part={segment.part}
            {...(segment.open && { 'data-open': 'true' })}
            style={{ left: percent(segment.startMs, run.axisMs), width: percent(segment.endMs - segment.startMs, run.axisMs) }}
          />
        ))}
      </span>
      <span className="agui-wf-time">
        {row.kind !== 'run' && (span ?? (row.open ? '…' : null))}
        {row.kind !== 'run' && row.open && (
          <Tag variant={run.live ? 'accent' : 'warn'} pulse={run.live}>
            {openWord(run)}
          </Tag>
        )}
        {row.kind === 'run' && span !== undefined && <span>{span}</span>}
        {row.tags.map((tag) => (
          <Tag key={tag.text} variant={tag.variant} pulse={row.kind === 'run' && run.status === 'streaming'}>
            {tag.text}
          </Tag>
        ))}
      </span>
    </div>
  );
}

/** The ticks of one run's axis. Decoration: the rows carry every time as text. */
function Axis({ run }: { run: WaterfallRun }): ReactElement {
  return (
    <div className="agui-wf-axis" aria-hidden="true">
      <span />
      <div className="agui-wf-axis-track">
        <span style={{ left: 0 }}>0</span>
        {axisTicks(run.axisMs).map((tick) => (
          <span key={tick.ms} style={{ left: percent(tick.ms, run.axisMs) }}>
            {tick.label}
          </span>
        ))}
        <span className="agui-wf-axis-end" style={{ left: '100%' }}>
          {formatDuration(run.axisMs)}
        </span>
      </div>
      <span />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------------------------

function Details({ known, frames, onShowFrames }: { known: Known | undefined; frames: ReadonlyMap<FrameId, RawFrame>; onShowFrames(target: EvidenceTarget): void }): ReactElement {
  if (known === undefined) {
    return (
      <section className="agui-wf-details" aria-label="Row details">
        <p>Select a row to see its details.</p>
      </section>
    );
  }
  const { row, run } = known;
  const reference = (id: FrameId | undefined): ReactNode => {
    const frame = id === undefined ? undefined : frames.get(id);
    if (frame === undefined) return null;
    return (
      <button type="button" className="agui-wf-ref" aria-label={`Show frame #${frame.index} in the frames list`} onClick={() => onShowFrames({ exchangeId: frame.exchangeId, frameId: frame.id })}>
        frame #{frame.index}
      </button>
    );
  };
  const at = (ms: number | undefined, otherwise: string): string => (ms === undefined ? otherwise : formatOffset(ms));
  const duration = spanText(row, run);
  const waited = row.kind === 'run' && row.startMs !== undefined ? formatDuration(row.startMs) : undefined;
  return (
    <section className="agui-wf-details" aria-label="Row details" data-details={row.id}>
      <h4>
        <span className="agui-wf-kind">{KIND_WORD[row.kind]}</span>
        <span>{row.label}</span>
        {row.kind !== 'run' && row.open && (
          <Tag variant={run.live ? 'accent' : 'warn'} pulse={run.live}>
            {openWord(run)}
          </Tag>
        )}
        {row.tags.map((tag) => (
          <Tag key={tag.text} variant={tag.variant}>
            {tag.text}
          </Tag>
        ))}
      </h4>
      <dl className="agui-wf-facts">
        <dt>Id</dt>
        <dd>{row.subject}</dd>
        <dt>Start</dt>
        <dd>{at(row.startMs, 'not seen')}</dd>
        <dt>End</dt>
        <dd>{row.endMs === undefined ? `not seen${row.open ? ` (${openWord(run)})` : ''}` : formatOffset(row.endMs)}</dd>
        {duration !== undefined && (
          <>
            <dt>Duration</dt>
            <dd>{duration}</dd>
          </>
        )}
        {row.kind === 'tool' && (
          <>
            <dt>Arguments complete</dt>
            <dd>{at(row.argsEndMs, 'not seen')}</dd>
            <dt>Result received</dt>
            <dd>{at(row.resultMs, 'not in this run')}</dd>
          </>
        )}
        {waited !== undefined && (
          <>
            <dt>Before the first event</dt>
            <dd>{waited}</dd>
          </>
        )}
        {row.facts.map((fact) => (
          <Fragment key={fact.name}>
            <dt>{fact.name}</dt>
            <dd>{fact.value}</dd>
          </Fragment>
        ))}
        <dt>Frames</dt>
        <dd>
          {row.frameCount}{' '}
          <span className="agui-wf-refs">
            {reference(row.firstFrame)}
            {row.lastFrame !== row.firstFrame && reference(row.lastFrame)}
            {row.kind === 'run' && (
              <button type="button" className="agui-wf-ref" onClick={() => onShowFrames({ exchangeId: run.exchangeId })}>
                Show exchange
              </button>
            )}
          </span>
        </dd>
      </dl>
      <p>Times are when the browser read each frame, from the moment the request was sent. Derived, not received.</p>
    </section>
  );
}
