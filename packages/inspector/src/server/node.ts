// The bridge between `node:http` and the web-standard `Request` and `Response` that the core speaks. Express uses it, and
// so will the command line tool. The contract is specs/006-js-server-helpers/contracts/internal-core.md.
import type { IncomingMessage, ServerResponse } from 'node:http';

// `new Request` refuses these methods. The core answers any method it does not serve with 405, so OPTIONS stands in.
const REFUSED_BY_REQUEST = new Set(['CONNECT', 'TRACE', 'TRACK']);

/**
 * The `Request` for a `node:http` message. Only the method and the URL carry over: the inspector reads no header and
 * no body, and `Request` rejects some header values that a raw message can hold. Express sets `originalUrl` to the
 * address the client used, while `url` is relative to the mount, so `originalUrl` wins when it is there.
 */
export function toRequest(message: IncomingMessage & { originalUrl?: string }): Request {
  const method = (message.method ?? 'GET').toUpperCase();
  const target = message.originalUrl ?? message.url ?? '/';
  // A target that starts with `//` is a path here, not a host. Only an absolute-form target (`http://host/path`, which
  // proxies send) names a host, and the helpers read only the path and the query of it.
  const url = target.startsWith('/') ? new URL(`http://localhost${target}`) : new URL(target, 'http://localhost');
  return new Request(url, { method: REFUSED_BY_REQUEST.has(method) ? 'OPTIONS' : method });
}

/**
 * Writes the status, the headers and the whole body. The inspector's bodies are small, so one buffer gives a plain
 * `Content-Length`. For a HEAD request Node drops the body and keeps the headers.
 */
export async function sendResponse(response: Response, serverResponse: ServerResponse): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers);
  headers['content-length'] ??= String(body.byteLength);
  serverResponse.writeHead(response.status, headers);
  serverResponse.end(body);
}
