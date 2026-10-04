// The protocol client's copy of an event stream, with every line ending written as LF.
//
// Valid server-sent events end a line with LF, CRLF or a bare CR. The pinned @ag-ui/client cuts events on two
// LF only, so a CRLF or CR stream fails in its parser: the client loses the run, and the next request carries
// neither the assistant's reply nor the updated state. The recorder has already cloned the response when this
// runs, so the recording keeps the server's bytes and the frame reader splits them itself. Only the client's
// branch changes, and only its line endings. CR and LF never occur inside a multibyte UTF-8 sequence, so the
// copy works on bytes without a decoder, and a JSON string cannot hold a raw CR or LF, so no value changes.
//
// Temporary, and an exception to "the client gets the original response" (website/content/docs/internals.mdx). Delete this
// file and its one call in index.ts when @ag-ui/client is bumped to the first release that contains
// ag-ui-protocol/ag-ui#2939 (website/content/docs/dependencies.mdx); the compatibility test that pins the old behaviour fails
// then. Ceilings: each chunk is copied once, and every successful answer is taken for an event stream, as the
// recorder does (no header is read). The runtime applies this to server-sent events only: a protobuf answer is
// binary, and its bytes are never rewritten (spec 013).

const LF = 0x0a;
const CR = 0x0d;

function lineEndingsToLf(): TransformStream<Uint8Array, Uint8Array> {
  // True right after a CR. That CR already went out as an LF, so an LF that comes next, even at the start
  // of the next chunk, is the other half of a CRLF and goes out as nothing.
  let afterCr = false;
  return new TransformStream({
    transform(chunk, controller) {
      const out = new Uint8Array(chunk.length);
      let length = 0;
      for (const byte of chunk) {
        if (byte === LF && afterCr) {
          afterCr = false;
          continue;
        }
        afterCr = byte === CR;
        out[length++] = byte === CR ? LF : byte;
      }
      if (length > 0) controller.enqueue(out.subarray(0, length));
    },
  });
}

/** An event-stream answer becomes a response over the LF copy of its body; any other answer is returned as it is. */
export function canonicalizeLineEndings(response: Response): Response {
  // Like the recorder, only a successful answer is an event stream: an error body is read by the client as text.
  if (!response.ok || response.body === null) return response;
  // The response is the init, so its status, status text and headers carry over; none of them is read here.
  return new Response(response.body.pipeThrough(lineEndingsToLf()), response);
}
