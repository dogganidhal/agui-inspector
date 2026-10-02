// L03 T033 (FR-012 to FR-022, US1.3, US3.3, US5.1): the conversation and state views in a real browser.
// The fixture host streams scripted events through the real frame reader and store, so every check is
// about what a user sees as frames arrive: live text, interleaving, every event family's presentation,
// opaque encrypted reasoning, plain-text safety and zero requests outside the page's own origin.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Page } from '@playwright/test';
import { eventFixtures } from '../../../examples/reference-agent/protocol-fixtures.ts';
import { bundleOptions } from '../../../scripts/build.mjs';

/** The script API packages/inspector/tests/conversation/fixture.tsx puts on window, as far as this spec uses it. */
declare global {
  interface Window {
    __conversation: {
      open(id: string, options?: { input?: object }): void;
      push(exchangeId: string, event: object | string, offsetMs: number): void;
      close(exchangeId: string, transport?: string): void;
      publish(): number;
      session(): {
        frames: Array<{ eventType?: string; data?: string }>;
        derived: Array<{ provenance: string; derivation: string; attribution: string; sources: string[] }>;
      };
    };
  }
}

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const OVERRIDE = ':root { --agui-radius: 22px; --agui-accent: oklch(0.55 0.2 255); --agui-font-sans: "Courier New", monospace; }';

interface Site {
  origin: string;
}

const test = base.extend<object, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'conversation-e2e-'));
      await build({
        ...bundleOptions(outdir),
        entryPoints: { fixture: path.join(root, 'packages', 'inspector', 'tests', 'conversation', 'fixture.tsx') },
      });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'; base-uri 'none'" />
    <title>conversation fixture</title>
    <link rel="stylesheet" href="/fixture.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body>
</html>`;
      const files: Record<string, [string, string]> = {
        '/': ['text/html', page],
        '/fixture.js': ['text/javascript', readFileSync(path.join(outdir, 'fixture.js'), 'utf8')],
        '/fixture.css': ['text/css', readFileSync(path.join(outdir, 'fixture.css'), 'utf8')],
        '/override.css': ['text/css', OVERRIDE],
      };
      const server: Server = createServer((request, response) => {
        const hit = files[new URL(request.url ?? '/', 'http://x').pathname];
        response.writeHead(hit ? 200 : 404, { 'content-type': hit?.[0] ?? 'text/plain' });
        response.end(hit?.[1] ?? 'not found');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      await use({ origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      await new Promise((resolve) => server.close(resolve));
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
});

const fx = eventFixtures;
const STARTED = { type: 'RUN_STARTED', threadId: 't1', runId: 'r1' };
const FINISHED = { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', outcome: { type: 'success' } };

async function open(page: Page, site: Site, scheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(site.origin);
  await page.waitForFunction(() => '__conversation' in window);
}

/** Starts an exchange of thread t1. */
const start = (page: Page, id: string, runId = id) =>
  page.evaluate(([exchange, run]) => window.__conversation.open(exchange as string, { input: { threadId: 't1', runId: run as string } }), [id, runId]);

/** Pushes events to an exchange, 10 ms apart from `from`. */
const send = (page: Page, id: string, events: ReadonlyArray<object | string>, from = 10) =>
  page.evaluate(([exchange, list, offset]) => (list as Array<object | string>).forEach((event, i) => window.__conversation.push(exchange as string, event, (offset as number) + i * 10)), [id, events, from]);

const end = (page: Page, id: string, transport = 'completed') =>
  page.evaluate(([exchange, how]) => window.__conversation.close(exchange as string, how as string), [id, transport]);

const entry = (page: Page, kind: string) => page.locator(`[data-pane="conversation"] [data-entry="${kind}"]`);

test('text streams in live with a caret, deltas stay inspectable, and the caret goes when the message ends', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hel' }]);
  const message = entry(page, 'message');
  await expect(message).toContainText('Hel');
  await expect(message.locator('.agui-caret')).toBeVisible();
  await expect(entry(page, 'run')).toHaveAttribute('data-status', 'streaming');

  await send(page, 'ex1', [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'lo' }, { type: 'TEXT_MESSAGE_END', messageId: 'm1' }], 40);
  await expect(message).toContainText('Hello');
  await expect(message.locator('.agui-caret')).toHaveCount(0);

  await message.getByText('2 deltas').click();
  const deltas = message.getByRole('list', { name: 'Deltas of m1' }).getByRole('listitem');
  await expect(deltas).toHaveCount(2);
  await expect(deltas.nth(0)).toContainText('Hel');
  await expect(deltas.nth(1)).toContainText('lo');
});

test('interleaved messages and tool arguments keep their own text in the order they started', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'a', role: 'assistant' },
    { type: 'TEXT_MESSAGE_START', messageId: 'b', role: 'assistant' },
    { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'lookup' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'alpha ' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{"q":' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'b', delta: 'beta ' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a', delta: 'again' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '7}' },
  ]);
  const messages = entry(page, 'message');
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText('alpha again');
  await expect(messages.nth(1)).toContainText('beta');
  await expect(messages.nth(1)).not.toContainText('alpha');
  // Still streaming: raw fragments show, nothing is parsed yet.
  await expect(entry(page, 'tool').getByLabel('Arguments of lookup, as streamed')).toHaveText('{"q":7}');
  await expect(entry(page, 'tool')).toContainText('Streaming arguments');
});

test('a tool call shows streamed arguments, then parsed arguments and its result, and keeps malformed arguments inspectable', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'TOOL_CALL_START', toolCallId: 'c1', toolCallName: 'lookup' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: '{"city":"Pa' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c1', delta: 'ris"}' },
    { type: 'TOOL_CALL_END', toolCallId: 'c1' },
    { type: 'TOOL_CALL_RESULT', messageId: 'tm', toolCallId: 'c1', content: '{"temp":21}' },
    { type: 'TOOL_CALL_START', toolCallId: 'c2', toolCallName: 'broken' },
    { type: 'TOOL_CALL_ARGS', toolCallId: 'c2', delta: '{"a":' },
    { type: 'TOOL_CALL_END', toolCallId: 'c2' },
  ]);
  const good = entry(page, 'tool').nth(0);
  await expect(good).toContainText('server tool');
  await expect(good).toContainText('Result received');
  await expect(good.getByLabel('Arguments of lookup')).toContainText('"city": "Paris"');
  await expect(good.getByLabel('Result of lookup')).toContainText('"temp": 21');
  const bad = entry(page, 'tool').nth(1);
  await expect(bad.getByLabel('Arguments of broken, as streamed')).toHaveText('{"a":');
  await expect(bad).toContainText('not valid JSON');
});

test('a run header shows ids, parent link, duration, result and outcome for every kind of ending', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1', 'r1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'pick' },
    { type: 'TOOL_CALL_END', toolCallId: 'c' },
    { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1', result: { answer: 42 }, outcome: { type: 'success', pendingToolCallIds: ['c'] } },
  ]);
  await end(page, 'ex1');
  await start(page, 'ex2', 'r2');
  await send(page, 'ex2', [
    { type: 'RUN_STARTED', threadId: 't1', runId: 'r2', parentRunId: 'r1' },
    { type: 'RUN_FINISHED', threadId: 't1', runId: 'r2', outcome: { type: 'interrupt', interrupts: [{ id: 'i1', reason: 'approval', message: 'Approve?' }] } },
  ]);
  await end(page, 'ex2');
  await start(page, 'ex3', 'r3');
  await send(page, 'ex3', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r3' }, { type: 'RUN_FINISHED', threadId: 't1', runId: 'r3', outcome: { type: 'cancelled' } }]);
  await end(page, 'ex3');
  await start(page, 'ex4', 'r4');
  await send(page, 'ex4', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r4' }, { type: 'RUN_ERROR', message: 'upstream exploded', code: 'E_UP' }]);
  await end(page, 'ex4');
  await start(page, 'ex5', 'r5');
  await send(page, 'ex5', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r5' }, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }]);
  await end(page, 'ex5', 'user-stopped');
  await start(page, 'ex6', 'r6');
  await send(page, 'ex6', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r6' }]);
  await end(page, 'ex6');

  const runs = entry(page, 'run');
  await expect(runs).toHaveCount(6);
  await expect(runs.nth(0)).toHaveAttribute('data-status', 'finished');
  await expect(runs.nth(0)).toContainText('r1');
  await expect(runs.nth(0)).toContainText('1 pending tool call');
  await runs.nth(0).getByText('Result').click();
  await expect(runs.nth(0).getByLabel('Run result')).toContainText('"answer": 42');
  await expect(entry(page, 'tool')).toContainText('Pending result');
  await expect(runs.nth(1)).toHaveAttribute('data-status', 'interrupted');
  await expect(runs.nth(1)).toContainText('← r1');
  await expect(runs.nth(1)).toContainText('1 interrupt');
  await expect(runs.nth(2)).toHaveAttribute('data-status', 'cancelled');
  await expect(runs.nth(3)).toHaveAttribute('data-status', 'error');
  await expect(runs.nth(3)).toContainText('upstream exploded');
  await expect(runs.nth(3)).toContainText('E_UP');
  await expect(runs.nth(4)).toHaveAttribute('data-status', 'stopped');
  await expect(runs.nth(4)).toContainText('Stopped by you');
  await expect(runs.nth(4)).not.toContainText('Error');
  await expect(runs.nth(5)).toHaveAttribute('data-status', 'no-terminal');
  await expect(runs.nth(5)).toContainText('No outcome is shown because none was received');
  // Durations are derived from offsets and say so.
  await expect(runs.nth(0).locator('[title="Derived from frame offsets, not received"]')).toBeVisible();
});

test('steps are collapsible timed groups, also with the keyboard', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'STEP_STARTED', stepName: 'plan' },
    { type: 'TEXT_MESSAGE_START', messageId: 'inside', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'inside', delta: 'inside the step' },
    { type: 'TEXT_MESSAGE_END', messageId: 'inside' },
    { type: 'STEP_FINISHED', stepName: 'plan' },
    { type: 'TEXT_MESSAGE_START', messageId: 'outside', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'outside', delta: 'after the step' },
  ]);
  const step = entry(page, 'step');
  await expect(step).toContainText('plan');
  await expect(step).toContainText('40 ms');
  await expect(step.getByText('inside the step')).toBeVisible();
  await expect(page.getByText('after the step')).toBeVisible();
  expect(await step.locator('[data-entry="message"]').count()).toBe(1);

  await step.locator('summary').first().focus();
  await page.keyboard.press('Enter');
  await expect(step.getByText('inside the step')).toBeHidden();
  await expect(page.getByText('after the step')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(step.getByText('inside the step')).toBeVisible();
});

test('reasoning streams, collapses, and an original chunk is labelled next to what it expanded into', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'REASONING_START', messageId: 'rs1' },
    { type: 'REASONING_MESSAGE_START', messageId: 'rs1', role: 'reasoning' },
    { type: 'REASONING_MESSAGE_CONTENT', messageId: 'rs1', delta: 'thinking about it' },
  ]);
  const reasoning = entry(page, 'reasoning');
  await expect(reasoning).toContainText('thinking about it');
  await expect(reasoning).toContainText('Streaming');
  await send(page, 'ex1', [{ type: 'REASONING_MESSAGE_END', messageId: 'rs1' }, { type: 'REASONING_END', messageId: 'rs1' }], 50);
  await expect(reasoning).not.toContainText('Streaming');
  await reasoning.locator('summary').first().click();
  await expect(reasoning.getByText('thinking about it')).toBeHidden();

  await send(page, 'ex1', [fx.TEXT_MESSAGE_CHUNK, fx.TOOL_CALL_CHUNK, FINISHED], 70);
  await expect(entry(page, 'message')).toContainText('from TEXT_MESSAGE_CHUNK');
  await expect(entry(page, 'tool')).toContainText('from TOOL_CALL_CHUNK');
  // The expansions are real derived entries, each linked to its chunk frame, and the chunks stay as received.
  const published = await page.evaluate(() => window.__conversation.publish());
  expect(published).toBe(6);
  const session = await page.evaluate(() => window.__conversation.session());
  expect(session.derived.every((derived) => derived.provenance === 'derived' && derived.derivation === 'chunk-expansion')).toBe(true);
  expect(session.derived.filter((derived) => derived.attribution === 'identified').every((derived) => derived.sources.length === 1)).toBe(true);
  expect(session.frames.filter((frame) => /_CHUNK$/.test(frame.eventType ?? '')).length).toBe(2);
  expect(await page.evaluate(() => window.__conversation.publish()), 'publishing again appends nothing').toBe(0);
});

test('encrypted reasoning shows subtype, entity and size, is never decoded, and its value is nowhere on the page', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, fx.REASONING_ENCRYPTED_VALUE]);
  const marker = entry(page, 'encrypted');
  await expect(marker).toContainText('Encrypted reasoning');
  await expect(marker).toContainText('message');
  await expect(marker).toContainText('rs1');
  await expect(marker).toContainText('24 bytes');
  await expect(marker).toContainText('not decoded');
  const html = await page.content();
  expect(html).not.toContain(fx.REASONING_ENCRYPTED_VALUE.encryptedValue);
  expect(html).not.toContain(Buffer.from(fx.REASONING_ENCRYPTED_VALUE.encryptedValue, 'base64').toString('utf8'));
  // The raw value is still evidence in the session; it simply is not part of this view.
  const session = await page.evaluate(() => window.__conversation.session());
  expect(session.frames.some((frame) => frame.data?.includes(fx.REASONING_ENCRYPTED_VALUE.encryptedValue))).toBe(true);
});

test('state updates live, lists each delta with its operations, and an unappliable delta keeps the last valid state', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, fx.STATE_SNAPSHOT]);
  const state = page.locator('[data-pane="state"]');
  await expect(state.getByLabel('Current state')).toContainText('"round": 0');
  await expect(state).toContainText('Sent as state in the next run');
  await send(page, 'ex1', [fx.STATE_DELTA], 30);
  await expect(state.getByLabel('Current state')).toContainText('"round": 1');
  const ops = state.getByRole('list', { name: 'Delta operations' }).first();
  await expect(ops).toContainText('add');
  await expect(ops).toContainText('/round');

  await send(page, 'ex1', [{ type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/nope', value: 1 }] }], 40);
  await expect(state).toContainText('not applied');
  await expect(state).toContainText('last valid one');
  await expect(state.getByLabel('Current state')).toContainText('"round": 1');
  // Nothing was lost: the failed delta is still a received, valid frame.
  const session = await page.evaluate(() => window.__conversation.session());
  expect(session.frames.filter((frame) => frame.eventType === 'STATE_DELTA').length).toBe(2);
  // And the conversation view shows no card for state events.
  await expect(page.locator('[data-pane="conversation"] [data-entry]')).toHaveCount(1);
});

test('a messages snapshot replaces the transcript behind a marker that lists what was added and removed', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [
    STARTED,
    { type: 'TEXT_MESSAGE_START', messageId: 'old', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'old', delta: 'about to be replaced' },
    { type: 'TEXT_MESSAGE_END', messageId: 'old' },
  ]);
  await expect(page.getByText('about to be replaced')).toBeVisible();
  await send(page, 'ex1', [fx.MESSAGES_SNAPSHOT], 50);
  const marker = entry(page, 'snapshot');
  await expect(marker).toContainText('Transcript replaced by MESSAGES_SNAPSHOT');
  await expect(marker).toContainText('2 added');
  await expect(marker).toContainText('1 removed');
  await expect(page.getByText('about to be replaced')).toBeHidden();
  await expect(page.locator('[data-pane="conversation"]').getByText('Synthetic request')).toBeVisible();
  await marker.getByText('Added and removed messages').click();
  await expect(marker.getByRole('list', { name: 'Removed messages' })).toContainText('about to be replaced');
  await expect(marker.getByRole('list', { name: 'Added messages' })).toContainText('u1');
});

test('subagents appear as nested markers linked to the parent run, and custom and raw events show their name or source and value', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [{ type: 'RUN_STARTED', threadId: 't1', runId: 'parent-run' }, fx.SUBAGENT_STARTED, fx.SUBAGENT_FINISHED, fx.SUBAGENT_ERROR, fx.CUSTOM, fx.RAW, FINISHED]);
  const nests = entry(page, 'subagent');
  await expect(nests).toHaveCount(2);
  await expect(nests.nth(0)).toContainText('synthetic-researcher');
  await expect(nests.nth(0)).toContainText('under run parent-run');
  await expect(nests.nth(0)).toContainText('via tool call tc1');
  await expect(nests.nth(0)).toContainText('started');
  await expect(nests.nth(0)).toContainText('finished');
  await expect(nests.nth(1)).toContainText('synthetic subagent failure');
  await expect(nests.nth(1)).toContainText('error');
  await expect(entry(page, 'custom')).toContainText('synthetic.custom');
  await expect(entry(page, 'custom')).toContainText('{"note":"custom"}');
  await expect(entry(page, 'raw')).toContainText('synthetic');
  await expect(entry(page, 'raw')).toContainText('{"provider":"synthetic"}');
});

test('activities update with each delta and can show a rendered form beside the JSON', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, fx.ACTIVITY_SNAPSHOT]);
  const activity = entry(page, 'activity');
  await expect(activity).toContainText('synthetic-progress');
  await expect(activity.getByLabel('Content of act1')).toContainText('"title": "Synthetic"');
  await expect(activity.getByRole('group', { name: 'Activity display' })).toHaveCount(0);
  await send(page, 'ex1', [fx.ACTIVITY_DELTA], 30);
  await expect(activity.getByLabel('Content of act1')).toContainText('"revision": 1');
  await expect(activity).toContainText('1 patch');
  await expect(entry(page, 'activity')).toHaveCount(1);

  await send(page, 'ex1', [{ type: 'ACTIVITY_SNAPSHOT', messageId: 'surface', activityType: 'rendered-demo', content: { a2ui_operations: [] } }], 40);
  const surface = entry(page, 'activity').nth(1);
  await expect(surface.getByTestId('rendered-activity')).toHaveText('Surface for surface');
  await surface.getByRole('button', { name: 'JSON' }).click();
  await expect(surface.getByTestId('rendered-activity')).toHaveCount(0);
  await expect(surface.getByLabel('Content of surface')).toContainText('a2ui_operations');
});

test('conversation text is plain: HTML does not run, Markdown stays literal', async ({ page, site }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page, site);
  await start(page, 'ex1');
  const payload = '<img src=x onerror="window.__pwned = 1"> **not bold** [link](https://example.test) <script>window.__pwned = 2</script>';
  await send(page, 'ex1', [STARTED, { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: payload }]);
  await expect(entry(page, 'message')).toHaveText(new RegExp(payload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  await expect(page.locator('[data-pane="conversation"] img, [data-pane="conversation"] script, [data-pane="conversation"] strong, [data-pane="conversation"] a')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a frame that is not a valid event adds nothing to the conversation and is reported only where it matters', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  await send(page, 'ex1', [STARTED, 'not json at all', { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ghost', delta: 7 }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ghost', delta: 'orphan' }, { type: 'SYNTHETIC_FUTURE_EVENT' }]);
  await expect(page.locator('[data-pane="conversation"] [data-entry]')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Projection issues' })).toContainText('never started');
  const session = await page.evaluate(() => window.__conversation.session());
  expect(session.frames.length, 'every frame is still retained').toBe(5);
});

test('the full baseline run presents every event family after its messages snapshot', async ({ page, site }) => {
  await open(page, site);
  await start(page, 'ex1');
  const order = ['RUN_STARTED', 'STEP_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'TEXT_MESSAGE_CHUNK', 'TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END', 'TOOL_CALL_RESULT', 'TOOL_CALL_CHUNK', 'REASONING_START', 'REASONING_MESSAGE_START', 'REASONING_MESSAGE_CONTENT', 'REASONING_MESSAGE_END', 'REASONING_MESSAGE_CHUNK', 'REASONING_ENCRYPTED_VALUE', 'REASONING_END', 'STATE_SNAPSHOT', 'STATE_DELTA', 'MESSAGES_SNAPSHOT', 'ACTIVITY_SNAPSHOT', 'ACTIVITY_DELTA', 'SUBAGENT_STARTED', 'SUBAGENT_ERROR', 'SUBAGENT_FINISHED', 'CUSTOM', 'RAW', 'STEP_FINISHED', 'RUN_FINISHED'] as const;
  await send(page, 'ex1', order.map((type) => fx[type]));
  await end(page, 'ex1');
  const conversation = page.locator('[data-pane="conversation"]');
  await expect(entry(page, 'run')).toHaveAttribute('data-status', 'finished');
  await expect(entry(page, 'snapshot')).toBeVisible();
  await expect(conversation.getByText('Synthetic request')).toBeVisible();
  await expect(entry(page, 'activity')).toContainText('"revision": 1');
  await expect(entry(page, 'subagent')).toHaveCount(2);
  await expect(entry(page, 'custom')).toBeVisible();
  await expect(entry(page, 'raw')).toBeVisible();
  await expect(page.locator('[data-pane="state"]').getByLabel('Current state')).toContainText('"round": 1');
  expect(await page.evaluate(() => window.__conversation.session().frames.length)).toBe(30);
});

test('the page requests nothing outside its own origin and raises no console errors, in light and dark', async ({ page, site }) => {
  const requests: string[] = [];
  const problems: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  page.on('pageerror', (error) => problems.push(error.message));
  for (const scheme of ['light', 'dark'] as const) {
    await open(page, site, scheme);
    await start(page, 'ex1');
    await send(page, 'ex1', [STARTED, fx.TEXT_MESSAGE_CHUNK, fx.TOOL_CALL_CHUNK, fx.REASONING_ENCRYPTED_VALUE, fx.ACTIVITY_SNAPSHOT, fx.SUBAGENT_STARTED, FINISHED]);
    await expect(entry(page, 'run')).toHaveAttribute('data-status', 'finished');
  }
  expect(requests.filter((url) => /\/fixture\.(js|css)$/.test(url)).length, 'own assets were observed').toBeGreaterThanOrEqual(4);
  expect(requests.filter((url) => !url.startsWith(`${site.origin}/`))).toEqual([]);
  expect(problems).toEqual([]);
});

test('the views take their colors, radius and fonts from the theme tokens, in both modes, and follow an override', async ({ page, site }) => {
  /** A probe element styled with a token expression, to compare what the browser computes. */
  const probe = (property: string, value: string) =>
    page.evaluate(([prop, expression]) => {
      const el = document.createElement('div');
      document.body.append(el);
      el.style.setProperty(prop as string, expression as string);
      const computed = getComputedStyle(el).getPropertyValue(prop as string);
      el.remove();
      return computed;
    }, [property, value]);
  const style = (selector: string, property: string) => page.evaluate(([sel, prop]) => getComputedStyle(document.querySelector(sel as string) as Element).getPropertyValue(prop as string), [selector, property]);
  const seed = async () => {
    await start(page, 'ex1');
    await send(page, 'ex1', [STARTED, FINISHED]);
    await page.evaluate(() => window.__conversation.open('ex2', { input: { threadId: 't1', runId: 'r2', messages: [{ id: 'u', role: 'user', content: 'hello' }] } }));
    await expect(page.locator('[data-role="user"] .agui-conv-body')).toBeVisible();
  };
  for (const scheme of ['light', 'dark'] as const) {
    await open(page, site, scheme);
    await seed();
    expect(await style('.agui-conv', 'color')).toBe(await probe('color', 'var(--fg)'));
    expect(await style('[data-role="user"] .agui-conv-body', 'background-color')).toBe(await probe('background-color', 'var(--sunk)'));
    expect(await style('[data-role="user"] .agui-conv-body', 'border-top-left-radius')).toBe(await probe('border-top-left-radius', 'var(--r)'));
    expect(await style('.agui-conv', 'font-family')).toBe(await probe('font-family', 'var(--agui-font-sans)'));
  }
  await page.addStyleTag({ url: `${site.origin}/override.css` });
  expect(await style('[data-role="user"] .agui-conv-body', 'border-top-left-radius')).toBe('22px');
  expect(await style('.agui-conv', 'font-family')).toContain('Courier New');
});
