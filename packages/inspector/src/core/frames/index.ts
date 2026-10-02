// The frame reader. Framework-free: no React, no DOM beyond TextDecoder.
//
// It turns the recorder's raw event-stream bytes into append-only frames. Each frame keeps the
// original envelope text (every line and delimiter, exactly as decoded) beside the extracted data
// text, so what the reader concluded can always be checked against what crossed the wire.
//
// The reader judges and never edits. Data that is not JSON, not a known event or not schema-valid is
// still a received data frame; a finding sits beside it. Comments, field-only blocks and blank lines
// are kept as `control` evidence, and text cut off by the end of the stream as `partial` evidence:
// neither is an AG-UI event, neither is counted as one, and neither is ever turned into one.
//
// Sequence violations are the protocol client's to report, and a run's outcome is not decided here:
// a stream without a valid RUN_FINISHED or RUN_ERROR gets a `terminal` finding and nothing else.
import { EventType } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import type {
  ExchangeId,
  Finding,
  FindingSubject,
  JsonValue,
  JsonVerdict,
  RawFrame,
  SchemaVerdict,
  SessionStore,
} from '../../contracts.ts';
import type { RecorderSink } from '../recorder/index.ts';

export type FrameOutput = Pick<SessionStore, 'appendFrame' | 'addFinding'>;

export interface EventCheck {
  readonly verdict: 'valid' | 'invalid' | 'unknown-type';
  /** Short descriptions of what failed. They name fields, never the received values. */
  readonly problems: readonly string[];
}

const KNOWN_TYPES = new Set<string>(Object.values(EventType));
const TERMINAL_TYPES = new Set<string>([EventType.RUN_FINISHED, EventType.RUN_ERROR]);
const SUMMARY_HINTS = ['messageId', 'toolCallId', 'stepName', 'runId', 'subagentRunId', 'name', 'activityType', 'entityId'];
const MAX_PROBLEMS = 3;

const truncate = (text: string, length: number) => (text.length > length ? `${text.slice(0, length)}…` : text);
const asObject = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Checks one parsed value against the upstream AG-UI event schema. */
export function checkEvent(value: unknown): EventCheck {
  const type = asObject(value)?.type;
  if (typeof type === 'string' && !KNOWN_TYPES.has(type)) {
    return { verdict: 'unknown-type', problems: [`Unknown event type "${truncate(type, 64)}"`] };
  }
  const result = EventSchemas.safeParse(value);
  if (result.success) return { verdict: 'valid', problems: [] };
  const { issues } = result.error;
  const problems = issues.slice(0, MAX_PROBLEMS).map((issue) => {
    const expected = 'expected' in issue && typeof issue.expected === 'string' ? `, expected ${issue.expected}` : '';
    return `${issue.path.map(String).join('.') || '(root)'}: ${issue.code}${expected}`;
  });
  if (issues.length > MAX_PROBLEMS) problems.push(`and ${issues.length - MAX_PROBLEMS} more`);
  return { verdict: 'invalid', problems };
}

function summarize(jsonVerdict: JsonVerdict, parsed: JsonValue | undefined, type: string | undefined): string {
  if (jsonVerdict === 'invalid') return 'Not valid JSON';
  if (type === undefined) return 'JSON without an event type';
  const fields = asObject(parsed);
  for (const key of SUMMARY_HINTS) {
    const hint = fields?.[key];
    if (typeof hint === 'string') return `${type} ${key}=${truncate(hint, 64)}`;
  }
  return type;
}

export interface FrameReader {
  /** Raw bytes in arrival order, stamped with milliseconds since the request was dispatched. */
  push(bytes: Uint8Array, offsetMs: number): void;
  /**
   * The stream is over, however it ended. Keeps unfinished text as partial evidence and, when no
   * valid terminal event was observed, adds one `terminal` finding to `subject` (the exchange by
   * default). Calling it again does nothing.
   */
  end(subject?: FindingSubject): void;
}

export interface FrameReaderOptions {
  /** Replaces the schema check. Only tests need this. */
  readonly check?: (value: unknown) => EventCheck;
}

const LF = 10;
const CR = 13;
const BOM = '﻿';

export function createFrameReader(output: FrameOutput, exchangeId: ExchangeId, options: FrameReaderOptions = {}): FrameReader {
  const check = options.check ?? checkEvent;
  // ignoreBOM keeps a leading byte order mark in the text: the envelope is what was received.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

  // Text of the block being read, and where we are in it.
  let buffer = '';
  let consumed = 0; // characters of the stream that precede buffer[0]
  let scan = 0;
  let lineStart = 0;
  let firstLine = true;
  // What the lines of this block contained.
  let data: string[] = [];
  let comments = 0;
  let fields = 0;
  let lines = 0;

  // Which chunk each character arrived in: the offset of a frame is that of its last character.
  const markers: Array<{ end: number; offsetMs: number }> = [];
  let lastOffset = 0;
  let frames = 0;
  let terminalSeen = false;
  let ended = false;

  const offsetOf = (end: number) => markers.find((marker) => marker.end >= end)?.offsetMs ?? lastOffset;
  const append = (text: string) => {
    if (text.length === 0) return;
    buffer += text;
    markers.push({ end: consumed + buffer.length, offsetMs: lastOffset });
  };

  function emit(end: number, partial = false) {
    const envelope = buffer.slice(0, end);
    const offsetMs = offsetOf(consumed + end);
    const id = `${exchangeId}:frame-${frames}`;
    const index = frames;
    const block = { data, comments, fields, lines };

    frames += 1;
    buffer = buffer.slice(end);
    consumed += end;
    scan = lineStart = 0;
    data = [];
    comments = fields = lines = 0;
    while (markers.length > 0 && markers[0]!.end <= consumed) markers.shift();

    const base = { id, exchangeId, index, envelope, offsetMs, provenance: 'raw' } as const;
    if (partial) {
      return output.appendFrame({
        ...base,
        classification: 'partial',
        summary: 'Incomplete event at the end of the stream (never dispatched)',
        jsonVerdict: 'not-applicable',
        schemaVerdict: 'not-applicable',
      });
    }
    if (block.data.length === 0) {
      const summary = block.lines === 0 ? 'SSE blank line' : block.fields === 0 ? 'SSE comment' : 'SSE fields without data';
      return output.appendFrame({ ...base, classification: 'control', summary, jsonVerdict: 'not-applicable', schemaVerdict: 'not-applicable' });
    }
    appendDataFrame(base, block.data.join('\n'));
  }

  function appendDataFrame(base: Pick<RawFrame, 'id' | 'exchangeId' | 'index' | 'envelope' | 'offsetMs' | 'provenance'>, text: string) {
    let parsed: JsonValue | undefined;
    let jsonVerdict: JsonVerdict = 'valid';
    try {
      parsed = JSON.parse(text) as JsonValue;
    } catch {
      jsonVerdict = 'invalid';
    }

    let schemaVerdict: SchemaVerdict = 'not-applicable';
    let problems: readonly string[] = [];
    let unexpected = false;
    const rawType = asObject(parsed)?.type;
    const eventType = typeof rawType === 'string' ? rawType : undefined;
    if (jsonVerdict === 'valid') {
      try {
        ({ verdict: schemaVerdict, problems } = check(parsed));
      } catch (error) {
        // A validator failure must not cost the frame. It is retained and marked, and reading goes on.
        schemaVerdict = 'invalid';
        unexpected = true;
        problems = [`Schema validation failed unexpectedly (${error instanceof Error ? error.name : 'error'})`];
      }
    }

    const frame: RawFrame = {
      ...base,
      classification: 'data',
      data: text,
      ...(eventType !== undefined && { eventType }),
      summary: summarize(jsonVerdict, parsed, eventType),
      jsonVerdict,
      schemaVerdict,
      ...(jsonVerdict === 'valid' && { parsed }),
    };
    if (schemaVerdict === 'valid' && eventType !== undefined && TERMINAL_TYPES.has(eventType)) terminalSeen = true;
    output.appendFrame(frame);

    const subject = { type: 'frame', id: frame.id } as const;
    const finding = (kind: Finding['kind'], message: string) => output.addFinding({ id: `${frame.id}:finding`, kind, message, subject });
    if (jsonVerdict === 'invalid') finding('json', 'Data is not valid JSON');
    else if (schemaVerdict === 'unknown-type') finding('schema', `${problems[0]}; it is not in the supported baseline`);
    else if (schemaVerdict === 'invalid') finding('schema', unexpected ? (problems[0] as string) : `Does not match the AG-UI event schema: ${problems.join('; ')}`);
  }

  function readLine(line: string) {
    if (firstLine && line.startsWith(BOM)) line = line.slice(1);
    firstLine = false;
    if (line === '') return true;
    lines += 1;
    if (line.startsWith(':')) {
      comments += 1;
      return false;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else fields += 1;
    return false;
  }

  /** Reads every complete line; a block ends at a blank line. A trailing CR waits for a possible LF. */
  function drain(final: boolean) {
    while (scan < buffer.length) {
      const code = buffer.charCodeAt(scan);
      if (code !== LF && code !== CR) {
        scan += 1;
        continue;
      }
      let end = scan + 1;
      if (code === CR) {
        if (end === buffer.length && !final) return;
        if (buffer.charCodeAt(end) === LF) end += 1;
      }
      const blank = readLine(buffer.slice(lineStart, scan));
      lineStart = scan = end;
      if (blank) emit(end);
    }
  }

  return {
    push(bytes, offsetMs) {
      if (ended) throw new Error('The frame reader has already ended');
      lastOffset = Math.max(lastOffset, offsetMs);
      append(decoder.decode(bytes, { stream: true }));
      drain(false);
    },
    end(subject = { type: 'exchange', id: exchangeId }) {
      if (ended) return;
      ended = true;
      append(decoder.decode());
      drain(true);
      if (buffer.length > 0) emit(buffer.length, true);
      if (!terminalSeen) {
        output.addFinding({
          id: `${exchangeId}:terminal`,
          kind: 'terminal',
          message: 'The stream ended without a valid RUN_FINISHED or RUN_ERROR event',
          subject,
        });
      }
    },
  };
}

const STREAM_ENDED = new Set(['completed', 'transport-error', 'user-stopped']);

/**
 * The recorder's sink for a session store: exchanges and findings go straight in, and each event
 * stream's chunks go through a frame reader into the same store. When an exchange's transport ends,
 * its reader ends too, before the store learns that the exchange is over, so a view that sees an
 * ended exchange sees all its frames. A missing terminal event is attached to the exchange's run
 * once that run is in the store, otherwise to the exchange.
 */
export function createFrameSink(store: SessionStore, options: FrameReaderOptions = {}): RecorderSink {
  const readers = new Map<ExchangeId, FrameReader>();
  // A reader whose output threw has lost its place; ending it would report a terminal event as
  // missing when the truth is that capture stopped, which the recorder reports on its own.
  const broken = new Set<ExchangeId>();
  const readerFor = (id: ExchangeId) => {
    let reader = readers.get(id);
    if (!reader) readers.set(id, (reader = createFrameReader(store, id, options)));
    return reader;
  };

  function endReader(id: ExchangeId) {
    const reader = readers.get(id);
    if (!reader) return;
    readers.delete(id);
    if (broken.delete(id)) return;
    const { exchanges, runs } = store.snapshot();
    const runId = exchanges.find((exchange) => exchange.id === id)?.runId;
    reader.end(runId !== undefined && runs.some((run) => run.id === runId) ? { type: 'run', id: runId } : { type: 'exchange', id });
  }

  return {
    appendExchange: (exchange) => store.appendExchange(exchange),
    addFinding: (finding) => store.addFinding(finding),
    appendChunk(id, bytes, offsetMs) {
      try {
        readerFor(id).push(bytes, offsetMs);
      } catch (error) {
        broken.add(id);
        throw error;
      }
    },
    updateExchange(id, patch) {
      // Only an event stream the recorder is draining reaches `streaming`, so an empty one still ends with a finding.
      if (patch.transport === 'streaming') readerFor(id);
      try {
        if (patch.transport !== undefined && STREAM_ENDED.has(patch.transport)) endReader(id);
      } finally {
        store.updateExchange(id, patch);
      }
    },
  };
}
