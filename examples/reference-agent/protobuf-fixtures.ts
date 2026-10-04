// Protobuf wire scenarios for the recorder, the frame reader and the end-to-end tests (spec 013): the complete
// baseline run, a failing run, and the same bytes cut in different ways. Model-free and offline. They are recorder
// scenarios like the other fixture files, so the bytes can be played through the recorder, the reader and the store,
// and a test server can send them with the media type each scenario announces.
// Each frame is a four-byte big-endian length and the message from @ag-ui/proto (protobuf.ts).
// Erasable TypeScript only, so Node can run it directly.
import { baselineRunTypes, eventFixtures, protocolScenarios } from './protocol-fixtures.ts';
import { frameInvalid, frameProtobuf, PROTOBUF_MEDIA_TYPE } from './protobuf.ts';
import { fragment, type RecorderScenario } from './recorder-fixtures.ts';

const json = JSON.stringify;

/** The request the recorder is told about: a conversation run that asks for protobuf. */
const conversation = {
  kind: 'conversation',
  method: 'POST',
  path: '/agent',
  body: json({ threadId: 't-proto', runId: 'r-proto', messages: [], state: {}, tools: [], context: [], forwardedProps: {} }),
  responseKind: 'protobuf',
} as const;

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

function scenario(name: string, chunks: readonly Uint8Array[]): RecorderScenario {
  return { name, request: conversation, status: 200, announcedContentType: PROTOBUF_MEDIA_TYPE, chunks, ending: 'close' };
}

/** One frame per event of the baseline run: thirty of the 31 types, in the order of `baselineRun` in protocol-fixtures.ts. */
export const baselineFrames: readonly Uint8Array[] = baselineRunTypes.map((type) => frameProtobuf(eventFixtures[type as keyof typeof eventFixtures]));

/** The one type that run leaves out: a run that fails. */
export const runErrorFrames: readonly Uint8Array[] = [frameProtobuf(eventFixtures.RUN_STARTED), frameProtobuf(eventFixtures.RUN_ERROR)];

const baselineBytes = concat(baselineFrames);

// ---- damaged frames (spec 013, user story 4) ---------------------------------------------------------------

/** A frame whose three payload bytes are not a protobuf event. */
export const garbageFrame = Uint8Array.from([0, 0, 0, 3, 0xff, 0xff, 0xff]);
/** An empty message: a complete frame of four bytes that cannot be decoded. */
export const zeroLengthFrame = Uint8Array.from([0, 0, 0, 0]);
/** An event from a later protocol: the envelope names a field (99) that this build does not know. The decoder says so. */
export const futureEventFrame = Uint8Array.from([0, 0, 0, 5, 0x9a, 0x06, 0x02, 0x08, 0x01]);
/** A text message start whose role is not one the protocol knows: it decodes, and the event schema rejects it. */
export const invalidEventFrame: Uint8Array = frameInvalid({ type: 'TEXT_MESSAGE_START', messageId: 'm-invalid', role: 'robot' });

/** The most a frame may take, length prefix included. A copy of the client's limit; a test pins the two together. */
export const LIMIT = 10 * 1024 * 1024;
/** A length prefix that makes the frame one byte over the limit, then the start of what it promises. */
export const oversizedPrefix = (): Uint8Array => {
  const prefix = new Uint8Array(4);
  new DataView(prefix.buffer).setUint32(0, LIMIT - 3, false);
  return prefix;
};

const started = frameProtobuf(eventFixtures.RUN_STARTED);
const finished = frameProtobuf(eventFixtures.RUN_FINISHED);
const stepStarted = frameProtobuf(eventFixtures.STEP_STARTED);
const stepFinished = frameProtobuf(eventFixtures.STEP_FINISHED);
const text = new TextEncoder();

/** A run with one frame above 4,096 bytes, which the frame detail cuts to its first 4,096. */
const largeFrames: readonly Uint8Array[] = [
  frameProtobuf(eventFixtures.RUN_STARTED),
  frameProtobuf({ ...eventFixtures.TEXT_MESSAGE_CONTENT, delta: 'x'.repeat(5000) }),
  frameProtobuf(eventFixtures.RUN_FINISHED),
];

export const protobufScenarios = {
  /** The baseline run cut into uneven pieces, so frames are split and joined by the network. */
  baselineRun: scenario('protobuf-baseline-run', fragment(baselineBytes, [1, 7, 64, 4096])),
  /** `RUN_STARTED` then `RUN_ERROR`. */
  runError: scenario('protobuf-run-error', fragment(concat(runErrorFrames), [64])),
  /** The baseline cut into single bytes: every boundary is a split, including those inside a length prefix. */
  splitByByte: scenario('protobuf-split-by-byte', fragment(baselineBytes, [1])),
  /** One read for each frame. */
  evenFrames: scenario('protobuf-even-frames', baselineFrames),
  /** A frame of about 5,000 bytes between the run's start and its end. */
  largeFrame: scenario('protobuf-large-frame', largeFrames),
  /** A frame of garbage between valid frames: kept, flagged, and the run carries on. */
  undecodablePayload: scenario('protobuf-undecodable-payload', fragment(concat([started, garbageFrame, stepStarted, stepFinished, finished]), [5, 11])),
  /** An empty message in the middle of a run. */
  zeroLength: scenario('protobuf-zero-length', fragment(concat([started, zeroLengthFrame, finished]), [3])),
  /** An event that a later protocol added: the inspector keeps it, the protocol client drops it with a warning. */
  unknownEvent: scenario('protobuf-unknown-event', fragment(concat([started, futureEventFrame, finished]), [4])),
  /** An event that decodes and fails the event schema. */
  invalidEvent: scenario('protobuf-invalid-event', fragment(concat([started, invalidEventFrame, finished]), [9])),
  /** The stream ends inside a frame. */
  truncatedFrame: scenario('protobuf-truncated-frame', fragment(concat([started, stepStarted.slice(0, 9)]), [6])),
  /** The stream ends inside a length prefix. */
  truncatedLength: scenario('protobuf-truncated-length', fragment(concat([started, stepStarted.slice(0, 2)]), [6])),
  /** A frame one byte over the limit: from its length prefix to the end of the stream, nothing is split any more. */
  oversizedLength: scenario('protobuf-oversized-length', [concat([started, stepStarted, oversizedPrefix()]), text.encode('more bytes after the prefix '), text.encode('and a last piece')]),
  /** The server ignored the request for protobuf and answered with server-sent events: the bytes are text. */
  answeredInSse: {
    ...scenario('protobuf-answered-in-sse', protocolScenarios.runError.chunks),
    announcedContentType: 'text/event-stream',
  },
} as const satisfies Record<string, RecorderScenario>;
