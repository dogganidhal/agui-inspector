// D03 T064 (FR-008, FR-034, FR-036, FR-037, FR-039; SC-007, SC-008; US5.5; G-07): the assembled
// application against a model-free target that repeats the entered credential in one known frame.
// Constitution 1.0.3 separates two things this proves together:
//   - the credential the inspector holds is written nowhere by the inspector: not into configuration,
//     browser storage, a request, a request recording or an exported header field;
//   - the bytes the target sent are evidence: the echo frame is retained and exported unchanged, with
//     the export warning shown first. It is neither redacted nor checked for absence.
// The page under test is the production build; the target is examples/reference-agent/server.ts,
// started as a separate loopback process that grants CORS to the page's origin only.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { ECHO_TOKEN, credentialEchoBody, echoData, echoFrame } from '../../../examples/reference-agent/credential-echo.ts';
import { buildApp } from '../../../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const HEADER = 'X-Api-Key';

interface Site {
  readonly page: string;
  readonly agent: string;
  /** Every request the page's own origin received: path and headers. */
  readonly served: Array<{ path: string; headers: unknown }>;
}

const test = base.extend<{ requests: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> }, { site: Site }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const dist = mkdtempSync(path.join(root, '.build', 'credential-echo-e2e-'));
      await buildApp(dist);

      let agent = '';
      const served: Site['served'] = [];
      const files: Record<string, () => [string, string | Buffer]> = {
        '/': () => ['text/html', readFileSync(path.join(dist, 'index.html'))],
        '/app.js': () => ['text/javascript', readFileSync(path.join(dist, 'app.js'))],
        '/app.css': () => ['text/css', readFileSync(path.join(dist, 'app.css'))],
        '/hosting-config.json': () => ['application/json', JSON.stringify({ version: 0, mode: 'hosted', allowedOrigins: [agent] })],
        '/config.json': () => ['application/json', JSON.stringify({ version: 0, agents: [{ id: 'echo', name: 'Echo target', url: `${agent}/credential-echo` }] })],
      };
      const pageServer: Server = createServer((request, response) => {
        const { pathname } = new URL(request.url ?? '/', 'http://x');
        const file = files[pathname];
        const [type, body] = file?.() ?? ['text/plain', 'not found'];
        served.push({ path: pathname, headers: request.headers });
        response.writeHead(file ? 200 : 404, { 'content-type': type });
        response.end(body);
      });
      await new Promise<void>((resolve) => pageServer.listen(0, '127.0.0.1', resolve));
      const page = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}`;

      const child: ChildProcess = spawn(process.execPath, [path.join(root, 'examples', 'reference-agent', 'server.ts'), '--port', '0', '--allow-origin', page], {
        cwd: root,
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      const [line] = (await once(child.stdout!, 'data')) as [Buffer];
      agent = (JSON.parse(line.toString()) as { url: string }).url;

      await use({ page, agent, served });
      child.kill();
      await new Promise((resolve) => {
        pageServer.close(resolve);
        pageServer.closeAllConnections();
      });
      rmSync(dist, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  // Every request the page makes, with the headers and body the browser sent.
  requests: async ({ page }, use) => {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
    const pending: Array<Promise<void>> = [];
    page.on('request', (request) => {
      pending.push(request.allHeaders().then((headers) => void seen.push({ url: request.url(), method: request.method(), headers, body: request.postData() ?? '' })));
    });
    await use(seen);
    await Promise.all(pending);
  },
});

async function openWithToken(page: Page, site: Site): Promise<void> {
  await page.goto(site.page);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Header name' }).fill(HEADER);
  await page.getByRole('textbox', { name: 'Token' }).fill(ECHO_TOKEN);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: `Authentication: ${HEADER} set` })).toBeVisible();
}

const send = async (page: Page, text: string) => {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
};

interface SessionFile {
  version: number;
  session: {
    exchanges: Array<Record<string, unknown> & { id: string; frames: string[] }>;
    runs: Array<Record<string, unknown> & { input: { threadId: string; runId: string } }>;
    frames: Array<{ id: string; exchangeId: string; envelope: string; data?: string }>;
    [collection: string]: unknown;
  };
}

/** Opens the export dialog, checks the warning is up before anything is written, then downloads. */
async function exportSession(page: Page): Promise<string> {
  let downloads = 0;
  const count = () => void (downloads += 1);
  page.on('download', count);
  await page.getByRole('button', { name: 'Export session' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('can contain personal or sensitive data');
  await expect(dialog).toContainText('Headers and authentication tokens are never included');
  await page.waitForTimeout(200);
  expect(downloads, 'nothing is downloaded before the warning is accepted').toBe(0);
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Export session' }).click()]);
  page.off('download', count);
  return readFileSync((await download.path())!, 'utf8');
}

test('the echoed frame is kept byte for byte and exported with the warning; the held token is written nowhere', async ({ page, site, requests }) => {
  await openWithToken(page, site);
  await send(page, 'hello');

  // The target received the token as the chosen header and repeated it; the page shows what arrived.
  await expect(page.getByText(`Écho reçu — credential: ${ECHO_TOKEN}`).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();

  // Retained: the frame as received is what Copy puts on the clipboard.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const row = page.locator('[data-frame-row]').filter({ hasText: 'TEXT_MESSAGE_CONTENT' });
  await row.click();
  await page.getByRole('button', { name: 'Copy the frame as received' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(echoData(ECHO_TOKEN));

  // Exported: the warning first, then the same bytes, and the whole stream as the target sent it.
  const text = await exportSession(page);
  const file = JSON.parse(text) as SessionFile;
  const { exchanges, runs, frames } = file.session;
  expect(file.version).toBe(0);
  expect(Object.keys(file)).toEqual(['version', 'session']);

  const echoes = frames.filter((frame) => frame.envelope.includes(ECHO_TOKEN));
  expect(echoes).toHaveLength(1);
  expect(Buffer.from(echoes[0]!.envelope, 'utf8').equals(Buffer.from(echoFrame(ECHO_TOKEN), 'utf8'))).toBe(true);
  expect(echoes[0]!.data).toBe(echoData(ECHO_TOKEN));
  const { threadId, runId } = runs[0]!.input;
  expect(frames.map((frame) => frame.envelope).join('')).toBe(credentialEchoBody(threadId, runId, ECHO_TOKEN));

  // Excluded: nothing the inspector writes about the request holds the token, and no field names a header.
  expect(JSON.stringify(exchanges)).not.toContain(ECHO_TOKEN);
  expect(JSON.stringify(runs)).not.toContain(ECHO_TOKEN);
  expect(exchanges[0]!.requestBody).toEqual(expect.stringContaining('"hello"'));
  for (const [collection, records] of Object.entries(file.session)) {
    if (!Array.isArray(records)) continue;
    for (const record of records as Array<Record<string, unknown>>) {
      expect(Object.keys(record).filter((key) => /header|authorization|cookie|credential|token|auth/i.test(key)), `${collection} ${String(record['id'])}`).toEqual([]);
    }
  }
  expect(text.toLowerCase()).not.toMatch(/x-api-key|"headers"/);

  // Configuration and profile: what the page was configured with and what it exports as settings.
  await page.getByRole('group', { name: 'Inspection pane' }).getByRole('button', { name: 'Settings' }).click();
  const [profile] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export profile/ }).click()]);
  expect(readFileSync((await profile.path())!, 'utf8')).not.toContain(ECHO_TOKEN);
  expect(JSON.stringify(site.served)).not.toContain(ECHO_TOKEN);

  // Browser storage, the address and the endpoint field never hold it.
  const kept = await page.evaluate(async () =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      cookie: document.cookie,
      databases: (await indexedDB.databases()).map((database) => database.name),
      address: location.href,
      endpoint: (document.querySelector('input[aria-label="Endpoint URL"]') as HTMLInputElement | null)?.value ?? '',
    }),
  );
  expect(kept).not.toContain(ECHO_TOKEN);

  // Requests: the token reached the target in the chosen header and nowhere else, and only allowed origins were used.
  await page.waitForLoadState('networkidle');
  const holding = requests.filter((request) => JSON.stringify(request).includes(ECHO_TOKEN));
  expect(holding.map((request) => `${request.method} ${request.url}`)).toEqual([`POST ${site.agent}/credential-echo`]);
  expect(holding[0]!.headers[HEADER.toLowerCase()]).toBe(ECHO_TOKEN);
  expect(holding[0]!.body).not.toContain(ECHO_TOKEN);
  expect(holding[0]!.url).not.toContain(ECHO_TOKEN);
  for (const request of requests) {
    expect([site.page, site.agent].some((origin) => request.url.startsWith(`${origin}/`)), `unexpected request to ${request.url}`).toBe(true);
  }
});

test('the echo is evidence, not a leak the inspector hides: it stays in a re-imported recording unchanged', async ({ page, site, requests }) => {
  await openWithToken(page, site);
  await send(page, 'hello');
  await expect(page.getByText(`Écho reçu — credential: ${ECHO_TOKEN}`).first()).toBeVisible();
  const text = await exportSession(page);

  // A reload clears the held token and the session. Importing the file shows the same bytes and sends nothing.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Authentication: no token' })).toBeVisible();
  const before = requests.length;
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'session.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.getByText('Imported recording: inspection only')).toBeVisible();
  await expect(page.getByText(`Écho reçu — credential: ${ECHO_TOKEN}`).first()).toBeVisible();
  expect(requests.length, 'importing requests nothing').toBe(before);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('[data-frame-row]').filter({ hasText: 'TEXT_MESSAGE_CONTENT' }).click();
  await page.getByRole('button', { name: 'Copy the frame as received' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(echoData(ECHO_TOKEN));
  expect(await exportSession(page)).toBe(text);
});

test('control: with no token entered the target has nothing to repeat and the recording holds none', async ({ page, site }) => {
  await page.goto(site.page);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
  await send(page, 'hello');
  await expect(page.getByText('Écho reçu — credential: none').first()).toBeVisible();
  const text = await exportSession(page);
  expect(text).not.toContain(ECHO_TOKEN);
  expect(text).toContain('credential: none');
});
