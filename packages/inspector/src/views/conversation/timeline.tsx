// The subagent timeline (specs/009-subagent-lanes): one chart for each run that has subagents, with a time axis, a row for
// the run and a row for each subagent lane. A bar runs from the offset of the frame that started the subagent to the
// offset of the frame that ended it. Rows are buttons in one roving tab stop. Activating one jumps to its lane.
//
// Nothing here is received data. The bars are derived from the offsets at which frames arrived, and the page says so.
// Bar positions are set through the element's style object, as the frames list does for its frame ticks, which the
// page's content security policy allows. No chart library: a bar is a positioned box.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { EvidenceTarget } from '../../contracts';
import type { ConversationModel, SubagentEntry } from '../../core/projection/index';
import { timelineOf, type TimelineChart, type TimelineRow } from '../../core/projection/subagents';
import { Button } from '../theme/primitives';
import { STATUS, describeLane, durationOf, nameOf, useLaneNav } from './lanes';
import { Disclosure, formatMs } from './shared';

/** A chart draws this many lane rows until the developer asks for the rest. */
export const ROW_LIMIT = 100;

const pct = (ms: number, axis: number) => Math.min(Math.max((ms / axis) * 100, 0), 100);

/** The frames list's tick rule: about ten whole-second labels, none in the last tenth. */
function ticksOf(axisMs: number): number[] {
  const step = Math.max(1, Math.ceil(axisMs / 1000 / 10));
  const seconds: number[] = [];
  for (let second = step; second * 1000 < axisMs * 0.9; second += step) seconds.push(second);
  return seconds;
}

const laneRows = (chart: TimelineChart): TimelineRow[] => chart.rows.filter((row) => row.kind === 'subagent');

function Axis({ axisMs }: { axisMs: number }): ReactElement {
  return (
    <div className="agui-tl-item agui-tl-axisrow" aria-hidden="true">
      <span />
      <div className="agui-tl-axis">
        <span style={{ left: 0 }}>0</span>
        {ticksOf(axisMs).map((second) => (
          <span key={second} style={{ left: `${pct(second * 1000, axisMs)}%` }}>{second}s</span>
        ))}
        <span className="agui-tl-axis-end" style={{ left: '100%' }}>{formatMs(axisMs)}</span>
      </div>
      <span />
    </div>
  );
}

function Bar({ row, axisMs, status, glyph }: { row: TimelineRow; axisMs: number; status: string; glyph?: string }): ReactElement {
  const left = pct(row.startMs, axisMs);
  const width = Math.min(Math.max(pct(row.endMs, axisMs) - left, 0), 100 - left);
  return (
    <span className="agui-tl-track" aria-hidden="true">
      <span className="agui-tl-bar" data-status={status} style={{ left: `${left.toFixed(3)}%`, width: `${width.toFixed(3)}%` }}>
        {glyph !== undefined && <span className="agui-tl-end">{glyph}</span>}
      </span>
    </span>
  );
}

/** A lane's row. A jump to it focuses it when it mounts as well as when the request changes: its chart may open on that request. */
function LaneRow({
  row,
  axisMs,
  parent,
  tabbable,
  setRef,
  onFocus,
  onJump,
}: {
  row: TimelineRow;
  axisMs: number;
  parent: SubagentEntry | undefined;
  tabbable: boolean;
  setRef(id: string, element: HTMLButtonElement | null): void;
  onFocus(id: string): void;
  onJump(lane: SubagentEntry): void;
}): ReactElement {
  const lane = row.lane!;
  const request = useLaneNav()?.row;
  const button = useRef<HTMLButtonElement | null>(null);
  const handled = useRef(0);
  useEffect(() => {
    if (request?.id !== row.id || handled.current === request.nonce) return;
    handled.current = request.nonce;
    button.current?.scrollIntoView?.({ block: 'nearest' });
    button.current?.focus();
  });
  const status = STATUS[lane.status];
  const dead = !lane.inTranscript;
  return (
    <li className="agui-tl-item">
      <button
        ref={(element) => {
          button.current = element;
          setRef(row.id, element);
        }}
        type="button"
        className="agui-tl-row"
        data-tl-row={row.id}
        data-status={lane.status}
        tabIndex={tabbable ? 0 : -1}
        aria-label={`${describeLane(lane, parent)}${dead ? ', transcript replaced' : ''}. Activate to show ${dead ? 'its start frame in the frames list' : 'its lane'}`}
        onFocus={() => onFocus(row.id)}
        onClick={() => onJump(lane)}
      >
        <span className="agui-tl-label" title={`${nameOf(lane)} (${lane.subagentRunId})`}>
          <span style={{ marginLeft: `calc(var(--u) * ${3 * (row.depth - 1)})` }} className="agui-tl-name agui-conv-mono">{nameOf(lane)}</span>
        </span>
        <Bar row={row} axisMs={axisMs} status={lane.status} glyph={status.glyph} />
        <span className="agui-tl-meta">
          <span>{status.label}</span>
          <span className="agui-conv-muted">{formatMs(durationOf(lane))}</span>
          {dead && <span className="agui-conv-muted">Replaced transcript</span>}
        </span>
      </button>
    </li>
  );
}

function RunRow({ chart, row }: { chart: TimelineChart; row: TimelineRow }): ReactElement {
  const run = chart.run;
  return (
    <li className="agui-tl-item agui-tl-runrow">
      <span className="agui-tl-label">
        <b className="agui-conv-mono">Run {run.runId ?? ''}</b>
      </span>
      <Bar row={row} axisMs={chart.axisMs} status="run" />
      <span className="agui-tl-meta agui-conv-muted">{formatMs(row.endMs - row.startMs)}</span>
    </li>
  );
}

/** The subagent timeline above the transcript. Nothing when no run of the thread has a subagent. */
export function SubagentTimeline({ model, onReveal }: { model: ConversationModel; onReveal?(target: EvidenceTarget): void }): ReactElement | null {
  const charts = useMemo(() => timelineOf(model), [model]);
  const nav = useLaneNav();
  const [active, setActive] = useState<string>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<string | undefined>(undefined);
  const request = nav?.row;

  // The lane rows drawn now, in order: the roving tab stop and the arrow keys move over these.
  const shown = (chart: TimelineChart): TimelineRow[] => (expanded.has(chart.exchangeId) ? laneRows(chart) : laneRows(chart).slice(0, ROW_LIMIT));
  const visible = charts.flatMap((chart) => shown(chart).map((row) => row.id));
  const tabbable = active !== undefined && visible.includes(active) ? active : visible[0];

  // "Show in timeline" for a row past the limit shows the whole chart first.
  useEffect(() => {
    if (request === undefined) return;
    const chart = charts.find((candidate) => laneRows(candidate).findIndex((row) => row.id === request.id) >= ROW_LIMIT);
    if (chart !== undefined && !expanded.has(chart.exchangeId)) setExpanded(new Set([...expanded, chart.exchangeId]));
  }, [request?.nonce]);

  // After a render: focus the first row a "Show more" added. A jump to a row focuses it in the row itself.
  useEffect(() => {
    if (focusAfter.current === undefined) return;
    const target = rows.current.get(focusAfter.current);
    focusAfter.current = undefined;
    target?.focus();
  });

  if (charts.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const from = (event.target as HTMLElement).closest<HTMLElement>('[data-tl-row]')?.dataset.tlRow;
    if (from === undefined || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = visible.indexOf(from);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : event.key === 'ArrowDown' ? at + 1 : at - 1;
    const id = visible[to];
    if (id === undefined) return;
    setActive(id);
    rows.current.get(id)?.focus();
  };

  const jump = (lane: SubagentEntry) => {
    if (lane.inTranscript) return nav?.toLane(lane.id);
    const frameId = (lane.lines.find((line) => line.phase === 'started') ?? lane.lines[0])?.frameId;
    onReveal?.({ exchangeId: lane.exchangeId, ...(frameId !== undefined && { frameId }) });
  };

  const total = model.subagents.length;
  return (
    <section className="agui-tl" data-timeline="subagents" aria-label="Subagent timeline">
      <Disclosure
        defaultOpen
        {...(request !== undefined && { reveal: request.nonce })}
        summary={
          <>
            <span>Subagent timeline</span>
            <span className="agui-conv-muted">{total} {total === 1 ? 'subagent' : 'subagents'}</span>
          </>
        }
      >
        <p className="agui-tl-note agui-conv-muted">
          Positions and durations are derived from the offsets at which frames arrived. The optional timestamp of an event is not used.
        </p>
        <div onKeyDown={onKeyDown}>
          {charts.map((chart) => {
            const lanes = laneRows(chart);
            const drawn = shown(chart);
            const hidden = lanes.length - drawn.length;
            return (
              <div key={chart.exchangeId} className="agui-tl-chart" data-chart={chart.exchangeId}>
                <div className="agui-tl-head">
                  <b className="agui-conv-mono">{chart.run.runId ?? 'run'}</b>
                  <span className="agui-conv-muted">axis from request dispatch to {formatMs(chart.axisMs)}</span>
                </div>
                <div className="agui-tl-box" tabIndex={0} role="region" aria-label={`Timeline of run ${chart.run.runId ?? chart.exchangeId}`}>
                  <Axis axisMs={chart.axisMs} />
                  <ol className="agui-tl-rows">
                    <RunRow chart={chart} row={chart.rows[0]!} />
                    {drawn.map((row) => (
                      <LaneRow
                        key={row.id}
                        row={row}
                        axisMs={chart.axisMs}
                        parent={row.lane!.parentLaneId === undefined ? undefined : nav?.byId.get(row.lane!.parentLaneId)}
                        tabbable={row.id === tabbable}
                        setRef={(id, element) => (element === null ? rows.current.delete(id) : rows.current.set(id, element))}
                        onFocus={setActive}
                        onJump={jump}
                      />
                    ))}
                    {hidden > 0 && (
                      <li className="agui-tl-more">
                        <Button
                          small
                          onClick={() => {
                            focusAfter.current = lanes[drawn.length]?.id;
                            setExpanded(new Set([...expanded, chart.exchangeId]));
                          }}
                        >
                          Show {hidden} more {hidden === 1 ? 'row' : 'rows'}
                        </Button>
                      </li>
                    )}
                  </ol>
                </div>
              </div>
            );
          })}
        </div>
      </Disclosure>
    </section>
  );
}
