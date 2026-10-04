// Spec 013 (US1, US2; SC-001, SC-005, SC-007): the real runtime, connection controls and conversation view
// against the reference agent, with the protobuf encoding chosen. The server records the Accept header it saw and
// the bytes it wrote, so every assertion compares what the page asked for and recorded with what crossed the wire.
// Every test also checks the network allowlist: the page may talk to its own origin and the loopback servers this
// file started, and nothing else.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { expect, test as base, type Page } from '@playwright/test';
import { bundleOptions } from '../../../scripts/build.mjs';
import { createInteractiveServer, type InteractiveServer } from '../../../examples/reference-agent/interactive-scenarios.ts';

declare global {
  interface Window {
    __harness: {
      runtime: { sendRaw(text: string): Promise<void> };
      session(): unknown;
      setProfile(patch: Record<string, unknown>): void;
      action: Record<string, unknown>;
    };
  }
}

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const PROTOBUF = 'application/vnd.ag-ui.event+proto';

interface Session {
  exchanges: Array<{ id: string; kind: string; status?: number; transport: string; encoding?: string; requestBody?: string }>;
  frames: Array<{ exchangeId: string; eventType?: string; classification: string; bytes?: string; data?: string; schemaVerdict: string }>;
  runs: Array<{ id: string; input: Record<string, unknown>; outcome: { kind: string } }>;
  findings: Array<{ kind: string; message: string }>;
}

const test = base.extend<{ requested: string[] }, { site: InteractiveServer }>({
  site: [
    async ({}, use) => {
      mkdirSync(path.join(root, '.build'), { recursive: true });
      const outdir = mkdtempSync(path.join(root, '.build', 'protobuf-e2e-'));
      await build({ ...bundleOptions(outdir), entryPoints: { harness: path.join(root, 'packages', 'inspector', 'tests', 'runtime', 'harness.tsx') } });
      const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>runtime harness</title>
    <link rel="stylesheet" href="/harness.css" />
  </head>
  <body><div id="root"></div><script type="module" src="/harness.js"></script></body>
</html>`;
      const site = await createInteractiveServer({
        assets: {
          '/': ['text/html', page],
          '/harness.js': ['text/javascript', readFileSync(path.join(outdir, 'harness.js'), 'utf8')],
          '/harness.css': ['text/css', readFileSync(path.join(outdir, 'harness.css'), 'utf8')],
        },
      });
      await use(site);
      await site.close();
      rmSync(outdir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  requested: [
    async ({ page, site }, use) => {
      site.reset();
      const urls: string[] = [];
      page.on('request', (request) => urls.push(request.url()));
      await use(urls);
      const outside = urls.filter((url) => !url.startsWith(`${site.origin}/`) && !url.startsWith('blob:') && !url.startsWith('data:'));
      expect(outside, 'requests outside the page origin and the scripted agent').toEqual([]);
    },
    { auto: true },
  ],
});

const runs = (site: InteractiveServer) => site.requests().filter((request) => request.kind === 'run');
const session = (page: Page): Promise<Session> => page.evaluate(() => window.__harness.session() as never);
const messageBox = (page: Page) => page.getByLabel('Message', { exact: true });

async function open(page: Page, site: InteractiveServer, agent: 'support' | 'plain' | 'protobuf'): Promise<void> {
  await page.goto(`${site.origin}/?agent=${agent}`);
  await expect(page.getByRole('button', { name: /^Authentication/ })).toBeVisible();
}

const setProfile = (page: Page, patch: Record<string, unknown>) => page.evaluate((value) => window.__harness.setProfile(value), patch);

async function send(page: Page, text: string): Promise<void> {
  await messageBox(page).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

async function settled(page: Page, conversations: number): Promise<Session> {
  await expect
    .poll(async () => {
      const current = await session(page);
      return current.exchanges.every((exchange) => ['completed', 'transport-error', 'user-stopped'].includes(exchange.transport)) && current.exchanges.filter((exchange) => exchange.kind !== 'preparation').length === conversations;
    })
    .toBe(true);
  return session(page);
}

const bytesOf = (frames: Array<{ bytes?: string }>) => Buffer.concat(frames.map((frame) => Buffer.from(frame.bytes ?? '', 'base64')));

test('a protobuf run asks for protobuf, records one frame for each message the agent wrote, and shows the reply (SC-001)', async ({ page, site }) => {
  await open(page, site, 'plain');
  await setProfile(page, { encoding: 'protobuf' });
  await send(page, 'hello there');
  await expect(page.getByText('Hello from the reference agent.')).toBeVisible();

  expect(runs(site)).toHaveLength(1);
  expect(runs(site)[0]?.accept).toBe(PROTOBUF);
  const recorded = await settled(page, 1);
  const [exchange] = recorded.exchanges;
  expect(exchange?.encoding).toBe('protobuf');
  expect(recorded.frames.map((frame) => frame.eventType)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END', 'RUN_FINISHED']);
  expect(recorded.frames.every((frame) => frame.classification === 'data' && frame.bytes !== undefined && frame.data === undefined && frame.schemaVerdict === 'valid')).toBe(true);
  expect(bytesOf(recorded.frames).equals(Buffer.from(site.sent()[0]!))).toBe(true);
  expect(recorded.findings).toEqual([]);
  expect(recorded.runs[0]?.outcome.kind).toBe('success');
});

test('a continuation after interrupts and after tool results also asks for protobuf, and the conversation carries on', async ({ page, site }) => {
  await open(page, site, 'support');
  await setProfile(page, { encoding: 'protobuf' });
  await page.getByRole('button', { name: 'interrupt', exact: true }).click();
  await expect(page.getByLabel('Answer for interrupt i-approve')).toBeVisible();
  await page.getByRole('button', { name: 'Resolve interrupt i-approve' }).click();
  await page.getByRole('button', { name: 'Cancel interrupt i-contact' }).click();
  await expect(page.getByText('Resumed with i-approve=resolved:{"approved":false,"note":""}, i-contact=cancelled')).toBeVisible();

  await page.getByRole('button', { name: 'New thread' }).click();
  await page.getByRole('button', { name: 'tools', exact: true }).click();
  await page.getByLabel('Result for pick_color (c-color)').fill('"teal"');
  await page.getByRole('button', { name: 'Submit result for c-color' }).click();
  await page.getByLabel('Result for pick_size (c-size)').fill('2');
  await page.getByRole('button', { name: 'Submit result for c-size' }).click();
  await expect(page.getByText('Tool results: c-color="teal", c-size=2')).toBeVisible();

  expect(runs(site).map((request) => request.accept)).toEqual([PROTOBUF, PROTOBUF, PROTOBUF, PROTOBUF]);
  const recorded = await settled(page, 4);
  expect(recorded.exchanges.filter((exchange) => exchange.kind === 'conversation').map((exchange) => exchange.encoding)).toEqual(['protobuf', 'protobuf', 'protobuf', 'protobuf']);
  expect(recorded.findings).toEqual([]);
  const preparations = recorded.exchanges.filter((exchange) => exchange.kind === 'preparation');
  expect(preparations.length).toBeGreaterThan(0);
  expect(preparations.every((exchange) => exchange.encoding === undefined), 'preparation requests are not protobuf').toBe(true);
  expect(site.requests().filter((request) => request.kind === 'preparation').every((request) => request.accept.startsWith('application/json'))).toBe(true);
});

test('a preset default of protobuf is used until the profile says otherwise, and switching back records no encoding', async ({ page, site }) => {
  await open(page, site, 'protobuf');
  await send(page, 'first');
  await expect(page.getByText('Hello from the reference agent.')).toHaveCount(1);
  await setProfile(page, { encoding: 'sse' });
  await send(page, 'second');
  await expect(page.getByText('Hello from the reference agent.')).toHaveCount(2);

  expect(runs(site).map((request) => request.accept)).toEqual([PROTOBUF, 'text/event-stream']);
  const recorded = await settled(page, 2);
  expect(recorded.exchanges.map((exchange) => exchange.encoding)).toEqual(['protobuf', undefined]);
  expect(recorded.frames.filter((frame) => frame.exchangeId === recorded.exchanges[1]!.id).every((frame) => frame.data !== undefined && frame.bytes === undefined)).toBe(true);
  expect(recorded.runs.map((run) => run.input.threadId)).toEqual([recorded.runs[0]!.input.threadId, recorded.runs[0]!.input.threadId]);
});

test('a raw submission follows the encoding and sends the typed text unchanged', async ({ page, site }) => {
  await open(page, site, 'plain');
  await setProfile(page, { encoding: 'protobuf' });
  const text = '{ "threadId":"t-raw",  "runId":"r-raw" }';
  await page.evaluate((body) => window.__harness.runtime.sendRaw(body), text);
  const recorded = await settled(page, 1);

  expect(runs(site)[0]?.accept).toBe(PROTOBUF);
  expect(runs(site)[0]?.text).toBe(text);
  expect(recorded.exchanges[0]).toMatchObject({ kind: 'raw', encoding: 'protobuf', requestBody: text });
  expect(recorded.frames.length).toBe(5);
  expect(bytesOf(recorded.frames).equals(Buffer.from(site.sent()[0]!))).toBe(true);
});

test('a scenario with no protobuf form is refused with a visible status, and nothing is invented', async ({ page, site }) => {
  await open(page, site, 'plain');
  await setProfile(page, { encoding: 'protobuf' });
  await send(page, 'broken');
  const recorded = await settled(page, 1);
  expect(recorded.exchanges[0]).toMatchObject({ status: 406, encoding: 'protobuf' });
  expect(recorded.frames).toEqual([]);
});
