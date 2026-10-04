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
  /** Absolute paths of the plugin files (feature 014). Each is served at `/plugins/<n>.js`, `n` from 1, and listed in `config.json`. */
  readonly plugins?: readonly string[];
}

export interface Listening {
  readonly port: number;
  /** Stops listening and closes every open connection, relays in progress included. */
  close(): Promise<void>;
}

const PROXY = '/proxy/';
const PLUGINS = '/plugins/';
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
  const plugins = options.plugins ?? [];
  const handle = createInspectorHandler({
    agents: targets.map((target) => ({ id: `target-${target.n}`, name: target.url.href, url: `${PROXY}${target.n}${target.path}` })),
    ...(plugins.length > 0 && {
      plugins: plugins.map((_, index) => `${PLUGINS}${index + 1}.js`),
      localFiles: Object.fromEntries(plugins.map((file, index) => [`plugins/${index + 1}.js`, file])),
    }),
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
    // A plugin file can hold a signing key, so it is held to the relay's rules about where a request comes from: a page on
    // another site must not be able to load it. The page and `config.json` stay links that any site may open.
    if (path.startsWith(PLUGINS)) {
      const foreign = fromAnotherSite(request, port);
      if (foreign !== undefined) return forbid(response, foreign);
    }

    // Decoded once, here. The core rejects an unsafe name. A bad escape is looked up as written, and no file has that name.
    const raw = path === '/' ? 'index.html' : path.slice(1);
    let asset = raw;
    try {
      asset = decodeURIComponent(raw);
    } catch {}
    await sendResponse(await handle(toRequest(request), asset), response);
  }

  /**
   * Why a request is from another origin or site, or undefined. A page on another site can send a request to this address,
   * and the relay would add the developer's headers to it. The browser says where a request comes from: `Origin` on all but
   * a plain GET, `Sec-Fetch-Site` on every one.
   */
  function fromAnotherSite(request: IncomingMessage, port: number): string | undefined {
    const origin = request.headers.origin;
    if (origin !== undefined && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin.toLowerCase())) return 'the request comes from another origin';
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return 'the request comes from another site';
    return undefined;
  }

  function proxy(request: IncomingMessage, response: ServerResponse, port: number, path: string, query: string): void {
    const rest = path.slice(PROXY.length);
    const slash = rest.indexOf('/');
    const number = slash < 0 ? rest : rest.slice(0, slash);
    // Plain digits only: no sign, no leading zero, no escape. Anything else names no target.
    const chosen = /^[1-9][0-9]*$/.test(number) ? targets[Number(number) - 1] : undefined;
    if (chosen === undefined) return forbid(response, 'no such target');

    const foreign = fromAnotherSite(request, port);
    if (foreign !== undefined) return forbid(response, foreign);

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
