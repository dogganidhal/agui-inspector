// The command line of `agui-inspector` (feature 005): the options, the rules for targets and headers, and the usage text.
// Pure, with no I/O. A message is fixed text with at most an option name, never a value the developer typed: a header
// value or the password of a target URL must not reach a terminal or a log.
import { parseArgs } from 'node:util';
import { checkHeader, checkTarget } from '../headless/target.ts';

export const DEFAULT_PORT = 4747;

export const DEFAULT_TIMEOUT_SECONDS = 60;

export const RUN_USAGE = `Usage: agui-inspector run --target <url> (--message <text> | --input <file>) [options]

Runs one input against one target without a browser, records it as the page does, and writes the session file.

Options:
  --target <url>              The AG-UI endpoint. Exactly one.
  --header "<Name>: <value>"  A header to send to the target before it. Repeat it for more.
  --message <text>            Send this text as a user message.
  --input <file>              Send this run input (JSON) unchanged. Use - for standard input.
  --profile <file>            A client profile file: automatic replies, encoding.
  --timeout <seconds>         Stop capture after this long. Default ${DEFAULT_TIMEOUT_SECONDS}.
  --out <file>                Write the session file here instead of standard output.
  --force                     Replace an existing --out file.
  --help                      Show this text.

Exit codes: 0 no findings, 1 the run could not complete, 2 wrong arguments, 3 findings.
`;

export const USAGE = `Usage: agui-inspector [options]
       agui-inspector run --target <url> (--message <text> | --input <file>) [options]

Serves the AG-UI inspector on this machine and relays its requests to the targets you name. The run command runs one
input without a browser and writes the session file; see agui-inspector run --help.

Options:
  --target <url>              An AG-UI endpoint to inspect. Repeat it for more than one.
  --header "<Name>: <value>"  A header to send to the target before it. Repeat it for more.
  --plugin <file>             A plugin module to serve and load in the page. Repeat it for more.
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

export interface RunCommand {
  readonly kind: 'run';
  readonly target: Target;
  readonly message?: string;
  /** A file path, or `-` for standard input. */
  readonly input?: string;
  readonly profile?: string;
  readonly timeoutMs: number;
  readonly out?: string;
  readonly force: boolean;
}

export type Cli =
  | { readonly kind: 'help'; readonly command?: 'run' }
  | RunCommand
  | { readonly kind: 'version' }
  | { readonly kind: 'serve'; readonly port: number; readonly targets: readonly Target[]; readonly plugins: readonly string[] }
  | { readonly kind: 'error'; readonly message: string };

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const HEADER_FORM = '--header must be "Name: value" with a nonempty value';
const HEADER_RESERVED = '--header must not set Host, Content-Length, Transfer-Encoding or Connection';
const TARGET_PROBLEMS = {
  form: '--target must be an absolute http or https URL',
  credentials: '--target must not contain credentials; use --header',
  query: '--target must not contain a query or a fragment; use --header for secrets',
} as const;

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
  const problem = colon < 1 ? 'form' : checkHeader(name, value);
  if (problem !== undefined) return { ok: false, message: problem === 'reserved' ? HEADER_RESERVED : HEADER_FORM };
  return { ok: true, value: { name, value } };
}

function parseTarget(raw: string, n: number, rawHeaders: readonly string[]): Result<Target> {
  const checked = checkTarget(raw);
  if (!checked.ok) return { ok: false, message: TARGET_PROBLEMS[checked.problem] };
  const { url } = checked;

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

type Token = { readonly kind: 'option'; readonly name: string; readonly value?: string | undefined } | { readonly kind: 'positional' | 'option-terminator' };

/** The targets in command-line order, each with the headers after it. A header belongs to the target before it. */
function targetsOf(tokens: readonly Token[]): Result<Target[]> {
  const groups: Array<{ raw: string; headers: string[] }> = [];
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (token.name === 'target') groups.push({ raw: token.value ?? '', headers: [] });
    else if (token.name === 'header') {
      const group = groups.at(-1);
      if (group === undefined) return { ok: false, message: '--header must come after the --target it belongs to' };
      group.headers.push(token.value ?? '');
    }
  }
  if (groups.length === 0) return { ok: false, message: '--target is required' };
  const targets: Target[] = [];
  for (const [index, group] of groups.entries()) {
    const target = parseTarget(group.raw, index + 1, group.headers);
    if (!target.ok) return target;
    targets.push(target.value);
  }
  return { ok: true, value: targets };
}

/** A stray positional argument can be the rest of an unquoted header value, so it is never echoed. */
const STRAY = 'unexpected argument; quote a --header value that has spaces';

function parseRun(argv: readonly string[]): Cli {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        target: { type: 'string', multiple: true },
        header: { type: 'string', multiple: true },
        message: { type: 'string' },
        input: { type: 'string' },
        profile: { type: 'string' },
        timeout: { type: 'string' },
        out: { type: 'string' },
        force: { type: 'boolean' },
        help: { type: 'boolean' },
      },
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    return { kind: 'error', message: optionProblem(error) };
  }
  if (parsed.tokens.some((token) => token.kind === 'positional')) return { kind: 'error', message: STRAY };
  const { values } = parsed;
  if (values.help === true) return { kind: 'help', command: 'run' };
  const targets = targetsOf(parsed.tokens);
  if (!targets.ok) return { kind: 'error', message: targets.message };
  const [target, extra] = targets.value;
  if (target === undefined || extra !== undefined) return { kind: 'error', message: 'run takes one --target' };
  if (values.message === undefined && values.input === undefined) return { kind: 'error', message: 'run needs --message or --input' };
  if (values.message !== undefined && values.input !== undefined) return { kind: 'error', message: 'run takes --message or --input, not both' };
  let seconds = DEFAULT_TIMEOUT_SECONDS;
  if (values.timeout !== undefined) {
    if (!/^[1-9]\d*$/.test(values.timeout)) return { kind: 'error', message: '--timeout must be a whole number of seconds from 1' };
    seconds = Number(values.timeout);
  }
  if (values.force === true && values.out === undefined) return { kind: 'error', message: '--force needs --out' };
  for (const [option, value] of [['input', values.input], ['profile', values.profile], ['out', values.out]] as const) {
    if (value === '') return { kind: 'error', message: `--${option} must name a file` };
  }
  return {
    kind: 'run',
    target,
    ...(values.message !== undefined && { message: values.message }),
    ...(values.input !== undefined && { input: values.input }),
    ...(values.profile !== undefined && { profile: values.profile }),
    timeoutMs: seconds * 1000,
    ...(values.out !== undefined && { out: values.out }),
    force: values.force === true,
  };
}

/** The command line as a result. Nothing is read, listened to or printed here. */
export function parseCli(argv: readonly string[]): Cli {
  if (argv[0] === 'run') return parseRun(argv.slice(1));
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        target: { type: 'string', multiple: true },
        header: { type: 'string', multiple: true },
        plugin: { type: 'string', multiple: true },
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

  // `run` is the one command so far (feature 018). Others (replay, the conformance suite) come later, so any other first
  // argument that is not an option is an error and its name is kept free. A stray argument elsewhere is not echoed.
  const stray = parsed.tokens.find((token) => token.kind === 'positional');
  if (stray?.kind === 'positional') {
    return { kind: 'error', message: stray.index === 0 ? `unknown command "${stray.value}"` : STRAY };
  }
  if (parsed.values.help === true) return { kind: 'help' };
  if (parsed.values.version === true) return { kind: 'version' };

  let port = DEFAULT_PORT;
  if (parsed.values.port !== undefined) {
    if (!/^\d+$/.test(parsed.values.port) || Number(parsed.values.port) > 65535) return { kind: 'error', message: '--port must be a whole number from 0 to 65535' };
    port = Number(parsed.values.port);
  }

  const targets = targetsOf(parsed.tokens);
  if (!targets.ok) return { kind: 'error', message: targets.message };
  // A plugin belongs to the command, not to a target, so it may stand anywhere. The value is a path, not a secret, but a
  // message still names the option only.
  const plugins = parsed.values.plugin ?? [];
  if (plugins.some((file) => file === '')) return { kind: 'error', message: '--plugin must name a file' };
  return { kind: 'serve', port, targets: targets.value, plugins };
}
