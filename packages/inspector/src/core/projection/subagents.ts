// The subagent timeline as data. Framework-free: plain objects in, plain objects out.
//
// `ConversationModel.subagents` lists every subagent lane of a thread, and the run entries hold each run's extent. This
// turns them into one chart per run that has subagents: a row for the run, then a row for each lane, nested lanes under
// their parent, depth first. Every number is an offset in milliseconds from the request's dispatch, the same origin the
// frames list uses, so a row lines up with the frame ticks of its run. They are derived from arrival offsets.
//
// It reads only `model.subagents` and the run entries, never the transcript. A MESSAGES_SNAPSHOT takes ended lanes out of
// the transcript, and their rows stay. Other views that need which run a subagent belongs to, what it is nested under and
// when it began and ended can read the same list, or call this.
import type { ConversationModel, RunEntry, SubagentEntry } from './index.ts';

export interface TimelineRow {
  readonly kind: 'run' | 'subagent';
  /** The run entry's or the lane's `id`. */
  readonly id: string;
  /** 0 for the run, 1 for a lane directly under it, plus 1 for each level of nesting. */
  readonly depth: number;
  readonly startMs: number;
  /** Never less than `startMs`. */
  readonly endMs: number;
  /** For a `subagent` row: the lane, for its status, name, id, parent and whether the transcript still holds it. */
  readonly lane?: SubagentEntry;
}

export interface TimelineChart {
  readonly exchangeId: string;
  readonly run: RunEntry;
  /** Where the run's exchange ends on the axis: `run.axisMs`. */
  readonly axisMs: number;
  /** The run, then its lanes depth first. */
  readonly rows: readonly TimelineRow[];
}

/** One chart per run entry that has at least one lane, in the order of the runs. Pure: the model is not changed. */
export function timelineOf(model: ConversationModel): TimelineChart[] {
  const byRun = new Map<string, SubagentEntry[]>();
  for (const lane of model.subagents) {
    const list = byRun.get(lane.exchangeId);
    if (list) list.push(lane);
    else byRun.set(lane.exchangeId, [lane]);
  }
  const charts: TimelineChart[] = [];
  for (const run of model.entries) {
    if (run.kind !== 'run') continue;
    const lanes = byRun.get(run.exchangeId);
    if (lanes === undefined) continue;

    const nested = new Map<string, SubagentEntry[]>();
    const top: SubagentEntry[] = [];
    const known = new Set(lanes.map((lane) => lane.id));
    for (const lane of lanes) {
      if (lane.parentLaneId === undefined || !known.has(lane.parentLaneId)) top.push(lane);
      else if (nested.has(lane.parentLaneId)) nested.get(lane.parentLaneId)!.push(lane);
      else nested.set(lane.parentLaneId, [lane]);
    }

    const start = run.startOffsetMs ?? 0;
    const rows: TimelineRow[] = [{ kind: 'run', id: run.id, depth: 0, startMs: start, endMs: start + (run.durationMs ?? 0) }];
    // A stack, not recursion: a thread can nest as deep as its agents do.
    const pending = top.map((lane) => ({ lane, depth: 1 })).reverse();
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { lane, depth } = next;
      const startMs = lane.startOffsetMs ?? lane.firstOffsetMs;
      rows.push({ kind: 'subagent', id: lane.id, depth, startMs, endMs: Math.max(lane.endOffsetMs, startMs), lane });
      const inner = nested.get(lane.id);
      if (inner !== undefined) for (let at = inner.length - 1; at >= 0; at -= 1) pending.push({ lane: inner[at]!, depth: depth + 1 });
    }
    charts.push({ exchangeId: run.exchangeId, run, axisMs: run.axisMs, rows });
  }
  return charts;
}
