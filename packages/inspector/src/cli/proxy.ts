// The relay (feature 005): one request from the page to one target, with the bytes of both bodies untouched.
//
// Bodies are streams. Nothing is buffered to its end, parsed, decoded or decompressed, so the page records what the
// target sent, a chunk at a time and in order. The connection goes to the host and port of the target, never to
// anything taken from the request, so no spelling of the path can reach another host. `fetch` is not used because it
// decompresses and hides the raw headers; `agent: false` gives each request its own connection, so the timing of a
// stream never depends on a pooled socket.
import { request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pipeline } from 'node:stream';
import type { Target } from './args.ts';

/** Writes one line to the command's standard error. */
export type Log = (line: string) => void;

// Headers that belong to one connection, not to the message (RFC 9110 section 7.6.1). The relay ends them.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
// The page's own: the target gets its own `Host`, and the browser's cookies for localhost and the page's origin are not
// the target's business (the page shares `localhost` cookies with every other local application).
const NOT_FORWARDED = new Set(['host', 'cookie', 'origin', 'referer']);

/** A short plain text answer. The relay's own answers are never a page. */
export function plain(response: ServerResponse, status: number, text: string): void {
  if (response.headersSent || response.destroyed) return void response.destroy();
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': String(Buffer.byteLength(text)) });
  response.end(text);
}

const listed = (value: string | undefined): string[] => (value ?? '').toLowerCase().split(',').map((name) => name.trim()).filter((name) => name !== '');

/** The headers for the target: the page's, minus what is not forwarded, then the held ones the page did not send. */
function outboundHeaders(request: IncomingMessage, target: Target): Record<string, string | string[]> {
  const named = new Set(listed(request.headers.connection));
  const headers: Record<string, string | string[]> = {};
  for (const [name, values] of Object.entries(request.headersDistinct)) {
    if (values === undefined || HOP_BY_HOP.has(name) || NOT_FORWARDED.has(name) || named.has(name)) continue;
    headers[name] = values.length === 1 ? (values[0] as string) : values;
  }
  // The page's value wins: a developer who types a wrong token in the page wants the server's answer to that token.
  for (const [lower, held] of target.headers) if (!(lower in headers)) headers[held.name] = held.value;
  return headers;
}

/** The target's headers as a flat list in their order and case, without hop-by-hop headers and `Set-Cookie`. */
function inboundHeaders(answer: IncomingMessage): string[] {
  const named = new Set(listed(answer.headers.connection));
  const headers: string[] = [];
  for (let i = 0; i + 1 < answer.rawHeaders.length; i += 2) {
    const name = answer.rawHeaders[i] as string;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'set-cookie' || named.has(lower)) continue;
    headers.push(name, answer.rawHeaders[i + 1] as string);
  }
  return headers;
}

/** The error code, if it is a plain code. Never a message: a message can quote the request. */
const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'ERROR';
};

/**
 * Relays `request` to `target` as `path` (the text after the proxy number, with the query, exactly as received) and
 * streams the answer to `response`. Before the target answers, a failure is a 502 that names the target's origin and
 * an error code, and one line in `log`. After the headers, a failure destroys the page's connection, so the page sees
 * a cut stream and never a complete one. When the page goes away, the connection to the target is closed.
 */
export function relay(request: IncomingMessage, response: ServerResponse, target: Target, path: string, log: Log): void {
  let upstream: ClientRequest;
  try {
    upstream = (target.tls ? httpsRequest : httpRequest)({
      host: target.host,
      port: target.port,
      path,
      method: request.method,
      headers: outboundHeaders(request, target),
      agent: false,
    });
  } catch {
    // Node refuses a path with a space or a control character, and a header value it cannot send.
    return plain(response, 400, 'agui-inspector refused this request');
  }
  upstream.setNoDelay(true);

  upstream.once('response', (answer) => {
    response.writeHead(answer.statusCode ?? 502, answer.statusMessage, inboundHeaders(answer));
    response.flushHeaders();
    pipeline(answer, response, () => {});
  });
  upstream.on('error', (error) => {
    // After the headers, `pipeline` has already destroyed the page's connection.
    if (response.headersSent) return;
    const what = `could not reach ${target.origin} (${codeOf(error)})`;
    log(`agui-inspector: ${what}`);
    plain(response, 502, `agui-inspector ${what}`);
  });
  response.once('close', () => {
    if (!response.writableFinished) upstream.destroy();
  });
  // `pipe` and not `pipeline`: a failed target must not destroy the page's socket before the 502 is written.
  request.pipe(upstream);
}
