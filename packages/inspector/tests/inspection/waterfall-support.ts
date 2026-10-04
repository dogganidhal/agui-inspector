// Scaffolding for the waterfall tests: scripted runs played through the real frame reader and session store of
// the conversation harness, so rows are checked against genuine recorded evidence. Not a test file.
import { delegationRun, DELEGATION_END_MS, type DelegationOptions, type TimedEvent } from '../../../../examples/reference-agent/delegation-run.ts';
import type { InspectionSession, TransportState } from '../../src/contracts.ts';
import type { Waterfall, WaterfallRow } from '../../src/core/projection/waterfall.ts';
import { harness, type Harness, type ScriptedExchange } from '../conversation/support.ts';

export { delegationRun, DELEGATION_END_MS, type TimedEvent };

export interface PlayOptions extends ScriptedExchange {
  readonly threadId?: string;
  readonly runId?: string;
  /** Leave the exchange streaming. */
  readonly live?: boolean;
  readonly elapsedMs?: number;
}

/** Plays `events` into one exchange at their offsets, then closes it unless `live`. */
export function playRun(h: Harness, id: string, events: readonly TimedEvent[], options: PlayOptions = {}): void {
  h.open(id, {
    ...(options.kind !== undefined && { kind: options.kind }),
    ...(options.transport !== undefined && { transport: options.transport }),
    input: { threadId: options.threadId ?? 't1', runId: options.runId ?? id, ...options.input },
  });
  for (const { atMs, event } of events) h.push(id, event, atMs);
  if (options.live !== true) h.close(id, (options.transport ?? 'completed') as TransportState, options.elapsedMs);
}

/** Raw events at 10 ms steps, the way `sessionOf` places them, as timed events. */
export const timed = (events: ReadonlyArray<Record<string, unknown>>, stepMs = 10): TimedEvent[] => events.map((event, i) => ({ atMs: (i + 1) * stepMs, event }));

/** The delegation run as a recorded session of one exchange, `run1`, closed after 1,900 ms. */
export function delegation(options: DelegationOptions = {}): InspectionSession {
  const h = harness();
  playRun(h, 'run1', delegationRun({ threadId: 't1', runId: 'run1' }, options), { elapsedMs: 1900 });
  return h.session();
}

export interface Flat {
  readonly id: string;
  readonly kind: WaterfallRow['kind'];
  readonly label: string;
  readonly depth: number;
  readonly startMs: number | undefined;
  readonly endMs: number | undefined;
  readonly open: boolean;
}

/** Every row of every run, depth first, in the order the view lists them. */
export function flatten(waterfall: Waterfall): Flat[] {
  const rows: Flat[] = [];
  const visit = (row: WaterfallRow, depth: number) => {
    rows.push({ id: row.id, kind: row.kind, label: row.label, depth, startMs: row.startMs, endMs: row.endMs, open: row.open });
    for (const child of row.children) visit(child, depth + 1);
  };
  for (const run of waterfall.runs) visit(run.row, 0);
  return rows;
}

/** The first row of a kind and label, or a failure that names what was there. */
export function rowOf(waterfall: Waterfall, kind: WaterfallRow['kind'], label: string): WaterfallRow {
  const found: WaterfallRow[] = [];
  const visit = (row: WaterfallRow) => {
    if (row.kind === kind && row.label === label) found.push(row);
    row.children.forEach(visit);
  };
  waterfall.runs.forEach((run) => visit(run.row));
  const [first] = found;
  if (first === undefined) throw new Error(`no ${kind} row labelled ${label}`);
  return first;
}
