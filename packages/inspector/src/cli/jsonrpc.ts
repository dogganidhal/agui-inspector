// Newline-delimited JSON-RPC 2.0 over a pair of streams (feature 018, research R6): what the MCP server speaks over
// standard input and output. One message per line in and out. Requests run concurrently, so a long tool call does not
// hold up `ping`; answers carry their request's id. Nothing but JSON-RPC is ever written to the output.
import { createInterface } from 'node:readline';

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export type Methods = Readonly<Record<string, (params: unknown) => unknown>>;

type Id = string | number | null;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads `input` until it ends or `signal` aborts, answers each request through `write`, and resolves once every answer is out. */
export async function serveJsonRpc(input: NodeJS.ReadableStream, write: (line: string) => void, methods: Methods, notifications: Methods = {}, signal?: AbortSignal): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  signal?.addEventListener('abort', () => lines.close(), { once: true });
  const inFlight = new Set<Promise<void>>();
  const send = (message: object) => write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const fail = (id: Id, code: number, message: string) => send({ id, error: { code, message } });

  async function handle(message: Record<string, unknown>, id: Id, method: string): Promise<void> {
    const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
    if (handler === undefined) return fail(id, -32601, 'Method not found');
    try {
      send({ id, result: (await handler(message['params'])) ?? {} });
    } catch (error) {
      if (error instanceof RpcError) fail(id, error.code, error.message);
      else fail(id, -32603, 'Internal error');
    }
  }

  for await (const line of lines) {
    if (line.trim() === '') continue;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, 'Parse error');
      continue;
    }
    const id = isRecord(message) && (typeof message['id'] === 'string' || typeof message['id'] === 'number') ? message['id'] : null;
    if (!isRecord(message) || message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string') {
      // A response from the client (no method) needs no answer; anything else is not a request.
      if (!(isRecord(message) && message['jsonrpc'] === '2.0' && ('result' in message || 'error' in message))) fail(id, -32600, 'Invalid Request');
      continue;
    }
    if (!('id' in message)) {
      const notice = Object.hasOwn(notifications, message['method']) ? notifications[message['method']] : undefined;
      try {
        await notice?.(message['params']);
      } catch {}
      continue;
    }
    const running = handle(message, id, message['method']);
    inFlight.add(running);
    void running.finally(() => inFlight.delete(running));
  }
  await Promise.all(inFlight);
}
