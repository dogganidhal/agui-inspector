// Test support for the L02 unit tests; never part of the shipped app. A scripted network (a fetch
// that answers from routes and remembers every request it saw) and a ready-made runtime over a real
// store, frame reader and recorder, so tests read the same exchanges, frames and request bodies a
// person would inspect.
import type { InspectionSession, JsonValue, RunRecordId, TransportPolicy } from '../../src/contracts.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { createRuntime, type Runtime, type RuntimeOptions, type RuntimeSettings } from '../../src/core/runtime/index.ts';
import { createSessionStore } from '../../src/core/store/index.ts';

const encoder = new TextEncoder();

export const sse = (events: ReadonlyArray<object | string>): string =>
  events.map((event) => `data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`).join('');

export interface Call {
  readonly url: string;
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly credentials?: RequestCredentials;
  readonly signal?: AbortSignal;
}

/** The parsed body of a call, or undefined when it has none or it is not JSON. */
export function bodyOf(call: Call | undefined): Record<string, unknown> | undefined {
  if (call?.body === undefined) return undefined;
  try {
    return JSON.parse(call.body) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** An event-stream response that sends `text` in small chunks and then either ends or stays open until aborted. */
export function eventStream(text: string, options: { hold?: boolean; signal?: AbortSignal; chunk?: number } = {}): Response {
  const bytes = encoder.encode(text);
  const size = options.chunk ?? 11;
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
        if (!options.hold) return controller.close();
        options.signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

export type Route = (call: Call) => Response | Promise<Response> | undefined;

export function scriptedNetwork(routes: Route[] = []) {
  const calls: Call[] = [];
  const network = {
    calls,
    routes,
    fetch: (async (url: string | URL | Request, init: RequestInit = {}) => {
      const href = String(url);
      const call: Call = {
        url: href,
        path: new URL(href).pathname,
        method: init.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        ...(typeof init.body === 'string' && { body: init.body }),
        ...(init.credentials !== undefined && { credentials: init.credentials }),
        ...(init.signal ? { signal: init.signal } : {}),
      };
      calls.push(call);
      for (const route of routes) {
        const reply = route(call);
        if (reply !== undefined) return reply;
      }
      return new Response('{"error":"no route"}', { status: 404 });
    }) as typeof globalThis.fetch,
    /** Requests that were runs (the agent endpoint) or preparations, in arrival order. */
    on(path: string) {
      return calls.filter((call) => call.path === path);
    },
  };
  return network;
}

export const hosted: TransportPolicy = { mode: 'hosted', pageOrigin: 'https://inspector.example', allowedOrigins: ['https://agent.example'] };
export const embedded: TransportPolicy = { mode: 'embedded', pageOrigin: 'https://host.example', allowedOrigins: [] };

export const AGENT = 'https://agent.example/run';

/** A run that streams a short reply and finishes. */
export function replyRoute(path = '/run', text = 'ok'): Route {
  return (call) => {
    if (call.path !== path) return undefined;
    const input = bodyOf(call) as { threadId: string; runId: string };
    return eventStream(
      sse([
        { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId },
        { type: 'TEXT_MESSAGE_START', messageId: `m-${input.runId}`, role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${input.runId}`, delta: text },
        { type: 'TEXT_MESSAGE_END', messageId: `m-${input.runId}` },
        { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId, outcome: { type: 'success' } },
      ]),
    );
  };
}

export const ok200: Route = (call) => (call.path.startsWith('/prepare/') ? new Response('{"ok":true}', { status: 200 }) : undefined);

export interface Rig {
  readonly runtime: Runtime;
  readonly net: ReturnType<typeof scriptedNetwork>;
  readonly settings: { current: RuntimeSettings };
  session(): InspectionSession;
  /** Waits until every exchange has ended, so recorded bodies and frames are complete. */
  settle(): Promise<InspectionSession>;
  runRecordIds(): RunRecordId[];
}

let counter = 0;
const deterministicIds = () => {
  const prefix = `id${(counter += 1)}`;
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
};

export function rig(routes: Route[], options: Partial<Omit<RuntimeOptions, 'settings' | 'store'>> & { settings?: Partial<RuntimeSettings> } = {}): Rig {
  const net = scriptedNetwork(routes);
  const store = createSessionStore({ schedule: (callback) => queueMicrotask(callback) });
  const settings = { current: { profile: defaultProfile(), variables: {} as Readonly<Record<string, JsonValue>>, ...options.settings } as RuntimeSettings };
  const { settings: _ignored, ...rest } = options;
  const runtime = createRuntime({
    store,
    policy: hosted,
    fetch: net.fetch,
    randomUUID: deterministicIds(),
    ...rest,
    settings: () => settings.current,
  });
  const session = () => store.snapshot();
  return {
    runtime,
    net,
    settings,
    session,
    runRecordIds: () => session().runs.map((run) => run.id),
    async settle() {
      for (let i = 0; i < 200; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const open = session().exchanges.filter((exchange) => !['completed', 'transport-error', 'user-stopped'].includes(exchange.transport));
        if (open.length === 0) return session();
      }
      throw new Error('exchanges did not settle');
    },
  };
}
