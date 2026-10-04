# Data model: Run waterfall

Everything here is derived and in memory. Nothing is stored, exported or added to a recording. Times are arrival
offsets in milliseconds from the moment the exchange's request was sent, as `RawFrame.offsetMs` records them.

## Waterfall (core/projection/waterfall.ts)

```ts
export type RowKind = 'run' | 'step' | 'message' | 'reasoning' | 'tool' | 'subagent';

export interface RowTag {
  readonly text: string;
  readonly variant: 'neutral' | 'line' | 'accent' | 'ok' | 'warn' | 'err';
}

export interface WaterfallRow {
  /** Stable across store updates and across an export and import: derived from frame and exchange ids. */
  readonly id: string;
  readonly kind: RowKind;
  /** Run id, step name, message role, reasoning message id, tool name or subagent name. */
  readonly label: string;
  /** The id the details show: runId, messageId, toolCallId, subagentRunId or the step name. */
  readonly subject: string;
  /** Offset of the first frame of the row in its exchange. Absent only for a run with no valid event. */
  readonly startMs?: number;
  /** Offset of the frame that ended the row. Absent while the row is open. */
  readonly endMs?: number;
  /** True when no end was seen. Open rows are drawn to the run's latest frame. */
  readonly open: boolean;
  /** Tool call only: when its arguments were complete, and when its result arrived in this exchange. */
  readonly argsEndMs?: number;
  readonly resultMs?: number;
  readonly tags: readonly RowTag[];
  readonly firstFrame?: FrameId;
  readonly lastFrame?: FrameId;
  readonly frameCount: number;
  /** Details that depend on the kind (run: thread, parent run; subagent: description, parent tool call). */
  readonly facts: readonly { readonly name: string; readonly value: string }[];
  /** In start order. */
  readonly children: readonly WaterfallRow[];
}

export interface WaterfallRun {
  readonly exchangeId: ExchangeId;
  readonly row: WaterfallRow;
  /** The run's own status, as the conversation names it. */
  readonly status: RunStatus;
  /** The exchange still streams: an open row is then "running", else "no end seen". */
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

export function buildWaterfall(session: InspectionSession, threadId?: string): Waterfall;
```

### Row ids

| Row | Id |
| --- | --- |
| Run | `<exchangeId>:run` |
| Step, message, reasoning, tool call | the projection's entry id, which is `<first frame id>:<kind>-<id>` |
| Subagent | `<exchangeId>:subagent-<subagentRunId>` |

Frame ids are recorded in the session file, so ids are the same after an import.

### Which entries become rows

| Projection entry | Row | Condition |
| --- | --- | --- |
| `run` | run | one per conversation exchange of the thread |
| `step` | step | has a frame in its own exchange |
| `message` | message | has a frame in its own exchange (input-origin messages have none) |
| `reasoning` | reasoning | has a frame in its own exchange |
| `tool` | tool | has a frame in its own exchange |
| `subagent` | subagent | one per exchange in which it has a start, finish or error line |
| `activity`, `custom`, `raw`, `encrypted`, `snapshot`, `issue` | none | out of scope |

### Start, end and open, by kind

| Kind | Start | End | Open when |
| --- | --- | --- | --- |
| run | `RUN_STARTED` offset (`startOffsetMs`) | start plus `durationMs` | status is `streaming`, `stopped` or `no-terminal`; the row then extends to `latestMs` |
| step | `STEP_STARTED` offset | start plus `durationMs` | `durationMs` is absent |
| message | first frame | `TEXT_MESSAGE_END` frame; chunk-built: last chunk once closed | no end frame; chunk-built and not closed, or the run stopped without a terminal event |
| reasoning | first frame | `REASONING_END` (phased) or `REASONING_MESSAGE_END`; chunk-built: last chunk once closed | as for a message |
| tool | first frame | result frame if there is one; else the arguments end when the run has ended | arguments never completed; or arguments complete, no result, and the run has no terminal event |
| subagent | start line in this run, else the first line | finish or error line in this run | no finish or error line in this run |

A tool call's bar has two spans: arguments from start to `argsEndMs`, and the wait from `argsEndMs` to `resultMs`.

### Tags

| Row | Tag | Variant | When |
| --- | --- | --- | --- |
| run | Streaming, Finished, Interrupted, Cancelled, Error, Stopped by you, No terminal event | as the conversation's run header | always one |
| run | connection error | warn | the exchange has a transport error (its text is the `Connection` fact) |
| tool | waiting for result | warn | the run ended and the call has no result and is pending |
| tool | no result | warn | the run ended and the call has no result and is not pending |
| tool | answered by the client | line | the result was entered in a later run |
| tool | answered in a later run | line | the result frame belongs to a later exchange |
| subagent | error | err | its run segment ended with `SUBAGENT_ERROR` |
| subagent | suspended | warn | its segment ended with a `suspended` outcome |
| subagent | continued | line | its segment has no start line |
| any open row | running (live exchange) or no end seen | accent or warn | `open` |

### Nesting

1. Each row starts under the row that holds its entry in the projection: the run, or the open step it was added to.
2. Subagent rows are created per exchange from the entry's lines.
3. In arrival order, each subagent row moves under the row of its `parentToolCallId` if that tool call has a row in
   the run, else under the row of its `parentSubagentRunId` if that subagent has a row in the run.
4. In arrival order, each step, message, reasoning or tool row whose first frame carries a `subagentRunId` moves under
   that subagent's row if the subagent has a row in the run.
5. A move is refused when the new parent is inside the moving row's own subtree.
6. Children are sorted by `startMs`, then by the arrival index of the first frame.

## Visible rows (views/inspection/waterfall-model.ts)

```ts
export interface VisibleRow {
  readonly row: WaterfallRow;
  readonly run: WaterfallRun;
  /** 0 for the run row. aria-level is depth + 1. */
  readonly depth: number;
  readonly parentIndex?: number;
  readonly expandable: boolean;
  /** Open. A run row can be open with nothing under it, so its axis shows. Any other leaf is not expanded. */
  readonly expanded: boolean;
  readonly posInSet: number;
  readonly setSize: number;
}

export function visibleRows(waterfall: Waterfall, closed: ReadonlySet<string>, openRuns: ReadonlyMap<string, boolean>): VisibleRow[];
export type TreeKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End' | 'Enter';
export type TreeMove =
  | { readonly type: 'focus'; readonly index: number }
  | { readonly type: 'toggle'; readonly id: string; readonly open: boolean }
  | { readonly type: 'show'; readonly index: number }
  | { readonly type: 'none' };
export function treeKey(rows: readonly VisibleRow[], index: number, key: TreeKey): TreeMove;
export function axisTicks(axisMs: number): { readonly ms: number; readonly label: string }[];
export function rowLabel(visible: VisibleRow): string;
export function segmentsOf(visible: Pick<VisibleRow, 'row' | 'run'>): Segment[];   // the bars of a row on its run's axis
export function indexRows(waterfall: Waterfall): ReadonlyMap<string, Known>;        // every row by id, with its parent
```

A run row is expanded unless `openRuns` says false for it. The newest run is expanded when `openRuns` has no entry for
it, and an older run is closed when it has none. Any other row is expanded unless its id is in `closed`.

## View state (views/inspection/index.tsx)

```ts
interface WaterfallState {
  /** The store and the thread the state belongs to. A different one resets the state. */
  readonly scope: { readonly store: SessionStore; readonly threadId: string | undefined };
  readonly selected?: string;
  readonly closed: ReadonlySet<string>;
  readonly openRuns: ReadonlyMap<string, boolean>;
}
```

The selected id may name a row that is not visible (a collapsed ancestor) or that no longer exists. The tab stop then
falls on the nearest visible ancestor, or the first row, and the details area shows nothing selected until the user
moves.
