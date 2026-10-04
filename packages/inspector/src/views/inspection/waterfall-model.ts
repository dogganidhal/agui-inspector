// What the waterfall shows, as plain data: the rows that are visible, the keys of the tree, the ticks of an axis
// and the accessible label of a row. No React and no DOM, so every rule here is unit-tested without a browser.
//
// Nothing here edits evidence. Times are derived from frame offsets and written with the frames list's formats.
import type { RowKind, Waterfall, WaterfallRow, WaterfallRun } from '../../core/projection/waterfall.ts';
import { formatDuration, formatOffset } from './model.ts';

export interface VisibleRow {
  readonly row: WaterfallRow;
  readonly run: WaterfallRun;
  /** 0 for the run row. `aria-level` is the depth plus one. */
  readonly depth: number;
  /** Index of the parent in the visible list; absent for a run row. */
  readonly parentIndex?: number;
  readonly expandable: boolean;
  /** Open. For a run row, also when it has no rows under it: its axis shows. Always false for another leaf. */
  readonly expanded: boolean;
  readonly posInSet: number;
  readonly setSize: number;
}

/**
 * The rows on screen, in order. A run row is expanded unless `openRuns` says otherwise for it: without a choice the
 * newest run is open and an older run is closed. Any other row with children is expanded unless its id is in `closed`.
 */
export function visibleRows(waterfall: Waterfall, closed: ReadonlySet<string>, openRuns: ReadonlyMap<string, boolean>): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const add = (row: WaterfallRow, run: WaterfallRun, depth: number, parentIndex: number | undefined, posInSet: number, setSize: number, expanded: boolean) => {
    const index = rows.length;
    rows.push({ row, run, depth, ...(parentIndex !== undefined && { parentIndex }), expandable: row.children.length > 0, expanded: (depth === 0 || row.children.length > 0) && expanded, posInSet, setSize });
    if (!expanded) return;
    row.children.forEach((child, i) => add(child, run, depth + 1, index, i + 1, row.children.length, !closed.has(child.id)));
  };
  waterfall.runs.forEach((run, position) => add(run.row, run, 0, undefined, position + 1, waterfall.runs.length, openRuns.get(run.row.id) ?? position === 0));
  return rows;
}

// ---------------------------------------------------------------------------------------------
// The keys of the tree
// ---------------------------------------------------------------------------------------------

export type TreeKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End' | 'Enter';

export const TREE_KEYS: ReadonlySet<string> = new Set<TreeKey>(['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter']);

export type TreeMove =
  | { readonly type: 'focus'; readonly index: number }
  | { readonly type: 'toggle'; readonly id: string; readonly open: boolean }
  | { readonly type: 'show'; readonly index: number }
  | { readonly type: 'none' };

const NONE: TreeMove = { type: 'none' };

/** What a key does on the row at `index`, as in the ARIA tree pattern. Enter shows the row's first frame. */
export function treeKey(rows: readonly VisibleRow[], index: number, key: TreeKey): TreeMove {
  const at = rows[index];
  if (at === undefined) return NONE;
  const focus = (target: number): TreeMove => (target >= 0 && target < rows.length && target !== index ? { type: 'focus', index: target } : NONE);
  switch (key) {
    case 'ArrowDown':
      return focus(index + 1);
    case 'ArrowUp':
      return focus(index - 1);
    case 'Home':
      return focus(0);
    case 'End':
      return focus(rows.length - 1);
    case 'ArrowRight':
      if (!at.expandable) return NONE;
      return at.expanded ? focus(index + 1) : { type: 'toggle', id: at.row.id, open: true };
    case 'ArrowLeft':
      if (at.expandable && at.expanded) return { type: 'toggle', id: at.row.id, open: false };
      return at.parentIndex === undefined ? NONE : focus(at.parentIndex);
    case 'Enter':
      return { type: 'show', index };
  }
}

// ---------------------------------------------------------------------------------------------
// The axis
// ---------------------------------------------------------------------------------------------

const STEPS_MS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
const MAX_TICKS = 8;

const tickLabel = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${+(ms / 1000).toFixed(1)} s`);

/** Characters of the axis font (10.5 px mono) across the narrowest timeline track, 60 units. The waterfall's track is as wide or wider. */
const AXIS_CHARS = 38;

/**
 * The tick marks after 0: multiples of the smallest round step that gives at most eight, and none whose label would
 * touch the end label, which is right-aligned at the end of the axis.
 */
export function axisTicks(axisMs: number): { readonly ms: number; readonly label: string }[] {
  const step = STEPS_MS.find((candidate) => axisMs / candidate <= MAX_TICKS) ?? STEPS_MS[STEPS_MS.length - 1] ?? 1000;
  const end = formatDuration(axisMs).length;
  const ticks: { ms: number; label: string }[] = [];
  for (let ms = step; (1 - ms / axisMs) * AXIS_CHARS >= tickLabel(ms).length / 2 + end + 1; ms += step) ticks.push({ ms, label: tickLabel(ms) });
  return ticks;
}

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

export const KIND_WORD: Readonly<Record<RowKind, string>> = { run: 'run', step: 'step', message: 'text', reasoning: 'reasoning', tool: 'tool', subagent: 'subagent' };

/** `running` while the exchange streams, else `no end seen`. */
export const openWord = (run: WaterfallRun): string => (run.live ? 'running' : 'no end seen');

/** Duration text of an ended row, or of how long an open row has been seen. */
export function spanText(row: WaterfallRow, run: WaterfallRun): string | undefined {
  if (row.startMs === undefined) return undefined;
  return row.endMs === undefined ? `seen for ${formatDuration(Math.max(run.latestMs - row.startMs, 0))}` : formatDuration(row.endMs - row.startMs);
}

/**
 * What a screen reader says for a row: kind, label, nesting level, times and state. The bars and ticks are decoration, so
 * everything they show is here as text.
 */
export function rowLabel({ row, run, depth, expandable, expanded }: VisibleRow): string {
  const parts: string[] = [KIND_WORD[row.kind], row.label, `level ${depth + 1}`];
  if (row.startMs !== undefined) parts.push(`started ${formatOffset(row.startMs)}`);
  const span = spanText(row, run);
  if (row.endMs !== undefined && row.startMs !== undefined) parts.push(`ended ${formatOffset(row.endMs)}`, formatDuration(row.endMs - row.startMs));
  else if (row.open) parts.push(openWord(run), ...(span === undefined ? [] : [span]));
  for (const tag of row.tags) parts.push(tag.text);
  if (expandable) parts.push(expanded ? 'open' : 'closed');
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Bars and lookups
// ---------------------------------------------------------------------------------------------

export interface Segment {
  readonly part: 'span' | 'args' | 'wait';
  readonly startMs: number;
  readonly endMs: number;
  /** The segment runs to the latest frame of the run because the row has no end. */
  readonly open: boolean;
}

/**
 * The bars of a row on its run's axis. An open row runs to the latest frame of its run. A tool call has two when its
 * arguments end is known: the arguments, then the wait for the result.
 */
export function segmentsOf({ row, run }: Pick<VisibleRow, 'row' | 'run'>): Segment[] {
  if (row.startMs === undefined) return [];
  const start = row.startMs;
  const open = row.endMs === undefined;
  const end = Math.max(row.endMs ?? run.latestMs, start);
  if (row.kind !== 'tool' || row.argsEndMs === undefined) return [{ part: 'span', startMs: start, endMs: end, open }];
  const argsEnd = Math.min(Math.max(row.argsEndMs, start), end);
  const args: Segment = { part: 'args', startMs: start, endMs: argsEnd, open: open && end === argsEnd };
  return end > argsEnd ? [args, { part: 'wait', startMs: argsEnd, endMs: end, open }] : [args];
}

export interface Known {
  readonly row: WaterfallRow;
  readonly run: WaterfallRun;
  readonly parent?: string;
}

/** Every row of the waterfall by id, with its parent, whether or not it is visible. */
export function indexRows(waterfall: Waterfall): ReadonlyMap<string, Known> {
  const known = new Map<string, Known>();
  const visit = (row: WaterfallRow, run: WaterfallRun, parent: string | undefined) => {
    known.set(row.id, { row, run, ...(parent !== undefined && { parent }) });
    for (const child of row.children) visit(child, run, row.id);
  };
  for (const run of waterfall.runs) visit(run.row, run, undefined);
  return known;
}
