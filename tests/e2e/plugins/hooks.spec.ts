// Spec 014 (FR-008 to FR-010, FR-016; story 3; SC-006, SC-007): a run hook in a real browser. What the hook returns is what
// the target receives and what the recording shows, and the reply's frames are recorded as received. A hook that throws stops
// the run before anything is sent. A raw request and an open recording never reach a hook.
import { AGENT_REPLY, expect, send, test } from '../hosted/support';
import { embeddedWith, exportedSession, footer, JS, loaded, runMessage, warningList } from './support';

const ADD = `let n = 0;\nexport default (api) => { api.beforeRun((run) => ({ ...run.input, forwardedProps: { ...run.input.forwardedProps, examplePlugin: { run: ++n } } })); };\n`;
// The scripted agent echoes the thread and run ids, which the page makes up for each run: they are the only text that differs.
const same = (text: string | undefined) => text?.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
const framesOf = (session: Awaited<ReturnType<typeof exportedSession>>['session']) => session.frames.map((frame) => [frame.eventType, same(frame.envelope), same(frame.data)]);

test('a hook that adds a property: the target receives it, the recording shows the same body, and the reply\'s frames equal those of a run with no plugin', async ({ page, openSite }) => {
  const withHook = await openSite(embeddedWith(['plugins/add.js'], { '/plugins/add.js': { type: JS, body: ADD } }));
  const without = await openSite(embeddedWith([], {}));

  await page.goto(withHook.page.origin);
  await expect(footer(page)).toContainText('1 plugin');
  await runMessage(page, 'hello');
  await runMessage(page, 'again', 2);
  const posts = withHook.page.seen.filter((entry) => entry.method === 'POST' && entry.path === '/agent');
  expect(posts.map((entry) => (JSON.parse(entry.body) as { forwardedProps: unknown }).forwardedProps)).toEqual([{ examplePlugin: { run: 1 } }, { examplePlugin: { run: 2 } }]);
  const exported = await exportedSession(page);
  const conversation = exported.session.exchanges.filter((exchange) => exchange.kind === 'conversation');
  expect(conversation.map((exchange) => exchange.requestBody)).toEqual(posts.map((entry) => entry.body));
  expect(exported.session.runs.map((run) => run.input.forwardedProps)).toEqual([{ examplePlugin: { run: 1 } }, { examplePlugin: { run: 2 } }]);

  await page.goto(without.page.origin);
  await runMessage(page, 'hello');
  await runMessage(page, 'again', 2);
  const plain = await exportedSession(page);
  expect(framesOf(exported.session), 'the frames are the same with and without the hook').toEqual(framesOf(plain.session));
  expect(exported.session.derived).toEqual(plain.session.derived);
  expect(exported.session.findings).toEqual(plain.session.findings);
  expect(plain.session.runs.map((run) => run.input.forwardedProps)).toEqual([{}, {}]);
});

test('a hook that throws stops the run before anything is sent, names the plugin, and the page works once the plugin is gone', async ({ page, openSite }) => {
  const files: Record<string, { type: string; body: string }> = { '/plugins/refuse.js': { type: JS, body: "export default (api) => api.beforeRun(() => { throw new Error('not on prod'); });" } };
  const site = await openSite(embeddedWith(['plugins/refuse.js'], files, { preset: { prepare: [{ method: 'POST', path: '/prepare', body: { threadId: '{{threadId}}', runId: '{{runId}}' } }] } }));
  await page.goto(site.page.origin);
  await send(page, 'hello');
  await expect(page.getByRole('alert').filter({ hasText: 'stopped the run in beforeRun: not on prod' })).toContainText('/plugins/refuse.js');
  expect(await warningList(page)).toEqual([['Plugin', '/plugins/refuse.js: beforeRun threw: not on prod']]);
  expect(site.page.seen.filter((entry) => entry.method === 'POST'), 'no preparation and no run').toEqual([]);
  await expect(footer(page)).toContainText('0 exchanges');
  await expect(page.getByText(AGENT_REPLY)).toHaveCount(0);

  files['/config.json'] = { type: 'application/json', body: JSON.stringify({ version: 0, agents: [{ id: 'support', url: '/agent' }] }) };
  await page.goto(site.page.origin);
  await runMessage(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
});

test('a hook that returns an input with another run id is refused like a failure', async ({ page, openSite }) => {
  const body = "export default (api) => api.beforeRun((run) => ({ ...run.input, runId: 'other' }));";
  const site = await openSite(embeddedWith(['plugins/ids.js'], { '/plugins/ids.js': { type: JS, body } }));
  await page.goto(site.page.origin);
  await send(page, 'hello');
  await expect(page.getByRole('alert')).toContainText('changed threadId or runId');
  expect(site.page.seen.filter((entry) => entry.method === 'POST')).toEqual([]);
});

test('a raw request is sent as typed and no hook sees it; an open recording sends nothing and calls no hook', async ({ page, openSite }) => {
  const count = `export default (api) => api.beforeRun(() => { document.documentElement.dataset.hookCalls = String(Number(document.documentElement.dataset.hookCalls ?? '0') + 1); });`;
  const site = await openSite(embeddedWith(['plugins/count.js'], { '/plugins/count.js': { type: JS, body: count } }));
  await page.goto(site.page.origin);
  const calls = () => page.evaluate(() => document.documentElement.dataset.hookCalls ?? '0');

  const raw = '{ "threadId" : "t-raw",\n  "runId": "r-raw" }';
  await page.getByRole('button', { name: 'Raw request', exact: true }).click();
  await page.getByRole('textbox', { name: 'Raw request body' }).fill(raw);
  await page.getByRole('button', { name: 'Send unchanged' }).click();
  await expect.poll(() => site.page.seen.filter((entry) => entry.path === '/agent').length).toBe(1);
  expect(site.page.seen.find((entry) => entry.path === '/agent')?.body).toBe(raw);
  expect(await calls()).toBe('0');

  const { text } = await exportedSession(page);
  await page.getByLabel('Session file to import').setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  const before = site.page.seen.length;
  // The composer is off while a recording is open, so a message cannot even be typed.
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(page.getByText('An imported recording is open')).toBeVisible();
  expect(site.page.seen.length, 'nothing was sent').toBe(before);
  expect(await calls()).toBe('0');
  expect(await loaded(page)).toBe('');
});
