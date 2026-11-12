// Feature 018, T014: the built package serves agui-inspector/testing from lib/, and the compiled code runs in Node. It runs
// with the end-to-end tests because those come after `npm run build`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { createInteractiveServer } from '../../../examples/reference-agent/interactive-scenarios.ts';

const run = promisify(execFile);

test('a script imports agui-inspector/testing from the built package, drives a session and asserts on it', async () => {
  const server = await createInteractiveServer();
  try {
    const script = `
      import { openSession, assertMessage, assertNoFinding } from 'agui-inspector/testing';
      const session = await openSession({ target: process.env.TARGET });
      const step = await session.send('hello');
      assertMessage(session, { role: 'assistant', text: 'Hello from the reference agent.' });
      assertNoFinding(session);
      session.close();
      process.stdout.write(JSON.stringify({ idle: step.idle, frames: step.newFrames, from: import.meta.resolve('agui-inspector/testing') }));
    `;
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), env: { ...process.env, TARGET: `${server.origin}/agent` } });
    const result = JSON.parse(stdout) as { idle: boolean; frames: number; from: string };
    expect(result.idle).toBe(true);
    expect(result.frames).toBeGreaterThan(2);
    expect(result.from).toMatch(/packages\/inspector\/lib\/headless\/index\.js$/);
  } finally {
    await server.close();
  }
});
