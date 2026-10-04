// FX12 (US1, FR-004): the demo's A2UI showcase in a real browser, with the real service worker and the real
// renderer. The page under test is the isolated demo build, served under `/agui-inspector/` from one loopback
// origin. Each story is played by clicking what a visitor would click: the surfaces are drawn by the renderer,
// the actions go out as ordinary runs, and the session that is exported afterwards is compared with what the
// shared producers generate for the requests the page really sent. What a story must not do, such as
// rebuilding a surface a visitor has typed into or reaching an address, is checked on the page itself.
//
// Every test starts in a fresh browser context: no controller, no storage, nothing cached.
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { pace } from '../../../examples/reference-agent/pacing.ts';
import { a2uiResponse, type RunInput, type ScenarioResponse } from '../../../examples/reference-agent/scenarios.ts';
import { buildDemo } from '../../../scripts/build-demo.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const BASE_PATH = '/agui-inspector/';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const FILES = new Set(['index.html', 'app.js', 'app.css', 'bootstrap.js', 'demo.css', 'hosting-config.json', 'examples.json', 'service-worker.js']);

interface Site {
  readonly origin: string;
  readonly base: string;
  /** Every request the page's own server received. The worker answers the example routes, so none of those arrive. */
  readonly requests: Array<{ method: string; path: string }>;
}

const listen = (server: Server, port = 0) => new Promise<number>((resolve) => server.listen(port, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

const test = base.extend<{ requested: string[] }, { site: Site }>({
  site: [
    async ({}, use) => {
      // The build names the origin the page is served from, so a port nothing is using is found first.
      const probe = createServer();
      const port = await listen(probe);
      await new Promise((resolve) => probe.close(resolve));
      const origin = `http://127.0.0.1:${port}`;
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const dir = mkdtempSync(path.join(root, '.build', 'public-demo-a2ui-e2e-'));
      await buildDemo({ outdir: dir, basePath: BASE_PATH, origin });
      const site: Site = { origin, base: `${origin}${BASE_PATH}`, requests: [] };
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://x');
        site.requests.push({ method: request.method ?? '', path: url.pathname });
        const name = url.pathname.startsWith(BASE_PATH) ? url.pathname.slice(BASE_PATH.length) || 'index.html' : undefined;
        if (request.method === 'GET' && name !== undefined && FILES.has(name)) {
          response.writeHead(200, { 'content-type': TYPES[path.extname(name)] ?? 'text/plain', 'cache-control': 'no-cache' });
          return void response.end(readFileSync(path.join(dir, name)));
        }
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
      });
      await listen(server, port);
      await use(site);
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      rmSync(dir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  // Every URL the page requests, by the browser's own account, worker-answered ones included.
  requested: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await use(urls);
  },
});

// ---------------------------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------------------------

const messageBox = (page: Page) => page.getByLabel('Message', { exact: true });
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });
const quick = (page: Page, text: string) => page.getByRole('button', { name: text, exact: true });
const surface = (page: Page, id: string) => page.locator(`[data-surface="${id}"]`);
/** The transcript, apart from the frames list, which quotes events word by word. */
const conversation = (page: Page) => page.locator('[data-view="conversation"]');
/** A tab and the close button of a modal are drawn by the renderer's components, which a restyle may rebuild: match either. */
const tab = (scope: Locator, name: string) => scope.getByRole('tab', { name, exact: true }).or(scope.getByRole('button', { name, exact: true }));
const closeModal = (page: Page) => page.locator('.a2ui-modal-close, .agui-a2ui-modal-close');
/** A paced story takes a few seconds to arrive; the default wait is for things that are already there. */
const LONG = { timeout: 15_000 };

/** Opens the demo and chooses the A2UI showcase from the picker in Settings. */
async function openShowcase(page: Page, site: Site): Promise<void> {
  await page.goto(site.base);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /\(browser-local example\)/ }).first().click();
  await page.getByRole('button', { name: /A2UI showcase.*browser-local example/ }).last().click();
  await page.getByRole('button', { name: 'Inspection', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Endpoint URL' })).toHaveValue(`${site.base}__demo__/agent/a2ui`);
}

/** The run has ended: nothing streams and the composer takes a message again. */
async function idle(page: Page): Promise<void> {
  await expect(stopButton(page)).toBeDisabled(LONG);
  await expect(messageBox(page)).toBeEnabled();
}

interface Session {
  exchanges: Array<{ id: string; kind: string; path: string; status?: number; transport: string; requestBody?: string }>;
  frames: Array<{ exchangeId: string; index: number; envelope: string; eventType?: string; schemaVerdict: string; jsonVerdict: string }>;
  runs: Array<{ outcome: { kind: string } }>;
  findings: Array<{ kind: string }>;
}

type Event = { type: string; [key: string]: unknown };

/** The session as the user would save it, read from the real export. */
async function exportSession(page: Page): Promise<Session> {
  await page.getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('can contain personal or sensitive data');
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export session' }).click()]);
  return (JSON.parse(readFileSync((await download.path())!, 'utf8')) as { session: Session }).session;
}

const conversations = (session: Session) => session.exchanges.filter((exchange) => exchange.kind === 'conversation');
const framesOf = (session: Session, exchangeId: string) => session.frames.filter((frame) => frame.exchangeId === exchangeId).sort((a, b) => a.index - b.index);
const eventsOf = (session: Session, exchangeId: string): Event[] => framesOf(session, exchangeId).map((frame) => JSON.parse(frame.envelope.replace(/^data: /, '').trim()) as Event);
const runBody = (exchange: { requestBody?: string }) => JSON.parse(exchange.requestBody ?? '') as RunInput & { forwardedProps?: { a2uiAction?: { userAction: { name: string; surfaceId: string; sourceComponentId: string; context: Record<string, unknown> } } } };
const userAction = (exchange: { requestBody?: string }) => runBody(exchange).forwardedProps?.a2uiAction?.userAction;
const contentOf = (event: Event) => event['content'] as Record<string, unknown>;

/** What the worker serves for the run input the page actually sent: the shared producer's answer, paced as the worker paces it. */
const produced = (exchange: { requestBody?: string }): ScenarioResponse => pace(a2uiResponse(JSON.parse(exchange.requestBody ?? '') as RunInput));

/** Every run is answered with exactly the bytes the producer generates for its request, and the reader found nothing wrong. */
function expectCleanSession(session: Session): void {
  expect(conversations(session).length).toBeGreaterThan(0);
  for (const exchange of conversations(session)) {
    expect(exchange.status, exchange.path).toBe(200);
    expect(
      framesOf(session, exchange.id)
        .map((frame) => frame.envelope)
        .join(''),
      `bytes of ${exchange.path}`,
    ).toBe(new TextDecoder().decode(Buffer.concat(produced(exchange).chunks)));
    for (const frame of framesOf(session, exchange.id)) expect([frame.jsonVerdict, frame.schemaVerdict]).toEqual(['valid', 'valid']);
  }
  expect(session.findings, 'no finding on any frame, run or exchange').toEqual([]);
}

/** After each test: the page asked its own origin for the demo's files and nothing else, and nothing was posted to it. */
function expectNothingLeft(requested: readonly string[], site: Site): void {
  const outside = requested.filter((url) => !url.startsWith(`${site.origin}/`) && !url.startsWith('data:') && !url.startsWith('blob:') && url !== 'about:blank');
  expect(outside, 'requests outside the demo origin').toEqual([]);
  expect(site.requests.filter((request) => request.method !== 'GET'), 'no POST or PUT ever reached the static host').toEqual([]);
}

// ---------------------------------------------------------------------------------------------
// The stories
// ---------------------------------------------------------------------------------------------

test('find a table: results, a booking beside them and a confirmation, through real clicks, with each action context in the request', async ({ page, site, requested }) => {
  await openShowcase(page, site);
  await quick(page, 'Find a table for 4').click();
  await expect(page.getByRole('heading', { name: 'Tables for 4 tonight' })).toBeVisible();
  await expect(surface(page, 'results').getByRole('button', { name: 'Book', exact: true })).toHaveCount(3);
  await idle(page);

  // Book the second card: the booking opens beside the results, which stay.
  await surface(page, 'results').getByRole('button', { name: 'Book', exact: true }).nth(1).click();
  await expect(page.getByRole('heading', { name: 'Book Casa Verde' })).toBeVisible();
  await expect(surface(page, 'results')).toBeVisible();
  await idle(page);

  // Confirm checks the form: it needs the policy accepted and a table of 1 to 8.
  const confirm = surface(page, 'booking').getByRole('button', { name: 'Confirm booking' });
  const guests = surface(page, 'booking').getByRole('spinbutton', { name: 'Guests' });
  await expect(confirm).toBeDisabled();
  await surface(page, 'booking').getByRole('checkbox', { name: /cancellation policy/ }).check();
  await expect(confirm).toBeEnabled();
  await guests.fill('12');
  await expect(confirm).toBeDisabled();
  await guests.fill('6');
  await expect(confirm).toBeEnabled();
  await surface(page, 'booking').getByRole('button', { name: 'Terrace', exact: true }).click();
  await confirm.click();

  // Both surfaces are deleted; the confirmation is formatted by the renderer from what the form held.
  await expect(page.getByRole('heading', { name: 'Table booked at Casa Verde' })).toBeVisible();
  await expect(page.getByText('Saturday 17 October at 19:30', { exact: true })).toBeVisible();
  await expect(page.getByText('6 guests · Terrace', { exact: true })).toBeVisible();
  await expect(page.getByText('Deposit €48.00', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Reference TB-[0-9A-Z]{4}$/)).toBeVisible();
  await expect(page.locator('[data-surface]')).toHaveCount(1);
  await expect(surface(page, 'confirmation')).toBeVisible();
  await idle(page);

  // The request each action went out with carries its resolved context, and the Frames view shows it.
  const context = page.locator('details.agui-fr-req').filter({ hasText: 'a2uiAction' }).first();
  await context.locator('summary').click();
  const shown = page.getByRole('region', { name: 'Request body' });
  await expect(shown).toContainText('"name": "confirm_booking"');
  await expect(shown).toContainText('"restaurantId": "r-verde"');
  await expect(shown).toContainText('"guests": "6"');

  const session = await exportSession(page);
  expectCleanSession(session);
  const [first, book, confirmed] = conversations(session);
  expect(session.runs).toHaveLength(3);
  expect(userAction(first!)).toBeUndefined();
  expect(userAction(book!)).toMatchObject({
    name: 'book_table',
    surfaceId: 'results',
    sourceComponentId: 'result-book',
    // restaurantId, restaurant and time come from the card (template scope), party from the surface's data model.
    context: { restaurantId: 'r-verde', restaurant: 'Casa Verde', time: '20:00', party: 4 },
  });
  expect(userAction(confirmed!)).toMatchObject({
    name: 'confirm_booking',
    surfaceId: 'booking',
    sourceComponentId: 'booking-confirm',
    context: { restaurantId: 'r-verde', restaurant: 'Casa Verde', guests: '6', when: '2026-10-17T19:30', seating: ['terrace'], terms: true },
  });
  // One activity, replaced in place by each run.
  const ids = [first!, book!, confirmed!].flatMap((exchange) => eventsOf(session, exchange.id).filter((event) => event.type === 'ACTIVITY_SNAPSHOT').map((event) => event['messageId']));
  expect(new Set(ids)).toEqual(new Set(['a2ui-find-table']));
  expectNothingLeft(requested, site);
});

test('support ticket: checks in the browser, a rule only the server applies answered by a data update, then a confirmation', async ({ page, site, requested }) => {
  await openShowcase(page, site);
  await quick(page, 'Open a support ticket').click();
  await expect(page.getByRole('heading', { name: 'Contact support' })).toBeVisible();
  await idle(page);

  const form = surface(page, 'ticket');
  const send = form.getByRole('button', { name: 'Send ticket' });
  const email = form.getByRole('textbox', { name: 'Email' });
  const description = form.getByRole('textbox', { name: 'What happened?' });
  await expect(send).toBeDisabled();
  await email.fill('not-an-email');
  await description.fill('too short');
  await expect(form.getByText('Enter a valid email address.')).toBeVisible();
  await expect(form.getByText('Use 20 to 300 characters.')).toBeVisible();
  await expect(send).toBeDisabled();
  await email.fill('ana@example.invalid');
  await description.fill('The checkout button does nothing after the coupon step.');
  await expect(send).toBeEnabled();
  // Typing sent nothing: only the first run has gone out.
  expect(conversations(await exportSession(page))).toHaveLength(1);

  // The urgency help is a modal that opens in the page.
  await form.getByRole('button', { name: 'What do the levels mean?' }).click();
  await expect(page.getByRole('heading', { name: 'Urgency levels' })).toBeVisible();
  await closeModal(page).click();
  await expect(page.getByRole('heading', { name: 'Urgency levels' })).toHaveCount(0);

  // Low severity with urgency 5: the form cannot tell, the server can.
  await form.getByRole('button', { name: 'Low', exact: true }).click();
  await form.getByRole('slider', { name: 'Urgency' }).fill('5');
  await send.click();
  await expect(form.getByText(/cannot be filed as low severity/)).toBeVisible();
  await idle(page);
  await expect(email).toHaveValue('ana@example.invalid');
  await expect(description).toHaveValue('The checkout button does nothing after the coupon step.');
  await expect(form.getByRole('button', { name: 'Low', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await form.getByRole('button', { name: 'Medium', exact: true }).click();
  await send.click();
  await expect(page.getByRole('heading', { name: 'Ticket received' })).toBeVisible();
  await expect(page.getByText(/^Ticket SUP-[0-9A-Z]{4}, filed by ana@example\.invalid$/)).toBeVisible();
  await expect(page.getByText('Expect a reply within 1 hour.')).toBeVisible();
  await idle(page);

  const session = await exportSession(page);
  expectCleanSession(session);
  const [, rejected, filed] = conversations(session);
  expect(userAction(rejected!)).toMatchObject({ name: 'submit_ticket', context: { email: 'ana@example.invalid', severity: ['low'], urgency: 5, logs: true } });
  expect(userAction(filed!)).toMatchObject({ name: 'submit_ticket', context: { severity: ['medium'], urgency: 5 } });
  // The rejection added one operation to the form, and it only sets data.
  const form1 = contentOf(eventsOf(session, conversations(session)[0]!.id)[1]!)['a2ui_operations'] as unknown[];
  const form2 = contentOf(eventsOf(session, rejected!.id)[1]!)['a2ui_operations'] as unknown[];
  expect(form2.slice(0, form1.length)).toEqual(form1);
  expect(form2.slice(form1.length)).toHaveLength(1);
  expect(form2[form1.length]).toMatchObject({ updateDataModel: { surfaceId: 'ticket', path: '/errors/severity' } });
  expectNothingLeft(requested, site);
});

test('deploy board: the surface changes while the run streams, nothing typed is lost, the logs tab follows, and Pause patches it later', async ({ page, site, requested }) => {
  await openShowcase(page, site);
  await quick(page, 'Deploy the release').click();
  await expect(page.getByRole('heading', { name: 'Release 2.4.0' })).toBeVisible();

  // Typed while the updates are still arriving; it has to be there at the end.
  const note = surface(page, 'deploy').getByRole('textbox', { name: 'Release note' });
  await note.fill('ship it after lunch');
  await expect(page.getByText('Running: Roll out to 50%', { exact: true })).toBeVisible(LONG);
  await expect(page.getByText('60% complete', { exact: true })).toBeVisible();
  await expect(note).toHaveValue('ship it after lunch');
  await idle(page);

  await tab(surface(page, 'deploy'), 'Logs').click();
  await expect(page.getByText('Canary at 10% finished', { exact: true })).toBeVisible();
  await expect(page.getByText('Roll out to 50% started', { exact: true })).toBeVisible();
  await tab(surface(page, 'deploy'), 'Summary').click();
  await expect(note).toHaveValue('ship it after lunch');

  await surface(page, 'deploy').getByRole('button', { name: 'Pause rollout' }).click();
  await expect(page.getByText('Paused at 60%', { exact: true })).toBeVisible();
  await idle(page);
  await expect(note).toHaveValue('ship it after lunch');
  await tab(surface(page, 'deploy'), 'Logs').click();
  await expect(page.getByText('Paused by you at 60%. Note: ship it after lunch', { exact: true })).toBeVisible();

  const session = await exportSession(page);
  expectCleanSession(session);
  const [streamed, paused] = conversations(session);
  const first = eventsOf(session, streamed!.id);
  expect(first.filter((event) => event.type === 'ACTIVITY_DELTA').length).toBeGreaterThanOrEqual(3);
  expect(first.filter((event) => event.type === 'ACTIVITY_SNAPSHOT')).toHaveLength(1);
  // The pause is one patch on the activity the first run painted, and its context is what the board held, note included.
  expect(eventsOf(session, paused!.id).map((event) => event.type)).toEqual(['RUN_STARTED', 'ACTIVITY_DELTA', 'RUN_FINISHED']);
  expect(userAction(paused!)).toMatchObject({ name: 'pause_deploy', surfaceId: 'deploy', context: { release: '2.4.0', progress: 60, note: 'ship it after lunch' } });
  expectNothingLeft(requested, site);
});

test('self-repair: the lifecycle on one activity ends on the valid surface, or on failed when no attempt is valid', async ({ page, site, requested }) => {
  await openShowcase(page, site);
  await quick(page, 'Compare three laptops').click();
  await expect(surface(page, 'laptops').getByText('Cedar 13', { exact: true })).toBeVisible(LONG);
  await expect(surface(page, 'laptops').getByRole('button', { name: 'Choose' })).toHaveCount(3);
  await expect(page.getByText('[Loading card-c...]')).toHaveCount(0);
  await expect(conversation(page).getByText(/The first attempt left out Cedar 13/)).toBeVisible(LONG);
  await idle(page);

  // A button on the repaired surface sends an action, and the answer is plain text.
  await surface(page, 'laptops').getByRole('button', { name: 'Choose' }).first().click();
  await expect(conversation(page).getByText('Action received: choose_laptop {"laptop":"Atlas 14"}', { exact: true })).toBeVisible();
  await idle(page);

  await quick(page, 'Compare three laptops (never valid)').click();
  await expect(conversation(page).getByText('None of the 3 attempts passed validation, so nothing was drawn.')).toBeVisible(LONG);
  await idle(page);

  const session = await exportSession(page);
  expectCleanSession(session);
  const [repaired, , neverValid] = conversations(session);
  const lifecycle = (exchangeId: string) => eventsOf(session, exchangeId).filter((event) => event.type === 'ACTIVITY_SNAPSHOT').map((event) => (typeof contentOf(event)['status'] === 'string' ? contentOf(event)['status'] : 'surface'));
  expect(lifecycle(repaired!.id)).toEqual(['building', 'surface', 'retrying', 'surface']);
  expect(lifecycle(neverValid!.id)).toEqual(['building', 'surface', 'retrying', 'surface', 'retrying', 'surface', 'failed']);
  const failed = contentOf(eventsOf(session, neverValid!.id).filter((event) => event.type === 'ACTIVITY_SNAPSHOT').at(-1)!);
  expect(failed).toMatchObject({ status: 'failed', error: 'Failed to generate valid A2UI after 3 attempt(s)', maxAttempts: 3 });
  expect(failed['attempts']).toHaveLength(3);
  expect(new Set(eventsOf(session, neverValid!.id).filter((event) => event.type === 'ACTIVITY_SNAPSHOT').map((event) => event['messageId'])).size, 'one activity per generation').toBe(1);
  expectNothingLeft(requested, site);
});

test('sandbox probe: media, openUrl, an unknown component, an unknown catalog, a declared v0.8 version and a malformed list are refused and reported, and nothing leaves the page', async ({ page, site, requested }) => {
  await openShowcase(page, site);
  await quick(page, 'Probe the sandbox').click();
  const view = page.locator('[data-view="a2ui"]');
  await expect(view.getByText('Blocked Image: http://third-party.invalid/picture.png')).toBeVisible();
  await expect(view.getByText('Blocked Video: http://third-party.invalid/clip.mp4')).toBeVisible();
  await expect(view.getByText('Blocked AudioPlayer: http://third-party.invalid/sound.mp3')).toBeVisible();
  await expect(view.locator('img, video, audio, iframe')).toHaveCount(0);

  // One message per bad operation, after its position (the list starts at 1), and the operations around them still draw.
  for (const message of [
    'This operation is not an object.',
    'This operation has no version and no v0.8 message name. A2UI v0.9 operations declare "version": "v0.9".',
    'This operation declares version v0.8. A2UI v0.9 operations declare "v0.9", and v0.8 messages have no version.',
    'Catalog not found: https://catalog.invalid/custom.json',
    'Surface not found for message: ghost',
  ]) {
    await expect(view.getByText(message)).toBeVisible();
  }
  // The inspector's own error line, in place of the renderer's (FX15).
  await expect(view.getByRole('alert').filter({ hasText: 'Unknown component type: Hologram.' })).toBeVisible();
  await expect(view.getByText('Survivor', { exact: true })).toBeVisible();
  // Text is plain: markup and Markdown stay as typed.
  await expect(surface(page, 'plain')).toContainText('<b>not bold</b> **not bold** [not a link](http://third-party.invalid/page) ![not a picture](http://third-party.invalid/picture.png)');
  await expect(surface(page, 'plain').locator('b, strong, a, img')).toHaveCount(0);

  await view.getByRole('button', { name: 'Open page' }).click();
  await expect(view.getByText(/Blocked openUrl http:\/\/third-party\.invalid\/page/)).toBeVisible();
  await idle(page);

  const session = await exportSession(page);
  expectCleanSession(session);
  expect(requested.filter((url) => url.includes('.invalid')), 'nothing asked for a reserved address').toEqual([]);
  expectNothingLeft(requested, site);
});
