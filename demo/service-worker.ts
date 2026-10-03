// The public demo's endpoint adapter (P02, FR-002, FR-005, FR-006). A same-origin service worker that
// answers a few reserved routes under its own directory with real HTTP responses built from the shared
// reference producers, so the page's normal fetch, recorder and frame reader see ordinary HTTP/SSE.
// It is not a proxy and not a cache: it forwards nothing, stores nothing, reads nothing of a request
// but its method, URL and body, and leaves every other request (assets, navigation, other origins, the
// visitor's own endpoint) to the browser. Classic script, no imports from Node, React or the app.
// The agents' answers are paced here (FX9), not in the producers: a run streams over a second or two, the
// way a model would, instead of landing in a millisecond. The only timers are the pauses between chunks.

import {
  a2uiResponse,
  baselineResponse,
  interactiveResponse,
  jsonResponse,
  runErrorResponse,
  type RunInput,
  type ScenarioResponse,
} from '../examples/reference-agent/scenarios.ts';
import { deliver, pace, sleepOn } from '../examples/reference-agent/pacing.ts';

declare const self: ServiceWorkerGlobalScope;

/** What the page asks, and what the worker answers, to prove this script controls it. Nothing else crosses. */
const HELLO = 'agui-demo-hello';
const READY = { type: 'agui-demo-ready', version: 1, ready: true } as const;

// The scope is the directory this script is served from, whatever sub-path the site lives under.
const base = new URL('./', self.location.href);
const reserved = `${base.pathname}__demo__/`;

// The worker's own timers, so a test can stand in a fake clock for them.
const sleep = sleepOn(self);

const AGENTS = new Map<string, (input: RunInput) => ScenarioResponse>([
  ['agent/interactive', interactiveResponse],
  ['agent/a2ui', a2uiResponse],
  ['agent/protocol/baseline', baselineResponse],
  ['agent/protocol/run-error', runErrorResponse],
]);

const SESSION = /^prepare\/sessions\/[^/]+$/;

const notAllowed = (allow: string) => jsonResponse(405, { error: 'method not allowed', allow });

/** The response for one reserved route, as data. Errors are bytes and a status, never a successful stream. */
async function answer(request: Request, route: string): Promise<ScenarioResponse> {
  const agent = AGENTS.get(route);
  if (agent !== undefined) {
    if (request.method !== 'POST') return notAllowed('POST');
    let input: Partial<RunInput> | null;
    try {
      input = JSON.parse(await request.text());
    } catch {
      return jsonResponse(400, { error: 'request body is not valid JSON' });
    }
    if (typeof input?.threadId !== 'string' || typeof input.runId !== 'string') {
      return jsonResponse(422, { error: 'threadId and runId must be strings' });
    }
    // The protocol fixtures are byte-exact wire evidence in uneven fragments; pacing leaves those unchanged.
    return pace(agent(input as RunInput));
  }
  // Preparations are accepted and forgotten: the page recorded the request, and nothing is kept here.
  if (route === 'prepare/warm') return request.method === 'POST' ? jsonResponse(200, { ok: true }) : notAllowed('POST');
  if (SESSION.test(route)) return request.method === 'PUT' ? jsonResponse(200, { ok: true }) : notAllowed('PUT');
  return jsonResponse(404, { error: 'not found' });
}

/**
 * The descriptor as a native response. Chunks are handed over in order, each after its pause. A held response
 * sends no closing frame; Stop, or any cancel from the page, ends a pause early, drops what has not been sent
 * and releases the response, so nothing more is written after the page has gone.
 */
function toResponse(answered: ScenarioResponse): Response {
  const stopped = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      void deliver(answered, (chunk) => controller.enqueue(chunk), sleep, stopped.signal).then((complete) => {
        if (complete && answered.ending === 'close') controller.close();
      });
    },
    cancel() {
      stopped.abort();
    },
  });
  return new Response(body, { status: answered.status, headers: { 'content-type': answered.contentType, 'cache-control': 'no-store' } });
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    self.clients
      .claim()
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => clients.forEach((client) => client.postMessage(READY))),
  );
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type === HELLO) event.source?.postMessage(READY);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.mode === 'navigate' || url.origin !== base.origin || !url.pathname.startsWith(reserved)) return;
  event.respondWith(answer(request, url.pathname.slice(reserved.length)).then(toResponse));
});
