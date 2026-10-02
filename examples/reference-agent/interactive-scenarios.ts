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
// Erasable TypeScript only, so Node can run it directly.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** What the last user message asks the agent to do. Anything else gets a plain reply. */
export const SCENARIOS = {
  interrupt: 'interrupt',
  tools: 'tools',
  slow: 'slow',
  state: 'state',
  broken: 'broken',
} as const;

/** A route that only answers with a redirect to the agent, to show that the page refuses to follow one. */
export const REDIRECT_PATH = '/redirect';

export const INTERRUPTS = [
  {
    id: 'i-approve',
    reason: 'approval',
    message: 'Approve the refund of 25.00?',
    responseSchema: { type: 'object', required: ['approved'], properties: { approved: { type: 'boolean' }, note: { type: 'string' } } },
  },
  { id: 'i-contact', reason: 'input', message: 'Which contact should the agent use?' },
] as const;

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
  /** Connections to the slow scenario that are open right now. */
  openStreams(): number;
  close(): Promise<void>;
}

export interface InteractiveOptions {
  /** Maps a path to its content type and text; served as given. */
  readonly assets?: Readonly<Record<string, readonly [contentType: string, body: string]>>;
  /** The one page origin granted CORS. */
  readonly allowOrigin?: string;
}

interface Input {
  threadId?: unknown;
  runId?: unknown;
  messages?: Array<{ role?: string; content?: unknown; toolCallId?: string }>;
  resume?: Array<{ interruptId: string; status: string; payload?: unknown }>;
  forwardedProps?: { a2uiAction?: { userAction?: { name?: string } } };
  state?: unknown;
}

const CREDENTIAL_HEADERS = ['authorization', 'x-api-key', 'cookie'] as const;

export async function createInteractiveServer(options: InteractiveOptions = {}): Promise<InteractiveServer> {
  const recorded: RecordedRequest[] = [];
  const seen: string[] = [];
  const failures = new Map<string, number>();
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

  const frame = (response: ServerResponse, event: object) => response.write(`data: ${JSON.stringify(event)}\n\n`);

  function lastUserText(input: Input): string {
    const users = (input.messages ?? []).filter((message) => message.role === 'user');
    const content = users.at(-1)?.content;
    return typeof content === 'string' ? content : '';
  }

  function stream(response: ServerResponse, input: Input): void {
    const threadId = String(input.threadId);
    const runId = String(input.runId);
    const started = { type: 'RUN_STARTED', threadId, runId };
    const finished = (outcome: object = { type: 'success' }) => ({ type: 'RUN_FINISHED', threadId, runId, outcome });
    const say = (messageId: string, delta: string) => [
      { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId, delta },
      { type: 'TEXT_MESSAGE_END', messageId },
    ];
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });

    const send = (events: object[], hold = false): void => {
      for (const event of events) frame(response, event);
      if (!hold) return void response.end();
      open += 1;
      // The response closes when the client goes away; the request's own 'close' fires once its body is read.
      response.on('close', () => {
        open -= 1;
      });
    };

    const message = lastUserText(input);
    const tools = (input.messages ?? []).filter((candidate) => candidate.role === 'tool');
    const action = input.forwardedProps?.a2uiAction?.userAction;

    if (input.resume !== undefined) {
      const answers = input.resume.map((entry) => `${entry.interruptId}=${entry.status}${entry.payload === undefined ? '' : `:${JSON.stringify(entry.payload)}`}`).join(', ');
      return send([started, ...say(`m-${runId}`, `Resumed with ${answers}`), finished()]);
    }
    if (tools.length > 0) {
      const results = tools.map((tool) => `${tool.toolCallId}=${String(tool.content)}`).join(', ');
      return send([started, ...say(`m-${runId}`, `Tool results: ${results}`), finished()]);
    }
    if (action !== undefined) return send([started, ...say(`m-${runId}`, `Action received: ${String(action.name)}`), finished()]);

    switch (message) {
      case SCENARIOS.interrupt:
        return send([started, ...say(`m-${runId}`, 'I need two answers before I can continue.'), finished({ type: 'interrupt', interrupts: INTERRUPTS })]);
      case SCENARIOS.tools:
        return send([
          started,
          { type: 'TOOL_CALL_START', toolCallId: 'c-color', toolCallName: 'pick_color' },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c-color', delta: '{"choices":' },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c-color', delta: '["red","teal"]}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c-color' },
          { type: 'TOOL_CALL_START', toolCallId: 'c-size', toolCallName: 'pick_size' },
          { type: 'TOOL_CALL_ARGS', toolCallId: 'c-size', delta: '{"max":3}' },
          { type: 'TOOL_CALL_END', toolCallId: 'c-size' },
          finished(),
        ]);
      case SCENARIOS.slow:
        // Streams a little and then stays open until the client goes away.
        return send([started, { type: 'TEXT_MESSAGE_START', messageId: `m-${runId}`, role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${runId}`, delta: 'Thinking about it' }], true);
      case SCENARIOS.state:
        return send([
          started,
          { type: 'STATE_SNAPSHOT', snapshot: { counter: 1, items: ['a'] } },
          { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/counter', value: 2 }, { op: 'add', path: '/items/-', value: 'b' }] },
          finished(),
        ]);
      case SCENARIOS.broken:
        response.write(`data: ${JSON.stringify(started)}\n\n`);
        response.write(`data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'never-started', delta: 'no start event' })}\n\n`);
        response.write('data: {not json at all\n\n');
        return send([{ type: 'STEP_STARTED', stepName: 'after the damage' }, { type: 'STEP_FINISHED', stepName: 'after the damage' }, finished()]);
      default:
        return send([started, ...say(`m-${runId}`, 'Hello from the reference agent.'), finished()]);
    }
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
    });

    const failure = failures.get(pathname);
    if (failure !== undefined) return text(response, failure, 'application/json', '{"error":"scripted failure"}');
    if (kind === 'preparation') return text(response, 200, 'application/json', '{"ok":true}');

    const input = parsed as Input;
    if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
      return text(response, 422, 'application/json', JSON.stringify({ detail: 'threadId and runId must be strings' }));
    }
    return stream(response, input);
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
      seen.length = 0;
      failures.clear();
    },
    openStreams: () => open,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
