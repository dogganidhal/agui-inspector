// Subagent lanes and the timeline in the assembled app (specs/009-subagent-lanes, US5, FR-017 to FR-019, SC-009, SC-010).
// The page is the production build, under its own content security policy, and the agent answers with the reference
// agent's scripted "subagents" run: nested and parallel subagents, one failing. The lanes and the timeline of the live run
// are read, the session is exported, imported into a fresh page and read again: they must be the same. Reading them must
// never send a request, write browser storage or change the recording.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, expectAllowlisted, open, send, test, type Site } from './support';

const config = (origins: Pick<Site, 'agent'>) => ({ version: 0, agents: [{ id: 'subagents', name: 'Subagent agent', url: `${origins.agent.origin}/subagents` }] });

const timeline = (page: Page) => page.locator('[data-timeline="subagents"]');
/** The lane of a named subagent. The reference agent names its invocation ids `sub-<name>-<run id>`. */
const lane = (page: Page, name: string) => page.locator(`[data-subagent^="sub-${name}-"]`);
const row = (page: Page, name: string) => timeline(page).getByRole('button', { name: new RegExp(`^${name},`) });
const toggle = (page: Page, name: string) => lane(page, name).locator('.agui-lane-toggle').first();

/** Everything the lanes and the timeline show, as text and as bar positions, in document order. */
async function read(page: Page): Promise<{ timeline: string; bars: Array<string | null>; lanes: string[]; rows: string[] }> {
  return {
    timeline: await timeline(page).innerText(),
    bars: await timeline(page).locator('.agui-tl-bar').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('style'))),
    lanes: await page.locator('[data-entry="subagent"]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).innerText)),
    rows: await timeline(page).locator('[data-tl-row]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? '')),
  };
}

async function exportFile(page: Page): Promise<string> {
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Inspection', exact: true }).click();
  await page.getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return readFileSync((await download.path())!, 'utf8');
}

/** Moves with the keyboard only: a row, then its lane, then back to its row. */
async function useFromKeyboard(page: Page): Promise<void> {
  await row(page, 'researcher').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'fact-checker')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toggle(page, 'fact-checker')).toBeFocused();
  await expect(toggle(page, 'fact-checker')).toBeInViewport();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(row(page, 'fact-checker')).toBeFocused();
}

test('lanes and timeline of a live run are the same after export and import, and reading them sends and changes nothing', async ({ page, openSite, requested, violations }) => {
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as unknown as { __writes: string[] }).__writes = writes;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(key);
      return original.call(this, key, value);
    };
  });
  const site = await openSite({ config });
  await open(page, site);
  await send(page, 'subagents');
  await expect(page.locator('[data-entry="run"][data-status="finished"]')).toHaveCount(1);

  // Three lanes, the nested one inside its parent, and a failing one.
  await expect(page.locator('[data-entry="subagent"]')).toHaveCount(3);
  await expect(lane(page, 'researcher').locator('[data-entry="subagent"]')).toHaveCount(1);
  await expect(lane(page, 'writer')).toContainText('Error');
  await expect(lane(page, 'writer')).toContainText('budget_exceeded');
  await expect(lane(page, 'researcher')).toContainText('Two sources found.');
  await expect(lane(page, 'researcher')).not.toContainText('Drafting the summary');
  await expect(timeline(page).locator('[data-chart]')).toHaveCount(1);
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(3);
  await expect(row(page, 'writer').locator('.agui-tl-end')).toHaveText('✕');

  // The keyboard works in the assembled page, which scrolls the lane into view.
  await useFromKeyboard(page);
  expect(await violations(), 'the policy reported nothing while the timeline and lanes rendered').toEqual([]);

  // Reading them sent nothing, wrote nothing and left the recording as it was.
  const live = await read(page);
  const writes = () => page.evaluate(() => (window as unknown as { __writes: string[] }).__writes.length);
  const requests = requested.length;
  const sent = site.agent.seen.length;
  const stored = await writes();
  await useFromKeyboard(page);
  await toggle(page, 'writer').click();
  await toggle(page, 'writer').click();
  expect(requested.length).toBe(requests);
  expect(site.agent.seen.length).toBe(sent);
  expect(await writes(), 'nothing was written to browser storage').toBe(stored);
  const file = await exportFile(page);
  expect(await exportFile(page), 'two exports of the same session are the same file').toBe(file);
  const parsed = JSON.parse(file) as { version: number; session: Record<string, unknown> };
  expect(parsed.version).toBe(0);
  expect(Object.keys(parsed.session).sort(), 'the lanes are derived from the frames, so the file has no field for them').toEqual(['derived', 'exchanges', 'findings', 'frames', 'id', 'runs']);

  // A fresh page imports the file and shows the same lanes and the same timeline.
  const fresh = await page.context().newPage();
  await open(fresh, site);
  await fresh.locator('input[type="file"]').first().setInputFiles({ name: 'subagents.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await expect(fresh.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(fresh.locator('[data-entry="subagent"]')).toHaveCount(3);
  expect(await read(fresh), 'the same lanes, rows and bars as the live capture').toEqual(live);
  await useFromKeyboard(fresh);
  await row(fresh, 'writer').focus();
  await fresh.keyboard.press('Enter');
  await expect(toggle(fresh, 'writer')).toBeFocused();
  expect(await exportFile(fresh), 'and exporting it again gives back the same bytes').toBe(file);
  expect(site.agent.seen.length, 'importing and reading them sent nothing to the agent').toBe(sent);
  expectAllowlisted(requested, [site.page.origin, site.agent.origin]);
});

test('a session exported by 0.1.0 with subagent events shows lanes and a timeline', async ({ page, openSite }) => {
  const site = await openSite({ config });
  await open(page, site);
  // The 0.1.0 session format has no field for lanes. A recording of subagent frames, as 0.1.0 wrote it, is enough.
  const frames = [
    { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' },
    { type: 'SUBAGENT_STARTED', subagentRunId: 's1', name: 'helper', parentToolCallId: 'tc1' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant', subagentRunId: 's1' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'from the helper', subagentRunId: 's1' },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1', subagentRunId: 's1' },
    { type: 'SUBAGENT_FINISHED', subagentRunId: 's1', outcome: { type: 'success' } },
    { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } },
  ].map((event, index) => {
    const envelope = `data: ${JSON.stringify(event)}\n\n`;
    return { id: `ex1:frame-${index}`, exchangeId: 'ex1', index, classification: 'data', envelope, data: JSON.stringify(event), offsetMs: 10 + index * 10, eventType: event.type, summary: event.type, jsonVerdict: 'valid', schemaVerdict: 'valid', parsed: event, provenance: 'raw' };
  });
  const session = {
    id: 'legacy',
    exchanges: [{ id: 'ex1', kind: 'conversation', method: 'POST', path: '/agent', requestBody: '{"threadId":"t1","runId":"r1","messages":[],"tools":[],"context":[],"state":{},"forwardedProps":{}}', requestBodyJson: { threadId: 't1', runId: 'r1', messages: [], tools: [], context: [], state: {}, forwardedProps: {} }, status: 200, startedAt: 1_700_000_000_000, elapsedMs: 100, transport: 'completed', runId: 'run-ex1', frameIds: frames.map((frame) => frame.id) }],
    runs: [{ id: 'run-ex1', threadId: 't1', runId: 'r1', input: { threadId: 't1', runId: 'r1', messages: [], tools: [], context: [], state: {}, forwardedProps: {} }, exchangeId: 'ex1', startedAt: 1_700_000_000_000, outcome: { kind: 'success', pendingToolCallIds: [] } }],
    frames,
    findings: [],
    derived: [],
  };
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 0, session })) });
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  const helper = page.locator('[data-subagent="s1"]');
  await expect(helper).toContainText('from the helper');
  await expect(helper).toContainText('Finished');
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(1);
});
