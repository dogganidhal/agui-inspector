// Spec 013 (US1, US2, US3; SC-002, SC-007): the assembled application, built the way it ships, with the protobuf
// encoding chosen in Settings. The scripted agent answers in protobuf when the request's Accept asks for it, as a
// server written with EventEncoder does, and records the Accept it saw. What this proves is the assembly: the choice
// is two steps from the main page, it reaches the request, the frames list shows binary frames decoded, and a session
// exported from the page imports back with every frame's bytes unchanged.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { AGENT_REPLY, expect, expectAllowlisted, open, send, test } from './support';

const PROTOBUF = 'application/vnd.ag-ui.event+proto';
const config = (origins: { agent: { origin: string } }) => ({ version: 0, agents: [{ id: 'support', name: 'Support assistant', url: `${origins.agent.origin}/agent` }] });

const openSettings = (page: Page) => page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
const openInspection = (page: Page) => page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Inspection' }).click();

test('the encoding is two steps from the main page, reaches the request, and the frames show decoded with their bytes', async ({ page, openSite, requested }) => {
  const site = await openSite({ config });
  await open(page, site);

  // Two steps: open Settings, choose Protobuf.
  await openSettings(page);
  await expect(page.getByRole('group', { name: 'Encoding' }).getByRole('button', { name: 'Preset default' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Encoding' }).getByRole('button', { name: 'Protobuf' }).click();
  await expect(page.getByRole('group', { name: 'Encoding' }).getByRole('button', { name: 'Protobuf' })).toHaveAttribute('aria-pressed', 'true');

  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen.map((request) => request.accept)).toEqual([PROTOBUF]);
  expect(JSON.parse(site.agent.seen[0]?.body ?? '{}')).toMatchObject({ messages: [{ role: 'user', content: 'hello' }] });

  await openInspection(page);
  const header = page.locator('[data-exchange-header]').first();
  await expect(header).toContainText('protobuf');
  const row = page.getByRole('button', { name: /RUN_FINISHED/ });
  await expect(row).toBeVisible();
  await row.click();
  const detail = page.locator('[data-frame-detail]').last();
  await expect(detail.getByRole('region', { name: 'Frame bytes as hexadecimal text' })).toContainText(/^00 00 00/);
  await expect(detail.getByRole('region', { name: 'Decoded event' })).toContainText('"RUN_FINISHED"');
  await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 5 frames');

  // The choice is part of the saved profile.
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('agui-inspector.profile') ?? 'null'))).toMatchObject({ version: 0, profile: { encoding: 'protobuf' } });
  expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
});

test('Preset default and Server-sent events go back to asking for server-sent events, and the choice survives a reload', async ({ page, openSite }) => {
  const site = await openSite({ config });
  await open(page, site);
  await openSettings(page);
  const group = page.getByRole('group', { name: 'Encoding' });
  await group.getByRole('button', { name: 'Protobuf' }).click();
  await page.reload();
  await openSettings(page);
  await expect(group.getByRole('button', { name: 'Protobuf' })).toHaveAttribute('aria-pressed', 'true');

  await group.getByRole('button', { name: 'Preset default' }).click();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('agui-inspector.profile') ?? 'null')).profile.encoding).toBeUndefined();
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(site.agent.seen.map((request) => request.accept)).toEqual(['text/event-stream']);
});

test('a session exported from a protobuf run imports back with every frame\'s bytes unchanged (SC-002)', async ({ page, openSite }) => {
  const site = await openSite({ config });
  await open(page, site);
  await openSettings(page);
  await page.getByRole('group', { name: 'Encoding' }).getByRole('button', { name: 'Protobuf' }).click();
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  await openInspection(page);

  await page.getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('sensitive');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export session' }).click()]);
  const text = readFileSync(await download.path(), 'utf8');
  const exported = JSON.parse(text) as { version: number; session: { exchanges: Array<{ encoding?: string }>; frames: Array<{ bytes?: string; parsed?: { type?: string } }> } };
  expect(exported.version).toBe(0);
  expect(exported.session.exchanges.map((exchange) => exchange.encoding)).toEqual(['protobuf']);
  expect(exported.session.frames.map((frame) => frame.parsed?.type)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  const bytes = exported.session.frames.map((frame) => frame.bytes);
  expect(bytes.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
  expect(text.toLowerCase()).not.toMatch(/"headers"|authorization|x-api-key/);

  await page.reload();
  await page.getByLabel('Session file to import').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('Imported recording: inspection only.')).toBeVisible();
  await expect(page.locator('[data-exchange-header]').first()).toContainText('protobuf');
  const imported = await page.evaluate(() => (document.querySelector('[data-testid="frames"]') as HTMLElement | null)?.getAttribute('data-frame-total'));
  expect(imported).toBe('5');
  // Exporting the imported session again gives the same bytes: nothing was re-encoded on the way in.
  await page.getByRole('button', { name: 'Export session' }).click();
  const [again] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  const second = JSON.parse(readFileSync(await again.path(), 'utf8')) as typeof exported;
  expect(second.session.frames.map((frame) => frame.bytes)).toEqual(bytes);
});
