// Headless sessions (feature 018): the page's runtime, recorder, frame reader and rules, run in Node against one target.
// This file holds the only request and the only file writes of src/headless (tests/headless/outbound.test.ts).
//
// The policy's page origin is the target's origin, so the runtime may reach the target and nothing else. Headers live in
// the closure of the fetch wrapper only: they never reach the runtime state, the store, the recorder or anything returned.
import { readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ClientProfileSettings, Exchange, Finding, InspectionSession, JsonValue, RawFrame, SessionEnvelope, TransportPolicy } from '../contracts.ts';
import { importProfile, defaultProfile } from '../core/profiles/index.ts';
import { projectConversation, type ConversationModel } from '../core/projection/index.ts';
import type { RecorderClock } from '../core/recorder/index.ts';
import { createRuntime, type Runtime } from '../core/runtime/index.ts';
import { parseSession, serializeSession } from '../core/session-files/index.ts';
import { createSessionStore } from '../core/store/index.ts';
import { createHeadlessSurfaces, type HeadlessSurfaces, type SurfaceView } from './a2ui.ts';
import { checkHeader, checkTarget } from './target.ts';

export const DEFAULT_TIMEOUT_MS = 60_000;

export interface SessionOptions {
  /** An absolute http or https URL without credentials, query or fragment. */
  readonly target: string;
  /** Sent with every request to the target. Never stored, returned or printed. */
  readonly headers?: Readonly<Record<string, string>>;
  /** A client profile, or the path of a profile file. */
  readonly profile?: ClientProfileSettings | string;
  /** The limit of every step. Default 60 seconds. */
  readonly timeoutMs?: number;
  readonly clock?: RecorderClock;
  readonly ids?: () => string;
}

export interface Step {
  /** No run is active and capture has ended. */
  readonly idle: boolean;
  /** The limit passed and capture was stopped. */
  readonly timedOut: boolean;
  /** Interrupt and tool call ids still unanswered before a continuation can be sent. */
  readonly waitingFor: readonly string[];
  readonly newFrames: number;
  readonly newFindings: readonly Finding[];
  /** Why the step could not send or complete, as the runtime words it. Never holds a header value. */
  readonly error?: string;
}

export interface PendingInterrupt {
  readonly id: string;
  readonly reason?: string;
  readonly message?: string;
  readonly responseSchema?: JsonValue;
}

export interface PendingToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments?: JsonValue;
  readonly argumentsText: string;
}

export interface Pending {
  readonly interrupts: readonly PendingInterrupt[];
  readonly toolCalls: readonly PendingToolCall[];
  readonly notice?: string;
}

export interface ReadonlySession {
  frames(): RawFrame[];
  exchanges(): Exchange[];
  findings(): Finding[];
  conversation(): ConversationModel;
  state(): JsonValue | undefined;
  pending(): Pending;
  surfaces(): SurfaceView[];
  /**
   * Writes the session file. This is an export: raw frames and request bodies may contain personal or sensitive data,
   * including a credential the target echoed. Headers are not in the file. Refuses an existing file unless `overwrite`.
   */
  save(file: string, options?: { readonly overwrite?: boolean }): Promise<void>;
  /** The session file as an object. */
  toJSON(): SessionEnvelope;
}

export interface Session extends ReadonlySession {
  send(text: string): Promise<Step>;
  /** Sends exactly this text to the target, valid or not. */
  sendRaw(json: string): Promise<Step>;
  answerInterrupt(id: string, status: 'resolved' | 'cancelled', payload?: JsonValue): Promise<Step>;
  submitToolResult(toolCallId: string, result: string): Promise<Step>;
  readonly a2ui: {
    /** Changes a surface's data model. Sends nothing. */
    set(surfaceId: string, pointer: string, value: JsonValue): void;
    /** Runs the component's action as the renderer would, and waits like any step. */
    fire(surfaceId: string, componentId: string): Promise<Step>;
  };
  /** Ends the connection of every request still being sent or recorded. */
  stop(): void;
  /** Stops capture and forgets the headers. Later steps reject. */
  close(): void;
}

const copy = <T>(value: T): T => structuredClone(value);

async function profileOf(option: SessionOptions['profile']): Promise<ClientProfileSettings> {
  if (option === undefined) return defaultProfile();
  if (typeof option !== 'string') return option;
  const parsed = importProfile(await readFile(option, 'utf8'));
  if (!parsed.ok) throw new Error(`The profile file is not valid: ${parsed.error}`);
  return parsed.value;
}

function heldHeaders(headers: Readonly<Record<string, string>>): Map<string, string> {
  const held = new Map<string, string>();
  for (const [name, value] of Object.entries(headers)) {
    const problem = checkHeader(name, value);
    if (problem === 'reserved') throw new Error('headers must not set Host, Content-Length, Transfer-Encoding or Connection');
    if (problem !== undefined) throw new Error('headers must have a valid name and a nonempty value');
    held.set(name, value);
  }
  return held;
}

const TARGET_PROBLEMS = {
  form: 'target must be an absolute http or https URL',
  credentials: 'target must not contain credentials; use headers',
  query: 'target must not contain a query or a fragment; use headers for secrets',
} as const;

/** The reads every session has, live or loaded, over a function that returns the current recording. */
function reads(snapshot: () => InspectionSession, surfaces: HeadlessSurfaces, pending: () => Pending): ReadonlySession {
  return {
    frames: () => copy([...snapshot().frames]),
    exchanges: () => copy([...snapshot().exchanges]),
    findings: () => copy([...snapshot().findings]),
    conversation: () => projectConversation(snapshot()),
    state: () => copy(projectConversation(snapshot()).state.current),
    pending,
    surfaces: () => surfaces.views(),
    async save(file, options = {}) {
      await writeFile(file, serializeSession(snapshot()), { encoding: 'utf8', flag: options.overwrite === true ? 'w' : 'wx' }).catch((error: NodeJS.ErrnoException) => {
        throw new Error(error.code === 'EEXIST' ? 'The file exists; pass overwrite to replace it' : `The session file could not be written (${error.code ?? 'error'})`);
      });
    },
    toJSON: () => JSON.parse(serializeSession(snapshot())) as SessionEnvelope,
  };
}

/** Writes the session next to a failed assertion (assert.ts). Returns the path written. */
export function writeFailureFile(directory: string, name: string, session: ReadonlySession): string {
  const file = path.join(path.resolve(directory), name);
  writeFileSync(file, JSON.stringify(session.toJSON()), { encoding: 'utf8', flag: 'wx' });
  return file;
}

const NONE: Pending = { interrupts: [], toolCalls: [] };

/** A session file, read as the page imports it. It has the reads only. */
export async function loadSession(file: string): Promise<ReadonlySession> {
  const parsed = parseSession(await readFile(file, 'utf8'));
  if (!parsed.ok) throw new Error(`Import failed: ${parsed.error}`);
  const session = parsed.session;
  return reads(() => session, createHeadlessSurfaces(() => session), () => NONE);
}

export async function openSession(options: SessionOptions): Promise<Session> {
  const checked = checkTarget(options.target);
  if (!checked.ok) throw new Error(TARGET_PROBLEMS[checked.problem]);
  let held: Map<string, string> | undefined = heldHeaders(options.headers ?? {});
  const profile = await profileOf(options.profile);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const policy: TransportPolicy = { mode: 'hosted', pageOrigin: checked.url.origin, allowedOrigins: [] };
  const store = createSessionStore({ schedule: (callback) => queueMicrotask(callback) });
  const runtime: Runtime = createRuntime({
    store,
    policy,
    settings: () => ({ profile, variables: {} }),
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      for (const [name, value] of held ?? []) headers.set(name, value);
      return globalThis.fetch(input, { ...init, headers });
    },
    ...(options.ids !== undefined && { randomUUID: options.ids }),
    ...(options.clock !== undefined && { clock: options.clock }),
  });
  runtime.setTarget(checked.url.href);

  let closed = false;
  const snapshot = () => store.snapshot();

  const pending = (): Pending => {
    const state = runtime.getState();
    const runs = snapshot().runs;
    const interrupts = state.interrupts
      .filter((answer) => answer.status === 'unanswered')
      .map((answer): PendingInterrupt => {
        const run = runs.find((candidate) => candidate.id === answer.runId);
        const declared = run?.outcome.kind === 'interrupt' ? run.outcome.interrupts.find((interrupt) => interrupt.id === answer.interruptId) : undefined;
        return {
          id: answer.interruptId,
          ...(declared?.reason !== undefined && { reason: declared.reason }),
          ...(declared?.message !== undefined && { message: declared.message }),
          ...(answer.responseSchema !== undefined && { responseSchema: copy(answer.responseSchema) }),
        };
      });
    const toolCalls = state.toolResults
      .filter((draft) => draft.status === 'pending')
      .map((draft): PendingToolCall => ({
        id: draft.toolCallId,
        name: draft.toolName,
        argumentsText: draft.argumentsText,
        ...(draft.argumentsParsed !== undefined && { arguments: copy(draft.argumentsParsed) }),
      }));
    return { interrupts, toolCalls, ...(state.notice !== undefined && { notice: state.notice }) };
  };

  const waitingFor = () => {
    const now = pending();
    return [...now.interrupts.map((interrupt) => interrupt.id), ...now.toolCalls.map((call) => call.id)];
  };

  const isIdle = () => !runtime.getState().running && !runtime.getState().capturing;

  /** Resolves when no run is active and capture has ended: the recorder's own end marker decides. */
  const idle = () =>
    new Promise<void>((resolve) => {
      if (isIdle()) return resolve();
      const unsubscribe = runtime.subscribe(() => {
        if (!isIdle()) return;
        unsubscribe();
        resolve();
      });
    });

  async function step(action: () => Promise<void>): Promise<Step> {
    if (closed) throw new Error('The session is closed');
    const before = snapshot();
    const frameCount = before.frames.length;
    const findingCount = before.findings.length;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), timeoutMs)));
    const done = action().then(idle);
    const outcome = await Promise.race([done.then(() => 'done' as const), limit]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      runtime.stop();
      await idle();
    }
    const after = snapshot();
    const error = runtime.getState().error;
    return {
      idle: isIdle(),
      timedOut: outcome === 'timeout',
      waitingFor: waitingFor(),
      newFrames: after.frames.length - frameCount,
      newFindings: copy(after.findings.slice(findingCount)),
      ...(error !== undefined && { error }),
    };
  }

  const surfaces = createHeadlessSurfaces(snapshot);

  return {
    ...reads(snapshot, surfaces, pending),
    send: (text) => step(() => runtime.send(text)),
    sendRaw: (json) => step(() => runtime.sendRaw(json)),
    async answerInterrupt(id, status, payload) {
      if (closed) throw new Error('The session is closed');
      if (!pending().interrupts.some((interrupt) => interrupt.id === id)) throw new Error('No pending interrupt with that id');
      if (payload !== undefined) runtime.draftInterrupt(id, payload);
      return step(() => runtime.answerInterrupt(id, status));
    },
    async submitToolResult(toolCallId, result) {
      if (closed) throw new Error('The session is closed');
      if (!pending().toolCalls.some((call) => call.id === toolCallId)) throw new Error('No pending tool call with that id');
      runtime.draftToolResult(toolCallId, result);
      return step(() => runtime.submitToolResult(toolCallId));
    },
    a2ui: {
      set: (surfaceId, pointer, value) => surfaces.set(surfaceId, pointer, value),
      async fire(surfaceId, componentId) {
        if (closed) throw new Error('The session is closed');
        const action = await surfaces.fire(surfaceId, componentId);
        return step(async () => {
          if (action !== undefined) await runtime.sendA2uiAction(action);
        });
      },
    },
    stop: () => runtime.stop(),
    close() {
      if (closed) return;
      closed = true;
      runtime.stop();
      held = undefined;
    },
  };
}
