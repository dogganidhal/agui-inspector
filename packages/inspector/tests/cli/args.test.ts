// The command line: options, rules and messages (FR-002 to FR-005, FR-019). A message never holds a value that
// the developer typed: a header value, a target's query or its password.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCli, USAGE, type Cli, type Target } from '../../src/cli/args.ts';

const SECRET = 'synthetic-secret-3e9a41';

function served(argv: string[]): { port: number; targets: readonly Target[] } {
  const cli = parseCli(argv);
  assert.equal(cli.kind, 'serve', cli.kind === 'error' ? cli.message : cli.kind);
  return cli as Extract<Cli, { kind: 'serve' }>;
}

function failed(argv: string[]): string {
  const cli = parseCli(argv);
  assert.equal(cli.kind, 'error', `expected an error for ${JSON.stringify(argv)}`);
  const { message } = cli as Extract<Cli, { kind: 'error' }>;
  assert.ok(!message.includes(SECRET), `the message echoes a secret: ${message}`);
  assert.doesNotMatch(message, /\n/, 'one line');
  return message;
}

const headersOf = (target: Target | undefined) => [...(target?.headers.values() ?? [])].map(({ name, value }) => `${name}: ${value}`);

test('one target: defaults, origin, path and the connection details of the relay', () => {
  const { port, targets } = served(['--target', 'http://127.0.0.1:8787/agent']);
  assert.equal(port, 4747);
  assert.equal(targets.length, 1);
  const [target] = targets;
  assert.equal(target?.n, 1);
  assert.equal(target?.origin, 'http://127.0.0.1:8787');
  assert.equal(target?.host, '127.0.0.1');
  assert.equal(target?.port, 8787);
  assert.equal(target?.tls, false);
  assert.equal(target?.path, '/agent');
  assert.equal(target?.url.href, 'http://127.0.0.1:8787/agent');
  assert.equal(target?.headers.size, 0);
});

test('https and default ports, an IPv6 host without its brackets, and a target with no path', () => {
  const { targets } = served(['--target', 'https://agent.example', '--target', 'http://[::1]:8787/a', '--target', 'http://localhost']);
  assert.deepEqual(targets.map((t) => [t.n, t.host, t.port, t.tls, t.path]), [
    [1, 'agent.example', 443, true, '/'],
    [2, '::1', 8787, false, '/a'],
    [3, 'localhost', 80, false, '/'],
  ]);
});

test('each header belongs to the closest target before it, in either spelling', () => {
  const { targets } = served(['--target', 'http://a.example/x', '--header', 'X-Key: a', '--target', 'http://b.example', '--header=X-Key: b', '--header', 'X-Other:  spaced  ']);
  assert.deepEqual(targets.map(headersOf), [['X-Key: a'], ['X-Key: b', 'X-Other: spaced']]);
});

test('a repeated header name for one target replaces the earlier value, and the name keeps its case', () => {
  const { targets } = served(['--target', 'http://a.example', '--header', 'x-key: one', '--header', 'X-KEY: two']);
  assert.deepEqual(headersOf(targets[0]), ['X-KEY: two']);
  assert.deepEqual([...(targets[0]?.headers.keys() ?? [])], ['x-key']);
});

test('--port: the default, zero, the largest port, and what is refused', () => {
  assert.equal(served(['--target', 'http://a.example', '--port', '0']).port, 0);
  assert.equal(served(['--target', 'http://a.example', '--port=65535']).port, 65535);
  for (const bad of ['-1', '65536', 'abc', '1.5', '', ' 80', '0x50']) {
    assert.match(failed(['--target', 'http://a.example', `--port=${bad}`]), /^--port must be a whole number from 0 to 65535/, bad);
  }
});

test('--help and --version win over the other options, and nothing is checked after them', () => {
  assert.deepEqual(parseCli(['--help']), { kind: 'help' });
  assert.deepEqual(parseCli(['--version']), { kind: 'version' });
  assert.deepEqual(parseCli(['--target', 'not a url', '--help']), { kind: 'help' });
  assert.deepEqual(parseCli(['--version', '--port', 'x']), { kind: 'version' });
  assert.match(USAGE, /agui-inspector \[options\]/);
  for (const option of ['--target', '--header', '--port', '--help', '--version']) assert.ok(USAGE.includes(option), option);
});

test('the first argument that is not an option is a command name; a stray argument later is not echoed', () => {
  assert.equal(failed(['replay']), 'unknown command "replay"');
  assert.equal(failed(['replay', '--target', 'http://a.example']), 'unknown command "replay"');
  assert.equal(failed(['--target', 'http://a.example', 'extra']), 'unexpected argument; quote a --header value that has spaces');
  assert.equal(failed(['--target', 'http://a.example', '--', 'extra']), 'unexpected argument; quote a --header value that has spaces');
});

test('unknown options, options with no value and options that take none name only the option', () => {
  assert.equal(failed(['--bogus']), 'unknown option "--bogus"');
  assert.equal(failed([`--bogus=${SECRET}`]), 'unknown option "--bogus"');
  for (const short of ['-h', '-v']) assert.equal(failed([short]), `unknown option "${short}"`);
  assert.equal(failed(['--host', '0.0.0.0']), 'unknown option "--host"', 'no option sets the listening address');
  assert.equal(failed(['--target']), '--target needs a value');
  assert.equal(failed(['--header']), '--header needs a value');
  assert.equal(failed(['--port']), '--port needs a value');
  assert.equal(failed([`--help=${SECRET}`]), '--help takes no value');
});

test('no target is an error, and so is a target that is not an absolute http or https URL', () => {
  assert.equal(failed([]), '--target is required');
  assert.equal(failed(['--port', '4747']), '--target is required');
  for (const bad of ['agent', '/agent', 'ftp://a.example', 'file:///x', 'http://', 'ws://a.example', '']) {
    assert.equal(failed(['--target', bad]), '--target must be an absolute http or https URL', JSON.stringify(bad));
  }
});

test('a credential, a query or a fragment in a target is refused without echoing the URL', () => {
  const credentials = '--target must not contain credentials; use --header';
  assert.equal(failed(['--target', `http://user:${SECRET}@a.example`]), credentials);
  assert.equal(failed(['--target', `http://${SECRET}@a.example/agent`]), credentials);
  const query = '--target must not contain a query or a fragment; use --header for secrets';
  assert.equal(failed(['--target', `http://a.example/agent?token=${SECRET}`]), query);
  assert.equal(failed(['--target', 'http://a.example/agent?']), query);
  assert.equal(failed(['--target', `http://a.example/agent#${SECRET}`]), query);
});

test('a header before any target, a malformed header and the names the proxy sets are refused', () => {
  assert.equal(failed(['--header', `X-Key: ${SECRET}`, '--target', 'http://a.example']), '--header must come after the --target it belongs to');
  assert.equal(failed(['--header', `X-Key: ${SECRET}`, '--target', 'not a url']), '--header must come after the --target it belongs to');
  const malformed = '--header must be "Name: value" with a nonempty value';
  for (const bad of ['no-colon', ':value', 'X-Key:', 'X-Key:   ', 'Bad Name: v', 'X-Key : v', 'Na(me: v', `X-Key: a\nb: ${SECRET}`, `X-Key: ${SECRET}\u0000`, `X-Key: café☃${SECRET}`]) {
    assert.equal(failed(['--target', 'http://a.example', '--header', bad]), malformed, JSON.stringify(bad));
  }
  const reserved = '--header must not set Host, Content-Length, Transfer-Encoding or Connection';
  for (const name of ['Host', 'host', 'Content-Length', 'content-length', 'Transfer-Encoding', 'CONNECTION']) {
    assert.equal(failed(['--target', 'http://a.example', '--header', `${name}: ${SECRET}`]), reserved, name);
  }
});

test('names the page controls are allowed: Authorization, Cookie and custom names', () => {
  const { targets } = served(['--target', 'http://a.example', '--header', 'Authorization: Bearer abc', '--header', 'Cookie: a=b', '--header', 'X-Api-Key: k']);
  assert.deepEqual(headersOf(targets[0]), ['Authorization: Bearer abc', 'Cookie: a=b', 'X-Api-Key: k']);
});

test('an unquoted header never prints the words that followed it', () => {
  // `--header Authorization: Bearer SECRET` gives the value `Authorization:` (no value after the colon) and two stray words.
  for (const argv of [
    ['--target', 'http://a.example', '--header', 'Authorization:', 'Bearer', SECRET],
    ['--header', 'Authorization:', 'Bearer', SECRET, '--target', 'http://a.example'],
  ]) {
    const message = failed(argv);
    assert.ok(message.startsWith('--header') || message.startsWith('unexpected argument') || message.startsWith('unknown command'), message);
  }
});
