// Spec 016, FR-001 to FR-005 and FR-014: the remembered setup in browser storage, and its merge with a launch link
// and the configuration. The order is link, then saved, then the configuration's defaults, and whatever no longer
// fits is dropped with one warning while the rest applies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentConfig, TransportPolicy } from '../../src/contracts.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { loadSetup, parseLaunchLink, resolveSetup, saveSetup, SETUP_STORAGE_KEY, type SetupSources } from '../../src/core/setup/index.ts';

const memory = (initial: Record<string, string> = {}) => {
  const items = { ...initial };
  return { items, getItem: (key: string) => items[key] ?? null, setItem: (key: string, value: string) => void (items[key] = value) };
};
const broken = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError');
  },
  setItem: () => {
    throw new DOMException('full', 'QuotaExceededError');
  },
};

const agents: AgentConfig[] = [
  { id: 'first', url: '/first' },
  { id: 'support', url: '/support', preset: { variables: { userId: { default: 'dev' }, seed: { default: { plan: 'free' }, type: 'json' } } } },
  { id: 'other', url: '/other', preset: { variables: { userId: { default: 'x' } } } },
];
const embedded: TransportPolicy = { mode: 'embedded', pageOrigin: 'https://inspector.example', allowedOrigins: [] };
const hosted: TransportPolicy = { mode: 'hosted', pageOrigin: 'https://inspector.example', allowedOrigins: ['https://agent.example'] };
const sources = (more: Partial<SetupSources> = {}): SetupSources => ({ agents, policy: embedded, profile: defaultProfile(), ...more });
const linkOf = (params: Record<string, string>) => parseLaunchLink(`#${new URLSearchParams(params)}`).values;

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

test('a saved setup is read back, and it is the only key written', () => {
  const storage = memory();
  saveSetup(storage, { agent: 'support', variables: { userId: '42', seed: { plan: 'pro' } } });
  assert.deepEqual(loadSetup(storage), { ok: true, value: { agent: 'support', variables: { userId: '42', seed: { plan: 'pro' } } } });
  assert.deepEqual(Object.keys(storage.items), [SETUP_STORAGE_KEY]);
  assert.deepEqual(JSON.parse(storage.items[SETUP_STORAGE_KEY] ?? ''), { version: 0, setup: { agent: 'support', variables: { userId: '42', seed: { plan: 'pro' } } } });

  saveSetup(storage, { endpoint: 'https://agent.example/run' });
  assert.deepEqual(loadSetup(storage), { ok: true, value: { endpoint: 'https://agent.example/run' } });
});

test('nothing saved, or storage that throws, is no setup and never an error', () => {
  assert.deepEqual(loadSetup(memory()), { ok: true, value: undefined });
  assert.deepEqual(loadSetup(broken), { ok: true, value: undefined });
  assert.doesNotThrow(() => saveSetup(broken, { agent: 'support' }));
});

test('a saved setup that cannot be used is an error to show', () => {
  const bad = [
    'not json',
    '[]',
    JSON.stringify({ version: 1, setup: { agent: 'a' } }),
    JSON.stringify({ setup: { agent: 'a' } }),
    JSON.stringify({ version: 0, setup: { agent: 'a' }, extra: 1 }),
    JSON.stringify({ version: 0, setup: { agent: 'a', endpoint: '/b' } }),
    JSON.stringify({ version: 0, setup: { endpoint: '/b', variables: {} } }),
    JSON.stringify({ version: 0, setup: { variables: {} } }),
    JSON.stringify({ version: 0, setup: { agent: '' } }),
    JSON.stringify({ version: 0, setup: { agent: 'a', variables: [] } }),
    JSON.stringify({ version: 0, setup: { agent: 'a', token: 'x' } }),
  ];
  for (const text of bad) {
    const loaded = loadSetup(memory({ [SETUP_STORAGE_KEY]: text }));
    assert.equal(loaded.ok, false, text);
    if (!loaded.ok) assert.match(loaded.error, /^The saved setup was not used: /);
  }
});

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

test('without a link or a saved setup, the first agent is selected as before', () => {
  assert.deepEqual(resolveSetup(sources()), { selection: { agent: 'first' }, variables: {}, profile: defaultProfile(), keys: [], warnings: [], linkWarnings: [] });
  assert.deepEqual(resolveSetup(sources({ agents: [] })), { variables: {}, profile: defaultProfile(), keys: [], warnings: [], linkWarnings: [] });
});

test('a saved agent comes back with its variables, and a saved endpoint comes back as the target', () => {
  const agent = resolveSetup(sources({ saved: { agent: 'support', variables: { userId: '42', seed: { plan: 'pro' } } } }));
  assert.deepEqual(agent.selection, { agent: 'support' });
  assert.deepEqual(agent.variables, { userId: '42', seed: { plan: 'pro' } });
  assert.deepEqual(agent.warnings, []);

  const endpoint = resolveSetup(sources({ saved: { endpoint: '/typed/run' } }));
  assert.deepEqual(endpoint.selection, { endpoint: '/typed/run' });
  assert.deepEqual(endpoint.variables, {});
});

test('saved values that no longer fit are dropped with a warning and the rest applies', () => {
  const gone = resolveSetup(sources({ saved: { agent: 'removed', variables: { userId: '1' } } }));
  assert.deepEqual(gone.selection, { agent: 'first' });
  assert.deepEqual(gone.warnings, ['The saved agent "removed" is no longer configured; the first agent is selected']);

  const refused = resolveSetup(sources({ saved: { endpoint: 'https://elsewhere.example/run' } }));
  assert.deepEqual(refused.selection, { agent: 'first' });
  assert.equal(refused.warnings.length, 1);
  assert.match(refused.warnings[0] ?? '', /^The saved endpoint was not used: https:\/\/elsewhere\.example is not an allowed destination/);

  const variables = resolveSetup(sources({ saved: { agent: 'support', variables: { userId: 42, gone: 'x', seed: [1] } } }));
  assert.deepEqual(variables.variables, { seed: [1] });
  assert.deepEqual(variables.warnings, ['The saved variable "userId" is not text; it was dropped', 'The saved variable "gone" is not declared by agent "support"; it was dropped']);
});

test('a link beats the saved setup, and what it does not set comes from the saved setup', () => {
  const saved = { agent: 'support', variables: { userId: '42', seed: { plan: 'pro' } } } as const;
  const both = resolveSetup(sources({ saved, link: linkOf({ agent: 'support', 'var.userId': '7', message: 'hi' }) }));
  assert.deepEqual(both.selection, { agent: 'support' });
  assert.deepEqual(both.variables, { userId: '7', seed: { plan: 'pro' } });
  assert.deepEqual(both.keys, ['agent', 'var.userId', 'message']);

  const onlyMessage = resolveSetup(sources({ saved, link: linkOf({ message: 'hi' }) }));
  assert.deepEqual(onlyMessage.selection, { agent: 'support' });
  assert.deepEqual(onlyMessage.variables, { userId: '42', seed: { plan: 'pro' } });
  assert.deepEqual(onlyMessage.keys, ['message']);

  const onlyVariable = resolveSetup(sources({ saved, link: linkOf({ 'var.userId': '9' }) }));
  assert.deepEqual(onlyVariable.variables, { userId: '9', seed: { plan: 'pro' } });
});

test('a link that selects another agent starts from that agent defaults', () => {
  const resolved = resolveSetup(sources({ saved: { agent: 'support', variables: { userId: '42' } }, link: linkOf({ agent: 'other' }) }));
  assert.deepEqual(resolved.selection, { agent: 'other' });
  assert.deepEqual(resolved.variables, {});
  assert.deepEqual(resolved.warnings, []);
});

test('a link endpoint is checked like a typed one', () => {
  const allowed = resolveSetup(sources({ policy: hosted, saved: { agent: 'support' }, link: linkOf({ endpoint: 'https://agent.example/run' }) }));
  assert.deepEqual(allowed.selection, { endpoint: 'https://agent.example/run' });
  assert.deepEqual(allowed.keys, ['endpoint']);

  const refused = resolveSetup(sources({ saved: { agent: 'support' }, link: linkOf({ endpoint: 'https://elsewhere.example/run', message: 'hi' }) }));
  assert.deepEqual(refused.selection, { agent: 'support' });
  assert.deepEqual(refused.keys, ['message']);
  assert.match(refused.linkWarnings[0] ?? '', /^endpoint: https:\/\/elsewhere\.example is not an allowed destination.*It was ignored$/);

  const credentials = resolveSetup(sources({ link: linkOf({ endpoint: 'https://user:SYNTHETIC-016@inspector.example/run' }) }));
  assert.deepEqual(credentials.selection, { agent: 'first' });
  assert.equal(credentials.linkWarnings.length, 1);
  assert.match(credentials.linkWarnings[0] ?? '', /must not contain credentials/);
  assert.ok(!credentials.linkWarnings[0]?.includes('SYNTHETIC-016'));
});

test('link variables are checked against the selected agent preset', () => {
  const resolved = resolveSetup(sources({ link: linkOf({ agent: 'support', 'var.userId': '42', 'var.seed': '{"plan":"pro"}', 'var.nope': 'x' }) }));
  assert.deepEqual(resolved.variables, { userId: '42', seed: { plan: 'pro' } });
  assert.deepEqual(resolved.linkWarnings, ['var.nope: agent "support" declares no such variable; it was ignored']);

  const badJson = resolveSetup(sources({ saved: { agent: 'support', variables: { seed: { plan: 'pro' } } }, link: linkOf({ 'var.seed': '{bad' }) }));
  assert.deepEqual(badJson.variables, { seed: { plan: 'pro' } });
  assert.deepEqual(badJson.linkWarnings, ['var.seed is a JSON variable and the value is not valid JSON; it was ignored']);

  const endpoint = resolveSetup(sources({ link: linkOf({ endpoint: '/typed', 'var.userId': '42' }) }));
  assert.deepEqual(endpoint.variables, {});
  assert.deepEqual(endpoint.linkWarnings, ['var.userId: only a configured agent has variables; it was ignored']);
});

test('an unknown link agent keeps the saved one', () => {
  const resolved = resolveSetup(sources({ saved: { agent: 'support', variables: { userId: '42' } }, link: linkOf({ agent: 'nobody' }) }));
  assert.deepEqual(resolved.selection, { agent: 'support' });
  assert.deepEqual(resolved.variables, { userId: '42' });
  assert.deepEqual(resolved.linkWarnings, ['agent: no configured agent has this id; it was ignored']);
});

test('link context and forwarded properties replace the profile fields, and the rest of the profile stays', () => {
  const profile = { ...defaultProfile(), context: [{ description: 'old', value: 'x' }], forwardedProps: { keep: 1 }, messageMode: 'turn' as const };
  const resolved = resolveSetup(sources({ profile, link: linkOf({ context: JSON.stringify([{ description: 'locale', value: 'fr-FR' }]), forwardedProps: JSON.stringify({ tenant: 'acme' }) }) }));
  assert.deepEqual(resolved.profile, { ...profile, context: [{ description: 'locale', value: 'fr-FR' }], forwardedProps: { tenant: 'acme' } });
  assert.deepEqual(resolved.keys, ['context', 'forwardedProps']);
  assert.equal(resolveSetup(sources({ profile })).profile, profile);
});
