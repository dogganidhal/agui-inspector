// The frozen 5,000-frame benchmark fixture from plan.md ("Fixed 5,000-frame benchmark").
// Ten exchanges of 500 original SSE data frames, generated deterministically from SEED with
// synthetic text only. Nothing here reads the clock, the environment or the network.
//
//   node tests/benchmarks/generate.ts            print the fixture summary
//   node tests/benchmarks/generate.ts --write    rewrite manifest.json (a reviewed profile change)
//
// Only erasable TypeScript syntax and no imports beyond node:*, so Node runs this file directly.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export const SEED = '001';
export const EXCHANGE_COUNT = 10;
export const FRAMES_PER_EXCHANGE = 500;

export type FrameKind = 'valid' | 'non-json' | 'unknown-type' | 'schema-invalid';
export type LineEnding = 'LF' | 'CRLF' | 'CR';

export interface Frame {
  /** The event type for schema-valid frames, else NON_JSON, UNKNOWN_TYPE or SCHEMA_INVALID. */
  readonly type: string;
  readonly kind: FrameKind;
  /** The SSE data value: multiple data lines joined with a line feed. */
  readonly data: string;
  /** The exact framed text including the data field names and the blank-line terminator. */
  readonly envelope: string;
  readonly lineEnding: LineEnding;
  readonly dataLines: 1 | 2;
}

export interface Exchange {
  readonly index: number;
  readonly threadId: string;
  readonly runId: string;
  readonly frames: readonly Frame[];
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Event = { type: string; [key: string]: Json };

// ---- deterministic primitives ---------------------------------------------------------------

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: small, integer-only, identical on every platform. */
function random(seed: string) {
  let state = fnv1a(seed);
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (below: number) => Math.floor(next() * below);
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  return { int, shuffle };
}
type Random = ReturnType<typeof random>;

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text).length;
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const CODE_POINTS = Array.from('Synthetic wire sample é € 日本 😀 – ');

/** Repeated synthetic text of exactly `size` UTF-8 bytes, multibyte characters included. */
function utf8Text(size: number, salt = 0): string {
  let out = '';
  let used = 0;
  for (let i = salt; ; i++) {
    const char = CODE_POINTS[i % CODE_POINTS.length] as string;
    if (used + bytes(char) > size) break;
    out += char;
    used += bytes(char);
  }
  return out + 'x'.repeat(size - used);
}

/** ASCII filler of exactly `length` characters. */
const filler = (length: number) => 'synthetic-'.repeat(Math.ceil(length / 10)).slice(0, length);

/** A value whose JSON serialization is exactly `target` bytes; `build` receives the padding string. */
function sized<T extends Json>(target: number, build: (pad: string) => T): T {
  const value = build(filler(target - bytes(JSON.stringify(build('')))));
  const actual = bytes(JSON.stringify(value));
  if (actual !== target) throw new Error(`sized value is ${actual} bytes, wanted ${target}`);
  return value;
}

const num = (n: number, width: number) => String(n).padStart(width, '0');
/** Fixed-length identifiers: `kind-exchange-sequence`. */
const id = (kind: string, exchange: number, n: number) => `${kind}-${num(exchange, 2)}-${num(n, 3)}`;

/** Interleave lanes, keeping each lane's own order; a lane is drawn in proportion to what it has left. */
function weave(rand: Random, lanes: Event[][]): Event[] {
  const cursors = lanes.map(() => 0);
  const out: Event[] = [];
  for (let left = lanes.reduce((sum, lane) => sum + lane.length, 0); left > 0; left--) {
    let pick = rand.int(left);
    const lane = lanes.findIndex((events, i) => (pick -= events.length - (cursors[i] as number)) < 0);
    out.push(lanes[lane]?.[cursors[lane] as number] as Event);
    cursors[lane] = (cursors[lane] as number) + 1;
  }
  return out;
}

// ---- one exchange -----------------------------------------------------------------------------

const THREAD_ID = 'thr-001';
const CATALOG_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json';

/** Exchange outcomes: eight RUN_FINISHED (success, interrupt, cancelled) and two RUN_ERROR. */
const OUTCOMES = ['success', 'success', 'interrupt', 'cancelled', 'error', 'success', 'interrupt', 'cancelled', 'success', 'error'] as const;

function validEvents(x: number, rand: Random): Event[] {
  const runId = id('run', x, 0);
  const msgs = { n: 0 };
  const message = () => id('msg', x, msgs.n++);
  const call = (n: number) => id('tcl', x, n);

  // Six turns: two live text messages and one tool call whose arguments stream between their content.
  const turns = Array.from({ length: 6 }, (_, t): Event[] => {
    const a = message();
    const b = message();
    const toolCallId = call(t);
    const fragments = t < 4 ? 7 : 6;
    const args = JSON.stringify({ query: filler(fragments * 256 - 12) });
    const text = (messageId: string, contents: number): Event[] => [
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      ...Array.from({ length: contents }, (_, i): Event => ({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: utf8Text(128, t * 31 + i) })),
      { type: 'TEXT_MESSAGE_END', messageId },
    ];
    const tool: Event[] = [
      { type: 'TOOL_CALL_START', toolCallId, toolCallName: 'search_documents', parentMessageId: a },
      ...Array.from({ length: fragments }, (_, i): Event => ({ type: 'TOOL_CALL_ARGS', toolCallId, delta: args.slice(i * 256, (i + 1) * 256) })),
      { type: 'TOOL_CALL_END', toolCallId },
      { type: 'TOOL_CALL_RESULT', messageId: id('tlm', x, t), toolCallId, content: utf8Text(2048, t), role: 'tool' },
    ];
    const [aStart, ...aRest] = text(a, t < 4 ? 19 : 18);
    return [aStart as Event, ...weave(rand, [aRest, text(b, 18), tool])];
  });

  const spans = Array.from({ length: 4 }, (_, r): Event[] => {
    const messageId = id('rsn', x, r);
    return [
      { type: 'REASONING_START', messageId },
      { type: 'REASONING_MESSAGE_START', messageId, role: 'reasoning' },
      ...Array.from({ length: 15 }, (_, i): Event => ({ type: 'REASONING_MESSAGE_CONTENT', messageId, delta: utf8Text(128, r * 17 + i) })),
      ...(r < 2 ? [{ type: 'REASONING_ENCRYPTED_VALUE', subtype: 'message', entityId: messageId, encryptedValue: filler(4096).replace(/-/g, 'A') } as Event] : []),
      { type: 'REASONING_MESSAGE_END', messageId },
      { type: 'REASONING_END', messageId },
    ];
  });

  const reasoningChunks = Array.from({ length: 2 }, (_, r): Event[] => {
    const messageId = id('rsn', x, 4 + r);
    return Array.from({ length: 3 }, (_, i): Event => ({ type: 'REASONING_MESSAGE_CHUNK', messageId, delta: utf8Text(512, r * 5 + i) }));
  });

  const textChunks = Array.from({ length: 4 }, (_, c): Event[] => {
    const messageId = message();
    return Array.from({ length: 5 }, (_, i): Event =>
      i === 0
        ? { type: 'TEXT_MESSAGE_CHUNK', messageId, role: 'assistant', delta: utf8Text(512, c * 7 + i) }
        : { type: 'TEXT_MESSAGE_CHUNK', messageId, delta: utf8Text(512, c * 7 + i) },
    );
  });

  const toolChunks = Array.from({ length: 8 }, (_, c): Event[] => [
    { type: 'TOOL_CALL_CHUNK', toolCallId: call(6 + c), toolCallName: 'fetch_resource', delta: JSON.stringify({ resource: filler(1024 - 15) }) },
  ]);

  const states = Array.from({ length: 2 }, (_, s): Event[] => [
    { type: 'STATE_SNAPSHOT', snapshot: sized(16384, (pad) => ({ round: s, pad })) },
    ...Array.from({ length: 10 }, (_, d): Event => ({
      type: 'STATE_DELTA',
      delta: sized(2048, (pad) => [{ op: 'add', path: '/round', value: s * 10 + d }, { op: 'add', path: '/pad', value: pad }]),
    })),
  ]);

  const snapshots = Array.from({ length: 2 }, (_, s): Event[] => {
    const user = message();
    const assistant = message();
    return [{
      type: 'MESSAGES_SNAPSHOT',
      messages: sized(16384, (pad) => [
        { id: user, role: 'user', content: 'Synthetic request' },
        { id: assistant, role: 'assistant', content: pad },
      ]),
    }];
  });

  // Four activities: two ordinary, two A2UI v0.9 surfaces (5/5/4/4 deltas).
  const activities = Array.from({ length: 4 }, (_, a): Event[] => {
    const messageId = id('act', x, a);
    const a2ui = a >= 2;
    const activityType = a2ui ? 'a2ui-surface' : 'synthetic-progress';
    const surfaceId = id('srf', x, a);
    const content = sized(16384, (pad): Json => a2ui
      ? {
          a2ui_operations: [
            { version: 'v0.9', createSurface: { surfaceId, catalogId: CATALOG_ID } },
            {
              version: 'v0.9',
              updateComponents: {
                surfaceId,
                components: [
                  { id: 'root', component: 'Column', children: ['label'] },
                  { id: 'label', component: 'Text', text: 'Synthetic surface' },
                ],
              },
            },
          ],
          pad,
        }
      : { title: 'Synthetic progress', pad });
    return [
      { type: 'ACTIVITY_SNAPSHOT', messageId, activityType, content, replace: true },
      ...Array.from({ length: a2ui ? 4 : 5 }, (_, d): Event => ({
        type: 'ACTIVITY_DELTA',
        messageId,
        activityType,
        patch: sized(2048, (pad) => [{ op: 'add', path: '/revision', value: d }, { op: 'add', path: '/pad', value: pad }]),
      })),
    ];
  });

  // Two subagents; in odd exchanges the second one fails (5 SUBAGENT_ERROR over the run).
  const subagents = Array.from({ length: 2 }, (_, j): Event[] => {
    const subagentRunId = id('sub', x, j);
    const failed = x % 2 === 1 && j === 1;
    return [
      { type: 'SUBAGENT_STARTED', subagentRunId, name: 'synthetic-researcher', description: 'Synthetic delegated task', parentToolCallId: call(j) },
      { type: 'CUSTOM', subagentRunId, name: 'synthetic.custom', value: sized(4096, (pad) => ({ note: 'synthetic custom value', pad })) },
      { type: 'RAW', subagentRunId, source: 'synthetic', event: sized(4096, (pad) => ({ provider: 'synthetic', pad })) },
      failed
        ? { type: 'SUBAGENT_ERROR', subagentRunId, message: utf8Text(128, 3), code: 'synthetic_failure' }
        : { type: 'SUBAGENT_FINISHED', subagentRunId, result: { summary: utf8Text(64, j) }, outcome: { type: 'success' } },
    ];
  });

  const segments = rand.shuffle([...turns, ...spans, ...reasoningChunks, ...textChunks, ...toolChunks, ...states, ...snapshots, ...activities, ...subagents]);

  // Ten steps wrap consecutive segments (34 segments: four groups of four, six of three).
  const body: Event[] = [];
  for (let step = 0, from = 0; step < 10; step++) {
    const stepName = `step-${num(x, 2)}-${num(step, 2)}-synthetic-step-name-`.padEnd(32, '-').slice(0, 32);
    const size = step < 4 ? 4 : 3;
    body.push({ type: 'STEP_STARTED', stepName }, ...segments.slice(from, from + size).flat(), { type: 'STEP_FINISHED', stepName });
    from += size;
  }

  const outcome = OUTCOMES[x] as (typeof OUTCOMES)[number];
  const terminal: Event =
    outcome === 'error'
      ? { type: 'RUN_ERROR', message: utf8Text(128, 1), code: 'synthetic_error' }
      : {
          type: 'RUN_FINISHED',
          threadId: THREAD_ID,
          runId,
          outcome:
            outcome === 'success'
              ? { type: 'success' }
              : outcome === 'cancelled'
                ? { type: 'cancelled' }
                : {
                    type: 'interrupt',
                    interrupts: [{
                      id: id('int', x, 0),
                      reason: 'approval_required',
                      message: 'Synthetic approval request',
                      responseSchema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] },
                    }],
                  },
          ...(outcome === 'success' ? { result: { summary: utf8Text(64, x) } } : {}),
        };
  return [{ type: 'RUN_STARTED', threadId: THREAD_ID, runId }, ...body, terminal];
}

interface Raw { type: string; kind: FrameKind; data: string }

/** The ten invalid frames of an exchange: 4 non-JSON, 3 unknown type, 3 known type with a wrong field. */
function invalidFrames(x: number, rand: Random): Raw[] {
  const kinds = rand.shuffle(['non-json', 'non-json', 'non-json', 'non-json', 'unknown-type', 'unknown-type', 'unknown-type', 'schema-invalid', 'schema-invalid', 'schema-invalid'] as const);
  const seen = { 'non-json': 0, 'unknown-type': 0, 'schema-invalid': 0 };
  return kinds.map((kind): Raw => {
    const variant = seen[kind]++;
    if (kind === 'non-json') {
      const prefix = [
        `{"type":"TEXT_MESSAGE_CONTENT","messageId":"${id('msg', x, 900 + variant)}","delta":"`,
        'not json at all: ',
        '{"type":"STATE_DELTA","delta":[{"op":"add","path":"/a","value":',
        '{"type":"CUSTOM"} trailing text: ',
      ][variant % 4] as string;
      return { type: 'NON_JSON', kind, data: prefix + utf8Text(1024 - bytes(prefix), variant) };
    }
    if (kind === 'unknown-type') {
      const type = ['SYNTHETIC_FUTURE_EVENT_A', 'SYNTHETIC_FUTURE_EVENT_B', 'SYNTHETIC_FUTURE_EVENT_C'][variant % 3] as string;
      return { type: 'UNKNOWN_TYPE', kind, data: JSON.stringify(sized(1024, (pad) => ({ type, sequence: variant, pad }))) };
    }
    const wrong: Array<(pad: string) => Json> = [
      (pad) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId: id('msg', x, 900 + variant), delta: 12345, pad }),
      (pad) => ({ type: 'TOOL_CALL_ARGS', toolCallId: 6789, delta: 'synthetic', pad }),
      (pad) => ({ type: 'STEP_STARTED', stepName: false, pad }),
    ];
    return { type: 'SCHEMA_INVALID', kind, data: JSON.stringify(sized(1024, wrong[variant % 3] as (pad: string) => Json)) };
  });
}

const EOL: Record<LineEnding, string> = { LF: '\n', CRLF: '\r\n', CR: '\r' };

function buildExchange(x: number): Exchange {
  const rand = random(`${SEED}:${x}`);
  const events = validEvents(x, rand);
  const valid = events.map((event): Raw => ({ type: event.type, kind: 'valid', data: JSON.stringify(event) }));

  // Spread the ten invalid frames over the interior gaps; the first and last frames stay run boundaries.
  const gaps = rand.shuffle(Array.from({ length: valid.length - 1 }, (_, i) => i + 1)).slice(0, 10).sort((a, b) => a - b);
  const invalid = invalidFrames(x, rand);
  const order: Raw[] = [];
  valid.forEach((frame, i) => {
    const gap = gaps.indexOf(i);
    if (gap >= 0) order.push(invalid[gap] as Raw);
    order.push(frame);
  });

  const endings = rand.shuffle([...Array<LineEnding>(300).fill('LF'), ...Array<LineEnding>(150).fill('CRLF'), ...Array<LineEnding>(50).fill('CR')]);
  let ordinal = 0;
  const frames = order.map((raw, i): Frame => {
    const lineEnding = endings[i] as LineEnding;
    const eol = EOL[lineEnding];
    if (raw.kind === 'valid') ordinal++;
    // Every tenth schema-valid frame splits its JSON after the first member, where whitespace is legal.
    const split = raw.kind === 'valid' && ordinal % 10 === 0 ? raw.data.indexOf(',"') + 1 : 0;
    const lines = split > 0 ? [raw.data.slice(0, split), raw.data.slice(split)] : [raw.data];
    return {
      type: raw.type,
      kind: raw.kind,
      data: lines.join('\n'),
      envelope: lines.map((line) => `data: ${line}${eol}`).join('') + eol,
      lineEnding,
      dataLines: lines.length === 2 ? 2 : 1,
    };
  });
  return { index: x, threadId: THREAD_ID, runId: id('run', x, 0), frames };
}

export function generateFixture(): Exchange[] {
  return Array.from({ length: EXCHANGE_COUNT }, (_, x) => buildExchange(x));
}

// ---- manifest ---------------------------------------------------------------------------------

const countTypes = (frames: readonly Frame[]) => {
  const counts: Record<string, number> = {};
  for (const frame of frames) counts[frame.type] = (counts[frame.type] ?? 0) + 1;
  return counts;
};

/**
 * Ordered counts, exact serialized byte lengths and SHA-256 hashes. A frame row reads
 * `TYPE dataBytes envelopeBytes`; `sha256` hashes the exchange's wire bytes (all envelopes in order)
 * and `dataSha256` hashes each frame's data text followed by a line feed.
 */
export function buildManifest(fixture: readonly Exchange[]) {
  const all = fixture.flatMap((exchange) => exchange.frames);
  const wire = fixture.map((exchange) => exchange.frames.map((frame) => frame.envelope).join(''));
  const lineEndings = { LF: 0, CRLF: 0, CR: 0 };
  for (const frame of all) lineEndings[frame.lineEnding]++;
  return {
    profile: 'fixed-5000-frame benchmark, plan.md',
    seed: SEED,
    frameCount: all.length,
    schemaValidFrames: all.filter((frame) => frame.kind === 'valid').length,
    invalidFrames: all.filter((frame) => frame.kind !== 'valid').length,
    multilineFrames: all.filter((frame) => frame.dataLines === 2).length,
    lineEndings,
    wireBytes: wire.reduce((sum, text) => sum + bytes(text), 0),
    sha256: sha256(wire.join('')),
    typeCounts: countTypes(all),
    exchanges: fixture.map((exchange, i) => ({
      index: exchange.index,
      threadId: exchange.threadId,
      runId: exchange.runId,
      terminal: (exchange.frames.at(-1) as Frame).type,
      frameCount: exchange.frames.length,
      wireBytes: bytes(wire[i] as string),
      sha256: sha256(wire[i] as string),
      dataSha256: sha256(exchange.frames.map((frame) => `${frame.data}\n`).join('')),
      typeCounts: countTypes(exchange.frames),
      frames: exchange.frames.map((frame) => `${frame.type} ${bytes(frame.data)} ${bytes(frame.envelope)}`),
    })),
  };
}

export const serializeManifest = (manifest: ReturnType<typeof buildManifest>) => `${JSON.stringify(manifest, null, 2)}\n`;

if (path.basename(process.argv[1] ?? '') === 'generate.ts') {
  const manifest = buildManifest(generateFixture());
  if (process.argv.includes('--write')) {
    writeFileSync(path.join(import.meta.dirname, 'manifest.json'), serializeManifest(manifest));
    console.log('wrote tests/benchmarks/manifest.json');
  }
  console.log(`${manifest.frameCount} frames (${manifest.schemaValidFrames} schema-valid, ${manifest.invalidFrames} invalid), ${manifest.wireBytes} bytes, sha256 ${manifest.sha256}`);
}
