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
import { EventType, type AgentCapabilities } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { decode } from '@ag-ui/proto';
import type {
  ExchangeId,
  FindingSubject,
  JsonValue,
  JsonVerdict,
  RawFrame,
  SchemaVerdict,
  SessionStore,
} from '../../contracts.ts';
import type { RecorderSink } from '../recorder/index.ts';
import { kindOf, type CatalogueRuleId } from '../rules/catalogue.ts';
import { capabilityRules, upgradeFrame, type RuleHit } from '../rules/frame-rules.ts';
import { toBase64 } from './bytes.ts';

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
  /**
   * What the selected agent declares. The reader asks once, when the stream starts, so a stream is judged against
   * one declaration. Nothing declared, or a provider that throws, means no capability findings.
   */
  readonly declared?: () => AgentCapabilities | undefined;
}

interface Judgement {
  readonly verdict: SchemaVerdict;
  readonly problems: readonly string[];
  /** The check itself threw, so `problems` is the inspector's own note and not the schema's. */
  readonly unexpected: boolean;
}

type FrameBase = Pick<RawFrame, 'id' | 'exchangeId' | 'index' | 'envelope' | 'offsetMs' | 'provenance'>;

/** What a data frame holds as received: the text of a server-sent event, or the bytes of a binary frame. */
type Received = { readonly data: string } | { readonly bytes: string };

/**
 * The judging step both readers end in: the schema check, the rules, the frame and its findings, and the terminal
 * tracking. A parsed (or decoded) value is judged; no value means the data could not be parsed. Sharing it means a rule
 * added here applies to a protobuf frame as it does to a server-sent event.
 */
function createJudge(output: FrameOutput, options: FrameReaderOptions) {
  const check = options.check ?? checkEvent;
  let declared: AgentCapabilities | undefined;
  // A provider that throws costs no frame: it is reported on the first frame the rules read, once.
  let ruleFailure: string | undefined;
  try {
    declared = options.declared?.();
  } catch (error) {
    ruleFailure = error instanceof Error ? error.name : 'error';
  }
  let terminalSeen = false;

  /** The schema check, which must not cost the frame when it throws: the frame is retained, marked invalid, and reading goes on. */
  function judge(value: unknown): Judgement {
    try {
      const { verdict, problems } = check(value);
      return { verdict, problems, unexpected: false };
    } catch (error) {
      return { verdict: 'invalid', problems: [`Schema validation failed unexpectedly (${error instanceof Error ? error.name : 'error'})`], unexpected: true };
    }
  }

  return {
    terminalSeen: () => terminalSeen,
    appendEvent(base: FrameBase, content: Received, parsed: JsonValue | undefined, jsonVerdict: JsonVerdict) {
      const rawType = asObject(parsed)?.type;
      const eventType = typeof rawType === 'string' ? rawType : undefined;
      // `received` is what the baseline schema says about the data as it arrived, and it is the frame's verdict.
      const received: Judgement = parsed !== undefined ? judge(parsed) : { verdict: 'not-applicable', problems: [], unexpected: false };

      // The rules read the parsed value and add findings beside the frame. A frame that the client accepts after its
      // own upgrade is judged as upgraded, and an event that the client would count as finished counts as terminal.
      // A rule step that throws costs no frame: the received verdict stands, and the failure is a finding.
      let judged = received;
      let judgedType = eventType;
      let hits: readonly RuleHit[] = [];
      if (parsed !== undefined) {
        try {
          const upgraded = upgradeFrame(parsed);
          if (upgraded.value !== parsed) {
            judged = judge(upgraded.value);
            const upgradedType = asObject(upgraded.value)?.type;
            judgedType = typeof upgradedType === 'string' ? upgradedType : eventType;
          }
          hits = [...upgraded.hits, ...capabilityRules(parsed, declared)];
        } catch (error) {
          judged = received;
          judgedType = eventType;
          hits = [];
          ruleFailure ??= error instanceof Error ? error.name : 'error';
        }
      }

      const frame: RawFrame = {
        ...base,
        classification: 'data',
        ...content,
        ...(eventType !== undefined && { eventType }),
        summary: summarize(jsonVerdict, parsed, eventType),
        jsonVerdict,
        schemaVerdict: received.verdict,
        ...(parsed !== undefined && { parsed }),
      };
      if (judged.verdict === 'valid' && judgedType !== undefined && TERMINAL_TYPES.has(judgedType)) terminalSeen = true;
      output.appendFrame(frame);

      // A frame can have several findings. The first keeps the id it had in 0.1.0; later ones count up from 2.
      const subject = { type: 'frame', id: frame.id } as const;
      let findings = 0;
      const finding = (rule: CatalogueRuleId, message: string) => {
        findings += 1;
        output.addFinding({ id: `${frame.id}:finding${findings === 1 ? '' : `-${findings}`}`, kind: kindOf(rule), rule, message, subject });
      };
      if (jsonVerdict === 'invalid') finding('json.invalid', 'Data is not valid JSON');
      else if (judged.verdict === 'unknown-type') finding('schema.unknown-event-type', `${judged.problems[0]}; it is not in the supported baseline`);
      else if (judged.verdict === 'invalid') finding(judged.unexpected ? 'schema.check-failed' : 'schema.invalid-event', judged.unexpected ? (judged.problems[0] as string) : `Does not match the AG-UI event schema: ${judged.problems.join('; ')}`);
      for (const hit of hits) finding(hit.rule, hit.message);
      if (ruleFailure !== undefined) {
        finding('capture.rule-check-failed', `A rule check failed unexpectedly (${ruleFailure}). The frame was kept and read`);
        ruleFailure = undefined;
      }
    },
  };
}

const LF = 10;
const CR = 13;
const BOM = '﻿';

export function createFrameReader(output: FrameOutput, exchangeId: ExchangeId, options: FrameReaderOptions = {}): FrameReader {
  const judge = createJudge(output, options);
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

  function appendDataFrame(base: FrameBase, text: string) {
    let parsed: JsonValue | undefined;
    let jsonVerdict: JsonVerdict = 'valid';
    try {
      parsed = JSON.parse(text) as JsonValue;
    } catch {
      jsonVerdict = 'invalid';
    }
    judge.appendEvent(base, { data: text }, parsed, jsonVerdict);
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
      if (!judge.terminalSeen()) {
        output.addFinding({
          id: `${exchangeId}:terminal`,
          kind: 'terminal',
          rule: 'terminal.missing',
          message: 'The stream ended without a valid RUN_FINISHED or RUN_ERROR event',
          subject,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Protobuf frames
// ---------------------------------------------------------------------------------------------

/**
 * The most a frame may take, length prefix included. It mirrors `parseProtoStream` in @ag-ui/client 1.0.1, which fails
 * a larger frame, so the inspector flags what the client fails on. A pin test fails first if the client changes it.
 * The first four bytes of a text answer (`data: `) read as a length are far above it, which is how an answer in the
 * wrong encoding shows up.
 */
export const MAX_FRAME_BYTES = 10 * 1024 * 1024;

const LENGTH_BYTES = 4;

/**
 * The reader for an exchange read as protobuf (spec 013). A frame is a four-byte big-endian length and that many bytes.
 * It keeps each frame's bytes exactly as received, decodes the payload with the upstream decoder and hands the event to
 * the judging step the server-sent-events reader uses. The offset of a frame is that of the read that brought its last
 * byte. Like the other reader it judges and never edits: a frame that cannot be decoded is still a received frame, and
 * what cannot be read as frames is kept as bytes, never dropped.
 */
export function createProtobufFrameReader(output: FrameOutput, exchangeId: ExchangeId, options: FrameReaderOptions = {}): FrameReader {
  const judge = createJudge(output, options);
  // The bytes that are not yet a whole frame are `buffer[start..used]`. The buffer doubles when it is full and then moves
  // them to its start, so a large frame that arrives in many reads is not copied again for each one.
  let buffer = new Uint8Array(0);
  let start = 0;
  let used = 0;
  let lastOffset = 0;
  let frames = 0;
  let unreadable = false;
  let ended = false;

  const append = (bytes: Uint8Array) => {
    if (used + bytes.length > buffer.length) {
      const next = new Uint8Array(Math.max(buffer.length * 2, used - start + bytes.length, 256));
      next.set(buffer.subarray(start, used));
      buffer = next;
      used -= start;
      start = 0;
    }
    buffer.set(bytes, used);
    used += bytes.length;
  };

  const base = (): FrameBase => {
    const index = frames++;
    return { id: `${exchangeId}:frame-${index}`, exchangeId, index, envelope: '', offsetMs: lastOffset, provenance: 'raw' };
  };

  /** The one finding of a frame that holds no event. */
  const frameFinding = (frameId: string, rule: CatalogueRuleId, message: string) =>
    output.addFinding({ id: `${frameId}:finding`, kind: kindOf(rule), rule, message, subject: { type: 'frame', id: frameId } });

  /** A frame the judging step cannot take: it holds no event, so it has a verdict and one finding of its own. */
  function appendUnread(frameBase: FrameBase, bytes: string, schemaVerdict: SchemaVerdict, summary: string, rule: CatalogueRuleId, message: string) {
    output.appendFrame({ ...frameBase, classification: 'data', bytes, summary, jsonVerdict: 'not-applicable', schemaVerdict });
    frameFinding(frameBase.id, rule, message);
  }

  function emitFrame(whole: Uint8Array) {
    const frameBase = base();
    const bytes = toBase64(whole);
    let event: JsonValue;
    try {
      // JSON round trip: the event becomes inert JSON like a parsed server-sent event, or the frame is not decodable.
      event = JSON.parse(JSON.stringify(decode(whole.subarray(LENGTH_BYTES)))) as JsonValue;
    } catch (error) {
      if (error instanceof Error && error.name === 'AGUIUnknownEventTypeError') {
        return appendUnread(
          frameBase,
          bytes,
          'unknown-type',
          `Event from a later protocol (not decoded) · ${whole.length} bytes`,
          'schema.unknown-event-type',
          'Event type from a later protocol that this build does not know; it is not in the supported baseline',
        );
      }
      return appendUnread(
        frameBase,
        bytes,
        'not-applicable',
        `Not a decodable protobuf event · ${whole.length} bytes`,
        'binary.undecodable-frame',
        'The bytes are not a valid protobuf event, so no event could be read',
      );
    }
    judge.appendEvent(frameBase, { bytes }, event, 'not-applicable');
  }

  /** What is left when the stream ends: an unfinished frame, or everything after a frame no client reads. */
  function emitRest() {
    const frameBase = base();
    const rest = buffer.subarray(start, used);
    const bytes = toBase64(rest);
    const summary = unreadable ? `Bytes that cannot be read as length-prefixed frames · ${rest.length} bytes` : 'Incomplete frame at the end of the stream (never dispatched)';
    output.appendFrame({ ...frameBase, classification: 'partial', bytes, summary, jsonVerdict: 'not-applicable', schemaVerdict: 'not-applicable' });
    if (unreadable) {
      frameFinding(
        frameBase.id,
        'binary.unreadable-stream',
        'The stream states a frame larger than 10 MB, which no client reads. The rest of the stream is kept as raw bytes. A server that answers in another encoding than the one chosen looks like this',
      );
    }
  }

  return {
    push(bytes, offsetMs) {
      if (ended) throw new Error('The frame reader has already ended');
      lastOffset = Math.max(lastOffset, offsetMs);
      append(bytes);
      while (!unreadable && used - start >= LENGTH_BYTES) {
        const length = new DataView(buffer.buffer, buffer.byteOffset + start, LENGTH_BYTES).getUint32(0, false);
        if (LENGTH_BYTES + length > MAX_FRAME_BYTES) {
          // Nothing marks where the next frame begins, so splitting stops and every later byte is kept as it comes.
          unreadable = true;
          break;
        }
        if (used - start < LENGTH_BYTES + length) break;
        emitFrame(buffer.slice(start, start + LENGTH_BYTES + length));
        start += LENGTH_BYTES + length;
      }
      if (start === used) start = used = 0;
    },
    end(subject = { type: 'exchange', id: exchangeId }) {
      if (ended) return;
      ended = true;
      if (used > start) emitRest();
      if (!judge.terminalSeen()) {
        output.addFinding({
          id: `${exchangeId}:terminal`,
          kind: 'terminal',
          rule: 'terminal.missing',
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
  // The recorder reads no header. It tells the sink which exchanges it was asked to read as protobuf, and the rest are
  // server-sent events, as every exchange was before 0.2.0.
  const protobuf = new Set<ExchangeId>();
  // A reader whose output threw has lost its place; ending it would report a terminal event as
  // missing when the truth is that capture stopped, which the recorder reports on its own.
  const broken = new Set<ExchangeId>();
  const readerFor = (id: ExchangeId) => {
    let reader = readers.get(id);
    if (!reader) readers.set(id, (reader = (protobuf.has(id) ? createProtobufFrameReader : createFrameReader)(store, id, options)));
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
    appendExchange(exchange) {
      if (exchange.encoding === 'protobuf') protobuf.add(exchange.id);
      store.appendExchange(exchange);
    },
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
