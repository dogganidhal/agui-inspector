// The runtime (FR-003 to FR-005, FR-007, FR-009, FR-011, FR-014, FR-023 to FR-025, FR-028, FR-031,
// FR-036; spec 004 for automatic replies). Framework-free: no React, no DOM beyond fetch and AbortController.
//
// It owns what the views only display: the selected target, the volatile token, the current thread and
// the replies a finished run is waiting for. It turns a message, a continuation or a surface action into
// one ordinary conversation run:
//
//   resolve the preset -> compose the run input -> send the preparations -> send the run
//
// When a run ends owing replies, the profile may answer them (`automate`) and the continuation is sent at once,
// by the same builder and the same dispatch a developer's last answer uses, so its input is the manual one. A
// chain of such continuations stops after AUTOMATIC_REPLY_LIMIT in a row, when the developer presses Stop, and
// whenever the profile does not cover what is owed.
//
// A failure at any step before the run is sent is shown and nothing after it happens. The run goes out
// through the protocol client (HttpAgent) whose fetch is the recorder, which in turn sends through the
// guarded transport. The client's view of the stream (messages, state, outcomes, sequence errors) is
// kept here; the recording of the stream is the recorder's and is never touched by what the client does.
// For server-sent events the client reads a copy of the response whose line endings are all LF (line-endings.ts),
// because it cannot frame CRLF or CR; the recorder's branch was cloned before that and keeps the bytes as sent. A
// protobuf answer is binary, so the client reads the original response with nothing rewritten.
// The run asks for the encoding that was chosen (`encodingFor`: the profile, then the preset, then server-sent
// events). It is the request's `responseKind`, which the guarded transport turns into the Accept header.
//
// The token lives in this object and is read in exactly one place: the guarded transport call. It is
// not given to the recorder, the store, a log or an error message. Nothing here touches browser storage.
import { AGUIError, type AgentCapabilities, type Message, type ResumeEntry, type RunAgentInput, type State, type ToolMessage } from '@ag-ui/core';
import { HttpAgent, type AgentSubscriber } from '@ag-ui/client';
import type {
  A2uiAction,
  AgentConfig,
  AutomaticReplies,
  ClientProfileSettings,
  Encoding,
  InterruptAnswer,
  JsonValue,
  ObservedOutcome,
  ProvidedHeaders,
  Recorder,
  Run,
  RunRecordId,
  SessionStore,
  ToolResultDraft,
  TransportPolicy,
  Unsubscribe,
  VolatileAuth,
  VolatileConnectionState,
} from '../../contracts.ts';
import { describeError, fail, isJsonValue, ok, type Result } from '../config/validation.ts';
import { createFrameSink } from '../frames/index.ts';
import { preparePreset } from '../presets/index.ts';
import { composeRunInput, encodingFor } from '../profiles/index.ts';
import { createRecorder, type CaptureRecorder, type RecorderClock } from '../recorder/index.ts';
import { kindOf, type CatalogueRuleId } from '../rules/catalogue.ts';
import { sequenceRuleOf } from '../rules/sequence.ts';
import { canonicalizeLineEndings } from './line-endings.ts';
import { runPreparations } from './prepare.ts';
import {
  AUTOMATIC_REPLY_LIMIT,
  NO_REPLIES,
  answerInterrupt as answerPending,
  automate,
  automaticReplies,
  checkA2uiAction,
  draftInterrupt as draftPending,
  draftToolResult as draftTool,
  isBlocked,
  owesReplies,
  repliesFor,
  resumeEntries,
  submitToolResult as submitTool,
  toolMessages,
  waitingNotice,
  type PendingReplies,
} from './replies.ts';
import { createGuardedTransport, headerNameProblem, recordedPath, resolveTarget, type AbortableTransport } from './transport.ts';

export { waitingNotice } from './replies.ts';
export { checkAgainstSchema, seedFromSchema } from './schema.ts';
export { createGuardedTransport, guardedFetchText, headerNameProblem, providedHeaderProblem, resolveTarget, type AbortableTransport } from './transport.ts';

/**
 * What the runtime asks of the plugin host (specs/014-plugin-api): the hooks that may replace a run's input, and the headers
 * of the providers for one request. A failure is `{ ok: false }` with a message for the line under the composer. A stop by
 * the user is a failure too, and the runtime tells the two apart by its own signal, so a stop shows no plugin error.
 */
export interface RunPlugins {
  beforeRun(run: { readonly input: RunAgentInput; readonly agentId?: string; readonly url: string }, signal: AbortSignal): Promise<Result<RunAgentInput>>;
  provideHeaders(request: { readonly method: string; readonly url: string; readonly body?: string }, signal: AbortSignal): Promise<Result<ProvidedHeaders>>;
}

/** No plugin: the input is the one composed, uncopied, and there are no extra headers. */
export const NO_PLUGINS: RunPlugins = { beforeRun: async ({ input }) => ok(input), provideHeaders: async () => ok({}) };

/** What the runtime reads from the settings at the moment a run is built; the host owns both. */
export interface RuntimeSettings {
  readonly profile: ClientProfileSettings;
  /** The values the user edited, by preset variable name. */
  readonly variables: Readonly<Record<string, JsonValue>>;
}

export interface RuntimeOptions {
  readonly store: SessionStore;
  readonly policy: TransportPolicy;
  readonly settings: () => RuntimeSettings;
  /** Replaces the global fetch. Only tests need this. */
  readonly fetch?: typeof globalThis.fetch;
  /** Thread, run, message and uuid identifiers. Defaults to Web Crypto. */
  readonly randomUUID?: () => string;
  readonly clock?: RecorderClock;
  /** The plugin host. Absent: no hook and no provider. */
  readonly plugins?: RunPlugins;
}

export interface RuntimeState {
  /** The only value that can hold the token. Memory only: never put it in a profile, a session or a log. */
  readonly connection: VolatileConnectionState;
  /** A conversation run is in progress: the client has not finished with it. It stops a new message from starting a run. */
  readonly running: boolean;
  /**
   * A request is still being sent or its response is still being recorded, so Stop has something to end.
   * It outlives `running`: the client can give up on a stream that the recording keeps reading.
   */
  readonly capturing: boolean;
  readonly threadId: string;
  readonly quickMessages: readonly string[];
  /** A failure the user should see: a refused target, a failed preparation, a connection problem. */
  readonly error?: string;
  readonly interrupts: readonly InterruptAnswer[];
  readonly toolResults: readonly ToolResultDraft[];
  /**
   * Why no new message can start a run right now, when something is waiting for an answer. It also says when
   * automatic replies paused at the limit.
   */
  readonly notice?: string;
}

export interface Runtime {
  getState(): RuntimeState;
  subscribe(listener: () => void): Unsubscribe;
  /** For configuration and capability loading, which obey the same allowlist as every other request. */
  readonly transport: AbortableTransport;
  /**
   * Use a configured agent's endpoint and preset. Both change the target (as does a different agent or
   * URL), which clears the token, ends the thread and returns true when a token was cleared.
   */
  selectAgent(agent: AgentConfig): boolean;
  /** Use an endpoint typed by the user, without a preset. */
  setTarget(url: string): boolean;
  setAuth(auth: VolatileAuth | undefined): void;
  /**
   * What the selected agent declares, for the frame reader to judge each stream against (specs/007). Memory only.
   * The app sets it when the agent or its loaded capabilities change; a change of target clears it.
   */
  setDeclaredCapabilities(capabilities: AgentCapabilities | undefined): void;
  /** An ordinary message, quick messages included. Resolves when the run, and every automatic continuation after it, has ended. */
  send(text: string): Promise<void>;
  /** Ends the connection of every request that is still being sent or recorded. Not a protocol answer. */
  stop(): void;
  newThread(): void;
  draftInterrupt(interruptId: string, draft: JsonValue): void;
  /** Resolve or cancel. The last answer starts the continuation, and resolves when that run and any automatic ones after it have ended. */
  answerInterrupt(interruptId: string, status: 'resolved' | 'cancelled'): Promise<void>;
  draftToolResult(toolCallId: string, result: string): void;
  /** The last result starts the continuation. */
  submitToolResult(toolCallId: string): Promise<void>;
  /** Sends the continuation once every answer exists; the way to retry one that failed before it was sent. */
  continueRun(): Promise<void>;
  /** A surface action starts a new run carrying the action envelope. */
  sendA2uiAction(action: A2uiAction): Promise<void>;
  /** Sends exactly this JSON text to the target, outside the conversation: no preset, profile or preparation. */
  sendRaw(text: string): Promise<void>;
}

interface Thread {
  readonly id: string;
  messages: Message[];
  state: State;
  /** The protocol run id of the latest run, which a continuation names as its parent. */
  lastRunId?: string;
}

interface Turn {
  readonly userText?: string;
  readonly toolMessages?: readonly ToolMessage[];
  readonly resume?: readonly ResumeEntry[];
  readonly parentRunId?: string;
  readonly a2uiAction?: A2uiAction;
  /** The replies this continuation carries that the inspector answered from the profile. */
  readonly automatic?: AutomaticReplies;
}

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;
const MAX_MESSAGE = 300;

const clip = (text: string) => (text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text);

const STOPPED_BEFORE_SEND = 'Stopped before the run was sent';

const PAUSED_NOTICE = `Automatic replies paused after ${AUTOMATIC_REPLY_LIMIT} in a row. Answer by hand to continue the run.`;

/**
 * What the client's binary parser (`parseProtoStream` in @ag-ui/client 1.0.1) says when it cannot read a protobuf stream:
 * a frame it cannot decode, a stream that ends inside a frame, and a frame above its limit. The messages carry no
 * received value. A pin test in tests/foundation/compatibility.test.ts fails first if the client words them differently.
 */
export const BINARY_CLIENT_ERRORS = [
  /^Failed to decode protocol buffer message/,
  /^The binary stream ended mid-frame/,
  /^Protobuf message size exceeded maximum limit/,
] as const;

/** The client's own words for a rejected stream, kept short and free of the received values. */
function clientFailure(error: unknown): { rule: CatalogueRuleId; message: string } | undefined {
  if (error instanceof AGUIError) return { rule: sequenceRuleOf(error.message), message: clip(error.message) };
  if (error instanceof SyntaxError) return { rule: 'json.invalid', message: `The protocol client could not read a frame as JSON: ${clip(error.message)}` };
  if (error instanceof Error && error.name === 'ZodError') {
    const issues = (error as Error & { issues?: ReadonlyArray<{ path: PropertyKey[]; message: string }> }).issues ?? [];
    const first = issues[0];
    return { rule: 'schema.invalid-event', message: `The protocol client rejected a frame: ${first ? `${first.path.map(String).join('.') || '(root)'}: ${first.message}` : 'invalid event'}${issues.length > 1 ? ` and ${issues.length - 1} more` : ''}` };
  }
  if (error instanceof Error && BINARY_CLIENT_ERRORS.some((pattern) => pattern.test(error.message))) {
    return { rule: 'binary.client-failed', message: `The protocol client could not read the binary stream: ${clip(error.message)}` };
  }
  return undefined;
}

/** HttpAgent sends exactly the input the runtime composed, so the recording shows what the profile and preset produced. */
class RunAgent extends HttpAgent {
  body = '';

  protected override requestInit(input: RunAgentInput): RequestInit {
    return { ...super.requestInit(input), body: this.body };
  }
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const { store, policy } = options;
  const plugins = options.plugins ?? NO_PLUGINS;
  const randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  const epoch = () => (options.clock ?? { epoch: () => Date.now() }).epoch();
  const transport = createGuardedTransport(policy, options.fetch ? { fetch: options.fetch } : {});
  let declared: AgentCapabilities | undefined;
  const recorder: CaptureRecorder = createRecorder(createFrameSink(store, { declared: () => declared }), options.clock);

  let agent: AgentConfig | undefined;
  let targetUrl: string | undefined;
  let auth: VolatileAuth | undefined;
  let thread: Thread = { id: randomUUID(), messages: [], state: {} };
  let replies: PendingReplies = NO_REPLIES;
  // Automatic continuations sent in a row, and whether the limit stopped the profile from answering.
  let streak = 0;
  let paused = false;
  let running = false;
  let error: string | undefined;
  let activeController: AbortController | undefined;
  // A controller stays here until nothing holds it any more: the request or run that made it, and every
  // recording made under it. Stop therefore works for as long as a response is being captured, even after
  // the call that sent the request has returned or the protocol client has rejected the stream.
  const controllers = new Map<AbortController, number>();
  let runs = 0;
  let findings = 0;

  const listeners = new Set<() => void>();
  let state: RuntimeState;
  const snapshot = (): RuntimeState => {
    const notice = [waitingNotice(replies), paused ? PAUSED_NOTICE : undefined].filter(Boolean).join(' ') || undefined;
    return {
      connection: {
        ...(agent !== undefined && { agentId: agent.id }),
        ...(targetUrl !== undefined && { targetUrl }),
        ...(auth !== undefined && { auth }),
        ...(activeController !== undefined && { abortController: activeController }),
      },
      running,
      capturing: controllers.size > 0,
      threadId: thread.id,
      quickMessages: agent?.preset?.quickMessages ?? [],
      ...(error !== undefined && { error }),
      interrupts: replies.interrupts,
      toolResults: replies.toolResults,
      ...(notice !== undefined && { notice }),
    };
  };
  const emit = () => {
    state = snapshot();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A failing view must not stop a run.
      }
    }
  };
  state = snapshot();

  const problem = (message: string): void => {
    error = message;
    emit();
  };

  // -------------------------------------------------------------------------------------------
  // Target and token
  // -------------------------------------------------------------------------------------------

  function targetProblem(url: string | undefined): string | undefined {
    if (url === undefined || url.trim() === '') return 'Enter an endpoint URL or select an agent first';
    if (policy.mode === 'hosted' && !ABSOLUTE.test(url)) return 'Hosted endpoint URLs must be absolute, for example https://agent.example/run';
    const resolved = resolveTarget(url, policy);
    return resolved.ok ? undefined : resolved.error;
  }

  /** Where a request may go right now: the target, and a token header name the browser will accept. */
  function sendable(): Result<URL> {
    const targetError = targetProblem(targetUrl);
    if (targetError !== undefined) return fail(targetError);
    const headerError = auth !== undefined && auth.token !== '' ? headerNameProblem(auth.headerName) : undefined;
    return headerError !== undefined ? fail(headerError) : resolveTarget(targetUrl as string, policy);
  }

  function changeTarget(nextAgent: AgentConfig | undefined, url: string): boolean {
    const changed = nextAgent?.id !== agent?.id || url !== targetUrl;
    agent = nextAgent;
    targetUrl = url;
    let cleared = false;
    if (changed) {
      // The token was entered for the old target; it never reaches a new one. Nor does the old agent's declaration.
      cleared = auth !== undefined;
      auth = undefined;
      declared = undefined;
      stop();
      thread = { id: randomUUID(), messages: [], state: {} };
      replies = NO_REPLIES;
      streak = 0;
      paused = false;
    }
    error = targetProblem(url);
    emit();
    return cleared;
  }

  const hold = (controller: AbortController): void => void controllers.set(controller, (controllers.get(controller) ?? 0) + 1);

  function release(controller: AbortController): void {
    const holds = (controllers.get(controller) ?? 1) - 1;
    if (holds > 0) controllers.set(controller, holds);
    else controllers.delete(controller);
  }

  /** Records under `controller`: it is held until each recording has ended, however that happens. */
  function recorderFor(controller: AbortController): Recorder {
    return {
      record(request, send) {
        hold(controller);
        return recorder.record(request, send, {
          signal: controller.signal,
          onEnd() {
            release(controller);
            emit();
          },
        });
      },
    };
  }

  function stop(): void {
    for (const controller of [...controllers.keys()]) controller.abort();
  }

  // -------------------------------------------------------------------------------------------
  // One ordinary conversation run
  // -------------------------------------------------------------------------------------------

  const refuse = (message: string): false => {
    problem(message);
    return false;
  };

  /**
   * Sends the turn the developer started, then every automatic continuation the profile asks for. Each pass is one
   * run; the loop ends when a run was not sent or was stopped, or when nothing owed is covered by the profile.
   */
  async function dispatch(turn: Turn): Promise<void> {
    let next: Turn | undefined = turn;
    for (let automatic = false; next !== undefined; automatic = true) {
      const sent = await dispatchRun(next, automatic);
      next = sent ? automaticTurn() : undefined;
    }
  }

  /** True when the run was sent and was not stopped, so what it left waiting may be answered automatically. */
  async function dispatchRun(turn: Turn, automatic: boolean): Promise<boolean> {
    if (running) return refuse('A run is already in progress. Stop it or wait for it to end');
    if (isBlocked(replies)) return refuse(waitingNotice(replies) ?? 'Answer what is waiting first');
    const target = sendable();
    if (!target.ok) return refuse(target.error);

    let sent = false;
    running = true;
    error = undefined;
    const controller = new AbortController();
    activeController = controller;
    hold(controller);
    emit();

    try {
      const current = thread;
      const settings = options.settings();
      const ids = { threadId: current.id, runId: randomUUID() };
      const user: Message[] = turn.userText === undefined ? [] : [{ id: randomUUID(), role: 'user', content: turn.userText }];
      const turnMessages: Message[] = [...user, ...(turn.toolMessages ?? [])];

      const prepared = preparePreset(agent?.preset, settings.variables, ids, randomUUID);
      if (!prepared.ok) return refuse(prepared.error);
      const input = composeRunInput({
        ids,
        prepared: prepared.value,
        profile: settings.profile,
        transcript: [...current.messages, ...turnMessages],
        turnMessages,
        state: current.state as JsonValue,
        ...(turn.parentRunId !== undefined && { parentRunId: turn.parentRunId }),
        ...(turn.resume !== undefined && { resume: turn.resume }),
        ...(turn.a2uiAction !== undefined && { a2uiAction: turn.a2uiAction }),
      });
      if (!input.ok) return refuse(input.error);

      // A hook may replace the input. It runs before anything is sent, so a refusal means nothing at all went out. What is
      // sent, recorded and kept as the run's input is what it returned. The conversation the inspector keeps is not changed.
      const hooked = await plugins.beforeRun({ input: input.value, ...(agent !== undefined && { agentId: agent.id }), url: target.value.href }, controller.signal);
      if (!hooked.ok) return refuse(controller.signal.aborted ? STOPPED_BEFORE_SEND : hooked.error);
      const runInput = hooked.value;

      const preparations = await runPreparations(prepared.value.preparations, {
        recorder: recorderFor(controller),
        transport,
        baseUrl: target.value.href,
        signal: controller.signal,
        provideHeaders: (request, signal) => plugins.provideHeaders(request, signal),
        ...(auth !== undefined && { auth }),
      });
      if (!preparations.ok) return refuse(preparations.error);

      // The run's own headers are asked for before the answers it carries are cleared, so a provider that fails leaves them
      // for a retry. Nothing is recorded for a request that is not sent.
      const body = JSON.stringify(runInput);
      const provided = await plugins.provideHeaders({ method: 'POST', url: target.value.href, body }, controller.signal);
      if (!provided.ok) return refuse(controller.signal.aborted ? STOPPED_BEFORE_SEND : provided.error);

      // Past this point the run is sent; whatever it was waiting for has been carried. A run the developer
      // started starts the count of automatic continuations again, and one the inspector started adds to it.
      replies = NO_REPLIES;
      streak = automatic ? streak + 1 : 0;
      paused = false;
      await execute(current, target.value, runInput, body, provided.value, turnMessages, controller, auth, turn.automatic, encodingFor(settings.profile, prepared.value.encoding));
      sent = !controller.signal.aborted;
    } finally {
      running = false;
      release(controller);
      if (activeController === controller) activeController = undefined;
      emit();
    }
    return sent;
  }

  async function execute(
    current: Thread,
    target: URL,
    input: RunAgentInput,
    body: string,
    headers: ProvidedHeaders,
    turnMessages: readonly Message[],
    controller: AbortController,
    credentials: VolatileAuth | undefined,
    automatic: AutomaticReplies | undefined,
    encoding: Encoding,
  ): Promise<void> {
    const recordId: RunRecordId = `run-${(runs += 1)}`;
    let outcome: ObservedOutcome = { kind: 'unknown' };
    let startedAt = epoch();
    let linked = false;

    const writeRun = (patch: Partial<Run> = {}) => {
      if (!linked) return;
      const exchange = store.snapshot().exchanges.find((candidate) => candidate.runId === recordId);
      if (!exchange) return;
      const run: Run = {
        id: recordId,
        threadId: input.threadId,
        runId: input.runId,
        ...(input.parentRunId !== undefined && { parentRunId: input.parentRunId }),
        input,
        exchangeId: exchange.id,
        startedAt: exchange.startedAt,
        outcome,
        ...(automatic !== undefined && { automaticReplies: automatic }),
        ...patch,
      };
      try {
        store.upsertRun(run);
      } catch {
        // The recorder reports capture problems on the exchange; the client's run carries on.
      }
    };
    const addRunFinding = (rule: CatalogueRuleId, message: string) => {
      try {
        store.addFinding({ id: `${recordId}:finding-${(findings += 1)}`, kind: kindOf(rule), rule, message, subject: { type: 'run', id: recordId } });
      } catch {
        // No run record to point at (the exchange was never captured).
      }
    };

    const capture = recorderFor(controller);
    const client = new RunAgent({
      url: target.href,
      threadId: input.threadId,
      initialMessages: [...current.messages, ...turnMessages],
      initialState: current.state,
      fetch: (url, init) =>
        capture
          .record(
            { kind: 'conversation', method: init.method ?? 'POST', path: recordedPath(new URL(url)), body, responseKind: encoding, runId: recordId },
            () => {
              startedAt = epoch();
              linked = true;
              writeRun({ startedAt });
              return transport.send({ url, method: init.method ?? 'POST', body, responseKind: encoding }, credentials, init.signal ?? controller.signal, headers);
            },
          )
          // The recorder cloned the response first. Only a server-sent-events branch has its line endings made LF: the
          // bytes of a protobuf frame are not text, and the client reads them as they came.
          .then((response) => (encoding === 'sse' ? canonicalizeLineEndings(response) : response)),
    });
    client.body = body;

    const observe: AgentSubscriber = {
      onRunFinishedEvent(params) {
        if (params.outcome === 'success') {
          outcome = {
            kind: 'success',
            ...(params.result !== undefined && isJsonValue(params.result) && { result: params.result }),
            pendingToolCallIds: params.pendingToolCallIds,
          };
        } else if (params.outcome === 'interrupt') outcome = { kind: 'interrupt', interrupts: params.interrupts };
        else outcome = { kind: 'cancelled' };
        writeRun();
      },
      onRunErrorEvent({ event }) {
        // Stopping mid-stream makes the client synthesize a RUN_ERROR that was never on the wire.
        if (controller.signal.aborted && event.code === 'abort') return;
        outcome = { kind: 'error', message: event.message, ...(event.code !== undefined && { code: event.code }) };
        writeRun();
      },
      onRunFailed({ error: failure }) {
        const finding = clientFailure(failure);
        if (finding) addRunFinding(finding.rule, finding.message);
      },
    };

    try {
      await client.runAgent(
        {
          runId: input.runId,
          tools: input.tools,
          context: input.context,
          forwardedProps: input.forwardedProps,
          ...(input.resume !== undefined && { resume: [...input.resume] }),
          abortController: controller,
        },
        observe,
      );
    } catch (failure) {
      // Stream problems are findings on the run and exchange; only a connection problem needs a banner.
      if (!controller.signal.aborted && clientFailure(failure) === undefined) error = `The run request failed: ${clip(describeError(failure))}`;
    }

    writeRun({ endedAt: epoch() });
    if (thread === current) {
      current.messages = structuredClone(client.messages);
      current.state = structuredClone(client.state);
      current.lastRunId = input.runId;
      replies = repliesFor(recordId, outcome, current.messages);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Replies
  // -------------------------------------------------------------------------------------------

  const apply = (change: Result<PendingReplies>): boolean => {
    if (!change.ok) {
      problem(change.error);
      return false;
    }
    replies = change.value;
    error = undefined;
    emit();
    return true;
  };

  /** The turn that carries every answer, built the same way for a developer's last answer and for an automatic reply. */
  function continuation(): Result<Turn> {
    if (!owesReplies(replies)) return fail('There is nothing waiting to continue');
    const resume = resumeEntries(replies);
    if (!resume.ok) return resume;
    const tools = toolMessages(replies, randomUUID);
    if (!tools.ok) return tools;
    const automatic = automaticReplies(replies);
    return ok({
      toolMessages: tools.value,
      ...(resume.value !== undefined && { resume: resume.value }),
      ...(thread.lastRunId !== undefined && { parentRunId: thread.lastRunId }),
      ...(automatic !== undefined && { automatic }),
    });
  }

  async function continueRun(): Promise<void> {
    const turn = continuation();
    if (!turn.ok) return problem(turn.error);
    await dispatch(turn.value);
  }

  /**
   * After a run that was sent and not stopped: answers what the profile covers, and returns the continuation when
   * nothing is left to answer by hand. At the limit nothing is answered and the notice says why. Returns nothing
   * when the profile covers none of what is owed, or only some of it: the developer finishes that.
   */
  function automaticTurn(): Turn | undefined {
    if (!owesReplies(replies)) return undefined;
    const answered = automate(replies, options.settings().profile);
    if (answered === replies) return undefined;
    if (streak >= AUTOMATIC_REPLY_LIMIT) {
      paused = true;
      emit();
      return undefined;
    }
    replies = answered;
    emit();
    if (isBlocked(replies)) return undefined;
    const turn = continuation();
    if (turn.ok) return turn.value;
    problem(turn.error);
    return undefined;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    transport,
    selectAgent: (selected) => changeTarget(selected, selected.url),
    setTarget: (url) => changeTarget(undefined, url),
    setAuth(next) {
      auth = next;
      emit();
    },
    setDeclaredCapabilities(next) {
      declared = next;
    },
    async send(text) {
      if (text.trim() === '') return problem('Enter a message to send');
      await dispatch({ userText: text });
    },
    stop,
    newThread() {
      stop();
      thread = { id: randomUUID(), messages: [], state: {} };
      replies = NO_REPLIES;
      streak = 0;
      paused = false;
      error = undefined;
      emit();
    },
    draftInterrupt(interruptId, draft) {
      apply(draftPending(replies, interruptId, draft));
    },
    async answerInterrupt(interruptId, status) {
      if (apply(answerPending(replies, interruptId, status)) && !isBlocked(replies)) await continueRun();
    },
    draftToolResult(toolCallId, result) {
      apply(draftTool(replies, toolCallId, result));
    },
    async submitToolResult(toolCallId) {
      if (apply(submitTool(replies, toolCallId)) && !isBlocked(replies)) await continueRun();
    },
    continueRun,
    async sendA2uiAction(action) {
      const checked = checkA2uiAction(action);
      if (!checked.ok) return problem(checked.error);
      await dispatch({ a2uiAction: checked.value });
    },
    async sendRaw(text) {
      try {
        JSON.parse(text);
      } catch (failure) {
        return problem(`Not valid JSON, so it was not sent: ${describeError(failure)}`);
      }
      const target = sendable();
      if (!target.ok) return problem(target.error);
      error = undefined;
      // The typed body goes out unchanged. Only the encoding comes from the settings, because a server that speaks
      // protobuf has to be asked for it.
      const encoding = encodingFor(options.settings().profile, agent?.preset?.encoding);
      const controller = new AbortController();
      hold(controller);
      emit();
      try {
        // Headers belong to the connection, so a raw request gets them as every other request does. Its body stays the text typed.
        const provided = await plugins.provideHeaders({ method: 'POST', url: target.value.href, body: text }, controller.signal);
        if (!provided.ok) {
          if (!controller.signal.aborted) error = provided.error;
          return;
        }
        const response = await recorderFor(controller).record(
          { kind: 'raw', method: 'POST', path: recordedPath(target.value), body: text, responseKind: encoding },
          () => transport.send({ url: target.value.href, method: 'POST', body: text, responseKind: encoding }, auth, controller.signal, provided.value),
        );
        void response.body?.cancel().catch(() => undefined);
      } catch (failure) {
        if (!controller.signal.aborted) error = `The raw request failed: ${clip(describeError(failure))}`;
      } finally {
        release(controller);
        emit();
      }
    },
  };
}
