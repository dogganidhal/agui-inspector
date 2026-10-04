// The listener (feature 005): the page and its configuration from the shared core, the relay under /proxy/<n>/, and the
// checks that keep both on this machine.
//
// Order of work for a request, each step ending it or passing it on:
//   1. the request target is an absolute path, so a request line can never name a host (`GET http://other/ HTTP/1.1`)
//   2. `Host` is this listener's own address, so a page that rebinds a host name to 127.0.0.1 gets nothing
//   3. `/proxy/<n>/...` goes to target n: a page of another origin is refused, then the request is relayed
//   4. anything else is the core's: the page, `config.json` and the packaged files
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { createInspectorHandler } from '../server/core.ts';
import { sendResponse, toRequest } from '../server/node.ts';
import type { Target } from './args.ts';
import { plain, relay, type Log } from './proxy.ts';

export interface ListenOptions {
  readonly port: number;
  readonly targets: readonly Target[];
  /** Where failures to reach a target are written. */
  readonly log?: Log;
  /** The directory with the built page. Tests use a stand-in. */
  readonly assetsDir?: string;
}

export interface Listening {
  readonly port: number;
  /** Stops listening and closes every open connection, relays in progress included. */
  close(): Promise<void>;
}

const PROXY = '/proxy/';
// `CONNECT` and upgrade requests are refused here: without a listener, current Node.js serves an upgrade request as an
// ordinary one.
const FORBIDDEN = 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';
const refuseSocket = (_request: IncomingMessage, socket: Duplex) => void socket.end(FORBIDDEN);

/**
 * Binds `127.0.0.1` and nothing else. Rejects with the listen error (such as EADDRINUSE), or with the core's error when
 * the packaged page is missing.
 */
export async function listen(options: ListenOptions): Promise<Listening> {
  const { targets, log = () => {} } = options;
  const handle = createInspectorHandler({
    agents: targets.map((target) => ({ id: `target-${target.n}`, name: target.url.href, url: `${PROXY}${target.n}${target.path}` })),
    ...(options.assetsDir !== undefined && { assetsDir: options.assetsDir }),
  });

  const server = createServer((request, response) => {
    const { port } = server.address() as AddressInfo;
    serve(request, response, port).catch(() => plain(response, 500, 'agui-inspector could not read its page files'));
  });
  server.on('connect', refuseSocket);
  server.on('upgrade', refuseSocket);

  const forbid = (response: ServerResponse, why: string) => plain(response, 403, `agui-inspector refused this request: ${why}`);

  async function serve(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
    const target = request.url ?? '';
    if (!target.startsWith('/')) return forbid(response, 'the request target must be a path');
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes((request.headers.host ?? '').toLowerCase())) return forbid(response, 'the Host header is not this address');

    const queryAt = target.indexOf('?');
    const path = queryAt < 0 ? target : target.slice(0, queryAt);
    if (path.startsWith(PROXY)) return proxy(request, response, port, path, queryAt < 0 ? '' : target.slice(queryAt));

    // Decoded once, here. The core rejects an unsafe name. A bad escape is looked up as written, and no file has that name.
    const raw = path === '/' ? 'index.html' : path.slice(1);
    let asset = raw;
    try {
      asset = decodeURIComponent(raw);
    } catch {}
    await sendResponse(await handle(toRequest(request), asset), response);
  }

  function proxy(request: IncomingMessage, response: ServerResponse, port: number, path: string, query: string): void {
    const rest = path.slice(PROXY.length);
    const slash = rest.indexOf('/');
    const number = slash < 0 ? rest : rest.slice(0, slash);
    // Plain digits only: no sign, no leading zero, no escape. Anything else names no target.
    const chosen = /^[1-9][0-9]*$/.test(number) ? targets[Number(number) - 1] : undefined;
    if (chosen === undefined) return forbid(response, 'no such target');

    // A page on another site can send a request to this address, and the relay would add the developer's headers to it.
    // The browser says where a request comes from: `Origin` on all but a plain GET, `Sec-Fetch-Site` on every one.
    const origin = request.headers.origin;
    if (origin !== undefined && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin.toLowerCase())) return forbid(response, 'the request comes from another origin');
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return forbid(response, 'the request comes from another site');

    relay(request, response, chosen, `${slash < 0 ? '/' : rest.slice(slash)}${query}`, log);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
