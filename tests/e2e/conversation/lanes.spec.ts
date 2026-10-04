// Subagent lanes and the timeline in a real browser (specs/009-subagent-lanes, US1 to US5, FR-001 to FR-017, SC-001 to
// SC-005, SC-007, SC-008). The fixture host streams the reference agent's scripted "subagents" run, and runs of its own,
// through the real frame reader and store, so each check is about what a developer sees and can do: read each
// subagent's work in its lane, read the timeline, move between them from the keyboard, and watch a live run.
import { expect, type Locator, type Page } from '@playwright/test';
import { interactiveResponse, SUBAGENTS } from '../../../examples/reference-agent/scenarios.ts';
import { close, open, revealed, send, start, test } from './site';

/** The reference agent's "subagents" run as events: researcher and writer in parallel, fact-checker inside researcher, writer failing. */
function scripted(runId = 'r1'): object[] {
  const reply = interactiveResponse({ threadId: 't1', runId, messages: [{ role: 'user', content: SUBAGENTS }] });
  return reply.chunks.map((chunk) => JSON.parse(new TextDecoder().decode(chunk).replace(/^data: /, '').trim()) as object);
}

const started = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_STARTED', subagentRunId: id, name: id, ...extra });
const finished = (id: string, extra: object = {}) => ({ type: 'SUBAGENT_FINISHED', subagentRunId: id, ...extra });
const inLane = (id: string, event: object) => ({ ...event, subagentRunId: id });
const RUN = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const DONE = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } };

const lane = (page: Page, name: string) => page.locator(`[data-subagent="sub-${name}-r1"]`);
const toggle = (page: Page, name: string) => lane(page, name).locator('.agui-lane-toggle').first();
const timeline = (page: Page) => page.locator('[data-timeline="subagents"]');
const row = (page: Page, name: string) => timeline(page).getByRole('button', { name: new RegExp(`^${name},`) });
const byId = (page: Page, id: string) => page.locator(`[data-subagent="${id}"]`);
const rowOf = (page: Page, id: string) => timeline(page).getByRole('button', { name: new RegExp(`subagent ${id},`) });

/** Presses Tab (or Shift+Tab) until the locator has focus, so a test never uses the pointer. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab'): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`focus never reached ${String(target)}`);
}

async function run(page: Page, site: Parameters<typeof open>[1], events: object[] = scripted(), options: { close?: string | false } = {}): Promise<void> {
  await open(page, site);
  await start(page, 'ex1', 't1', 'r1');
  await send(page, 'ex1', events);
  if (options.close !== false) await close(page, 'ex1', options.close ?? 'completed');
}

// ---- US1: lanes ----

test('every entry sits in the lane its event named, nested lanes inside their parent, and the parent flow outside', async ({ page, site }) => {
  await run(page, site);
  const researcher = lane(page, 'researcher');
  const writer = lane(page, 'writer');
  const checker = lane(page, 'fact-checker');

  await expect(researcher).toContainText('Looking for sources. Two sources found.');
  await expect(researcher).not.toContainText('Drafting');
  await expect(writer).toContainText('Drafting the summary. It stops before the end.');
  await expect(writer).not.toContainText('Looking for sources');
  await expect(researcher.locator('[data-subagent="sub-fact-checker-r1"]')).toHaveCount(1);
  await expect(writer.locator('[data-subagent="sub-fact-checker-r1"]')).toHaveCount(0);
  await expect(checker).toContainText('lookup_claim');
  await expect(checker).toContainText('confirmed');

  // The parent's own text, and the parent's message after the subagents, are in no lane.
  const parentText = page.locator('[data-entry="message"]').filter({ hasText: 'I will ask two helpers' });
  await expect(parentText).toHaveCount(1);
  await expect(page.locator('[data-subagent] [data-entry="message"]').filter({ hasText: 'I will ask two helpers' })).toHaveCount(0);
  await expect(page.locator('[data-subagent] [data-entry="message"]').filter({ hasText: 'The research is done' })).toHaveCount(0);
  await expect(page.locator('[data-entry="message"]').filter({ hasText: 'The research is done' })).toHaveCount(1);
  // The two parallel lanes started inside the parent's step.
  await expect(page.locator('[data-entry="step"] [data-subagent="sub-researcher-r1"]')).toHaveCount(1);
  await expect(page.locator('[data-entry="step"] [data-subagent="sub-writer-r1"]')).toHaveCount(1);
});

test('a lane shows its header and can be collapsed and opened, keeping its status and counts', async ({ page, site }) => {
  await run(page, site);
  const header = lane(page, 'writer').locator('.agui-lane-head').first();
  await expect(header).toContainText('writer');
  await expect(header).toContainText('Error');
  await expect(header).toContainText('Drafts the summary');
  await expect(header).toContainText('1 message');
  const button = toggle(page, 'writer');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(lane(page, 'writer')).toContainText('budget_exceeded');

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(lane(page, 'writer')).not.toContainText('Drafting the summary');
  await expect(header).toContainText('Error');
  await expect(header).toContainText('1 message');

  await button.click();
  await expect(lane(page, 'writer')).toContainText('Drafting the summary. It stops before the end.');
});

test('a thread without subagents has no lane and no timeline', async ({ page, site }) => {
  await run(page, site, [RUN, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, { type: 'TEXT_MESSAGE_END', messageId: 'm' }, DONE]);
  await expect(page.locator('[data-entry="message"]')).toHaveCount(1);
  await expect(page.locator('.agui-lane')).toHaveCount(0);
  await expect(timeline(page)).toHaveCount(0);
});

// ---- US2: the timeline ----

test('the timeline has a row for the run and each subagent, parallel bars overlap and a failed one shows an error end', async ({ page, site }) => {
  await run(page, site);
  await expect(timeline(page).locator('[data-chart]')).toHaveCount(1);
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(3);
  await expect(timeline(page).locator('.agui-tl-runrow')).toHaveCount(1);

  const bar = async (name: string) => (await row(page, name).locator('.agui-tl-bar').boundingBox())!;
  const [researcher, writer, checker] = [await bar('researcher'), await bar('writer'), await bar('fact-checker')];
  expect(researcher.x).toBeLessThan(writer.x + writer.width);
  expect(writer.x).toBeLessThan(researcher.x + researcher.width);
  expect(checker.x).toBeGreaterThanOrEqual(researcher.x);
  expect(checker.x + checker.width).toBeLessThanOrEqual(researcher.x + researcher.width + 1);

  await expect(row(page, 'writer')).toHaveAttribute('data-status', 'error');
  await expect(row(page, 'writer').locator('.agui-tl-end')).toHaveText('✕');
  await expect(row(page, 'writer')).toContainText('Error');
  await expect(row(page, 'researcher').locator('.agui-tl-end')).toHaveText('✓');

  // The nested subagent is listed under its parent and indented further.
  const order = await timeline(page).locator('[data-tl-row]').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.tlRow?.split(':').pop()));
  expect(order).toEqual(['subagent-sub-researcher-r1', 'subagent-sub-fact-checker-r1', 'subagent-sub-writer-r1']);
  const indent = (name: string) => row(page, name).locator('.agui-tl-name').evaluate((node) => node.getBoundingClientRect().left);
  expect(await indent('fact-checker')).toBeGreaterThan(await indent('researcher'));
  await expect(timeline(page)).toContainText('derived from the offsets at which frames arrived');
});

test('sequential subagents do not overlap on the axis', async ({ page, site }) => {
  await run(page, site, [RUN, started('sub-first-r1'), finished('sub-first-r1'), started('sub-second-r1'), finished('sub-second-r1'), DONE]);
  const bar = async (id: string) => (await rowOf(page, id).locator('.agui-tl-bar').boundingBox())!;
  const first = await bar('sub-first-r1');
  const second = await bar('sub-second-r1');
  expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);
});

test('the timeline can be collapsed and opened', async ({ page, site }) => {
  await run(page, site);
  const summary = timeline(page).locator('summary').first();
  await expect(timeline(page).locator('[data-tl-row]').first()).toBeVisible();
  await summary.click();
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(0);
  await summary.click();
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(3);
});

test('at 375 px the page does not scroll sideways, and the chart scrolls inside its own box', async ({ page, site }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await run(page, site);
  const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, window: document.documentElement.clientWidth }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);
  const box = timeline(page).locator('.agui-tl-box').first();
  const sizes = await box.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
  expect(sizes.scroll).toBeGreaterThan(sizes.client);
  await expect(box).toHaveAttribute('tabindex', '0');
});

// ---- US3: keyboard ----

test('from the keyboard alone: reach the timeline, move over its rows, jump to a lane, collapse its parent and come back', async ({ page, site }) => {
  await run(page, site);
  await tabTo(page, row(page, 'researcher'));
  await expect(row(page, 'researcher')).toBeFocused();
  expect(await row(page, 'researcher').evaluate((node) => getComputedStyle(node).outlineStyle), 'focus is visible').not.toBe('none');
  // One tab stop: the other rows are not in the tab order.
  await expect(row(page, 'fact-checker')).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'fact-checker')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'writer')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'writer'), 'no wrap at the end').toBeFocused();
  await page.keyboard.press('Home');
  await expect(row(page, 'researcher')).toBeFocused();
  await page.keyboard.press('End');
  await expect(row(page, 'writer')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(row(page, 'fact-checker')).toBeFocused();

  // Enter jumps to the lane of the nested subagent, and focus lands on its toggle.
  await page.keyboard.press('Enter');
  await expect(toggle(page, 'fact-checker')).toBeFocused();

  // Collapse the parent lane with the keyboard.
  await tabTo(page, toggle(page, 'researcher'), 'Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(toggle(page, 'researcher')).toHaveAttribute('aria-expanded', 'false');
  await expect(lane(page, 'fact-checker')).toHaveCount(0);

  // "Show in timeline" goes back to the row.
  await page.keyboard.press('Tab');
  await expect(lane(page, 'researcher').getByRole('button', { name: 'Show researcher in the timeline' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row(page, 'researcher')).toBeFocused();

  // A jump to a lane inside a collapsed lane opens what hides it.
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'fact-checker')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(toggle(page, 'researcher')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'fact-checker')).toBeFocused();
});

test('a jump opens the collapsed step and the collapsed timeline that hide its target', async ({ page, site }) => {
  await run(page, site);
  // Collapse the step that holds the two parallel lanes, then jump to a lane inside it.
  await page.locator('[data-entry="step"] > details > summary').first().click();
  await expect(lane(page, 'writer')).toHaveCount(0);
  await row(page, 'writer').focus();
  await page.keyboard.press('Enter');
  await expect(toggle(page, 'writer')).toBeFocused();

  // Collapse the timeline, then use "Show in timeline".
  await timeline(page).locator('summary').first().click();
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(0);
  await lane(page, 'writer').getByRole('button', { name: 'Show writer in the timeline' }).click();
  await expect(row(page, 'writer')).toBeFocused();
});

test('keys typed in another control do not move the timeline', async ({ page, site }) => {
  await run(page, site);
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'probe';
    document.body.append(input);
  });
  await row(page, 'researcher').focus();
  await page.locator('#probe').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await expect(page.locator('#probe')).toBeFocused();
  await expect(row(page, 'researcher')).toHaveAttribute('tabindex', '0');
});

test('a pointer click on a row jumps to its lane', async ({ page, site }) => {
  await run(page, site);
  await row(page, 'writer').click();
  await expect(toggle(page, 'writer')).toBeFocused();
});

test('more than 100 subagents show 100 rows and a button for the rest, which works from the keyboard', async ({ page, site }) => {
  const events: object[] = [RUN];
  for (let i = 0; i < 150; i += 1) events.push(started(`many-${i}`));
  for (let i = 0; i < 150; i += 1) events.push(finished(`many-${i}`));
  events.push(DONE);
  await run(page, site, events);
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(100);
  const more = timeline(page).getByRole('button', { name: 'Show 50 more rows' });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(150);
  await expect(rowOf(page, 'many-100')).toBeFocused();

  // "Show in timeline" for a row past the limit shows the whole chart first.
  await page.reload();
  await page.waitForFunction(() => '__conversation' in window);
  await start(page, 'ex1', 't1', 'r1');
  await send(page, 'ex1', events);
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(100);
  await byId(page, 'many-149').getByRole('button', { name: /Show many-149 in the timeline/ }).click();
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(150);
  await expect(rowOf(page, 'many-149')).toBeFocused();
});

test('from a thread of 200 subagents, 95% of row jumps show their lane with focus in its header within 200 ms', async ({ page, site }) => {
  const events: object[] = [RUN];
  const ids: Array<[string, string | undefined]> = [];
  for (let a = 0; a < 10; a += 1) {
    ids.push([`a${a}`, undefined]);
    for (let b = 0; b < 4; b += 1) ids.push([`a${a}-b${b}`, `a${a}`]);
    for (let c = 0; c < 15; c += 1) ids.push([`a${a}-c${c}`, `a${a}-b${c % 4}`]);
  }
  for (const [id, parent] of ids) events.push(started(id, parent === undefined ? {} : { parentSubagentRunId: parent }));
  for (const [id] of ids) {
    events.push(inLane(id, { type: 'TEXT_MESSAGE_START', messageId: `m-${id}`, role: 'assistant' }));
    for (let n = 0; n < 22; n += 1) events.push(inLane(id, { type: 'TEXT_MESSAGE_CONTENT', messageId: `m-${id}`, delta: `w${n} ` }));
    events.push(inLane(id, { type: 'TEXT_MESSAGE_END', messageId: `m-${id}` }));
  }
  for (const [id] of [...ids].reverse()) events.push(finished(id));
  events.push(DONE);
  expect(events.length).toBeGreaterThan(5000);
  await run(page, site, events);
  await expect(timeline(page).locator('[data-tl-row]')).toHaveCount(100);

  await page.evaluate(() => {
    const w = window as unknown as { __jumps: number[]; __key: number };
    w.__jumps = [];
    document.addEventListener('keydown', () => (w.__key = performance.now()), true);
    document.addEventListener('focusin', (event) => {
      if ((event.target as HTMLElement).classList.contains('agui-lane-toggle')) w.__jumps.push(performance.now() - w.__key);
    });
  });
  for (let i = 0; i < 20; i += 1) {
    const target = timeline(page).locator('[data-tl-row]').nth(i * 4);
    await target.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __jumps: number[] }).__jumps.length)).toBe(i + 1);
  }
  const jumps = (await page.evaluate(() => (window as unknown as { __jumps: number[] }).__jumps)).sort((a, b) => a - b);
  const p95 = jumps[Math.ceil(jumps.length * 0.95) - 1]!;
  console.log(`row jumps: median ${jumps[Math.floor(jumps.length / 2)]!.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms of ${jumps.length}`);
  expect(p95).toBeLessThan(200);
});

// ---- US4: gaps ----

test('a subagent error does not fail the run, and a suspended one says so with its interrupts', async ({ page, site }) => {
  await run(page, site, [RUN, started('sub-bad-r1'), { type: 'SUBAGENT_ERROR', subagentRunId: 'sub-bad-r1', message: 'It broke', code: 'E1' }, started('sub-wait-r1'), finished('sub-wait-r1', { outcome: { type: 'suspended', interruptIds: ['i-1'] } }), DONE]);
  await expect(page.locator('[data-entry="run"]')).toContainText('Finished');
  await expect(byId(page, 'sub-bad-r1')).toContainText('It broke');
  await expect(byId(page, 'sub-bad-r1')).toContainText('E1');
  await expect(rowOf(page, 'sub-bad-r1')).toContainText('Error');
  await expect(byId(page, 'sub-wait-r1')).toContainText('Suspended');
  await expect(byId(page, 'sub-wait-r1')).toContainText('i-1');
  await expect(rowOf(page, 'sub-wait-r1').locator('.agui-tl-end')).toHaveText('‖');
});

test('a suspended subagent that a later run continues has its own lane and its own chart there', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1', 't1', 'r1');
  await send(page, 'ex1', [RUN, started('sub-job-r1'), finished('sub-job-r1', { outcome: { type: 'suspended' } }), DONE]);
  await close(page, 'ex1', 'completed');
  await start(page, 'ex2', 't1', 'r2');
  await send(page, 'ex2', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, started('sub-job-r1'), inLane('sub-job-r1', { type: 'CUSTOM', name: 'resumed', value: 1 }), finished('sub-job-r1'), { type: 'RUN_FINISHED', threadId: 't1', runId: 'r2', outcome: { type: 'success' } }]);
  await close(page, 'ex2', 'completed');

  await expect(page.locator('[data-subagent="sub-job-r1"]')).toHaveCount(2);
  await expect(page.locator('[data-subagent="sub-job-r1"]').first()).toContainText('Suspended');
  await expect(page.locator('[data-subagent="sub-job-r1"]').nth(1)).toContainText('Continued');
  await expect(page.locator('[data-subagent="sub-job-r1"]').nth(1)).toContainText('resumed');
  await expect(timeline(page).locator('[data-chart]')).toHaveCount(2);
});

test('a subagent with no end event is Running while the exchange is live, No end event once it is not, and Stopped by you when stopped', async ({ page, site }) => {
  await run(page, site, [RUN, started('sub-open-r1'), inLane('sub-open-r1', { type: 'CUSTOM', name: 'x', value: 1 })], { close: false });
  await expect(byId(page, 'sub-open-r1')).toContainText('Running');
  await expect(rowOf(page, 'sub-open-r1').locator('.agui-tl-end')).toHaveText('▸');
  await close(page, 'ex1', 'completed');
  await expect(byId(page, 'sub-open-r1')).toContainText('No end event');
  await expect(byId(page, 'sub-open-r1')).not.toContainText('Running');
  await expect(page.locator('[data-entry="run"]')).toContainText('No terminal event');

  await page.reload();
  await page.waitForFunction(() => '__conversation' in window);
  await start(page, 'ex1', 't1', 'r1');
  await send(page, 'ex1', [RUN, started('sub-cut-r1')]);
  await close(page, 'ex1', 'user-stopped');
  await expect(byId(page, 'sub-cut-r1')).toContainText('Stopped by you');
  await expect(rowOf(page, 'sub-cut-r1').locator('.agui-tl-end')).toHaveText('■');
});

test('events with no start event and a child with an unseen parent are labelled, not invented', async ({ page, site }) => {
  await run(page, site, [RUN, inLane('sub-quiet-r1', { type: 'CUSTOM', name: 'x', value: 1 }), started('sub-lost-r1', { parentSubagentRunId: 'sub-ghost-r1' }), finished('sub-lost-r1'), started('sub-empty-r1'), finished('sub-empty-r1'), DONE]);
  const quiet = byId(page, 'sub-quiet-r1');
  await expect(quiet).toContainText('Start not received');
  await expect(quiet.locator('.agui-lane-head').first()).not.toContainText(/\+\d+\.\d{3}/);
  await expect(byId(page, 'sub-lost-r1')).toContainText('Parent sub-ghost-r1 not seen in this run');
  await expect(byId(page, 'sub-empty-r1')).toContainText('No events in this lane.');
});

test('a messages snapshot takes an ended lane out of the transcript, keeps its row, and the row opens its start frame', async ({ page, site }) => {
  await run(page, site, [
    RUN,
    started('sub-done-r1'),
    inLane('sub-done-r1', { type: 'CUSTOM', name: 'x', value: 1 }),
    finished('sub-done-r1'),
    started('sub-open-r1'),
    { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u1', role: 'user', content: 'restated' }] },
    inLane('sub-open-r1', { type: 'CUSTOM', name: 'after', value: 2 }),
    finished('sub-open-r1'),
    DONE,
  ]);
  await expect(byId(page, 'sub-done-r1')).toHaveCount(0);
  await expect(byId(page, 'sub-open-r1')).toHaveCount(1);
  await expect(byId(page, 'sub-open-r1')).toContainText('after');
  await expect(rowOf(page, 'sub-done-r1')).toContainText('Replaced transcript');
  await expect(rowOf(page, 'sub-done-r1')).toContainText('Finished');

  await rowOf(page, 'sub-done-r1').focus();
  await page.keyboard.press('Enter');
  const targets = await revealed(page);
  expect(targets.at(-1)?.frameId, 'the start frame of the subagent').toMatch(/frame-1$/);
});

test('a name of 400 characters is shortened on its row and complete in its lane', async ({ page, site }) => {
  const name = 'long-'.repeat(80);
  await run(page, site, [RUN, started('sub-long-r1', { name }), finished('sub-long-r1'), DONE]);
  await expect(rowOf(page, 'sub-long-r1').locator('.agui-tl-label')).toHaveAttribute('title', `${name} (sub-long-r1)`);
  const label = rowOf(page, 'sub-long-r1').locator('.agui-tl-name');
  expect(await label.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(byId(page, 'sub-long-r1').locator('.agui-lane-toggle').first()).toContainText(name);
});

// ---- US5: live ----

test('a live run: lanes and rows appear without an action, bars grow, an end event updates them, and a collapsed lane stays collapsed', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1', 't1', 'r1');
  await send(page, 'ex1', [RUN]);
  await expect(timeline(page)).toHaveCount(0);
  await send(page, 'ex1', [started('sub-live-r1'), inLane('sub-live-r1', { type: 'CUSTOM', name: 'one', value: 1 })], 20);
  await expect(byId(page, 'sub-live-r1')).toContainText('Running');
  await expect(rowOf(page, 'sub-live-r1')).toContainText('Running');
  const width = async () => (await rowOf(page, 'sub-live-r1').locator('.agui-tl-bar').boundingBox())!.width;
  const before = await width();

  await byId(page, 'sub-live-r1').locator('.agui-lane-toggle').first().click();
  await expect(byId(page, 'sub-live-r1').locator('.agui-lane-toggle').first()).toHaveAttribute('aria-expanded', 'false');

  await send(page, 'ex1', Array.from({ length: 30 }, (_, i) => inLane('sub-live-r1', { type: 'CUSTOM', name: `more-${i}`, value: i })), 100);
  await expect.poll(width).toBeGreaterThan(before);
  await expect(byId(page, 'sub-live-r1').locator('.agui-lane-toggle').first()).toHaveAttribute('aria-expanded', 'false');

  await send(page, 'ex1', [finished('sub-live-r1')], 1000);
  await expect(byId(page, 'sub-live-r1')).toContainText('Finished', { timeout: 1000 });
  await expect(rowOf(page, 'sub-live-r1')).toHaveAttribute('data-status', 'finished', { timeout: 1000 });
  await expect(rowOf(page, 'sub-live-r1').locator('.agui-tl-end')).toHaveText('✓');

  // A new thread shows nothing of the old one.
  await start(page, 'ex2', 't2', 'r9');
  await send(page, 'ex2', [{ type: 'RUN_STARTED', threadId: 't2', runId: 'r9' }]);
  await expect(page.locator('.agui-lane')).toHaveCount(0);
  await expect(timeline(page)).toHaveCount(0);
});

// ---- contrast ----

type Rgb = readonly [number, number, number];

function luminance([r, g, b]: Rgb): number {
  const linear = (value: number) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The colors a locator's elements are painted with, as sRGB: its text color, its fill and border over what is behind it,
 * the outline of a focused one, and the opaque background behind it. Colors go through a canvas pixel, so `color-mix` and
 * `oklch` become what the screen shows.
 */
const paint = (locator: Locator) =>
  locator.evaluateAll((nodes) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    const rgba = (css: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data as unknown as [number, number, number, number];
      return [r, g, b, a / 255];
    };
    const over = (top: number[], base: number[]): number[] => [0, 1, 2].map((i) => (top[i] as number) * (top[3] as number) + (base[i] as number) * (1 - (top[3] as number))).concat(1);
    const backdrop = (from: Element | null): number[] => {
      const fills: number[][] = [];
      for (let at = from; at; at = at.parentElement) {
        const fill = rgba(getComputedStyle(at).backgroundColor);
        if ((fill[3] as number) > 0) fills.push(fill);
        if (fill[3] === 1) break;
      }
      return fills.reverse().reduce((base, fill) => over(fill, base));
    };
    const round = (value: number[]) => value.slice(0, 3).map(Math.round) as unknown as [number, number, number];
    return nodes.map((node) => {
      const style = getComputedStyle(node);
      const behind = backdrop(node.parentElement);
      const own = rgba(style.backgroundColor);
      return {
        text: node.textContent ?? '',
        size: style.fontSize,
        color: round(over(rgba(style.color), over(own, behind))),
        fill: round(over(own, behind)),
        border: round(over(rgba(style.borderTopColor), over(own, behind))),
        outline: round(over(rgba(style.outlineColor), behind)),
        behind: round(behind),
      };
    });
  });

for (const scheme of ['light', 'dark'] as const) {
  test(`lane and timeline text reach 4.5:1 and bars, glyphs and focus rings 3:1 in the ${scheme} theme`, async ({ page, site }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, site);
    await start(page, 'ex1', 't1', 'r1');
    await send(page, 'ex1', [RUN, started('sub-fin-r1'), finished('sub-fin-r1'), started('sub-sus-r1'), finished('sub-sus-r1', { outcome: { type: 'suspended' } }), started('sub-err-r1'), { type: 'SUBAGENT_ERROR', subagentRunId: 'sub-err-r1', message: 'bad' }, started('sub-run-r1'), started('sub-cont-r1')]);
    await close(page, 'ex1', 'completed');
    await start(page, 'ex2', 't1', 'r2');
    await send(page, 'ex2', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r2' }, started('sub-live-r2')]);
    await start(page, 'ex3', 't1', 'r3');
    await send(page, 'ex3', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r3' }, started('sub-cut-r3')]);
    await close(page, 'ex3', 'user-stopped');
    await expect(page.locator('html')).toHaveCSS('color-scheme', scheme);

    const text: Array<[string, Locator]> = [
      ['lane headers', page.locator('.agui-lane-toggle')],
      ['lane status words', page.locator('.agui-lane-toggle .agui-tag')],
      ['lane meta', page.locator('.agui-lane-meta, .agui-lane-toggle .agui-conv-muted')],
      ['row labels', page.locator('.agui-tl-name')],
      ['row meta', page.locator('.agui-tl-meta span')],
      ['axis labels', page.locator('.agui-tl-axis span')],
    ];
    for (const [name, locator] of text) {
      const painted = await paint(locator);
      for (const item of painted) expect.soft(contrast(item.color, item.fill), `${name}: "${item.text.slice(0, 30)}" at ${item.size}, rgb(${item.color}) on rgb(${item.fill}) in ${scheme}`).toBeGreaterThanOrEqual(4.5);
    }

    for (const item of await paint(page.locator('.agui-tl-bar'))) {
      const best = Math.max(contrast(item.fill, item.behind), contrast(item.border, item.behind));
      expect.soft(best, `a bar: fill rgb(${item.fill}), border rgb(${item.border}) on rgb(${item.behind}) in ${scheme}`).toBeGreaterThanOrEqual(3);
    }
    for (const item of await paint(page.locator('.agui-tl-bar .agui-tl-end'))) {
      expect.soft(contrast(item.color, item.behind), `an end glyph "${item.text}": rgb(${item.color}) on rgb(${item.behind}) in ${scheme}`).toBeGreaterThanOrEqual(3);
    }

    for (const target of [toggle(page, 'fin'), page.locator('[data-tl-row]').first()]) {
      await target.focus();
      const [ring] = await paint(target);
      expect.soft(contrast(ring!.outline, ring!.behind), `focus ring rgb(${ring!.outline}) on rgb(${ring!.behind}) in ${scheme}`).toBeGreaterThanOrEqual(3);
    }
  });
}
