// Preparation execution (FR-028, US4.3). Framework-free.
//
// L01's presets resolve a plan: an ordered list of requests with their templates already filled in.
// This module sends it. Before every conversation run, continuations included, each request goes out
// in declared order through the guarded transport and is recorded as an exchange. The first request
// that fails, by status or by connection, ends the sequence with an error to show, and the caller
// then sends nothing: no agent request follows a failed preparation.
import type { PreparationRequest, ProvidedHeaders, Recorder, VolatileAuth } from '../../contracts.ts';
import { describeError, fail, ok, type Result } from '../config/validation.ts';
import { recordedPath, type AbortableTransport } from './transport.ts';

export interface PreparationContext {
  readonly recorder: Recorder;
  readonly transport: AbortableTransport;
  /** Where relative paths start: the agent's target, so preparations reach the server the run goes to. */
  readonly baseUrl: string;
  readonly auth?: VolatileAuth;
  readonly signal?: AbortSignal;
  /**
   * What the plugin providers return, asked for before each preparation is recorded: a provider that fails then leaves no
   * exchange for a request that was never sent. The result goes to the transport as an argument, never to the recorder.
   */
  readonly provideHeaders?: (request: { readonly method: string; readonly url: string; readonly body?: string }, signal: AbortSignal) => Promise<Result<ProvidedHeaders>>;
}

/** What a provider is given when the caller has no way to stop the request. */
const NEVER_STOPPED = new AbortController().signal;

export async function runPreparations(plan: readonly PreparationRequest[], context: PreparationContext): Promise<Result<undefined>> {
  for (const step of plan) {
    const label = `${step.method} ${step.path}`;
    let url: URL;
    try {
      url = new URL(step.path, context.baseUrl);
    } catch {
      return fail(`Preparation failed: ${label} is not a valid URL. The run was not sent.`);
    }
    const body = step.body === undefined ? undefined : JSON.stringify(step.body);

    const provided = context.provideHeaders === undefined ? undefined : await context.provideHeaders({ method: step.method, url: url.href, ...(body !== undefined && { body }) }, context.signal ?? NEVER_STOPPED);
    if (provided !== undefined && !provided.ok) {
      if (context.signal?.aborted) return fail(`Stopped during preparation: ${label}. The run was not sent.`);
      return fail(`Preparation failed: ${label}: ${provided.error.replace(/\.?$/, '.')} The run was not sent.`);
    }

    let response: Response;
    try {
      response = await context.recorder.record(
        { kind: 'preparation', method: step.method, path: recordedPath(url), responseKind: 'response', ...(body !== undefined && { body }) },
        () => context.transport.send({ url: url.href, method: step.method, responseKind: 'response', ...(body !== undefined && { body }) }, context.auth, context.signal, provided?.value),
      );
    } catch (error) {
      if (context.signal?.aborted) return fail(`Stopped during preparation: ${label}. The run was not sent.`);
      return fail(`Preparation failed: ${label}: ${describeError(error).replace(/\.?$/, '.')} The run was not sent.`);
    }
    // The recorder keeps reading its own copy of the answer; this one is not needed.
    void response.body?.cancel().catch(() => undefined);
    if (!response.ok) return fail(`Preparation failed: ${label} answered ${response.status}. The run was not sent.`);
  }
  return ok(undefined);
}
