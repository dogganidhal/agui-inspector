// specs/017: Clear session empties the capture without a reload. The assembled application against the reference
// agent's interactive server (examples/reference-agent), so the token, the thread and a stream that stays open are real.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { createInteractiveServer, type InteractiveServer } from '../../../examples/reference-agent/interactive-scenarios.ts';
import { SYNTHETIC_TOKEN, expect, expectAllowlisted, open, send, test, type Site, type SiteOptions } from './support';

const REPLY = 'Hello from the reference agent.';
const header = (page: Page) => page.locator('.agui-ins-head');
const clear = (page: Page) => header(page).getByRole('button', { name: 'Clear session' });
const footer = (page: Page) => page.getByRole('contentinfo');
const stop = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });

/** The reference agent on its own origin, granting CORS to the page once the page's origin is known. */
async function withAgent(openSite: (options?: SiteOptions) => Promise<Site>, body: (site: Site, agent: InteractiveServer) => Promise<void>): Promise<void> {
  let agent: InteractiveServer | undefined;
  const site = await openSite({
    hosting: () => ({ version: 0, mode: 'hosted', allowedOrigins: [agent?.origin] }),
    config: () => ({ version: 0, agents: [{ id: 'reference', name: 'Reference agent', url: `${agent?.origin}/agent` }] }),
  });
  agent = await createInteractiveServer({ allowOrigin: site.page.origin });
  try {
    await body(site, agent);
  } finally {
    await agent.close();
  }
}

async function setToken(page: Page) {
  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Token' }).fill(SYNTHETIC_TOKEN);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Authentication: .* set$/ })).toBeVisible();
}

async function exportSession(page: Page): Promise<string> {
  await header(page).getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog', { name: 'Export this session' }).getByRole('button', { name: 'Export session' }).click()]);
  return readFileSync((await download.path())!, 'utf8');
}

const runs = (agent: InteractiveServer) => agent.requests().filter((request) => request.kind === 'run');

test('Clear session empties the capture, starts a new thread and keeps the target and the token', async ({ page, openSite, requested }) => {
  await withAgent(openSite, async (site, agent) => {
    await open(page, site);
    await expect(clear(page)).toBeDisabled();
    await expect(clear(page)).toHaveAccessibleDescription('Nothing to clear');

    await setToken(page);
    await send(page, 'hello');
    await expect(page.getByText(REPLY).first()).toBeVisible();
    await send(page, 'state');
    await expect(footer(page)).toContainText('2 exchanges');
    await expect(clear(page)).toBeEnabled();

    // Not exported: the developer is asked, and Cancel keeps everything.
    await clear(page).click();
    const dialog = page.getByRole('dialog', { name: 'Clear this session' });
    await expect(dialog).toContainText('2 exchanges and');
    await expect(dialog).toContainText('cannot be undone');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(footer(page)).toContainText('2 exchanges');

    // Confirmed: every view is empty, as on a fresh page.
    await clear(page).click();
    await dialog.getByRole('button', { name: 'Clear session' }).click();
    await expect(footer(page)).toContainText('0 exchanges · 0 frames');
    await expect(page.getByText(REPLY)).toHaveCount(0);
    await expect(page.locator('[data-exchange-header]')).toHaveCount(0);
    await expect(page.getByText('No conversation yet.')).toBeVisible();
    await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'State' }).click();
    await expect(page.getByText('No state events in this thread.')).toBeVisible();
    await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Inspection' }).click();
    await expect(clear(page)).toBeDisabled();

    // The next message goes to the same agent with the same token, on a new thread that carries nothing cleared.
    const [first] = runs(agent);
    await send(page, 'hello again');
    await expect(footer(page)).toContainText('1 exchange');
    await expect(page.getByText(REPLY).first()).toBeVisible();
    const next = runs(agent).at(-1)!;
    expect(next.credentials).toEqual(['authorization']);
    const body = next.body as { threadId: string; messages: Array<{ role: string; content?: string }> };
    expect(body.threadId).not.toBe((first!.body as { threadId: string }).threadId);
    expect(body.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual(['hello again']);

    // Exported and unchanged since: one press clears, with no question.
    const file = await exportSession(page);
    expect(file).not.toContain(SYNTHETIC_TOKEN);
    await clear(page).click();
    await expect(page.getByRole('dialog', { name: 'Clear this session' })).toBeHidden();
    await expect(footer(page)).toContainText('0 exchanges · 0 frames');

    expectAllowlisted(requested, [site.page.origin, agent.origin]);
  });
});

test('Clear session is unavailable while a response is still recorded, and available once it is stopped', async ({ page, openSite }) => {
  await withAgent(openSite, async (site, agent) => {
    await open(page, site);
    await send(page, 'never finishes');
    await expect(page.getByText('This response stays open until you press Stop.').first()).toBeVisible();
    await expect(clear(page)).toBeDisabled();
    await expect(clear(page)).toHaveAccessibleDescription('Stop the run first: a response is still being recorded');
    expect(agent.openStreams()).toBe(1);

    await stop(page).click();
    await expect.poll(() => agent.openStreams()).toBe(0);
    await expect(clear(page)).toBeEnabled();
    const frames = (await footer(page).textContent())?.match(/(\d+) frames?/)?.[1];
    await clear(page).click();
    await expect(page.getByRole('dialog', { name: 'Clear this session' })).toContainText(`1 exchange and ${frames} frame`);
    await page.getByRole('dialog', { name: 'Clear this session' }).getByRole('button', { name: 'Clear session' }).click();
    await expect(footer(page)).toContainText('0 exchanges · 0 frames');
  });
});

test('with an imported recording open, Clear session closes it and the page sends again', async ({ page, openSite }) => {
  await withAgent(openSite, async (site, agent) => {
    await open(page, site);
    await send(page, 'hello');
    await expect(page.getByText(REPLY).first()).toBeVisible();
    const file = await exportSession(page);

    await page.getByLabel('Session file to import').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await expect(page.getByText('Imported recording: inspection only. Clear session to send requests again.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();

    // The live capture was exported unchanged, so nothing is asked.
    await clear(page).click();
    await expect(page.getByText('Imported recording: inspection only')).toHaveCount(0);
    await expect(footer(page)).toContainText('0 exchanges · 0 frames');

    await send(page, 'hello');
    await expect(page.getByText(REPLY).first()).toBeVisible();
    expect(runs(agent)).toHaveLength(2);
  });
});
