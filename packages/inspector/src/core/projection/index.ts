// The conversation projection. Framework-free: no React, nothing but plain data.
//
// It reads a session snapshot and builds what the conversation and state views show: runs, messages,
// reasoning, steps, tool calls, subagent markers, activities, custom and raw entries, the current
// state and the chunk expansions. Nothing here is received data. The raw frames stay as the recorder
// and reader left them; every entry names the frames it came from, carries derived values (durations,
// parsed arguments, expansions) as such, and never reaches back into the evidence.
//
// Only frames that are valid events project. Data that is not JSON, not a known event or not
// schema-valid keeps its finding and its place in the frames list and adds nothing here. An event
// that points at something never started is reported as an issue instead of inventing the thing.
//
// Chunks follow the protocol client's expansion: a chunk with a new id opens a message, tool call or
// reasoning message; later chunks continue it; the next explicit event of its lane, or the end of
// the run, closes it. The entries that expansion implies are returned as derived entries with the
// chunk frame as their source. Closing events have no frame of their own, so their attribution is
// `ambiguous`. Message snapshots replace the transcript (FR-019) where the client would merge: the
// view is meant for a developer checking what a snapshot did, so it shows exactly that.
import { contentToText, type Interrupt, type Message } from '@ag-ui/core';
import type {
  DerivedEntry,
  Exchange,
  ExchangeId,
  FrameId,
  InspectionSession,
  JsonValue,
  RawFrame,
  Run,
  SessionStore,
} from '../../contracts.ts';
import { applyJsonPatch, applyStateDelta } from './patch.ts';

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

export interface Delta {
  readonly frameId: FrameId;
  readonly offsetMs: number;
  readonly text: string;
}

interface EntryBase {
  readonly id: string;
  readonly exchangeId: ExchangeId;
  /** The raw frames this entry was built from, in arrival order. */
  frames: FrameId[];
}

export type RunStatus = 'streaming' | 'finished' | 'interrupted' | 'cancelled' | 'error' | 'stopped' | 'no-terminal';

export interface RunEntry extends EntryBase {
  readonly kind: 'run';
  threadId?: string;
  runId?: string;
  parentRunId?: string;
  status: RunStatus;
  /** Offset of RUN_STARTED. */
  startOffsetMs?: number;
  /** Derived from frame offsets: terminal (or latest) frame minus RUN_STARTED. */
  durationMs?: number;
  result?: JsonValue;
  pendingToolCallIds: string[];
  interrupts: Interrupt[];
  error?: { message: string; code?: string };
  /** What the run's input carried: resume answers, tool results, an A2UI action, and which replies were automatic. */
  carried: string[];
  /** Why the connection ended, when it ended badly. Independent of the protocol outcome. */
  transportError?: string;
}

export interface MessageEntry extends EntryBase {
  readonly kind: 'message';
  messageId: string;
  role: string;
  name?: string;
  text: string;
  live: boolean;
  origin: 'stream' | 'input' | 'snapshot';
  /** True when TEXT_MESSAGE_CHUNK events produced it. */
  fromChunk: boolean;
  deltas: Delta[];
  /** Content parts that are not text (images, files): counted, never inlined. */
  extraParts: number;
}

export interface ReasoningEntry extends EntryBase {
  readonly kind: 'reasoning';
  messageId: string;
  text: string;
  live: boolean;
  fromChunk: boolean;
  deltas: Delta[];
}

/** Metadata only. The opaque value stays in the raw frame and is never copied here. */
export interface EncryptedEntry extends EntryBase {
  readonly kind: 'encrypted';
  subtype: string;
  entityId: string;
  /** UTF-8 bytes of the value. */
  size: number;
}

export interface ToolResult {
  content: string;
  messageId: string;
  origin: 'stream' | 'entered' | 'snapshot';
  /** For an entered result: the run that carried it. */
  carriedBy?: string;
  /** The inspector gave this result from the profile. The recorded run says so; the wire never does. */
  automatic?: true;
}

export interface ToolCallEntry extends EntryBase {
  readonly kind: 'tool';
  toolCallId: string;
  name: string;
  parentMessageId?: string;
  /** Argument fragments joined as text. */
  argsText: string;
  argsDeltas: Delta[];
  argsComplete: boolean;
  /** Derived: set once the call completes and the text is valid JSON. */
  argsParsed?: JsonValue;
  argsError?: string;
  result?: ToolResult;
  /** Left unanswered by a finished run: the application owes a result. */
  pending: boolean;
  side?: 'client' | 'server';
  live: boolean;
  fromChunk: boolean;
}

export interface StepEntry extends EntryBase {
  readonly kind: 'step';
  stepName: string;
  startOffsetMs: number;
  durationMs?: number;
  live: boolean;
  children: ConversationEntry[];
}

export interface SubagentLine {
  readonly phase: 'started' | 'finished' | 'error';
  readonly frameId: FrameId;
  readonly offsetMs: number;
  readonly detail?: string;
  readonly outcome?: string;
  readonly code?: string;
}

export interface SubagentEntry extends EntryBase {
  readonly kind: 'subagent';
  subagentRunId: string;
  name?: string;
  description?: string;
  parentToolCallId?: string;
  parentSubagentRunId?: string;
  /** The run it is nested under. */
  parentRunId?: string;
  lines: SubagentLine[];
}

export interface ActivityEntry extends EntryBase {
  readonly kind: 'activity';
  messageId: string;
  activityType: string;
  content: JsonValue;
  /** Deltas applied so far. */
  patches: number;
  /** The last delta that could not be applied; the content is the last valid one. */
  error?: string;
}

export interface CustomEntry extends EntryBase {
  readonly kind: 'custom';
  name: string;
  value: JsonValue;
}

export interface RawEntry extends EntryBase {
  readonly kind: 'raw';
  source?: string;
  value: JsonValue;
}

export interface MessageBrief {
  readonly id: string;
  readonly role: string;
  readonly text: string;
}

export interface SnapshotEntry extends EntryBase {
  readonly kind: 'snapshot';
  /** Messages in the snapshot that the transcript did not have. */
  added: MessageBrief[];
  /** Messages the transcript had that the snapshot leaves out. */
  removed: MessageBrief[];
  count: number;
}

export type ConversationEntry =
  | RunEntry
  | MessageEntry
  | ReasoningEntry
  | EncryptedEntry
  | ToolCallEntry
  | StepEntry
  | SubagentEntry
  | ActivityEntry
  | CustomEntry
  | RawEntry
  | SnapshotEntry
  | IssueEntry;

export interface PatchOperationView {
  readonly op: string;
  readonly path: string;
  readonly from?: string;
  readonly value?: JsonValue;
}

export interface StateChange {
  readonly frameId: FrameId;
  readonly exchangeId: ExchangeId;
  readonly runId?: string;
  readonly offsetMs: number;
  readonly type: 'STATE_SNAPSHOT' | 'STATE_DELTA';
  readonly snapshot?: JsonValue;
  readonly operations?: readonly PatchOperationView[];
  /** False when a delta could not be applied; the current state is then the last valid one. */
  readonly applied: boolean;
  readonly error?: string;
  /** The state after this change, kept on some deltas so a past state replays a few deltas, not all of them. */
  readonly checkpoint?: JsonValue;
}

/**
 * A checkpoint every 64 deltas bounds a replay to 63 patches. A patch copies the state, so replaying 5,000 deltas of
 * a 28 KB state took 1.3 s, and keeping every state would cost 5,000 copies. Measured in specs/010-state-history.
 */
const CHECKPOINT_EVERY = 64;

export interface StateModel {
  /** The state the next run carries. Undefined until a run or a state event provides one. */
  current: JsonValue | undefined;
  /** The state the first run of the thread carried in its input, when it carried one. */
  initial?: JsonValue;
  /** Newest first. */
  changes: StateChange[];
}

/** Something the projection could not show. The frame stays in the frames list. */
export interface ProjectionIssue {
  readonly exchangeId: ExchangeId;
  readonly frameId?: FrameId;
  readonly message: string;
}

/** A projection issue where its frame occurred, inside the run that produced it. */
export interface IssueEntry extends EntryBase, ProjectionIssue {
  readonly kind: 'issue';
}

export interface ConversationModel {
  readonly threadId?: string;
  readonly entries: ConversationEntry[];
  readonly state: StateModel;
  /** Client-expanded chunk events, each linked to the chunk frame that produced it. */
  readonly derived: DerivedEntry[];
  /** Every issue in arrival order. The same ones sit in `entries`, each in its own run. */
  readonly issues: ProjectionIssue[];
}

// ---------------------------------------------------------------------------------------------
// Reading JSON without trusting it
// ---------------------------------------------------------------------------------------------

type Fields = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const encoder = new TextEncoder();

const LIVE_TRANSPORT = new Set(['created', 'sending', 'streaming', 'reading']);

function threadOf(exchange: Exchange, run: Run | undefined, frames: readonly RawFrame[]): string | undefined {
  if (run) return run.threadId;
  const body = exchange.requestBodyJson;
  if (isRecord(body) && typeof body.threadId === 'string') return body.threadId;
  for (const frame of frames) if (isRecord(frame.parsed) && frame.parsed.type === 'RUN_STARTED') return str(frame.parsed.threadId);
  return undefined;
}

function inputOf(exchange: Exchange, run: Run | undefined): Fields {
  if (run) return run.input as unknown as Fields;
  return isRecord(exchange.requestBodyJson) ? exchange.requestBodyJson : {};
}

function parseArguments(text: string): { value: JsonValue } | { error: string } {
  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch (error) {
    return { error: `Arguments are not valid JSON (${error instanceof SyntaxError ? error.message : 'parse failed'})` };
  }
}

const compact = (value: JsonValue | undefined): string | undefined => (value === undefined ? undefined : typeof value === 'string' ? value : JSON.stringify(value));

// ---------------------------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------------------------

type ChunkKind = 'text' | 'tool' | 'reasoning';
interface OpenChunk {
  readonly kind: ChunkKind;
  readonly id: string;
  readonly first: FrameId;
  last: FrameId;
}

interface Registered {
  readonly role: string;
  readonly read: () => string;
}

const CLOSES_OWN_LANE = new Set([
  'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END',
  'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT',
  'STATE_SNAPSHOT', 'STATE_DELTA', 'CUSTOM', 'STEP_STARTED', 'STEP_FINISHED',
  'REASONING_START', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END', 'REASONING_END',
]);
const CLOSES_ALL_LANES = new Set(['RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR', 'MESSAGES_SNAPSHOT']);

/**
 * Builds the conversation, state and chunk expansions of one thread: `current` when the caller names it
 * (the runtime's thread, which may have no exchange yet), else the thread of the latest conversation
 * exchange, which is what an imported recording has.
 */
export function projectConversation(session: InspectionSession, current?: string): ConversationModel {
  const framesOf = new Map<ExchangeId, RawFrame[]>();
  for (const frame of session.frames) {
    const list = framesOf.get(frame.exchangeId);
    if (list) list.push(frame);
    else framesOf.set(frame.exchangeId, [frame]);
  }
  const runOf = new Map<ExchangeId, Run>(session.runs.map((run) => [run.exchangeId, run]));

  const conversation = session.exchanges.filter((exchange) => exchange.kind === 'conversation');
  const threadIds = conversation.map((exchange) => threadOf(exchange, runOf.get(exchange.id), framesOf.get(exchange.id) ?? []));
  const threadId = current ?? threadIds[threadIds.length - 1];
  // A new thread clears the current conversation without rewriting the retained exchanges.
  const exchanges = conversation.filter((_, i) => threadIds[i] === threadId);

  let entries: ConversationEntry[] = [];
  let stack: StepEntry[] = [];
  const derived: DerivedEntry[] = [];
  const issues: ProjectionIssue[] = [];
  const state: StateModel = { current: undefined, changes: [] };
  let sinceAnchor = 0;

  const messages = new Map<string, MessageEntry>();
  const reasonings = new Map<string, ReasoningEntry>();
  const tools = new Map<string, ToolCallEntry>();
  const activities = new Map<string, ActivityEntry>();
  const subagents = new Map<string, SubagentEntry>();
  const registry = new Map<string, Registered>();
  const pendingIds = new Set<string>();
  const phaseOpen = new Set<string>();
  const messageOpen = new Set<string>();
  const lanes = new Map<string | undefined, OpenChunk>();

  let exchange!: Exchange;
  let run!: RunEntry;
  let frame!: RawFrame;
  let startedThisRun: ToolCallEntry[] = [];
  // The tool results of this exchange's input that the inspector gave from the profile, and the ones the input really carried.
  let automaticTools: ReadonlySet<string> = new Set();
  let automaticToolsCarried: string[] = [];

  const container = (): ConversationEntry[] => stack[stack.length - 1]?.children ?? entries;
  const add = <T extends ConversationEntry>(entry: T): T => {
    container().push(entry);
    return entry;
  };
  const base = (suffix: string, frames: FrameId[] = [frame.id]) => ({ id: `${frame.id}:${suffix}`, exchangeId: exchange.id, frames });
  const issue = (message: string, at: RawFrame | undefined = frame) =>
    void issues.push(add<IssueEntry>({ ...base(`issue-${issues.length}`, at ? [at.id] : []), kind: 'issue', ...(at && { frameId: at.id }), message }));
  const touch = (entry: { frames: FrameId[] }) => {
    if (entry.frames[entry.frames.length - 1] !== frame.id) entry.frames.push(frame.id);
  };
  const delta = (text: string): Delta => ({ frameId: frame.id, offsetMs: frame.offsetMs, text });
  const refreshReasoning = (entry: ReasoningEntry) => void (entry.live = phaseOpen.has(entry.messageId) || messageOpen.has(entry.messageId));

  // ---- derived chunk expansions ----

  function expansion(source: FrameId, key: string, type: string, label: string, value: JsonValue, attribution: 'identified' | 'ambiguous') {
    derived.push({ id: `${source}:${key}`, provenance: 'derived', derivation: 'chunk-expansion', sources: [source], attribution, eventType: type, label, value });
  }

  function closeLane(owner: string | undefined) {
    const open = lanes.get(owner);
    if (!open) return;
    lanes.delete(owner);
    if (open.kind === 'text') {
      const entry = messages.get(open.id);
      if (entry) entry.live = false;
      expansion(open.last, `${open.first}:end`, 'TEXT_MESSAGE_END', `TEXT_MESSAGE_END ${open.id}`, { type: 'TEXT_MESSAGE_END', messageId: open.id }, 'ambiguous');
    } else if (open.kind === 'tool') {
      const entry = tools.get(open.id);
      if (entry) completeTool(entry);
      expansion(open.last, `${open.first}:end`, 'TOOL_CALL_END', `TOOL_CALL_END ${open.id}`, { type: 'TOOL_CALL_END', toolCallId: open.id }, 'ambiguous');
    } else {
      const entry = reasonings.get(open.id);
      messageOpen.delete(open.id);
      phaseOpen.delete(open.id);
      if (entry) refreshReasoning(entry);
      expansion(open.last, `${open.first}:end`, 'REASONING_MESSAGE_END', `REASONING_MESSAGE_END ${open.id}`, { type: 'REASONING_MESSAGE_END', messageId: open.id }, 'ambiguous');
    }
  }
  const closeAllLanes = () => [...lanes.keys()].forEach(closeLane);

  /** The lane a chunk belongs to, the way the client infers it: by id, by tag, then by what is open. */
  function laneOfChunk(kind: ChunkKind, id: string | undefined, tag: string | undefined): { owner: string | undefined } | undefined {
    if (id !== undefined) {
      for (const [owner, open] of lanes) if (open.kind === kind && open.id === id) return { owner };
      return { owner: tag };
    }
    if (tag !== undefined) return { owner: tag };
    if (lanes.get(undefined)?.kind === kind) return { owner: undefined };
    const candidates = [...lanes].filter(([, open]) => open.kind === kind);
    return candidates.length === 1 ? { owner: candidates[0]![0] } : undefined;
  }

  function completeTool(entry: ToolCallEntry) {
    entry.live = false;
    if (entry.argsComplete) return;
    entry.argsComplete = true;
    const parsed = parseArguments(entry.argsText);
    if ('value' in parsed) entry.argsParsed = parsed.value;
    else entry.argsError = parsed.error;
  }

  // ---- entries ----

  function newMessage(messageId: string, role: string, origin: MessageEntry['origin'], fromChunk: boolean, frames: FrameId[], name?: string): MessageEntry {
    const entry: MessageEntry = {
      ...base(`message-${messageId}`, frames),
      kind: 'message',
      messageId,
      role,
      ...(name !== undefined && { name }),
      text: '',
      live: origin === 'stream',
      origin,
      fromChunk,
      deltas: [],
      extraParts: 0,
    };
    messages.set(messageId, entry);
    registry.set(messageId, { role, read: () => entry.text });
    return add(entry);
  }

  function newTool(toolCallId: string, name: string, fromChunk: boolean, parentMessageId?: string, frames: FrameId[] = [frame.id], track = true): ToolCallEntry {
    const entry: ToolCallEntry = {
      ...base(`tool-${toolCallId}`, frames),
      kind: 'tool',
      toolCallId,
      name,
      ...(parentMessageId !== undefined && { parentMessageId }),
      argsText: '',
      argsDeltas: [],
      argsComplete: false,
      pending: false,
      live: true,
      fromChunk,
    };
    tools.set(toolCallId, entry);
    if (track) startedThisRun.push(entry);
    if (parentMessageId !== undefined && !registry.has(parentMessageId)) registry.set(parentMessageId, { role: 'assistant', read: () => '' });
    return add(entry);
  }

  function newReasoning(messageId: string, fromChunk: boolean, frames: FrameId[] = [frame.id]): ReasoningEntry {
    const entry: ReasoningEntry = { ...base(`reasoning-${messageId}`, frames), kind: 'reasoning', messageId, text: '', live: true, fromChunk, deltas: [] };
    reasonings.set(messageId, entry);
    registry.set(messageId, { role: 'reasoning', read: () => entry.text });
    return add(entry);
  }

  function setResult(toolCallId: string, result: ToolResult): boolean {
    const tool = tools.get(toolCallId);
    if (!tool) return false;
    tool.result = result;
    tool.pending = false;
    if (result.origin === 'entered') tool.side = 'client';
    else if (result.origin === 'stream') tool.side = 'server';
    return true;
  }

  /** A whole message from a run's input or a snapshot. */
  function addMessage(message: Message, origin: 'input' | 'snapshot') {
    const fields = message as unknown as Fields;
    const id = str(fields.id);
    const role = str(fields.role);
    if (id === undefined || role === undefined) return;
    const content = fields.content as Parameters<typeof contentToText>[0];
    const text = typeof content === 'string' || Array.isArray(content) ? contentToText(content) : '';
    const extraParts = Array.isArray(content) ? content.filter((part) => isRecord(part) && part.type !== 'text').length : 0;
    const name = str(fields.name);
    // A snapshot message came from the snapshot frame; an input message from the run's request, not a frame.
    const sourceFrames: FrameId[] = origin === 'snapshot' ? [frame.id] : [];

    if (role === 'tool') {
      const callId = str(fields.toolCallId);
      const given = origin === 'input' && callId !== undefined && automaticTools.has(callId);
      const result: ToolResult = {
        content: text,
        messageId: id,
        origin: origin === 'input' ? 'entered' : 'snapshot',
        ...(origin === 'input' && run.runId !== undefined && { carriedBy: run.runId }),
        ...(given && { automatic: true as const }),
      };
      registry.set(id, { role, read: () => text });
      if (callId !== undefined && setResult(callId, result)) {
        if (origin === 'input') run.carried.push(`tool result · ${callId}`);
        if (given) automaticToolsCarried.push(callId);
        return;
      }
    } else if (role === 'reasoning') {
      const entry = newReasoning(id, false, sourceFrames);
      entry.text = text;
      entry.live = false;
      return;
    } else if (role === 'activity') {
      const activityType = str(fields.activityType) ?? 'activity';
      const activity = add<ActivityEntry>({ ...base(`activity-${id}`, sourceFrames), kind: 'activity', messageId: id, activityType, content: (fields.content ?? null) as JsonValue, patches: 0 });
      activities.set(id, activity);
      registry.set(id, { role, read: () => JSON.stringify(activity.content) });
      return;
    }
    const calls = role === 'assistant' && Array.isArray(fields.toolCalls) ? fields.toolCalls : [];
    if (role !== 'assistant' || text !== '' || extraParts > 0 || calls.length === 0) {
      const entry = newMessage(id, role, origin, false, sourceFrames, name);
      entry.text = text;
      entry.extraParts = extraParts;
    } else registry.set(id, { role, read: () => '' });
    for (const call of calls) {
      if (!isRecord(call) || !isRecord(call.function)) continue;
      const callId = str(call.id);
      if (callId === undefined || tools.has(callId)) continue;
      const tool = newTool(callId, str(call.function.name) ?? 'tool', false, id, sourceFrames, false);
      tool.argsText = str(call.function.arguments) ?? '';
      tool.live = false;
      completeTool(tool);
    }
  }

  const brief = (id: string, entry: Registered): MessageBrief => ({ id, role: entry.role, text: entry.read() });

  /**
   * The transcript is replaced, except what is still arriving: a message, tool call or reasoning that
   * is streaming, an open step or subagent, and an activity the snapshot does not restate keep their
   * place, so deltas that follow the snapshot still land somewhere.
   */
  function replaceTranscript(snapshot: readonly unknown[]) {
    const incoming = snapshot.filter(isRecord).filter((message) => typeof message.id === 'string');
    const incomingIds = new Set(incoming.map((message) => message.id as string));
    const before = new Map(registry);

    const keep = (list: readonly ConversationEntry[]): ConversationEntry[] =>
      list.flatMap((entry): ConversationEntry[] => {
        switch (entry.kind) {
          case 'step':
            entry.children = keep(entry.children);
            return entry.live || entry.children.length > 0 ? [entry] : [];
          case 'message':
          case 'reasoning':
          case 'tool':
            return entry.live ? [entry] : [];
          case 'subagent':
            return entry.lines.every((line) => line.phase === 'started') ? [entry] : [];
          case 'activity':
            return incomingIds.has(entry.messageId) ? [] : [entry];
          default:
            return [];
        }
      });
    // Run headers and issues stay where they were: boundaries and notes on frames, not messages.
    const boundaries: ConversationEntry[] = [];
    const collect = (list: readonly ConversationEntry[]) => {
      for (const entry of list) {
        if (entry.kind === 'run' || entry.kind === 'issue') boundaries.push(entry);
        else if (entry.kind === 'step') collect(entry.children);
      }
    };
    collect(entries);
    const survivors = keep(entries.filter((entry) => entry.kind !== 'run'));

    const alive = new Set<ConversationEntry>();
    const visit = (list: readonly ConversationEntry[]) => {
      for (const entry of list) {
        alive.add(entry);
        if (entry.kind === 'step') visit(entry.children);
      }
    };
    visit(survivors);
    for (const map of [messages, reasonings, tools, activities, subagents] as Array<Map<string, ConversationEntry>>) {
      for (const [id, entry] of map) if (!alive.has(entry)) map.delete(id);
    }
    registry.clear();
    for (const id of [...messages.keys(), ...reasonings.keys(), ...activities.keys()]) {
      const known = before.get(id);
      if (known) registry.set(id, known);
    }
    for (const id of [...phaseOpen, ...messageOpen]) if (!reasonings.has(id)) (phaseOpen.delete(id), messageOpen.delete(id));

    const removed = [...before].filter(([id]) => !incomingIds.has(id) && !registry.has(id)).map(([id, known]) => brief(id, known));
    const added = incoming.filter((message) => !before.has(message.id as string));
    const marker: SnapshotEntry = { ...base('snapshot'), kind: 'snapshot', added: [], removed, count: incoming.length };

    // The marker follows the boundaries, then the snapshot's messages (at the root, whatever step is
    // open), then what is still arriving.
    const openSteps = stack.filter((step) => alive.has(step));
    stack = [];
    entries = [...boundaries, marker];
    for (const message of incoming) {
      const id = message.id as string;
      if (messages.has(id) || reasonings.has(id) || activities.has(id)) continue; // still arriving: keep the live one
      addMessage(message as unknown as Message, 'snapshot');
    }
    entries.push(...survivors);
    stack = openSteps;
    marker.added = added.map((message) => brief(message.id as string, registry.get(message.id as string) ?? { role: str(message.role) ?? '', read: () => '' }));
  }

  // ---- one exchange ----

  for (const [position, current] of exchanges.entries()) {
    exchange = current;
    const recorded = runOf.get(exchange.id);
    const input = inputOf(exchange, recorded);
    const frames = framesOf.get(exchange.id) ?? [];
    startedThisRun = [];
    automaticTools = new Set(recorded?.automaticReplies?.toolCallIds ?? []);
    automaticToolsCarried = [];
    lanes.clear();

    // Before the first frame is read, ids are made from the exchange.
    frame = { id: `${exchange.id}:input` } as RawFrame;
    run = {
      id: `${exchange.id}:run`,
      exchangeId: exchange.id,
      frames: [],
      kind: 'run',
      ...(str(input.threadId) !== undefined && { threadId: str(input.threadId) as string }),
      ...(str(input.runId) !== undefined && { runId: str(input.runId) as string }),
      ...(str(input.parentRunId) !== undefined && { parentRunId: str(input.parentRunId) as string }),
      status: 'streaming',
      pendingToolCallIds: [],
      interrupts: [],
      carried: [],
    };
    stack = [];
    entries.push(run);

    if (position === 0 && state.current === undefined && input.state !== undefined) state.current = state.initial = input.state as JsonValue;
    if (Array.isArray(input.resume) && input.resume.length > 0) run.carried.push(`resume · ${input.resume.length} ${input.resume.length === 1 ? 'answer' : 'answers'}`);
    const action = isRecord(input.forwardedProps) && isRecord(input.forwardedProps.a2uiAction) ? input.forwardedProps.a2uiAction : undefined;
    const actionName = isRecord(action?.userAction) ? str(action.userAction.name) : undefined;
    if (actionName !== undefined) run.carried.push(`a2uiAction · ${actionName}`);
    if (Array.isArray(input.messages)) {
      for (const message of input.messages as Message[]) {
        const id = str((message as unknown as Fields).id);
        if (id !== undefined && !registry.has(id)) addMessage(message, 'input');
      }
    }
    // Which carried replies the inspector answered from the profile: only ids the input really carries, never one that matches nothing.
    const resumed = new Set(Array.isArray(input.resume) ? (input.resume as Fields[]).map((entry) => str(entry.interruptId)) : []);
    const automatic = [...(recorded?.automaticReplies?.interruptIds.filter((id) => resumed.has(id)) ?? []), ...automaticToolsCarried];
    if (automatic.length > 0) run.carried.push(`automatic · ${automatic.join(', ')}`);

    let terminal = false;
    let lastOffset: number | undefined;
    for (const raw of frames) {
      frame = raw;
      if (raw.classification !== 'data' || raw.schemaVerdict !== 'valid' || !isRecord(raw.parsed)) continue;
      const event = raw.parsed as Fields;
      const type = str(event.type) as string;
      const lane = str(event.subagentRunId);
      lastOffset = raw.offsetMs;

      if (CLOSES_ALL_LANES.has(type)) closeAllLanes();
      else if (CLOSES_OWN_LANE.has(type)) closeLane(lane);
      else if (type === 'SUBAGENT_FINISHED' || type === 'SUBAGENT_ERROR') {
        const owner = str(event.subagentRunId);
        if (owner !== undefined) closeLane(owner);
      }

      switch (type) {
        case 'RUN_STARTED':
          run.threadId = str(event.threadId);
          run.runId = str(event.runId);
          if (str(event.parentRunId) !== undefined) run.parentRunId = str(event.parentRunId);
          else delete run.parentRunId;
          run.startOffsetMs = raw.offsetMs;
          touch(run);
          break;
        case 'RUN_FINISHED': {
          terminal = true;
          touch(run);
          const outcome = isRecord(event.outcome) ? event.outcome : { type: 'success' };
          if (event.result !== undefined) run.result = event.result as JsonValue;
          if (outcome.type === 'interrupt') {
            run.status = 'interrupted';
            run.interrupts = (Array.isArray(outcome.interrupts) ? outcome.interrupts : []) as Interrupt[];
          } else if (outcome.type === 'cancelled') run.status = 'cancelled';
          else {
            run.status = 'finished';
            const named = Array.isArray(outcome.pendingToolCallIds) ? outcome.pendingToolCallIds.filter((id): id is string => typeof id === 'string') : [];
            // Absent or empty: the consumer derives the list from the stream (protocol rule).
            run.pendingToolCallIds = named.length > 0 ? named : startedThisRun.filter((tool) => tool.result === undefined).map((tool) => tool.toolCallId);
            for (const id of run.pendingToolCallIds) {
              pendingIds.add(id);
              const tool = tools.get(id);
              if (tool && !tool.result) {
                tool.pending = true;
                tool.side = 'client';
              }
            }
          }
          if (run.startOffsetMs !== undefined) run.durationMs = raw.offsetMs - run.startOffsetMs;
          break;
        }
        case 'RUN_ERROR':
          terminal = true;
          touch(run);
          run.status = 'error';
          run.error = { message: str(event.message) ?? '', ...(str(event.code) !== undefined && { code: str(event.code) as string }) };
          if (run.startOffsetMs !== undefined) run.durationMs = raw.offsetMs - run.startOffsetMs;
          break;

        case 'STEP_STARTED': {
          const step: StepEntry = { ...base('step'), kind: 'step', stepName: str(event.stepName) ?? '', startOffsetMs: raw.offsetMs, live: true, children: [] };
          add(step);
          stack.push(step);
          break;
        }
        case 'STEP_FINISHED': {
          const name = str(event.stepName);
          const at = stack.findLastIndex((step) => step.stepName === name);
          if (at < 0) {
            issue(`STEP_FINISHED for step "${name}" that is not open`);
            break;
          }
          const [step, ...unfinished] = stack.splice(at);
          for (const inner of unfinished) inner.live = false;
          if (step) {
            step.live = false;
            step.durationMs = raw.offsetMs - step.startOffsetMs;
            touch(step);
          }
          break;
        }

        case 'TEXT_MESSAGE_START': {
          const id = str(event.messageId) as string;
          const entry = messages.get(id) ?? newMessage(id, str(event.role) ?? 'assistant', 'stream', false, [], str(event.name));
          entry.live = true;
          touch(entry);
          break;
        }
        case 'TEXT_MESSAGE_CONTENT': {
          const id = str(event.messageId) as string;
          const entry = messages.get(id);
          if (!entry) {
            issue(`TEXT_MESSAGE_CONTENT for message "${id}" that was never started`);
            break;
          }
          const text = str(event.delta) ?? '';
          entry.text += text;
          entry.deltas.push(delta(text));
          touch(entry);
          break;
        }
        case 'TEXT_MESSAGE_END': {
          const entry = messages.get(str(event.messageId) as string);
          if (!entry) {
            issue(`TEXT_MESSAGE_END for message "${str(event.messageId)}" that was never started`);
            break;
          }
          entry.live = false;
          touch(entry);
          break;
        }
        case 'TEXT_MESSAGE_CHUNK': {
          const id = str(event.messageId);
          const found = laneOfChunk('text', id, lane);
          const open = found && lanes.get(found.owner);
          let entry: MessageEntry | undefined;
          if (open?.kind === 'text' && (id === undefined || id === open.id)) {
            entry = messages.get(open.id);
            open.last = raw.id;
          } else if (found && id !== undefined) {
            closeLane(found.owner);
            const role = str(event.role) ?? 'assistant';
            entry = messages.get(id) ?? newMessage(id, role, 'stream', true, [], str(event.name));
            entry.live = true;
            lanes.set(found.owner, { kind: 'text', id, first: raw.id, last: raw.id });
            expansion(raw.id, 'start', 'TEXT_MESSAGE_START', `TEXT_MESSAGE_START ${id}`, { type: 'TEXT_MESSAGE_START', messageId: id, role }, 'identified');
          } else issue('TEXT_MESSAGE_CHUNK has no messageId and no open message to continue');
          const text = str(event.delta) ?? '';
          if (entry) {
            touch(entry);
            if (text !== '') {
              entry.text += text;
              entry.deltas.push(delta(text));
              expansion(raw.id, 'content', 'TEXT_MESSAGE_CONTENT', `TEXT_MESSAGE_CONTENT ${entry.messageId}`, { type: 'TEXT_MESSAGE_CONTENT', messageId: entry.messageId, delta: text }, 'identified');
            }
          }
          break;
        }

        case 'TOOL_CALL_START': {
          const id = str(event.toolCallId) as string;
          const entry = tools.get(id) ?? newTool(id, str(event.toolCallName) ?? '', false, str(event.parentMessageId));
          entry.live = true;
          touch(entry);
          break;
        }
        case 'TOOL_CALL_ARGS': {
          const entry = tools.get(str(event.toolCallId) as string);
          if (!entry) {
            issue(`TOOL_CALL_ARGS for tool call "${str(event.toolCallId)}" that was never started`);
            break;
          }
          const text = str(event.delta) ?? '';
          entry.argsText += text;
          entry.argsDeltas.push(delta(text));
          touch(entry);
          break;
        }
        case 'TOOL_CALL_END': {
          const entry = tools.get(str(event.toolCallId) as string);
          if (!entry) {
            issue(`TOOL_CALL_END for tool call "${str(event.toolCallId)}" that was never started`);
            break;
          }
          completeTool(entry);
          touch(entry);
          break;
        }
        case 'TOOL_CALL_CHUNK': {
          const id = str(event.toolCallId);
          const found = laneOfChunk('tool', id, lane);
          const open = found && lanes.get(found.owner);
          let entry: ToolCallEntry | undefined;
          if (open?.kind === 'tool' && (id === undefined || id === open.id)) {
            entry = tools.get(open.id);
            open.last = raw.id;
          } else if (found && id !== undefined) {
            closeLane(found.owner);
            const name = str(event.toolCallName) ?? '';
            const parent = str(event.parentMessageId);
            entry = tools.get(id) ?? newTool(id, name, true, parent);
            entry.live = true;
            lanes.set(found.owner, { kind: 'tool', id, first: raw.id, last: raw.id });
            expansion(raw.id, 'start', 'TOOL_CALL_START', `TOOL_CALL_START ${id}`, { type: 'TOOL_CALL_START', toolCallId: id, toolCallName: name, ...(parent !== undefined && { parentMessageId: parent }) }, 'identified');
          } else issue('TOOL_CALL_CHUNK has no toolCallId and no open tool call to continue');
          const text = str(event.delta) ?? '';
          if (entry) {
            touch(entry);
            if (text !== '') {
              entry.argsText += text;
              entry.argsDeltas.push(delta(text));
              expansion(raw.id, 'args', 'TOOL_CALL_ARGS', `TOOL_CALL_ARGS ${entry.toolCallId}`, { type: 'TOOL_CALL_ARGS', toolCallId: entry.toolCallId, delta: text }, 'identified');
            }
          }
          break;
        }
        case 'TOOL_CALL_RESULT': {
          const callId = str(event.toolCallId) as string;
          const messageId = str(event.messageId) as string;
          const content = str(event.content) ?? '';
          registry.set(messageId, { role: 'tool', read: () => content });
          const tool = tools.get(callId);
          if (tool) touch(tool);
          if (!setResult(callId, { content, messageId, origin: 'stream' })) {
            const entry = newMessage(messageId, 'tool', 'stream', false, [raw.id]);
            entry.text = content;
            entry.live = false;
          }
          break;
        }

        case 'REASONING_START': {
          const id = str(event.messageId) as string;
          const entry = reasonings.get(id) ?? newReasoning(id, false);
          phaseOpen.add(id);
          refreshReasoning(entry);
          touch(entry);
          break;
        }
        case 'REASONING_MESSAGE_START': {
          const id = str(event.messageId) as string;
          const entry = reasonings.get(id) ?? newReasoning(id, false);
          messageOpen.add(id);
          refreshReasoning(entry);
          touch(entry);
          break;
        }
        case 'REASONING_MESSAGE_CONTENT': {
          const entry = reasonings.get(str(event.messageId) as string);
          if (!entry) {
            issue(`REASONING_MESSAGE_CONTENT for reasoning "${str(event.messageId)}" that was never started`);
            break;
          }
          const text = str(event.delta) ?? '';
          entry.text += text;
          entry.deltas.push(delta(text));
          touch(entry);
          break;
        }
        case 'REASONING_MESSAGE_END':
        case 'REASONING_END': {
          const id = str(event.messageId) as string;
          const entry = reasonings.get(id);
          if (!entry) {
            issue(`${type} for reasoning "${id}" that was never started`);
            break;
          }
          (type === 'REASONING_END' ? phaseOpen : messageOpen).delete(id);
          refreshReasoning(entry);
          touch(entry);
          break;
        }
        case 'REASONING_MESSAGE_CHUNK': {
          const id = str(event.messageId);
          const found = laneOfChunk('reasoning', id, lane);
          const open = found && lanes.get(found.owner);
          let entry: ReasoningEntry | undefined;
          if (open?.kind === 'reasoning' && (id === undefined || id === open.id)) {
            entry = reasonings.get(open.id);
            open.last = raw.id;
          } else if (found && id !== undefined) {
            closeLane(found.owner);
            entry = reasonings.get(id) ?? newReasoning(id, true);
            messageOpen.add(id);
            refreshReasoning(entry);
            lanes.set(found.owner, { kind: 'reasoning', id, first: raw.id, last: raw.id });
            expansion(raw.id, 'start', 'REASONING_MESSAGE_START', `REASONING_MESSAGE_START ${id}`, { type: 'REASONING_MESSAGE_START', messageId: id, role: 'reasoning' }, 'identified');
          } else issue('REASONING_MESSAGE_CHUNK has no messageId and no open reasoning message to continue');
          const text = str(event.delta) ?? '';
          if (entry) {
            touch(entry);
            if (text !== '') {
              entry.text += text;
              entry.deltas.push(delta(text));
              expansion(raw.id, 'content', 'REASONING_MESSAGE_CONTENT', `REASONING_MESSAGE_CONTENT ${entry.messageId}`, { type: 'REASONING_MESSAGE_CONTENT', messageId: entry.messageId, delta: text }, 'identified');
            }
          }
          break;
        }
        case 'REASONING_ENCRYPTED_VALUE':
          add<EncryptedEntry>({
            ...base('encrypted'),
            kind: 'encrypted',
            subtype: str(event.subtype) ?? '',
            entityId: str(event.entityId) ?? '',
            size: encoder.encode(str(event.encryptedValue) ?? '').length,
          });
          break;

        case 'STATE_SNAPSHOT':
          state.current = event.snapshot as JsonValue;
          sinceAnchor = 0;
          state.changes.push({ frameId: raw.id, exchangeId: exchange.id, ...(run.runId !== undefined && { runId: run.runId }), offsetMs: raw.offsetMs, type: 'STATE_SNAPSHOT', snapshot: event.snapshot as JsonValue, applied: true });
          break;
        case 'STATE_DELTA': {
          const operations = (Array.isArray(event.delta) ? event.delta : []) as unknown as PatchOperationView[];
          const result = applyStateDelta(state.current, operations as never);
          if (result.ok) state.current = result.value;
          else issue(`State delta could not be applied: ${result.error}`);
          const checkpoint = ++sinceAnchor >= CHECKPOINT_EVERY && state.current !== undefined;
          if (checkpoint) sinceAnchor = 0;
          state.changes.push({ frameId: raw.id, exchangeId: exchange.id, ...(run.runId !== undefined && { runId: run.runId }), offsetMs: raw.offsetMs, type: 'STATE_DELTA', operations, applied: result.ok, ...(!result.ok && { error: result.error }), ...(checkpoint && { checkpoint: state.current as JsonValue }) });
          break;
        }
        case 'MESSAGES_SNAPSHOT':
          replaceTranscript(Array.isArray(event.messages) ? event.messages : []);
          break;

        case 'ACTIVITY_SNAPSHOT': {
          const id = str(event.messageId) as string;
          const content = event.content as JsonValue;
          const existing = activities.get(id);
          if (existing) {
            const merge = event.replace === false && isRecord(existing.content) && isRecord(content);
            existing.content = merge ? ({ ...(existing.content as object), ...(content as object) } as JsonValue) : content;
            existing.activityType = str(event.activityType) ?? existing.activityType;
            delete existing.error;
            touch(existing);
          } else {
            const activity = add<ActivityEntry>({ ...base(`activity-${id}`), kind: 'activity', messageId: id, activityType: str(event.activityType) ?? '', content, patches: 0 });
            activities.set(id, activity);
            registry.set(id, { role: 'activity', read: () => JSON.stringify(activity.content) });
          }
          break;
        }
        case 'ACTIVITY_DELTA': {
          const id = str(event.messageId) as string;
          const activity = activities.get(id);
          if (!activity) {
            issue(`ACTIVITY_DELTA for activity "${id}" that has no snapshot`);
            break;
          }
          const result = applyJsonPatch(activity.content, (Array.isArray(event.patch) ? event.patch : []) as never);
          touch(activity);
          if (result.ok) {
            activity.content = result.value;
            activity.patches += 1;
            delete activity.error;
          } else {
            activity.error = result.error;
            issue(`Activity patch could not be applied: ${result.error}`);
          }
          break;
        }

        case 'SUBAGENT_STARTED':
        case 'SUBAGENT_FINISHED':
        case 'SUBAGENT_ERROR': {
          const id = str(event.subagentRunId) as string;
          let entry = subagents.get(id);
          if (!entry) {
            entry = add<SubagentEntry>({ ...base(`subagent-${id}`), kind: 'subagent', subagentRunId: id, ...(run.runId !== undefined && { parentRunId: run.runId }), lines: [] });
            subagents.set(id, entry);
          }
          touch(entry);
          if (type === 'SUBAGENT_STARTED') {
            if (str(event.name) !== undefined) entry.name = str(event.name);
            if (str(event.description) !== undefined) entry.description = str(event.description);
            if (str(event.parentToolCallId) !== undefined) entry.parentToolCallId = str(event.parentToolCallId);
            if (str(event.parentSubagentRunId) !== undefined) entry.parentSubagentRunId = str(event.parentSubagentRunId);
            entry.lines.push({ phase: 'started', frameId: raw.id, offsetMs: raw.offsetMs });
          } else if (type === 'SUBAGENT_FINISHED') {
            const detail = compact(event.result as JsonValue | undefined);
            const outcome = isRecord(event.outcome) ? str(event.outcome.type) : undefined;
            entry.lines.push({ phase: 'finished', frameId: raw.id, offsetMs: raw.offsetMs, ...(detail !== undefined && { detail }), ...(outcome !== undefined && { outcome }) });
          } else {
            entry.lines.push({ phase: 'error', frameId: raw.id, offsetMs: raw.offsetMs, detail: str(event.message) ?? '', ...(str(event.code) !== undefined && { code: str(event.code) as string }) });
          }
          break;
        }

        case 'CUSTOM':
          add<CustomEntry>({ ...base('custom'), kind: 'custom', name: str(event.name) ?? '', value: event.value as JsonValue });
          break;
        case 'RAW':
          add<RawEntry>({ ...base('raw'), kind: 'raw', ...(str(event.source) !== undefined && { source: str(event.source) as string }), value: event.event as JsonValue });
          break;
        default:
          break;
      }
    }

    // The exchange is over: nothing in it is still arriving.
    const live = LIVE_TRANSPORT.has(exchange.transport);
    if (!live) {
      closeAllLanes();
      const everything = (list: readonly ConversationEntry[]) => {
        for (const entry of list) {
          if (entry.exchangeId !== exchange.id) continue;
          if (entry.kind === 'message' || entry.kind === 'tool' || entry.kind === 'reasoning' || entry.kind === 'step') entry.live = false;
          if (entry.kind === 'step') everything(entry.children);
        }
      };
      everything(entries);
    }
    if (!terminal) {
      run.status = live ? 'streaming' : exchange.transport === 'user-stopped' ? 'stopped' : 'no-terminal';
      if (run.startOffsetMs !== undefined && lastOffset !== undefined) run.durationMs = lastOffset - run.startOffsetMs;
      if (exchange.transportError !== undefined) run.transportError = exchange.transportError;
    }
    if (run.runId === undefined) delete run.runId;
    if (run.threadId === undefined) delete run.threadId;
  }

  return { ...(threadId !== undefined && { threadId }), entries, state: { current: state.current, ...(state.initial !== undefined && { initial: state.initial }), changes: state.changes.reverse() }, derived, issues };
}

// ---------------------------------------------------------------------------------------------
// Publishing derived entries
// ---------------------------------------------------------------------------------------------

/**
 * Adds the chunk expansions the session does not hold yet to the store, where the frames list shows
 * them beside the chunks that produced them. Ids are stable, so calling this after every change only
 * appends what is new. Returns how many it added.
 */
export function publishChunkExpansions(store: SessionStore): number {
  const session = store.snapshot();
  const known = new Set(session.derived.map((entry) => entry.id));
  let added = 0;
  for (const entry of projectConversation(session).derived) {
    if (known.has(entry.id)) continue;
    store.appendDerived(entry);
    added += 1;
  }
  return added;
}
