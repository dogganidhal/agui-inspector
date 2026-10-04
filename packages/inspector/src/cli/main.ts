#!/usr/bin/env node
// The `agui-inspector` command. Everything it does is in run.ts; this file only connects it to the process.
import { run } from './run.ts';

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

process.exitCode = await run(process.argv.slice(2), {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  stop: stop.signal,
});
