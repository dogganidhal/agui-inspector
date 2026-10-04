// Presets (FR-026, FR-027, FR-028). Framework-free: no React, no DOM, no network.
//
// A preset is what an application needs around a run: editable variables, ordered preparation
// requests, forwarded properties, a message mode and quick messages. This module checks a preset's
// shape and, once per dispatch attempt, resolves it: variables are filled in, templates expanded,
// and the preparation plan and forwarded properties come out ready to use. It never sends anything;
// the runtime executes the plan.
//
// Templates are `{{name}}`. A string that is exactly one placeholder takes the variable's own JSON
// value, so a JSON object stays an object. A placeholder inside a longer string becomes text: a text
// variable as written, a JSON variable serialized. A name with no value is an error that says where
// it was used, never an empty string. Only values are templated, never keys, and nothing is evaluated.
import type { Message } from '@ag-ui/core';
import type { Encoding, JsonObject, JsonValue, MessageMode, PreparationRequest, Preset, PresetVariable } from '../../contracts.ts';
import { fail, isJsonObject, isJsonValue, isRecord, ok, unexpectedKey, urlProblem, type Result } from '../config/validation.ts';

export const BUILT_IN_VARIABLES = ['threadId', 'runId', 'uuid'] as const;

/** Keys the protocol or the A2UI action owns; generic forwarded-property editing cannot set them. */
export const RESERVED_FORWARDED_PROPS = ['a2uiAction'] as const;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{([^{}]*)\}\}$/;
const METHOD = /^[A-Za-z]+$/;

// ---------------------------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------------------------

/** An error message if `props` use a reserved key, else undefined. Shared with client profiles. */
export function reservedPropertyProblem(props: JsonObject, where: string): string | undefined {
  const key = RESERVED_FORWARDED_PROPS.find((reserved) => reserved in props);
  return key ? `${where}: "${key}" is reserved; the A2UI action sets it` : undefined;
}

function parseVariable(name: string, value: unknown, where: string): Result<PresetVariable> {
  const label = `${where}.variables.${name}`;
  if (!NAME.test(name)) return fail(`${where}: variable name "${name}" is not valid; use letters, digits and underscores, not starting with a digit`);
  if ((BUILT_IN_VARIABLES as readonly string[]).includes(name)) return fail(`${where}: "${name}" is a built-in variable and cannot be redefined`);
  if (!isRecord(value)) return fail(`${label} must be an object with a default`);
  const extra = unexpectedKey(value, ['default', 'type'], label, 'a preset');
  if (extra) return fail(extra);
  if (value.type !== undefined && value.type !== 'text' && value.type !== 'json') return fail(`${label}: type must be "text" or "json"`);
  if (!('default' in value)) return fail(`${label}: default is required`);
  if (!isJsonValue(value.default)) return fail(`${label}: default must be JSON`);
  if (value.type !== 'json' && typeof value.default !== 'string') return fail(`${label}: default must be a string for a text variable; use "type": "json" for other values`);
  return ok({ default: value.default, ...(value.type !== undefined && { type: value.type }) });
}

function parsePreparation(value: unknown, index: number, where: string): Result<PreparationRequest> {
  const label = `${where}.prepare[${index}]`;
  if (!isRecord(value)) return fail(`${label} must be an object`);
  const extra = unexpectedKey(value, ['method', 'path', 'body'], label, 'a preset');
  if (extra) return fail(extra);
  if (typeof value.method !== 'string' || !METHOD.test(value.method)) return fail(`${label}.method must be an HTTP method such as "PUT"`);
  const pathError = urlProblem(value.path, `${label}.path`);
  if (pathError) return fail(pathError);
  if ('body' in value && !isJsonValue(value.body)) return fail(`${label}.body must be JSON`);
  return ok({ method: value.method, path: value.path as string, ...('body' in value && { body: value.body as JsonValue }) });
}

/** Checks a preset's shape. `where` names the owner in messages, for example `agent "support": preset`. */
export function parsePreset(value: unknown, where: string): Result<Preset> {
  if (!isRecord(value)) return fail(`${where} must be an object`);
  const extra = unexpectedKey(value, ['variables', 'forwardedProps', 'messages', 'encoding', 'prepare', 'quickMessages'], where, 'a preset');
  if (extra) return fail(extra);
  let preset: Preset = {};

  if (value.variables !== undefined) {
    if (!isRecord(value.variables)) return fail(`${where}.variables must be an object`);
    const variables: Record<string, PresetVariable> = {};
    for (const [name, entry] of Object.entries(value.variables)) {
      const variable = parseVariable(name, entry, where);
      if (!variable.ok) return variable;
      variables[name] = variable.value;
    }
    preset = { ...preset, variables };
  }
  if (value.forwardedProps !== undefined) {
    if (!isJsonObject(value.forwardedProps)) return fail(`${where}.forwardedProps must be a JSON object`);
    const reserved = reservedPropertyProblem(value.forwardedProps, `${where}.forwardedProps`);
    if (reserved) return fail(reserved);
    preset = { ...preset, forwardedProps: value.forwardedProps };
  }
  if (value.messages !== undefined) {
    if (value.messages !== 'full' && value.messages !== 'turn') return fail(`${where}.messages must be "full" or "turn"`);
    preset = { ...preset, messages: value.messages };
  }
  if (value.encoding !== undefined) {
    if (value.encoding !== 'sse' && value.encoding !== 'protobuf') return fail(`${where}.encoding must be "sse" or "protobuf"`);
    preset = { ...preset, encoding: value.encoding };
  }
  if (value.prepare !== undefined) {
    if (!Array.isArray(value.prepare)) return fail(`${where}.prepare must be a list of requests`);
    const prepare: PreparationRequest[] = [];
    for (const [index, entry] of value.prepare.entries()) {
      const request = parsePreparation(entry, index, where);
      if (!request.ok) return request;
      prepare.push(request.value);
    }
    preset = { ...preset, prepare };
  }
  if (value.quickMessages !== undefined) {
    const messages = value.quickMessages;
    if (!Array.isArray(messages) || !messages.every((message) => typeof message === 'string' && message !== '')) {
      return fail(`${where}.quickMessages must be a list of nonempty strings`);
    }
    preset = { ...preset, quickMessages: messages as string[] };
  }
  return ok(preset);
}

// ---------------------------------------------------------------------------------------------
// Resolution, once per dispatch attempt
// ---------------------------------------------------------------------------------------------

export interface DispatchIds {
  readonly threadId: string;
  readonly runId: string;
}

export interface ResolvedVariable {
  readonly kind: 'text' | 'json';
  readonly value: JsonValue;
}

type Variables = Readonly<Record<string, ResolvedVariable>>;

export interface PreparedPreset {
  /** Built-ins and the preset's variables, as used in this attempt. */
  readonly variables: Variables;
  /** In declared order, templates expanded. */
  readonly preparations: readonly PreparationRequest[];
  readonly forwardedProps: JsonObject;
  readonly messageMode: MessageMode;
  /** The preset's default encoding. Absent when the preset sets none. */
  readonly encoding?: Encoding;
}

const copy = (value: JsonValue): JsonValue => (typeof value === 'object' && value !== null ? structuredClone(value) : value);

function expandString(text: string, variables: Variables, where: string, errors: string[]): JsonValue {
  const lookup = (inner: string): ResolvedVariable | undefined => {
    const name = inner.trim();
    if (!NAME.test(name)) {
      errors.push(`${where}: "{{${inner}}}" is not a valid placeholder; use {{name}}`);
      return undefined;
    }
    const variable = variables[name];
    if (!variable) errors.push(`${where}: undefined variable "${name}"`);
    return variable;
  };

  const whole = WHOLE_PLACEHOLDER.exec(text);
  if (whole) {
    const variable = lookup(whole[1] ?? '');
    return variable ? copy(variable.value) : text;
  }
  return text.replace(PLACEHOLDER, (placeholder, inner: string) => {
    const variable = lookup(inner);
    if (!variable) return placeholder;
    return variable.kind === 'text' ? String(variable.value) : JSON.stringify(variable.value);
  });
}

function expand(value: JsonValue, variables: Variables, where: string, errors: string[]): JsonValue {
  if (typeof value === 'string') return expandString(value, variables, where, errors);
  if (Array.isArray(value)) return value.map((item, index) => expand(item, variables, `${where}[${index}]`, errors));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, variables, `${where}.${key}`, errors)]));
  }
  return value;
}

/**
 * Resolves a preset for one dispatch attempt. `overrides` are the values the user edited, by variable
 * name. The `uuid` is generated once here and reused by every default, preparation and property of
 * this attempt; the next attempt gets another. A variable's own value may use the built-ins only.
 */
export function preparePreset(
  preset: Preset | undefined,
  overrides: Readonly<Record<string, JsonValue>>,
  ids: DispatchIds,
  randomUUID: () => string = () => globalThis.crypto.randomUUID(),
): Result<PreparedPreset> {
  const errors: string[] = [];
  const builtIns: Record<string, ResolvedVariable> = {
    threadId: { kind: 'text', value: ids.threadId },
    runId: { kind: 'text', value: ids.runId },
    uuid: { kind: 'text', value: randomUUID() },
  };
  const declared = preset?.variables ?? {};

  for (const name of Object.keys(overrides)) {
    if (!(name in declared)) errors.push(`Unknown variable "${name}"`);
  }

  const variables: Record<string, ResolvedVariable> = { ...builtIns };
  for (const [name, definition] of Object.entries(declared)) {
    const kind = definition.type ?? 'text';
    const raw = name in overrides ? (overrides[name] as JsonValue) : definition.default;
    if (kind === 'text' && typeof raw !== 'string') {
      errors.push(`Variable "${name}" is a text variable and must be a string`);
      continue;
    }
    variables[name] = { kind, value: expand(raw, builtIns, `variable "${name}"`, errors) };
  }

  const preparations = (preset?.prepare ?? []).map((request, index): PreparationRequest => {
    const where = `prepare[${index}]`;
    const path = expandString(request.path, variables, `${where}.path`, errors);
    return {
      method: request.method,
      path: typeof path === 'string' ? path : JSON.stringify(path),
      ...(request.body !== undefined && { body: expand(request.body, variables, `${where}.body`, errors) }),
    };
  });
  const forwardedProps = expand(preset?.forwardedProps ?? {}, variables, 'forwardedProps', errors) as JsonObject;

  if (errors.length > 0) return fail(errors.join('; '));
  return ok({ variables, preparations, forwardedProps, messageMode: preset?.messages ?? 'full', ...(preset?.encoding !== undefined && { encoding: preset.encoding }) });
}

// ---------------------------------------------------------------------------------------------
// Message selection
// ---------------------------------------------------------------------------------------------

/**
 * `full` sends the whole transcript. `turn` sends only what this turn adds: the new user message,
 * the tool results, or nothing when the turn is only a resume.
 */
export function selectMessages(mode: MessageMode, transcript: readonly Message[], turnMessages: readonly Message[]): Message[] {
  return mode === 'full' ? [...transcript] : [...turnMessages];
}
