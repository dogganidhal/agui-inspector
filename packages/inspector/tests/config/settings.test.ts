// L01 T019: contract regression tests for configuration, presets and client profiles (FR-006,
// FR-026 to FR-032, FR-036). Everything is synthetic and model-free; nothing here touches a network,
// so the "network allowlist" checks assert that loading calls only the callback it was handed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RENDER_A2UI_TOOL } from '@ag-ui/a2ui-middleware';
import { RunAgentInputSchema } from '@ag-ui/core/schemas';
import type { Message, ResumeEntry, Tool } from '@ag-ui/core';
import { CAPABILITY_GROUPS, type A2uiAction, type ClientProfileSettings, type JsonValue, type Preset } from '../../src/contracts.ts';
import { describeCapabilities, loadCapabilities, loadConfig, parseConfig, type Result } from '../../src/core/config/index.ts';
import { parsePreset, preparePreset, selectMessages } from '../../src/core/presets/index.ts';
import {
  PROFILE_STORAGE_KEY,
  composeRunInput,
  defaultProfile,
  exportProfile,
  importProfile,
  loadProfile,
  parseProfileSettings,
  removeTool,
  saveProfile,
  setInterruptPayload,
  setToolResult,
} from '../../src/core/profiles/index.ts';

/** The error of a failed result; fails the test when the result succeeded. */
function failure<T>(result: Result<T>): string {
  assert.equal(result.ok, false, 'expected a visible error');
  return result.ok ? '' : result.error;
}

/** The value of a successful result; fails the test with the error when it failed. */
function value<T>(result: Result<T>): T {
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return (result as { value: T }).value;
}

const config = (...agents: object[]) => JSON.stringify({ agents });
const ids = { threadId: 'thread-1', runId: 'run-1' };
const fixedUuid = () => '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------------------------
// Configuration (FR-006)
// ---------------------------------------------------------------------------------------------

test('an agent needs only an id and a url; the file without a version reads as version 0', () => {
  const parsed = value(parseConfig(config({ id: 'support', url: '/agents/support/stream' })));
  assert.equal(parsed.version, 0);
  assert.deepEqual(parsed.agents, [{ id: 'support', url: '/agents/support/stream' }]);
});

test('an explicit version 0 is accepted; any other version is a visible error', () => {
  assert.equal(value(parseConfig(JSON.stringify({ version: 0, agents: [{ id: 'a', url: '/a' }] }))).version, 0);
  for (const version of [1, 2, '0', null, -1]) {
    assert.match(failure(parseConfig(JSON.stringify({ version, agents: [{ id: 'a', url: '/a' }] }))), /version/i);
  }
});

test('invalid JSON, a non-object file and a missing agent list are visible errors', () => {
  assert.match(failure(parseConfig('{ not json')), /JSON/);
  assert.match(failure(parseConfig('[]')), /object/);
  assert.match(failure(parseConfig('{}')), /agents/);
  assert.match(failure(parseConfig('{"agents": {}}')), /agents/);
});

test('agent ids are nonempty and unique, and every agent has a usable url', () => {
  assert.match(failure(parseConfig(config({ id: '', url: '/a' }))), /id/);
  assert.match(failure(parseConfig(config({ url: '/a' }))), /id/);
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a' }, { id: 'a', url: '/b' }))), /duplicate.*"a"/i);
  assert.match(failure(parseConfig(config({ id: 'a' }))), /url/);
  assert.match(failure(parseConfig(config({ id: 'a', url: '' }))), /url/);
  assert.match(failure(parseConfig(config({ id: 'a', url: 'ftp://host/a' }))), /http/i);
  const parsed = value(parseConfig(config({ id: 'a', url: 'https://agent.example/run' }, { id: 'b', url: '/b', name: 'B' })));
  assert.deepEqual(parsed.agents.map((agent) => agent.id), ['a', 'b']);
});

test('configuration holds no credentials: userinfo and auth-bearing fields are rejected', () => {
  assert.match(failure(parseConfig(config({ id: 'a', url: 'https://user:secret@agent.example/run' }))), /credential/i);
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a', capabilities: 'https://user:secret@agent.example/caps' }))), /credential/i);
  for (const field of ['headers', 'token', 'authorization', 'auth', 'apiKey', 'cookie']) {
    assert.match(failure(parseConfig(config({ id: 'a', url: '/a', [field]: 'x' }))), /credential/i, field);
  }
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a', preset: { prepare: [{ method: 'PUT', path: '/s', headers: { a: 'b' } }] } }))), /credential/i);
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a', preset: { token: 'x' } }))), /credential/i);
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a', preset: { prepare: [{ method: 'PUT', path: 'https://u:p@host/s' }] } }))), /credential/i);
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a', surprise: 1 }))), /unknown/i);
});

test('a preset error names the agent and field that carry it', () => {
  const message = failure(parseConfig(config({ id: 'support', url: '/a', preset: { messages: 'sometimes' } })));
  assert.match(message, /support/);
  assert.match(message, /messages/);
});

test('loadConfig requests exactly the one url it is given, through the supplied callback', async () => {
  const requested: string[] = [];
  const text = config({ id: 'a', url: '/a', capabilities: '/a/capabilities' });
  const loaded = await loadConfig('/config.json', async (url) => (requested.push(url), text));
  assert.equal(value(loaded).agents.length, 1);
  assert.deepEqual(requested, ['/config.json'], 'configuration never discovers or fetches another route');
});

test('loadConfig reports a refused request, an unreadable body and a bad file as visible errors', async () => {
  assert.match(failure(await loadConfig('/config.json', async () => Promise.reject(new TypeError('blocked by CORS')))), /config\.json.*blocked by CORS/);
  assert.match(failure(await loadConfig('/config.json', async () => 'oops')), /JSON/);
  assert.match(failure(await loadConfig('/config.json', async () => '{"version":3,"agents":[]}')), /version/);
});

// ---------------------------------------------------------------------------------------------
// Declared capabilities (FR-029)
// ---------------------------------------------------------------------------------------------

test('capabilities are shown by the eleven documented groups, in order, declared or not', () => {
  const groups = describeCapabilities({ identity: { name: 'Support', version: '2.3.0' }, tools: { supported: true, parallelCalls: false }, custom: { 'refund.policy': '2026-07' } });
  assert.deepEqual(groups.map((group) => group.group), [...CAPABILITY_GROUPS]);
  assert.equal(groups.length, 11);
  assert.deepEqual(groups[0]?.entries, [{ key: 'name', value: 'Support' }, { key: 'version', value: '2.3.0' }]);
  assert.deepEqual(groups[2]?.entries, [{ key: 'supported', value: true }, { key: 'parallelCalls', value: false }]);
  assert.deepEqual(groups[1]?.entries, [], 'an undeclared group is present and empty');
  assert.deepEqual(groups[10]?.entries, [{ key: 'refund.policy', value: '2026-07' }]);
});

test('inline capabilities need no request; a url is fetched once through the callback', async () => {
  const inline = value(parseConfig(config({ id: 'a', url: '/a', capabilities: { reasoning: { supported: true } } }))).agents[0]!;
  let requests = 0;
  const loadedInline = value(await loadCapabilities(inline, async () => (requests += 1, '{}')));
  assert.equal(loadedInline.source, 'inline');
  assert.equal(requests, 0);

  const remote = value(parseConfig(config({ id: 'a', url: '/a', capabilities: '/a/capabilities' }))).agents[0]!;
  const requested: string[] = [];
  const loaded = value(await loadCapabilities(remote, async (url) => (requested.push(url), JSON.stringify({ state: { snapshots: true } }))));
  assert.deepEqual(requested, ['/a/capabilities'], 'no discovery beyond the configured source');
  assert.equal(loaded.source, 'url');
  assert.deepEqual(loaded.groups[4]?.entries, [{ key: 'snapshots', value: true }]);
});

test('an agent without capabilities reports none, and a bad declaration is a visible error', async () => {
  const bare = value(parseConfig(config({ id: 'a', url: '/a' }))).agents[0]!;
  assert.equal(value(await loadCapabilities(bare, async () => assert.fail('nothing to fetch'))).source, 'none');
  assert.match(failure(parseConfig(config({ id: 'a', url: '/a', capabilities: { tools: { supported: 'yes' } } }))), /capabilities/i);
  const remote = value(parseConfig(config({ id: 'a', url: '/a', capabilities: '/caps' }))).agents[0]!;
  assert.match(failure(await loadCapabilities(remote, async () => '{ nope')), /\/caps.*JSON/);
  assert.match(failure(await loadCapabilities(remote, async () => JSON.stringify({ tools: { supported: 'yes' } }))), /capabilities/i);
  assert.match(failure(await loadCapabilities(remote, async () => Promise.reject(new TypeError('offline')))), /\/caps.*offline/);
});

// ---------------------------------------------------------------------------------------------
// Presets: variables and templates (FR-026)
// ---------------------------------------------------------------------------------------------

const preset = (body: Preset): Preset => value(parsePreset(body, 'test'));

test('built-in threadId, runId and uuid exist, and one uuid serves the whole dispatch attempt', () => {
  const p = preset({
    variables: { userId: { default: 'dev-{{uuid}}' } },
    forwardedProps: { user_id: '{{userId}}', thread: '{{threadId}}' },
    prepare: [{ method: 'PUT', path: '/sessions/{{threadId}}/{{runId}}', body: { user_id: '{{userId}}', trace: '{{uuid}}' } }],
  });
  let calls = 0;
  const prepared = value(preparePreset(p, {}, ids, () => `uuid-${(calls += 1)}`));
  assert.equal(calls, 1, 'the uuid is generated once per dispatch attempt');
  assert.deepEqual(prepared.forwardedProps, { user_id: 'dev-uuid-1', thread: 'thread-1' });
  assert.deepEqual(prepared.preparations, [
    { method: 'PUT', path: '/sessions/thread-1/run-1', body: { user_id: 'dev-uuid-1', trace: 'uuid-1' } },
  ]);
  const next = value(preparePreset(p, {}, ids, () => `uuid-${(calls += 1)}`));
  assert.equal(next.forwardedProps.user_id, 'dev-uuid-2', 'the next attempt gets a fresh uuid');
});

test('the default uuid comes from Web Crypto', () => {
  const prepared = value(preparePreset(preset({ forwardedProps: { id: '{{uuid}}' } }), {}, ids));
  assert.match(String(prepared.forwardedProps.id), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('a JSON variable filling a whole string is inserted as JSON, keeping its type', () => {
  const cases: Array<[JsonValue, JsonValue]> = [
    [{ plan: 'free', tags: ['a', 1, null] }, { plan: 'free', tags: ['a', 1, null] }],
    [42, 42],
    [true, true],
    [null, null],
    [['x', 2], ['x', 2]],
    ['text', 'text'],
  ];
  for (const [input, expected] of cases) {
    const p = preset({ variables: { seed: { default: input, type: 'json' } }, forwardedProps: { seed: '{{seed}}' }, prepare: [{ method: 'POST', path: '/p', body: { context: '{{seed}}' } }] });
    const prepared = value(preparePreset(p, {}, ids, fixedUuid));
    assert.deepEqual(prepared.forwardedProps.seed, expected);
    assert.deepEqual((prepared.preparations[0]?.body as { context: JsonValue }).context, expected);
    assert.equal(typeof (prepared.preparations[0]?.body as { context: JsonValue }).context, typeof expected);
  }
});

test('a JSON variable inside a longer string is serialized as JSON; a text variable is inserted as written', () => {
  const p = preset({
    variables: { seed: { default: { plan: 'free' }, type: 'json' }, label: { default: 'blue' }, quoted: { default: 'q', type: 'json' } },
    forwardedProps: { a: 'seed={{seed}}', b: 'label={{label}}', c: '{{label}}', d: 'quoted={{quoted}}', e: ' {{ label }} ' },
  });
  assert.deepEqual(value(preparePreset(p, {}, ids, fixedUuid)).forwardedProps, {
    a: 'seed={"plan":"free"}',
    b: 'label=blue',
    c: 'blue',
    d: 'quoted="q"',
    e: ' blue ',
  });
});

test('user values replace defaults; a text variable must stay text and a JSON variable may be any JSON', () => {
  const p = preset({ variables: { name: { default: 'a' }, seed: { default: {}, type: 'json' } }, forwardedProps: { name: '{{name}}', seed: '{{seed}}' } });
  assert.deepEqual(value(preparePreset(p, { name: 'edited', seed: [1, 2] }, ids, fixedUuid)).forwardedProps, { name: 'edited', seed: [1, 2] });
  assert.match(failure(preparePreset(p, { name: 5 }, ids, fixedUuid)), /name.*text/i);
  assert.match(failure(preparePreset(p, { missing: 'x' }, ids, fixedUuid)), /unknown variable.*missing/i);
});

test('an undefined variable fails visibly with its name and place, never as an empty string', () => {
  const p = preset({
    forwardedProps: { who: '{{nobody}}' },
    prepare: [{ method: 'PUT', path: '/s/{{absent}}', body: { x: ['{{ghost}}'] } }],
  });
  const message = failure(preparePreset(p, {}, ids, fixedUuid));
  for (const name of ['nobody', 'absent', 'ghost']) assert.match(message, new RegExp(name));
  assert.match(message, /forwardedProps/);
  assert.match(message, /prepare\[0\]\.path/);
  assert.match(message, /prepare\[0\]\.body\.x\[0\]/);
});

test('a placeholder that is not a variable name is a visible error', () => {
  assert.match(failure(preparePreset(preset({ forwardedProps: { x: 'a {{ }} b' } }), {}, ids, fixedUuid)), /placeholder/i);
  assert.match(failure(preparePreset(preset({ forwardedProps: { x: '{{not a name}}' } }), {}, ids, fixedUuid)), /placeholder/i);
});

test('a variable value may use the built-ins; any other reference in it is undefined', () => {
  const p = preset({ variables: { a: { default: '{{threadId}}' }, b: { default: '{{a}}' } }, forwardedProps: { a: '{{a}}' } });
  assert.match(failure(preparePreset(p, {}, ids, fixedUuid)), /\ba\b.*undefined|undefined.*\ba\b/i);
});

test('a preset must be well formed: reserved names, kinds, defaults, methods and credentials', () => {
  const bad = (body: object) => failure(parsePreset(body, 'test'));
  for (const name of ['threadId', 'runId', 'uuid']) assert.match(bad({ variables: { [name]: { default: 'x' } } }), /built-in/i, name);
  assert.match(bad({ variables: { 'bad name': { default: 'x' } } }), /name/);
  assert.match(bad({ variables: { a: { default: 5 } } }), /text/i);
  assert.match(bad({ variables: { a: { default: 'x', type: 'xml' } } }), /type/);
  assert.match(bad({ variables: { a: {} } }), /default/);
  assert.match(bad({ variables: { a: { default: 'x', extra: 1 } } }), /unknown/i);
  assert.match(bad({ forwardedProps: [] }), /forwardedProps/);
  assert.match(bad({ forwardedProps: { a2uiAction: {} } }), /a2uiAction.*reserved/i);
  assert.match(bad({ prepare: [{ path: '/x' }] }), /method/);
  assert.match(bad({ prepare: [{ method: 'PUT' }] }), /path/);
  assert.match(bad({ prepare: {} }), /prepare/);
  assert.match(bad({ quickMessages: [1] }), /quickMessages/);
  assert.match(bad({ messages: 'all' }), /messages/);
  assert.match(bad({ auth: { token: 'x' } }), /credential/i);
});

test('preparation requests keep their declared order, method and optional body', () => {
  const p = preset({
    prepare: [
      { method: 'POST', path: '/one' },
      { method: 'PUT', path: '/two', body: { n: 2 } },
      { method: 'DELETE', path: '/three' },
    ],
  });
  const prepared = value(preparePreset(p, {}, ids, fixedUuid));
  assert.deepEqual(prepared.preparations.map((step) => `${step.method} ${step.path}`), ['POST /one', 'PUT /two', 'DELETE /three']);
  assert.equal('body' in (prepared.preparations[0] as object), false);
  assert.deepEqual(prepared.preparations[1]?.body, { n: 2 });
});

test('quick messages are carried by the preset, and no preset means built-ins only', () => {
  assert.deepEqual(preset({ quickMessages: ['/help', 'hello'] }).quickMessages, ['/help', 'hello']);
  const bare = value(preparePreset(undefined, {}, ids, fixedUuid));
  assert.deepEqual(bare, { variables: bare.variables, preparations: [], forwardedProps: {}, messageMode: 'full' });
});

// ---------------------------------------------------------------------------------------------
// Presets: message selection and mode (FR-027)
// ---------------------------------------------------------------------------------------------

const user = (id: string, content: string): Message => ({ id, role: 'user', content });
const assistant = (id: string, content: string): Message => ({ id, role: 'assistant', content });
const transcript: Message[] = [user('u1', 'hi'), assistant('a1', 'hello'), user('u2', 'refund?')];

test('the message mode defaults to the full transcript and follows the preset', () => {
  assert.equal(value(preparePreset(preset({}), {}, ids, fixedUuid)).messageMode, 'full');
  assert.equal(value(preparePreset(preset({ messages: 'turn' }), {}, ids, fixedUuid)).messageMode, 'turn');
  assert.equal(value(preparePreset(preset({ messages: 'full' }), {}, ids, fixedUuid)).messageMode, 'full');
});

test('full sends the whole transcript; turn sends only what the turn adds, which may be nothing', () => {
  assert.deepEqual(selectMessages('full', transcript, [transcript[2]!]), transcript);
  assert.deepEqual(selectMessages('turn', transcript, [transcript[2]!]), [transcript[2]]);
  assert.deepEqual(selectMessages('turn', transcript, []), [], 'a resume continuation adds no message');
});

// ---------------------------------------------------------------------------------------------
// Client profile settings (FR-030, FR-032)
// ---------------------------------------------------------------------------------------------

const tool = (name: string): Tool => ({ name, description: `${name} tool`, parameters: { type: 'object', properties: { city: { type: 'string' } } } });
const profile = (patch: Partial<ClientProfileSettings> = {}): ClientProfileSettings => ({ ...defaultProfile(), ...patch });

test('the default profile declares protocol 1.0, renders A2UI, injects nothing and defers to the preset', () => {
  assert.deepEqual(defaultProfile(), {
    protocolVersion: '1.0',
    tools: [],
    context: [],
    renderA2ui: true,
    injectA2uiTool: false,
    forwardedProps: {},
  });
});

test('export writes a version 0 envelope with the seven settings and no automation key unless one is set, and import restores them', () => {
  const settings = profile({ protocolVersion: '1.1', tools: [tool('get_weather')], context: [{ description: 'locale', value: 'en-US' }], renderA2ui: false, injectA2uiTool: true, messageMode: 'turn', forwardedProps: { tenant: 'acme', n: [1, { a: null }] } });
  const text = exportProfile(settings);
  const envelope = JSON.parse(text) as { version: number; profile: Record<string, unknown> };
  assert.equal(envelope.version, 0);
  assert.deepEqual(Object.keys(envelope).sort(), ['profile', 'version']);
  assert.deepEqual(Object.keys(envelope.profile).sort(), ['context', 'forwardedProps', 'injectA2uiTool', 'messageMode', 'protocolVersion', 'renderA2ui', 'tools']);
  assert.deepEqual(value(importProfile(text)), settings);
});

// ---------------------------------------------------------------------------------------------
// Automatic replies (spec 004: interruptReply, interruptPayloads, toolResults)
// ---------------------------------------------------------------------------------------------

const wrapped = (patch: object) => JSON.stringify({ version: 0, profile: { ...defaultProfile(), ...patch } });
const parsed = (patch: object): ClientProfileSettings => value(importProfile(wrapped(patch)));
const refused = (patch: object): string => failure(importProfile(wrapped(patch)));
const AUTOMATION_KEYS = ['interruptReply', 'interruptPayloads', 'toolResults'];

test('a 0.1.0 profile, with none of the automation keys, still loads and every reply stays by hand', () => {
  const settings = parsed({ tools: [tool('pick_color')] });
  for (const key of AUTOMATION_KEYS) assert.equal(key in settings, false, key);
  assert.equal(AUTOMATION_KEYS.some((key) => key in defaultProfile()), false, 'the default profile sets none of them');
  assert.equal(AUTOMATION_KEYS.some((key) => key in JSON.parse(exportProfile(defaultProfile())).profile), false, 'an exported default profile equals a 0.1.0 export');
});

test('interruptReply is resolve or cancel; anything else names the field', () => {
  assert.equal(parsed({ interruptReply: 'resolve' }).interruptReply, 'resolve');
  assert.equal(parsed({ interruptReply: 'cancel' }).interruptReply, 'cancel');
  for (const bad of ['manual', 'Resolve', '', null, 3, true, {}]) {
    assert.match(refused({ interruptReply: bad }), /profile\.interruptReply must be "resolve" or "cancel"/, String(bad));
  }
});

test('interruptPayloads maps a reason to a JSON value, kept in the order of the file and as written', () => {
  const payloads = { approval: { approved: true, note: ' spaced\n', n: [1, { a: null }] }, flag: false, empty: {}, list: [], text: 'ok', count: 3, 'ünï': 'x' };
  const settings = parsed({ interruptReply: 'resolve', interruptPayloads: payloads });
  assert.deepEqual(settings.interruptPayloads, payloads);
  assert.deepEqual(Object.keys(settings.interruptPayloads ?? {}), Object.keys(payloads));
  const copy = value(parseProfileSettings({ ...defaultProfile(), interruptPayloads: payloads }));
  assert.deepEqual(copy.interruptPayloads, payloads);
  assert.notEqual(copy.interruptPayloads?.approval, payloads.approval, 'the profile holds its own copy');
  assert.deepEqual(value(importProfile(exportProfile(settings))), settings, 'export then import is equal');
});

test('interruptPayloads is checked: an object, nonempty reasons, JSON values; an empty object is read as absent', () => {
  for (const bad of [[], 'text', null, 3, true]) {
    assert.match(refused({ interruptPayloads: bad }), /profile\.interruptPayloads must be an object from interrupt reason to JSON/, JSON.stringify(bad));
  }
  assert.match(refused({ interruptPayloads: { '': 1 } }), /profile\.interruptPayloads: an interrupt reason cannot be empty/);
  assert.match(
    failure(parseProfileSettings({ ...defaultProfile(), interruptPayloads: { approval: undefined } })),
    /profile\.interruptPayloads\.approval must be JSON/,
  );
  assert.match(failure(parseProfileSettings({ ...defaultProfile(), interruptPayloads: { approval: () => 1 } })), /approval must be JSON/);
  assert.match(refused({ interruptPayloads: { approval: null } }), /profile\.interruptPayloads\.approval cannot be null/, 'the run input schema refuses a null resume payload, so it could never be sent');
  assert.equal(parsed({ interruptPayloads: { approval: { a: null } } }).interruptPayloads?.approval !== undefined, true, 'a null inside the payload is fine');
  assert.equal('interruptPayloads' in parsed({ interruptPayloads: {} }), false);
});

test('a payload map is kept when the reply is cancel or by hand: switching the mode loses nothing', () => {
  assert.deepEqual(parsed({ interruptReply: 'cancel', interruptPayloads: { approval: 1 } }).interruptPayloads, { approval: 1 });
  assert.deepEqual(parsed({ interruptPayloads: { approval: 1 } }).interruptPayloads, { approval: 1 });
});

test('a reason named __proto__ stays an own key and changes no prototype, through parse, export and import', () => {
  const text = '{"version":0,"profile":{"protocolVersion":"1.0","tools":[],"context":[],"renderA2ui":true,"injectA2uiTool":false,"forwardedProps":{},"interruptPayloads":{"__proto__":{"polluted":true},"constructor":1}}}';
  const settings = value(importProfile(text));
  const payloads = settings.interruptPayloads as Record<string, unknown>;
  assert.equal(Object.hasOwn(payloads, '__proto__'), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(payloads, '__proto__')?.value, { polluted: true });
  assert.equal(Object.getPrototypeOf(payloads), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(payloads), ['__proto__', 'constructor']);
  assert.equal(Object.hasOwn(value(importProfile(exportProfile(settings))).interruptPayloads as object, '__proto__'), true);
});

test('toolResults maps a profile tool name to nonempty text, kept byte for byte', () => {
  const results = { pick_color: ' teal\n', pick_size: '{"size":2}', unicode: 'café ☕' };
  const settings = parsed({ tools: [tool('pick_color'), tool('pick_size'), tool('unicode')], toolResults: results });
  assert.deepEqual(settings.toolResults, results);
  assert.deepEqual(value(importProfile(exportProfile(settings))), settings);
});

test('toolResults is checked: an object, keys that name profile tools, nonempty text values; an empty object is read as absent', () => {
  const tools = [tool('pick_color')];
  for (const bad of [[], 'text', null, 3]) {
    assert.match(refused({ tools, toolResults: bad }), /profile\.toolResults must be an object from tool name to text/, JSON.stringify(bad));
  }
  assert.match(refused({ tools, toolResults: { pick_colour: 'x' } }), /profile\.toolResults: no tool named "pick_colour"/);
  assert.match(refused({ tools, toolResults: { constructor: 'x' } }), /no tool named "constructor"/);
  for (const bad of ['', 1, null, {}, ['a'], true]) {
    assert.match(refused({ tools, toolResults: { pick_color: bad } }), /profile\.toolResults\.pick_color must be nonempty text/, JSON.stringify(bad));
  }
  assert.match(refused({ toolResults: { pick_color: 'x' } }), /no tool named "pick_color"/, 'a script needs its tool in the same profile');
  assert.equal('toolResults' in parsed({ tools, toolResults: {} }), false);
});

test('export writes each automation key only when it is set, and save then load keep all three', () => {
  const set = profile({ tools: [tool('pick_color')], interruptReply: 'resolve', interruptPayloads: { approval: { approved: true } }, toolResults: { pick_color: 'teal' } });
  const envelope = JSON.parse(exportProfile(set)) as { version: number; profile: Record<string, unknown> };
  assert.equal(envelope.version, 0);
  assert.deepEqual(envelope.profile.interruptReply, 'resolve');
  assert.deepEqual(envelope.profile.interruptPayloads, { approval: { approved: true } });
  assert.deepEqual(envelope.profile.toolResults, { pick_color: 'teal' });
  const only = JSON.parse(exportProfile(profile({ interruptReply: 'cancel' }))) as { profile: Record<string, unknown> };
  assert.deepEqual(Object.keys(only.profile).filter((key) => AUTOMATION_KEYS.includes(key)), ['interruptReply']);

  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, text: string) => void store.set(key, text) };
  value(saveProfile(storage, set));
  assert.deepEqual(value(loadProfile(storage)), set);
});

test('a bad automation key in a saved profile is a visible load error and the rest is not loaded', () => {
  const saved = wrapped({ interruptReply: 'manual' });
  assert.match(failure(loadProfile({ getItem: () => saved, setItem: () => undefined })), /The saved profile was not loaded\..*interruptReply/);
});

test('the automation keys are not run input: tools, context and properties are the same with or without them', () => {
  const plain = value(composeRunInput(baseParams({ profile: profile({ tools: [tool('pick_color')] }) })));
  const automatic = value(
    composeRunInput(baseParams({ profile: profile({ tools: [tool('pick_color')], interruptReply: 'resolve', interruptPayloads: { approval: 1 }, toolResults: { pick_color: 'teal' } }) })),
  );
  assert.deepEqual(automatic, plain);
});

test('the panel\'s edits set and clear the payloads and results, keep the order, and never leave an empty map', () => {
  let settings = profile({ tools: [tool('pick_color'), tool('pick_size')] });
  settings = setInterruptPayload(settings, 'approval', { approved: true });
  settings = setInterruptPayload(settings, 'input', 'text');
  settings = setInterruptPayload(settings, 'approval', { approved: false });
  assert.deepEqual(Object.entries(settings.interruptPayloads ?? {}), [['approval', { approved: false }], ['input', 'text']], 'an edit keeps its place');
  settings = setInterruptPayload(settings, 'approval', undefined);
  assert.deepEqual(settings.interruptPayloads, { input: 'text' });
  settings = setInterruptPayload(settings, 'input', undefined);
  assert.equal('interruptPayloads' in settings, false, 'the last payload takes the map with it');
  assert.equal('interruptPayloads' in setInterruptPayload(settings, 'nothing', undefined), false, 'removing what is not there changes nothing');

  settings = setToolResult(settings, 'pick_color', 'teal');
  settings = setToolResult(settings, 'pick_size', '3');
  assert.deepEqual(settings.toolResults, { pick_color: 'teal', pick_size: '3' });
  settings = setToolResult(settings, 'pick_color', undefined);
  assert.deepEqual(settings.toolResults, { pick_size: '3' });

  // Every edit stays valid for the profile checks.
  assert.equal(parseProfileSettings(settings).ok, true);
  assert.equal(parseProfileSettings(setInterruptPayload(settings, '__proto__', { x: 1 })).ok, true);
});

test('removing a tool removes its scripted result in the same edit, and the profile stays valid', () => {
  const settings = profile({ tools: [tool('pick_color'), tool('pick_size')], toolResults: { pick_color: 'teal', pick_size: '3' } });
  const without = removeTool(settings, 'pick_color');
  assert.deepEqual(without.tools.map((entry) => entry.name), ['pick_size']);
  assert.deepEqual(without.toolResults, { pick_size: '3' });
  assert.equal(parseProfileSettings(without).ok, true);
  const last = removeTool(without, 'pick_size');
  assert.equal('toolResults' in last, false);
  assert.equal(parseProfileSettings(last).ok, true);
  assert.equal(parseProfileSettings({ ...settings, tools: settings.tools.filter((entry) => entry.name !== 'pick_color') }).ok, false, 'removing only the tool would have left a script with no tool');
  // The edits do not change the profile they were given.
  assert.deepEqual(settings.toolResults, { pick_color: 'teal', pick_size: '3' });
});

test('export never carries credentials, even when handed an object that holds some', () => {
  const polluted = { ...profile(), token: 'sk-synthetic-token', headerName: 'Authorization', auth: { token: 'sk-synthetic-token' } } as unknown as ClientProfileSettings;
  const text = exportProfile(polluted);
  assert.doesNotMatch(text, /sk-synthetic-token|headerName|Authorization|"auth"|"token"/);
});

test('import rejects auth fields, unknown fields, and any version but 0, leaving the caller to keep its profile', () => {
  const wrap = (settings: object, extra: object = {}) => JSON.stringify({ version: 0, profile: settings, ...extra });
  for (const field of ['token', 'authToken', 'headerName', 'authorization', 'headers', 'auth']) {
    assert.match(failure(importProfile(wrap({ ...defaultProfile(), [field]: 'x' }))), /credential/i, field);
  }
  assert.match(failure(importProfile(wrap({ ...defaultProfile(), surprise: 1 }))), /unknown/i);
  assert.match(failure(importProfile(wrap(defaultProfile(), { token: 'x' }))), /credential/i);
  assert.match(failure(importProfile(wrap(defaultProfile(), { surprise: 1 }))), /unknown/i);
  for (const version of [1, '0', null, undefined]) {
    assert.match(failure(importProfile(JSON.stringify({ version, profile: defaultProfile() }))), /version/i);
  }
  assert.match(failure(importProfile('{ not json')), /JSON/);
  assert.match(failure(importProfile('[]')), /object/);
  assert.match(failure(importProfile(JSON.stringify({ version: 0 }))), /profile/);
});

test('every setting is validated: types, unique tool names, message mode and forwarded properties', () => {
  const bad = (patch: object) => failure(importProfile(JSON.stringify({ version: 0, profile: { ...defaultProfile(), ...patch } })));
  assert.match(bad({ protocolVersion: '' }), /protocolVersion/);
  assert.match(bad({ protocolVersion: 1 }), /protocolVersion/);
  assert.match(bad({ tools: {} }), /tools/);
  assert.match(bad({ tools: [{ name: 'a' }] }), /tools\[0\]/);
  assert.match(bad({ tools: [tool('a'), tool('a')] }), /duplicate.*"a"/i);
  assert.match(bad({ context: [{ description: 'x' }] }), /context\[0\]/);
  assert.match(bad({ renderA2ui: 'yes' }), /renderA2ui/);
  assert.match(bad({ injectA2uiTool: 1 }), /injectA2uiTool/);
  assert.match(bad({ messageMode: 'some' }), /messageMode/);
  assert.match(bad({ forwardedProps: [] }), /forwardedProps/);
  assert.match(bad({ forwardedProps: { a2uiAction: {} } }), /a2uiAction.*reserved/i);
  const missing: Record<string, unknown> = { ...defaultProfile() };
  delete missing.tools;
  assert.match(failure(importProfile(JSON.stringify({ version: 0, profile: missing }))), /tools/);
});

test('browser persistence stores the same credential-free envelope and restores it', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, text: string) => void store.set(key, text) };
  assert.equal(value(loadProfile(storage)), undefined, 'nothing saved yet is not an error');
  const settings = profile({ tools: [tool('t')], messageMode: 'full', forwardedProps: { a: 1 } });
  value(saveProfile(storage, settings));
  assert.deepEqual([...store.keys()], [PROFILE_STORAGE_KEY]);
  assert.equal(store.get(PROFILE_STORAGE_KEY), exportProfile(settings));
  assert.deepEqual(value(loadProfile(storage)), settings);
});

test('unavailable or corrupt browser storage is a visible error, never a crash or a silent default', () => {
  const blocked = {
    getItem: () => {
      throw new DOMException('denied', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('quota', 'QuotaExceededError');
    },
  };
  assert.match(failure(loadProfile(blocked)), /storage/i);
  assert.match(failure(saveProfile(blocked, defaultProfile())), /storage/i);
  const corrupt = { getItem: () => '{"version":9,"profile":{}}', setItem: () => undefined };
  assert.match(failure(loadProfile(corrupt)), /version/i);
});

// ---------------------------------------------------------------------------------------------
// Run input composition (FR-027, FR-030, FR-031)
// ---------------------------------------------------------------------------------------------

const baseParams = (overrides: Partial<Parameters<typeof composeRunInput>[0]> = {}) => ({
  ids,
  prepared: value(preparePreset(undefined, {}, ids, fixedUuid)),
  profile: defaultProfile(),
  transcript,
  turnMessages: [transcript[2]!],
  ...overrides,
});

test('an ordinary run carries ids, protocol version, state, messages, tools, context and merged properties', () => {
  const p = preset({ forwardedProps: { tenant: 'acme', mode: 'preset' } });
  const input = value(
    composeRunInput(
      baseParams({
        prepared: value(preparePreset(p, {}, ids, fixedUuid)),
        profile: profile({ protocolVersion: '1.0', tools: [tool('get_weather')], context: [{ description: 'locale', value: 'en-US' }], forwardedProps: { mode: 'profile', extra: 1 } }),
        state: { order: 4471 },
      }),
    ),
  );
  assert.deepEqual(input, {
    threadId: 'thread-1',
    runId: 'run-1',
    protocolVersion: '1.0',
    state: { order: 4471 },
    messages: transcript,
    tools: [tool('get_weather')],
    context: [{ description: 'locale', value: 'en-US' }],
    forwardedProps: { tenant: 'acme', mode: 'profile', extra: 1 },
  });
  assert.equal(RunAgentInputSchema.safeParse(input).success, true);
  assert.equal('parentRunId' in input, false, 'no parent link unless the runtime supplies one');
  assert.equal('resume' in input, false);
});

test('every profile switch changes the next run input as described', () => {
  const run = (settings: Partial<ClientProfileSettings>, extra: Partial<Parameters<typeof composeRunInput>[0]> = {}) =>
    value(composeRunInput(baseParams({ profile: profile(settings), ...extra })));
  const base = run({});
  assert.equal(run({ protocolVersion: '1.7' }).protocolVersion, '1.7');
  assert.deepEqual(run({ tools: [tool('a'), tool('b')] }).tools.map((t) => t.name), ['a', 'b']);
  assert.deepEqual(run({ context: [{ description: 'k', value: 'v' }] }).context, [{ description: 'k', value: 'v' }]);
  assert.deepEqual(run({ injectA2uiTool: true }).tools, [RENDER_A2UI_TOOL]);
  assert.deepEqual(run({ messageMode: 'turn' }).messages, [transcript[2]]);
  assert.deepEqual(run({ forwardedProps: { x: 1 } }).forwardedProps, { x: 1 });
  assert.deepEqual(run({ renderA2ui: false }), base, 'rendering is a display choice and leaves the input unchanged');
  assert.deepEqual(run({ renderA2ui: true }), base);
});

test('the profile message mode overrides the preset; without one the preset decides', () => {
  const turnPreset = value(preparePreset(preset({ messages: 'turn' }), {}, ids, fixedUuid));
  const messages = (settings: Partial<ClientProfileSettings>, prepared = turnPreset) =>
    value(composeRunInput(baseParams({ prepared, profile: profile(settings) }))).messages;
  assert.deepEqual(messages({}), [transcript[2]]);
  assert.deepEqual(messages({ messageMode: 'full' }), transcript);
  const fullPreset = value(preparePreset(preset({ messages: 'full' }), {}, ids, fixedUuid));
  assert.deepEqual(messages({ messageMode: 'turn' }, fullPreset), [transcript[2]]);
  assert.deepEqual(messages({}, fullPreset), transcript);
});

test('injecting the render_a2ui tool adds the official declaration once, replacing a same-named profile tool', () => {
  const own: Tool = { name: RENDER_A2UI_TOOL.name, description: 'my own', parameters: {} };
  const input = value(composeRunInput(baseParams({ profile: profile({ tools: [tool('a'), own], injectA2uiTool: true }) })));
  assert.deepEqual(input.tools.map((t) => t.name), ['a', RENDER_A2UI_TOOL.name]);
  assert.deepEqual(input.tools[1], RENDER_A2UI_TOOL);
  const off = value(composeRunInput(baseParams({ profile: profile({ tools: [tool('a'), own], injectA2uiTool: false }) })));
  assert.deepEqual(off.tools[1], own, 'without injection the profile tool stays as written');
});

test('a continuation carries the parent link, the current state and its resume answers; turn mode sends no old messages', () => {
  const resume: ResumeEntry[] = [{ interruptId: 'i1', status: 'resolved', payload: { approved: true } }, { interruptId: 'i2', status: 'cancelled' }];
  const input = value(composeRunInput(baseParams({ profile: profile({ messageMode: 'turn' }), parentRunId: 'run-0', turnMessages: [], resume, state: { step: 2 } })));
  assert.equal(input.parentRunId, 'run-0');
  assert.deepEqual(input.resume, resume);
  assert.deepEqual(input.messages, []);
  assert.deepEqual(input.state, { step: 2 });
});

test('a tool continuation sends the tool messages the turn adds', () => {
  const toolMessage: Message = { id: 'm9', role: 'tool', toolCallId: 'call_1', content: '{"open":2}' };
  const withTool = [...transcript, toolMessage];
  const input = value(composeRunInput(baseParams({ transcript: withTool, turnMessages: [toolMessage], profile: profile({ messageMode: 'turn' }) })));
  assert.deepEqual(input.messages, [toolMessage]);
});

test('an A2UI action rides in forwardedProps.a2uiAction.userAction and cannot be overwritten', () => {
  const action: A2uiAction = { name: 'choose_refund_method', surfaceId: 'refund-options', sourceComponentId: 'btn_original', context: { method: 'original_payment' }, timestamp: '2026-10-02T14:07:31.402Z' };
  const prepared = value(preparePreset(preset({ forwardedProps: { tenant: 'acme' } }), {}, ids, fixedUuid));
  const input = value(composeRunInput(baseParams({ prepared, profile: profile({ forwardedProps: { tenant: 'override' } }), a2uiAction: action })));
  assert.deepEqual(input.forwardedProps, { tenant: 'override', a2uiAction: { userAction: action } });
  assert.deepEqual(Object.keys((input.forwardedProps as { a2uiAction: { userAction: object } }).a2uiAction.userAction).sort(), ['context', 'name', 'sourceComponentId', 'surfaceId', 'timestamp']);
  const polluted = { ...profile(), forwardedProps: { a2uiAction: { userAction: { name: 'forged' } } } } as ClientProfileSettings;
  assert.match(failure(composeRunInput(baseParams({ profile: polluted, a2uiAction: action }))), /a2uiAction.*reserved/i);
  assert.match(failure(composeRunInput(baseParams({ profile: polluted }))), /a2uiAction.*reserved/i);
});

test('ordinary input that fails the protocol schema is a visible error naming the field, not a sent request', () => {
  const broken = { id: 'x', role: 'wizard', content: 'hi' } as unknown as Message;
  const message = failure(composeRunInput(baseParams({ transcript: [broken], turnMessages: [broken] })));
  assert.match(message, /messages/);
  assert.match(failure(composeRunInput(baseParams({ ids: { threadId: '', runId: 'r' } }))), /thread id/i);
});

test('no composed input holds an authentication field', () => {
  const input = value(composeRunInput(baseParams({ profile: profile({ tools: [tool('a')], forwardedProps: { x: 1 } }) })));
  assert.doesNotMatch(JSON.stringify(input), /authorization|token|password|secret/i);
});

// ---------------------------------------------------------------------------------------------
// Theme maps in the configuration (FR-041, G-09, SC-010)
// ---------------------------------------------------------------------------------------------

const withTheme = (theme: unknown) => JSON.stringify({ version: 0, agents: [{ id: 'support', url: '/agents/support/stream' }], theme });
const SUPPORT = [{ id: 'support', url: '/agents/support/stream' }];

test('theme.light and theme.dark accept the ten public properties as strings', () => {
  const light = {
    '--agui-accent': '#2563eb',
    '--agui-accent-contrast': 'white',
    '--agui-tint-hue': '250',
    '--agui-tint-chroma': '0.01',
    '--agui-bg': 'oklch(0.99 0 0)',
    '--agui-fg': 'rgb(20 20 30)',
    '--agui-radius': '6px',
    '--agui-density': '0.85',
    '--agui-font-sans': '"Helvetica Neue", Arial, sans-serif',
    '--agui-font-mono': 'ui-monospace, monospace',
  };
  const dark = { '--agui-accent': '#93c5fd' };
  const parsed = value(parseConfig(withTheme({ light, dark })));
  assert.deepEqual(parsed.theme, { light, dark });
  assert.deepEqual(parsed.warnings, []);
  assert.deepEqual(parsed.agents, SUPPORT);
});

test('either map, any property and the whole field may be omitted without a warning', () => {
  assert.deepEqual(value(parseConfig(withTheme({ light: { '--agui-radius': '2px' } }))).theme, { light: { '--agui-radius': '2px' } });
  assert.deepEqual(value(parseConfig(withTheme({ dark: {} }))).theme, { dark: {} });
  const bare = value(parseConfig(config({ id: 'a', url: '/a' })));
  assert.equal(bare.theme, undefined);
  assert.deepEqual(bare.warnings, []);
  assert.deepEqual(value(parseConfig(withTheme({}))).warnings, []);
});

test('unknown, private and generic property names are rejected one by one; valid ones and the agents stay', () => {
  const rejected = ['--agui-accnt', '--bg', '--fg', '--muted', '--acc', '--r', '--u', '--sunk', 'agui-accent', '--AGUI-ACCENT', '--agui-bg ', 'color', '--', '__proto__', 'constructor'];
  for (const name of rejected) {
    const map = JSON.parse(`{${JSON.stringify(name)}: "red", "--agui-radius": "3px"}`);
    const parsed = value(parseConfig(withTheme({ light: map })));
    assert.deepEqual(parsed.theme, { light: { '--agui-radius': '3px' } }, name);
    assert.equal(parsed.warnings.length, 1, name);
    assert.match(parsed.warnings[0] ?? '', /not a public theme property/, name);
    assert.deepEqual(parsed.agents, SUPPORT);
  }
});

test('a value that is not a string, or is empty, is rejected with a warning naming the property', () => {
  for (const bad of [8, null, true, [], {}, '', '   ']) {
    const parsed = value(parseConfig(withTheme({ dark: { '--agui-density': bad, '--agui-radius': '4px' } })));
    assert.deepEqual(parsed.theme, { dark: { '--agui-radius': '4px' } }, JSON.stringify(bad));
    assert.match(parsed.warnings.join('\n'), /theme\.dark.*--agui-density.*nonempty string/, JSON.stringify(bad));
  }
});

test('a bad shape is ignored with a warning and never stops the agents loading', () => {
  for (const theme of [null, 'blue', 7, [], [{ light: {} }], true]) {
    const parsed = value(parseConfig(withTheme(theme)));
    assert.equal(parsed.theme, undefined, JSON.stringify(theme));
    assert.match(parsed.warnings.join('\n'), /^theme must be an object/, JSON.stringify(theme));
    assert.deepEqual(parsed.agents, SUPPORT);
  }
  for (const map of [null, 'red', 3, [], [['--agui-accent', 'red']]]) {
    const parsed = value(parseConfig(withTheme({ light: map, dark: { '--agui-accent': 'navy' } })));
    assert.deepEqual(parsed.theme, { dark: { '--agui-accent': 'navy' } }, JSON.stringify(map));
    assert.match(parsed.warnings.join('\n'), /theme\.light must be an object/, JSON.stringify(map));
  }
  const parsed = value(parseConfig(withTheme({ light: { '--agui-radius': '2px' }, sepia: { '--agui-radius': '9px' } })));
  assert.deepEqual(parsed.theme, { light: { '--agui-radius': '2px' } });
  assert.match(parsed.warnings.join('\n'), /theme: "sepia" is not a theme map/);
});

test('every value that could start a request or escape its declaration is rejected, in any case and spacing', () => {
  const unsafe = [
    'url(https://evil.example/x.png)', 'URL(x)', 'Url (x)', 'url\t(x)', 'url\n(x)', 'url  (x)', 'red url(x)', 'url(data:image/png;base64,AAAA)',
    'image-set(url(x) 1x)', 'IMAGE-SET(x 1x)', 'image-set (x 1x)', 'image-set\n(x 1x)', '-webkit-image-set(x 1x)', 'src(x)', 'image(x)', 'cross-fade(x, y)',
    '@import "x.css"', 'red @media print', '@font-face',
    'red; background: blue', ';', 'red;',
    'red } body { display: none', '{', '}', 'a{b}',
    'ur\\6c(x)', '\\75rl(x)', 'red\\', '\\',
  ];
  for (const text of unsafe) {
    for (const mode of ['light', 'dark']) {
      const parsed = value(parseConfig(withTheme({ [mode]: { '--agui-accent': text, '--agui-radius': '5px' } })));
      assert.deepEqual(parsed.theme, { [mode]: { '--agui-radius': '5px' } }, `${mode}: ${text}`);
      assert.match(parsed.warnings.join('\n'), new RegExp(`theme\\.${mode}.*--agui-accent`), text);
      assert.deepEqual(parsed.agents, SUPPORT);
    }
  }
});

test('ordinary values that merely resemble the denied syntax are accepted', () => {
  for (const text of ['oklch(0.5 0.1 250)', 'calc(var(--agui-tint-chroma) * 2)', 'color-mix(in oklab, red 40%, white)', 'ui-sans-serif, "Segoe UI", sans-serif', '"Source Sans 3", sans-serif', '0.85']) {
    const parsed = value(parseConfig(withTheme({ light: { '--agui-font-sans': text } })));
    assert.deepEqual(parsed.warnings, [], text);
    assert.equal(parsed.theme?.light?.['--agui-font-sans'], text);
  }
});

test('a theme problem is a warning, but a broken agent list is still the same visible error', () => {
  const broken = JSON.stringify({ agents: [{ id: '', url: '/a' }], theme: { light: { '--agui-accent': 'url(x)' } } });
  assert.match(failure(parseConfig(broken)), /id/);
  const loaded = value(parseConfig(withTheme({ light: { '--agui-accent': 'url(x)' } })));
  assert.equal(loaded.agents.length, 1);
  assert.equal(loaded.warnings.length, 1);
  assert.doesNotMatch(loaded.warnings[0] ?? '', /evil|https?:/);
});

test('loading a configuration with a theme makes exactly the one request it was handed', async () => {
  const urls: string[] = [];
  const loaded = await loadConfig('config.json', async (url) => {
    urls.push(url);
    return withTheme({ light: { '--agui-accent': 'url(https://evil.example/a.png)', '--agui-radius': '3px' } });
  });
  assert.deepEqual(urls, ['config.json']);
  assert.deepEqual(value(loaded).theme, { light: { '--agui-radius': '3px' } });
});
