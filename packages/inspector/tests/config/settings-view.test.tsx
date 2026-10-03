// L01 T023 (unit side): the settings view renders every setting as a labelled native control, shows
// the eleven capability groups and the preset variables, surfaces errors, and has nowhere to type or
// keep a credential. Interaction runs in the Playwright spec; here the markup is checked statically.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CAPABILITY_GROUPS, type AgentConfig, type SettingsViewProps } from '../../src/contracts.ts';
import { defaultProfile } from '../../src/core/profiles/index.ts';
import { SettingsView, type CapabilitiesState } from '../../src/views/settings/index.tsx';
import { describeCapabilities } from '../../src/core/config/index.ts';

const calls: string[] = [];
const spy = (name: string) => () => void calls.push(name);

const support: AgentConfig = {
  id: 'support',
  name: 'Support assistant',
  url: '/agents/support/stream',
  capabilities: { identity: { name: 'Support', version: '2.3.0' }, tools: { supported: true, parallelCalls: false }, multimodal: { input: { image: true } } },
  preset: {
    variables: { userId: { default: 'dev-{{uuid}}' }, seed: { default: { plan: 'free' }, type: 'json' } },
    forwardedProps: { user_id: '{{userId}}' },
    messages: 'turn',
    prepare: [{ method: 'PUT', path: '/agents/support/sessions/{{threadId}}', body: { user_id: '{{userId}}' } }],
  },
};
const remote: AgentConfig = { id: 'remote', url: 'https://agent.example/run', capabilities: '/agents/remote/capabilities' };
const bare: AgentConfig = { id: 'bare', url: '/bare' };

const props = (patch: Partial<SettingsViewProps> = {}): SettingsViewProps => ({
  agents: [support, remote, bare],
  selectedAgentId: 'support',
  profile: { ...defaultProfile(), tools: [{ name: 'get_open_returns', description: 'Lists open returns', parameters: { type: 'object' } }], context: [{ description: 'Storefront locale', value: 'en-US' }] },
  variables: {},
  onSelectAgent: spy('onSelectAgent'),
  onChangeProfile: spy('onChangeProfile'),
  onChangeVariable: spy('onChangeVariable'),
  onImportProfile: spy('onImportProfile'),
  onExportProfile: spy('onExportProfile'),
  ...patch,
});

const render = (patch: Partial<SettingsViewProps> = {}, capabilities?: CapabilitiesState) =>
  renderToStaticMarkup(<SettingsView {...props(patch)} capabilities={capabilities} />);

test('the view is the labelled settings section and renders without calling anything', () => {
  const markup = render();
  assert.match(markup, /^<section aria-labelledby="settings-heading" data-view="settings"/);
  assert.match(markup, /<h2 id="settings-heading">Settings<\/h2>/);
  assert.doesNotMatch(markup, /not-implemented/);
  assert.deepEqual(calls, []);
});

test('the agent picker names the selected agent and lists every configured one with its endpoint', () => {
  const markup = render();
  assert.match(markup, /Support assistant/);
  for (const text of ['/agents/support/stream', 'https://agent.example/run', '/bare', 'bare', 'remote']) assert.ok(markup.includes(text), text);
  assert.match(markup, /popover/);
  assert.match(markup, /aria-pressed="true"[^>]*>(?:(?!<\/button>).)*Support assistant/s);
});

test('with agents but none selected the picker reads Custom URL and no agent panel is shown', () => {
  const markup = render({ selectedAgentId: undefined });
  assert.match(markup, /<span class="agui-settings-picker-name">Custom URL<\/span>/);
  assert.doesNotMatch(markup, /aria-pressed="true"[^>]*>(?:(?!<\/button>).)*(?:Support assistant|\/bare)/s, 'no agent is marked as chosen');
  assert.doesNotMatch(markup, /No agents loaded/);
});

test('without agents the view says so and still renders the profile', () => {
  const markup = render({ agents: [], selectedAgentId: undefined });
  assert.match(markup, /No agents loaded/);
  assert.match(markup, /Client profile/);
});

test('inline capabilities show all eleven groups in order, with declared values', () => {
  const markup = render();
  let at = -1;
  for (const group of CAPABILITY_GROUPS) {
    const found = markup.indexOf(`>${group}<`);
    assert.ok(found > at, `${group} follows the group before it`);
    at = found;
  }
  assert.match(markup, />version: 2\.3\.0</);
  assert.match(markup, /Not declared/);
});

test('a url declaration shows loading, an error, or the loaded groups with their source', () => {
  const view = (capabilities?: CapabilitiesState) => render({ selectedAgentId: 'remote' }, capabilities);
  assert.match(view(), /\/agents\/remote\/capabilities/);
  assert.match(view({ status: 'loading' }), /Loading/);
  const failed = view({ status: 'error', message: 'Capabilities /agents/remote/capabilities: blocked by CORS' });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /blocked by CORS/);
  const groups = describeCapabilities({ state: { snapshots: true, deltas: false } });
  const ready = view({ status: 'ready', capabilities: { source: 'url', url: '/agents/remote/capabilities', groups } });
  assert.match(ready, />snapshots</);
  assert.match(ready, /agui-settings-off/);
});

test('a configuration with no declaration says so', () => {
  assert.match(render({ selectedAgentId: 'bare' }), /declares no capabilities/i);
});

test('every profile setting is a labelled native control reflecting its value', () => {
  const markup = render();
  assert.match(markup, /aria-label="Protocol version"[^>]*value="1\.0"|value="1\.0"[^>]*aria-label="Protocol version"/);
  assert.match(markup, /role="group" aria-label="Message mode"/);
  assert.match(markup, /Preset default: current turn/);
  assert.match(markup, /role="switch"[^>]*aria-checked="true"[^>]*aria-label="Render A2UI surfaces"|aria-checked="true"[^>]*aria-label="Render A2UI surfaces"/);
  assert.match(markup, /aria-checked="false"[^>]*aria-label="Inject render_a2ui tool"/);
  assert.match(markup, /get_open_returns/);
  assert.match(markup, /Storefront locale/);
  assert.match(markup, /aria-label="Forwarded properties"/);
  assert.match(markup, /aria-label="Remove tool get_open_returns"/);
});

test('the message mode offers the preset default, the full transcript and the current turn', () => {
  const none = render();
  assert.match(none, /aria-pressed="true"[^>]*>Preset default/);
  const turn = render({ profile: { ...defaultProfile(), messageMode: 'turn' } });
  assert.match(turn, /aria-pressed="true"[^>]*>Current turn/);
  const full = render({ profile: { ...defaultProfile(), messageMode: 'full' } });
  assert.match(full, /aria-pressed="true"[^>]*>Full transcript/);
});

test('preset variables render by kind: a text field and a JSON editor, with edited values shown', () => {
  const markup = render({ variables: { userId: 'dev-fixed' } });
  assert.match(markup, /aria-label="Variable userId"[^>]*value="dev-fixed"|value="dev-fixed"[^>]*aria-label="Variable userId"/);
  assert.match(markup, /<textarea[^>]*aria-label="Variable seed"[^>]*>[^<]*&quot;plan&quot;: &quot;free&quot;/);
  assert.match(markup, /PUT \/agents\/support\/sessions\/\{\{threadId\}\}/);
  assert.match(markup, /filled in when the run starts/i);
});

test('a visible error from the caller is an alert', () => {
  const markup = render({ error: 'Profile is not valid JSON: Unexpected token' });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Profile is not valid JSON/);
});

test('profile import and export are offered, with the note that tokens are never saved', () => {
  const markup = render();
  assert.match(markup, />Export profile</);
  assert.match(markup, />Import profile</);
  assert.match(markup, /type="file"/);
  assert.match(markup, /Saved in this browser\. Tokens are never saved\./);
});

test('there is nowhere to enter or keep a credential in the settings', () => {
  const markup = render();
  assert.doesNotMatch(markup, /type="password"/);
  assert.doesNotMatch(markup, /aria-label="[^"]*(?:token|password|authorization|header)[^"]*"/i);
  assert.doesNotMatch(markup, /autocomplete="(?:current|new)-password"/);
});
