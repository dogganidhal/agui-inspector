// Spec 014 (FR-021; story 6): `--plugin` of the shipped command. The command serves the file from its own address, lists it in
// config.json, and the page loads it from there. A header from the plugin reaches the target through the relay and wins over
// a `--header` of the same name. A missing file stops the command before it listens, and a page of another site cannot load
// the file. Run `npm run build` first.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AGENT_REPLY, expect, expectOnlyOrigin, open, runCommand, send, startCommand, startTarget, test } from './support.ts';

const SIGN = "let n = 0;\nexport default (api) => { api.provideHeaders(() => ({ 'X-Signature': 'from-the-plugin-' + (n += 1) })); };\n";
const MARK = (letter: string) => `export default () => { document.documentElement.dataset.pluginLoaded = (document.documentElement.dataset.pluginLoaded ?? '') + '${letter}'; };\n`;

function files(later: (cleanup: () => unknown) => void, contents: Record<string, string>): Record<string, string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'agui-cli-e2e-plugins-'));
  later(() => rmSync(dir, { recursive: true, force: true }));
  return Object.fromEntries(Object.entries(contents).map(([name, text]) => [name, (writeFileSync(path.join(dir, name), text), path.join(dir, name))]));
}

test('the plugin loads from the command, its header reaches the target through the relay and beats --header, and nothing leaves the command\'s origin', async ({ page, requested, later }) => {
  const target = await startTarget();
  later(target.close);
  const { sign } = files(later, { sign: SIGN });
  const command = await startCommand(['--target', `${target.origin}/agent`, '--header', 'X-Signature: from-the-command-line', '--header', 'X-Held: held', '--plugin', sign as string]);
  later(() => command.stop());

  const config = (await (await fetch(`${command.origin}/config.json`)).json()) as { plugins: string[] };
  expect(config.plugins).toEqual(['/plugins/1.js']);
  expect(command.stdout()).not.toContain(path.basename(sign as string));

  await open(page, command.origin);
  await expect(page.getByRole('contentinfo')).toContainText('1 plugin');
  await send(page, 'hello');
  await expect(page.getByText(AGENT_REPLY).first()).toBeVisible();
  expect(target.seen).toHaveLength(1);
  expect(target.seen[0]?.headers['x-signature'], 'the page\'s value wins over the command line').toBe('from-the-plugin-1');
  expect(target.seen[0]?.headers['x-held']).toBe('held');
  expectOnlyOrigin(requested, command.origin);
  expect(requested).toContain(`${command.origin}/plugins/1.js`);
});

test('two --plugin files with a --target between them are both active, in the order given', async ({ page, later }) => {
  const target = await startTarget();
  later(target.close);
  const { a, b } = files(later, { a: MARK('a'), b: MARK('b') });
  const command = await startCommand(['--plugin', a as string, '--target', `${target.origin}/agent`, '--plugin', b as string]);
  later(() => command.stop());
  await open(page, command.origin);
  await expect(page.getByRole('contentinfo')).toContainText('2 plugins');
  expect(await page.evaluate(() => document.documentElement.dataset.pluginLoaded)).toBe('ab');
});

test('a --plugin file that does not exist stops the command with 2 before it listens', async ({ later }) => {
  const { present } = files(later, { present: MARK('p') });
  const result = await runCommand(['--target', 'http://127.0.0.1:1/agent', '--plugin', present as string, '--plugin', `${present}.missing`, '--port', '0']);
  expect(result.code).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('--plugin must name a file that can be read');
  expect(result.stderr).not.toContain('missing');
});

test('a page on another site cannot load the plugin file: the command refuses it, and the file\'s text never reaches that page', async ({ page, later }) => {
  const target = await startTarget();
  later(target.close);
  const { sign } = files(later, { sign: 'export default () => {}; // synthetic signing key 7f3a91' });
  const command = await startCommand(['--target', `${target.origin}/agent`, '--plugin', sign as string]);
  later(() => command.stop());

  // A second local origin stands for a hostile site in the same browser: it asks for the plugin as a script and as a fetch.
  const evil = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><script src="${command.origin}/plugins/1.js"></script><p id="out">waiting</p>`);
  });
  await new Promise<void>((resolve) => evil.listen(0, '127.0.0.1', resolve));
  later(() => new Promise((resolve) => (evil.close(() => resolve(undefined)), evil.closeAllConnections())));
  const evilOrigin = `http://127.0.0.1:${(evil.address() as AddressInfo).port}`;

  const statuses: number[] = [];
  page.on('response', (response) => response.url() === `${command.origin}/plugins/1.js` && statuses.push(response.status()));
  await page.goto(evilOrigin);
  await expect.poll(() => statuses).toContain(403);
  const fetched = await page.evaluate((url) => fetch(url, { mode: 'no-cors' }).then((response) => response.type, () => 'blocked'), `${command.origin}/plugins/1.js`);
  expect(['opaque', 'blocked']).toContain(fetched);
  expect(await page.content()).not.toContain('signing key');
});
