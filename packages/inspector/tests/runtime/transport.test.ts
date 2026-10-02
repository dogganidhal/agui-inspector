// L02 T024 (US1, FR-003 to FR-005, FR-036, FR-037): the guarded transport and the volatile connection
// state. Destination policy, no cookies when hosted, same-origin credentials when embedded, redirect
// and userinfo refusal, the named-header token that never leaves the transport, and visible failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TransportPolicy, TransportRequest } from '../../src/contracts.ts';
import { createGuardedTransport, guardedFetchText, resolveTarget } from '../../src/core/runtime/transport.ts';

const TOKEN = 'synthetic-token-7f3a91';

const hosted: TransportPolicy = { mode: 'hosted', pageOrigin: 'https://inspector.example', allowedOrigins: ['https://agent.example'] };
const embedded: TransportPolicy = { mode: 'embedded', pageOrigin: 'https://host.example', allowedOrigins: [] };

interface Seen {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
}

/** A fetch that records what it was asked and answers with `reply`. */
function scripted(reply: () => Response | Promise<Response> = () => new Response('{}', { status: 200 })) {
  const seen: Seen[] = [];
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    seen.push({ url: String(url), init, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    return reply();
  };
  return { seen, fetch: fetch as typeof globalThis.fetch };
}

const post = (url: string, patch: Partial<TransportRequest> = {}): TransportRequest => ({ url, method: 'POST', body: '{"a":1}', responseKind: 'sse', ...patch });

// ---------------------------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------------------------

test('hosted: an absolute allowed origin is reachable, any other origin is refused before a request is made', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.url, 'https://agent.example/run');

  for (const url of ['https://evil.example/run', 'http://agent.example/run', 'https://agent.example:8443/run', 'https://sub.agent.example/run']) {
    await assert.rejects(transport.send(post(url)), /not an allowed destination/, url);
  }
  assert.equal(seen.length, 1, 'refused destinations never reach fetch');
});

test('the page origin is always reachable for assets and configuration, and a relative url means the page origin', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send({ url: '/config.json', method: 'GET', responseKind: 'response' });
  await transport.send({ url: 'https://inspector.example/config.json', method: 'GET', responseKind: 'response' });
  assert.deepEqual(seen.map((request) => request.url), ['https://inspector.example/config.json', 'https://inspector.example/config.json']);
});

test('embedded: a relative url resolves against the page origin and other origins are refused', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(embedded, { fetch });
  await transport.send(post('/agents/support/stream'));
  assert.equal(seen[0]?.url, 'https://host.example/agents/support/stream');
  await assert.rejects(transport.send(post('https://other.example/run')), /not an allowed destination/);
  await assert.rejects(transport.send(post('//other.example/run')), /not an allowed destination/, 'a scheme-relative url is another origin');
});

test('urls with userinfo, other schemes and unparseable text are refused with a message that does not repeat the secret', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await assert.rejects(transport.send(post('https://user:hunter2@agent.example/run')), (error: Error) => {
    assert.match(error.message, /user:password@/);
    assert.ok(!error.message.includes('hunter2'));
    return true;
  });
  await assert.rejects(transport.send(post('https://token@agent.example/run')), /user:password@/);
  await assert.rejects(transport.send(post('ftp://agent.example/run')), /http or https/);
  await assert.rejects(transport.send(post('javascript:alert(1)')), /http or https/);
  await assert.rejects(transport.send(post('http://')), /not a valid URL/);
  assert.equal(seen.length, 0);
});

test('resolveTarget reports the same refusals as a value, so callers can show them before sending', () => {
  assert.deepEqual(resolveTarget('https://agent.example/run?x=1', hosted), { ok: true, value: new URL('https://agent.example/run?x=1') });
  const refused = resolveTarget('https://evil.example/run', hosted);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.error, /not an allowed destination.*https:\/\/agent\.example/s);
  assert.equal(resolveTarget('/run', embedded).ok, true);
});

// ---------------------------------------------------------------------------------------------
// Credentials, cookies, headers
// ---------------------------------------------------------------------------------------------

test('hosted requests never send cookies: credentials are omitted, even to the page own origin', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'));
  await transport.send({ url: '/config.json', method: 'GET', responseKind: 'response' });
  assert.deepEqual(seen.map((request) => request.init.credentials), ['omit', 'omit']);
});

test('embedded same-origin requests use the host credentials; nothing else gets cookies', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport({ ...embedded, allowedOrigins: ['https://tools.example'] }, { fetch });
  await transport.send(post('/agent'));
  await transport.send(post('https://tools.example/run'));
  assert.deepEqual(seen.map((request) => request.init.credentials), ['same-origin', 'omit']);
});

test('the token travels under the chosen header name and under no other header or place', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'), { headerName: 'X-Api-Key', token: TOKEN });
  const [request] = seen;
  assert.equal(request?.headers['x-api-key'], TOKEN);
  assert.equal(request?.headers.authorization, undefined);
  assert.deepEqual(Object.keys(request?.headers ?? {}).sort(), ['accept', 'content-type', 'x-api-key']);
  assert.ok(!request?.url.includes(TOKEN));
  assert.ok(!String(request?.init.body).includes(TOKEN));
});

test('without a token no auth header is sent, and an empty token counts as none', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'));
  await transport.send(post('https://agent.example/run'), { headerName: 'Authorization', token: '' });
  for (const request of seen) assert.deepEqual(Object.keys(request.headers).sort(), ['accept', 'content-type']);
});

test('the transport sets the content type and accept header itself from the request kind', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'));
  await transport.send(post('https://agent.example/prepare', { responseKind: 'response' }));
  await transport.send({ url: '/config.json', method: 'GET', responseKind: 'response' });
  assert.equal(seen[0]?.headers.accept, 'text/event-stream');
  assert.equal(seen[1]?.headers.accept, 'application/json, text/plain;q=0.9, */*;q=0.1');
  assert.equal(seen[0]?.headers['content-type'], 'application/json');
  assert.equal(seen[2]?.headers['content-type'], undefined, 'no body, no content type');
  assert.equal(seen[2]?.init.body, undefined);
});

test('the body goes out as the exact text it was given', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  const text = '{ "z": 1,\n   "a" : [ 1 , 2 ] }';
  await transport.send(post('https://agent.example/run', { body: text }));
  assert.equal(seen[0]?.init.body, text);
  assert.equal(seen[0]?.init.method, 'POST');
});

test('header names that would let a token impersonate cookies or break the request are refused', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  for (const headerName of ['Cookie', 'cookie2', 'Host', 'Content-Length', 'Content-Type', 'Accept', 'bad name', 'x:y', '']) {
    await assert.rejects(transport.send(post('https://agent.example/run'), { headerName, token: TOKEN }), (error: Error) => {
      assert.match(error.message, /header name/i);
      assert.ok(!error.message.includes(TOKEN));
      return true;
    }, headerName);
  }
  assert.equal(seen.length, 0);
});

test('the referrer is not sent to the target', async () => {
  const { seen, fetch } = scripted();
  await createGuardedTransport(hosted, { fetch }).send(post('https://agent.example/run'));
  assert.equal(seen[0]?.init.referrerPolicy, 'no-referrer');
});

// ---------------------------------------------------------------------------------------------
// Redirects and visible failures
// ---------------------------------------------------------------------------------------------

test('redirects are never followed: fetch is asked not to, and a redirect answer is refused visibly', async () => {
  const redirect = scripted(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } }));
  const transport = createGuardedTransport(hosted, { fetch: redirect.fetch });
  await assert.rejects(transport.send(post('https://agent.example/run'), { headerName: 'Authorization', token: TOKEN }), (error: Error) => {
    assert.match(error.message, /redirect/i);
    assert.match(error.message, /302/);
    assert.ok(!error.message.includes('evil.example'), 'the location is not followed or echoed as a target');
    assert.ok(!error.message.includes(TOKEN));
    return true;
  });
  assert.equal(redirect.seen[0]?.init.redirect, 'manual');
  assert.equal(redirect.seen.length, 1, 'no second request was made');

  const opaque = scripted(() => Object.defineProperty(new Response(null, { status: 200 }), 'type', { value: 'opaqueredirect' }));
  await assert.rejects(createGuardedTransport(hosted, { fetch: opaque.fetch }).send(post('https://agent.example/run')), /redirect/i);
});

test('a network-level failure becomes a message naming the browser rules that can cause it, without the request', async () => {
  const failing = scripted(() => {
    throw new TypeError('Failed to fetch');
  });
  const transport = createGuardedTransport(hosted, { fetch: failing.fetch });
  await assert.rejects(transport.send(post('https://agent.example/run'), { headerName: 'Authorization', token: TOKEN }), (error: Error) => {
    assert.match(error.message, /https:\/\/agent\.example/);
    assert.match(error.message, /CORS/);
    assert.match(error.message, /private-network|private network/i);
    assert.match(error.message, /secure|mixed/i);
    assert.match(error.message, /no proxy|does not proxy|not proxied/i);
    assert.ok(!error.message.includes(TOKEN));
    assert.ok(!error.message.includes('/run'), 'only the origin is named, not the path or query');
    return true;
  });
});

test('an aborted request stays an AbortError so the recorder can tell a stop from a failure', async () => {
  const controller = new AbortController();
  const { fetch } = scripted(() => {
    throw new DOMException('aborted', 'AbortError');
  });
  const transport = createGuardedTransport(hosted, { fetch });
  controller.abort();
  await assert.rejects(transport.send(post('https://agent.example/run'), undefined, controller.signal), (error: Error) => error.name === 'AbortError');
});

test('the abort signal is handed to fetch', async () => {
  const controller = new AbortController();
  const { seen, fetch } = scripted();
  await createGuardedTransport(hosted, { fetch }).send(post('https://agent.example/run'), undefined, controller.signal);
  assert.equal(seen[0]?.init.signal, controller.signal);
});

test('non-2xx answers are returned, not thrown: the exchange keeps the status and body for inspection', async () => {
  const { fetch } = scripted(() => new Response('{"error":"nope"}', { status: 422 }));
  const response = await createGuardedTransport(hosted, { fetch }).send(post('https://agent.example/run'));
  assert.equal(response.status, 422);
  assert.equal(await response.text(), '{"error":"nope"}');
});

// ---------------------------------------------------------------------------------------------
// Configuration and capabilities go through the same guard
// ---------------------------------------------------------------------------------------------

test('guardedFetchText reads text through the guard and reports a bad status as an error', async () => {
  const ok = scripted(() => new Response('{"agents":[]}', { status: 200 }));
  assert.equal(await guardedFetchText(createGuardedTransport(hosted, { fetch: ok.fetch }))('/config.json'), '{"agents":[]}');
  assert.equal(ok.seen[0]?.headers.accept, 'application/json, text/plain;q=0.9, */*;q=0.1');
  assert.equal(ok.seen[0]?.init.method, 'GET');

  const missing = scripted(() => new Response('', { status: 404, statusText: 'Not Found' }));
  await assert.rejects(guardedFetchText(createGuardedTransport(hosted, { fetch: missing.fetch }))('/config.json'), /404/);

  const blocked = scripted();
  await assert.rejects(guardedFetchText(createGuardedTransport(hosted, { fetch: blocked.fetch }))('https://evil.example/config.json'), /not an allowed destination/);
  assert.equal(blocked.seen.length, 0, 'a configuration cannot reach beyond the allowlist');
});
