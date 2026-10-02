// Deterministic, model-free scenarios for configuration, presets and client profiles (L01, US4).
// A loopback "scripted request seam": it serves a page's assets and a version-0 configuration, answers
// capability and preparation routes, and records the body of every preparation and run request in
// arrival order. Tests then compare what was recorded with what the settings said should be sent.
//
// It records whether an Authorization header was present, never its value, and never echoes a header,
// so a test can prove a token travelled as a header and appeared nowhere else.
// Erasable TypeScript only, so Node can run it directly.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/** The configuration the page loads. Several agents cover inline and remote capabilities and failures. */
export const configScenario = {
  version: 0,
  agents: [
    {
      id: 'support',
      name: 'Support assistant',
      url: '/agent',
      capabilities: {
        identity: { name: 'Support', version: '2.3.0' },
        transport: { streaming: true, websocket: false },
        tools: { supported: true, parallelCalls: false },
        state: { snapshots: true, deltas: true },
        humanInTheLoop: { interrupts: true },
        custom: { 'refund.policy_version': '2026-07' },
      },
      preset: {
        variables: {
          userId: { default: 'dev-{{uuid}}' },
          seed: { default: { plan: 'free', tags: ['new'] }, type: 'json' },
          limit: { default: 3, type: 'json' },
        },
        forwardedProps: { user_id: '{{userId}}', seed: '{{seed}}', limit: '{{limit}}', trace: '{{uuid}}', tenant: 'acme' },
        messages: 'turn',
        prepare: [
          { method: 'PUT', path: '/prepare/sessions/{{threadId}}', body: { user_id: '{{userId}}', context: '{{seed}}', note: 'plan={{seed}}' } },
          { method: 'POST', path: '/prepare/warm', body: { run: '{{runId}}', trace: '{{uuid}}' } },
        ],
        quickMessages: ['/help', 'Where is my order?'],
      },
    },
    { id: 'remote', name: 'Remote agent', url: '/agent', capabilities: '/agents/remote/capabilities' },
    { id: 'broken', name: 'Broken capabilities', url: '/agent', capabilities: '/agents/broken/capabilities' },
    { id: 'ghost', name: 'Undefined variable', url: '/agent', preset: { forwardedProps: { who: '{{nobody}}' } } },
    { id: 'plain', name: 'Plain agent', url: '/agent' },
  ],
} as const;

export const configJson = JSON.stringify(configScenario, null, 2);

/** What `/agents/remote/capabilities` declares. */
export const remoteCapabilities = {
  identity: { name: 'Remote', version: '0.4.0' },
  reasoning: { supported: true, streaming: false },
  multiAgent: { supported: false },
} as const;

export interface RecordedRequest {
  readonly seq: number;
  readonly kind: 'preparation' | 'run';
  readonly method: string;
  readonly path: string;
  /** The parsed JSON body, or the raw text when it is not JSON. */
  readonly body: unknown;
  readonly authorization: 'present' | 'absent';
}

export interface ScenarioServer {
  readonly origin: string;
  /** Preparation and run requests, in the order they arrived. */
  requests(): readonly RecordedRequest[];
  /** Every request the server saw, including page assets and configuration. */
  paths(): readonly string[];
  reset(): void;
  close(): Promise<void>;
}

/** `assets` maps a path to its content type and text; they are served as given. */
export async function createScenarioServer(assets: Readonly<Record<string, readonly [contentType: string, body: string]>>): Promise<ScenarioServer> {
  const recorded: RecordedRequest[] = [];
  const seen: string[] = [];

  const send = (response: ServerResponse, status: number, contentType: string, body: string) => {
    response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
    response.end(body);
  };

  async function readBody(request: IncomingMessage): Promise<string> {
    let text = '';
    for await (const chunk of request) text += String(chunk);
    return text;
  }

  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    seen.push(`${request.method} ${pathname}`);

    if (request.method === 'GET') {
      if (pathname === '/config.json') return send(response, 200, 'application/json', configJson);
      if (pathname === '/agents/remote/capabilities') return send(response, 200, 'application/json', JSON.stringify(remoteCapabilities));
      if (pathname === '/agents/broken/capabilities') return send(response, 404, 'application/json', '{"error":"not found"}');
      const asset = assets[pathname];
      return asset ? send(response, 200, asset[0], asset[1]) : send(response, 404, 'text/plain', 'not found');
    }

    const kind = pathname === '/agent' ? 'run' : pathname.startsWith('/prepare/') ? 'preparation' : undefined;
    if (!kind) return send(response, 404, 'application/json', '{"error":"not found"}');
    const text = await readBody(request);
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: keep the text, as a recorder would.
    }
    recorded.push({
      seq: recorded.length + 1,
      kind,
      method: request.method ?? '',
      path: pathname,
      body,
      authorization: request.headers.authorization === undefined ? 'absent' : 'present',
    });
    return send(response, 200, 'application/json', '{"ok":true}');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: () => [...recorded],
    paths: () => [...seen],
    reset() {
      recorded.length = 0;
      seen.length = 0;
    },
    // close() alone waits for a connection a browser still holds open; drop them so teardown finishes at once.
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
