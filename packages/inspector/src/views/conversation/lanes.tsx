// Subagent lanes: one block for each subagent invocation of a run, holding what it produced, and the jumps between a
// lane and its row on the timeline (specs/009-subagent-lanes). Composes F06 primitives; every value comes from the
// projection. Names, ids, descriptions and results are shown as text: React escapes them, there is no Markdown or HTML
// path. Positions and durations are derived from arrival offsets, and say so.
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { FrameId, RawFrame } from '../../contracts';
import type { ConversationEntry, SubagentEntry, SubagentLine, SubagentStatus } from '../../core/projection/index';
import { Button, Icon, Tag, type TagVariant } from '../theme/primitives';
import { DERIVED_NOTE, FrameRef, formatMs, formatOffset } from './shared';

/** A status is a word and a glyph as well as a tag variant, so color is never the only signal. */
export const STATUS: Record<SubagentStatus, { label: string; variant: TagVariant; glyph: string }> = {
  running: { label: 'Running', variant: 'accent', glyph: '▸' },
  finished: { label: 'Finished', variant: 'line', glyph: '✓' },
  suspended: { label: 'Suspended', variant: 'dashed', glyph: '‖' },
  error: { label: 'Error', variant: 'err', glyph: '✕' },
  stopped: { label: 'Stopped by you', variant: 'warn', glyph: '■' },
  'no-end': { label: 'No end event', variant: 'warn', glyph: '?' },
};

const PHASE: Record<SubagentLine['phase'], { label: string; variant: TagVariant }> = {
  started: { label: 'started', variant: 'neutral' },
  finished: { label: 'finished', variant: 'line' },
  error: { label: 'error', variant: 'err' },
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Derived: from the start (or, without one, the first frame) to the end. */
export const durationOf = (lane: SubagentEntry): number => Math.max(lane.endOffsetMs - (lane.startOffsetMs ?? lane.firstOffsetMs), 0);

/** The name a person reads for a lane: its name, or its id when no start event named it. */
export const nameOf = (lane: SubagentEntry): string => lane.name ?? lane.subagentRunId;

/**
 * What assistive technology says for a lane's toggle and for its row on the timeline: the name and id, the status, the
 * duration, the start, and what it is nested under, so nothing depends on indentation or color.
 */
export function describeLane(lane: SubagentEntry, parent?: SubagentEntry): string {
  const start = lane.startOffsetMs;
  return [
    lane.name === undefined ? `Subagent ${lane.subagentRunId}` : `${lane.name}, subagent ${lane.subagentRunId}`,
    STATUS[lane.status].label,
    start === undefined ? 'duration unknown' : formatMs(durationOf(lane)),
    start === undefined ? 'start not received' : `starts ${formatOffset(start)} s`,
    ...(parent !== undefined ? [`nested under ${nameOf(parent)}`] : lane.parentSubagentRunId !== undefined ? [`parent ${lane.parentSubagentRunId} not seen in this run`] : []),
    ...(lane.continued ? ['continued from an earlier run'] : []),
  ].join(', ');
}

/** What a lane holds directly: messages, tool calls and nested lanes, found through its steps but not through nested lanes. */
export function countsOf(children: readonly ConversationEntry[]): { messages: number; tools: number; subagents: number } {
  const counts = { messages: 0, tools: 0, subagents: 0 };
  const visit = (list: readonly ConversationEntry[]) => {
    for (const entry of list) {
      if (entry.kind === 'message') counts.messages += 1;
      else if (entry.kind === 'tool') counts.tools += 1;
      else if (entry.kind === 'subagent') counts.subagents += 1;
      else if (entry.kind === 'step') visit(entry.children);
    }
  };
  visit(children);
  return counts;
}

/**
 * The ids of the steps and lanes that contain a lane, outermost first, without the lane itself. Undefined when the
 * transcript does not hold the lane, as after a MESSAGES_SNAPSHOT.
 */
export function pathTo(entries: readonly ConversationEntry[], laneId: string): string[] | undefined {
  for (const entry of entries) {
    if (entry.id === laneId && entry.kind === 'subagent') return [];
    if (entry.kind === 'step' || entry.kind === 'subagent') {
      const inner = pathTo(entry.children, laneId);
      if (inner !== undefined) return [entry.id, ...inner];
    }
  }
  return undefined;
}

// ---- jumps between a lane and its row ----

/**
 * The last jump to a lane and the last jump to a row. Each carries a counter, so asking for the same target again
 * works, and the steps and lanes around the target open when the counter changes. Nothing is stored.
 */
export interface LaneNav {
  /** Every lane of the thread by `id`, for parent names. */
  readonly byId: ReadonlyMap<string, SubagentEntry>;
  readonly lane?: { readonly id: string; readonly path: ReadonlySet<string>; readonly nonce: number };
  readonly row?: { readonly id: string; readonly nonce: number };
  toLane(laneId: string): void;
  toRow(laneId: string): void;
}

const NavContext = createContext<LaneNav | undefined>(undefined);

/** Without a provider, as when a lane is drawn alone, there are no jumps and no parent names. */
export const useLaneNav = (): LaneNav | undefined => useContext(NavContext);

export function LaneNavProvider({ entries, lanes, children }: { entries: readonly ConversationEntry[]; lanes: readonly SubagentEntry[]; children: ReactNode }): ReactElement {
  const [lane, setLane] = useState<LaneNav['lane']>();
  const [row, setRow] = useState<LaneNav['row']>();
  const counter = useRef(0);
  const current = useRef(entries);
  current.current = entries;
  const byId = useMemo(() => new Map(lanes.map((item) => [item.id, item])), [lanes]);
  const value = useMemo<LaneNav>(
    () => ({
      byId,
      ...(lane !== undefined && { lane }),
      ...(row !== undefined && { row }),
      toLane(laneId) {
        const path = pathTo(current.current, laneId);
        if (path !== undefined) setLane({ id: laneId, path: new Set(path), nonce: (counter.current += 1) });
      },
      toRow(laneId) {
        setRow({ id: laneId, nonce: (counter.current += 1) });
      },
    }),
    [byId, lane, row],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

// ---- the lane ----

function Lifecycle({ lines, frames }: { lines: readonly SubagentLine[]; frames: ReadonlyMap<FrameId, RawFrame> }): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <ul className="agui-conv-lines" aria-label="Lifecycle events">
      {lines.map((line, i) => (
        <li key={i}>
          <Tag variant={PHASE[line.phase].variant}>{PHASE[line.phase].label}</Tag>
          <span className="agui-conv-mono agui-conv-evidence">{formatOffset(line.offsetMs)}</span>
          {line.outcome !== undefined && <Tag variant="line">{line.outcome}</Tag>}
          {line.code !== undefined && <Tag variant="line">{line.code}</Tag>}
          {line.interruptIds !== undefined && <span className="agui-conv-muted">interrupts <span className="agui-conv-mono">{line.interruptIds.join(', ')}</span></span>}
          {line.detail !== undefined && <span className="agui-conv-value">{line.detail}</span>}
          <FrameRef frameId={line.frameId} frames={frames} />
        </li>
      ))}
    </ul>
  );
}

/** One subagent invocation of a run: its header, and what it produced, only while it is open. */
export function LaneBlock({
  entry,
  frames,
  renderChildren,
}: {
  entry: SubagentEntry;
  frames: ReadonlyMap<FrameId, RawFrame>;
  /** Draws what the lane holds with the conversation's own entry renderer. */
  renderChildren(list: readonly ConversationEntry[]): ReactNode;
}): ReactElement {
  const nav = useLaneNav();
  const [open, setOpen] = useState(true);
  const toggle = useRef<HTMLButtonElement>(null);
  const handled = useRef(0);
  const bodyId = useId();
  const request = nav?.lane;
  const hides = request?.path.has(entry.id) === true;
  // A jump to a lane inside this one opens this one.
  useEffect(() => {
    if (hides) setOpen(true);
  }, [hides, request?.nonce]);
  // A jump to this lane: scroll to it and focus its toggle, when it mounts or when the request changes.
  useEffect(() => {
    if (request?.id !== entry.id || handled.current === request.nonce) return;
    handled.current = request.nonce;
    toggle.current?.scrollIntoView?.({ block: 'nearest' });
    toggle.current?.focus();
  });

  const status = STATUS[entry.status];
  const parent = entry.parentLaneId === undefined ? undefined : nav?.byId.get(entry.parentLaneId);
  const start = entry.startOffsetMs;
  const counts = countsOf(entry.children);
  const held = [
    counts.messages > 0 && plural(counts.messages, 'message', 'messages'),
    counts.tools > 0 && plural(counts.tools, 'tool call', 'tool calls'),
    counts.subagents > 0 && plural(counts.subagents, 'subagent', 'subagents'),
  ].filter(Boolean);
  const spawned = [
    entry.parentRunId !== undefined && <span key="run">under run <span className="agui-conv-mono">{entry.parentRunId}</span></span>,
    entry.parentToolCallId !== undefined && <span key="tool">via tool call <span className="agui-conv-mono">{entry.parentToolCallId}</span></span>,
    entry.parentMessageId !== undefined && <span key="message">in message <span className="agui-conv-mono">{entry.parentMessageId}</span></span>,
  ].filter(Boolean);

  return (
    <div className="agui-lane" data-entry="subagent" data-subagent={entry.subagentRunId} data-lane={entry.id} data-status={entry.status}>
      <div className="agui-lane-head">
        <div className="agui-lane-bar">
          <button
            ref={toggle}
            type="button"
            className="agui-lane-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={describeLane(entry, parent)}
            onClick={() => setOpen(!open)}
          >
            <span className="agui-conv-chev" aria-hidden="true">
              <Icon name="chev" size={14} />
            </span>
            <Icon name="branch" size={14} />
            <b className="agui-conv-mono">{nameOf(entry)}</b>
            {entry.name !== undefined && <Tag variant="neutral">{entry.subagentRunId}</Tag>}
            <Tag variant={status.variant} pulse={entry.status === 'running'}>
              <span aria-hidden="true">{status.glyph}</span> {status.label}
            </Tag>
            {entry.continued && <Tag variant="dashed" title="An earlier run held a segment of this subagent">Continued</Tag>}
            {start === undefined && <Tag variant="dashed" title="No SUBAGENT_STARTED frame arrived for it">Start not received</Tag>}
            {parent !== undefined && <span className="agui-conv-muted">in <span className="agui-conv-mono">{nameOf(parent)}</span></span>}
            {parent === undefined && entry.parentSubagentRunId !== undefined && <Tag variant="dashed">Parent {entry.parentSubagentRunId} not seen in this run</Tag>}
            {start !== undefined && <span className="agui-conv-mono agui-conv-muted" title={DERIVED_NOTE}>{formatOffset(start)} · {formatMs(durationOf(entry))}</span>}
            {held.length > 0 && <span className="agui-conv-muted">{held.join(' · ')}</span>}
          </button>
          {nav !== undefined && (
            <Button small variant="ghost" aria-label={`Show ${nameOf(entry)} in the timeline`} onClick={() => nav.toRow(entry.id)}>
              Show in timeline
            </Button>
          )}
        </div>
        {(entry.description !== undefined || spawned.length > 0) && (
          <div className="agui-lane-meta agui-conv-muted">
            {entry.description !== undefined && <span>{entry.description}</span>}
            {spawned}
          </div>
        )}
      </div>
      {open && (
        <div id={bodyId} className="agui-lane-body">
          <Lifecycle lines={entry.lines} frames={frames} />
          {entry.children.length === 0 ? <p className="agui-conv-empty">No events in this lane.</p> : renderChildren(entry.children)}
        </div>
      )}
    </div>
  );
}
