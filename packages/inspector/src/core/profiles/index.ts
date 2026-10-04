// Client profiles and run input (FR-030, FR-031, FR-032, FR-036). Framework-free.
//
// A profile is seven settings that say what the inspector declares and sends: protocol version,
// client tools, context, whether A2UI renders, whether the render_a2ui tool is injected, the message
// mode and forwarded properties. Three optional settings say how the inspector answers a finished run's
// interrupts and client tool calls for the developer: the interrupt reply, a payload per interrupt
// reason and a result per tool. They never reach the run input. Nothing else is a profile field. In
// particular there is no place for an authentication header or token: the token lives in volatile
// connection state and reaches the guarded transport only, so it cannot enter a saved profile, an
// exported file or a run input.
//
// A profile is saved in browser storage and exported as the same version-0 envelope. Import and load
// validate the whole thing; a bad file is a visible error and the caller keeps what it had.
//
// composeRunInput builds the ordinary or continuation input from a profile, a prepared preset and the
// conversation state the runtime hands over, and checks it against the upstream RunAgentInput schema.
// An input that fails is returned as an error to show; it is never quietly fixed or sent.
import { RENDER_A2UI_TOOL } from '@ag-ui/a2ui-middleware';
import { PROTOCOL_VERSION, type Context, type Message, type ResumeEntry, type RunAgentInput, type Tool } from '@ag-ui/core';
import { ContextSchema, RunAgentInputSchema, ToolSchema } from '@ag-ui/core/schemas';
import {
  FORMAT_VERSION,
  type A2uiAction,
  type ClientProfileSettings,
  type InterruptReply,
  type JsonObject,
  type JsonValue,
  type ProfileEnvelope,
} from '../../contracts.ts';
import { describeError, fail, isJsonObject, isJsonValue, isRecord, ok, unexpectedKey, type Result } from '../config/validation.ts';
import { reservedPropertyProblem, selectMessages, type DispatchIds, type PreparedPreset } from '../presets/index.ts';

export const PROFILE_STORAGE_KEY = 'agui-inspector.profile';

const SETTINGS = ['protocolVersion', 'tools', 'context', 'renderA2ui', 'injectA2uiTool', 'messageMode', 'forwardedProps', 'interruptReply', 'interruptPayloads', 'toolResults'];

/** The pinned protocol version, no tools or context, A2UI rendered but not injected, the preset's mode. */
export function defaultProfile(): ClientProfileSettings {
  return { protocolVersion: PROTOCOL_VERSION, tools: [], context: [], renderA2ui: true, injectA2uiTool: false, forwardedProps: {} };
}

// ---------------------------------------------------------------------------------------------
// Validation, export, import
// ---------------------------------------------------------------------------------------------

const issueText = (issue: { path: PropertyKey[]; message: string } | undefined): string =>
  issue ? `${issue.path.map(String).join('.') || 'value'}: ${issue.message}` : 'invalid';

/**
 * `interruptPayloads`: absent, or an object from a nonempty interrupt reason to a JSON value other than null.
 * The protocol's run input schema refuses a null resume payload, so one could never be sent. An empty object
 * is read as absent. The reasons come from the agent, so they are never checked against a list.
 */
function parseInterruptPayloads(raw: unknown, where: string): Result<Record<string, JsonValue> | undefined> {
  if (raw === undefined) return ok(undefined);
  if (!isRecord(raw)) return fail(`${where}.interruptPayloads must be an object from interrupt reason to JSON`);
  const entries = Object.entries(raw);
  for (const [reason, payload] of entries) {
    if (reason === '') return fail(`${where}.interruptPayloads: an interrupt reason cannot be empty`);
    if (!isJsonValue(payload)) return fail(`${where}.interruptPayloads.${reason} must be JSON`);
    if (payload === null) return fail(`${where}.interruptPayloads.${reason} cannot be null: the protocol's run input does not accept a null answer`);
  }
  // fromEntries and structuredClone keep a reason named __proto__ as an own key.
  return ok(entries.length === 0 ? undefined : (structuredClone(Object.fromEntries(entries)) as Record<string, JsonValue>));
}

/**
 * `toolResults`: absent, or an object from the name of a tool of this profile to nonempty text. A name
 * the profile does not have would never match and fail silently, so it is an error. An empty object is
 * read as absent.
 */
function parseToolResults(raw: unknown, toolNames: ReadonlySet<string>, where: string): Result<Record<string, string> | undefined> {
  if (raw === undefined) return ok(undefined);
  if (!isRecord(raw)) return fail(`${where}.toolResults must be an object from tool name to text`);
  const entries = Object.entries(raw);
  for (const [name, text] of entries) {
    if (!toolNames.has(name)) return fail(`${where}.toolResults: no tool named "${name}"`);
    if (typeof text !== 'string' || text === '') return fail(`${where}.toolResults.${name} must be nonempty text`);
  }
  return ok(entries.length === 0 ? undefined : (Object.fromEntries(entries) as Record<string, string>));
}

/** Validates the settings. Only these fields are read, so nothing else can be carried along. */
export function parseProfileSettings(value: unknown, where = 'profile'): Result<ClientProfileSettings> {
  if (!isRecord(value)) return fail(`${where} must be an object`);
  const extra = unexpectedKey(value, SETTINGS, where, 'a profile');
  if (extra) return fail(extra);

  const { protocolVersion, tools, context, renderA2ui, injectA2uiTool, messageMode, forwardedProps, interruptReply } = value;
  if (typeof protocolVersion !== 'string' || protocolVersion === '') return fail(`${where}.protocolVersion must be a nonempty string`);
  if (!Array.isArray(tools)) return fail(`${where}.tools must be a list`);
  const names = new Set<string>();
  for (const [index, tool] of tools.entries()) {
    const parsed = isJsonValue(tool) ? ToolSchema.safeParse(tool) : undefined;
    if (!parsed?.success) return fail(`${where}.tools[${index}]: ${parsed ? issueText(parsed.error.issues[0]) : 'must be JSON'}`);
    if (names.has(parsed.data.name)) return fail(`${where}.tools: duplicate tool name "${parsed.data.name}"`);
    names.add(parsed.data.name);
  }
  if (!Array.isArray(context)) return fail(`${where}.context must be a list`);
  for (const [index, entry] of context.entries()) {
    const parsed = isJsonValue(entry) ? ContextSchema.safeParse(entry) : undefined;
    if (!parsed?.success) return fail(`${where}.context[${index}]: ${parsed ? issueText(parsed.error.issues[0]) : 'must be JSON'}`);
  }
  if (typeof renderA2ui !== 'boolean') return fail(`${where}.renderA2ui must be true or false`);
  if (typeof injectA2uiTool !== 'boolean') return fail(`${where}.injectA2uiTool must be true or false`);
  if (messageMode !== undefined && messageMode !== 'full' && messageMode !== 'turn') return fail(`${where}.messageMode must be "full" or "turn"`);
  if (!isJsonObject(forwardedProps)) return fail(`${where}.forwardedProps must be a JSON object`);
  const reserved = reservedPropertyProblem(forwardedProps, `${where}.forwardedProps`);
  if (reserved) return fail(reserved);
  if (interruptReply !== undefined && interruptReply !== 'resolve' && interruptReply !== 'cancel') return fail(`${where}.interruptReply must be "resolve" or "cancel"`);
  const payloads = parseInterruptPayloads(value.interruptPayloads, where);
  if (!payloads.ok) return payloads;
  const results = parseToolResults(value.toolResults, names, where);
  if (!results.ok) return results;

  return ok({
    protocolVersion,
    tools: structuredClone(tools) as Tool[],
    context: structuredClone(context) as Context[],
    renderA2ui,
    injectA2uiTool,
    ...(messageMode !== undefined && { messageMode }),
    forwardedProps: structuredClone(forwardedProps),
    ...(interruptReply !== undefined && { interruptReply }),
    ...(payloads.value !== undefined && { interruptPayloads: payloads.value }),
    ...(results.value !== undefined && { toolResults: results.value }),
  });
}

/** The version-0 envelope, built from the settings alone. The automation settings are written only when set. */
function envelope(settings: ClientProfileSettings): ProfileEnvelope {
  const { protocolVersion, tools, context, renderA2ui, injectA2uiTool, messageMode, forwardedProps, interruptReply, interruptPayloads, toolResults } = settings;
  return {
    version: FORMAT_VERSION,
    profile: {
      protocolVersion,
      tools,
      context,
      renderA2ui,
      injectA2uiTool,
      ...(messageMode !== undefined && { messageMode }),
      forwardedProps,
      ...(interruptReply !== undefined && { interruptReply }),
      ...(interruptPayloads !== undefined && { interruptPayloads }),
      ...(toolResults !== undefined && { toolResults }),
    },
  };
}

export const exportProfile = (settings: ClientProfileSettings): string => JSON.stringify(envelope(settings), null, 2);

// ---------------------------------------------------------------------------------------------
// Edits the settings panel makes to the automation settings. Each returns the profile to validate and apply; an
// unset setting is a missing key, so a profile never says "by hand".
// ---------------------------------------------------------------------------------------------

/** `map` with `key` set to `value`, or without it when `value` is undefined. Keeps the order; undefined once empty. */
function withEntry<T>(map: Readonly<Record<string, T>> | undefined, key: string, value: T | undefined): Record<string, T> | undefined {
  const entries = Object.entries(map ?? {});
  const at = entries.findIndex(([name]) => name === key);
  if (value === undefined) {
    if (at >= 0) entries.splice(at, 1);
  } else if (at >= 0) entries[at] = [key, value];
  else entries.push([key, value]);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export function setInterruptReply(settings: ClientProfileSettings, interruptReply: InterruptReply | undefined): ClientProfileSettings {
  const { interruptReply: _previous, ...rest } = settings;
  return interruptReply === undefined ? rest : { ...rest, interruptReply };
}

/** Sets the payload for an interrupt reason, or removes it when `payload` is undefined. */
export function setInterruptPayload(settings: ClientProfileSettings, reason: string, payload: JsonValue | undefined): ClientProfileSettings {
  const { interruptPayloads: _previous, ...rest } = settings;
  const next = withEntry(settings.interruptPayloads, reason, payload);
  return next === undefined ? rest : { ...rest, interruptPayloads: next };
}

/** Sets the scripted result of a tool, or removes it when `text` is undefined. */
export function setToolResult(settings: ClientProfileSettings, name: string, text: string | undefined): ClientProfileSettings {
  const { toolResults: _previous, ...rest } = settings;
  const next = withEntry(settings.toolResults, name, text);
  return next === undefined ? rest : { ...rest, toolResults: next };
}

/** Removes a tool together with its scripted result, so the profile stays valid. */
export function removeTool(settings: ClientProfileSettings, name: string): ClientProfileSettings {
  return setToolResult({ ...settings, tools: settings.tools.filter((tool) => tool.name !== name) }, name, undefined);
}

/** Parses an exported or saved profile. The version must be exactly 0. */
export function importProfile(text: string): Result<ClientProfileSettings> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return fail(`Profile is not valid JSON: ${describeError(error)}`);
  }
  if (!isRecord(json)) return fail('Profile must be a JSON object with a "version" and a "profile"');
  const extra = unexpectedKey(json, ['version', 'profile'], 'profile file', 'a profile');
  if (extra) return fail(extra);
  if (json.version !== FORMAT_VERSION) return fail(`Unsupported profile version ${String(JSON.stringify(json.version))}; this inspector reads version ${FORMAT_VERSION}`);
  if (!('profile' in json)) return fail('Profile file needs a "profile"');
  return parseProfileSettings(json.profile);
}

// ---------------------------------------------------------------------------------------------
// Browser persistence
// ---------------------------------------------------------------------------------------------

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function saveProfile(storage: StorageLike, settings: ClientProfileSettings): Result<undefined> {
  try {
    storage.setItem(PROFILE_STORAGE_KEY, exportProfile(settings));
    return ok(undefined);
  } catch (error) {
    return fail(`Browser storage is unavailable, so the profile was not saved: ${describeError(error)}`);
  }
}

/** `ok(undefined)` when nothing is saved; an error when storage cannot be read or holds a bad profile. */
export function loadProfile(storage: StorageLike): Result<ClientProfileSettings | undefined> {
  let text: string | null;
  try {
    text = storage.getItem(PROFILE_STORAGE_KEY);
  } catch (error) {
    return fail(`Browser storage is unavailable, so the saved profile was not read: ${describeError(error)}`);
  }
  if (text === null) return ok(undefined);
  const parsed = importProfile(text);
  return parsed.ok ? parsed : fail(`The saved profile was not loaded. ${parsed.error}`);
}

// ---------------------------------------------------------------------------------------------
// Run input
// ---------------------------------------------------------------------------------------------

export interface RunInputParams {
  readonly ids: DispatchIds;
  /** The preset resolved for this dispatch attempt. */
  readonly prepared: PreparedPreset;
  readonly profile: ClientProfileSettings;
  /** The whole conversation, including what this turn adds. */
  readonly transcript: readonly Message[];
  /** What this turn adds: a user message, tool results, or nothing for a resume. */
  readonly turnMessages: readonly Message[];
  /** The client's current state; `{}` before any exists. */
  readonly state?: JsonValue;
  /** The run this one continues from. */
  readonly parentRunId?: string;
  /** Answers to the interrupts that ended the previous run. */
  readonly resume?: readonly ResumeEntry[];
  /** The surface action that starts this run. */
  readonly a2uiAction?: A2uiAction;
}

/**
 * The input for one conversation run. Profile settings override the preset where they overlap: the
 * message mode, and same-named forwarded properties. Injecting the render_a2ui tool puts the official
 * declaration last and drops a same-named profile tool, so a name never appears twice. Whether A2UI
 * renders is a display choice and does not touch the input.
 */
export function composeRunInput(params: RunInputParams): Result<RunAgentInput> {
  const { ids, prepared, profile, a2uiAction } = params;
  if (ids.threadId === '' || ids.runId === '') return fail('Run input needs a thread id and a run id');

  const generic: JsonObject = { ...prepared.forwardedProps, ...profile.forwardedProps };
  const reserved = reservedPropertyProblem(generic, 'forwardedProps');
  if (reserved) return fail(reserved);
  const forwardedProps: JsonObject = a2uiAction
    ? {
        ...generic,
        a2uiAction: {
          userAction: {
            name: a2uiAction.name,
            surfaceId: a2uiAction.surfaceId,
            sourceComponentId: a2uiAction.sourceComponentId,
            context: a2uiAction.context,
            timestamp: a2uiAction.timestamp,
          },
        },
      }
    : generic;

  const tools: Tool[] = profile.injectA2uiTool
    ? [...profile.tools.filter((tool) => tool.name !== RENDER_A2UI_TOOL.name), RENDER_A2UI_TOOL]
    : [...profile.tools];

  const input: RunAgentInput = {
    threadId: ids.threadId,
    runId: ids.runId,
    protocolVersion: profile.protocolVersion,
    ...(params.parentRunId !== undefined && { parentRunId: params.parentRunId }),
    state: params.state ?? {},
    messages: selectMessages(profile.messageMode ?? prepared.messageMode, params.transcript, params.turnMessages),
    tools,
    context: [...profile.context],
    forwardedProps,
    ...(params.resume !== undefined && params.resume.length > 0 && { resume: [...params.resume] }),
  };

  const checked = RunAgentInputSchema.safeParse(input);
  return checked.success ? ok(input) : fail(`Run input is invalid: ${issueText(checked.error.issues[0])}`);
}
