// Launch links (spec 016, contracts/launch-link.md). Framework-free.
//
// A launch link is the page's URL with launch values in the fragment, as `URLSearchParams` writes them:
// `#agent=support&var.userId=42&message=Hello`. This file reads the fragment into values and warnings and
// nothing else: which agent exists, which variables it declares and what the policy allows are judged in
// `resolveSetup`, which knows the configuration. A link is input from outside the page, so every key is
// optional, each bad key is dropped on its own, and no warning repeats a value: a credential pasted into the
// wrong place must not end up on screen.
import type { Context } from '@ag-ui/core';
import type { JsonObject } from '../../contracts.ts';
import { defaultProfile, parseProfileSettings } from '../profiles/index.ts';

/** Longer fragments are ignored as a whole (research 5). */
export const MAX_LINK_LENGTH = 65_536;

/** The only format version, and the value of `v` when a link writes one. */
export const LINK_VERSION = '0';

/** Keys that name a credential. A link never carries one, so these are refused with their own warning. */
const CREDENTIAL_KEY = /^(?:token|auth|authorization|headers?)$|^header\./i;
const VARIABLE_KEY = /^var\.(.*)$/s;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEYS = ['v', 'agent', 'endpoint', 'context', 'forwardedProps', 'message'];
const MAX_KEY_SHOWN = 64;

/** What a link asks for. Variable values are the text of the link; the variable's type decides how it is read. */
export interface LaunchValues {
  readonly agent?: string;
  readonly endpoint?: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly context?: readonly Context[];
  readonly forwardedProps?: JsonObject;
  readonly message?: string;
}

export interface LaunchLink {
  readonly values: LaunchValues;
  /** One per refused key or value. Each names the key and never its value. */
  readonly warnings: readonly string[];
}

const shown = (key: string): string => (key.length > MAX_KEY_SHOWN ? `${key.slice(0, MAX_KEY_SHOWN)}…` : key);

/** The value of a JSON key, checked by the profile's own rules so a link is held to what Settings and import accept. */
function profileField<K extends 'context' | 'forwardedProps'>(key: K, text: string): { value: ReturnType<typeof defaultProfile>[K] } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: `${key} is not valid JSON; it was ignored` };
  }
  const parsed = parseProfileSettings({ ...defaultProfile(), [key]: json }, 'link');
  return parsed.ok ? { value: parsed.value[key] } : { error: `${parsed.error}; it was ignored` };
}

/** Reads a fragment, with or without its leading `#`. An empty fragment is no link. */
export function parseLaunchLink(fragment: string): LaunchLink {
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (text === '') return { values: {}, warnings: [] };
  if (text.length > MAX_LINK_LENGTH) return { values: {}, warnings: [`the link is longer than ${MAX_LINK_LENGTH.toLocaleString('en-US')} characters; it was ignored`] };

  const params = new URLSearchParams(text);
  const counts = new Map<string, number>();
  for (const key of params.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);

  const version = params.getAll('v');
  if (version.length === 1 && version[0] !== LINK_VERSION) {
    return { values: {}, warnings: [`v: this inspector reads launch links of version ${LINK_VERSION}; the link was ignored`] };
  }

  const warnings: string[] = [];
  const variables: Record<string, string> = {};
  let values: LaunchValues = {};
  for (const [key, count] of counts) {
    const value = params.get(key) ?? '';
    if (CREDENTIAL_KEY.test(key)) {
      warnings.push(`${shown(key)}: credentials never go in a link; enter a token in the authentication field. It was ignored`);
      continue;
    }
    const variable = VARIABLE_KEY.exec(key);
    if (variable === null && !KEYS.includes(key)) {
      warnings.push(`${shown(key)} is not a launch link key; it was ignored`);
      continue;
    }
    if (count > 1) {
      warnings.push(`${shown(key)} appears more than once; it was ignored`);
      continue;
    }
    if (variable !== null) {
      const name = variable[1] ?? '';
      if (!VARIABLE_NAME.test(name)) warnings.push(`${shown(key)} does not name a variable; it was ignored`);
      else variables[name] = value;
      continue;
    }
    switch (key) {
      case 'agent':
      case 'endpoint':
        if (value.trim() === '') warnings.push(`${key} is empty; it was ignored`);
        else values = { ...values, [key]: value.trim() };
        break;
      case 'context':
      case 'forwardedProps': {
        const field = profileField(key, value);
        if ('error' in field) warnings.push(field.error);
        else values = { ...values, [key]: field.value };
        break;
      }
      case 'message':
        values = { ...values, message: value };
        break;
    }
  }

  if (values.agent !== undefined && values.endpoint !== undefined) {
    const { agent: _agent, endpoint: _endpoint, ...rest } = values;
    values = rest;
    warnings.push('agent and endpoint: a link names an agent or an endpoint, not both; both were ignored');
  }
  if (Object.keys(variables).length > 0) values = { ...values, variables };
  return { values, warnings };
}
