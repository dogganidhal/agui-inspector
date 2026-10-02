// L04 T035 (FR-033; SC-006; US5.2): the raw request editor in a real browser. The scripted agent
// records the bytes it receives, so "sent unchanged" is a comparison of strings, not an assumption.
import { expect, expectAllowlisted, open, snapshot, test } from './support.ts';

const rawTab = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Raw request', exact: true });
const editor = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Raw request body' });
const send = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Send unchanged' });

test.beforeEach(async ({ page, site }) => {
  await open(page, site);
  await rawTab(page).click();
});

test('a schema-invalid document is flagged, sent exactly as typed, and the server error is inspectable', async ({ page, site, network }) => {
  const text = '{ "threadId" :17 }';
  await editor(page).fill(text);
  await expect(page.getByText('Not a valid run input')).toBeVisible();
  await expect(page.getByText('It will still be sent as written.')).toBeVisible();
  await expect(editor(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(send(page)).toBeEnabled();

  await send(page).click();

  // The agent received the entered text, character for character, and nothing else.
  await expect.poll(() => site.received.filter((request) => request.path === '/agent').length).toBe(1);
  expect(site.received.find((request) => request.path === '/agent')!.body).toBe(text);

  // The view moves to Frames, where the reply is an expanded raw exchange with its error body.
  const header = page.locator('[data-exchange-header]').first();
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await expect(header).toContainText('POST');
  await expect(header).toContainText('/agent');
  await expect(header).toContainText('raw');
  await expect(header).toContainText('422');
  await expect(page.getByText('Raw body, sent unchanged')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Request body' })).toHaveText(text);
  await expect(page.getByRole('region', { name: 'Response body' })).toContainText('threadId and runId must be strings');

  const session = await snapshot(page);
  expect(session.exchanges).toHaveLength(1);
  expect(session.exchanges[0]).toMatchObject({ kind: 'raw', status: 422, requestBody: text });
  // Outside the conversation: no run, no preparation, no other request.
  expect(session.runs).toEqual([]);
  expect(site.received).toHaveLength(1);
  expectAllowlisted(network, site);
});

test('whitespace, key order, duplicate keys and numbers go out untouched', async ({ page, site }) => {
  // A textarea reports line breaks as LF whatever the platform; every other character is kept.
  const text = '\n  {"runId":"r-1",\n\t"threadId":"t-1", "a":1,"a":2,"big":12345678901234567890,"f":1.0, "state":{},"messages":[],"tools":[],"context":[],"forwardedProps":{}}  \n\n';
  await editor(page).fill(text);
  await expect(page.getByText('Valid run input')).toBeVisible();
  await send(page).click();
  await expect.poll(() => site.received.length).toBe(1);
  expect(site.received[0]!.body).toBe(text);
  // A valid input gets a normal event-stream answer, recorded as frames of the raw exchange.
  await expect(page.locator('[data-exchange-header]').first()).toContainText('200');
  await expect(page.locator('[data-frame-row]').first()).toContainText('RUN_STARTED');
  await expect(page.getByTestId('frames')).toHaveAttribute('data-frame-total', '5');
});

test('invalid syntax is an error, blocks sending, and nothing leaves the page', async ({ page, site }) => {
  for (const text of ['{"threadId":', '{"a":}', 'undefined', '']) {
    await editor(page).fill(text);
    await expect(send(page)).toBeDisabled();
    if (text !== '') {
      await expect(page.getByText('Not valid JSON')).toBeVisible();
      await expect(editor(page)).toHaveAttribute('aria-invalid', 'true');
    }
  }
  // Even forcing the click does nothing: the button is disabled and the handler refuses invalid text.
  await send(page).click({ force: true });
  await page.waitForTimeout(150);
  expect(site.received).toEqual([]);
  expect((await snapshot(page)).exchanges).toHaveLength(0);

  // Fixing the text re-enables it.
  await editor(page).fill('{"threadId":"t","runId":"r"}');
  await expect(send(page)).toBeEnabled();
  await expect(page.getByText('Not valid JSON')).toHaveCount(0);
});

test('any JSON document can be sent, and a server that refuses it is shown as it answered', async ({ page, site }) => {
  await editor(page).fill('[1, 2,3]');
  await expect(page.getByText('not a JSON object')).toBeVisible();
  await send(page).click();
  await expect.poll(() => site.received.length).toBe(1);
  expect(site.received[0]!.body).toBe('[1, 2,3]');
  await expect(page.locator('[data-exchange-header]').first()).toContainText('422');
});

test('the editor keeps its text and sends again; each send is its own exchange, newest first', async ({ page, site }) => {
  await editor(page).fill('{"threadId":1}');
  await send(page).click();
  await expect(page.locator('[data-exchange-header]')).toHaveCount(1);
  await rawTab(page).click();
  await expect(editor(page)).toHaveValue('{"threadId":1}');
  await editor(page).fill('{"threadId":"t","runId":"r"}');
  await send(page).click();
  await expect(page.locator('[data-exchange-header]')).toHaveCount(2);
  await expect(page.locator('[data-exchange-header]').first()).toContainText('200');
  await expect(page.locator('[data-exchange-header]').nth(1)).toContainText('422');
  expect(site.received.map((request) => request.body)).toEqual(['{"threadId":1}', '{"threadId":"t","runId":"r"}']);
});

test('a send that cannot reach the target is reported on the page and recorded as failed', async ({ page, site }) => {
  // Nothing listens on this port, so the browser's fetch fails like a refused connection.
  await page.evaluate(() => (window as unknown as { __host: { setTarget(url: string): void } }).__host.setTarget('http://127.0.0.1:1'));
  await editor(page).fill('{"threadId":"t","runId":"r"}');
  await send(page).click();
  await expect(page.getByRole('alert')).toContainText('The request could not be sent');
  await expect(page.locator('[data-exchange-header]').first()).toContainText('failed');
  await expect(page.locator('[data-exchange-header]').first()).toContainText('1 issue');
  expect(site.received).toEqual([]);
});

test('the raw editor is reachable and operable by keyboard', async ({ page, site }) => {
  await editor(page).focus();
  await page.keyboard.insertText('{"threadId":"t","runId":"r"}');
  await page.keyboard.press('Tab');
  await expect(send(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => site.received.length).toBe(1);
});
