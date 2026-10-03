// L07 T051 (US1, US2, FR-003 to FR-006, FR-037, FR-038, SC-008): the assembled application, built the way
// it ships, in a real browser. The agents are scripted and model-free; the runtime, transport, stores
// and views are the real ones. What this proves is the assembly: the startup policy is enforced by the
// browser before any application request, a hosted run is a direct browser request with no cookies,
// nothing the page loads can widen the allowlist, failures are shown, and the shell is usable by
// keyboard. It is scoped acceptance: each lane's own suite covers its features, and the whole
// quickstart runs again on integrated main (docs/hosted.md).
import { readFileSync } from 'node:fs';
import { AGENT_REPLY, SYNTHETIC_TOKEN, expect, expectAllowlisted, open, send, test } from './support';

const NO_AGENTS = () => null;
const agentConfig = (url: (origins: { agent: { origin: string }; foreign: { origin: string } }) => string, extra: object = {}) => (origins: Parameters<typeof url>[0]) => ({
  version: 0,
  agents: [{ id: 'support', name: 'Support assistant', url: url(origins), ...extra }],
});

// ---------------------------------------------------------------------------------------------
// Startup: the policy comes first and the browser enforces it
// ---------------------------------------------------------------------------------------------

test('hosted: the policy, then the configuration, then one direct run, and no request outside the allowlist', async ({ page, openSite, requested, violations }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`, { capabilities: undefined }) });
  await open(page, site);
  await expect.poll(() => page.evaluate(() => document.cookie), 'the page holds a cookie for its host').toContain('session=page-cookie');

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();

  // One direct browser request to the allowed agent, carrying no cookie.
  expect(site.agent.seen.map((request) => `${request.method} ${request.path}`)).toEqual(['POST /agent']);
  expect(site.agent.seen[0]?.cookie).toBeUndefined();
  expect(JSON.parse(site.agent.seen[0]?.body ?? '{}')).toMatchObject({ messages: [{ role: 'user', content: 'hello' }] });

  // Order: the deployment file, then the configuration, then the agent.
  const at = (url: string) => requested.findIndex((candidate) => candidate === url);
  expect(at(`${site.page.origin}/hosting-config.json`)).toBeGreaterThan(-1);
  expect(at(`${site.page.origin}/hosting-config.json`)).toBeLessThan(at(`${site.page.origin}/config.json`));
  expect(at(`${site.page.origin}/config.json`)).toBeLessThan(at(`${site.agent.origin}/agent`));
  expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
  expect(site.foreign.seen).toEqual([]);

  await expect(page.getByRole('contentinfo')).toContainText(`1 exchange · 5 frames · requests only to this origin and ${site.agent.origin} · no telemetry · headers never recorded`);
  expect(await violations()).toEqual([]);
});

test('the browser enforces the policy: scripts from the page only, no eval, connections to the allowlist only', async ({ page, openSite, violations }) => {
  const site = await openSite({});
  await open(page, site);

  const metas = await page.locator('meta[http-equiv="Content-Security-Policy"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content') ?? ''));
  expect(metas).toHaveLength(2);
  expect(metas[0]).toBe("script-src 'self'; object-src 'none'; base-uri 'none'");
  expect(metas[1]).toContain(`connect-src 'self' ${site.agent.origin};`);
  expect(metas[1]).not.toMatch(/unsafe-eval|unsafe-inline|\*/);

  const outcome = await page.evaluate(
    async ({ agent, foreign }) => {
      const result: Record<string, string> = {};
      const reach = async (url: string) => {
        try {
          await fetch(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
          return 'reached';
        } catch {
          return 'blocked';
        }
      };
      result.agent = await reach(`${agent}/agent`);
      // This origin even grants CORS to the page: only the page's own policy stops the request.
      result.foreign = await reach(`${foreign}/agent`);
      try {
        new Function('return 1')();
        result.eval = 'ran';
      } catch (error) {
        result.eval = (error as Error).name;
      }
      const script = document.createElement('script');
      script.textContent = 'window.__inline = true';
      document.head.append(script);
      result.inline = String((window as unknown as { __inline?: boolean }).__inline === true);
      return result;
    },
    { agent: site.agent.origin, foreign: site.foreign.origin },
  );
  expect(outcome).toEqual({ agent: 'reached', foreign: 'blocked', eval: 'EvalError', inline: 'false' });
  expect(site.foreign.seen, 'the request never left the browser').toEqual([]);
  expect((await violations()).map((violation) => violation.directive)).toEqual(expect.arrayContaining(['connect-src', 'script-src-elem']));
  expect(outcome.eval).toBe('EvalError');
});

test('the policy is in place while the configuration request is still pending', async ({ page, openSite }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = false;
  await page.route('**/config.json', async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  const navigation = page.goto(site.page.origin);
  await expect.poll(() => held).toBe(true);

  expect(await page.locator('meta[http-equiv="Content-Security-Policy"]').count(), 'the startup policy is already added').toBe(2);
  const early = await page.evaluate((foreign) => fetch(`${foreign}/agent`, { method: 'POST', body: '{}' }).then(() => 'reached', () => 'blocked'), site.foreign.origin);
  expect(early).toBe('blocked');
  expect(site.agent.seen, 'nothing has been sent to the agent yet').toEqual([]);

  release();
  await navigation;
  await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${site.agent.origin}/agent`);
});

test('a page whose deployment file is unusable does not start and says why', async ({ page, openSite, requested }) => {
  const site = await openSite({ hosting: () => '{"mode":"hosted","allowedOrigins":["*"]}', config: agentConfig((o) => `${o.agent.origin}/agent`) });
  await page.goto(site.page.origin);
  await expect(page.getByRole('alert')).toContainText('hosting-config.json: allowedOrigins[0] "*" must name one origin; wildcards are not allowed');
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
  expect(requested.some((url) => url.endsWith('/config.json')), 'nothing else is requested').toBe(false);
});

// ---------------------------------------------------------------------------------------------
// Nothing loaded later widens the allowlist
// ---------------------------------------------------------------------------------------------

test('hosted: a configured agent, capabilities URL, configuration URL or typed endpoint outside the allowlist is refused and never requested', async ({ page, openSite, requested }) => {
  const site = await openSite({
    config: agentConfig((o) => `${o.foreign.origin}/agent`, { capabilities: undefined }),
  });
  await open(page, site);

  // The configured agent points at an origin the deployment did not allow.
  await expect(page.getByRole('alert').filter({ hasText: 'is not an allowed destination' })).toContainText(`${site.foreign.origin} is not an allowed destination`);
  await send(page, 'hello');
  await expect(page.getByRole('alert').filter({ hasText: 'is not an allowed destination' })).toBeVisible();

  // A typed endpoint cannot add one, and a URL with credentials is refused without repeating them.
  const endpoint = page.getByRole('textbox', { name: 'Endpoint URL' });
  const use = page.getByRole('button', { name: 'Use endpoint' });
  for (const [typed, message] of [
    [`${site.closed.origin}/agent`, 'is not an allowed destination'],
    [`http://user:hunter2@${new URL(site.agent.origin).host}/agent`, 'user:password@'],
    ['/agent', 'must be absolute'],
  ] as const) {
    await endpoint.fill(typed);
    await use.click();
    const alert = page.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    expect(await alert.textContent()).not.toContain('hunter2');
    await send(page, 'hello');
  }

  expect([...site.foreign.seen, ...site.closed.seen, ...site.agent.seen]).toEqual([]);
  expect(requested.filter((url) => url.startsWith(site.foreign.origin) || url.startsWith(site.closed.origin) || url.includes('hunter2'))).toEqual([]);
});

test('hosted: a capabilities URL is read through the allowlist, an allowed one and a refused one', async ({ page, openSite }) => {
  const site = await openSite({
    config: (o) => ({
      version: 0,
      agents: [
        { id: 'allowed', name: 'Allowed', url: `${o.agent.origin}/agent`, capabilities: `${o.agent.origin}/capabilities` },
        { id: 'refused', name: 'Refused', url: `${o.agent.origin}/agent`, capabilities: `${o.foreign.origin}/capabilities` },
      ],
    }),
  });
  await open(page, site);
  const settings = page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' });
  await settings.click();
  await expect(page.getByText('Scripted agent').first()).toBeVisible();
  expect(site.agent.seen.map((request) => request.path)).toContain('/capabilities');
  expect(site.agent.seen.find((request) => request.path === '/capabilities')?.cookie, 'no cookie to a capabilities URL either').toBeUndefined();

  const picker = page.locator('[data-view="settings"]');
  await picker.getByRole('button', { name: /Allowed/ }).click();
  await picker.getByRole('button', { name: /Refused/ }).click();
  await expect(page.getByText(/is not an allowed destination/).first()).toBeVisible();
  expect(site.foreign.seen).toEqual([]);
});

test('hosted: a configuration URL outside the allowlist is refused, and an allowed one is read without cookies', async ({ page, openSite, requested }) => {
  const refused = await openSite({ hosting: (o) => ({ version: 0, mode: 'hosted', allowedOrigins: [o.agent.origin], config: `${o.foreign.origin}/config.json` }) });
  await open(page, refused);
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'is not an allowed destination' })).toBeVisible();
  expect(refused.foreign.seen).toEqual([]);
  expect(requested.filter((url) => url.startsWith(refused.foreign.origin))).toEqual([]);

  const allowed = await openSite({ hosting: (o) => ({ version: 0, mode: 'hosted', allowedOrigins: [o.foreign.origin], config: `${o.foreign.origin}/config.json` }) });
  await open(page, allowed);
  await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${allowed.foreign.origin}/agent`);
  expect(allowed.foreign.seen.map((request) => request.path)).toEqual(['/config.json']);
  expect(allowed.foreign.seen[0]?.cookie, 'a hosted configuration request carries no cookie').toBeUndefined();
});

test('hosted: a redirect from an allowed target is shown and not followed', async ({ page, openSite }) => {
  const site = await openSite({});
  await open(page, site);
  await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(`${site.agent.origin}/redirect`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await send(page, 'hello');
  await expect(page.getByRole('alert').filter({ hasText: 'redirect' })).toContainText('does not follow redirects');
  expect(site.agent.seen.map((request) => request.path)).toEqual(['/redirect']);
  expect(site.foreign.seen, 'the redirect target never saw a request').toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Failures are visible
// ---------------------------------------------------------------------------------------------

test('a request the browser blocks is shown with its likely causes and kept as a failed exchange', async ({ page, openSite }) => {
  const site = await openSite({ hosting: (o) => ({ version: 0, mode: 'hosted', allowedOrigins: [o.agent.origin, o.closed.origin] }) });
  await open(page, site);
  const endpoint = page.getByRole('textbox', { name: 'Endpoint URL' });

  // A real CORS block: the target answers but does not name this page's origin.
  await endpoint.fill(`${site.closed.origin}/agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await send(page, 'hello');
  const alert = page.getByRole('alert').filter({ hasText: 'The browser could not complete the request' });
  await expect(alert).toContainText(`to ${site.closed.origin}`);
  await expect(alert).toContainText('CORS');
  await expect(alert).toContainText('private-network or mixed-content');
  await expect(alert).toContainText('does not proxy or bypass');
  await expect(page.getByRole('button', { name: /POST \/agent .* failed .* 1 issue/ })).toBeVisible();
  await expect(page.getByText(/transport · Error: The browser could not complete the request/)).toBeVisible();

  // Private-network and secure-context blocks reach the page the same way (one failed fetch), and loopback
  // cannot trigger them, so they are stood in for by aborting the request at the browser.
  await page.route(`${site.agent.origin}/**`, (route) => route.abort('blockedbyclient'));
  await endpoint.fill(`${site.agent.origin}/agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await send(page, 'hello again');
  await expect(page.getByRole('alert').filter({ hasText: `to ${site.agent.origin}` })).toContainText('private-network or mixed-content');
  expect(site.agent.seen).toEqual([]);
  await expect(page.getByRole('contentinfo')).toContainText('2 exchanges');
});

// ---------------------------------------------------------------------------------------------
// Embedded
// ---------------------------------------------------------------------------------------------

test('embedded: no deployment file means the page origin only, with the host credentials', async ({ page, openSite, requested }) => {
  const site = await openSite({ hosting: NO_AGENTS, config: () => ({ version: 0, agents: [{ id: 'local', name: 'Local', url: '/agent' }] }) });
  await open(page, site);
  await expect(page.getByText('embedded', { exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('requests only to this origin · no telemetry · headers never recorded');

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  const run = site.page.seen.find((request) => request.method === 'POST');
  expect(run?.path).toBe('/agent');
  expect(run?.cookie, 'the host session reaches its own agent').toContain('session=page-cookie');

  await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(`${site.agent.origin}/agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'is not an allowed destination' })).toBeVisible();
  const reachable = await page.evaluate((agent) => fetch(`${agent}/agent`, { method: 'POST', body: '{}' }).then(() => 'reached', () => 'blocked'), site.agent.origin);
  expect(reachable, 'the browser policy is own-origin only too').toBe('blocked');
  expect(site.agent.seen).toEqual([]);
  expectAllowlisted(requested, [site.page.origin]);
});

// ---------------------------------------------------------------------------------------------
// The tokens and what the page keeps
// ---------------------------------------------------------------------------------------------

test('the token goes to the target as the chosen header and is kept nowhere: not storage, exports, the page text or a reload', async ({ page, openSite }, info) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`) });
  await open(page, site);

  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Header name' }).fill('X-Api-Key');
  await page.getByRole('textbox', { name: 'Token' }).fill(SYNTHETIC_TOKEN);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Authentication: X-Api-Key set' })).toBeVisible();

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen[0]?.token).toBe(SYNTHETIC_TOKEN);

  // Exports: the warning first, then a file with no header and no token.
  await page.getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('sensitive');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export session' }).click()]);
  const sessionFile = readFileSync(await download.path(), 'utf8');
  expect(sessionFile).toContain(AGENT_REPLY);
  expect(sessionFile).not.toContain(SYNTHETIC_TOKEN);
  expect(sessionFile.toLowerCase()).not.toMatch(/x-api-key|authorization|"headers"/);

  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  const [profileDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export profile/ }).click()]);
  expect(readFileSync(await profileDownload.path(), 'utf8')).not.toContain(SYNTHETIC_TOKEN);

  // Nothing in browser storage or the visible page.
  const kept = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, text: document.body.innerText, cookie: document.cookie }));
  expect(kept).not.toContain(SYNTHETIC_TOKEN);

  // Changing the target clears it and says so; a reload clears it too.
  await page.getByRole('textbox', { name: 'Endpoint URL' }).fill(`${site.agent.origin}/agent?other=1`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await expect(page.getByText('Token cleared')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();

  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Token' }).fill(SYNTHETIC_TOKEN);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();
  await send(page, 'after reload');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen.at(-1)?.token).toBeUndefined();
  info.annotations.push({ type: 'g-07', description: 'Server-echoed credentials are not exercised here: the agent never echoes a header. tests/e2e/inspection/credential-echo.spec.ts covers them.' });
});

test('an imported recording is inspection only: it sends nothing and nothing can be sent until a reload', async ({ page, openSite, requested }, info) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`) });
  await open(page, site);
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  const file = info.outputPath('session.json');
  await download.saveAs(file);

  const importer = page.locator('input[type="file"]').first();
  // A corrupt file is refused in view and the session on screen stays.
  await importer.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"version":0,"session":{') });
  await expect(page.getByText(/Import failed/)).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('1 exchange');

  const before = { agent: site.agent.seen.length, requests: requested.length };
  await importer.setInputFiles(file);
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('imported recording, inspection only');
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'An imported recording is open' })).toBeVisible();
  expect(site.agent.seen.length, 'importing sends nothing').toBe(before.agent);
  expect(requested.length, 'importing requests nothing').toBe(before.requests);
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
});

// ---------------------------------------------------------------------------------------------
// Wiring across lanes
// ---------------------------------------------------------------------------------------------

test('a rendered A2UI surface runs under the policy and its action starts a new run with the envelope', async ({ page, openSite, requested, violations }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/surface`) });
  await open(page, site);
  await send(page, 'show the form');
  await expect(page.getByText('Order check')).toBeVisible();
  await page.getByRole('button', { name: 'Send note' }).click();
  await expect.poll(() => site.agent.seen.length).toBe(2);

  const action = JSON.parse(site.agent.seen[1]?.body ?? '{}') as { forwardedProps?: { a2uiAction?: { userAction?: Record<string, unknown> } }; messages?: unknown[] };
  expect(action.forwardedProps?.a2uiAction?.userAction).toMatchObject({ name: 'send_note', surfaceId: 'form', sourceComponentId: 'send', context: { note: 'first draft' } });
  expect(site.agent.seen.every((request) => request.cookie === undefined)).toBe(true);
  expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
  expect(await violations()).toEqual([]);
});

test('the settings view saves the profile in this browser, and a saved profile is there after a reload', async ({ page, openSite }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`) });
  await open(page, site);
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  const render = page.getByRole('switch', { name: /Render A2UI/i });
  await expect(render).toBeChecked();
  await render.click();
  await page.reload();
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('switch', { name: /Render A2UI/i })).not.toBeChecked();
});

// ---------------------------------------------------------------------------------------------
// Layout, keyboard and labels
// ---------------------------------------------------------------------------------------------

test('wide: two panes side by side, the page itself never scrolls, the footer closes the inspection pane', async ({ page, openSite }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`) });
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, site);
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();

  const boxes = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    return {
      conversation: rect('.agui-app-conversation'),
      inspection: rect('.agui-app-inspection'),
      footer: rect('.agui-app-footer'),
      switchShown: getComputedStyle(document.querySelector('.agui-app-switch') as Element).display !== 'none',
      scrolls: document.documentElement.scrollHeight > window.innerHeight || document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  expect(boxes.switchShown).toBe(false);
  expect(boxes.scrolls).toBe(false);
  expect(boxes.conversation!.right).toBeLessThanOrEqual(boxes.inspection!.left + 1);
  expect(boxes.inspection!.width / boxes.conversation!.width).toBeGreaterThan(1.1);
  expect(boxes.footer!.bottom).toBeCloseTo(720, 0);
});

test('narrow: one pane at a time, switched with a labelled control', async ({ page, openSite }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`) });
  await page.setViewportSize({ width: 600, height: 800 });
  await open(page, site);
  const panes = page.getByRole('group', { name: 'Pane', exact: true });
  await expect(panes).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeHidden();

  await panes.getByRole('button', { name: 'Inspection' }).click();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeHidden();
  await expect(panes.getByRole('button', { name: 'Inspection' })).toHaveAttribute('aria-pressed', 'true');

  await panes.getByRole('button', { name: 'Conversation' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('keyboard: every control is reachable by Tab with an accessible name, and sending works without a pointer', async ({ page, openSite }) => {
  const site = await openSite({ config: agentConfig((o) => `${o.agent.origin}/agent`, { preset: { quickMessages: ['Where is my refund?'] } }) });
  await open(page, site);
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toHaveCount(1);

  const visited: string[] = [];
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return '';
      const labelled = element.getAttribute('aria-label') ?? (element.id ? document.querySelector(`label[for="${element.id}"]`)?.textContent : null);
      const outline = getComputedStyle(element);
      const visible = outline.outlineStyle !== 'none' || outline.boxShadow !== 'none' || element.matches('input, textarea, button');
      return visible ? (labelled ?? element.textContent ?? '').trim() || '(unnamed)' : '(no focus indicator)';
    });
    expect(name, `focus stop ${step}`).not.toMatch(/^\(/);
    visited.push(name);
    if (name === 'Hide' || visited.length > 1 && visited[0] === name) break;
  }
  for (const expected of ['Endpoint URL', 'Authentication: no token', 'Switch to dark theme', 'Message', 'Where is my refund?', 'New thread', 'State', 'Settings', 'Frames', 'Raw request']) {
    expect(visited.join('|'), `${expected} is reachable`).toContain(expected);
  }

  await page.getByRole('textbox', { name: 'Message' }).focus();
  await page.keyboard.type('by keyboard');
  await page.keyboard.press('Enter');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(JSON.parse(site.agent.seen[0]?.body ?? '{}').messages.at(-1).content).toBe('by keyboard');
});

test('the shell follows the theme tokens: an override stylesheet after the inspector\'s own restyles it, light and dark', async ({ page, openSite }) => {
  const site = await openSite({
    files: { '/override.css': { type: 'text/css', body: ':root { --agui-accent: rgb(0, 80, 200); --agui-accent-contrast: rgb(255, 255, 255); --agui-bg: rgb(250, 240, 230); --agui-radius: 2px; }' } },
  });
  await open(page, site);
  const paint = () =>
    page.evaluate(() => ({
      mark: getComputedStyle(document.querySelector('.agui-app-mark') as Element).backgroundColor,
      body: getComputedStyle(document.getElementById('root') as Element).backgroundColor,
    }));
  const before = await paint();
  await page.addStyleTag({ url: `${site.page.origin}/override.css` });
  expect(await paint()).toEqual({ mark: 'rgb(0, 80, 200)', body: 'rgb(250, 240, 230)' });
  expect(await paint()).not.toEqual(before);

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await paint()).mark, 'the accent override holds in dark').toBe('rgb(0, 80, 200)');
});
