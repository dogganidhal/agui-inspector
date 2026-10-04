// A stand-in for the packaged page, so the helper tests run before the build. `secret.txt` sits next to the page
// directory, so a path that escapes it would read a real file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, mock } from 'node:test';

export const INDEX = '<!doctype html><title>inspector</title><script type="module" src="./app.js"></script>';
export const APP_JS = 'export const app = 1;\n';
export const CHUNK_JS = 'export const chunk = 2;\n';
export const SECRET = 'outside the static directory';
export const POLICY = "script-src 'self'; object-src 'none'; base-uri 'none'";
export const AGENTS = [{ id: 'support', url: '/agents/support/stream' }];

/** Creates the stand-in directory and removes it when the test file ends. Returns the page directory. */
export function pageDirectory(): string {
  const base = mkdtempSync(path.join(tmpdir(), 'agui-server-'));
  after(() => rmSync(base, { recursive: true, force: true }));
  const page = path.join(base, 'static');
  mkdirSync(path.join(page, 'assets', 'nested'), { recursive: true });
  writeFileSync(path.join(base, 'secret.txt'), SECRET);
  writeFileSync(path.join(page, 'index.html'), INDEX);
  writeFileSync(path.join(page, 'app.js'), APP_JS);
  writeFileSync(path.join(page, 'hosting-config.json'), '{"version":0,"mode":"embedded","allowedOrigins":[]}');
  writeFileSync(path.join(page, 'assets', 'chunk.js'), CHUNK_JS);
  writeFileSync(path.join(page, 'assets', 'data.bin'), 'binary');
  return page;
}

/** Runs `fn` with `console.warn` mocked, and returns its result and every warning it logged. */
export function warnings<T>(fn: () => T): { result: T; logged: string[] } {
  const warn = mock.method(console, 'warn', () => undefined);
  try {
    const result = fn();
    return { result, logged: warn.mock.calls.map((call) => String(call.arguments[0])) };
  } finally {
    warn.mock.restore();
  }
}
