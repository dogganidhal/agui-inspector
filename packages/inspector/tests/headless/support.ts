// Shared by the headless tests (feature 018): the reference agent over real HTTP, and a server for the A2UI agent, which
// the interactive server does not play.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInteractiveServer, type InteractiveServer } from '../../../../examples/reference-agent/interactive-scenarios.ts';
import { a2uiResponse, type RunInput } from '../../../../examples/reference-agent/scenarios.ts';

export const SECRET = 'synthetic-header-018';

export interface Served {
  readonly origin: string;
  readonly agent: string;
  /** Run inputs in arrival order. */
  readonly inputs: RunInput[];
  /** Header names and values of each request, for checks that a header arrived. */
  readonly headers: Record<string, string | string[] | undefined>[];
  close(): Promise<void>;
}

/** Runs `body` against the interactive reference agent and closes it after. */
export async function withAgent<T>(body: (server: InteractiveServer, agent: string) => Promise<T>): Promise<T> {
  const server = await createInteractiveServer();
  try {
    return await body(server, `${server.origin}/agent`);
  } finally {
    await server.close();
  }
}

/** A loopback server for `handler`, which answers run inputs at any path. */
export async function serve(handler: (input: RunInput, request: IncomingMessage, response: ServerResponse) => void): Promise<Served> {
  const inputs: RunInput[] = [];
  const headers: Record<string, string | string[] | undefined>[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    headers.push({ ...request.headers });
    let input: RunInput;
    try {
      input = JSON.parse(body) as RunInput;
    } catch {
      response.writeHead(422, { 'content-type': 'application/json' });
      return void response.end('{"error":"not JSON"}');
    }
    inputs.push(input);
    handler(input, request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    agent: `${origin}/agent`,
    inputs,
    headers,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** The reference A2UI agent: the order form, and the form extended after its button sends `send_note`. */
export const serveA2ui = (): Promise<Served> =>
  serve((input, _request, response) => {
    const reply = a2uiResponse(input);
    response.writeHead(reply.status, { 'content-type': reply.contentType });
    for (const chunk of reply.chunks) response.write(chunk);
    response.end();
  });

export const tempDir = (): string => mkdtempSync(path.join(tmpdir(), 'agui-headless-'));

/** A fixed clock and identifiers, so two runs of a scripted scenario give the same file. */
export function fixed() {
  let now = 0;
  let id = 0;
  return {
    clock: { now: () => (now += 1), epoch: () => 1_700_000_000_000 + now },
    ids: () => `00000000-0000-4000-8000-${String((id += 1)).padStart(12, '0')}`,
  };
}
