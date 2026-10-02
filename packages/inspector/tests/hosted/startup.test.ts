// L07 T048 (US1, US2, FR-004, FR-005, FR-006, FR-037, FR-038, SC-008): the start of the page. The
// deployment's hosting-config.json becomes the transport policy and the content security policy
// before any other request; nothing loaded afterwards (a configuration, a capabilities URL, a typed
// endpoint, a redirect) can widen either; hosted requests carry no cookies; the token goes to the
// transport and nowhere else. Browser-level enforcement of the same rules is in tests/e2e/hosted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCapabilities } from '../../src/core/config/index.ts';
import { guardedFetchText } from '../../src/core/runtime/index.ts';
import { contentSecurityPolicy, parseHostingConfig, policyFor } from '../../src/app/security.ts';
import { startPage, type StartResult } from '../../src/app/startup.ts';

const PAGE = 'http://127.0.0.1:4000';
const AGENT = 'https://agent.example';
const OTHER = 'https://other.example';
const TOKEN = 'synthetic-token-7f3a91';

interface Seen {
  readonly url: string;
  readonly init: RequestInit;
}

/**
 * A page with a scripted network. `files` answers by absolute URL; anything else is a 404. The log
 * records requests and the moment the policy is added, in order, so a test can read the sequence.
 */
function page(files: Record<string, string | Response>, storage?: { items: Record<string, string> }, baseUrl = `${PAGE}/`) {
  const log: string[] = [];
  const seen: Seen[] = [];
  const policies: string[] = [];
  const document = {
    createElement: () => ({ httpEquiv: '', content: '' }),
    head: {
      append(meta: { httpEquiv: string; content: string }) {
        assert.equal(meta.httpEquiv, 'Content-Security-Policy');
        policies.push(meta.content);
        log.push('policy');
      },
    },
  } as unknown as Document;
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, init });
    log.push(`fetch ${url}`);
    const hit = files[url];
    if (hit instanceof Response) return hit.clone();
    return hit === undefined ? new Response('not found', { status: 404, statusText: 'Not Found' }) : new Response(hit, { status: 200 });
  }) as typeof globalThis.fetch;
  return {
    log,
    seen,
    policies,
    env: {
      document,
      origin: PAGE,
      baseUrl,
      fetch,
      ...(storage && { storage: { getItem: (key: string) => storage.items[key] ?? null, setItem: (key: string, value: string) => void (storage.items[key] = value) } }),
    },
  };
}

const hostedFile = (extra: object = {}) => JSON.stringify({ version: 0, mode: 'hosted', allowedOrigins: [AGENT], ...extra });
const agentsFile = (...agents: object[]) => JSON.stringify({ version: 0, agents });
const started = (result: StartResult) => {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result;
};

// ---------------------------------------------------------------------------------------------
// hosting-config.json
// ---------------------------------------------------------------------------------------------

test('a hosted file names its allowed origins, normalized and without duplicates', () => {
  const parsed = parseHostingConfig('{"version":0,"mode":"hosted","allowedOrigins":["https://agent.example","HTTPS://AGENT.example:443/","http://127.0.0.1:8787"],"config":"https://agent.example/inspector.json"}');
  assert.deepEqual(parsed, { ok: true, value: { mode: 'hosted', allowedOrigins: ['https://agent.example', 'http://127.0.0.1:8787'], config: 'https://agent.example/inspector.json' } });
  assert.deepEqual(parseHostingConfig('{"mode":"embedded"}'), { ok: true, value: { mode: 'embedded', allowedOrigins: [] } });
});

test('a hosting file that is malformed, ambiguous or wider than an origin is refused with a reason', () => {
  const cases: Array<[string, RegExp]> = [
    ['not json', /not valid JSON/],
    ['[]', /expected a JSON object/],
    ['{}', /mode must be/],
    ['{"mode":"proxy"}', /mode must be/],
    ['{"mode":"hosted","version":1}', /version must be 0/],
    ['{"mode":"hosted","allowedOrigin":["https://a.example"]}', /unknown field "allowedOrigin"/],
    ['{"mode":"hosted","allowedOrigins":"https://a.example"}', /must be an array/],
    ['{"mode":"hosted","allowedOrigins":[7]}', /nonempty string/],
    ['{"mode":"hosted","allowedOrigins":["*"]}', /wildcards/],
    ['{"mode":"hosted","allowedOrigins":["https://*.example"]}', /wildcards/],
    ['{"mode":"hosted","allowedOrigins":["agent.example"]}', /absolute URL/],
    ['{"mode":"hosted","allowedOrigins":["ftp://agent.example"]}', /http or https/],
    ['{"mode":"hosted","allowedOrigins":["https://user:pw@agent.example"]}', /credentials/],
    ['{"mode":"hosted","allowedOrigins":["https://agent.example/run"]}', /origin only/],
    ['{"mode":"hosted","allowedOrigins":["https://agent.example?x=1"]}', /origin only/],
    ['{"mode":"embedded","allowedOrigins":["https://agent.example"]}', /own origin only/],
    ['{"mode":"hosted","config":""}', /config must be/],
  ];
  for (const [text, message] of cases) {
    const parsed = parseHostingConfig(text);
    assert.ok(!parsed.ok, text);
    assert.match(parsed.error, message, text);
    assert.match(parsed.error, /^hosting-config\.json: /);
  }
});

// ---------------------------------------------------------------------------------------------
// The content security policy
// ---------------------------------------------------------------------------------------------

test('the policy allows scripts from the page only, no eval, and connections to the page plus the allowlist', () => {
  const hosted = contentSecurityPolicy(policyFor({ mode: 'hosted', allowedOrigins: [AGENT, 'http://127.0.0.1:8787'] }, PAGE));
  const directives = Object.fromEntries(hosted.split('; ').map((part) => [part.split(' ')[0], part.split(' ').slice(1)]));
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['connect-src'], ["'self'", AGENT, 'http://127.0.0.1:8787']);
  assert.deepEqual(directives['default-src'], ["'none'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.deepEqual(directives['base-uri'], ["'none'"]);
  assert.doesNotMatch(hosted, /unsafe-eval|unsafe-inline|wasm-unsafe-eval|\*|blob:|https?:\/\/(?!agent\.example|127\.0\.0\.1:8787)/);

  const embedded = contentSecurityPolicy(policyFor({ mode: 'embedded', allowedOrigins: [] }, PAGE));
  assert.match(embedded, /connect-src 'self'(?:;|$)/);
});

test('the policy and the transport policy are made from one list', () => {
  const policy = policyFor({ mode: 'hosted', allowedOrigins: [AGENT, OTHER] }, PAGE);
  assert.deepEqual(policy, { mode: 'hosted', pageOrigin: PAGE, allowedOrigins: [AGENT, OTHER] });
  assert.match(contentSecurityPolicy(policy), new RegExp(`connect-src 'self' ${AGENT} ${OTHER}(;|$)`));
});

// ---------------------------------------------------------------------------------------------
// Order: the policy is in place before any application request
// ---------------------------------------------------------------------------------------------

test('hosting-config.json is read first, the policy is added next, and only then are configuration and agent requested', async () => {
  const { env, log, policies } = page({
    [`${PAGE}/hosting-config.json`]: hostedFile(),
    [`${PAGE}/config.json`]: agentsFile({ id: 'support', url: `${AGENT}/run` }),
  });
  const result = started(await startPage(env));
  assert.deepEqual(log, [`fetch ${PAGE}/hosting-config.json`, 'policy', `fetch ${PAGE}/config.json`]);
  assert.equal(policies.length, 1);
  assert.match(policies[0] ?? '', new RegExp(`connect-src 'self' ${AGENT}(;|$)`));
  assert.deepEqual(result.policy, { mode: 'hosted', pageOrigin: PAGE, allowedOrigins: [AGENT] });
  assert.equal(result.selectedAgentId, 'support', 'the first configured agent is selected');
  assert.equal(result.runtime.getState().connection.targetUrl, `${AGENT}/run`);
});

test('under a mount path, hosting-config.json and config.json are read beside the page and never from the origin root', async () => {
  for (const mount of ['/agui-inspector/', '/tools/inspector/']) {
    const { env, seen } = page(
      { [`${PAGE}${mount}config.json`]: agentsFile({ id: 'demo', url: '/agents/demo/stream' }) },
      undefined,
      `${PAGE}${mount}`,
    );
    const result = started(await startPage(env));
    assert.deepEqual(
      seen.map((request) => request.url),
      [`${PAGE}${mount}hosting-config.json`, `${PAGE}${mount}config.json`],
      mount,
    );
    assert.equal(result.selectedAgentId, 'demo', mount);
    assert.equal(result.error, undefined, mount);
    assert.deepEqual(result.policy, { mode: 'embedded', pageOrigin: PAGE, allowedOrigins: [] });
  }
});

test('a relative config in hosting-config.json is read beside the page, an origin-relative one from the origin', async () => {
  const mount = `${PAGE}/tools/inspector/`;
  const beside = page({ [`${mount}hosting-config.json`]: hostedFile({ config: 'agents.json' }), [`${mount}agents.json`]: agentsFile({ id: 'a', url: `${AGENT}/run` }) }, undefined, mount);
  assert.equal(started(await startPage(beside.env)).selectedAgentId, 'a');
  const root = page({ [`${mount}hosting-config.json`]: hostedFile({ config: '/agents.json' }), [`${PAGE}/agents.json`]: agentsFile({ id: 'r', url: `${AGENT}/run` }) }, undefined, mount);
  assert.equal(started(await startPage(root.env)).selectedAgentId, 'r');
});

test('the one request made before the policy is the deployment file, read as the page itself with no redirects', async () => {
  const { env, seen } = page({ [`${PAGE}/hosting-config.json`]: hostedFile() });
  started(await startPage(env));
  assert.equal(seen[0]?.url, `${PAGE}/hosting-config.json`);
  assert.equal(seen[0]?.init.credentials, 'same-origin');
  assert.equal(seen[0]?.init.redirect, 'error');
  assert.equal(seen[0]?.init.referrerPolicy, 'no-referrer');
});

test('without a hosting file the page is embedded: its own origin only, and a missing config.json is not an error', async () => {
  const { env, log, policies } = page({});
  const result = started(await startPage(env));
  assert.deepEqual(log, [`fetch ${PAGE}/hosting-config.json`, 'policy', `fetch ${PAGE}/config.json`]);
  assert.deepEqual(result.policy, { mode: 'embedded', pageOrigin: PAGE, allowedOrigins: [] });
  assert.match(policies[0] ?? '', /connect-src 'self'(;|$)/);
  assert.deepEqual(result.agents, []);
  assert.equal(result.error, undefined);
  assert.equal(result.selectedAgentId, undefined);
});

test('a hosting file that cannot be used stops the start: no policy is guessed and nothing else is requested', async () => {
  for (const files of [
    { [`${PAGE}/hosting-config.json`]: 'not json' },
    { [`${PAGE}/hosting-config.json`]: '{"mode":"hosted","allowedOrigins":["*"]}' },
    { [`${PAGE}/hosting-config.json`]: new Response('boom', { status: 500 }) },
  ]) {
    const { env, log, policies } = page(files);
    const result = await startPage(env);
    assert.ok(!result.ok);
    assert.match(result.error, /hosting-config\.json/);
    assert.deepEqual(log, [`fetch ${PAGE}/hosting-config.json`]);
    assert.deepEqual(policies, []);
  }
  const { env } = page({});
  const unreachable = await startPage({ ...env, fetch: (async () => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch });
  assert.ok(!unreachable.ok);
});

test('a failed read of hosting-config.json, as a redirect is with redirect: error, stops the start', async () => {
  const { env } = page({});
  const refused = await startPage({ ...env, fetch: (async () => Promise.reject(new TypeError('redirect mode is set to error'))) as typeof fetch });
  assert.ok(!refused.ok);
  assert.match(refused.error, /could not be read/);
});

// ---------------------------------------------------------------------------------------------
// Escalation: nothing loaded later widens the policy
// ---------------------------------------------------------------------------------------------

test('a configuration URL outside the allowlist is refused before any request is made to it', async () => {
  const { env, seen } = page({ [`${PAGE}/hosting-config.json`]: hostedFile({ config: `${OTHER}/config.json` }), [`${OTHER}/config.json`]: agentsFile({ id: 'x', url: `${OTHER}/run` }) });
  const result = started(await startPage(env));
  assert.match(result.error ?? '', /https:\/\/other\.example is not an allowed destination/);
  assert.deepEqual(result.agents, []);
  assert.ok(!seen.some((request) => request.url.startsWith(OTHER)));
});

test('an allowed configuration URL is read without cookies, and an agent in it cannot add a destination', async () => {
  const { env, seen } = page({
    [`${PAGE}/hosting-config.json`]: hostedFile({ config: `${AGENT}/inspector.json` }),
    [`${AGENT}/inspector.json`]: agentsFile({ id: 'sneaky', url: `${OTHER}/run`, capabilities: `${OTHER}/capabilities` }, { id: 'ok', url: `${AGENT}/run` }),
  });
  const result = started(await startPage(env));
  assert.equal(seen.find((request) => request.url === `${AGENT}/inspector.json`)?.init.credentials, 'omit');
  assert.equal(result.selectedAgentId, 'sneaky');
  assert.match(result.runtime.getState().error ?? '', /https:\/\/other\.example is not an allowed destination/);
  assert.equal(result.runtime.getState().connection.targetUrl, `${OTHER}/run`, 'the refused target is shown so the error makes sense');

  // Sending to it does nothing, and so does reading its capabilities.
  await result.runtime.send('hello');
  const capabilities = await loadCapabilities({ id: 'sneaky', url: `${OTHER}/run`, capabilities: `${OTHER}/capabilities` }, guardedFetchText(result.runtime.transport));
  assert.ok(!capabilities.ok);
  assert.match(capabilities.error, /not an allowed destination/);
  assert.ok(!seen.some((request) => request.url.startsWith(OTHER)), 'no request ever reached the origin the configuration named');
});

test('a typed endpoint outside the allowlist, with userinfo, or relative while hosted is refused and sends nothing', async () => {
  const { env, seen } = page({ [`${PAGE}/hosting-config.json`]: hostedFile() });
  const { runtime } = started(await startPage(env));
  const before = seen.length;
  for (const [url, message] of [
    [`${OTHER}/run`, /not an allowed destination/],
    [`https://user:hunter2@agent.example/run`, /user:password@/],
    ['/run', /absolute/],
    [`http://agent.example/run`, /not an allowed destination/],
  ] as const) {
    runtime.setTarget(url);
    assert.match(runtime.getState().error ?? '', message, url);
    assert.ok(!(runtime.getState().error ?? '').includes('hunter2'));
    await runtime.send('hello');
    await runtime.sendRaw('{}');
  }
  assert.equal(seen.length, before, 'no request was made for a refused target');
});

test('a redirect from the configuration is shown and not followed', async () => {
  const redirect = new Response(null, { status: 302 });
  const { env, seen } = page({ [`${PAGE}/hosting-config.json`]: hostedFile(), [`${PAGE}/config.json`]: redirect });
  const result = started(await startPage(env));
  assert.match(result.error ?? '', /redirect/);
  assert.equal(seen.filter((request) => request.url !== `${PAGE}/hosting-config.json`).length, 1, 'exactly the configuration request, no second one');
  assert.equal(seen.at(-1)?.init.redirect, 'manual');
});

test('a broken configuration is shown rather than ignored, but only a missing optional file is quiet', async () => {
  const broken = page({ [`${PAGE}/config.json`]: '{"agents":[{"id":"a"}]}' });
  assert.match(started(await startPage(broken.env)).error ?? '', /Configuration config\.json/);

  const named = page({ [`${PAGE}/hosting-config.json`]: hostedFile({ config: `${AGENT}/inspector.json` }) });
  assert.match(started(await startPage(named.env)).error ?? '', /404/, 'a configuration the deployment named must exist');
});

// ---------------------------------------------------------------------------------------------
// Cookies and the token
// ---------------------------------------------------------------------------------------------

const runStream = () =>
  new Response(
    [
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'success' } },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

test('hosted: configuration, capabilities and the run carry no cookies, not even to the page itself', async () => {
  const { env, seen } = page({
    [`${PAGE}/hosting-config.json`]: hostedFile(),
    [`${PAGE}/config.json`]: agentsFile({ id: 'support', url: `${AGENT}/run`, capabilities: `${AGENT}/capabilities` }),
    [`${AGENT}/capabilities`]: '{}',
    [`${AGENT}/run`]: runStream(),
  });
  const { runtime } = started(await startPage(env));
  await loadCapabilities({ id: 'support', url: `${AGENT}/run`, capabilities: `${AGENT}/capabilities` }, guardedFetchText(runtime.transport));
  await runtime.send('hello');
  const sent = seen.filter((request) => request.url !== `${PAGE}/hosting-config.json`);
  assert.deepEqual(sent.map((request) => request.url), [`${PAGE}/config.json`, `${AGENT}/capabilities`, `${AGENT}/run`]);
  for (const request of sent) {
    assert.equal(request.init.credentials, 'omit', request.url);
    assert.equal(request.init.referrerPolicy, 'no-referrer', request.url);
    assert.equal(request.init.redirect, 'manual', request.url);
    assert.equal(new Headers(request.init.headers).has('cookie'), false, request.url);
  }
});

test('embedded: the page and its own agents use the host credentials, and a foreign origin is not reachable', async () => {
  const { env, seen } = page({
    [`${PAGE}/config.json`]: agentsFile({ id: 'support', url: '/agents/support/stream' }),
    [`${PAGE}/agents/support/stream`]: runStream(),
  });
  const { runtime } = started(await startPage(env));
  await runtime.send('hello');
  const run = seen.find((request) => request.url === `${PAGE}/agents/support/stream`);
  assert.equal(run?.init.credentials, 'same-origin');
  assert.equal(seen.find((request) => request.url === `${PAGE}/config.json`)?.init.credentials, 'same-origin');
  runtime.setTarget(`${AGENT}/run`);
  assert.match(runtime.getState().error ?? '', /not an allowed destination/);
});

test('the token reaches the transport and nothing else: not the store, the settings, storage or an error', async () => {
  const storage = { items: {} as Record<string, string> };
  const { env, seen } = page(
    {
      [`${PAGE}/hosting-config.json`]: hostedFile(),
      [`${PAGE}/config.json`]: agentsFile({ id: 'support', url: `${AGENT}/run` }),
      [`${AGENT}/run`]: runStream(),
    },
    storage,
  );
  const { runtime, store, settings } = started(await startPage(env));
  runtime.setAuth({ headerName: 'X-Api-Key', token: TOKEN });
  await runtime.send('hello');
  await runtime.sendRaw('{"threadId":"t"}');

  const withToken = seen.filter((request) => new Headers(request.init.headers).get('x-api-key') === TOKEN);
  assert.equal(withToken.length, 2, 'the run and the raw request carry it as the chosen header');
  assert.ok(withToken.every((request) => request.url === `${AGENT}/run`));
  assert.equal(seen.filter((request) => request.url !== `${AGENT}/run` && JSON.stringify(request.init).includes(TOKEN)).length, 0, 'it never rides a configuration request');

  // Unreferenced anywhere a person could look or a file could be written.
  for (const place of [store.snapshot(), settings, storage.items, runtime.getState().error ?? '']) {
    assert.ok(!JSON.stringify(place).includes(TOKEN));
  }
  assert.ok(!JSON.stringify(store.snapshot()).toLowerCase().includes('x-api-key'), 'no header name is recorded either');

  // Changing the target clears it before anything is sent to the new one.
  assert.equal(runtime.setTarget(`${AGENT}/other`), true);
  assert.equal(runtime.getState().connection.auth, undefined);
});

test('a saved profile is restored at the start, and a saved profile that no longer parses is reported', async () => {
  const storage = { items: { 'agui-inspector.profile': 'not json' } as Record<string, string> };
  const bad = started(await startPage(page({}, storage).env));
  assert.match(bad.error ?? '', /profile/i);
  assert.equal(bad.settings.profile.protocolVersion, '1.0', 'defaults stay in force');
});

// ---------------------------------------------------------------------------------------------
// Theme maps (FR-041, G-09, SC-010): delivered by config.json, never by a request or a wider policy
// ---------------------------------------------------------------------------------------------

const themeFile = (theme: unknown) => JSON.stringify({ version: 0, agents: [{ id: 'support', url: `${AGENT}/run` }], theme });

test('the theme in config.json is handed to the page with no extra request, in every deployment mode', async () => {
  const theme = { light: { '--agui-accent': '#2563eb' }, dark: { '--agui-accent': '#93c5fd', '--agui-radius': '4px' } };
  const hosted = page({ [`${PAGE}/hosting-config.json`]: hostedFile(), [`${PAGE}/config.json`]: themeFile(theme) });
  const embedded = page({ [`${PAGE}/config.json`]: themeFile(theme) });
  const bare = page({ [`${PAGE}/hosting-config.json`]: hostedFile(), [`${PAGE}/config.json`]: agentsFile({ id: 'support', url: `${AGENT}/run` }) });
  for (const [name, site] of [['hosted', hosted], ['embedded', embedded]] as const) {
    const result = started(await startPage(site.env));
    assert.deepEqual(result.theme, theme, name);
    assert.deepEqual(result.warnings, [], name);
    assert.equal(result.error, undefined, name);
    assert.equal(result.selectedAgentId, 'support', name);
    assert.deepEqual(site.seen.map((request) => request.url), [`${PAGE}/hosting-config.json`, `${PAGE}/config.json`], `${name}: the same two requests as without a theme`);
  }
  const plain = started(await startPage(bare.env));
  assert.equal(plain.theme, undefined);
  assert.deepEqual(plain.warnings, []);
  assert.deepEqual(hosted.log.map((entry) => entry.replace(PAGE, '')), bare.log.map((entry) => entry.replace(PAGE, '')));
  assert.deepEqual(hosted.policies, bare.policies, 'the content security policy is the same with and without a theme');
});

test('rejected overrides are warnings: the valid ones and the agents are kept, no request starts and the policy is unchanged', async () => {
  const theme = {
    light: { '--agui-accent': 'url(https://evil.example/pixel.png)', '--agui-radius': '3px' },
    dark: { '--bg': 'red', '--agui-font-sans': 'x; y', '--agui-density': '0.9' },
    sepia: {},
  };
  const site = page({ [`${PAGE}/hosting-config.json`]: hostedFile(), [`${PAGE}/config.json`]: themeFile(theme) });
  const result = started(await startPage(site.env));
  assert.deepEqual(result.theme, { light: { '--agui-radius': '3px' }, dark: { '--agui-density': '0.9' } });
  assert.equal(result.warnings.length, 4);
  assert.match(result.warnings.join('\n'), /--agui-accent/);
  assert.match(result.warnings.join('\n'), /--bg/);
  assert.match(result.warnings.join('\n'), /--agui-font-sans/);
  assert.match(result.warnings.join('\n'), /"sepia"/);
  assert.equal(result.error, undefined, 'a theme warning is not the start error');
  assert.equal(result.agents.length, 1);
  assert.equal(result.selectedAgentId, 'support');
  assert.ok(site.seen.every((request) => !request.url.includes('evil.example')));
  assert.deepEqual(site.seen.map((request) => request.url), [`${PAGE}/hosting-config.json`, `${PAGE}/config.json`]);
  assert.equal(site.policies.length, 1);
  assert.equal(site.policies[0], contentSecurityPolicy(policyFor({ mode: 'hosted', allowedOrigins: [AGENT] }, PAGE)));
  assert.doesNotMatch(site.policies[0] ?? '', /unsafe-inline|unsafe-eval|evil/);
});

test('a theme of the wrong shape is one warning and the start is otherwise unchanged', async () => {
  const site = page({ [`${PAGE}/config.json`]: themeFile('cobalt') });
  const result = started(await startPage(site.env));
  assert.equal(result.theme, undefined);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.agents.length, 1);
  assert.equal(result.error, undefined);
});
