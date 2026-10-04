// The node:http bridge: a Request from a message, and a Response written back.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { sendResponse, toRequest } from '../../src/server/node.ts';

const message = (fields: object) => fields as IncomingMessage & { originalUrl?: string };

test('toRequest carries the method, the path and the query', () => {
  const request = toRequest(message({ method: 'POST', url: '/agui-inspector/config.json?x=1' }));
  assert.equal(request.method, 'POST');
  assert.equal(new URL(request.url).pathname, '/agui-inspector/config.json');
  assert.equal(new URL(request.url).search, '?x=1');
});

test('toRequest prefers originalUrl, which Express sets to the address the client used', () => {
  const request = toRequest(message({ method: 'GET', url: '/config.json', originalUrl: '/api/agui-inspector/config.json?a=b' }));
  assert.equal(new URL(request.url).pathname, '/api/agui-inspector/config.json');
  assert.equal(new URL(request.url).search, '?a=b');
});

test('toRequest ignores headers, even one that Request would reject, and defaults the method and the URL', () => {
  const request = toRequest(message({ headers: { 'bad header\n': 'x', cookie: 'a=b', authorization: 'Bearer secret' } }));
  assert.equal(request.method, 'GET');
  assert.equal(new URL(request.url).pathname, '/');
  assert.equal(request.headers.has('cookie'), false);
  assert.equal(request.headers.has('authorization'), false);
});

test('toRequest reads a target that starts with // as a path, and an absolute-form target by its path and query', () => {
  assert.equal(new URL(toRequest(message({ url: '//evil.example/a/b?c=d' })).url).pathname, '//evil.example/a/b');
  const absolute = new URL(toRequest(message({ url: 'http://evil.example/a/b?c=d' })).url);
  assert.equal(absolute.pathname, '/a/b');
  assert.equal(absolute.search, '?c=d');
});

test('toRequest turns the methods that Request refuses into OPTIONS, which the core answers with 405', () => {
  for (const method of ['TRACE', 'CONNECT', 'trace']) assert.equal(toRequest(message({ method, url: '/' })).method, 'OPTIONS', method);
  assert.equal(toRequest(message({ method: 'delete', url: '/' })).method, 'DELETE');
});

let server: Server;
const listening = (async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const response =
      url.pathname === '/redirect'
        ? new Response(null, { status: 307, headers: { location: 'x/index.html' } })
        : url.pathname === '/empty-headers'
          ? new Response('plain', { status: 405, headers: { allow: 'GET, HEAD', 'content-type': 'text/plain' } })
          : new Response(`${req.method} ${url.pathname}`, { status: 200, headers: { 'content-type': 'text/plain', 'content-length': String(`${req.method} ${url.pathname}`.length), 'x-extra': 'one' } });
    await sendResponse(response, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
})();
after(() => new Promise<void>((resolve) => server.close(() => resolve())));

test('sendResponse writes the status, every header and the body', async () => {
  const port = await listening;
  const response = await fetch(`http://127.0.0.1:${port}/a/b`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-extra'), 'one');
  assert.equal(response.headers.get('content-type'), 'text/plain');
  assert.equal(await response.text(), 'GET /a/b');
});

test('sendResponse adds a Content-Length when the response has none, and sends a redirect without a body', async () => {
  const port = await listening;
  const plain = await fetch(`http://127.0.0.1:${port}/empty-headers`);
  assert.equal(plain.status, 405);
  assert.equal(plain.headers.get('allow'), 'GET, HEAD');
  assert.equal(plain.headers.get('content-length'), '5');
  const redirect = await fetch(`http://127.0.0.1:${port}/redirect`, { redirect: 'manual' });
  assert.equal(redirect.status, 307);
  assert.equal(redirect.headers.get('location'), 'x/index.html');
  assert.equal(redirect.headers.get('content-length'), '0');
  assert.equal(await redirect.text(), '');
});

test('for HEAD the headers of GET arrive and the body does not', async () => {
  const port = await listening;
  const head = await fetch(`http://127.0.0.1:${port}/a/b`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String('HEAD /a/b'.length));
  assert.equal(await head.text(), '');
});
