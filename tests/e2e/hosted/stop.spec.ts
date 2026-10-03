// GH-50: a recording stays cancellable until capture has ended. The assembled application in a real
// browser, with a target that sends its headers and a few frames and then never finishes. Two paths lose
// their abort controller on main while the response is still being recorded: a raw request (sendRaw returns
// once the headers arrive) and a conversation the protocol client rejected (its promise settles while the
// recorder keeps reading). Both must keep Stop available and stop the connection.
//
// The responses are the browser's own: real fetch, real Response and ReadableStream, a real socket the
// target can watch close. The last test replaces fetch with a stream whose source ignores the abort signal,
// which is what a recorder must still cope with, and checks that nothing arriving after Stop is kept.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, open, send, test } from './support';

const FRAME = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
const MALFORMED = 'data: {not json at all\n\n';

interface Held {
  readonly origin: string;
  /** Paths whose connection the browser closed while the response was still open. */
  readonly closed: string[];
  stop(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** A target whose event streams send their first frames and then stay open until the browser closes them. */
async function holdOpen(pageOrigin: () => string): Promise<Held> {
  const closed: string[] = [];
  const server: Server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? '/', 'http://x');
    response.setHeader('access-control-allow-origin', pageOrigin());
    response.setHeader('vary', 'Origin');
    if (request.method === 'OPTIONS') {
      response.setHeader('access-control-allow-methods', 'POST');
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.writeHead(204);
      return void response.end();
    }
    let input: { threadId?: string; runId?: string } = {};
    try {
      input = JSON.parse(await readBody(request));
    } catch {
      // A raw body need not be a run input.
    }
    const started = FRAME({ type: 'RUN_STARTED', threadId: input.threadId ?? 't', runId: input.runId ?? 'r' });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    // A conversation gets a frame the protocol client cannot read, so its run ends while the stream stays open.
    response.write(pathname === '/conversation' ? started + MALFORMED : started);
    response.on('close', () => closed.push(pathname));
  });
  const origin = await new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return {
    origin,
    closed,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

const stopButton = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Stop', exact: true });
const live = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /^POST \/\S+ .*live/ });

test('a raw request whose response never finishes can be stopped after its headers arrive', async ({ page, openSite }) => {
  let pageOrigin = '';
  const held = await holdOpen(() => pageOrigin);
  try {
    const site = await openSite({
      hosting: () => ({ version: 0, mode: 'hosted', allowedOrigins: [held.origin] }),
      config: () => ({ version: 0, agents: [{ id: 'held', name: 'Held open', url: `${held.origin}/raw` }] }),
    });
    pageOrigin = site.page.origin;
    await open(page, site);
    await expect(stopButton(page)).toBeDisabled();

    await page.getByRole('button', { name: 'Raw request', exact: true }).click();
    await page.getByRole('textbox', { name: 'Raw request body' }).fill('{"threadId":"t-raw","runId":"r-raw"}');
    await page.getByRole('button', { name: 'Send unchanged' }).click();

    // The headers and the first frame are in; the response is still open, and so is Stop.
    await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 1 frame');
    await expect(live(page)).toHaveCount(1);
    await expect(stopButton(page)).toBeEnabled();
    expect(held.closed).toEqual([]);

    await stopButton(page).click();
    await expect.poll(() => held.closed).toEqual(['/raw']);
    await expect(stopButton(page)).toBeDisabled();
    await expect(live(page)).toHaveCount(0);

    // What arrived before the stop stays, and nothing was added to it.
    await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 1 frame');
    await expect(page.getByRole('button', { name: /RUN_STARTED/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /RUN_FINISHED|RUN_ERROR/ })).toHaveCount(0);
  } finally {
    await held.stop();
  }
});

test('a conversation the protocol client rejected stays stoppable while its response is still being recorded', async ({ page, openSite }) => {
  let pageOrigin = '';
  const held = await holdOpen(() => pageOrigin);
  try {
    const site = await openSite({
      hosting: () => ({ version: 0, mode: 'hosted', allowedOrigins: [held.origin] }),
      config: () => ({ version: 0, agents: [{ id: 'held', name: 'Held open', url: `${held.origin}/conversation` }] }),
    });
    pageOrigin = site.page.origin;
    await open(page, site);

    await send(page, 'hello');
    // The client gave up at the malformed frame: the run is over and a new message could be sent...
    await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 2 frames');
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled();
    // ...but the recording is not, so Stop is still there and the connection is still open.
    await expect(live(page)).toHaveCount(1);
    await expect(stopButton(page)).toBeEnabled();
    expect(held.closed).toEqual([]);

    await stopButton(page).click();
    await expect.poll(() => held.closed).toEqual(['/conversation']);
    await expect(stopButton(page)).toBeDisabled();
    await expect(live(page)).toHaveCount(0);

    await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 2 frames');
    await expect(page.getByRole('button', { name: /RUN_STARTED/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /RUN_FINISHED|RUN_ERROR/ })).toHaveCount(0);
    // A stop is not a failure: no banner, and the next message can be sent.
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await held.stop();
  }
});

test('after Stop, bytes a stream still produces are not kept, even when its source ignores the abort signal', async ({ page, openSite }) => {
  const site = await openSite({ config: (origins) => ({ version: 0, agents: [{ id: 'held', name: 'Held open', url: `${origins.agent.origin}/held` }] }) });
  // Every request to /held, a conversation run and a raw request alike, is answered by a native Response over a stream the page feeds by hand.
  // Both start with a frame the protocol client cannot read, so a run ends while its stream stays open.
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    const streams: Array<{ path: string; signal: AbortSignal | null | undefined; push(text: string): void }> = [];
    (window as unknown as { __streams: typeof streams }).__streams = streams;
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname !== '/held') return real(input, init);
      let source!: ReadableStreamDefaultController<Uint8Array>;
      const entry = { path: url.pathname, signal: init?.signal, push: (text: string) => source.enqueue(new TextEncoder().encode(text)) };
      const stream = new ReadableStream<Uint8Array>({ start: (controller) => void (source = controller) });
      streams.push(entry);
      const input_ = JSON.parse(String(init?.body)) as { threadId?: string; runId?: string };
      entry.push(`data: ${JSON.stringify({ type: 'RUN_STARTED', threadId: input_.threadId ?? 't', runId: input_.runId ?? 'r' })}\n\n`);
      entry.push('data: {not json at all\n\n');
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    };
  });
  await open(page, site);

  await send(page, 'hello');
  await expect(page.getByRole('contentinfo')).toContainText('1 exchange · 2 frames');
  await page.getByRole('button', { name: 'Raw request', exact: true }).click();
  await page.getByRole('textbox', { name: 'Raw request body' }).fill('{"threadId":"t-raw","runId":"r-raw"}');
  await page.getByRole('button', { name: 'Send unchanged' }).click();
  await expect(page.getByRole('contentinfo')).toContainText('2 exchanges · 4 frames');
  await expect(stopButton(page)).toBeEnabled();

  const aborted = () =>
    page.evaluate(() => (window as unknown as { __streams: Array<{ path: string; signal?: AbortSignal | null }> }).__streams.map((entry) => [entry.path, entry.signal?.aborted]));
  expect(await aborted()).toEqual([['/held', false], ['/held', false]]);

  await stopButton(page).click();
  await expect(stopButton(page)).toBeDisabled();
  await expect(live(page)).toHaveCount(0);
  expect(await aborted()).toEqual([['/held', true], ['/held', true]]);

  // The sources never noticed the abort and still deliver; the page no longer keeps what they send.
  await page.evaluate(() => {
    for (const entry of (window as unknown as { __streams: Array<{ push(text: string): void }> }).__streams) {
      entry.push(`data: ${JSON.stringify({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', outcome: { type: 'success' } })}\n\n`);
    }
  });
  await page.waitForTimeout(100);
  await expect(page.getByRole('contentinfo')).toContainText('2 exchanges · 4 frames');
  await expect(page.getByRole('button', { name: /RUN_FINISHED|RUN_ERROR/ })).toHaveCount(0);
});
