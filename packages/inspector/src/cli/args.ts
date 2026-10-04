// The command line of `agui-inspector` (feature 005): the options, the rules for targets and headers, and the usage text.
// Pure, with no I/O. A message is fixed text with at most an option name, never a value the developer typed: a header
// value or the password of a target URL must not reach a terminal or a log.
import { validateHeaderValue } from 'node:http';
import { parseArgs } from 'node:util';

export const DEFAULT_PORT = 4747;

export const USAGE = `Usage: agui-inspector [options]

Serves the AG-UI inspector on this machine and relays its requests to the targets you name.

Options:
  --target <url>              An AG-UI endpoint to inspect. Repeat it for more than one.
  --header "<Name>: <value>"  A header to send to the target before it. Repeat it for more.
  --port <number>             Port to listen on. Default ${DEFAULT_PORT}. Use 0 for any free port.
  --help                      Show this text.
  --version                   Show the version.
`;

export interface HeldHeader {
  readonly name: string;
  readonly value: string;
}

/** One `--target`. The relay connects to `host` and `port` and to nothing else. */
export interface Target {
  /** Position from 1, in command-line order. It names the proxy path `/proxy/<n>`. */
  readonly n: number;
  readonly url: URL;
  readonly origin: string;
  /** The host without brackets, so an IPv6 literal can be connected to. */
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  /** The path of the URL, at least `/`. */
  readonly path: string;
  /** The headers set for this target, keyed by lowercase name. They live in memory and nowhere else. */
  readonly headers: ReadonlyMap<string, HeldHeader>;
}

export type Cli =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'serve'; readonly port: number; readonly targets: readonly Target[] }
  | { readonly kind: 'error'; readonly message: string };

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// The proxy sets these itself, so a header of the same name from the command line would fight it.
const SET_BY_PROXY = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);

const HEADER_FORM = '--header must be "Name: value" with a nonempty value';
const HEADER_RESERVED = '--header must not set Host, Content-Length, Transfer-Encoding or Connection';
const TARGET_FORM = '--target must be an absolute http or https URL';

/** The option a `parseArgs` error is about, and nothing else from it: its text can quote what was typed. */
function optionProblem(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  const option = /'(-{1,2}[^'\s<=]*)/.exec(text)?.[1] ?? 'an option';
  if ((error as { code?: unknown }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') return `unknown option "${option}"`;
  return /does not take an argument/.test(text) ? `${option} takes no value` : `${option} needs a value`;
}

function parseHeader(raw: string): Result<HeldHeader> {
  const colon = raw.indexOf(':');
  const name = raw.slice(0, colon);
  const value = raw.slice(colon + 1).trim();
  if (colon < 1 || !TOKEN.test(name) || value === '') return { ok: false, message: HEADER_FORM };
  if (SET_BY_PROXY.has(name.toLowerCase())) return { ok: false, message: HEADER_RESERVED };
  try {
    validateHeaderValue(name, value);
  } catch {
    return { ok: false, message: HEADER_FORM };
  }
  return { ok: true, value: { name, value } };
}

function parseTarget(raw: string, n: number, rawHeaders: readonly string[]): Result<Target> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: TARGET_FORM };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, message: TARGET_FORM };
  // A credential or a token in the URL would be written into `config.json`, so it is refused. `--header` is the way.
  if (url.username !== '' || url.password !== '') return { ok: false, message: '--target must not contain credentials; use --header' };
  if (raw.includes('?') || raw.includes('#')) return { ok: false, message: '--target must not contain a query or a fragment; use --header for secrets' };

  const headers = new Map<string, HeldHeader>();
  for (const text of rawHeaders) {
    const header = parseHeader(text);
    if (!header.ok) return header;
    headers.set(header.value.name.toLowerCase(), header.value);
  }
  const tls = url.protocol === 'https:';
  return {
    ok: true,
    value: {
      n,
      url,
      origin: url.origin,
      host: url.hostname.replace(/^\[(.*)\]$/, '$1'),
      port: url.port === '' ? (tls ? 443 : 80) : Number(url.port),
      tls,
      path: url.pathname,
      headers,
    },
  };
}

/** The command line as a result. Nothing is read, listened to or printed here. */
export function parseCli(argv: readonly string[]): Cli {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        target: { type: 'string', multiple: true },
        header: { type: 'string', multiple: true },
        port: { type: 'string' },
        help: { type: 'boolean' },
        version: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    return { kind: 'error', message: optionProblem(error) };
  }

  // Commands (replay, the conformance suite) come in a later release. Until then a first argument that is not an option
  // is an error, so the name is kept free. A stray argument elsewhere can be the rest of an unquoted header value, so it is
  // not echoed.
  const stray = parsed.tokens.find((token) => token.kind === 'positional');
  if (stray?.kind === 'positional') {
    return { kind: 'error', message: stray.index === 0 ? `unknown command "${stray.value}"` : 'unexpected argument; quote a --header value that has spaces' };
  }
  if (parsed.values.help === true) return { kind: 'help' };
  if (parsed.values.version === true) return { kind: 'version' };

  let port = DEFAULT_PORT;
  if (parsed.values.port !== undefined) {
    if (!/^\d+$/.test(parsed.values.port) || Number(parsed.values.port) > 65535) return { kind: 'error', message: '--port must be a whole number from 0 to 65535' };
    port = Number(parsed.values.port);
  }

  // A header belongs to the target before it, so a token for one server cannot reach another.
  const groups: Array<{ raw: string; headers: string[] }> = [];
  for (const token of parsed.tokens) {
    if (token.kind !== 'option') continue;
    if (token.name === 'target') groups.push({ raw: token.value ?? '', headers: [] });
    else if (token.name === 'header') {
      const group = groups.at(-1);
      if (group === undefined) return { kind: 'error', message: '--header must come after the --target it belongs to' };
      group.headers.push(token.value ?? '');
    }
  }
  if (groups.length === 0) return { kind: 'error', message: '--target is required' };

  const targets: Target[] = [];
  for (const [index, group] of groups.entries()) {
    const target = parseTarget(group.raw, index + 1, group.headers);
    if (!target.ok) return { kind: 'error', message: target.message };
    targets.push(target.value);
  }
  return { kind: 'serve', port, targets };
}
