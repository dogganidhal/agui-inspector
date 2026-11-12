// Spec 016: the setup survives a reload, and a launch link fills in the page so the developer only presses send.
// A link is input from outside the page: it never sends by itself, never reaches past the page's policy, and a
// credential in it reaches nothing the page writes.
import type { Page } from '@playwright/test';
import { AGENT_REPLY, expect, expectAllowlisted, open, SYNTHETIC_TOKEN, test, type Site } from './support';

type Origins = { agent: { origin: string } };

const agents = (origins: Origins) => ({
  version: 0,
  agents: [
    { id: 'plain', name: 'Plain agent', url: `${origins.agent.origin}/plain` },
    {
      id: 'support',
      name: 'Support assistant',
      url: `${origins.agent.origin}/support`,
      preset: { variables: { userId: { default: 'dev' } }, forwardedProps: { user_id: '{{userId}}' } },
    },
  ],
});

const SECRET = 'SYNTHETIC-016-credential';
const barPicker = (page: Page, name: string) => page.getByRole('banner').getByRole('button', { name: `Agent ${name}`, exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' });
const warnings = (page: Page) => page.getByRole('status', { name: 'Configuration warnings' });
const settingsTab = (page: Page) => page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
const posts = (site: Site) => [...site.agent.seen, ...site.page.seen].filter((request) => request.method === 'POST');
const linkTo = (site: Site, params: Record<string, string>) => `${site.page.origin}/#${new URLSearchParams(params)}`;

async function openAt(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
}

test('the selected agent and its variables survive a reload, and the token does not', async ({ page, openSite }) => {
  const site = await openSite({ config: agents });
  await open(page, site);
  await barPicker(page, 'Plain agent').click();
  await page.getByRole('banner').getByRole('button', { name: /^Support assistant/ }).click();
  await settingsTab(page);
  await page.getByRole('textbox', { name: 'Variable userId' }).fill('42');
  await page.getByRole('button', { name: /^Authentication/ }).click();
  await page.getByRole('textbox', { name: 'Token' }).fill(SYNTHETIC_TOKEN);
  await page.keyboard.press('Escape');

  await page.reload();
  await expect(barPicker(page, 'Support assistant')).toBeVisible();
  await settingsTab(page);
  await expect(page.getByRole('textbox', { name: 'Variable userId' })).toHaveValue('42');
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('agui-inspector.setup') ?? '{}'))).toEqual({ version: 0, setup: { agent: 'support', variables: { userId: '42' } } });
  expect(stored).not.toContain(SYNTHETIC_TOKEN);
  expect(stored).not.toContain('Authorization');
});

test('a launch link fills everything in, sends nothing, and the next send carries its values', async ({ page, openSite, requested }) => {
  const site = await openSite({ config: agents });
  await openAt(
    page,
    linkTo(site, {
      agent: 'support',
      'var.userId': '42',
      context: JSON.stringify([{ description: 'locale', value: 'fr-FR' }]),
      forwardedProps: JSON.stringify({ tenant: 'acme' }),
      message: 'Book a table for two',
    }),
  );

  await expect(barPicker(page, 'Support assistant')).toBeVisible();
  await expect(composer(page)).toHaveValue('Book a table for two');
  await expect(warnings(page)).toContainText('This page was set up from a link: agent, var.userId, context, forwardedProps, message. Check these values before you send.');
  expect(new URL(page.url()).hash).toBe('');
  expect(posts(site)).toEqual([]);

  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  const runs = posts(site);
  expect(runs.map((request) => request.path)).toEqual(['/support']);
  const input = JSON.parse(runs[0]?.body ?? '{}');
  expect(input.messages.at(-1).content).toBe('Book a table for two');
  expect(input.context).toEqual([{ description: 'locale', value: 'fr-FR' }]);
  expect(input.forwardedProps).toEqual({ user_id: '42', tenant: 'acme' });
  expectAllowlisted(requested, [site.page.origin, site.agent.origin]);

  // A reload shows what the link saved, with an empty composer and no notice.
  await page.reload();
  await expect(barPicker(page, 'Support assistant')).toBeVisible();
  await expect(composer(page)).toHaveValue('');
  await expect(warnings(page)).toHaveCount(0);
  await settingsTab(page);
  await expect(page.getByRole('textbox', { name: 'Variable userId' })).toHaveValue('42');
});

test('a bad link keeps what is valid, warns once per bad key, and a credential in it reaches nothing', async ({ page, openSite }) => {
  const site = await openSite({ config: agents });
  await openAt(page, `${site.page.origin}/#agent=nobody&context=%5B&token=${SECRET}&header.x-api-key=${SECRET}&message=hi`);

  await expect(barPicker(page, 'Plain agent')).toBeVisible();
  await expect(composer(page)).toHaveValue('hi');
  const shown = warnings(page);
  await expect(shown).toContainText('agent: no configured agent has this id; it was ignored');
  await expect(shown).toContainText('context is not valid JSON; it was ignored');
  await expect(shown).toContainText('token: credentials never go in a link');
  await expect(shown).toContainText('header.x-api-key: credentials never go in a link');
  expect(await page.content()).not.toContain(SECRET);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain(SECRET);
  expect(page.url()).not.toContain(SECRET);
  expect(posts(site)).toEqual([]);
});

test('embedded: a link endpoint on another origin is refused like a typed one and nothing reaches it', async ({ page, openSite, requested }) => {
  const site = await openSite({ hosting: () => null, config: () => ({ version: 0, agents: [{ id: 'local', name: 'Local', url: '/agent' }] }) });
  await openAt(page, linkTo(site, { endpoint: `${site.foreign.origin}/agent`, message: 'hi' }));
  await expect(warnings(page)).toContainText('is not an allowed destination');
  await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue('/agent');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.foreign.seen).toEqual([]);
  expectAllowlisted(requested, [site.page.origin]);
});

test('a second link pasted into the same tab applies as a fresh open', async ({ page, openSite }) => {
  const site = await openSite({ config: agents });
  await openAt(page, linkTo(site, { message: 'first' }));
  await expect(composer(page)).toHaveValue('first');
  await page.evaluate(() => {
    location.hash = new URLSearchParams({ agent: 'support', message: 'second' }).toString();
  });
  await expect(composer(page)).toHaveValue('second');
  await expect(barPicker(page, 'Support assistant')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});
