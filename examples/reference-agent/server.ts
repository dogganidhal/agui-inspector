// Loopback, model-free AG-UI fixture server for tests. Run: node examples/reference-agent/server.ts
//   --port <n>            listen port (default 8787; 0 picks a free one)
//   --allow-origin <url>  the single cross-origin page allowed to call it (default: none)
// It binds 127.0.0.1 only, grants CORS to exactly one origin and never sets credentials headers.
// /agent never echoes request headers; /credential-echo does, in one known frame, on purpose (D03).
// /agent answers in protobuf when the request's Accept lists the AG-UI protobuf media type, and in server-sent
// events otherwise, the way a server written with EventEncoder does.
// Prints one JSON line, {"url": "..."}, when ready.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { credentialEchoBody, credentialOf } from './credential-echo.ts';
import { acceptsProtobuf, toProtobuf } from './protobuf.ts';
import { referenceRunResponse } from './scenarios.ts';

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
}

const allowedOrigin = option('--allow-origin', '');

function cors(request: IncomingMessage, response: ServerResponse): void {
  if (allowedOrigin !== '' && request.headers.origin === allowedOrigin) {
    response.setHeader('access-control-allow-origin', allowedOrigin);
    response.setHeader('vary', 'Origin');
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  let text = '';
  for await (const chunk of request) text += String(chunk);
  return text;
}

const server = createServer(async (request, response) => {
  cors(request, response);
  const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');

  if (pathname === '/health' && request.method === 'GET') return json(response, 200, { ok: true });
  if (pathname !== '/agent' && pathname !== '/credential-echo') return json(response, 404, { error: 'not found' });

  if (request.method === 'OPTIONS') {
    if (response.hasHeader('access-control-allow-origin')) {
      response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
      response.setHeader('access-control-allow-headers', String(request.headers['access-control-request-headers'] ?? 'content-type'));
    }
    response.writeHead(204);
    return void response.end();
  }
  if (request.method !== 'POST') return json(response, 405, { error: 'method not allowed' });

  let input: { threadId?: unknown; runId?: unknown };
  try {
    input = JSON.parse(await readBody(request));
  } catch {
    return json(response, 400, { error: 'request body is not valid JSON' });
  }
  if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
    return json(response, 422, { error: 'threadId and runId must be strings' });
  }

  const { threadId, runId } = input;
  if (pathname === '/credential-echo') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    return void response.end(credentialEchoBody(threadId, runId, credentialOf(request.headers)));
  }
  const sse = referenceRunResponse({ threadId, runId });
  const reply = acceptsProtobuf(request.headers.accept) ? toProtobuf(sse) : sse;
  response.writeHead(reply.status, { 'content-type': reply.contentType, 'cache-control': 'no-store' });
  for (const chunk of reply.chunks) response.write(chunk);
  response.end();
});

server.listen(Number(option('--port', '8787')), '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo;
  console.log(JSON.stringify({ url: `http://127.0.0.1:${port}` }));
});
