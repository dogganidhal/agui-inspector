// The relay (FR-009 to FR-012): the bytes, the chunks and their timing, the headers, the failures and the aborts, against
// scripted targets on real sockets. A synthetic secret goes through the failure paths to show that no message holds it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { relay, type Log } from '../../src/cli/proxy.ts';
import type { Target } from '../../src/cli/args.ts';
import { ask, closedPort, recordingTarget, sleep, start, targetFor, within, type Running } from './support.ts';

const SECRET = 'synthetic-secret-91c4d2';
const open: Running[] = [];
after(() => Promise.all(open.map((running) => running.close())));
const keep = <T extends Running>(running: T): T => {
  open.push(running);
  return running;
};

/** A listener that relays everything it gets to `target`, with the request's own URL as the path. */
const relayTo = (target: Target, log: Log = () => {}, path?: string) => start((request, response) => relay(request, response, target, path ?? request.url ?? '/', log)).then(keep);

test('the method, the path and query, and the body reach the target as they were, and the answer comes back as it was sent', async () => {
  const target = keep(await recordingTarget((_request, response) => void response.writeHead(418, "I'm a teapot", { 'content-type': 'application/json', 'x-answer': 'yes' }).end('{"ok":true}')));
  const front = await relayTo(targetFor(`${target.origin}/agent`));
  const body = Buffer.from('{"threadId":"t","note":"é☃"}');
  const answer = await ask({ port: front.port, path: '/agent?x=1&y=%20&z=a%2Fb', method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(target.seen.length, 1);
  assert.equal(target.seen[0]?.method, 'POST');
  assert.equal(target.seen[0]?.url, '/agent?x=1&y=%20&z=a%2Fb');
  assert.deepEqual(target.seen[0]?.body, body);
  assert.equal(answer.status, 418);
  assert.equal(answer.statusMessage, "I'm a teapot");
  assert.equal(answer.headers['content-type'], 'application/json');
  assert.equal(answer.headers['x-answer'], 'yes');
  assert.equal(answer.body.toString(), '{"ok":true}');
  assert.equal(answer.complete, true);
});

test('the target sees its own Host, and the page never sets one for it', async () => {
  const target = keep(await recordingTarget());
  const front = await relayTo(targetFor(target.origin));
  await ask({ port: front.port, path: '/', headers: { host: '127.0.0.1:4747' } });
  assert.equal(target.seen[0]?.headers.host, `127.0.0.1:${target.port}`);
});

test('hop-by-hop headers end at the relay in both directions', async () => {
  const target = keep(
    await recordingTarget((_request, response) =>
      void response.writeHead(200, ['Connection', 'x-gone', 'X-Gone', '1', 'Keep-Alive', 'timeout=5', 'Proxy-Authenticate', 'Basic', 'X-Kept', 'yes']).end('ok'),
    ),
  );
  const front = await relayTo(targetFor(target.origin));
  const answer = await ask({
    port: front.port,
    path: '/',
    headers: { connection: 'keep-alive, x-drop', 'x-drop': '1', 'keep-alive': 'timeout=9', te: 'trailers', 'proxy-authorization': 'Basic abc', 'x-keep': 'yes' },
  });
  const seen = target.seen[0]?.headers ?? {};
  for (const name of ['x-drop', 'keep-alive', 'te', 'proxy-authorization']) assert.equal(seen[name], undefined, `${name} must not reach the target`);
  assert.equal(seen['x-keep'], 'yes');
  for (const name of ['x-gone', 'proxy-authenticate']) assert.equal(answer.headers[name], undefined, `${name} must not reach the page`);
  assert.equal(answer.headers['x-kept'], 'yes');
});

test('ten chunks written 100 ms apart arrive as ten chunks, in order, each before the next is written, with every byte intact', { timeout: 15_000 }, async () => {
  const pieces = Array.from({ length: 10 }, (_, i) => Buffer.from(`data: {"i":${i}}\n\n`));
  pieces[3] = Buffer.from([0xff, 0xfe, 0x0a]); // not valid UTF-8
  pieces[4] = Buffer.from('data: {"type":"TEXT_MES'); // one event split across two chunks
  pieces[5] = Buffer.from('SAGE_CONTENT"}\n\n');
  pieces[6] = Buffer.from('not json at all\n\n');
  const wrote: number[] = [];
  const target = keep(
    await recordingTarget(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      for (const piece of pieces) {
        wrote.push(performance.now());
        response.write(piece);
        await sleep(100);
      }
      response.end();
    }),
  );
  const front = await relayTo(targetFor(`${target.origin}/agent`));
  const answer = await ask({ port: front.port, path: '/agent', method: 'POST', body: '{}' });
  assert.equal(answer.complete, true);
  assert.equal(answer.chunks.length, 10, 'one chunk for each write');
  assert.deepEqual(answer.body, Buffer.concat(pieces));
  answer.chunks.forEach((chunk, i) => assert.deepEqual(chunk.bytes, pieces[i], `chunk ${i}`));
  for (let i = 0; i < 9; i++) {
    assert.ok((answer.chunks[i]?.at ?? Infinity) < (wrote[i + 1] ?? 0), `chunk ${i} arrived before the target wrote chunk ${i + 1}`);
  }
});

test('a large request body and a large response body arrive byte for byte', { timeout: 20_000 }, async () => {
  const requestBody = Buffer.alloc(1_000_000, 0x61);
  requestBody.writeUInt32LE(0xdeadbeef, 123_456);
  const responseBody = Buffer.alloc(5_000_000);
  for (let i = 0; i < responseBody.length; i++) responseBody[i] = (i * 31 + (i >> 8)) & 0xff;
  const target = keep(await recordingTarget((_request, response) => void response.writeHead(200, { 'content-length': String(responseBody.length) }).end(responseBody)));
  const front = await relayTo(targetFor(target.origin));
  const answer = await ask({ port: front.port, path: '/upload', method: 'POST', body: requestBody });
  assert.equal(createHash('sha256').update(target.seen[0]?.body ?? '').digest('hex'), createHash('sha256').update(requestBody).digest('hex'));
  assert.equal(createHash('sha256').update(answer.body).digest('hex'), createHash('sha256').update(responseBody).digest('hex'));
});

test('a compressed body keeps its bytes and its Content-Encoding: nothing is decompressed', async () => {
  const compressed = gzipSync(Buffer.from('data: {"hello":"world"}\n\n'));
  const target = keep(await recordingTarget((_request, response) => void response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/event-stream' }).end(compressed)));
  const front = await relayTo(targetFor(target.origin));
  const answer = await ask({ port: front.port, path: '/', headers: { 'accept-encoding': 'gzip' } });
  assert.equal(target.seen[0]?.headers['accept-encoding'], 'gzip');
  assert.equal(answer.headers['content-encoding'], 'gzip');
  assert.deepEqual(answer.body, compressed);
});

test('a redirect is passed on with its status and Location, and followed by no one', async () => {
  const target = keep(await recordingTarget((_request, response) => void response.writeHead(302, { location: 'http://elsewhere.example/agent?x=1' }).end()));
  const front = await relayTo(targetFor(target.origin));
  const answer = await ask({ port: front.port, path: '/agent' });
  assert.equal(answer.status, 302);
  assert.equal(answer.headers.location, 'http://elsewhere.example/agent?x=1');
  assert.equal(target.seen.length, 1);
});

test('an error status with a body, an answer with no body and a HEAD answer arrive as sent', async () => {
  const target = keep(
    await recordingTarget((request, response) => {
      if (request.url === '/boom') return void response.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}');
      if (request.url === '/none') return void response.writeHead(204).end();
      response.writeHead(200, { 'content-length': '5', 'x-length': 'five' }).end(request.method === 'HEAD' ? undefined : 'hello');
    }),
  );
  const front = await relayTo(targetFor(target.origin));
  const boom = await ask({ port: front.port, path: '/boom' });
  assert.deepEqual([boom.status, boom.body.toString()], [500, '{"error":"boom"}']);
  const none = await ask({ port: front.port, path: '/none' });
  assert.deepEqual([none.status, none.body.length, none.complete], [204, 0, true]);
  const head = await ask({ port: front.port, path: '/h', method: 'HEAD' });
  assert.deepEqual([head.status, head.headers['content-length'], head.headers['x-length'], head.body.length, head.complete], [200, '5', 'five', 0, true]);
});

test('repeated headers keep their order and their case, and the target’s Set-Cookie never arrives', async () => {
  const target = keep(await recordingTarget((_request, response) => void response.writeHead(200, ['X-Multi', 'one', 'x-multi', 'two', 'Set-Cookie', 'session=abc', 'set-cookie', 'other=1']).end('ok')));
  const front = await relayTo(targetFor(target.origin));
  const answer = await ask({ port: front.port, path: '/' });
  assert.equal(answer.headers['set-cookie'], undefined);
  const multi = answer.rawHeaders.flatMap((name, i, all) => (i % 2 === 0 && name.toLowerCase() === 'x-multi' ? [`${name}=${all[i + 1]}`] : []));
  assert.deepEqual(multi, ['X-Multi=one', 'x-multi=two']);
});

test('a target that cuts a stream gives the page a cut stream and the bytes that arrived, never a complete one', { timeout: 10_000 }, async () => {
  const target = keep(
    await recordingTarget(async (request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: 1\n\n');
      await sleep(80);
      request.socket.destroy();
    }),
  );
  const front = await relayTo(targetFor(target.origin));
  const answer = await ask({ port: front.port, path: '/' });
  assert.equal(answer.complete, false);
  assert.ok(answer.error, 'the page sees an error');
  assert.equal(answer.body.toString(), 'data: 1\n\n');
});

test('when the page aborts, the connection to the target is closed', { timeout: 10_000 }, async () => {
  let closed!: () => void;
  const targetClosed = new Promise<void>((resolve) => (closed = resolve));
  const target = keep(
    await recordingTarget((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: first\n\n');
      response.on('close', closed);
      return new Promise<void>(() => {});
    }),
  );
  const front = await relayTo(targetFor(target.origin));
  await ask({ port: front.port, path: '/', onResponse: (response, request) => void response.once('data', () => request.destroy()) });
  assert.equal(await within(targetClosed, 1000), true, 'the target saw its connection end');
});

test('a refused connection is a 502 that names the origin and the code, and neither it nor the log holds the path, query or a header', async () => {
  const port = await closedPort();
  const lines: string[] = [];
  const front = await relayTo(targetFor(`http://127.0.0.1:${port}/agent`), (line) => lines.push(line));
  const answer = await ask({ port: front.port, path: `/agent/${SECRET}?token=${SECRET}`, method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'x-api-key': SECRET }, body: SECRET });
  assert.equal(answer.status, 502);
  assert.match(answer.headers['content-type'] ?? '', /^text\/plain/);
  assert.equal(answer.body.toString(), `agui-inspector could not reach http://127.0.0.1:${port} (ECONNREFUSED)`);
  assert.deepEqual(lines, [`agui-inspector: could not reach http://127.0.0.1:${port} (ECONNREFUSED)`]);
  assert.ok(!answer.body.toString().includes(SECRET) && !lines.join('\n').includes(SECRET));
});

test('a target that drops the connection before it writes a header is a 502 too', async () => {
  const target = keep(await recordingTarget((request) => void request.socket.destroy()));
  const lines: string[] = [];
  const front = await relayTo(targetFor(target.origin), (line) => lines.push(line));
  const answer = await ask({ port: front.port, path: '/' });
  assert.equal(answer.status, 502);
  assert.equal(answer.body.toString(), `agui-inspector could not reach ${target.origin} (ECONNRESET)`);
  assert.equal(lines.length, 1);
});

test('a name that does not resolve is a 502 with the error code', { timeout: 20_000 }, async () => {
  const front = await relayTo(targetFor('http://nohost.invalid/agent'));
  const answer = await ask({ port: front.port, path: '/agent' });
  assert.equal(answer.status, 502);
  assert.match(answer.body.toString(), /^agui-inspector could not reach http:\/\/nohost\.invalid \((ENOTFOUND|EAI_AGAIN)\)$/);
});

test('a path Node refuses to send is a 400 with no outbound request', async () => {
  const target = keep(await recordingTarget());
  const front = await relayTo(targetFor(target.origin), () => {}, '/has a space');
  const answer = await ask({ port: front.port, path: '/' });
  assert.equal(answer.status, 400);
  assert.equal(target.seen.length, 0);
});

test('a header set on the command line is sent on every request, and the page’s header of the same name wins', async () => {
  const target = keep(await recordingTarget());
  const front = await relayTo(targetFor(target.origin, ['X-Synthetic: held-value', 'Authorization: Bearer held']));
  await ask({ port: front.port, path: '/one' });
  await ask({ port: front.port, path: '/two', method: 'POST', body: '{}', headers: { Authorization: 'Bearer typed' } });
  assert.equal(target.seen.length, 2);
  assert.deepEqual(target.seen.map((seen) => [seen.headers['x-synthetic'], seen.headers.authorization]), [
    ['held-value', 'Bearer held'],
    ['held-value', 'Bearer typed'],
  ]);
  assert.ok(target.seen[0]?.rawHeaders.includes('X-Synthetic'), 'the held name keeps the case it was written in');
});

test('a held header goes to its own target only', async () => {
  const a = keep(await recordingTarget());
  const b = keep(await recordingTarget());
  const frontA = await relayTo(targetFor(a.origin, ['X-Key: for-a']));
  const frontB = await relayTo(targetFor(b.origin, ['X-Key: for-b']));
  await ask({ port: frontA.port, path: '/' });
  await ask({ port: frontB.port, path: '/' });
  assert.equal(a.seen[0]?.headers['x-key'], 'for-a');
  assert.equal(b.seen[0]?.headers['x-key'], 'for-b');
});

test('the browser’s Cookie, Origin and Referer are not forwarded, and a target cookie is not passed on; a held Cookie is sent', async () => {
  const target = keep(await recordingTarget((_request, response) => void response.writeHead(200, { 'set-cookie': 'session=target-cookie' }).end('ok')));
  const plainFront = await relayTo(targetFor(target.origin));
  const answer = await ask({ port: plainFront.port, path: '/', headers: { cookie: 'other-app=1', origin: 'http://127.0.0.1:4747', referer: 'http://127.0.0.1:4747/', 'x-keep': 'yes' } });
  const seen = target.seen[0]?.headers ?? {};
  assert.deepEqual([seen.cookie, seen.origin, seen.referer, seen['x-keep']], [undefined, undefined, undefined, 'yes']);
  assert.equal(answer.headers['set-cookie'], undefined);

  const heldFront = await relayTo(targetFor(target.origin, ['Cookie: held=1']));
  await ask({ port: heldFront.port, path: '/', headers: { cookie: 'other-app=1' } });
  assert.equal(target.seen[1]?.headers.cookie, 'held=1');
});
