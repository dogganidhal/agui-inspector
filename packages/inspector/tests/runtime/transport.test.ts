// L02 T024 (US1, FR-003 to FR-005, FR-036, FR-037): the guarded transport and the volatile connection
// state. Destination policy, no cookies when hosted, same-origin credentials when embedded, redirect
// and userinfo refusal, the named-header token that never leaves the transport, and visible failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TransportPolicy, TransportRequest } from '../../src/contracts.ts';
import { createGuardedTransport, guardedFetchText, isVisitorTarget, resolveTarget, VISITOR_LOOPBACK_HOSTS } from '../../src/core/runtime/transport.ts';

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

// ---------------------------------------------------------------------------------------------
// Headers from plugin providers (spec 014): one request's worth, validated here, below the typed token
// ---------------------------------------------------------------------------------------------

const SIGNATURE = 'synthetic-signature-7f3a91';

test('headers from a provider reach fetch for that request only, and the token replaces a header of its name', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'), undefined, undefined, { 'X-Signature': SIGNATURE, 'X-Request-Id': 'one' });
  await transport.send(post('https://agent.example/run'));
  assert.deepEqual(Object.keys(seen[0]?.headers ?? {}).sort(), ['accept', 'content-type', 'x-request-id', 'x-signature']);
  assert.equal(seen[0]?.headers['x-signature'], SIGNATURE);
  assert.deepEqual(Object.keys(seen[1]?.headers ?? {}).sort(), ['accept', 'content-type'], 'nothing is kept for the next request');

  await transport.send(post('https://agent.example/run'), { headerName: 'x-signature', token: TOKEN }, undefined, { 'X-Signature': SIGNATURE, 'X-Other': 'kept' });
  const typed = seen[2];
  assert.equal(typed?.headers['x-signature'], TOKEN, 'the typed token wins, compared without case');
  assert.equal(typed?.headers['x-other'], 'kept');
  assert.equal(Object.keys(typed?.init.headers as object).filter((name) => name.toLowerCase() === 'x-signature').length, 1, 'one header of that name, not two');
  assert.ok(!JSON.stringify(typed?.init.headers).includes(SIGNATURE));
});

test('names that differ only in case are one header', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'), undefined, undefined, { 'x-a': '1', 'X-A': '2' });
  assert.equal(Object.keys(seen[0]?.init.headers as object).filter((name) => name.toLowerCase() === 'x-a').length, 1);
});

test('the encoding owns Accept: a provider cannot change it for any kind of request', async () => {
  for (const [responseKind, accept] of [['sse', 'text/event-stream'], ['protobuf', 'application/vnd.ag-ui.event+proto'], ['response', 'application/json, text/plain;q=0.9, */*;q=0.1']] as const) {
    const { seen, fetch } = scripted();
    const transport = createGuardedTransport(hosted, { fetch });
    await transport.send(post('https://agent.example/run', { responseKind }), undefined, undefined, { 'X-Signature': SIGNATURE });
    assert.equal(seen[0]?.headers.accept, accept, responseKind);
    assert.equal(seen[0]?.headers['x-signature'], SIGNATURE, `${responseKind}: the provider's header rides along`);
    for (const name of ['Accept', 'accept', 'ACCEPT', 'Content-Type', 'content-type']) {
      await assert.rejects(transport.send(post('https://agent.example/run', { responseKind }), undefined, undefined, { [name]: 'text/html' }), /header "[Aa][Cc]{2}ept|header "[Cc]ontent-[Tt]ype/i, `${responseKind} ${name}`);
    }
    assert.equal(seen.length, 1, 'a refused header sends nothing');
  }
});

test('an invalid provider header is refused before fetch, and the message names the header and never the value', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  const secret = 'synthetic-secret-value-0001';
  const invalid: Array<[Record<string, string>, RegExp]> = [
    [{ Cookie: secret }, /"Cookie"/],
    [{ 'Set-Cookie': secret }, /"Set-Cookie"/],
    [{ Host: secret }, /"Host"/],
    [{ 'Content-Length': secret }, /"Content-Length"/],
    [{ 'bad name': secret }, /"bad name"/],
    [{ 'x:y': secret }, /"x:y"/],
    [{ '': secret }, /header name/],
    [{ 'X-A': `${secret}\r\nX-Injected: 1` }, /"X-A"/],
    [{ 'X-A': `${secret}\nmore` }, /"X-A"/],
    [{ 'X-A': `${secret}\u0000` }, /"X-A"/],
    [{ 'X-A': `${secret}\u0100` }, /"X-A"/],
    [{ 'X-A': 7 as unknown as string }, /"X-A"/],
  ];
  for (const [headers, named] of invalid) {
    await assert.rejects(transport.send(post('https://agent.example/run'), undefined, undefined, headers), (error: Error) => {
      assert.match(error.message, named);
      assert.ok(!error.message.includes(secret), error.message);
      return true;
    }, JSON.stringify(Object.keys(headers)));
  }
  assert.equal(seen.length, 0);
});

test('a provider header may hold a tab, spaces and Latin-1 text', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'), undefined, undefined, { 'X-A': 'a\tb  c é', 'X-Empty': '' });
  assert.equal(seen[0]?.headers['x-a'], 'a\tb  c é');
  assert.equal(seen[0]?.headers['x-empty'], '');
});

test('provider headers do not change cookies: hosted requests still omit them', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run'), undefined, undefined, { 'X-A': '1' });
  assert.equal(seen[0]?.init.credentials, 'omit');
});

test('a protobuf request asks for the protobuf media type and for nothing else, with the same body and headers otherwise', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(hosted, { fetch });
  await transport.send(post('https://agent.example/run', { responseKind: 'protobuf' }), { headerName: 'x-api-key', token: TOKEN });
  const [request] = seen;
  assert.equal(request?.headers.accept, 'application/vnd.ag-ui.event+proto');
  assert.equal(request?.headers['content-type'], 'application/json');
  assert.equal(request?.headers['x-api-key'], TOKEN, 'the token still goes out through the transport');
  assert.equal(request?.init.body, '{"a":1}');
  assert.equal(request?.init.credentials, 'omit');
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

// ---------------------------------------------------------------------------------------------
// Visitor targets (P01 T001/T002; constitution IV, feature 002): the opt-in boundary of the guard
// ---------------------------------------------------------------------------------------------

const visitor: TransportPolicy = { mode: 'hosted', pageOrigin: 'https://inspector.example', allowedOrigins: [], allowVisitorTargets: true };

const REACHABLE = [
  'https://unlisted.example/run',
  'https://unlisted.example:8443/run?x=1',
  'https://127.0.0.1:9/run',
  'https://[::1]:8443/run',
  'http://localhost/run',
  'http://localhost:1/run',
  'http://localhost:8787/run',
  'http://LOCALHOST:8787/run',
  'http://127.0.0.1/run',
  'http://127.0.0.1:65535/run',
  // The browser's own URL parser has already turned these into 127.0.0.1; the guard sees what fetch will use.
  'http://127.1:8787/run',
  'http://0x7f.0.0.1:8787/run',
  'http://2130706433:8787/run',
  'http://127.0.0.1.:8787/run',
];

const REFUSED = [
  'http://unlisted.example/run',
  'http://unlisted.example:443/run',
  'http://192.168.1.20:8787/run',
  'http://10.0.0.1/run',
  'http://127.0.0.2:8787/run',
  'http://0.0.0.0:8787/run',
  'http://localhost.:8787/run',
  'http://foo.localhost:8787/run',
  'http://localhost.evil.example/run',
  'http://127.0.0.1.evil.example/run',
  'http://evil-localhost:8787/run',
  'http://[::1]:8787/run',
  'http://[0:0:0:0:0:0:0:1]:8787/run',
  'http://[::ffff:127.0.0.1]:8787/run',
  'http://localhost%2eevil.example/run',
];

test('opted in: any HTTPS origin and exactly localhost or 127.0.0.1 over HTTP, on any port, reach fetch with no cookies', async () => {
  for (const url of REACHABLE) {
    const { seen, fetch } = scripted();
    await createGuardedTransport(visitor, { fetch }).send(post(url), { headerName: 'X-Api-Key', token: TOKEN });
    assert.equal(seen.length, 1, url);
    assert.equal(seen[0]?.init.credentials, 'omit', url);
    assert.equal(seen[0]?.init.redirect, 'manual', url);
    assert.equal(seen[0]?.init.referrerPolicy, 'no-referrer', url);
    assert.equal(seen[0]?.headers['x-api-key'], TOKEN, url);
    assert.deepEqual(Object.keys(seen[0]?.headers ?? {}).sort(), ['accept', 'content-type', 'x-api-key'], url);
  }
});

test('opted in: every other HTTP destination, and IPv6 literals, are refused before fetch with the reason', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(visitor, { fetch });
  for (const url of REFUSED) {
    await assert.rejects(transport.send(post(url)), /not an allowed destination.*HTTPS.*localhost.*127\.0\.0\.1/s, url);
    assert.equal(resolveTarget(url, visitor).ok, false, url);
  }
  await assert.rejects(transport.send(post('http://[::1]:8787/run')), /IPv6.*localhost/s);
  assert.equal(seen.length, 0, 'refused destinations never reach fetch');
});

test('opted in: userinfo, other schemes, unparseable text and redirects are refused exactly as before', async () => {
  const { seen, fetch } = scripted();
  const transport = createGuardedTransport(visitor, { fetch });
  for (const url of ['https://user:hunter2@unlisted.example/run', 'http://token@localhost:8787/run', 'https://unlisted.example:pw@127.0.0.1/run']) {
    await assert.rejects(transport.send(post(url)), (error: Error) => /user:password@/.test(error.message) && !/hunter2|pw@/.test(error.message), url);
  }
  for (const url of ['ftp://unlisted.example/run', 'ws://localhost:8787/run', 'wss://unlisted.example/run', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,x']) {
    await assert.rejects(transport.send(post(url)), /http or https/, url);
  }
  await assert.rejects(transport.send(post('http://')), /not a valid URL/);
  assert.equal(seen.length, 0);

  const redirect = scripted(() => new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/' } }));
  await assert.rejects(createGuardedTransport(visitor, { fetch: redirect.fetch }).send(post('https://unlisted.example/run')), /does not follow redirects/);
  assert.equal(redirect.seen.length, 1, 'no second request');
  assert.equal(redirect.seen[0]?.init.redirect, 'manual');
});

test('opted in: scheme-relative and backslash forms resolve first, then meet the same boundary', () => {
  // The page is https, so `//host` is an https target; the same text under an http loopback page is not.
  assert.equal(resolveTarget('//unlisted.example/run', visitor).ok, true);
  assert.equal(resolveTarget('\\\\unlisted.example\\run', visitor).ok, true);
  assert.equal(resolveTarget('//127.0.0.1:8787/run', visitor).ok, true);
  const loopbackPage: TransportPolicy = { ...visitor, pageOrigin: 'http://127.0.0.1:4000' };
  assert.equal(resolveTarget('//unlisted.example/run', loopbackPage).ok, false);
  assert.equal(resolveTarget('//localhost:8787/run', loopbackPage).ok, true);
  assert.equal(resolveTarget('/config.json', loopbackPage).ok, true, 'the page origin stays reachable');
  assert.equal(resolveTarget('http://localhost@evil.example/run', visitor).ok, false);
  assert.equal(resolveTarget('http://evil.example#@localhost/run', visitor).ok, false);
  assert.equal(resolveTarget('http://evil.example/?@localhost', visitor).ok, false);
});

test('without the opt-in nothing changes: absent or false keeps the fixed allowlist, and truthy-but-not-true does not opt in', async () => {
  for (const policy of [hosted, { ...hosted, allowVisitorTargets: false }, { ...embedded, allowVisitorTargets: false }]) {
    const { seen, fetch } = scripted();
    const transport = createGuardedTransport(policy, { fetch });
    for (const url of ['https://unlisted.example/run', 'http://localhost:8787/run', 'http://127.0.0.1:8787/run', 'http://[::1]:8787/run']) {
      await assert.rejects(transport.send(post(url)), /not an allowed destination/, `${policy.mode} ${url}`);
    }
    assert.equal(seen.length, 0);
  }
  // Old behavior with a fixed plain-HTTP origin is untouched while the option is off.
  const fixed: TransportPolicy = { mode: 'hosted', pageOrigin: 'https://inspector.example', allowedOrigins: ['http://192.168.1.20:8787'] };
  assert.equal(resolveTarget('http://192.168.1.20:8787/run', fixed).ok, true);
  assert.equal(resolveTarget('http://192.168.1.20:8787/run', { ...fixed, allowVisitorTargets: false }).ok, true);
  // Constructed objects that are not TypeScript-checked cannot opt in by being truthy.
  for (const value of ['true', 1, {}, null]) {
    const refused = resolveTarget('https://unlisted.example/run', { ...hosted, allowVisitorTargets: value as unknown as boolean });
    assert.equal(refused.ok, false, String(value));
    assert.match(refused.ok ? '' : refused.error, /allowVisitorTargets must be true or false/, String(value));
  }
});

test('an embedded policy cannot opt in: every request is refused, the page origin included', async () => {
  const { seen, fetch } = scripted();
  const policy: TransportPolicy = { ...embedded, allowVisitorTargets: true };
  const transport = createGuardedTransport(policy, { fetch });
  for (const url of ['/agent', 'https://host.example/agent', 'https://unlisted.example/run', 'http://localhost:8787/run']) {
    await assert.rejects(transport.send(post(url)), /hosted deployment/, url);
  }
  assert.equal(seen.length, 0);
  assert.equal(resolveTarget('/agent', policy).ok, false);
});

test('opted in, fixed origins cannot widen the boundary: a constructed policy with one outside it refuses everything', async () => {
  for (const entry of ['http://192.168.1.20:8787', 'http://agent.example', 'http://[::1]:8787', 'http://127.0.0.2:8787', 'not a url']) {
    const policy: TransportPolicy = { ...visitor, allowedOrigins: ['https://agent.example', entry] };
    const { seen, fetch } = scripted();
    const transport = createGuardedTransport(policy, { fetch });
    for (const url of ['https://agent.example/run', 'https://unlisted.example/run', 'http://localhost:8787/run', '/config.json', entry]) {
      await assert.rejects(transport.send(post(url)), (error: Error) => error.message.includes('allowedOrigins') && error.message.includes('HTTPS') && !/not an allowed destination/.test(error.message), `${entry} ${url}`);
    }
    assert.equal(seen.length, 0, entry);
  }
  // Fixed origins inside the boundary are fine, and redundant.
  const inside: TransportPolicy = { ...visitor, allowedOrigins: ['https://agent.example', 'http://localhost:8787', 'http://127.0.0.1:9'] };
  for (const url of ['https://agent.example/run', 'http://localhost:8787/run', 'http://127.0.0.1:9/run', 'https://unlisted.example/run']) assert.equal(resolveTarget(url, inside).ok, true, url);
});

test('the shared predicate is the whole boundary: https, or http to exactly localhost / 127.0.0.1, without userinfo', () => {
  const yes = (text: string) => isVisitorTarget(new URL(text));
  assert.deepEqual(VISITOR_LOOPBACK_HOSTS, ['localhost', '127.0.0.1']);
  for (const url of REACHABLE) assert.equal(yes(url), true, url);
  for (const url of REFUSED) assert.equal(yes(url), false, url);
  assert.equal(yes('https://user@unlisted.example/'), false);
  assert.equal(yes('ftp://localhost/'), false);
  assert.equal(yes('ws://localhost:1/'), false);
});
