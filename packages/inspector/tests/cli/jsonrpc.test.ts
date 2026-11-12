// Feature 018, T025: the JSON-RPC loop of the MCP server, over in-memory streams.
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { RpcError, serveJsonRpc } from '../../src/cli/jsonrpc.ts';

async function exchange(lines: string[], methods = {}, notifications = {}) {
  const input = new PassThrough();
  const out: string[] = [];
  const done = serveJsonRpc(input, (line) => out.push(line), methods, notifications);
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  await done;
  return out;
}

const parsed = (out: string[]) => out.map((line) => JSON.parse(line) as Record<string, unknown>);

test('each request gets one answer line with its id; notifications and client responses get none', async () => {
  const seen: unknown[] = [];
  const out = await exchange(
    [
      '{"jsonrpc":"2.0","id":1,"method":"echo","params":{"a":1}}',
      '{"jsonrpc":"2.0","method":"note","params":"x"}',
      '{"jsonrpc":"2.0","id":"two","method":"echo"}',
      '{"jsonrpc":"2.0","id":9,"result":{}}',
      '',
    ],
    { echo: (params: unknown) => ({ params: params ?? null }) },
    { note: (params: unknown) => void seen.push(params) },
  );
  assert.ok(out.every((line) => line.endsWith('\n') && line.indexOf('\n') === line.length - 1), 'one message per line');
  assert.deepEqual(parsed(out), [
    { jsonrpc: '2.0', id: 1, result: { params: { a: 1 } } },
    { jsonrpc: '2.0', id: 'two', result: { params: null } },
  ]);
  assert.deepEqual(seen, ['x']);
});

test('errors: unknown method, parse error, invalid request, a handler error and an internal one', async () => {
  const out = parsed(
    await exchange(
      ['{"jsonrpc":"2.0","id":1,"method":"nope"}', '{not json', '{"jsonrpc":"1.0","id":2,"method":"x"}', '[1,2]', '{"jsonrpc":"2.0","id":3,"method":"bad"}', '{"jsonrpc":"2.0","id":4,"method":"boom"}'],
      {
        bad: () => {
          throw new RpcError(-32602, 'Invalid params');
        },
        boom: () => {
          throw new Error('a detail that must not reach the client');
        },
      },
    ),
  );
  assert.deepEqual(out, [
    { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } },
    { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
    { jsonrpc: '2.0', id: 2, error: { code: -32600, message: 'Invalid Request' } },
    { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
    { jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'Invalid params' } },
    { jsonrpc: '2.0', id: 4, error: { code: -32603, message: 'Internal error' } },
  ]);
});

test('a slow request does not hold up a quick one, and the loop resolves after the last answer', async () => {
  const out = parsed(
    await exchange(['{"jsonrpc":"2.0","id":"slow","method":"slow"}', '{"jsonrpc":"2.0","id":"ping","method":"ping"}'], {
      slow: () => new Promise((resolve) => setTimeout(() => resolve({ done: true }), 50)),
      ping: () => ({}),
    }),
  );
  assert.deepEqual(out.map((message) => message['id']), ['ping', 'slow']);
});
