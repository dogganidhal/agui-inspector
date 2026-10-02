// What the frames list shows, as plain data: families, one-line summaries, filters, and the rows of
// an exchange. No React and no DOM, so every rule here is unit-tested without a browser.
//
// Nothing in this file edits evidence. Summaries and labels are read off a frame; a frame whose
// fields do not look like its type falls back to the reader's own summary rather than guessing.
// Client-derived entries (chunk expansions) are separate rows placed after the frame they came from.
import { EventType } from '@ag-ui/core';
import type { DerivedEntry, Exchange, ExchangeId, Finding, FrameId, InspectionSession, RawFrame } from '../../contracts.ts';
import type { Family } from '../theme/primitives.tsx';

// ---------------------------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------------------------

export type FamilyKey = 'run' | 'step' | 'text' | 'tool' | 'reasoning' | 'state' | 'activity' | 'subagent' | 'ext';

export interface FamilyDef {
  readonly key: FamilyKey;
  readonly label: string;
  /** The dot color token the primitives know. */
  readonly family: Family;
  /** Run, step, subagent, custom and raw have no hue of their own. */
  readonly hollow: boolean;
}

export const FAMILIES: readonly FamilyDef[] = [
  { key: 'run', label: 'Run', family: 'neutral', hollow: true },
  { key: 'step', label: 'Steps', family: 'neutral', hollow: true },
  { key: 'text', label: 'Text', family: 'text', hollow: false },
  { key: 'tool', label: 'Tools', family: 'tool', hollow: false },
  { key: 'reasoning', label: 'Reasoning', family: 'reason', hollow: false },
  { key: 'state', label: 'State', family: 'state', hollow: false },
  { key: 'activity', label: 'Activity', family: 'activity', hollow: false },
  { key: 'subagent', label: 'Subagents', family: 'neutral', hollow: true },
  { key: 'ext', label: 'Custom & raw', family: 'neutral', hollow: true },
];

const PREFIXES: Readonly<Record<string, FamilyKey>> = {
  RUN: 'run',
  STEP: 'step',
  TEXT: 'text',
  TOOL: 'tool',
  REASONING: 'reasoning',
  STATE: 'state',
  MESSAGES: 'state',
  ACTIVITY: 'activity',
  SUBAGENT: 'subagent',
  CUSTOM: 'ext',
  RAW: 'ext',
};

const BASELINE = new Set<string>(Object.values(EventType));
const familyByKey = new Map(FAMILIES.map((family) => [family.key, family]));

/** The family of a baseline event type. Unknown and missing types belong to none. */
export function familyOf(eventType: string | undefined): FamilyKey | undefined {
  if (eventType === undefined || !BASELINE.has(eventType)) return undefined;
  return PREFIXES[eventType.split('_')[0] ?? ''];
}

export const familyDef = (key: FamilyKey): FamilyDef => familyByKey.get(key) as FamilyDef;

// ---------------------------------------------------------------------------------------------
// Labels and one-line summaries (T034: all 31 types)
// ---------------------------------------------------------------------------------------------

const encoder = new TextEncoder();
const MAX_TEXT = 56;
const MAX_ID = 64;

const cut = (text: string, length: number) => (text.length > length ? `${text.slice(0, length - 1)}…` : text);
const quote = (text: string) => JSON.stringify(cut(text, MAX_TEXT));
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const asObject = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export function formatBytes(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}
export const byteLength = (text: string) => encoder.encode(text).length;
/** `+s.mmm`: milliseconds since the request was dispatched, in seconds. */
export const formatOffset = (offsetMs: number) => `+${(offsetMs / 1000).toFixed(3)}`;
export const formatDuration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);

/** The type column: the event type when identifiable, otherwise what kind of thing was received. */
export function typeLabel(frame: RawFrame): string {
  if (frame.classification !== 'data') return frame.classification;
  if (frame.eventType !== undefined) return frame.eventType;
  return frame.jsonVerdict === 'invalid' ? 'unparsed' : 'untyped';
}

/**
 * One line for the summary column. Ids come first, then the most useful payload field; strings are
 * quoted and cut at about 56 characters. Every field is checked before it is used, because the frame
 * may be schema-invalid: a frame that does not carry what its type promises gets the reader's
 * summary instead.
 */
export function summarizeFrame(frame: RawFrame): string {
  if (frame.classification !== 'data') return frame.summary;
  if (frame.jsonVerdict !== 'valid') return `unparsed · ${byteLength(frame.data ?? '')} bytes`;
  const event = asObject(frame.parsed);
  return (event && summarizeEvent(event)) ?? frame.summary;
}

function summarizeEvent(o: Readonly<Record<string, unknown>>): string | undefined {
  const str = (key: string): string | undefined => (typeof o[key] === 'string' ? (o[key] as string) : undefined);
  const id = (key: string): string | undefined => {
    const value = str(key);
    return value === undefined ? undefined : cut(value, MAX_ID);
  };
  const delta = () => {
    const value = str('delta');
    return value === undefined ? undefined : quote(value);
  };
  const joined = (parts: ReadonlyArray<string | undefined>, separator = ' · ') => (parts.every((part) => part !== undefined) ? parts.join(separator) : undefined);
  const present = (parts: ReadonlyArray<string | undefined>, separator = ' ') => {
    const kept = parts.filter((part): part is string => part !== undefined);
    return kept.length > 0 ? kept.join(separator) : undefined;
  };
  const count = (key: string) => (Array.isArray(o[key]) ? (o[key] as unknown[]).length : undefined);

  switch (o.type) {
    case EventType.RUN_STARTED: {
      const run = id('runId');
      return run === undefined ? undefined : `${run}${id('parentRunId') ? `  ← ${id('parentRunId')}` : ''}`;
    }
    case EventType.RUN_FINISHED: {
      if (o.outcome === undefined) return 'success';
      const outcome = asObject(o.outcome);
      if (outcome?.type === 'interrupt' && Array.isArray(outcome.interrupts)) return `interrupt · ${outcome.interrupts.length} waiting`;
      if (outcome?.type === 'cancelled') return 'cancelled';
      if (outcome?.type !== 'success') return undefined;
      const pending = Array.isArray(outcome.pendingToolCallIds) ? outcome.pendingToolCallIds.length : 0;
      return pending > 0 ? `success · ${plural(pending, 'pending tool call')}` : 'success';
    }
    case EventType.RUN_ERROR: {
      const message = str('message');
      return message === undefined ? undefined : present([id('code'), cut(message, MAX_TEXT)], ' · ');
    }
    case EventType.STEP_STARTED:
    case EventType.STEP_FINISHED:
      return id('stepName');
    case EventType.TEXT_MESSAGE_START:
    case EventType.REASONING_MESSAGE_START:
      return joined([id('messageId'), id('role')]);
    case EventType.TEXT_MESSAGE_CONTENT:
    case EventType.REASONING_MESSAGE_CONTENT:
      return joined([id('messageId'), delta()], ' ');
    case EventType.TEXT_MESSAGE_CHUNK:
    case EventType.REASONING_MESSAGE_CHUNK:
      return present([id('messageId'), delta()]);
    case EventType.TEXT_MESSAGE_END:
    case EventType.REASONING_START:
    case EventType.REASONING_MESSAGE_END:
    case EventType.REASONING_END:
      return id('messageId');
    case EventType.TOOL_CALL_START:
      return joined([id('toolCallName'), id('toolCallId')]);
    case EventType.TOOL_CALL_ARGS:
      return joined([id('toolCallId'), delta()], ' ');
    case EventType.TOOL_CALL_END:
      return id('toolCallId');
    case EventType.TOOL_CALL_CHUNK: {
      const call = present([id('toolCallName'), id('toolCallId')], ' · ');
      return present([call, delta()]);
    }
    case EventType.TOOL_CALL_RESULT: {
      const content = str('content');
      const call = id('toolCallId');
      return content === undefined || call === undefined ? undefined : `${call} → ${cut(content, 44)}`;
    }
    case EventType.REASONING_ENCRYPTED_VALUE: {
      const value = str('encryptedValue');
      const head = joined([id('subtype'), id('entityId')]);
      return value === undefined || head === undefined ? undefined : `${head} · ${formatBytes(value.length)} · not decoded`;
    }
    case EventType.STATE_SNAPSHOT: {
      if (!('snapshot' in o)) return undefined;
      const snapshot = asObject(o.snapshot);
      if (snapshot === undefined) return `snapshot · ${Array.isArray(o.snapshot) ? 'array' : typeof o.snapshot}`;
      const keys = Object.keys(snapshot);
      return `snapshot · ${keys.length === 0 ? 'empty' : cut(keys.join(', '), MAX_TEXT)}`;
    }
    case EventType.STATE_DELTA: {
      if (!Array.isArray(o.delta)) return undefined;
      const ops = o.delta.map((patch: unknown) => {
        const operation = asObject(patch);
        return typeof operation?.op === 'string' && typeof operation.path === 'string' ? `${operation.op} ${operation.path}` : '?';
      });
      return ops.length === 0 ? 'no operations' : cut(ops.join(', '), MAX_TEXT);
    }
    case EventType.MESSAGES_SNAPSHOT: {
      const messages = count('messages');
      return messages === undefined ? undefined : plural(messages, 'message');
    }
    case EventType.ACTIVITY_SNAPSHOT:
      return joined([id('activityType'), id('messageId')]);
    case EventType.ACTIVITY_DELTA: {
      const ops = count('patch');
      const kind = id('activityType');
      return ops === undefined || kind === undefined ? undefined : `${kind} · ${plural(ops, 'op')}`;
    }
    case EventType.SUBAGENT_STARTED:
      return joined([id('name'), id('subagentRunId')]);
    case EventType.SUBAGENT_FINISHED:
      return id('subagentRunId');
    case EventType.SUBAGENT_ERROR: {
      const run = id('subagentRunId');
      const message = str('message');
      return run === undefined ? undefined : message === undefined ? run : `${run} · ${cut(message, MAX_TEXT)}`;
    }
    case EventType.CUSTOM: {
      const name = id('name');
      const value = JSON.stringify(o.value);
      return name === undefined ? undefined : `${name} = ${value === undefined ? 'undefined' : cut(value, MAX_TEXT)}`;
    }
    case EventType.RAW:
      return id('source');
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

export interface FrameFilter {
  /** Matches the event type or the raw content, ignoring case. */
  readonly query: string;
  /** Empty means every family. */
  readonly families: ReadonlySet<FamilyKey>;
  readonly issuesOnly: boolean;
}

export const NO_FILTER: FrameFilter = { query: '', families: new Set(), issuesOnly: false };
export const isFiltering = (filter: FrameFilter) => filter.query !== '' || filter.families.size > 0 || filter.issuesOnly;

const haystacks = new WeakMap<object, string>();
function haystack(source: object, build: () => string): string {
  let text = haystacks.get(source);
  if (text === undefined) haystacks.set(source, (text = build().toLowerCase()));
  return text;
}

/** `issues` is how many findings point at the frame. Control and partial evidence has no type or issue. */
export function frameMatches(frame: RawFrame, issues: number, filter: FrameFilter): boolean {
  if (filter.families.size > 0) {
    const family = frame.classification === 'data' ? familyOf(frame.eventType) : undefined;
    if (family === undefined || !filter.families.has(family)) return false;
  }
  if (filter.issuesOnly && issues === 0) return false;
  if (filter.query !== '') {
    const query = filter.query.toLowerCase();
    if (!(frame.eventType ?? '').toLowerCase().includes(query) && !haystack(frame, () => frame.data ?? frame.envelope).includes(query)) return false;
  }
  return true;
}

function derivedMatches(entry: DerivedEntry, filter: FrameFilter): boolean {
  if (filter.issuesOnly) return false;
  if (filter.families.size > 0) {
    const family = familyOf(entry.eventType);
    if (family === undefined || !filter.families.has(family)) return false;
  }
  if (filter.query !== '') {
    const text = haystack(entry, () => `${entry.eventType} ${entry.label} ${JSON.stringify(entry.value) ?? ''}`);
    if (!text.includes(filter.query.toLowerCase())) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The session as the list shows it
// ---------------------------------------------------------------------------------------------

export interface ExchangeEntry {
  readonly exchange: Exchange;
  /** The protocol run id for a conversation run, otherwise the opaque link recorded with the exchange. */
  readonly runLabel?: string;
  /** Every frame of the exchange, in arrival order. These are the original records. */
  readonly frames: readonly RawFrame[];
  readonly dataFrames: number;
  /** Findings that point at the exchange or at the run it carried. */
  readonly findings: readonly Finding[];
  readonly frameFindings: ReadonlyMap<FrameId, readonly Finding[]>;
  /** Client-derived entries, keyed by the frame they follow. */
  readonly derivedAfter: ReadonlyMap<FrameId, readonly DerivedEntry[]>;
  /** Findings on its frames plus findings on the exchange and its run. */
  readonly issues: number;
}

export interface SessionIndex {
  readonly session: InspectionSession;
  /** Newest first, as the list shows them. */
  readonly newestFirst: readonly ExchangeEntry[];
  readonly dataFrames: number;
  readonly issues: number;
  readonly familyCounts: ReadonlyMap<FamilyKey, number>;
  /** Derived entries whose source frame is unknown; shown apart, never attached to a guess. */
  readonly unattributed: readonly DerivedEntry[];
  issuesOf(frame: RawFrame): number;
}

export function indexSession(session: InspectionSession): SessionIndex {
  const frameById = new Map(session.frames.map((frame) => [frame.id, frame]));
  const runById = new Map(session.runs.map((run) => [run.id, run]));
  const runsOfExchange = new Map<ExchangeId, string[]>();
  for (const run of session.runs) runsOfExchange.set(run.exchangeId, [...(runsOfExchange.get(run.exchangeId) ?? []), run.id]);

  const frameFindings = new Map<FrameId, Finding[]>();
  const levelFindings = new Map<string, Finding[]>();
  for (const finding of session.findings) {
    const bucket = finding.subject.type === 'frame' ? frameFindings : levelFindings;
    const key = finding.subject.type === 'frame' ? finding.subject.id : `${finding.subject.type}:${finding.subject.id}`;
    bucket.set(key, [...(bucket.get(key) ?? []), finding]);
  }

  const derivedByExchange = new Map<ExchangeId, Map<FrameId, DerivedEntry[]>>();
  const unattributed: DerivedEntry[] = [];
  for (const entry of session.derived) {
    const anchor = frameById.get(entry.sources[entry.sources.length - 1] ?? '');
    if (anchor === undefined) {
      unattributed.push(entry);
      continue;
    }
    const anchors = derivedByExchange.get(anchor.exchangeId) ?? new Map<FrameId, DerivedEntry[]>();
    anchors.set(anchor.id, [...(anchors.get(anchor.id) ?? []), entry]);
    derivedByExchange.set(anchor.exchangeId, anchors);
  }

  const familyCounts = new Map<FamilyKey, number>();
  let dataFrames = 0;
  let issues = 0;
  const entries: ExchangeEntry[] = session.exchanges.map((exchange) => {
    const frames = exchange.frameIds.map((id) => frameById.get(id)).filter((frame): frame is RawFrame => frame !== undefined);
    const own: Finding[] = [
      ...(levelFindings.get(`exchange:${exchange.id}`) ?? []),
      ...(runsOfExchange.get(exchange.id) ?? []).flatMap((id) => levelFindings.get(`run:${id}`) ?? []),
    ];
    let data = 0;
    let onFrames = 0;
    const perFrame = new Map<FrameId, readonly Finding[]>();
    for (const frame of frames) {
      const found = frameFindings.get(frame.id);
      if (found) {
        perFrame.set(frame.id, found);
        onFrames += found.length;
      }
      if (frame.classification !== 'data') continue;
      data += 1;
      const family = familyOf(frame.eventType);
      if (family !== undefined) familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
    }
    dataFrames += data;
    issues += own.length + onFrames;
    const run = runById.get(exchange.runId ?? '');
    const runLabel = run?.runId ?? exchange.runId;
    return {
      exchange,
      ...(runLabel !== undefined && { runLabel }),
      frames,
      dataFrames: data,
      findings: own,
      frameFindings: perFrame,
      derivedAfter: derivedByExchange.get(exchange.id) ?? new Map(),
      issues: own.length + onFrames,
    };
  });

  return {
    session,
    newestFirst: entries.reverse(),
    dataFrames,
    issues,
    familyCounts,
    unattributed,
    issuesOf: (frame) => frameFindings.get(frame.id)?.length ?? 0,
  };
}

export type Row =
  | { readonly type: 'frame'; readonly frame: RawFrame; readonly findings: readonly Finding[] }
  | { readonly type: 'derived'; readonly entry: DerivedEntry };

const NONE: readonly Finding[] = [];

/**
 * The rows of one exchange under a filter, in arrival order, and how many of its data frames match.
 * A derived row follows the frame it came from and is shown whenever it matches on its own.
 */
export function exchangeRows(entry: ExchangeEntry, filter: FrameFilter): { readonly rows: Row[]; readonly shown: number } {
  const rows: Row[] = [];
  let shown = 0;
  for (const frame of entry.frames) {
    const findings = entry.frameFindings.get(frame.id) ?? NONE;
    if (frameMatches(frame, findings.length, filter)) {
      rows.push({ type: 'frame', frame, findings });
      if (frame.classification === 'data') shown += 1;
    }
    for (const derived of entry.derivedAfter.get(frame.id) ?? NONE_DERIVED) {
      if (derivedMatches(derived, filter)) rows.push({ type: 'derived', entry: derived });
    }
  }
  return { rows, shown };
}
const NONE_DERIVED: readonly DerivedEntry[] = [];

/** How many data frames of the exchange match, without building rows. */
export function countShown(entry: ExchangeEntry, filter: FrameFilter): number {
  if (!isFiltering(filter)) return entry.dataFrames;
  let shown = 0;
  for (const frame of entry.frames) {
    if (frame.classification === 'data' && frameMatches(frame, entry.frameFindings.get(frame.id)?.length ?? 0, filter)) shown += 1;
  }
  return shown;
}

/** The recording's frames of one exchange as JSON: the original records, in arrival order. */
export const copyFramesJson = (entry: ExchangeEntry): string => JSON.stringify(entry.frames, null, 2);
