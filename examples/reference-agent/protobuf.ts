// Protobuf answers for the scripted agents (spec 013). A scenario producer stays header-free and writes server-sent
// events; an adapter that sees the request ask for protobuf turns that answer into binary frames here, chunk for
// chunk, so every scenario with a protobuf form is available in both encodings and its pacing carries over.
// A frame is what `EventEncoder.encodeProtobuf` writes in @ag-ui/encoder: a four-byte big-endian length, then the
// message from `encode` in @ag-ui/proto. A test feeds these bytes to the protocol client's own `parseProtoStream`,
// which proves the framing against upstream without adding the encoder as a dependency.
// The browser demo does not import this module. Environment-neutral: no Node, React or worker imports. Erasable
// TypeScript only, so Node can run it directly.
import type { BaseEvent } from '@ag-ui/core';
import { AGUI_MEDIA_TYPE, encode } from '@ag-ui/proto';
import type { ScenarioResponse } from './scenarios.ts';

export { AGUI_MEDIA_TYPE as PROTOBUF_MEDIA_TYPE };

const decoder = new TextDecoder();

/** One protobuf frame for an event: the length of the message as four big-endian bytes, then the message. */
export function frameProtobuf(event: object): Uint8Array {
  const message = encode(event as BaseEvent);
  const framed = new Uint8Array(4 + message.length);
  new DataView(framed.buffer).setUint32(0, message.length, false);
  framed.set(message, 4);
  return framed;
}

/**
 * The frame for an event that the schema rejects, as a damaged server would write it. `encode` warns on the console about
 * such an event and encodes it as given; the warning is silenced for this one call so a test run stays readable.
 */
export function frameInvalid(event: object): Uint8Array {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return frameProtobuf(event);
  } finally {
    console.warn = warn;
  }
}

/** The framing the producers write for server-sent events: `data:`, compact JSON on one line, a blank line. */
const SSE_FRAME = /^data: ([^\n]*)\n\n$/;

/**
 * The same response as protobuf frames. Status, delays, ending and pacing stay as they are, and each chunk becomes one
 * frame, so a paced response keeps its timing. A chunk that is not one well-formed `data:` frame (a wire fragment, or
 * text that is not JSON) has no protobuf form and throws.
 */
export function toProtobuf(response: ScenarioResponse): ScenarioResponse {
  const chunks = response.chunks.map((chunk, index) => {
    const match = SSE_FRAME.exec(decoder.decode(chunk));
    if (match === null) throw new Error(`Chunk ${index} is not one data frame, so it has no protobuf form`);
    try {
      return frameProtobuf(JSON.parse(match[1] as string));
    } catch (error) {
      throw new Error(`Chunk ${index} is not an event, so it has no protobuf form: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return { ...response, contentType: AGUI_MEDIA_TYPE, chunks };
}

/** Whether an `Accept` value lists the protobuf media type with a quality above zero, as `EventEncoder` reads it. */
export function acceptsProtobuf(accept: string | undefined): boolean {
  return (accept ?? '').split(',').some((entry) => {
    const [type, ...parameters] = entry.split(';').map((part) => part.trim().toLowerCase());
    if (type !== AGUI_MEDIA_TYPE) return false;
    const quality = parameters.find((parameter) => parameter.startsWith('q='));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}
