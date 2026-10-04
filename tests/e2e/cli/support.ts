// Feature 005: the shipped command (packages/inspector/lib/cli/main.js) as a child process, and the servers it relays to.
// Run `npm run build` first: the command and the page are the built ones. Self-contained, like tests/e2e/hosted/support.ts.
// Targets are scripted and model-free. None of them sends a CORS header, so a page that is not served by the command
// could not reach them.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { referenceRunResponse } from '../../../examples/reference-agent/scenarios.ts';

export const root = path.resolve(import.meta.dirname, '..', '..', '..');
export const BIN = path.join(root, 'packages', 'inspector', 'lib', 'cli', 'main.js');
export const AGENT_REPLY = 'Hello from the reference agent.';

export interface Command {
  readonly origin: string;
  readonly port: number;
  stdout(): string;
  stderr(): string;
  /** Sends the signal and resolves with the exit code once the process has ended. */
  stop(signal?: NodeJS.Signals): Promise<number | null>;
}

function missingBuild(): never {
  throw new Error(`${BIN} does not exist: run npm run build first`);
}

/** Runs the command to its end. For `--help`, `--version` and the failures. */
export function runCommand(args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  if (!existsSync(BIN)) missingBuild();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the command did not end in 10 s:\n${stdout}\n${stderr}`));
    }, 10_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Starts the command (the built one, or the `bin` file given) and waits for its startup line. `--port 0` is added unless the arguments say a port. */
export async function startCommand(args: string[], env: NodeJS.ProcessEnv = {}, bin = BIN): Promise<Command> {
  if (!existsSync(bin)) missingBuild();
  const full = args.includes('--port') ? args : [...args, '--port', '0'];
  const child: ChildProcess = spawn(process.execPath, [bin, ...full], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));

  for (let attempt = 0; attempt < 300; attempt++) {
    const port = /listening on http:\/\/127\.0\.0\.1:(\d+)\//.exec(stdout)?.[1];
    if (port !== undefined) {
      return {
        origin: `http://127.0.0.1:${port}`,
        port: Number(port),
        stdout: () => stdout,
        stderr: () => stderr,
        stop: async (signal = 'SIGTERM') => {
          child.kill(signal);
          return exited;
        },
      };
    }
    if (child.exitCode !== null) throw new Error(`the command exited early with ${child.exitCode}:\n${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGKILL');
  throw new Error(`the command never printed its address:\n${stdout}\n${stderr}`);
}

export interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface Target {
  readonly origin: string;
  readonly port: number;
  /** Every request this target received, in order. */
  readonly seen: Seen[];
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One run of the reference agent, as `POST /agent` answers it. */
export function referenceReply(body: string, response: ServerResponse): void {
  const input = JSON.parse(body || '{}') as { threadId?: unknown; runId?: unknown };
  if (typeof input.threadId !== 'string' || typeof input.runId !== 'string') {
    response.writeHead(422, { 'content-type': 'application/json' }).end('{"error":"threadId and runId must be strings"}');
    return;
  }
  const reply = referenceRunResponse({ threadId: input.threadId, runId: input.runId });
  response.writeHead(reply.status, { 'content-type': reply.contentType, 'cache-control': 'no-store' });
  for (const chunk of reply.chunks) response.write(chunk);
  response.end();
}

/** A scripted target. It records every request and answers with `answer`, by default as the reference agent does. */
export async function startTarget(answer?: (request: IncomingMessage, response: ServerResponse, seen: Seen) => void | Promise<void>, host = '127.0.0.1'): Promise<Target> {
  const seen: Seen[] = [];
  const server: Server = createServer(async (request, response) => {
    const record: Seen = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: await readBody(request) };
    seen.push(record);
    if (answer !== undefined) return void (await answer(request, response, record));
    if (record.method === 'POST' && record.url.split('?')[0] === '/agent') return referenceReply(record.body, response);
    response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
  });
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://${host}:${port}`,
    port,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** The repository's own reference agent, started as the documentation says, with no CORS option. */
export async function startReferenceAgent(): Promise<{ origin: string; stop(): Promise<void> }> {
  const child = spawn(process.execPath, [path.join(root, 'examples', 'reference-agent', 'server.ts'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = await new Promise<string>((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => {
      text += String(chunk);
      const line = text.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line !== undefined) resolve((JSON.parse(line) as { url: string }).url);
    });
    child.on('exit', () => reject(new Error('the reference agent exited early')));
  });
  return {
    origin,
    stop: async () => {
      child.kill();
      await new Promise((resolve) => child.on('close', resolve));
    },
  };
}

export const test = base.extend<{ later(cleanup: () => Promise<unknown> | unknown): void; requested: string[] }>({
  /** Registers cleanup that runs, last in first out, when the test ends. */
  later: async ({}, use) => {
    const cleanups: Array<() => Promise<unknown> | unknown> = [];
    await use((cleanup) => void cleanups.push(cleanup));
    for (const cleanup of cleanups.reverse()) await cleanup();
  },
  /** Every URL the page requests, by the browser's own account. */
  requested: async ({ page }, use) => {
    const urls: string[] = [];
    page.on('request', (request) => urls.push(request.url()));
    await use(urls);
  },
});

export { expect };

/** Opens the page the command serves and waits for the shell. */
export async function open(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { name: 'agui-inspector', level: 1 })).toBeVisible();
}

/** Types into the composer and sends with Enter. */
export async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}

/** A request the page made counts as allowed only when it went to the command's own origin (or is inline data). */
export function expectOnlyOrigin(urls: readonly string[], origin: string): void {
  for (const url of urls) {
    if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') continue;
    expect(url.startsWith(`${origin}/`), `unexpected request to ${url}`).toBe(true);
  }
}
