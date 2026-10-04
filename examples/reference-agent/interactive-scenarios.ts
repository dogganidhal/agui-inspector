// Deterministic, model-free scenarios for connecting and driving interactive runs (L02, US1 and US3).
// A loopback server that serves a test page's assets, answers preparation routes, and streams a
// scripted AG-UI run chosen by what the last user message says. It records the body of every
// preparation and run request in arrival order, so a test can compare what was recorded in the page
// with what actually crossed the wire.
//
// It records which credential headers and whether a cookie arrived, never their values, and it never
// echoes a header, a cookie or a token: a test that finds a token anywhere in the page therefore knows
// the page put it there. CORS is granted to exactly one origin when asked to, and credentials mode is
// never enabled, so a hosted page that sent cookies could not even read the answer.
// What the agent answers is chosen by the environment-neutral producer in scenarios.ts, which the
// browser demo's service worker shares; this adapter keeps the Node I/O, validation, CORS, request log,
// failure controls and open-stream accounting. A request whose Accept lists the AG-UI protobuf media type gets the
// same answer as protobuf frames (protobuf.ts), chunk for chunk, so every scenario with a protobuf form is served
// in both encodings; a scenario that has none (`broken`, which sends text that is not an event) answers 406. Runs arrive at wire speed, as tests expect, unless a test
// opts in to the demo's natural pacing (pacing.ts) with the `pace` option.
// Erasable TypeScript only, so Node can run it directly.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { deliver, pace, sleepOn, type PaceProfile } from './pacing.ts';
import { acceptsProtobuf, toProtobuf } from './protobuf.ts';
import { interactiveResponse, type RunInput } from './scenarios.ts';

export { INTERRUPT_FOREVER, INTERRUPTS, PLUGINS, SCENARIOS, SUBAGENTS } from './scenarios.ts';

/** A route that only answers with a redirect to the agent, to show that the page refuses to follow one. */
export const REDIRECT_PATH = '/redirect';

export interface RecordedRequest {
  readonly seq: number;
  readonly kind: 'preparation' | 'run';
  readonly method: string;
  readonly path: string;
  /** The parsed JSON body, or the raw text when it is not JSON. */
  readonly body: unknown;
  /** The body exactly as it arrived. */
  readonly text: string;
  /** Names among authorization, x-api-key, cookie that arrived. Never their values. */
  readonly credentials: readonly string[];
  /** The Accept header as it arrived: the encoding the page asked for. */
  readonly accept: string;
}

export interface InteractiveServer {
  readonly origin: string;
  /** Preparation and run requests, in the order they arrived. */
  requests(): readonly RecordedRequest[];
  /** Every request the server saw, including preflights and page assets. */
  paths(): readonly string[];
  /** Make later requests to this path answer with `status` until `clear`. */
  fail(path: string, status?: number): void;
  clear(): void;
  reset(): void;
  /** Connections to a held-open scenario (`never finishes`) that are open right now. */
  openStreams(): number;
  /** The bytes written for each run response so far, in order: what the page should have recorded. */
  sent(): readonly Uint8Array[];
  close(): Promise<void>;
}

export interface InteractiveOptions {
  /** Maps a path to its content type and text; served as given. */
  readonly assets?: Readonly<Record<string, readonly [contentType: string, body: string]>>;
  /** The one page origin granted CORS. */
  readonly allowOrigin?: string;
  /** Stream runs the way the public demo does, with this profile (`NATURAL_PACE` for the demo's; `SLOW_PACE` for `slow`'s). Off unless given. */
  readonly pace?: PaceProfile;
}

const concat = (chunks: readonly Uint8Array[]): Uint8Array => {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
};

const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'cookie'] as const;

const sleep = sleepOn();

export async function createInteractiveServer(options: InteractiveOptions = {}): Promise<InteractiveServer> {
  const recorded: RecordedRequest[] = [];
  const seen: string[] = [];
  const failures = new Map<string, number>();
  const written: Uint8Array[][] = [];
  let open = 0;

  const text = (response: ServerResponse, status: number, contentType: string, body: string) => {
    response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(body);
  };

  async function readBody(request: IncomingMessage): Promise<string> {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    return body;
  }

  function cors(request: IncomingMessage, response: ServerResponse): void {
    if (options.allowOrigin !== undefined && request.headers.origin === options.allowOrigin) {
      response.setHeader('access-control-allow-origin', options.allowOrigin);
      response.setHeader('vary', 'Origin');
    }
  }

  async function stream(request: IncomingMessage, response: ServerResponse, input: RunInput): Promise<void> {
    const reply = interactiveResponse(input);
    const paced = options.pace === undefined ? reply : pace(reply, options.pace);
    let answer = paced;
    if (acceptsProtobuf(request.headers.accept)) {
      try {
        answer = toProtobuf(paced);
      } catch (error) {
        return text(response, 406, 'application/json', JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      }
    }
    const body: Uint8Array[] = [];
    written.push(body);
    response.writeHead(answer.status, { 'content-type': answer.contentType, 'cache-control': 'no-store' });
    // The response closes when the client goes away; the request's own 'close' fires once its body is read.
    const gone = new AbortController();
    response.on('close', () => gone.abort());
    if (answer.ending === 'hold-until-abort') {
      open += 1;
      response.on('close', () => {
        open -= 1;
      });
    }
    const write = (chunk: Uint8Array) => {
      body.push(chunk);
      response.write(chunk);
    };
    if ((await deliver(answer, write, sleep, gone.signal)) && answer.ending === 'close') response.end();
  }

  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    seen.push(`${request.method} ${pathname}`);
    cors(request, response);

    if (request.method === 'OPTIONS') {
      if (response.hasHeader('access-control-allow-origin')) {
        response.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS');
        response.setHeader('access-control-allow-headers', String(request.headers['access-control-request-headers'] ?? 'content-type'));
      }
      response.writeHead(204);
      return void response.end();
    }
    if (pathname === REDIRECT_PATH) {
      response.writeHead(302, { location: '/agent' });
      return void response.end();
    }
    if (request.method === 'GET') {
      const asset = options.assets?.[pathname];
      return asset ? text(response, 200, asset[0], asset[1]) : text(response, 404, 'text/plain', 'not found');
    }

    const kind = pathname === '/agent' ? 'run' : pathname.startsWith('/prepare/') ? 'preparation' : undefined;
    if (!kind) return text(response, 404, 'application/json', '{"error":"not found"}');
    const body = await readBody(request);
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not JSON: keep the text, as a recorder would.
    }
    recorded.push({
      seq: recorded.length + 1,
      kind,
      method: request.method ?? '',
      path: pathname,
      body: parsed,
      text: body,
      credentials: CREDENTIAL_HEADERS.filter((name) => request.headers[name] !== undefined),
      accept: request.headers.accept ?? '',
    });

    const failure = failures.get(pathname);
    if (failure !== undefined) return text(response, failure, 'application/json', '{"error":"scripted failure"}');
    if (kind === 'preparation') return text(response, 200, 'application/json', '{"ok":true}');

    const input = parsed as Partial<RunInput> | null;
    if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
      return text(response, 422, 'application/json', JSON.stringify({ detail: 'threadId and runId must be strings' }));
    }
    return stream(request, response, input as RunInput);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: () => [...recorded],
    paths: () => [...seen],
    fail: (path, status = 500) => void failures.set(path, status),
    clear: () => failures.clear(),
    reset() {
      recorded.length = 0;
      written.length = 0;
      seen.length = 0;
      failures.clear();
    },
    openStreams: () => open,
    sent: () => written.map((chunks) => concat(chunks)),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
