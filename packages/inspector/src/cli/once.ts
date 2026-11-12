// `agui-inspector run` (feature 018): one input against one target through a headless session, and the session file.
// The request and the file write happen in src/headless; this file reads its input and profile and prints. Exit codes
// (contracts/run-command.md): 0 no findings, 1 the run could not complete, 2 wrong arguments, 3 findings.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { openSession, type Session, type Step } from '../headless/session.ts';
import type { RunCommand } from './args.ts';
import type { Io } from './run.ts';

/** Principle IV: every export says what the file may hold. */
export const EXPORT_WARNING =
  'The session file holds every frame and request body as received. They may contain personal or sensitive data, including a credential the target echoed. Headers are not in the file.';

const HINT = 'Run agui-inspector run --help for the options.';
const QUIET = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** True when the run did not complete: it timed out, or an exchange failed, was stopped or was answered with a non-2xx status. */
function incomplete(session: Session, step: Step): boolean {
  const exchanges = session.exchanges();
  return step.timedOut || exchanges.length === 0 || exchanges.some((exchange) => exchange.transport !== 'completed' || (exchange.status !== undefined && (exchange.status < 200 || exchange.status > 299)));
}

export async function runOnce(command: RunCommand, io: Io): Promise<number> {
  const usage = (message: string) => {
    io.err(`agui-inspector: ${message}\n${HINT}\n`);
    return 2;
  };
  let input: string | undefined;
  if (command.input !== undefined) {
    try {
      input = command.input === '-' ? await (io.stdin ?? (async () => ''))() : await readFile(command.input, 'utf8');
      JSON.parse(input);
    } catch {
      return usage('--input must be JSON from a file that can be read, or from standard input with -');
    }
  }
  if (command.out !== undefined && !command.force && existsSync(command.out)) return usage('--out names a file that exists; add --force to replace it');

  const headers = Object.fromEntries([...command.target.headers.values()].map((header) => [header.name, header.value]));
  let session: Session;
  try {
    session = await openSession({ target: command.target.url.href, headers, timeoutMs: command.timeoutMs, ...(command.profile !== undefined && { profile: command.profile }) });
  } catch {
    return usage('--profile must name a valid profile file');
  }

  // The protocol client writes its own failures to the console. Standard error carries this command's lines only, and no
  // library gets to print a request detail there.
  const saved = QUIET.map((name) => [name, console[name]] as const);
  for (const name of QUIET) console[name] = () => {};
  const stop = () => session.stop();
  io.stop.addEventListener('abort', stop, { once: true });
  let step: Step;
  try {
    step = command.message !== undefined ? await session.send(command.message) : await session.sendRaw(input ?? '');
  } finally {
    io.stop.removeEventListener('abort', stop);
    for (const [name, original] of saved) console[name] = original;
  }

  const failed = incomplete(session, step) || io.stop.aborted;
  if (failed) io.err(`agui-inspector: the run could not complete${step.timedOut ? ': the time limit passed' : step.error !== undefined ? `: ${step.error}` : ''}\n`);
  try {
    if (command.out !== undefined) await session.save(command.out, { overwrite: command.force });
    else io.out(`${JSON.stringify(session.toJSON())}\n`);
  } catch (error) {
    session.close();
    io.err(`agui-inspector: ${(error as Error).message}\n`);
    return 1;
  }
  const findings = session.findings().length;
  io.err(`agui-inspector: ${EXPORT_WARNING}\n${session.frames().length} frames, ${findings} findings${step.timedOut ? ', timed out' : ''}\n`);
  session.close();
  return failed ? 1 : findings > 0 ? 3 : 0;
}
