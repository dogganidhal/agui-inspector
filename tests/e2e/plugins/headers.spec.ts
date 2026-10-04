// Spec 014 (FR-011 to FR-013; story 2; SC-005): a header provider in a real browser. The target receives a header that
// differs on every request, on the preparation, the run and a raw request. The value is in no place the inspector writes: the
// exported session, the page's text, the browser storage. A header the developer typed wins, a provider that fails stops the
// request, and the encoding keeps `Accept`.
import type { Page } from '@playwright/test';
import { AGENT_REPLY, SYNTHETIC_TOKEN, expect, send, test, type Seen } from '../hosted/support';
import { embeddedWith, exportedSession, footer, hostedWith, JS, loaded, warningList } from './support';

const VALUE = '7f3a91';
/** A provider whose value changes on every call and holds a recognizable text. */
const SIGN = `let n = 0;\nexport default (api) => { api.provideHeaders(() => ({ 'X-Synthetic-Signature': 'sig-' + (++n) + '-${VALUE}' })); };\n`;
const PREPARE = { preset: { prepare: [{ method: 'POST', path: '/prepare', body: { threadId: '{{threadId}}', runId: '{{runId}}' } }] } };

const header = (seen: Seen | undefined) => seen?.headers?.['x-synthetic-signature'];
const rawTab = (page: Page) => page.getByRole('button', { name: 'Raw request', exact: true });

async function sendRaw(page: Page, text: string): Promise<void> {
  await rawTab(page).click();
  await page.getByRole('textbox', { name: 'Raw request body' }).fill(text);
  await page.getByRole('button', { name: 'Send unchanged' }).click();
}

for (const mode of ['hosted', 'embedded'] as const) {
  test(`${mode}: the target gets a different header on the preparation, the run and a raw request, and the value is kept nowhere`, async ({ page, openSite }) => {
    const files = { '/plugins/sign.js': { type: JS, body: SIGN } };
    const site = await openSite(mode === 'hosted' ? hostedWith(['plugins/sign.js'], files, (origin) => ({ id: 'support', url: `${origin}/agent`, ...PREPARE })) : embeddedWith(['plugins/sign.js'], files, PREPARE));
    const seen = () => (mode === 'hosted' ? site.agent.seen : site.page.seen.filter((entry) => entry.method === 'POST'));
    await page.goto(site.page.origin);
    await expect(footer(page)).toContainText('1 plugin');

    await send(page, 'hello');
    await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
    const prepare = seen().find((entry) => entry.path === '/prepare');
    const run = seen().find((entry) => entry.path === '/agent');
    expect(header(prepare)).toBe(`sig-1-${VALUE}`);
    expect(header(run)).toBe(`sig-2-${VALUE}`);

    const raw = '{ "threadId" : "t-raw", "runId": "r-raw" }';
    await sendRaw(page, raw);
    await expect.poll(() => seen().filter((entry) => entry.path === '/agent').length).toBe(2);
    const sentRaw = seen().filter((entry) => entry.path === '/agent')[1];
    expect(sentRaw?.body, 'the raw body is the typed text').toBe(raw);
    // The provider is asked again for the raw request: the counter has moved on past the preparation and the run.
    expect(header(sentRaw)).toMatch(new RegExp(`^sig-([3-9]|[1-9][0-9])-${VALUE}$`));

    // The footer still says so, and nothing the inspector writes holds the value.
    await expect(footer(page)).toContainText('headers never recorded');
    const { text, session } = await exportedSession(page);
    expect(text).not.toContain(VALUE);
    expect(text.toLowerCase()).not.toContain('x-synthetic-signature');
    expect(Object.keys(session.exchanges[0] ?? {})).not.toContain('headers');
    expect(await page.locator('body').innerText()).not.toContain(VALUE);
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, title: document.title }))).not.toContain(VALUE);
    expect(await page.content()).not.toContain(VALUE);
  });
}

test('a token typed in the page for the same header name reaches the target in place of the provider\'s', async ({ page, openSite }) => {
  const site = await openSite(embeddedWith(['plugins/sign.js'], { '/plugins/sign.js': { type: JS, body: SIGN } }));
  await page.goto(site.page.origin);
  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Header name' }).fill('X-Synthetic-Signature');
  await page.getByRole('textbox', { name: 'Token' }).fill(SYNTHETIC_TOKEN);
  await page.keyboard.press('Escape');
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  const run = site.page.seen.find((entry) => entry.method === 'POST' && entry.path === '/agent');
  expect(header(run)).toBe(SYNTHETIC_TOKEN);
});

test('a provider that throws, or returns Content-Type, Accept or a value with a line break, stops the run with a message, one warning and no exchange', async ({ page, openSite }) => {
  const cases: Array<[string, string, RegExp]> = [
    ['throws', "export default (api) => { api.provideHeaders(() => { throw new Error('no key today'); }); };", /could not provide headers: no key today/],
    ['type', "export default (api) => { api.provideHeaders(() => ({ 'Content-Type': 'text/html' })); };", /"Content-Type"/],
    ['accept', "export default (api) => { api.provideHeaders(() => ({ accept: 'text/html' })); };", /"accept"/],
    ['newline', "export default (api) => { api.provideHeaders(() => ({ 'X-A': 'one\\r\\ntwo' })); };", /"X-A"/],
  ];
  for (const [name, body, text] of cases) {
    const site = await openSite(embeddedWith([`plugins/${name}.js`], { [`/plugins/${name}.js`]: { type: JS, body } }));
    await page.goto(site.page.origin);
    await send(page, 'hello');
    await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(`/plugins/${name}.js`);
    expect(await warningList(page)).toHaveLength(1);
    expect((await warningList(page))[0]?.[0]).toBe('Plugin');
    expect(site.page.seen.filter((entry) => entry.method === 'POST'), name).toEqual([]);
    await expect(footer(page)).toContainText('0 exchanges');
    expect(await loaded(page), name).toBe('');
  }
});
