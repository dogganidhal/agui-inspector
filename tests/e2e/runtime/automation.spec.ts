// Spec 004 (client automation, US1 to US3 and US5; SC-001 to SC-004, SC-007, SC-008): the profile answers a finished
// run's interrupts and client tool calls, and the next request is the one a developer's own reply sends. The page is
// the real runtime with the real reply cards and conversation view; the agent is the scripted reference agent. Every
// assertion about "what the next run carries" reads the bodies the agent recorded, and every test checks, through the
// shared fixture, that the page asked nobody but its own origin and the servers this file started.
import type { Page } from '@playwright/test';
import { INTERRUPT_FOREVER } from '../../../examples/reference-agent/interactive-scenarios.ts';
import { bodyOf, card, expect, messageBox, open, runs, send, session, settled, test, toolCard, type RunBody } from './support';

const TOOLS = [
  { name: 'pick_color', description: 'Pick a color', parameters: { type: 'object', properties: {} } },
  { name: 'pick_size', description: 'Pick a size', parameters: { type: 'object', properties: {} } },
];

const profile = (page: Page, patch: object): Promise<void> => page.evaluate((next) => window.__harness.setProfile(next as never), patch);
/** Back to answering by hand. `undefined` does not cross the page boundary, so the reset runs inside the page. */
const byHand = (page: Page): Promise<void> =>
  page.evaluate(() => window.__harness.setProfile({ interruptReply: undefined, interruptPayloads: undefined, toolResults: undefined }));

/** A request body with everything a new run generates replaced, so two bodies can be compared for equality. */
function shape(body: RunBody | undefined): unknown {
  assert(body !== undefined);
  let text = JSON.stringify(body);
  for (const [value, name] of [[body.threadId, 'THREAD'], [body.runId, 'RUN'], [body.parentRunId, 'PARENT']] as const) {
    if (value !== undefined) text = text.replaceAll(value, name);
  }
  // The preset's `user` variable is `u-` and a fresh uuid on every run.
  return JSON.parse(text.replace(/"id":"[^"]*"/g, '"id":"ID"').replace(/u-[0-9a-f-]{36}/g, 'USER'));
}

function assert(condition: boolean): asserts condition {
  expect(condition).toBe(true);
}

const conversation = (page: Page) => page.locator('[data-view="conversation"]');
const quick = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const resumed = (text: string) => `Resumed with ${text}`;

// ---------------------------------------------------------------------------------------------
// US1: interrupts
// ---------------------------------------------------------------------------------------------

test('resolve: the interrupt scenario continues by itself and the next request is the one a manual Resolve sends', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { interruptReply: 'resolve' });
  await quick(page, 'interrupt').click();

  await expect.poll(() => runs(site).length).toBe(2);
  await expect(page.getByText(resumed('i-approve=resolved:{"approved":false,"note":""}, i-contact=resolved:{}'))).toBeVisible();
  await expect(page.locator('[data-view="replies"]'), 'no card stays open: nobody had to click').toHaveCount(0);
  const [first, automatic] = runs(site).map(bodyOf);
  expect(automatic?.parentRunId).toBe(first?.runId);
  expect(automatic?.messages.filter((message) => message.role === 'user').map((message) => message.content), 'a resume adds no user message').toEqual(['interrupt']);

  // The same scenario answered by hand, in a thread of its own, with the buttons and no edit.
  await byHand(page);
  await page.getByRole('button', { name: 'New thread' }).click();
  await quick(page, 'interrupt').click();
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await page.getByRole('button', { name: 'Resolve interrupt i-contact' }).click();
  await expect.poll(() => runs(site).length).toBe(4);
  expect(shape(bodyOf(runs(site)[3]))).toEqual(shape(automatic));
});

test('cancel: every interrupt is cancelled with no payload, as the Cancel buttons send it', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { interruptReply: 'cancel' });
  await quick(page, 'interrupt').click();

  await expect.poll(() => runs(site).length).toBe(2);
  await expect(page.getByText(resumed('i-approve=cancelled, i-contact=cancelled'))).toBeVisible();
  const automatic = bodyOf(runs(site)[1]);
  expect(automatic?.resume).toEqual([
    { interruptId: 'i-approve', status: 'cancelled' },
    { interruptId: 'i-contact', status: 'cancelled' },
  ]);

  await byHand(page);
  await page.getByRole('button', { name: 'New thread' }).click();
  await quick(page, 'interrupt').click();
  await page.getByRole('button', { name: 'Cancel interrupt i-approve' }).click();
  await page.getByRole('button', { name: 'Cancel interrupt i-contact' }).click();
  await expect.poll(() => runs(site).length).toBe(4);
  expect(shape(bodyOf(runs(site)[3]))).toEqual(shape(automatic));
});

test('resolve with a payload for the reason: the agent receives it as written, also when it misses the response schema', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { interruptReply: 'resolve', interruptPayloads: { approval: { approved: true, note: 'auto' } } });
  await quick(page, 'interrupt').click();

  await expect.poll(() => runs(site).length).toBe(2);
  await expect(page.getByText(resumed('i-approve=resolved:{"approved":true,"note":"auto"}, i-contact=resolved:{}'))).toBeVisible();
  const automatic = bodyOf(runs(site)[1]);

  // A developer who types the same JSON into the editor sends the same request.
  await byHand(page);
  await page.getByRole('button', { name: 'New thread' }).click();
  await quick(page, 'interrupt').click();
  await page.getByLabel('Answer for interrupt i-approve').fill('{"approved": true, "note": "auto"}');
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await page.getByRole('button', { name: 'Resolve interrupt i-contact' }).click();
  await expect.poll(() => runs(site).length).toBe(4);
  expect(shape(bodyOf(runs(site)[3]))).toEqual(shape(automatic));

  // The schema says approved is a boolean. The payload is sent anyway, and the run continues.
  await page.getByRole('button', { name: 'New thread' }).click();
  await profile(page, { interruptReply: 'resolve', interruptPayloads: { approval: { approved: 'yes' } } });
  await quick(page, 'interrupt').click();
  await expect.poll(() => runs(site).length).toBe(6);
  expect(bodyOf(runs(site)[5])?.resume?.[0]).toEqual({ interruptId: 'i-approve', status: 'resolved', payload: { approved: 'yes' } });
  await expect(page.getByText(resumed('i-approve=resolved:{"approved":"yes"}, i-contact=resolved:{}'))).toBeVisible();
});

test('without an interrupt reply nothing is answered, whatever else the profile holds', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { interruptPayloads: { approval: { approved: true } }, tools: TOOLS, toolResults: { pick_color: 'teal' } });
  await quick(page, 'interrupt').click();
  await expect(card(page, 'i-approve')).toHaveAttribute('data-status', 'unanswered');
  await page.waitForTimeout(150);
  expect(runs(site), 'waiting costs nothing and sends nothing').toHaveLength(1);
  await expect(page.getByText('2 interrupts waiting. Answer them to continue the run.')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// US2: client tool calls
// ---------------------------------------------------------------------------------------------

test('scripted results: both tool calls are answered as written and the next request is the one typed results send', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { tools: TOOLS, toolResults: { pick_color: 'teal', pick_size: '{"size":2}' } });
  await quick(page, 'tools').click();

  await expect.poll(() => runs(site).length).toBe(2);
  await expect(page.getByText('Tool results: c-color=teal, c-size={"size":2}')).toBeVisible();
  const automatic = bodyOf(runs(site)[1]);
  expect(automatic?.messages.filter((message) => message.role === 'tool').map((message) => [message.toolCallId, message.content])).toEqual([
    ['c-color', 'teal'],
    ['c-size', '{"size":2}'],
  ]);
  expect(automatic?.resume).toBeUndefined();

  await byHand(page);
  await page.getByRole('button', { name: 'New thread' }).click();
  await quick(page, 'tools').click();
  await page.getByLabel('Result for pick_color (c-color)').fill('teal');
  await page.getByRole('button', { name: 'Submit result for c-color' }).click();
  await page.getByLabel('Result for pick_size (c-size)').fill('{"size":2}');
  await page.getByRole('button', { name: 'Submit result for c-size' }).click();
  await expect.poll(() => runs(site).length).toBe(4);
  expect(shape(bodyOf(runs(site)[3]))).toEqual(shape(automatic));
});

test('a mixed run: the scripted call is answered, the other waits, and the developer\'s last result starts the continuation', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { tools: TOOLS, toolResults: { pick_color: 'teal' } });
  await quick(page, 'tools').click();

  await expect(toolCard(page, 'c-color')).toHaveAttribute('data-status', 'answered');
  await expect(toolCard(page, 'c-color')).toContainText('Automatic');
  await expect(toolCard(page, 'c-size')).toHaveAttribute('data-status', 'pending');
  await expect(toolCard(page, 'c-size')).not.toContainText('Automatic');
  await expect(page.getByText('1 tool call waiting for a result. Enter it to continue the run.')).toBeVisible();
  await page.waitForTimeout(150);
  expect(runs(site)).toHaveLength(1);

  await page.getByLabel('Result for pick_size (c-size)').fill('by hand');
  await page.getByRole('button', { name: 'Submit result for c-size' }).click();
  await expect.poll(() => runs(site).length).toBe(2);
  expect(bodyOf(runs(site)[1])?.messages.filter((message) => message.role === 'tool').map((message) => [message.toolCallId, message.content])).toEqual([
    ['c-color', 'teal'],
    ['c-size', 'by hand'],
  ]);
});

// ---------------------------------------------------------------------------------------------
// US3: the marks
// ---------------------------------------------------------------------------------------------

test('the conversation says which replies were automatic, the wire does not, and a reply by hand carries no mark', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { interruptReply: 'resolve', tools: TOOLS, toolResults: { pick_color: 'teal' } });
  await quick(page, 'interrupt').click();
  await expect.poll(() => runs(site).length).toBe(2);
  await expect(conversation(page)).toContainText('automatic · i-approve, i-contact');

  // The tools run: one result is scripted, the other typed.
  await page.getByRole('button', { name: 'New thread' }).click();
  await quick(page, 'tools').click();
  await page.getByLabel('Result for pick_size (c-size)').fill('by hand');
  await page.getByRole('button', { name: 'Submit result for c-size' }).click();
  await expect.poll(() => runs(site).length).toBe(4);
  await expect(conversation(page)).toContainText('automatic · c-color');
  await expect(conversation(page).getByText(/Result · automatic/)).toHaveCount(1);
  await expect(conversation(page).getByText(/Result · entered by you/)).toHaveCount(1);

  const recorded = await settled(page, 4);
  expect(recorded.runs[0]).not.toHaveProperty('automaticReplies');
  expect(recorded.runs[1]).toHaveProperty('automaticReplies', { interruptIds: ['i-approve', 'i-contact'], toolCallIds: [] });
  expect(recorded.runs[3]).toHaveProperty('automaticReplies', { interruptIds: [], toolCallIds: ['c-color'] });
  for (const request of runs(site)) expect(JSON.stringify(request.body), 'no request says a reply was automatic').not.toMatch(/automatic/i);

  // A reply given by hand has no mark.
  await byHand(page);
  await page.getByRole('button', { name: 'New thread' }).click();
  await quick(page, 'interrupt').click();
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await page.getByRole('button', { name: 'Cancel interrupt i-contact' }).click();
  await expect.poll(() => runs(site).length).toBe(6);
  await expect(conversation(page)).toContainText('Carried:');
  await expect(conversation(page)).not.toContainText('automatic');
  expect((await session(page)).runs[5]).not.toHaveProperty('automaticReplies');
});

// ---------------------------------------------------------------------------------------------
// US5: the limit
// ---------------------------------------------------------------------------------------------

test('an agent that interrupts forever gets the first run and 10 automatic continuations, then waits; an answer carries on', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await profile(page, { interruptReply: 'resolve' });
  await send(page, INTERRUPT_FOREVER);

  await expect.poll(() => runs(site).length).toBe(11);
  const waiting = page.locator('[data-entry="interrupt"][data-status="unanswered"]');
  await expect(waiting).toHaveCount(1);
  await expect(page.getByText('Automatic replies paused after 10 in a row. Answer by hand to continue the run.')).toBeVisible();
  await expect(messageBox(page)).toBeDisabled();
  await page.waitForTimeout(200);
  expect(runs(site), 'it does not start again on its own').toHaveLength(11);

  // One answer by hand starts the count again.
  await waiting.getByRole('button', { name: /^Resolve interrupt/ }).click();
  await expect.poll(() => runs(site).length).toBe(22);
  await expect(page.getByText('Automatic replies paused after 10 in a row. Answer by hand to continue the run.')).toBeVisible();

  // A new thread leaves the pause behind.
  await page.getByRole('button', { name: 'New thread' }).click();
  await expect(page.getByText('Automatic replies paused after 10 in a row.')).toHaveCount(0);
  await expect(messageBox(page)).toBeEnabled();
});

test('a by-hand profile is never paused and never answered, even by an agent that asks forever', async ({ page, servers }) => {
  const { site } = servers;
  await open(page, servers, { agent: 'support' });
  await send(page, INTERRUPT_FOREVER);
  await expect(page.locator('[data-entry="interrupt"][data-status="unanswered"]')).toHaveCount(1);
  await page.waitForTimeout(150);
  expect(runs(site)).toHaveLength(1);
  await expect(page.getByText('Automatic replies paused')).toHaveCount(0);
});
