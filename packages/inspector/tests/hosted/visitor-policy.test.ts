// P01 T001 (US2, FR-007 to FR-009, constitution IV, G-D02): the opt-in hosted visitor-target policy.
// The deployer's hosting-config.json can say `allowVisitorTargets: true`; the parser, the transport
// policy, the content security policy and every guarded caller then agree on one boundary: any HTTPS
// origin, and plain HTTP to exactly localhost or 127.0.0.1 on any port. Nothing else widens, and the
// option is off unless the file says so. The browser's own enforcement of the same boundary is in
// tests/e2e/visitor-policy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentConfig, TransportPolicy } from '../../src/contracts.ts';
import { loadCapabilities } from '../../src/core/config/index.ts';
import { contentSecurityPolicy, parseHostingConfig, policyFor } from '../../src/app/security.ts';
import { guardedFetchText, isVisitorTarget, resolveTarget, VISITOR_LOOPBACK_HOSTS } from '../../src/core/runtime/transport.ts';
import { rig, replyRoute, type Route } from '../runtime/support.ts';

const PAGE = 'https://inspector.example';
const TOKEN = 'synthetic-token-7f3a91';

const file = (extra: object, mode: 'hosted' | 'embedded' = 'hosted') => JSON.stringify({ version: 0, mode, ...extra });
const parsed = (text: string) => {
  const result = parseHostingConfig(text);
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.value;
};
const refused = (text: string) => {
  const result = parseHostingConfig(text);
  assert.ok(!result.ok, text);
  assert.match(result.error, /^hosting-config\.json: /);
  return result.error;
};

// ---------------------------------------------------------------------------------------------
// The startup option
// ---------------------------------------------------------------------------------------------

test('the option is off unless the file says true: absent and false mean the same fixed-allowlist policy as before', () => {
  const absent = parsed(file({ allowedOrigins: ['https://agent.example'] }));
  assert.deepEqual(absent, { mode: 'hosted', allowedOrigins: ['https://agent.example'] });
  assert.deepEqual(policyFor(absent, PAGE), { mode: 'hosted', pageOrigin: PAGE, allowedOrigins: ['https://agent.example'] });

  const off = parsed(file({ allowedOrigins: ['https://agent.example'], allowVisitorTargets: false }));
  assert.equal(off.allowVisitorTargets, false);
  assert.deepEqual(policyFor(off, PAGE), policyFor(absent, PAGE), 'false is not carried: the policy is the one an old file produces');
  assert.equal(contentSecurityPolicy(policyFor(off, PAGE)), contentSecurityPolicy(policyFor(absent, PAGE)));

  const on = parsed(file({ allowVisitorTargets: true }));
  assert.deepEqual(on, { mode: 'hosted', allowedOrigins: [], allowVisitorTargets: true });
  assert.deepEqual(policyFor(on, PAGE), { mode: 'hosted', pageOrigin: PAGE, allowedOrigins: [], allowVisitorTargets: true });
});

test('an embedded file that mentions the option at all, even false, is refused', () => {
  for (const value of [true, false]) {
    assert.match(refused(file({ allowVisitorTargets: value }, 'embedded')), /embedded page reaches its own origin only; allowVisitorTargets belongs to a hosted deployment/, String(value));
  }
  assert.match(refused(file({ allowVisitorTargets: 'yes' }, 'embedded')), /allowVisitorTargets/);
});

test('a value that is not a boolean, and a misspelled key, are refused rather than read as "no restriction"', () => {
  for (const value of ['true', 'yes', 1, 0, null, [], {}, [true]]) {
    assert.match(refused(file({ allowVisitorTargets: value })), /allowVisitorTargets must be true or false/, JSON.stringify(value));
  }
  for (const key of ['allowVisitorTarget', 'allowvisitortargets', 'AllowVisitorTargets', 'allowVisitorTargets ', 'visitorTargets', 'allowAnyTarget']) {
    assert.match(refused(file({ [key]: true })), new RegExp(`unknown field "${key}"`), key);
  }
});

test('opted in, every fixed origin must already be inside the boundary; outside ones fail the start with the entry named', () => {
  for (const entry of [
    'http://agent.example',
    'http://agent.example:8787',
    'http://192.168.1.20:8787',
    'http://10.0.0.1',
    'http://127.0.0.2:8787',
    'http://[::1]:8787',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example',
    'http://foo.localhost:8787',
  ]) {
    const message = refused(file({ allowedOrigins: ['https://agent.example', entry], allowVisitorTargets: true }));
    assert.match(message, /allowedOrigins\[1\]/, entry);
    assert.match(message, /outside the visitor-target boundary/, entry);
    assert.ok(message.includes(entry), `${entry} is named`);
    // The same entry is fine while the option is off: default-off semantics are unchanged.
    assert.deepEqual(parsed(file({ allowedOrigins: [entry] })).allowedOrigins, [new URL(entry).origin], entry);
    assert.deepEqual(parsed(file({ allowedOrigins: [entry], allowVisitorTargets: false })).allowedOrigins, [new URL(entry).origin], entry);
  }
});

test('opted in, fixed origins inside the boundary are kept, normalized, and the other strict rules still apply', () => {
  const value = parsed(
    file({ allowVisitorTargets: true, allowedOrigins: ['https://agent.example', 'HTTPS://AGENT.example:443/', 'http://localhost:8787', 'http://127.1:8787', 'http://LOCALHOST', 'https://[::1]:8443'] }),
  );
  assert.deepEqual(value.allowedOrigins, ['https://agent.example', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://localhost', 'https://[::1]:8443']);
  for (const [entry, message] of [
    ['https://*.example', /wildcards/],
    ['https://user:pw@agent.example', /credentials/],
    ['https://agent.example/run', /origin only/],
    ['ftp://agent.example', /http or https/],
  ] as const) {
    assert.match(refused(file({ allowVisitorTargets: true, allowedOrigins: [entry] })), message, entry);
  }
});

// ---------------------------------------------------------------------------------------------
// The content security policy
// ---------------------------------------------------------------------------------------------

const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((part) => [part.split(' ')[0] as string, part.split(' ').slice(1)]));
const optedIn = (patch: Partial<TransportPolicy> = {}): TransportPolicy => ({ mode: 'hosted', pageOrigin: PAGE, allowedOrigins: [], allowVisitorTargets: true, ...patch });

test('opted in, connect-src is the page, https: and the exact local hosts on any port, and nothing else changes', () => {
  const csp = contentSecurityPolicy(optedIn());
  assert.deepEqual(directives(csp)['connect-src'], ["'self'", 'https:', 'http://localhost:*', 'http://127.0.0.1:*']);
  assert.deepEqual(
    VISITOR_LOOPBACK_HOSTS.map((host) => `http://${host}:*`),
    ['http://localhost:*', 'http://127.0.0.1:*'],
    'the sources come from the same host list the transport predicate uses',
  );
  // No wildcard host, no bare http:, no IPv6 claim, no eval, no inline script: the other directives are the default-off ones.
  assert.doesNotMatch(csp, /(?:^|[ ;])http:(?:[ ;]|$)|(?:^|[ ])\*(?:[ ;]|$)|\[::1\]|unsafe-eval|unsafe-inline|wasm-unsafe-eval|blob:/);
  const withoutConnect = (text: string) => text.split('; ').filter((part) => !part.startsWith('connect-src')).join('; ');
  assert.equal(withoutConnect(csp), withoutConnect(contentSecurityPolicy(optedIn({ allowVisitorTargets: false }))));
  assert.deepEqual(directives(csp)['script-src'], ["'self'"]);
  assert.deepEqual(directives(csp)['img-src'], ["'self'", 'data:']);
  assert.deepEqual(directives(csp)['default-src'], ["'none'"]);
});

test('without the option the connect-src is the page plus the fixed list, exactly as before', () => {
  const fixed = contentSecurityPolicy({ mode: 'hosted', pageOrigin: PAGE, allowedOrigins: ['https://agent.example', 'http://127.0.0.1:8787'] });
  assert.deepEqual(directives(fixed)['connect-src'], ["'self'", 'https://agent.example', 'http://127.0.0.1:8787']);
  assert.match(contentSecurityPolicy({ mode: 'hosted', pageOrigin: PAGE, allowedOrigins: [], allowVisitorTargets: false }), /connect-src 'self'(?:;|$)/);
  assert.match(contentSecurityPolicy({ mode: 'embedded', pageOrigin: PAGE, allowedOrigins: [] }), /connect-src 'self'(?:;|$)/);
  // An embedded policy that somehow says true is not widened.
  assert.match(contentSecurityPolicy({ mode: 'embedded', pageOrigin: PAGE, allowedOrigins: [], allowVisitorTargets: true }), /connect-src 'self'(?:;|$)/);
});

/** Whether a CSP3 connect-src source list lets `page` connect to `url`: the subset of matching this policy uses. */
function cspAllows(csp: string, url: URL, page: URL): boolean {
  return (directives(csp)['connect-src'] ?? []).some((source) => {
    if (source === "'self'") return url.origin === page.origin;
    const scheme = /^([a-z]+):$/.exec(source);
    if (scheme) return url.protocol === source || (source === 'https:' && url.protocol === 'wss:');
    const host = /^(https?):\/\/([^:/]+)(?::(\*|\d+))?$/.exec(source);
    if (!host) throw new Error(`source not understood by the test: ${source}`);
    const [, sourceScheme, sourceHost, sourcePort] = host;
    const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
    const schemeOk = url.protocol === `${sourceScheme}:` || (sourceScheme === 'http' && url.protocol === 'https:');
    const wanted = sourcePort ?? (sourceScheme === 'https' ? '443' : '80');
    return schemeOk && url.hostname === sourceHost && (wanted === '*' || wanted === port);
  });
}

test('the transport policy and the content security policy agree on every destination in the table', () => {
  const policy = optedIn();
  const csp = contentSecurityPolicy(policy);
  const page = new URL(PAGE);
  const table = [
    'https://agent.example/run', 'https://sub.agent.example:8443/run', 'https://127.0.0.1:9/', 'https://[::1]:8443/', 'https://localhost:8443/',
    'http://localhost/', 'http://localhost:8787/', 'http://LOCALHOST:8787/', 'http://127.0.0.1/', 'http://127.0.0.1:8787/',
    'http://127.1:8787/', 'http://0x7f.0.0.1:8787/', 'http://2130706433:8787/', 'http://127.0.0.1.:8787/',
    'http://127.0.0.2:8787/', 'http://127.255.255.254/', 'http://0.0.0.0/', 'http://192.168.1.20:8787/', 'http://10.0.0.1/', 'http://169.254.169.254/',
    'http://agent.example/', 'http://inspector.example/', 'http://localhost.:8787/', 'http://foo.localhost:8787/', 'http://localhost.evil.example/',
    'http://127.0.0.1.evil.example/', 'http://evil-localhost:8787/', 'http://localhost%2eevil.example/',
    'http://[::1]:8787/', 'http://[::ffff:127.0.0.1]:8787/', 'http://[0:0:0:0:0:0:0:1]/',
    'https://inspector.example/config.json',
  ];
  for (const text of table) {
    const url = new URL(text);
    const guard = resolveTarget(text, policy).ok;
    assert.equal(guard, cspAllows(csp, url, page), `${text}: the guard says ${guard}, the policy says otherwise`);
    if (url.protocol === 'http:' || url.protocol === 'https:') assert.equal(guard, url.origin === page.origin || isVisitorTarget(url), text);
  }
  // Default-off: the same equality for a fixed list.
  const fixed: TransportPolicy = { mode: 'hosted', pageOrigin: PAGE, allowedOrigins: ['https://agent.example', 'http://127.0.0.1:8787'] };
  for (const text of table) assert.equal(resolveTarget(text, fixed).ok, cspAllows(contentSecurityPolicy(fixed), new URL(text), page), text);
});

// ---------------------------------------------------------------------------------------------
// Every guarded caller shares the predicate (config, capabilities, preparation, run, raw)
// ---------------------------------------------------------------------------------------------

const UNLISTED = 'https://unlisted.example';
const LOCAL = 'http://localhost:8787';

const agent = (url: string, extra: Partial<AgentConfig> = {}): AgentConfig => ({
  id: 'a',
  url: `${url}/run`,
  capabilities: `${url}/capabilities`,
  preset: { prepare: [{ method: 'PUT', path: '/prepare/sessions/{{threadId}}' }], messages: 'full' },
  ...extra,
});

const answers = (path = '/run'): Route[] => [
  replyRoute(path),
  (call) => (call.path.startsWith('/prepare/') ? new Response('{"ok":true}') : undefined),
  (call) => (call.path === '/capabilities' ? new Response('{"identity":{"name":"Unlisted agent","version":"1"}}') : undefined),
];

test('opted in: capabilities, preparation, run and raw request all reach an unlisted HTTPS or local target, without cookies', async () => {
  for (const base of [UNLISTED, LOCAL, 'http://127.0.0.1:9']) {
    const { runtime, net, settle } = rig(answers(), { policy: optedIn() });
    const target = agent(base);
    runtime.selectAgent(target);

    const capabilities = await loadCapabilities(target, guardedFetchText(runtime.transport));
    assert.ok(capabilities.ok, base);
    await runtime.send('hello');
    await runtime.sendRaw(JSON.stringify({ threadId: 't', runId: 'r', messages: [], tools: [], context: [], forwardedProps: {}, state: {} }));
    const session = await settle();

    assert.equal(runtime.getState().error, undefined, base);
    assert.deepEqual(
      net.calls.map((call) => `${call.method} ${call.path.replace(/(sessions\/).*/, '$1_')}`),
      ['GET /capabilities', 'PUT /prepare/sessions/_', 'POST /run', 'POST /run'],
      base,
    );
    assert.ok(net.calls.every((call) => call.url.startsWith(`${base}/`)), base);
    assert.ok(net.calls.every((call) => call.credentials === 'omit' && !('cookie' in call.headers)), `${base}: no cookies, no cookie header`);
    assert.deepEqual(
      session.exchanges.map((exchange) => exchange.kind),
      ['preparation', 'conversation', 'raw'],
      base,
    );
    assert.ok(!JSON.stringify(session).toLowerCase().includes('"headers"'), 'no header is recorded');
  }
});

test('opted in, the token goes to an unlisted target as the chosen header and is in no recorded value', async () => {
  const { runtime, net, settle } = rig(answers(), { policy: optedIn() });
  runtime.selectAgent(agent(UNLISTED));
  runtime.setAuth({ headerName: 'X-Api-Key', token: TOKEN });
  await runtime.send('hello');
  const session = await settle();
  assert.ok(net.calls.filter((call) => call.path === '/run').every((call) => call.headers['x-api-key'] === TOKEN));
  assert.ok(!JSON.stringify(session).includes(TOKEN));
  assert.ok(!(runtime.getState().error ?? '').includes(TOKEN));
});

test('opted in, a typed endpoint is accepted when it is inside the boundary and refused, with nothing sent, when it is not', async () => {
  const { runtime, net } = rig(answers(), { policy: optedIn() });
  for (const url of [`${UNLISTED}/run`, `${LOCAL}/run`, 'http://127.0.0.1:9/run', 'http://127.1:9/run']) {
    runtime.setTarget(url);
    assert.equal(runtime.getState().error, undefined, url);
  }
  const before = net.calls.length;
  for (const [url, message] of [
    ['http://unlisted.example/run', /not an allowed destination/],
    ['http://192.168.1.20:8787/run', /not an allowed destination/],
    ['http://[::1]:8787/run', /IPv6/],
    ['https://user:hunter2@unlisted.example/run', /user:password@/],
    ['/run', /absolute/],
    ['//unlisted.example/run', /absolute/],
  ] as const) {
    runtime.setTarget(url);
    assert.match(runtime.getState().error ?? '', message, url);
    assert.ok(!(runtime.getState().error ?? '').includes('hunter2'));
    await runtime.send('hello');
    await runtime.sendRaw('{}');
    if (/^https?:/.test(url)) assert.ok(!(await loadCapabilities({ id: 'x', url, capabilities: url }, guardedFetchText(runtime.transport))).ok, url);
  }
  assert.equal(net.calls.length, before, 'no request was made for a refused destination, by any caller');
});

test('opted in, a preparation or capabilities URL outside the boundary fails the run before it is sent', async () => {
  const { runtime, net } = rig(answers(), { policy: optedIn() });
  runtime.selectAgent(agent(UNLISTED, { preset: { prepare: [{ method: 'POST', path: 'http://192.168.1.20:8787/prepare/warm' }] } }));
  await runtime.send('hello');
  assert.match(runtime.getState().error ?? '', /Preparation failed.*not an allowed destination/s);
  assert.deepEqual(net.calls, [], 'neither the preparation nor the run was requested');
});

test('without the option each caller still refuses an unlisted target: absent, false and a constructed policy alike', async () => {
  for (const policy of [undefined, { allowVisitorTargets: false }]) {
    const { runtime, net } = rig(answers(), { policy: { mode: 'hosted', pageOrigin: PAGE, allowedOrigins: ['https://agent.example'], ...policy } });
    runtime.selectAgent(agent(UNLISTED));
    await runtime.send('hello');
    await runtime.sendRaw('{}');
    assert.match(runtime.getState().error ?? '', /not an allowed destination/);
    const capabilities = await loadCapabilities(agent(UNLISTED), guardedFetchText(runtime.transport));
    assert.ok(!capabilities.ok);
    assert.deepEqual(net.calls, []);
  }
});

test('a constructed policy with an out-of-bound fixed origin, or an embedded one that opts in, is refused by every caller', async () => {
  for (const policy of [
    optedIn({ allowedOrigins: ['http://192.168.1.20:8787'] }),
    optedIn({ allowedOrigins: ['http://[::1]:8787', 'https://agent.example'] }),
    { mode: 'embedded', pageOrigin: PAGE, allowedOrigins: [], allowVisitorTargets: true } satisfies TransportPolicy,
    optedIn({ allowVisitorTargets: 'true' as unknown as boolean }),
  ]) {
    const { runtime, net } = rig(answers(), { policy });
    runtime.selectAgent(agent(UNLISTED));
    await runtime.send('hello');
    await runtime.sendRaw('{}');
    assert.match(runtime.getState().error ?? '', /allowVisitorTargets|allowedOrigins|hosted deployment/);
    assert.ok(!(await loadCapabilities(agent(UNLISTED), guardedFetchText(runtime.transport))).ok);
    assert.deepEqual(net.calls, [], JSON.stringify(policy));
  }
});
