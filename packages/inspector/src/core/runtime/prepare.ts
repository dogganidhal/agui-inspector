// Preparation execution (FR-028, US4.3). Framework-free.
//
// L01's presets resolve a plan: an ordered list of requests with their templates already filled in.
// This module sends it. Before every conversation run, continuations included, each request goes out
// in declared order through the guarded transport and is recorded as an exchange. The first request
// that fails, by status or by connection, ends the sequence with an error to show, and the caller
// then sends nothing: no agent request follows a failed preparation.
import type { PreparationRequest, Recorder, VolatileAuth } from '../../contracts.ts';
import { describeError, fail, ok, type Result } from '../config/validation.ts';
import { recordedPath, type AbortableTransport } from './transport.ts';

export interface PreparationContext {
  readonly recorder: Recorder;
  readonly transport: AbortableTransport;
  /** Where relative paths start: the agent's target, so preparations reach the server the run goes to. */
  readonly baseUrl: string;
  readonly auth?: VolatileAuth;
  readonly signal?: AbortSignal;
}

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

    let response: Response;
    try {
      response = await context.recorder.record(
        { kind: 'preparation', method: step.method, path: recordedPath(url), responseKind: 'response', ...(body !== undefined && { body }) },
        () => context.transport.send({ url: url.href, method: step.method, responseKind: 'response', ...(body !== undefined && { body }) }, context.auth, context.signal),
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
