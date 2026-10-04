// The run waterfall: the runs of a thread as nested rows with a start and an end on the arrival-offset
// axis. Framework-free: no React, nothing but plain data.
//
// It reads a session and builds nothing that was received. The rows come from the conversation
// projection, so a message, a tool call or a step means here what it means in the conversation. Times are
// the arrival offsets of the frames the projection names for each entry. A row ends at the frame that ends
// it, by event type, or it does not end: it is open, and no end is made up for it.
//
// The projection is run over the session without its `MESSAGES_SNAPSHOT` frames. A snapshot replaces the
// transcript there, which drops messages and tool calls that streamed earlier. That is right for a
// conversation and wrong for a timeline, where a message that took three seconds did take three seconds.
import type { ExchangeId, FrameId, InspectionSession, RawFrame } from '../../contracts.ts';
import { projectConversation, type ConversationEntry, type MessageEntry, type ReasoningEntry, type RunEntry, type RunStatus, type StepEntry, type ToolCallEntry } from './index.ts';

export type RowKind = 'run' | 'step' | 'message' | 'reasoning' | 'tool' | 'subagent';

export interface RowTag {
  readonly text: string;
  readonly variant: 'neutral' | 'line' | 'accent' | 'ok' | 'warn' | 'err';
}

export interface WaterfallRow {
  /** Derived from frame and exchange ids, so it is the same after an export and an import. */
  readonly id: string;
  readonly kind: RowKind;
  /** Run id, step name, message role, reasoning message id, tool name. */
  readonly label: string;
  /** The id the details show: the run id, step name or message id, or the tool call id. */
  readonly subject: string;
  /** Offset of the row's first frame in its exchange. Absent only for a run with no valid event. */
  readonly startMs?: number;
  /** Offset of the frame that ended the row. Absent while the row is open. */
  readonly endMs?: number;
  /** No end was seen. An open row is drawn to the latest frame of its run. */
  readonly open: boolean;
  /** Tool call only: when its arguments were complete, and when its result arrived in this exchange. */
  readonly argsEndMs?: number;
  readonly resultMs?: number;
  readonly tags: readonly RowTag[];
  readonly firstFrame?: FrameId;
  readonly lastFrame?: FrameId;
  readonly frameCount: number;
  /** Text details that depend on the kind. */
  readonly facts: readonly { readonly name: string; readonly value: string }[];
  /** In start order. */
  readonly children: readonly WaterfallRow[];
}

export interface WaterfallRun {
  readonly exchangeId: ExchangeId;
  readonly row: WaterfallRow;
  readonly status: RunStatus;
  /** The exchange still streams: an open row is "running", otherwise "no end seen". */
  readonly live: boolean;
  /** Offset of the latest frame of the exchange, valid or not. */
  readonly latestMs: number;
  /** Length of the axis: the later of `latestMs` and the exchange's elapsed time, at least 1. */
  readonly axisMs: number;
}

export interface Waterfall {
  readonly threadId?: string;
  /** Newest first. */
  readonly runs: readonly WaterfallRun[];
}

interface Mutable extends Omit<WaterfallRow, 'children'> {
  children: WaterfallRow[];
}

const LIVE = new Set(['created', 'sending', 'streaming', 'reading']);
const ENDED: ReadonlySet<RunStatus> = new Set(['finished', 'interrupted', 'cancelled', 'error']);

const STATUS_TAG: Record<RunStatus, RowTag> = {
  streaming: { text: 'Streaming', variant: 'accent' },
  finished: { text: 'Finished', variant: 'ok' },
  interrupted: { text: 'Interrupted', variant: 'accent' },
  cancelled: { text: 'Cancelled', variant: 'neutral' },
  error: { text: 'Error', variant: 'err' },
  stopped: { text: 'Stopped by you', variant: 'warn' },
  'no-terminal': { text: 'No terminal event', variant: 'warn' },
};

/** The runs of one thread: `threadId` when given, else the thread of the latest conversation exchange. */
export function buildWaterfall(session: InspectionSession, threadId?: string): Waterfall {
  const model = projectConversation({ ...session, frames: session.frames.filter((frame) => frame.eventType !== 'MESSAGES_SNAPSHOT') }, threadId);

  const frameById = new Map<FrameId, RawFrame>();
  const latest = new Map<ExchangeId, number>();
  const count = new Map<ExchangeId, number>();
  const firstOf = new Map<ExchangeId, FrameId>();
  const lastOf = new Map<ExchangeId, FrameId>();
  for (const frame of session.frames) {
    frameById.set(frame.id, frame);
    if (!firstOf.has(frame.exchangeId)) firstOf.set(frame.exchangeId, frame.id);
    latest.set(frame.exchangeId, Math.max(latest.get(frame.exchangeId) ?? 0, frame.offsetMs));
    count.set(frame.exchangeId, (count.get(frame.exchangeId) ?? 0) + 1);
    lastOf.set(frame.exchangeId, frame.id);
  }
  const exchangeById = new Map(session.exchanges.map((exchange) => [exchange.id, exchange]));

  const runs: RunEntry[] = [];
  const inRun = new Map<ExchangeId, ConversationEntry[]>();
  for (const entry of model.entries) {
    if (entry.kind === 'run') runs.push(entry);
    else inRun.set(entry.exchangeId, [...(inRun.get(entry.exchangeId) ?? []), entry]);
  }

  const groups = runs.map((run): WaterfallRun => {
    const exchange = exchangeById.get(run.exchangeId);
    const latestMs = latest.get(run.exchangeId) ?? 0;
    const axisMs = Math.max(exchange?.elapsedMs ?? latestMs, latestMs, 1);
    // A message built from chunks has no end event. The projection closes it, and from then on it ended at its last chunk.
    // That holds unless the exchange ended with nothing after the chunk to close it.
    const settled = run.status !== 'stopped' && run.status !== 'no-terminal';

    /** The frames of an entry that belong to this run's exchange: offsets of another exchange are not comparable. */
    const own = (entry: { frames: readonly FrameId[] }): RawFrame[] =>
      entry.frames.flatMap((id) => {
        const frame = frameById.get(id);
        return frame !== undefined && frame.exchangeId === run.exchangeId ? [frame] : [];
      });
    const firstIndex = (row: WaterfallRow): number => (row.firstFrame === undefined ? 0 : (frameById.get(row.firstFrame)?.index ?? 0));
    const sorted = (rows: WaterfallRow[]): WaterfallRow[] => rows.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0) || firstIndex(a) - firstIndex(b));

    const row = (entry: { id: string }, kind: RowKind, label: string, subject: string, frames: readonly RawFrame[], rest: Partial<Mutable>): WaterfallRow => ({
      id: entry.id,
      kind,
      label,
      subject,
      open: rest.endMs === undefined,
      tags: [],
      frameCount: frames.length,
      facts: [],
      ...(frames[0] !== undefined && { startMs: frames[0].offsetMs, firstFrame: frames[0].id }),
      ...(frames.length > 0 && { lastFrame: frames[frames.length - 1]?.id as FrameId }),
      ...rest,
      children: rest.children ?? [],
    });

    const message = (entry: MessageEntry): WaterfallRow | undefined => {
      const frames = own(entry);
      if (frames.length === 0) return undefined;
      const explicit = frames.find((frame) => frame.eventType === 'TEXT_MESSAGE_END');
      const closed = explicit ?? (entry.fromChunk && !entry.live && settled ? frames[frames.length - 1] : undefined);
      return row(entry, 'message', entry.name === undefined ? entry.role : `${entry.role} ${entry.name}`, entry.messageId, frames, closed === undefined ? {} : { endMs: closed.offsetMs });
    };

    const reasoning = (entry: ReasoningEntry): WaterfallRow | undefined => {
      const frames = own(entry);
      if (frames.length === 0) return undefined;
      const endType = frames.some((frame) => frame.eventType === 'REASONING_START') ? 'REASONING_END' : 'REASONING_MESSAGE_END';
      const explicit = frames.findLast((frame) => frame.eventType === endType);
      const closed = explicit ?? (entry.fromChunk && !entry.live && settled ? frames[frames.length - 1] : undefined);
      return row(entry, 'reasoning', entry.messageId, entry.messageId, frames, closed === undefined ? {} : { endMs: closed.offsetMs });
    };

    const tool = (entry: ToolCallEntry): WaterfallRow | undefined => {
      const frames = own(entry);
      if (frames.length === 0) return undefined;
      const result = frames.find((frame) => frame.eventType === 'TOOL_CALL_RESULT');
      const argFrames = frames.filter((frame) => frame.eventType !== 'TOOL_CALL_RESULT');
      const argsEnd = frames.find((frame) => frame.eventType === 'TOOL_CALL_END') ?? (entry.fromChunk && !entry.live && settled ? argFrames[argFrames.length - 1] : undefined);
      const tags: RowTag[] = [];
      let endMs: number | undefined;
      if (result !== undefined) endMs = result.offsetMs;
      else if (entry.result !== undefined) {
        // The result is not a frame of this run: the client entered it for a later run, or a later run streamed it.
        tags.push({ text: entry.result.origin === 'entered' ? 'answered by the client' : 'answered in a later run', variant: 'line' });
        endMs = argsEnd?.offsetMs;
      } else if (ENDED.has(run.status) && argsEnd !== undefined) {
        tags.push({ text: entry.pending ? 'waiting for result' : 'no result', variant: 'warn' });
        endMs = argsEnd.offsetMs;
      }
      return row(entry, 'tool', entry.name, entry.toolCallId, frames, {
        ...(endMs !== undefined && { endMs }),
        ...(argsEnd !== undefined && { argsEndMs: argsEnd.offsetMs }),
        ...(result !== undefined && { resultMs: result.offsetMs }),
        tags,
      });
    };

    const step = (entry: StepEntry): WaterfallRow | undefined => {
      const frames = own(entry);
      if (frames.length === 0) return undefined;
      return row(entry, 'step', entry.stepName, entry.stepName, frames, {
        startMs: entry.startOffsetMs,
        ...(entry.durationMs !== undefined && { endMs: entry.startOffsetMs + entry.durationMs }),
        children: rowsOf(entry.children),
      });
    };

    function rowsOf(entries: readonly ConversationEntry[]): WaterfallRow[] {
      const rows: WaterfallRow[] = [];
      for (const entry of entries) {
        const made =
          entry.kind === 'step' ? step(entry) : entry.kind === 'message' ? message(entry) : entry.kind === 'reasoning' ? reasoning(entry) : entry.kind === 'tool' ? tool(entry) : undefined;
        // Subagent runs, activities, custom, raw and encrypted entries, snapshots and issues are not rows here.
        if (made !== undefined) rows.push(made);
      }
      return sorted(rows);
    }

    const frames = own(run);
    const ended = ENDED.has(run.status) && run.startOffsetMs !== undefined && run.durationMs !== undefined;
    const tags: RowTag[] = [STATUS_TAG[run.status]];
    if (run.transportError !== undefined) tags.push({ text: 'connection error', variant: 'warn' });
    const first = frames[0]?.id ?? firstOf.get(run.exchangeId);
    const runRow: WaterfallRow = {
      id: run.id,
      kind: 'run',
      label: run.runId ?? 'run',
      subject: run.runId ?? 'run',
      open: !ENDED.has(run.status),
      tags,
      frameCount: count.get(run.exchangeId) ?? 0,
      facts: [
        ...(run.threadId !== undefined ? [{ name: 'Thread', value: run.threadId }] : []),
        ...(run.parentRunId !== undefined ? [{ name: 'Parent run', value: run.parentRunId }] : []),
        ...(run.transportError !== undefined ? [{ name: 'Connection', value: run.transportError }] : []),
      ],
      ...(run.startOffsetMs !== undefined && { startMs: run.startOffsetMs }),
      ...(ended && { endMs: (run.startOffsetMs as number) + (run.durationMs as number) }),
      ...(first !== undefined && { firstFrame: first }),
      ...(lastOf.has(run.exchangeId) && { lastFrame: lastOf.get(run.exchangeId) as FrameId }),
      children: rowsOf(inRun.get(run.exchangeId) ?? []),
    };
    return { exchangeId: run.exchangeId, row: runRow, status: run.status, live: LIVE.has(exchange?.transport ?? ''), latestMs, axisMs };
  });

  return { ...(model.threadId !== undefined && { threadId: model.threadId }), runs: groups.reverse() };
}
