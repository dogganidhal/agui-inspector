// Spec 014 (FR-004 to FR-006, FR-015, FR-017, FR-018): the plugin host. It loads the modules, activates each plugin on
// its own with a frozen API object, keeps what a plugin registered only when its function ends without error, and shows
// every failure as one warning. `importModule` is a stub, so nothing here needs a browser or a network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunAgentInput } from '@ag-ui/core';
import { PLUGIN_API_VERSION, type BeforeRunHook, type HeaderProvider, type PluginApi } from '../../src/contracts.ts';
import { createPluginHost, MAX_MESSAGE, MAX_WARNINGS } from '../../src/core/plugins/index.ts';

const PAGE = { origin: 'https://inspector.example', baseUrl: 'https://inspector.example/tools/inspector/' };
const at = (name: string) => `https://inspector.example/tools/inspector/plugins/${name}.js`;
const label = (name: string) => `/tools/inspector/plugins/${name}.js`;

type Activate = (api: PluginApi) => unknown;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const never = () => new Promise<never>(() => undefined);

/** A stub for `import()`: a module for each address, or a rejection or a hang. */
function modules(table: Record<string, Activate | Error | 'hang' | unknown>) {
  const calls: string[] = [];
  const importModule = (address: string): Promise<unknown> => {
    calls.push(address);
    const entry = table[address];
    if (entry === 'hang') return never();
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve(typeof entry === 'function' ? { default: entry } : entry);
  };
  return { calls, importModule };
}

const host = (timeoutMs?: number) => createPluginHost(timeoutMs === undefined ? {} : { timeoutMs });
const noop = () => {};

test('no plugins: nothing is imported, nothing is counted and there is no warning', async () => {
  const plugins = host();
  const { calls, importModule } = modules({});
  await plugins.load([], importModule, PAGE);
  assert.deepEqual(calls, []);
  assert.equal(plugins.count(), 0);
  assert.deepEqual(plugins.warnings(), []);
});

test('every module is requested before any is activated, and activation follows the written order', async () => {
  const plugins = host();
  const events: string[] = [];
  const first = new Promise<unknown>((resolve) => setTimeout(() => resolve({ default: () => events.push('activate a') }), 30));
  const calls: string[] = [];
  const importModule = (address: string) => {
    calls.push(address);
    events.push(`request ${address === at('a') ? 'a' : 'b'}`);
    return address === at('a') ? first : Promise.resolve({ default: () => events.push('activate b') });
  };
  await plugins.load([at('a'), at('b')], importModule, PAGE);
  assert.deepEqual(calls, [at('a'), at('b')]);
  assert.deepEqual(events, ['request a', 'request b', 'activate a', 'activate b']);
  assert.equal(plugins.count(), 2);
});

test('the function of a plugin may return a promise, which is awaited', async () => {
  const plugins = host();
  let finished = false;
  const { importModule } = modules({
    [at('slow')]: async () => {
      await delay(20);
      finished = true;
    },
  });
  await plugins.load([at('slow')], importModule, PAGE);
  assert.equal(finished, true);
  assert.equal(plugins.count(), 1);
  assert.deepEqual(plugins.warnings(), []);
});

test('the API object is frozen and has exactly the version and the four registration functions', async () => {
  const plugins = host();
  let seen: PluginApi | undefined;
  const { importModule } = modules({ [at('a')]: (api: PluginApi) => void (seen = api) });
  await plugins.load([at('a')], importModule, PAGE);
  assert.ok(seen !== undefined);
  assert.equal(Object.isFrozen(seen), true);
  assert.deepEqual(Object.keys(seen).sort(), ['beforeRun', 'provideHeaders', 'renderActivity', 'renderCustomEvent', 'version']);
  assert.equal(seen.version, PLUGIN_API_VERSION);
  assert.equal(seen.version, 0);
});

test('a plugin that fails after it registered leaves nothing registered and one warning', async () => {
  const failures: Array<[string, Activate | 'hang', string, number?]> = [
    ['throws', () => { throw new Error('boom'); }, 'activation failed: boom'],
    ['rejects', async () => { throw new Error('later boom'); }, 'activation failed: later boom'],
    ['hangs', () => never(), 'activation did not finish within 0.03 seconds', 30],
  ];
  for (const [name, activate, text, timeoutMs] of failures) {
    const plugins = host(timeoutMs ?? 1000);
    const { importModule } = modules({
      [at(name)]: (api: PluginApi) => {
        api.beforeRun(noop);
        api.provideHeaders(noop);
        api.renderCustomEvent('example.note', noop);
        api.renderActivity('example-plan', noop);
        return (activate as Activate)(api);
      },
    });
    await plugins.load([at(name)], importModule, PAGE);
    assert.equal(plugins.count(), 0, name);
    assert.equal(plugins.eventRenderer('example.note'), undefined, name);
    assert.equal(plugins.activityRenderer('example-plan'), undefined, name);
    assert.deepEqual(plugins.warnings(), [`${label(name)}: ${text}`], name);
  }
});

test('an import that fails or never settles is one warning, and the other plugins still activate', async () => {
  const plugins = host(30);
  const { importModule } = modules({ [at('missing')]: new Error('Failed to fetch dynamically imported module'), [at('stuck')]: 'hang', [at('good')]: noop });
  await plugins.load([at('missing'), at('stuck'), at('good')], importModule, PAGE);
  assert.deepEqual(plugins.warnings(), [`${label('missing')}: could not be loaded`, `${label('stuck')}: did not load within 0.03 seconds`]);
  assert.equal(plugins.count(), 1);
});

test('a module without a default function is skipped with one warning', async () => {
  const plugins = host();
  const { importModule } = modules({ [at('none')]: {}, [at('object')]: { default: {} }, [at('text')]: { default: 'x' }, [at('null')]: null });
  await plugins.load([at('none'), at('object'), at('text'), at('null')], importModule, PAGE);
  assert.deepEqual(plugins.warnings(), ['none', 'object', 'text', 'null'].map((name) => `${label(name)}: the default export is not a function`));
  assert.equal(plugins.count(), 0);
});

test('a registration after activation ended does nothing and warns; a bad argument is a failed activation', async () => {
  const plugins = host();
  let late: PluginApi | undefined;
  const { importModule } = modules({
    [at('late')]: (api: PluginApi) => void (late = api),
    [at('bad-name')]: (api: PluginApi) => api.renderCustomEvent('', noop),
    [at('bad-render')]: (api: PluginApi) => api.renderActivity('example-plan', 'not a function' as never),
    [at('bad-hook')]: (api: PluginApi) => api.beforeRun(undefined as never),
    [at('bad-provider')]: (api: PluginApi) => api.provideHeaders(7 as never),
  });
  await plugins.load([at('late'), at('bad-name'), at('bad-render'), at('bad-hook'), at('bad-provider')], importModule, PAGE);
  late?.renderCustomEvent('example.note', noop);
  late?.renderActivity('example-plan', noop);
  late?.beforeRun(noop);
  late?.provideHeaders(noop);
  assert.equal(plugins.eventRenderer('example.note'), undefined);
  assert.equal(plugins.activityRenderer('example-plan'), undefined);
  const warnings = plugins.warnings();
  for (const name of ['renderCustomEvent', 'renderActivity', 'beforeRun', 'provideHeaders']) {
    assert.ok(warnings.includes(`${label('late')}: ${name} was called after activation and was ignored`), name);
  }
  for (const name of ['bad-name', 'bad-render', 'bad-hook', 'bad-provider']) {
    assert.ok(warnings.some((warning) => warning.startsWith(`${label(name)}: activation failed: `)), name);
  }
  assert.equal(plugins.count(), 1);
});

test('the first claim wins for a custom event name and for an activity type, across plugins and inside one', async () => {
  const plugins = host();
  const one = () => {};
  const two = () => {};
  const { importModule } = modules({
    [at('first')]: (api: PluginApi) => {
      api.renderCustomEvent('example.note', one);
      api.renderActivity('example-plan', one);
      api.renderCustomEvent('example.note', two);
      api.beforeRun(noop);
    },
    [at('second')]: (api: PluginApi) => {
      api.renderCustomEvent('example.note', two);
      api.renderActivity('example-plan', two);
      api.renderActivity('example.note', two);
      api.renderCustomEvent('example-plan', two);
    },
  });
  await plugins.load([at('first'), at('second')], importModule, PAGE);
  assert.equal(plugins.eventRenderer('example.note')?.render, one);
  assert.equal(plugins.eventRenderer('example.note')?.plugin, label('first'));
  assert.equal(plugins.activityRenderer('example-plan')?.render, one);
  assert.equal(plugins.eventRenderer('example-plan')?.render, two, 'a name and a type do not collide');
  assert.equal(plugins.activityRenderer('example.note')?.render, two, 'a name and a type do not collide');
  assert.deepEqual(plugins.warnings(), [
    `${label('first')}: renderCustomEvent(example.note) is already registered by ${label('first')}; ignored`,
    `${label('second')}: renderCustomEvent(example.note) is already registered by ${label('first')}; ignored`,
    `${label('second')}: renderActivity(example-plan) is already registered by ${label('first')}; ignored`,
  ]);
  assert.equal(plugins.count(), 2, 'a refused claim is not a failed activation');
});

test('the A2UI activity type is never claimable, and the rest of that plugin is kept', async () => {
  const plugins = host();
  const render = () => {};
  const { importModule } = modules({ [at('a')]: (api: PluginApi) => { api.renderActivity('a2ui-surface', noop); api.renderActivity('example-plan', render); } });
  await plugins.load([at('a')], importModule, PAGE);
  assert.equal(plugins.activityRenderer('a2ui-surface'), undefined);
  assert.equal(plugins.activityRenderer('example-plan')?.render, render);
  assert.deepEqual(plugins.warnings(), [`${label('a')}: renderActivity(a2ui-surface) is drawn by the A2UI view; ignored`]);
  assert.equal(plugins.count(), 1);
});

test('warnings never repeat, stop at the cap, cut a long message, and name any thrown value', async () => {
  const plugins = host();
  plugins.report('/p.js', 'renderActivity(x)', new Error('same'));
  plugins.report('/p.js', 'renderActivity(x)', new Error('same'));
  plugins.report('/p.js', 'renderActivity(x)', 'a string');
  plugins.report('/p.js', 'renderActivity(x)', undefined);
  plugins.report('/p.js', 'renderActivity(x)', { not: 'an error' });
  assert.deepEqual(plugins.warnings(), [
    '/p.js: renderActivity(x) threw: same',
    '/p.js: renderActivity(x) threw: a string',
    '/p.js: renderActivity(x) threw: undefined',
    '/p.js: renderActivity(x) threw: [object Object]',
  ]);
  plugins.report('/p.js', 'renderActivity(x)', new Error('y'.repeat(MAX_MESSAGE * 3)));
  const long = plugins.warnings().at(-1) ?? '';
  assert.ok(long.length <= '/p.js: renderActivity(x) threw: '.length + MAX_MESSAGE + 1, `${long.length}`);
  assert.ok(long.endsWith('…'));
  for (let i = 0; i < MAX_WARNINGS * 2; i += 1) plugins.report('/p.js', 'renderActivity(x)', new Error(`distinct ${i}`));
  assert.equal(plugins.warnings().length, MAX_WARNINGS);
});

test('warnings() is the same array until it changes, and subscribe is told once per change and can stop', async () => {
  const plugins = host();
  const before = plugins.warnings();
  assert.equal(plugins.warnings(), before);
  let told = 0;
  const stop = plugins.subscribe(() => (told += 1));
  plugins.report('/p.js', 'beforeRun', new Error('one'));
  plugins.report('/p.js', 'beforeRun', new Error('one'));
  assert.equal(told, 1, 'a repeated warning is not a change');
  const after = plugins.warnings();
  assert.notEqual(after, before);
  assert.equal(plugins.warnings(), after);
  stop();
  plugins.report('/p.js', 'beforeRun', new Error('two'));
  assert.equal(told, 1);
});

test('an address on another origin or with credentials is never imported', async () => {
  const plugins = host();
  const { calls, importModule } = modules({ [at('ok')]: noop });
  await plugins.load(['https://other.example/a.js', 'https://user:pw@inspector.example/a.js', 'data:text/javascript,export default 1', at('ok')], importModule, PAGE);
  assert.deepEqual(calls, [at('ok')]);
  assert.equal(plugins.count(), 1);
  const warnings = plugins.warnings();
  assert.equal(warnings.length, 3);
  for (const warning of warnings) {
    assert.match(warning, /^plugins\[[012]\]: was not loaded; plugins load from this page's origin only$/);
    assert.ok(!warning.includes('other.example') && !warning.includes('pw@'));
  }
});

test('count() counts plugins whose activation ended without error, one that registers nothing included', async () => {
  const plugins = host();
  const { importModule } = modules({ [at('empty')]: noop, [at('bad')]: () => { throw new Error('x'); }, [at('full')]: (api: PluginApi) => api.beforeRun(noop) });
  await plugins.load([at('empty'), at('bad'), at('full')], importModule, PAGE);
  assert.equal(plugins.count(), 2);
});

test('a plugin is named in warnings by the path and the query of its resolved address', async () => {
  const plugins = host();
  const address = 'https://inspector.example/static/plugins/sign.js?v=3';
  const { importModule } = modules({ [address]: () => { throw new Error('x'); } });
  await plugins.load([address], importModule, PAGE);
  assert.deepEqual(plugins.warnings(), ['/static/plugins/sign.js?v=3: activation failed: x']);
});

// ---------------------------------------------------------------------------------------------
// provideHeaders (FR-011 to FR-013)
// ---------------------------------------------------------------------------------------------


const secret = 'synthetic-secret-value-0001';
const request = { method: 'POST', url: 'https://agent.example/run', body: '{"a":1}' };
const signal = () => new AbortController().signal;

/** A host with one plugin per entry, each registering the given provider or hook. */
async function withPlugins(entries: Record<string, (api: PluginApi) => void>, timeoutMs = 1000) {
  const plugins = host(timeoutMs);
  const { importModule } = modules(Object.fromEntries(Object.entries(entries).map(([name, activate]) => [at(name), activate])));
  await plugins.load(Object.keys(entries).map(at), importModule, PAGE);
  return plugins;
}

test('with no provider the headers are empty and nothing is called', async () => {
  const plugins = await withPlugins({ none: noop });
  assert.deepEqual(await plugins.provideHeaders(request, signal()), { ok: true, value: {} });
});

test('providers run in registration order, a later one wins for a name compared without case, and each gets the request', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const provide = (name: string, headers: Record<string, string> | undefined): HeaderProvider => (context) => {
    seen.push({ name, ...context });
    return headers;
  };
  const plugins = await withPlugins({
    a: (api) => api.provideHeaders(provide('a', { 'X-One': 'a1', 'X-Two': 'a2' })),
    b: (api) => {
      api.provideHeaders(provide('b1', undefined));
      api.provideHeaders(provide('b2', {}));
      api.provideHeaders(provide('b3', { 'x-one': 'b1', 'X-Three': 'b3' }));
    },
  });
  const controller = new AbortController();
  assert.deepEqual(await plugins.provideHeaders(request, controller.signal), { ok: true, value: { 'x-one': 'b1', 'X-Two': 'a2', 'X-Three': 'b3' } });
  assert.deepEqual(seen.map((entry) => entry.name), ['a', 'b1', 'b2', 'b3']);
  for (const entry of seen) assert.deepEqual([entry.method, entry.url, entry.body, entry.signal], ['POST', request.url, request.body, controller.signal]);
  assert.deepEqual(plugins.warnings(), []);
});

test('a request with no body gives the provider no body', async () => {
  let seen: Record<string, unknown> | undefined;
  const plugins = await withPlugins({ a: (api) => api.provideHeaders((context) => void (seen = { ...context })) });
  await plugins.provideHeaders({ method: 'POST', url: request.url }, signal());
  assert.equal(seen !== undefined && 'body' in seen, false);
});

test('a provider may be asynchronous', async () => {
  const plugins = await withPlugins({ a: (api) => api.provideHeaders(async () => (await delay(10), { 'X-Late': 'yes' })) });
  assert.deepEqual(await plugins.provideHeaders(request, signal()), { ok: true, value: { 'X-Late': 'yes' } });
});

test('a provider that throws or rejects stops that request and is one warning that names the plugin', async () => {
  for (const [name, provider] of [['throws', () => { throw new Error('no token today'); }], ['rejects', async () => { throw new Error('no token today'); }]] as const) {
    const plugins = await withPlugins({ [name]: (api) => api.provideHeaders(provider as HeaderProvider) });
    const result = await plugins.provideHeaders(request, signal());
    assert.deepEqual(result, { ok: false, error: `Plugin ${label(name)} could not provide headers: no token today` }, name);
    assert.deepEqual(plugins.warnings(), [`${label(name)}: provideHeaders threw: no token today`], name);
  }
});

test('an answer that is not an object of headers, or has an invalid header, stops that request and names the header, never the value', async () => {
  const answers: Array<[unknown, RegExp]> = [
    [[], /not an object of headers/],
    ['X-A: 1', /not an object of headers/],
    [null, /not an object of headers/],
    [7, /not an object of headers/],
    [new (class Headers_ { 'X-A' = '1'; })(), /not an object of headers/],
    [{ Accept: secret }, /"Accept"/],
    [{ 'Content-Type': secret }, /"Content-Type"/],
    [{ Cookie: secret }, /"Cookie"/],
    [{ 'bad name': secret }, /bad name/],
    [{ 'X-A': `${secret}\r\nX-B: 1` }, /"X-A"/],
    [{ 'X-A': 7 }, /"X-A"/],
  ];
  for (const [answer, named] of answers) {
    const plugins = await withPlugins({ a: (api) => api.provideHeaders((() => answer) as unknown as HeaderProvider) });
    const result = await plugins.provideHeaders(request, signal());
    assert.equal(result.ok, false, JSON.stringify(answer));
    if (result.ok) continue;
    assert.match(result.error, named);
    assert.ok(result.error.startsWith(`Plugin ${label('a')} returned `), result.error);
    assert.equal(plugins.warnings().length, 1);
    for (const text of [result.error, ...plugins.warnings()]) assert.ok(!text.includes(secret), text);
  }
});

test('when the request is stopped the result says so and nothing is reported', async () => {
  const controller = new AbortController();
  const plugins = await withPlugins({ a: (api) => api.provideHeaders(() => (controller.abort(), new Promise<never>(() => undefined))) });
  assert.deepEqual(await plugins.provideHeaders(request, controller.signal), { ok: false, error: 'Stopped' });
  assert.deepEqual(plugins.warnings(), []);
  const already = new AbortController();
  already.abort();
  assert.deepEqual(await plugins.provideHeaders(request, already.signal), { ok: false, error: 'Stopped' });
});

test('a header value is not kept: the host holds nothing between calls and reports no value', async () => {
  let n = 0;
  const plugins = await withPlugins({ a: (api) => api.provideHeaders(() => ({ 'X-Sig': `${secret}-${++n}` })) });
  assert.deepEqual(await plugins.provideHeaders(request, signal()), { ok: true, value: { 'X-Sig': `${secret}-1` } });
  assert.deepEqual(await plugins.provideHeaders(request, signal()), { ok: true, value: { 'X-Sig': `${secret}-2` } });
  assert.ok(!JSON.stringify([plugins.warnings(), plugins.count()]).includes(secret));
});

// ---------------------------------------------------------------------------------------------
// beforeRun (FR-008, FR-009, FR-016)
// ---------------------------------------------------------------------------------------------


const RUN: RunAgentInput = {
  threadId: 'thread-1',
  runId: 'run-1',
  state: {},
  messages: [{ id: 'u1', role: 'user', content: 'hi' }],
  tools: [],
  context: [],
  forwardedProps: { tenant: 'acme' },
};
const runContext = (input: RunAgentInput = RUN, extra: Record<string, unknown> = {}) => ({ input, url: 'https://agent.example/run', agentId: 'support', ...extra });

test('with no hook the input comes back as the same object, uncopied', async () => {
  const plugins = await withPlugins({ none: noop });
  const result = await plugins.beforeRun(runContext(), signal());
  assert.equal(result.ok && result.value, RUN);
});

test('hooks run in registration order and each gets a copy of what the one before returned; nothing returned keeps the input', async () => {
  const seen: unknown[] = [];
  const plugins = await withPlugins({
    a: (api) => api.beforeRun((run) => {
      seen.push(run.input);
      return { ...run.input, forwardedProps: { ...run.input.forwardedProps, a: 1 } };
    }),
    b: (api) => {
      api.beforeRun((run) => void seen.push(run.input));
      api.beforeRun(async (run) => ({ ...run.input, forwardedProps: { ...run.input.forwardedProps, b: 2 } }));
    },
  });
  const result = await plugins.beforeRun(runContext(), signal());
  assert.deepEqual(result.ok && result.value.forwardedProps, { tenant: 'acme', a: 1, b: 2 });
  assert.deepEqual(seen, [RUN, { ...RUN, forwardedProps: { tenant: 'acme', a: 1 } }]);
  assert.notEqual(seen[0], RUN, 'a hook gets a copy');
  assert.deepEqual(RUN.forwardedProps, { tenant: 'acme' }, 'the original is untouched');
});

test('a hook that changes its copy in place changes nothing, and gets the agent, the address and the signal', async () => {
  let seen: Record<string, unknown> | undefined;
  const controller = new AbortController();
  const plugins = await withPlugins({
    a: (api) => api.beforeRun((run) => {
      seen = { ...run };
      (run.input.forwardedProps as Record<string, unknown>).tenant = 'changed';
      run.input.messages.length = 0;
    }),
  });
  const result = await plugins.beforeRun(runContext(), controller.signal);
  assert.deepEqual(result.ok && result.value, RUN);
  assert.deepEqual(RUN.forwardedProps, { tenant: 'acme' });
  assert.deepEqual([seen?.agentId, seen?.url, seen?.signal], ['support', 'https://agent.example/run', controller.signal]);
  await plugins.beforeRun({ input: RUN, url: 'https://agent.example/run' }, signal());
  assert.equal(seen !== undefined && 'agentId' in seen, false, 'a typed endpoint has no agent id');
});

test('what a hook returns is checked as a run input, keeps its ids, is JSON, and is copied after the check', async () => {
  const bad: Array<[string, (input: RunAgentInput) => unknown, RegExp]> = [
    ['not an input', () => ({ nope: true }), /invalid input: Run input is invalid/],
    ['a string', () => 'x', /invalid input/],
    ['null', () => null, /invalid input/],
    ['another thread', (input) => ({ ...input, threadId: 'other' }), /changed threadId or runId/],
    ['another run', (input) => ({ ...input, runId: 'other' }), /changed threadId or runId/],
    ['a function', (input) => ({ ...input, forwardedProps: { f: () => 1 } }), /not JSON/],
    ['a NaN', (input) => ({ ...input, forwardedProps: { n: Number.NaN } }), /not JSON/],
    ['a cycle', (input) => { const loop: Record<string, unknown> = {}; loop.self = loop; return { ...input, forwardedProps: loop }; }, /not JSON/],
  ];
  for (const [name, make, text] of bad) {
    const plugins = await withPlugins({ a: (api) => api.beforeRun(((run: { input: RunAgentInput }) => make(run.input)) as unknown as BeforeRunHook) });
    const result = await plugins.beforeRun(runContext(), signal());
    assert.equal(result.ok, false, name);
    if (result.ok) continue;
    assert.match(result.error, /^Plugin \/tools\/inspector\/plugins\/a\.js returned /, name);
    assert.match(result.error, text, name);
    assert.equal(plugins.warnings().length, 1, name);
  }
  let kept: RunAgentInput | undefined;
  const plugins = await withPlugins({ a: (api) => api.beforeRun((run) => (kept = { ...run.input, forwardedProps: { x: 1 } })) });
  const result = await plugins.beforeRun(runContext(), signal());
  assert.ok(result.ok);
  assert.notEqual(result.value, kept, 'the result is a copy');
  (kept?.forwardedProps as Record<string, unknown>).x = 2;
  assert.deepEqual(result.value.forwardedProps, { x: 1 }, 'a plugin that kept the object cannot change what is sent');
});

test('a hook that throws or rejects stops the run with its message, once', async () => {
  for (const [name, hook] of [['throws', () => { throw new Error('not on prod'); }], ['rejects', async () => { throw new Error('not on prod'); }]] as const) {
    const plugins = await withPlugins({ [name]: (api) => api.beforeRun(hook as BeforeRunHook) });
    assert.deepEqual(await plugins.beforeRun(runContext(), signal()), { ok: false, error: `Plugin ${label(name)} stopped the run in beforeRun: not on prod` }, name);
    assert.deepEqual(plugins.warnings(), [`${label(name)}: beforeRun threw: not on prod`], name);
  }
});

test('a stop while a hook works says so and reports nothing', async () => {
  const controller = new AbortController();
  const plugins = await withPlugins({ a: (api) => api.beforeRun(() => (controller.abort(), new Promise<never>(() => undefined))) });
  assert.deepEqual(await plugins.beforeRun(runContext(), controller.signal), { ok: false, error: 'Stopped' });
  assert.deepEqual(plugins.warnings(), []);
});
