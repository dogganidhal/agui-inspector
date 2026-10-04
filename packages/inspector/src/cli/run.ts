// The command (feature 005) as a function: parse, listen, print, wait, close. It returns the exit code and touches no
// global, so a test can run it in process. `main.ts` wires it to the process and holds nothing else.
//
// Exit codes: 0 for a normal stop, `--help` and `--version`; 1 when startup fails for a reason that is not the arguments
// (the port is taken, the page files are missing); 2 when the arguments are wrong.
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseCli, USAGE, type Target } from './args.ts';
import { listen } from './server.ts';

export interface Io {
  /** Standard output: `--help`, `--version` and the startup lines. */
  out(text: string): void;
  /** Standard error: a usage error, a startup failure and the failures to reach a target. */
  err(text: string): void;
  /** Aborted by `SIGINT` or `SIGTERM`. The command stops listening and returns 0. */
  readonly stop: AbortSignal;
}

export interface RunOptions {
  /** The directory with the built page. Tests use a stand-in. */
  readonly assetsDir?: string;
  /** What `--version` prints. Tests set it: bundled test code has no package.json next to it. */
  readonly version?: string;
}

// A target at one of these hosts and this command's own port would make the relay call itself.
const OWN_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);
const HINT = 'Run agui-inspector --help for the options.';

const packageVersion = (): string => (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version;

/** The absolute paths of the plugin files, or nothing when one of them is not a file. Checked before the command listens. */
function pluginFiles(files: readonly string[]): string[] | undefined {
  const resolved = files.map((file) => path.resolve(file));
  try {
    return resolved.every((file) => statSync(file).isFile() && accessSync(file, constants.R_OK) === undefined) ? resolved : undefined;
  } catch {
    return undefined;
  }
}

const describe = (target: Target): string => {
  const names = [...target.headers.values()].map((header) => header.name);
  return `  /proxy/${target.n} -> ${target.origin}${names.length > 0 ? ` (headers: ${names.join(', ')})` : ''}\n`;
};

export async function run(argv: readonly string[], io: Io, options: RunOptions = {}): Promise<number> {
  const usage = (message: string) => {
    io.err(`agui-inspector: ${message}\n${HINT}\n`);
    return 2;
  };
  const cli = parseCli(argv);
  if (cli.kind === 'help' || cli.kind === 'version') {
    io.out(cli.kind === 'help' ? USAGE : `${options.version ?? packageVersion()}\n`);
    return 0;
  }
  if (cli.kind === 'error') return usage(cli.message);
  const plugins = pluginFiles(cli.plugins);
  if (plugins === undefined) return usage('--plugin must name a file that can be read');

  let listening;
  try {
    listening = await listen({
      port: cli.port,
      targets: cli.targets,
      plugins,
      log: (line) => io.err(`${line}\n`),
      ...(options.assetsDir !== undefined && { assetsDir: options.assetsDir }),
    });
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    io.err(`agui-inspector: ${code === 'EADDRINUSE' ? `port ${cli.port} is already in use; choose another with --port` : message}\n`);
    return 1;
  }
  if (cli.targets.some((target) => OWN_HOSTS.has(target.host) && target.port === listening.port)) {
    await listening.close();
    return usage("--target points at this command's own address");
  }

  io.out(`agui-inspector listening on http://127.0.0.1:${listening.port}/\n${cli.targets.map(describe).join('')}`);
  if (!io.stop.aborted) await new Promise<void>((resolve) => io.stop.addEventListener('abort', () => resolve(), { once: true }));
  await listening.close();
  return 0;
}
