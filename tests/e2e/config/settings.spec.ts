// L01 T023 (US4, SC-005, SC-008): configuration, presets and the client profile in a real browser.
// The page is the real settings view wired to the real core modules and to a scripted request seam
// (packages/inspector/tests/config/harness.tsx) that sends preparation and run requests to the
// loopback reference server (examples/reference-agent/config-scenarios.ts), which records their
// bodies. Every assertion about "what the next run carries" reads those recorded bodies, not the UI.
//
// Every test also checks the network allowlist: the page may talk to its own origin and nothing else.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';
import { createScenarioServer, type RecordedRequest } from '../../../examples/reference-agent/config-scenarios.ts';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const GROUPS = ['identity', 'transport', 'tools', 'output', 'state', 'multiAgent', 'reasoning', 'multimodal', 'execution', 'humanInTheLoop', 'custom'];
const SYNTHETIC_TOKEN = 'synthetic-token-7f3a91';

interface Site {
  readonly origin: string;
  requests(): readonly RecordedRequest[];
  paths(): readonly string[];
  reset(): void;
}

interface RunInput {
  threadId: string;
  runId: string;
  protocolVersion: string;
  state: unknown;
  messages: Array<{ role: string; content: string }>;
  tools: Array<{ name: string; description: string; parameters?: unknown }>;
  context: Array<{ description: string; value: string }>;
  forwardedProps: Record<string, unknown>;
  [key: string]: unknown;
}

const test = base.extend<{ requested: string[] }, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'config-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { harness: path.join(root, 'packages', 'inspector', 'tests', 'config', 'harness.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>settings harness</title>
    <link rel="stylesheet" href="/harness.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/harness.js"></script></body>
</html>`;
      const server = await createScenarioServer({
        '/': ['text/html', page],
        '/harness.js': ['text/javascript', readFileSync(path.join(outdir, 'harness.js'), 'utf8')],
        '/harness.css': ['text/css', readFileSync(path.join(outdir, 'harness.css'), 'utf8')],
      });
      await use(server);
      await server.close();
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  /** Every URL the page requests; after each test none may be outside the page's own origin. */
  requested: [
    async ({ page, site }, use) => {
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await use(urls);
      const outside = urls.filter((url) => !url.startsWith(`${site.origin}/`) && !url.startsWith('blob:') && !url.startsWith('data:'));
      expect(outside, 'requests outside the page origin').toEqual([]);
    },
    { auto: true },
  ],
});

const runs = (site: Site) => site.requests().filter((request) => request.kind === 'run');
const preparations = (site: Site) => site.requests().filter((request) => request.kind === 'preparation');
const lastRun = (site: Site) => runs(site).at(-1)?.body as RunInput;
/** The input without the identifiers that differ from run to run. */
const withoutRunId = ({ runId: _runId, messages, ...rest }: RunInput) => ({ ...rest, messages: messages.map(({ role, content }) => ({ role, content })) });

async function open(page: Page, site: Site): Promise<void> {
  site.reset();
  await page.goto(site.origin);
  await expect(page.getByRole('button', { name: 'Support assistant', exact: true })).toBeVisible();
}

async function selectAgent(page: Page, current: string, name: RegExp): Promise<void> {
  await page.getByRole('button', { name: current, exact: true }).click();
  await page.getByRole('button', { name }).click();
}

/** Sends a message through the scripted seam and waits until the run request has been recorded. */
async function send(page: Page, site: Site, message: string): Promise<RunInput> {
  const before = runs(site).length;
  await page.getByLabel('Message', { exact: true }).fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(() => runs(site).length).toBe(before + 1);
  return lastRun(site);
}

const protocolField = (page: Page) => page.getByRole('textbox', { name: 'Protocol version' });
const forwardedField = (page: Page) => page.getByRole('textbox', { name: 'Forwarded properties' });
const toggle = (page: Page, name: string) => page.getByRole('switch', { name });

// ---------------------------------------------------------------------------------------------
// US4.1: agents, declared capabilities, quick messages
// ---------------------------------------------------------------------------------------------

test('the configured agents are listed with their endpoints and the selected one is used', async ({ page, site }) => {
  await open(page, site);
  expect(site.paths()).toContain('GET /config.json');
  await page.getByRole('button', { name: 'Support assistant', exact: true }).click();
  const agents = page.locator('.agui-settings-agents');
  for (const name of ['Support assistant', 'Remote agent', 'Broken capabilities', 'Undefined variable', 'Plain agent']) {
    await expect(agents.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(agents.getByRole('button', { name: /^Support assistant/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(agents.getByRole('button', { name: /^Remote agent/ })).toContainText('/agent');
  await page.getByRole('button', { name: /^Plain agent/ }).click();
  await expect(page.getByRole('button', { name: 'Plain agent', exact: true })).toBeVisible();
  await expect(page.getByText('This agent declares no capabilities in the configuration.')).toBeVisible();

  const input = await send(page, site, 'hello');
  expect(runs(site)[0]?.path).toBe('/agent');
  expect(input.messages.map((message) => message.content)).toEqual(['hello']);
  expect(preparations(site)).toEqual([]);
});

test('declared capabilities show in the eleven documented groups, inline or from a configured url', async ({ page, site }) => {
  await open(page, site);
  for (const group of GROUPS) await expect(page.locator('.agui-settings-key', { hasText: new RegExp(`^${group}$`) })).toBeVisible();
  await expect(page.getByText('name: Support', { exact: true })).toBeVisible();
  await expect(page.getByText('refund.policy_version: 2026-07')).toBeVisible();
  await expect(page.locator('.agui-settings-grid-row', { hasText: /^reasoning/ })).toContainText('Not declared');
  expect(site.paths().filter((entry) => entry.includes('/capabilities')), 'inline capabilities need no request').toEqual([]);

  await selectAgent(page, 'Support assistant', /^Remote agent/);
  await expect(page.getByText('name: Remote', { exact: true })).toBeVisible();
  await expect(page.locator('.agui-settings-off', { hasText: 'supported' })).toBeVisible();
  expect(site.paths().filter((entry) => entry.includes('/capabilities'))).toEqual(['GET /agents/remote/capabilities']);
});

test('a capabilities url that fails shows the failure and nothing else is requested', async ({ page, site }) => {
  await open(page, site);
  await selectAgent(page, 'Support assistant', /^Broken capabilities/);
  await expect(page.getByRole('alert')).toContainText('/agents/broken/capabilities');
  await expect(page.getByRole('alert')).toContainText('404');
  expect(site.paths().filter((entry) => entry.includes('/capabilities'))).toEqual(['GET /agents/broken/capabilities']);
});

test('a preset quick message goes through the ordinary run path', async ({ page, site }) => {
  await open(page, site);
  await page.getByRole('button', { name: '/help' }).click();
  await expect.poll(() => runs(site).length).toBe(1);
  expect(lastRun(site).messages).toEqual([expect.objectContaining({ role: 'user', content: '/help' })]);
  expect(preparations(site).map((request) => request.path)).toEqual([expect.stringMatching(/^\/prepare\/sessions\//), '/prepare/warm']);
});

// ---------------------------------------------------------------------------------------------
// US4.2/4.3: variables, substitution types, ordered preparation
// ---------------------------------------------------------------------------------------------

test('a run prepares in declared order and substitutes variables, keeping JSON types for whole values', async ({ page, site }) => {
  await open(page, site);
  const input = await send(page, site, 'hello');

  const [session, warm] = preparations(site);
  expect(site.requests().map((request) => `${request.kind} ${request.method} ${request.path}`)).toEqual([
    'preparation PUT /prepare/sessions/thread-1',
    'preparation POST /prepare/warm',
    'run POST /agent',
  ]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const userId = (session?.body as { user_id: string }).user_id;
  expect(userId).toMatch(/^dev-/);
  expect(userId.slice(4)).toMatch(uuid);

  // A JSON variable that fills a whole string stays an object, number or array; inside text it is serialized.
  expect(session?.body).toEqual({
    user_id: userId,
    context: { plan: 'free', tags: ['new'] },
    note: 'plan={"plan":"free","tags":["new"]}',
  });
  expect(warm?.body).toEqual({ run: 'run-1', trace: userId.slice(4) });

  expect(input.forwardedProps).toEqual({ user_id: userId, seed: { plan: 'free', tags: ['new'] }, limit: 3, trace: userId.slice(4), tenant: 'acme' });
  expect(typeof input.forwardedProps.limit).toBe('number');
  expect(input.threadId).toBe('thread-1');
  expect(input).toMatchObject({ protocolVersion: '1.0', state: {}, tools: [], context: [] });
  expect(input.messages).toEqual([expect.objectContaining({ role: 'user', content: 'hello' })]);

  const next = await send(page, site, 'again');
  expect((next.forwardedProps.user_id as string).slice(4), 'a fresh uuid for the next dispatch').not.toBe(userId.slice(4));
  expect(next.messages.map((message) => message.content), 'the preset asks for the current turn only').toEqual(['again']);
});

test('edited variables replace the defaults and keep their types', async ({ page, site }) => {
  await open(page, site);
  await page.getByRole('textbox', { name: 'Variable userId' }).fill('qa-user');
  await page.getByRole('textbox', { name: 'Variable seed' }).fill('{"plan":"pro","seats":12}');
  await page.getByRole('textbox', { name: 'Variable limit' }).fill('10');
  const input = await send(page, site, 'hello');
  expect(input.forwardedProps).toMatchObject({ user_id: 'qa-user', seed: { plan: 'pro', seats: 12 }, limit: 10 });
  expect(typeof input.forwardedProps.limit).toBe('number');
  expect(preparations(site)[0]?.body).toMatchObject({ user_id: 'qa-user', context: { plan: 'pro', seats: 12 }, note: 'plan={"plan":"pro","seats":12}' });

  await page.getByRole('textbox', { name: 'Variable seed' }).fill('[1, "two", null]');
  const array = await send(page, site, 'again');
  expect(array.forwardedProps.seed).toEqual([1, 'two', null]);
});

test('malformed JSON in a variable is shown, not applied and not sent', async ({ page, site }) => {
  await open(page, site);
  const seed = page.getByRole('textbox', { name: 'Variable seed' });
  await seed.fill('{"plan":');
  await expect(page.getByRole('alert').filter({ hasText: 'Not valid JSON' })).toBeVisible();
  await expect(seed).toHaveAttribute('aria-invalid', 'true');
  const input = await send(page, site, 'hello');
  expect(input.forwardedProps.seed, 'the last valid value stays in use').toEqual({ plan: 'free', tags: ['new'] });
  await seed.fill('{"plan":"ok"}');
  await expect(page.getByRole('alert').filter({ hasText: 'Not valid JSON' })).toHaveCount(0);
});

test('an undefined variable fails the dispatch visibly and sends nothing', async ({ page, site }) => {
  await open(page, site);
  await selectAgent(page, 'Support assistant', /^Undefined variable/);
  await page.getByLabel('Message', { exact: true }).fill('hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByTestId('dispatch-error')).toContainText('undefined variable "nobody"');
  await expect(page.getByTestId('dispatch-error')).toContainText('forwardedProps.who');
  expect(site.requests()).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// US4.4: every profile switch changes the next run input
// ---------------------------------------------------------------------------------------------

test.describe('profile switches', () => {
  test.beforeEach(async ({ page, site }) => {
    await open(page, site);
    await selectAgent(page, 'Support assistant', /^Plain agent/);
  });

  test('protocol version', async ({ page, site }) => {
    expect((await send(page, site, 'a')).protocolVersion).toBe('1.0');
    await protocolField(page).fill('1.1');
    expect((await send(page, site, 'b')).protocolVersion).toBe('1.1');
    await protocolField(page).fill('');
    await expect(page.getByRole('alert').filter({ hasText: 'cannot be empty' })).toBeVisible();
    expect((await send(page, site, 'c')).protocolVersion, 'the last valid value stays in use').toBe('1.1');
  });

  test('message mode: preset default, full transcript, current turn', async ({ page, site }) => {
    const contents = async (message: string) => (await send(page, site, message)).messages.map((entry) => entry.content);
    expect(await contents('one')).toEqual(['one']);
    expect(await contents('two'), 'no preset: the full transcript is the default').toEqual(['one', 'Hello from the reference agent.', 'two']);
    await page.getByRole('button', { name: 'Current turn' }).click();
    await expect(page.getByRole('button', { name: 'Current turn' })).toHaveAttribute('aria-pressed', 'true');
    expect(await contents('three')).toEqual(['three']);
    await page.getByRole('button', { name: 'Full transcript' }).click();
    expect((await contents('four')).length).toBe(7);
    await page.getByRole('button', { name: 'Preset default' }).click();
    expect((await contents('five')).length).toBe(9);
  });

  test('the A2UI render switch is a display choice and leaves the run input unchanged', async ({ page, site }) => {
    await expect(toggle(page, 'Render A2UI surfaces')).toHaveAttribute('aria-checked', 'true');
    const on = await send(page, site, 'same');
    await toggle(page, 'Render A2UI surfaces').click();
    await expect(toggle(page, 'Render A2UI surfaces')).toHaveAttribute('aria-checked', 'false');
    const off = await send(page, site, 'same');
    expect(withoutRunId(off).tools).toEqual(withoutRunId(on).tools);
    expect(withoutRunId(off).messages.at(-1)).toEqual(withoutRunId(on).messages.at(-1));
    expect({ ...withoutRunId(off), messages: [] }).toEqual({ ...withoutRunId(on), messages: [] });
  });

  test('injecting the render_a2ui tool adds the official declaration, once', async ({ page, site }) => {
    expect((await send(page, site, 'a')).tools).toEqual([]);
    await toggle(page, 'Inject render_a2ui tool').click();
    const injected = await send(page, site, 'b');
    expect(injected.tools.map((tool) => tool.name)).toEqual(['render_a2ui']);
    expect(injected.tools[0]?.parameters).toBeTruthy();
    await toggle(page, 'Inject render_a2ui tool').click();
    expect((await send(page, site, 'c')).tools).toEqual([]);
  });

  test('client tools with their JSON Schemas: add, reject a duplicate or bad schema, remove', async ({ page, site }) => {
    await page.getByRole('textbox', { name: 'Tool name' }).fill('get_open_returns');
    await page.getByRole('textbox', { name: 'Tool description' }).fill('Lists open returns');
    await page.getByRole('textbox', { name: 'Tool JSON Schema' }).fill('{"type":"object","properties":{"order":{"type":"string"}},"required":["order"]}');
    await page.getByRole('button', { name: 'Add tool' }).click();
    await expect(page.getByText('get_open_returns', { exact: true })).toBeVisible();
    expect((await send(page, site, 'a')).tools).toEqual([
      { name: 'get_open_returns', description: 'Lists open returns', parameters: { type: 'object', properties: { order: { type: 'string' } }, required: ['order'] } },
    ]);

    await page.getByRole('textbox', { name: 'Tool name' }).fill('get_open_returns');
    await page.getByRole('button', { name: 'Add tool' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'duplicate tool name' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Tool name' }).fill('other');
    await page.getByRole('textbox', { name: 'Tool JSON Schema' }).fill('{ nope');
    await page.getByRole('button', { name: 'Add tool' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not valid JSON' })).toBeVisible();
    expect((await send(page, site, 'b')).tools.map((tool) => tool.name), 'a rejected tool is not sent').toEqual(['get_open_returns']);

    await page.getByRole('button', { name: 'Remove tool get_open_returns' }).click();
    expect((await send(page, site, 'c')).tools).toEqual([]);
  });

  test('context entries: add and remove', async ({ page, site }) => {
    await page.getByRole('textbox', { name: 'Context description' }).fill('Storefront locale');
    await page.getByRole('textbox', { name: 'Context value' }).fill('en-US');
    await page.getByRole('button', { name: 'Add context' }).click();
    expect((await send(page, site, 'a')).context).toEqual([{ description: 'Storefront locale', value: 'en-US' }]);
    await page.getByRole('button', { name: 'Remove context Storefront locale' }).click();
    expect((await send(page, site, 'b')).context).toEqual([]);
  });

  test('forwarded properties: valid JSON applies, malformed or reserved JSON is shown and not applied', async ({ page, site }) => {
    await forwardedField(page).fill('{"tenant":"profile","extra":[1,2]}');
    expect((await send(page, site, 'a')).forwardedProps).toEqual({ tenant: 'profile', extra: [1, 2] });
    await forwardedField(page).fill('{"tenant":');
    await expect(page.getByRole('alert').filter({ hasText: 'Not valid JSON' })).toBeVisible();
    await forwardedField(page).fill('[1]');
    await expect(page.getByRole('alert').filter({ hasText: 'must be a JSON object' })).toBeVisible();
    await forwardedField(page).fill('{"a2uiAction":{}}');
    await expect(page.getByRole('alert').filter({ hasText: 'reserved' })).toBeVisible();
    expect((await send(page, site, 'b')).forwardedProps, 'the last valid value stays in use').toEqual({ tenant: 'profile', extra: [1, 2] });
  });
});

test('profile forwarded properties override same-named preset properties; the rest are kept', async ({ page, site }) => {
  await open(page, site);
  await forwardedField(page).fill('{"tenant":"profile","extra":true}');
  const input = await send(page, site, 'hello');
  expect(input.forwardedProps).toMatchObject({ tenant: 'profile', extra: true, limit: 3, seed: { plan: 'free', tags: ['new'] } });
});

// ---------------------------------------------------------------------------------------------
// US4.5: reload keeps settings and drops the token
// ---------------------------------------------------------------------------------------------

test('after a reload the profile settings remain and the entered token is gone', async ({ page, site }) => {
  await open(page, site);
  await selectAgent(page, 'Support assistant', /^Plain agent/);
  await protocolField(page).fill('1.2');
  await toggle(page, 'Inject render_a2ui tool').click();
  await toggle(page, 'Render A2UI surfaces').click();
  await page.getByRole('button', { name: 'Full transcript' }).click();
  await forwardedField(page).fill('{"tenant":"qa"}');
  await page.getByRole('textbox', { name: 'Context description' }).fill('locale');
  await page.getByRole('textbox', { name: 'Context value' }).fill('fr-FR');
  await page.getByRole('button', { name: 'Add context' }).click();

  await page.getByLabel('Test token').fill(SYNTHETIC_TOKEN);
  const before = await send(page, site, 'with token');
  expect(runs(site)[0]?.authorization, 'the token travelled as a header').toBe('present');

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(stored).not.toContain(SYNTHETIC_TOKEN);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('agui-inspector.profile') ?? 'null'))).toMatchObject({
    version: 0,
    profile: { protocolVersion: '1.2', injectA2uiTool: true, renderA2ui: false, messageMode: 'full', forwardedProps: { tenant: 'qa' } },
  });

  site.reset();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Support assistant', exact: true })).toBeVisible();
  await selectAgent(page, 'Support assistant', /^Plain agent/);
  await expect(protocolField(page)).toHaveValue('1.2');
  await expect(toggle(page, 'Inject render_a2ui tool')).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page, 'Render A2UI surfaces')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('button', { name: 'Full transcript' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Test token')).toHaveValue('');

  const after = await send(page, site, 'with token');
  expect(runs(site)[0]?.authorization, 'no token after a reload').toBe('absent');
  expect(withoutRunId(after)).toEqual(withoutRunId(before));
  expect(JSON.stringify(site.requests())).not.toContain(SYNTHETIC_TOKEN);
});

test('a corrupt saved profile is reported and does not replace the defaults silently', async ({ page, site }) => {
  await page.addInitScript(() => localStorage.setItem('agui-inspector.profile', '{"version":9,"profile":{}}'));
  await open(page, site);
  await expect(page.getByRole('alert')).toContainText('The saved profile was not loaded');
  await expect(page.getByRole('alert')).toContainText('version');
  await expect(protocolField(page)).toHaveValue('1.0');
});

// ---------------------------------------------------------------------------------------------
// US4.6: export and import
// ---------------------------------------------------------------------------------------------

async function exportProfile(page: Page): Promise<string> {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export profile' }).click();
  const file = await (await download).path();
  return readFileSync(file, 'utf8');
}

const importText = (page: Page, text: string) =>
  page.locator('input[type="file"]').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(text) });

test('an exported profile imports back and governs the next run; it holds no credentials', async ({ page, site }) => {
  await open(page, site);
  await selectAgent(page, 'Support assistant', /^Plain agent/);
  await page.getByLabel('Test token').fill(SYNTHETIC_TOKEN);
  await protocolField(page).fill('1.3');
  await toggle(page, 'Inject render_a2ui tool').click();
  await page.getByRole('button', { name: 'Current turn' }).click();
  await forwardedField(page).fill('{"tenant":"exported","n":[1,{"a":null}]}');
  await page.getByRole('textbox', { name: 'Tool name' }).fill('get_weather');
  await page.getByRole('textbox', { name: 'Tool description' }).fill('Weather');
  await page.getByRole('button', { name: 'Add tool' }).click();
  await page.getByRole('textbox', { name: 'Context description' }).fill('locale');
  await page.getByRole('textbox', { name: 'Context value' }).fill('en-US');
  await page.getByRole('button', { name: 'Add context' }).click();
  const before = await send(page, site, 'same message');

  const exported = await exportProfile(page);
  const file = JSON.parse(exported) as { version: number; profile: Record<string, unknown> };
  expect(file.version).toBe(0);
  expect(Object.keys(file)).toEqual(['version', 'profile']);
  expect(Object.keys(file.profile).sort()).toEqual(['context', 'forwardedProps', 'injectA2uiTool', 'messageMode', 'protocolVersion', 'renderA2ui', 'tools']);
  expect(exported).not.toContain(SYNTHETIC_TOKEN);
  expect(exported).not.toMatch(/authorization|header|token/i);

  // Change everything, then restore from the file.
  await protocolField(page).fill('9.9');
  await toggle(page, 'Inject render_a2ui tool').click();
  await page.getByRole('button', { name: 'Remove tool get_weather' }).click();
  await page.getByRole('button', { name: 'Remove context locale' }).click();
  await page.getByRole('button', { name: 'Preset default' }).click();
  await forwardedField(page).fill('{}');
  expect((await send(page, site, 'changed')).protocolVersion).toBe('9.9');

  await importText(page, exported);
  await expect(protocolField(page)).toHaveValue('1.3');
  const restored = await send(page, site, 'same message');
  expect(restored.messages.map((message) => message.content), 'the imported message mode governs this run').toEqual(['same message']);
  expect(withoutRunId(restored)).toEqual(withoutRunId(before));
  expect(await exportProfile(page)).toBe(exported);
  expect(JSON.stringify(site.requests())).not.toContain(SYNTHETIC_TOKEN);
});

test('an invalid profile file is a visible error and leaves the current profile alone', async ({ page, site }) => {
  await open(page, site);
  await protocolField(page).fill('1.4');
  const good = JSON.stringify({ version: 0, profile: { protocolVersion: '2.0', tools: [], context: [], renderA2ui: true, injectA2uiTool: false, forwardedProps: {} } });
  const cases: Array<[label: string, text: string, message: RegExp]> = [
    ['not JSON', '{ not json', /not valid JSON/],
    ['unsupported version', JSON.stringify({ version: 1, profile: {} }), /Unsupported profile version 1/],
    ['missing version', JSON.stringify({ profile: {} }), /Unsupported profile version/],
    ['an auth field', good.replace('"tools"', '"token":"x","tools"'), /credential/],
    ['an unknown field', good.replace('"tools"', '"surprise":1,"tools"'), /unknown field "surprise"/],
    ['duplicate tool names', JSON.stringify({ version: 0, profile: { ...JSON.parse(good).profile, tools: [{ name: 'a', description: '' }, { name: 'a', description: '' }] } }), /duplicate tool name "a"/],
    ['a wrong type', good.replace('"renderA2ui":true', '"renderA2ui":"yes"'), /renderA2ui/],
  ];
  for (const [label, text, message] of cases) {
    await importText(page, text);
    await expect(page.getByRole('alert').filter({ hasText: message }), label).toBeVisible();
    await expect(protocolField(page), `${label}: the previous profile is intact`).toHaveValue('1.4');
  }
  expect(await exportProfile(page)).toContain('"protocolVersion": "1.4"');
  await importText(page, good);
  await expect(protocolField(page)).toHaveValue('2.0');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(runs(site)).toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Network allowlist, keyboard
// ---------------------------------------------------------------------------------------------

test('the page is restricted to its own origin by policy, and the session only used it', async ({ page, site, requested }) => {
  await open(page, site);
  await send(page, site, 'hello');
  const blocked = await page.evaluate(() => fetch('http://127.0.0.1:9/elsewhere').then(() => 'allowed', () => 'blocked'));
  expect(blocked).toBe('blocked');
  expect(requested.some((url) => url.includes(':9/'))).toBe(false);
  expect(requested.length).toBeGreaterThan(3);
});

test('settings are operable from the keyboard', async ({ page, site }) => {
  await open(page, site);
  const trigger = page.getByRole('button', { name: 'Support assistant', exact: true });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Plain agent/ })).toBeVisible();
  await page.getByRole('button', { name: /^Plain agent/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Plain agent', exact: true })).toBeVisible();

  await toggle(page, 'Inject render_a2ui tool').focus();
  await page.keyboard.press('Space');
  await expect(toggle(page, 'Inject render_a2ui tool')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Current turn' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Current turn' })).toHaveAttribute('aria-pressed', 'true');
  const input = await send(page, site, 'keyboard');
  expect(input.tools.map((tool) => tool.name)).toEqual(['render_a2ui']);
});
