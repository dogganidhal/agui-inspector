// Feature 005 (US1, US2, US3, US5, US6; SC-001 to SC-004, SC-007; FR-021): the shipped command and the real page in a browser.
// Targets send no CORS header, so only the command's proxy lets the page reach them. Run `npm run build` first.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { AGENT_REPLY, expect, expectOnlyOrigin, open, referenceReply, send, sleep, startCommand, startReferenceAgent, startTarget, test, type Seen } from './support.ts';

interface SessionFile {
  readonly session: {
    readonly exchanges: Array<{ status?: number; transport: string; path: string; requestBody?: string }>;
    readonly frames: Array<{ envelope: string; offsetMs: number; classification: string }>;
    readonly findings: Array<{ kind: string; message: string }>;
  };
}

/** Exports the session the way a developer does and returns the file's text. */
async function exportSession(page: Page): Promise<string> {
  await page.locator('.agui-ins-head').getByRole('button', { name: 'Export session' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('dialog').getByRole('button', { name: 'Export session' }).click()]);
  return readFileSync((await download.path()) as string, 'utf8');
}

const endpoint = (page: Page) => page.getByRole('textbox', { name: 'Endpoint URL' });

test('the page the command serves lists the target, records a run against the reference agent, and makes no request outside its own origin', async ({ page, requested, later }) => {
  const agent = await startReferenceAgent();
  later(agent.stop);
  const command = await startCommand(['--target', `${agent.origin}/agent`]);
  later(() => command.stop());

  await open(page, command.origin);
  await expect(page.getByRole('banner')).toContainText(`${agent.origin}/agent`);
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toContainText('1 exchange');

  expectOnlyOrigin(requested, command.origin);
  expect(requested.some((url) => url.startsWith(agent.origin)), 'the page never calls the target itself').toBe(false);
  expect(requested).toContain(`${command.origin}/proxy/1/agent`);
});

test('config.json points the agent at a proxy path on the page\u2019s own origin, and the target sees one run and nothing else', async ({ page, later }) => {
  const target = await startTarget();
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);
  later(() => command.stop());

  const config = (await (await fetch(`${command.origin}/config.json`)).json()) as { version: number; agents: Array<{ id: string; name: string; url: string }> };
  expect(config).toEqual({ version: 0, agents: [{ id: 'target-1', name: `${target.origin}/agent`, url: '/proxy/1/agent' }] });

  await open(page, command.origin);
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(target.seen.map((seen) => `${seen.method} ${seen.url}`)).toEqual(['POST /agent']);
  expect(JSON.parse(target.seen[0]?.body ?? '{}')).toMatchObject({ messages: [{ role: 'user', content: 'hello' }] });
});

// ---------------------------------------------------------------------------------------------
// Story 2: the recorded frames are the bytes the target sent
// ---------------------------------------------------------------------------------------------

/** A run written as chunks with pauses: a frame split across two chunks, a frame that is not JSON, bytes that are not UTF-8. */
function scriptedStream(ids: { threadId: string; runId: string }): Array<Buffer> {
  const frame = (event: object) => Buffer.from(`data: ${JSON.stringify(event)}\n\n`);
  return [
    frame({ type: 'RUN_STARTED', ...ids }),
    Buffer.from('data: {"type":"TEXT_MESSAGE_START","messageId":"m1","ro'),
    Buffer.from('le":"assistant"}\n\n'),
    Buffer.from('data: this is not json\n\n'),
    Buffer.concat([Buffer.from('data: '), Buffer.from([0xff, 0xfe]), Buffer.from('\n\n')]),
    frame({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'streamed' }),
    frame({ type: 'TEXT_MESSAGE_END', messageId: 'm1' }),
    frame({ type: 'RUN_FINISHED', ...ids, outcome: { type: 'success' } }),
  ];
}

const idsOf = (seen: Seen) => JSON.parse(seen.body) as { threadId: string; runId: string };

test('the recorded frames are the bytes the target wrote: a split frame, a non-JSON frame and invalid UTF-8, with the pauses between them', async ({ page, later }) => {
  let written: Buffer[] = [];
  const target = await startTarget(async (_request, response, seen) => {
    written = scriptedStream(idsOf(seen));
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    for (const piece of written) {
      response.write(piece);
      await sleep(150);
    }
    response.end();
  });
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);
  later(() => command.stop());

  await open(page, command.origin);
  await send(page, 'hello');
  await expect(page.getByRole('button', { name: /RUN_FINISHED/ })).toBeVisible({ timeout: 15_000 });

  const file = JSON.parse(await exportSession(page)) as SessionFile;
  const { frames, findings, exchanges } = file.session;
  // Every byte, in order: the envelopes join back into what the target wrote (invalid bytes read as the browser's decoder reads them).
  expect(frames.map((frame) => frame.envelope).join('')).toBe(new TextDecoder().decode(Buffer.concat(written)));
  expect(frames).toHaveLength(7);
  expect(exchanges.map((exchange) => [exchange.status, exchange.transport])).toEqual([[200, 'completed']]);
  expect(findings.filter((finding) => finding.kind === 'json').length, 'the two frames that are not JSON are reported').toBeGreaterThanOrEqual(2);
  // Timing: the relay held nothing back. Frames written 150 ms apart are recorded about 150 ms apart, not all at the end.
  const offsets = frames.map((frame) => frame.offsetMs);
  for (let i = 3; i < offsets.length; i++) expect((offsets[i] as number) - (offsets[i - 1] as number), `frame ${i} came after its own pause`).toBeGreaterThan(60);
});

test('Stop in the page closes the connection to the target', async ({ page, later }) => {
  let targetClosed!: () => void;
  const closed = new Promise<void>((resolve) => (targetClosed = resolve));
  const target = await startTarget((_request, response, seen) => {
    const { threadId, runId } = idsOf(seen);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId, runId })}\n\n`);
    response.on('close', targetClosed);
    return new Promise<void>(() => {});
  });
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);
  later(() => command.stop());

  await open(page, command.origin);
  await send(page, 'hello');
  await expect(page.getByRole('button', { name: /RUN_STARTED/ })).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const outcome = await Promise.race([closed.then(() => 'closed'), sleep(3000).then(() => 'still open')]);
  expect(outcome).toBe('closed');
});

test('a stream the target cuts is shown as a failed stream with the bytes that arrived', async ({ page, later }) => {
  const target = await startTarget(async (request, response, seen) => {
    const { threadId, runId } = idsOf(seen);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId, runId })}\n\n`);
    response.write('data: {"type":"TEXT_MESSAGE_START","mess');
    await sleep(100);
    request.socket.destroy();
  });
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);
  later(() => command.stop());

  await open(page, command.origin);
  await send(page, 'hello');
  await expect(page.getByRole('button', { name: /RUN_STARTED/ })).toBeVisible();
  await expect(page.getByText(/transport|interrupted|failed|ended/i).first()).toBeVisible();
  const file = JSON.parse(await exportSession(page)) as SessionFile;
  expect(file.session.exchanges[0]?.transport).toBe('transport-error');
  expect(file.session.frames.map((frame) => frame.envelope).join('')).toContain('RUN_STARTED');
});

// ---------------------------------------------------------------------------------------------
// Story 3: the page can reach only its own origin
// ---------------------------------------------------------------------------------------------

test('the target\u2019s real address typed in the page is refused by the page, and the proxy path works', async ({ page, later }) => {
  const target = await startTarget();
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`]);
  later(() => command.stop());

  await open(page, command.origin);
  await endpoint(page).fill(`${target.origin}/agent`);
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await send(page, 'hello');
  await expect(page.getByText(/is not an allowed destination/).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`This page may reach ${command.origin.replace(/[.]/g, '\\.')}`)).first()).toBeVisible();
  expect(target.seen).toEqual([]);

  await endpoint(page).fill('/proxy/1/agent');
  await page.getByRole('button', { name: 'Use endpoint' }).click();
  await send(page, 'hello again');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(target.seen).toHaveLength(1);
});

// ---------------------------------------------------------------------------------------------
// Story 5: headers and cookies
// ---------------------------------------------------------------------------------------------

test('a header from the command line reaches the target and is in no export; a token typed in the page wins; no cookie crosses', async ({ page, context, later }) => {
  const secret = `synthetic-${randomUUID()}`;
  const target = await startTarget((_request, response, seen) => {
    response.setHeader('set-cookie', 'target-cookie=1; Path=/');
    referenceReply(seen.body, response);
  });
  later(target.close);
  const command = await startCommand(['--target', `${target.origin}/agent`, '--header', `X-Synthetic: ${secret}`]);
  later(() => command.stop());
  expect(command.stdout()).toContain('(headers: X-Synthetic)');
  expect(command.stdout() + command.stderr()).not.toContain(secret);
  // A cookie of another local application: the browser shares localhost cookies across ports.
  await context.addCookies([{ name: 'other-app', value: 'session-1', url: command.origin }]);

  await open(page, command.origin);
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(target.seen[0]?.headers['x-synthetic']).toBe(secret);
  expect(target.seen[0]?.headers.cookie, 'no cookie reaches the target').toBeUndefined();
  expect((await context.cookies()).map((cookie) => cookie.name).sort(), 'the target\u2019s cookie never reaches the browser').toEqual(['other-app']);

  const exported = await exportSession(page);
  expect(exported).not.toContain(secret);
  expect(exported).toContain(AGENT_REPLY);
  const config = await (await fetch(`${command.origin}/config.json`)).text();
  expect(config).not.toContain(secret);

  // The developer's own token, typed in the page with the same header name, is what the target receives.
  await page.getByRole('button', { name: 'Authentication: no token' }).click();
  await page.getByRole('textbox', { name: 'Header name' }).fill('X-Synthetic');
  await page.getByRole('textbox', { name: 'Token' }).fill('typed-in-the-page');
  await page.keyboard.press('Escape');
  await send(page, 'again');
  await expect.poll(() => target.seen.length).toBe(2);
  expect(target.seen[1]?.headers['x-synthetic']).toBe('typed-in-the-page');
  expect(command.stdout() + command.stderr()).not.toContain(secret);
});

// ---------------------------------------------------------------------------------------------
// Story 6: several targets
// ---------------------------------------------------------------------------------------------

test('two targets are listed in the order given, and each run goes to its own target with its own header', async ({ page, later }) => {
  const a = await startTarget();
  const b = await startTarget();
  later(() => Promise.all([a.close(), b.close()]));
  const command = await startCommand(['--target', `${a.origin}/agent`, '--header', 'X-Key: for-a', '--target', `${b.origin}/agent`, '--header', 'X-Key: for-b']);
  later(() => command.stop());

  await open(page, command.origin);
  await expect(endpoint(page)).toHaveValue('/proxy/1/agent');
  await send(page, 'to a');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();

  await page.getByRole('banner').getByRole('button', { name: new RegExp(`^Agent ${a.origin.replace(/[.]/g, '\\.')}`) }).click();
  await page.getByRole('banner').getByRole('button', { name: new RegExp(`^${b.origin.replace(/[.]/g, '\\.')}/agent`) }).click();
  await expect(endpoint(page)).toHaveValue('/proxy/2/agent');
  await send(page, 'to b');
  await expect.poll(() => b.seen.length).toBe(1);
  expect(a.seen.map((seen) => seen.headers['x-key'])).toEqual(['for-a']);
  expect(b.seen.map((seen) => seen.headers['x-key'])).toEqual(['for-b']);
});
