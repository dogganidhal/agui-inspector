// FR-016: the command makes no request of its own. Nothing in src/cli fetches, resolves a name, starts a process or writes a
// file, and the only code that opens a connection is the relay, which connects to a target's host and port.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const cliDir = path.join(process.cwd(), 'packages', 'inspector', 'src', 'cli');
const sources = readdirSync(cliDir).filter((name) => name.endsWith('.ts'));
const read = (name: string) => readFileSync(path.join(cliDir, name), 'utf8').replace(/\/\/.*$/gm, '');

test('no command source fetches, resolves a name, spawns a process, writes a file or reads a setting from the environment', () => {
  assert.ok(sources.includes('proxy.ts'));
  for (const name of sources) {
    const text = read(name);
    for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /node:dns/, /node:child_process/, /node:worker_threads/, /node:cluster/, /\bwriteFile(?:Sync)?\b/, /\bappendFile(?:Sync)?\b/, /\bcreateWriteStream\b/, /process\.env/, /\.connect\s*\(/, /node:dgram/, /node:tls/]) {
      assert.doesNotMatch(text, forbidden, `${name} matches ${String(forbidden)}`);
    }
  }
});

test('only the relay opens an outbound connection, and only the listener listens', () => {
  for (const name of sources) {
    const text = read(name);
    assert.equal(/\b(?:httpRequest|httpsRequest)\b|node:https/.test(text), name === 'proxy.ts', `${name}: outbound requests`);
    assert.equal(/\.listen\s*\(/.test(text), name === 'server.ts', `${name}: listening`);
  }
});
