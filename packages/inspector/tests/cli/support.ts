// Scripted servers and a plain client for the command line tests. Real sockets on 127.0.0.1, no mocks: what the relay does
// to bytes and timing can only be seen on a connection.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCli, type Target } from '../../src/cli/args.ts';

export interface Running {
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
  close(): Promise<void>;
}

export async function start(listener: RequestListener): Promise<Running> {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    port,
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** A port nothing listens on: it was free a moment ago. */
export async function closedPort(): Promise<number> {
  const probe = await start(() => {});
  await probe.close();
  return probe.port;
}

/** A target as the command line makes it, so the tests use the real shape. `headers` are `Name: value` strings. */
export function targetFor(url: string, headers: readonly string[] = []): Target {
  const cli = parseCli(['--target', url, ...headers.flatMap((header) => ['--header', header])]);
  if (cli.kind !== 'serve') throw new Error(`not a target: ${cli.kind === 'error' ? cli.message : cli.kind}`);
  return cli.targets[0] as Target;
}

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly body: Buffer;
}

export interface Recorded extends Running {
  /** Every request the target received, in order. */
  readonly seen: Seen[];
}

async function readAll(message: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of message) parts.push(part as Buffer);
  return Buffer.concat(parts);
}

/** A target that records what it receives and then answers as `answer` says (default: 200 and "ok"). */
export async function recordingTarget(answer?: (request: IncomingMessage, response: ServerResponse, seen: Seen) => void | Promise<void>): Promise<Recorded> {
  const seen: Seen[] = [];
  const running = await start(async (request, response) => {
    const record: Seen = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, rawHeaders: request.rawHeaders, body: await readAll(request) };
    seen.push(record);
    if (answer) await answer(request, response, record);
    else response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
  });
  return { ...running, seen };
}

export interface Answer {
  readonly status: number;
  readonly statusMessage: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly rawHeaders: readonly string[];
  readonly body: Buffer;
  /** Each `data` event, with the time it arrived (`performance.now()`, the clock the targets use too). */
  readonly chunks: ReadonlyArray<{ readonly at: number; readonly bytes: Buffer }>;
  /** Whether the response ended the way HTTP says it can: complete, not cut. */
  readonly complete: boolean;
  /** The error code of a failed or cut response or request. */
  readonly error?: string;
}

export interface Ask {
  readonly port: number;
  readonly path: string;
  readonly method?: string;
  readonly headers?: Record<string, string | string[]>;
  readonly body?: Buffer | string;
  /** Called with the request, so a test can destroy it in the middle of a stream. */
  readonly onResponse?: (response: IncomingMessage, request: ReturnType<typeof httpRequest>) => void;
}

/** A plain HTTP client that keeps raw headers, chunk boundaries and arrival times. */
export function ask(options: Ask): Promise<Answer> {
  return new Promise((resolve) => {
    const chunks: Array<{ at: number; bytes: Buffer }> = [];
    let status = 0;
    let statusMessage: string | undefined;
    let headers: IncomingHttpHeaders = {};
    let rawHeaders: readonly string[] = [];
    let complete = false;
    let error: string | undefined;
    const done = () => resolve({ status, statusMessage, headers, rawHeaders, body: Buffer.concat(chunks.map((chunk) => chunk.bytes)), chunks, complete, ...(error !== undefined && { error }) });
    const request = httpRequest({ host: '127.0.0.1', port: options.port, path: options.path, method: options.method ?? 'GET', headers: options.headers, agent: false }, (response) => {
      ({ statusCode: status = 0, statusMessage, headers, rawHeaders } = response);
      response.on('data', (bytes: Buffer) => chunks.push({ at: performance.now(), bytes }));
      response.on('error', (failure: NodeJS.ErrnoException) => (error = failure.code ?? failure.message));
      response.on('close', () => {
        complete = response.complete;
        done();
      });
      options.onResponse?.(response, request);
    });
    request.on('error', (failure: NodeJS.ErrnoException) => {
      error ??= failure.code ?? failure.message;
      done();
    });
    request.end(options.body);
  });
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves true if `promise` settles within `ms`, false otherwise. */
export const within = (promise: Promise<unknown>, ms: number) => Promise.race([promise.then(() => true), sleep(ms).then(() => false)]);

/** What the stand-in page holds. The tests read these files back, so each one has a distinct body. */
export const PAGE_FILES = {
  'index.html': '<!doctype html><title>stand-in page</title>',
  'hosting-config.json': '{"version":0,"mode":"embedded","allowedOrigins":[]}',
  'app.js': 'export const page = "stand-in";',
  'assets/chunk.js': 'export const chunk = 1;',
} as const;

/** A temporary directory with the stand-in page, so the tests run before `npm run build`. Remove it with `remove()`. */
export function standInPage(): { readonly dir: string; remove(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-cli-page-'));
  for (const [name, text] of Object.entries(PAGE_FILES)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Sends `text` on a raw socket and returns everything that came back before the socket closed (or 500 ms passed). */
export function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    let answer = '';
    const socket = connect({ host: '127.0.0.1', port }, () => socket.write(text));
    socket.on('data', (bytes) => (answer += bytes.toString('latin1')));
    socket.on('error', () => {});
    socket.on('close', () => resolve(answer));
    setTimeout(() => socket.destroy(), 500);
  });
}

/** A server that only counts the connections it gets: the "other host" that a refused request must never reach. */
export async function countingServer(): Promise<Running & { readonly connections: () => number }> {
  let count = 0;
  const running = await start((_request, response) => void response.end('other host'));
  running.server.on('connection', () => (count += 1));
  return { ...running, connections: () => count };
}
