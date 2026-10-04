// The plugin host (specs/014-plugin-api). Framework-free: no React, no DOM beyond the element type a renderer is given.
//
// A plugin is an ES module on the page's own origin whose default export is a function. The host requests every module
// together, then activates the plugins one at a time in the order they were written. Each activation gets its own
// pending set and a frozen API object. The set is merged into the host when the function ends without error and thrown
// away otherwise, so a plugin that fails half way leaves nothing behind. The set closes when the activation ends, however
// it ends, and a later call to the API does nothing and says so.
//
// Every failure is one warning: the plugin, what failed and its message, cut short. Nothing a plugin does stops the page.
// The runtime asks the host at the send path (`beforeRun`, `headers`), and the views ask it for renderers.
import type { RunAgentInput } from '@ag-ui/core';
import {
  PLUGIN_API_VERSION,
  type ActivityData,
  type BeforeRunHook,
  type CustomEventData,
  type HeaderProvider,
  type PluginApi,
  type ProvidedHeaders,
  type Render,
  type Unsubscribe,
} from '../../contracts.ts';
import { A2UI_ACTIVITY_TYPE } from '../a2ui/index.ts';
import { describeError, fail, isJsonValue, ok, pluginSource, type PageLocation, type Result } from '../config/validation.ts';
import { checkRunInput } from '../profiles/index.ts';
import { providedHeaderProblem } from '../runtime/transport.ts';

export const PLUGIN_TIMEOUT_MS = 10_000;
export const MAX_WARNINGS = 20;
export const MAX_MESSAGE = 200;

/** What the registry holds for a custom event name or an activity type: the draw function and who registered it. */
export interface PluginRenderer<T> {
  /** The registering plugin, by the path of its address. Warnings name a plugin this way. */
  readonly plugin: string;
  readonly render: Render<T>;
}

export interface PluginHost {
  /** Requests every module, activates each plugin in order, and resolves when all have loaded or failed. Never rejects. */
  load(addresses: readonly string[], importModule: (address: string) => Promise<unknown>, page: PageLocation): Promise<void>;
  /** Plugins whose activation ended without error. */
  count(): number;
  /** What the page shows. The same array until it changes. */
  warnings(): readonly string[];
  subscribe(listener: () => void): Unsubscribe;
  /** A failure of `extension` in `plugin`, from a hook, a provider or a renderer. */
  report(plugin: string, extension: string, error: unknown): void;
  eventRenderer(name: string): PluginRenderer<CustomEventData> | undefined;
  activityRenderer(type: string): PluginRenderer<ActivityData> | undefined;
  /**
   * The hooks of `beforeRun`, in order, each seeing a copy of what the one before returned. Resolves with the same input
   * object, uncopied, when no hook is registered. A failure is `{ ok: false }` with a message for the line under the composer;
   * a stop is `{ ok: false, error: 'Stopped' }` and reports nothing.
   */
  beforeRun(run: { readonly input: RunAgentInput; readonly agentId?: string; readonly url: string }, signal: AbortSignal): Promise<Result<RunAgentInput>>;
  /** The headers of every provider for one request, a later provider winning for a name compared without case. Same failure rules. */
  provideHeaders(request: { readonly method: string; readonly url: string; readonly body?: string }, signal: AbortSignal): Promise<Result<ProvidedHeaders>>;
}

export interface PluginHostOptions {
  /** For the import and for each activation. Tests shorten it. */
  readonly timeoutMs?: number;
}

/** A plugin is named by the path and the query of its address: the origin is the page's. */
function labelOf(address: string): string {
  const { pathname, search } = new URL(address);
  return `${pathname}${search}`;
}

class Timeout extends Error {}
class Stopped extends Error {}

/** Settles with `work`, or rejects with `Stopped` the moment `signal` is aborted. */
function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Stopped());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Stopped());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** Settles with `work`, or rejects with a `Timeout` after `ms`. The timer never outlives either. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => void (timer = setTimeout(() => reject(new Timeout()), ms)));
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

const seconds = (ms: number) => String(ms / 1000);

/**
 * What a hook returned, as an input that may be sent: JSON (checked before anything is read from it, since a cycle or a
 * function cannot be sent), valid for the protocol, and the same thread and run. The result is a copy made by `JSON.parse`,
 * so a plugin that kept the object it returned cannot change what is sent or recorded afterwards.
 */
function adjustedInput(answer: unknown, current: RunAgentInput): Result<RunAgentInput> {
  let text: string;
  try {
    text = JSON.stringify(answer);
  } catch {
    return fail('an invalid input: it is not JSON, so it cannot be sent');
  }
  if (text === undefined || !isJsonValue(answer)) return fail('an invalid input: it is not JSON, so it cannot be sent');
  const copy = JSON.parse(text) as RunAgentInput;
  const checked = checkRunInput(copy);
  if (!checked.ok) return fail(`an invalid input: ${checked.error}`);
  if (copy.threadId !== current.threadId || copy.runId !== current.runId) return fail('an invalid input: it changed threadId or runId');
  return ok(copy);
}

export function createPluginHost(options: PluginHostOptions = {}): PluginHost {
  const timeoutMs = options.timeoutMs ?? PLUGIN_TIMEOUT_MS;
  const eventRenderers = new Map<string, PluginRenderer<CustomEventData>>();
  const activityRenderers = new Map<string, PluginRenderer<ActivityData>>();
  const hooks: Array<{ plugin: string; run: BeforeRunHook }> = [];
  const providers: Array<{ plugin: string; provide: HeaderProvider }> = [];
  let active = 0;

  // ---- warnings ----
  const list: string[] = [];
  let snapshot: readonly string[] = [];
  const listeners = new Set<() => void>();
  const warn = (plugin: string, text: string): void => {
    const line = `${plugin}: ${text}`;
    if (list.length >= MAX_WARNINGS || list.includes(line)) return;
    list.push(line);
    snapshot = [...list];
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A failing view must not stop a plugin or a run.
      }
    }
  };
  const clip = (error: unknown): string => {
    const message = describeError(error);
    return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message;
  };

  // ---- activation ----
  async function activate(plugin: string, activateFn: (api: PluginApi) => unknown): Promise<void> {
    const pending = {
      hooks: [] as Array<{ plugin: string; run: BeforeRunHook }>,
      providers: [] as Array<{ plugin: string; provide: HeaderProvider }>,
      events: new Map<string, PluginRenderer<CustomEventData>>(),
      activities: new Map<string, PluginRenderer<ActivityData>>(),
    };
    let open = true;
    // A call after the activation ended is ignored with a warning. A call with a bad argument throws, which fails the activation.
    const whileOpen = (name: string, register: () => void): void => {
      if (!open) return warn(plugin, `${name} was called after activation and was ignored`);
      register();
    };
    const needFunction = (name: string, value: unknown) => {
      if (typeof value !== 'function') throw new TypeError(`${name} needs a function`);
    };
    const claim = <T>(name: 'renderCustomEvent' | 'renderActivity', key: string, render: Render<T>, held: Map<string, PluginRenderer<T>>, mine: Map<string, PluginRenderer<T>>): void => {
      if (typeof key !== 'string' || key === '') throw new TypeError(`${name} needs a nonempty name`);
      needFunction(name, render);
      if (name === 'renderActivity' && key === A2UI_ACTIVITY_TYPE) return warn(plugin, `renderActivity(${key}) is drawn by the A2UI view; ignored`);
      const owner = held.get(key) ?? mine.get(key);
      if (owner !== undefined) return warn(plugin, `${name}(${key}) is already registered by ${owner.plugin}; ignored`);
      mine.set(key, { plugin, render });
    };
    const api: PluginApi = Object.freeze({
      version: PLUGIN_API_VERSION,
      beforeRun: (hook: BeforeRunHook) =>
        whileOpen('beforeRun', () => {
          needFunction('beforeRun', hook);
          pending.hooks.push({ plugin, run: hook });
        }),
      provideHeaders: (provider: HeaderProvider) =>
        whileOpen('provideHeaders', () => {
          needFunction('provideHeaders', provider);
          pending.providers.push({ plugin, provide: provider });
        }),
      renderCustomEvent: (name: string, render: Render<CustomEventData>) => whileOpen('renderCustomEvent', () => claim('renderCustomEvent', name, render, eventRenderers, pending.events)),
      renderActivity: (type: string, render: Render<ActivityData>) => whileOpen('renderActivity', () => claim('renderActivity', type, render, activityRenderers, pending.activities)),
    });
    try {
      await within(Promise.resolve().then(() => activateFn(api)), timeoutMs);
    } catch (error) {
      open = false;
      return warn(plugin, error instanceof Timeout ? `activation did not finish within ${seconds(timeoutMs)} seconds` : `activation failed: ${clip(error)}`);
    }
    open = false;
    hooks.push(...pending.hooks);
    providers.push(...pending.providers);
    for (const [key, entry] of pending.events) eventRenderers.set(key, entry);
    for (const [key, entry] of pending.activities) activityRenderers.set(key, entry);
    active += 1;
  }

  return {
    async load(addresses, importModule, page) {
      // Every module is requested at once. Activation then follows the written order, whichever arrives first.
      const loaded = await Promise.all(
        addresses.map(async (address, index) => {
          // The configuration reader checked this already. Code is loaded only here, so the check is made again.
          const source = pluginSource(address, page);
          if (!source.ok) return void warn(`plugins[${index}]`, "was not loaded; plugins load from this page's origin only");
          const plugin = labelOf(source.value);
          try {
            return { plugin, module: await within(importModule(source.value), timeoutMs) };
          } catch (error) {
            return void warn(plugin, error instanceof Timeout ? `did not load within ${seconds(timeoutMs)} seconds` : 'could not be loaded');
          }
        }),
      );
      for (const entry of loaded) {
        if (entry === undefined) continue;
        const exported = (entry.module as { default?: unknown } | null)?.default;
        if (typeof exported !== 'function') warn(entry.plugin, 'the default export is not a function');
        else await activate(entry.plugin, exported as (api: PluginApi) => unknown);
      }
    },
    async beforeRun(run, signal) {
      if (hooks.length === 0) return ok(run.input);
      let current = run.input;
      for (const { plugin, run: hook } of hooks) {
        let answer: unknown;
        try {
          answer = await untilStopped(Promise.resolve().then(() => hook({ input: structuredClone(current), ...(run.agentId !== undefined && { agentId: run.agentId }), url: run.url, signal })), signal);
        } catch (error) {
          if (error instanceof Stopped) return fail('Stopped');
          warn(plugin, `beforeRun threw: ${clip(error)}`);
          return fail(`Plugin ${plugin} stopped the run in beforeRun: ${clip(error)}`);
        }
        if (answer === undefined) continue;
        const next = adjustedInput(answer, current);
        if (!next.ok) {
          warn(plugin, `beforeRun returned ${next.error}`);
          return fail(`Plugin ${plugin} returned ${next.error}`);
        }
        current = next.value;
      }
      return ok(current);
    },
    async provideHeaders(request, signal) {
      if (providers.length === 0) return ok({});
      const merged = new Map<string, [string, string]>();
      for (const { plugin, provide } of providers) {
        let answer: unknown;
        try {
          answer = await untilStopped(Promise.resolve().then(() => provide({ ...request, signal })), signal);
        } catch (error) {
          if (error instanceof Stopped) return fail('Stopped');
          warn(plugin, `provideHeaders threw: ${clip(error)}`);
          return fail(`Plugin ${plugin} could not provide headers: ${clip(error)}`);
        }
        if (answer === undefined) continue;
        const refused = (reason: string) => {
          warn(plugin, `provideHeaders returned ${reason}`);
          return fail(`Plugin ${plugin} returned ${reason}`);
        };
        if (!isPlainObject(answer)) return refused('something that is not an object of headers');
        for (const [name, value] of Object.entries(answer)) {
          const problem = providedHeaderProblem(name, value);
          if (problem !== undefined) return refused(`an invalid header: ${problem}`);
          merged.set(name.toLowerCase(), [name, value as string]);
        }
      }
      return ok(Object.fromEntries(merged.values()));
    },
    count: () => active,
    warnings: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    report: (plugin, extension, error) => warn(plugin, `${extension} threw: ${clip(error)}`),
    eventRenderer: (name) => eventRenderers.get(name),
    activityRenderer: (type) => activityRenderers.get(type),
  };
}
