// The three JavaScript hosts of the browser tests: an Express application, a Hono application and a Next.js route
// handler, each with the inspector mounted, the scripted reference agent on the same origin, and, when asked, HTTP
// Basic authentication in front of every route. They import the helpers from `src`: `npm run typecheck` runs before the
// build, and `package.spec.ts` covers the built `lib`.
//
// Express listens as it is. Hono and the Next.js handlers are Fetch-API code, so a small `node:http` server stands in for
// what a real deployment brings (a Node adapter for Hono, the Next.js server). The Next.js stand-in follows the router's
// default behavior that matters here: a trailing slash is redirected away (308), the way `trailingSlash: false` does,
// and `request.url` has the `basePath` stripped. research.md (4) and (13) record that behavior against a real Next.js.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import express from 'express';
import { Hono } from 'hono';
import { referenceRunResponse } from '../../../examples/reference-agent/scenarios.ts';
import { mountInspector as mountExpress } from '../../../packages/inspector/src/server/express.ts';
import { mountInspector as mountHono } from '../../../packages/inspector/src/server/hono.ts';
import { inspectorRoute } from '../../../packages/inspector/src/server/next.ts';
import { sendResponse } from '../../../packages/inspector/src/server/node.ts';

export type HostKind = 'express' | 'hono' | 'next';

export interface HostOptions {
  /** Default `true`. A disabled helper mounts nothing. */
  readonly enabled?: boolean;
  /** Puts HTTP Basic authentication in front of every route, the agent route included. */
  readonly credentials?: { readonly user: string; readonly password: string };
  /** Hono `basePath` or Next.js `basePath`. Express ignores it. */
  readonly basePath?: string;
}

export interface Host {
  readonly kind: HostKind;
  readonly origin: string;
  /** The path the inspector is opened at, `basePath` included. */
  readonly mount: string;
  /** What the page lists as the agent endpoint. */
  readonly agentUrl: string;
  /** Every `console.warn` line since the host started. */
  readonly warnings: string[];
  stop(): Promise<void>;
}

export const AGENT_REPLY = 'Hello from the reference agent.';
/** The brand every host passes, so the specs can see it reach the page. */
export const BRAND = { name: 'Acme Console' };

const basic = (credentials: { user: string; password: string }) => `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`;

/** The ids of a run input, so the reference agent answers the run the page started. */
function runIds(text: string): { threadId: string; runId: string } {
  const input = JSON.parse(text || '{}') as { threadId?: unknown; runId?: unknown };
  return { threadId: String(input.threadId ?? 'thread'), runId: String(input.runId ?? 'run') };
}

/** The reference agent's one reply, as the Fetch API `Response` a framework would return. */
function agentResponse(ids: { threadId: string; runId: string }): Response {
  const reply = referenceRunResponse(ids);
  return new Response(Buffer.concat(reply.chunks), {
    status: reply.status,
    headers: { 'content-type': reply.contentType, 'cache-control': 'no-store' },
  });
}

/** The whole request, headers and body included, which the Hono and Next.js stand-ins need and the helper does not. */
function fullRequest(origin: string, message: IncomingMessage): Request {
  const method = message.method ?? 'GET';
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const body = method === 'GET' || method === 'HEAD' ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>);
  return new Request(`${origin}${message.url ?? '/'}`, { method, headers, body, duplex: 'half' } as RequestInit);
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}

/** Starts a host. Captures `console.warn` while it runs, and gives it back in `stop`. */
export async function startHost(kind: HostKind, options: HostOptions = {}): Promise<Host> {
  const enabled = options.enabled ?? true;
  const basePath = kind === 'express' ? '' : (options.basePath ?? '');
  const agentUrl = `${basePath}/agents/demo/stream`;
  const agents = [{ id: 'demo', name: 'Demo agent', url: agentUrl }];
  const authorization = options.credentials ? basic(options.credentials) : undefined;

  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...lines: unknown[]) => void warnings.push(lines.join(' '));

  let server: Server;
  if (kind === 'express') {
    const app = express();
    if (authorization) {
      app.use((req, res, next) => (req.headers.authorization === authorization ? next() : void res.status(401).set('www-authenticate', 'Basic realm="host"').send('host guard')));
    }
    mountExpress(app, { agents, enabled, brand: BRAND });
    app.post(agentUrl, async (req, res) => {
      let text = '';
      for await (const chunk of req) text += String(chunk);
      const reply = agentResponse(runIds(text));
      res.status(reply.status).set(Object.fromEntries(reply.headers)).send(Buffer.from(await reply.arrayBuffer()));
    });
    server = createServer(app);
  } else if (kind === 'hono') {
    const app = new Hono().basePath(basePath);
    if (authorization) app.use('*', async (c, next) => (c.req.header('authorization') === authorization ? next() : c.text('host guard', 401, { 'www-authenticate': 'Basic realm="host"' })));
    mountHono(app, { agents, enabled, brand: BRAND });
    app.post('/agents/demo/stream', async (c) => agentResponse(runIds(await c.req.text())));
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      await sendResponse(await app.fetch(fullRequest(`http://${req.headers.host}`, req)), res);
    });
  } else {
    // `app/agui-inspector/[[...path]]/route.ts` under the base path, with a guard standing for the middleware.
    const { GET, HEAD } = inspectorRoute({ agents, enabled, brand: BRAND });
    const route = '/agui-inspector';
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const request = fullRequest(`http://${req.headers.host}`, req);
      const url = new URL(request.url);
      const send = (response: Response) => sendResponse(response, res);
      if (authorization && request.headers.get('authorization') !== authorization) {
        return send(new Response('host guard', { status: 401, headers: { 'www-authenticate': 'Basic realm="host"' } }));
      }
      // The default `trailingSlash: false`: `/x/` goes back to `/x`, before any route sees it.
      if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
        return send(new Response(null, { status: 308, headers: { location: `${url.pathname.slice(0, -1)}${url.search}` } }));
      }
      if (!url.pathname.startsWith(basePath)) return send(new Response('not found', { status: 404 }));
      const rest = url.pathname.slice(basePath.length);
      // Next.js gives a route handler the URL without the `basePath`.
      const routed = new Request(`${url.origin}${rest}${url.search}`, request);
      if (rest === '/agents/demo/stream' && request.method === 'POST') return send(agentResponse(runIds(await request.text())));
      if (rest === route || rest.startsWith(`${route}/`)) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return send(new Response(null, { status: 405 }));
        const segments = rest.slice(route.length + 1).split('/').filter((segment) => segment !== '').map(decodeURIComponent);
        const context = { params: Promise.resolve(segments.length > 0 ? { path: segments } : {}) };
        return send(await (request.method === 'HEAD' ? HEAD : GET)(routed, context));
      }
      return send(new Response('not found', { status: 404 }));
    });
  }

  const origin = await listen(server);
  return {
    kind,
    origin,
    mount: `${basePath}/agui-inspector`,
    agentUrl,
    warnings,
    stop: () => {
      console.warn = original;
      return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
