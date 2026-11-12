// Feature 018: the headless sessions request only their target and write only the file a caller names. Requests and file
// writes live in session.ts and nowhere else, so src/cli keeps the guarantees of feature 005 FR-016 (tests/cli/outbound).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const dir = path.join(process.cwd(), 'packages', 'inspector', 'src', 'headless');
const sources = readdirSync(dir).filter((name) => name.endsWith('.ts'));
const read = (name: string) => readFileSync(path.join(dir, name), 'utf8').replace(/\/\/.*$/gm, '');

test('no headless source listens, connects, resolves a name, starts a process or imports React', () => {
  assert.ok(sources.includes('index.ts'));
  for (const name of sources) {
    const text = read(name);
    for (const forbidden of [/node:https/, /node:net/, /node:dns/, /node:tls/, /node:dgram/, /node:child_process/, /node:worker_threads/, /node:cluster/, /\bcreateServer\b/, /\.listen\s*\(/, /\.connect\s*\(/, /\b(?:httpRequest|httpsRequest)\b/, /XMLHttpRequest/, /from ['"]react/, /from ['"]\.\.\/views\//, /from ['"]\.\.\/app\//]) {
      assert.doesNotMatch(text, forbidden, `${name} matches ${String(forbidden)}`);
    }
  }
});

test('only session.ts fetches or writes a file, and only assert.ts reads the environment', () => {
  for (const name of sources) {
    const text = read(name);
    assert.ok(!/\bfetch\s*\(/.test(text) || name === 'session.ts', `${name}: fetch`);
    assert.ok(!/\b(?:writeFile|appendFile)(?:Sync)?\b|\bcreateWriteStream\b/.test(text) || name === 'session.ts', `${name}: writes a file`);
    assert.ok(!/process\.env/.test(text) || name === 'assert.ts', `${name}: reads the environment`);
  }
});
