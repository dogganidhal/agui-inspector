// The remembered setup and its merge with a launch link (spec 016). Framework-free.
//
// The setup is what a reload used to lose: the selected agent or the endpoint the developer applied, and the
// selected agent's variable values. It is kept in browser storage beside the profile and the theme choice, as a
// version-0 envelope under one key. It never holds a token, a header, a thread, a message or a recording.
//
// At start, `resolveSetup` merges three sources into one selection, one set of variable values and one profile:
// the launch link first, then the saved setup and profile, then the configuration's defaults. Whatever no longer
// fits (an agent that is gone, an endpoint the policy refuses, a variable the preset does not declare) is dropped
// with one warning and the rest applies, so neither a stale setup nor a bad link can stop the page.
import type { AgentConfig, ClientProfileSettings, JsonValue, TransportPolicy } from '../../contracts.ts';
import { FORMAT_VERSION } from '../../contracts.ts';
import { describeError, fail, isJsonValue, isRecord, ok, unexpectedKey, type Result } from '../config/validation.ts';
import type { StorageLike } from '../profiles/index.ts';
import { resolveTarget } from '../runtime/transport.ts';
import type { LaunchValues } from './link.ts';

export { MAX_LINK_LENGTH, parseLaunchLink, type LaunchLink, type LaunchValues } from './link.ts';

export const SETUP_STORAGE_KEY = 'agui-inspector.setup';

/** A configured agent with its edited variable values, or an endpoint the developer applied, as typed. */
export type SavedSetup = { readonly agent: string; readonly variables?: Readonly<Record<string, JsonValue>> } | { readonly endpoint: string };

// ---------------------------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------------------------

function parseSetup(value: unknown): Result<SavedSetup> {
  if (!isRecord(value)) return fail('setup must be an object');
  const extra = unexpectedKey(value, ['agent', 'endpoint', 'variables'], 'setup', 'the saved setup');
  if (extra) return fail(extra);
  const { agent, endpoint, variables } = value;
  if (agent !== undefined && endpoint !== undefined) return fail('setup names an agent and an endpoint');
  if (endpoint !== undefined) {
    if (typeof endpoint !== 'string' || endpoint === '') return fail('setup.endpoint must be a nonempty string');
    if (variables !== undefined) return fail('setup.variables belong to an agent');
    return ok({ endpoint });
  }
  if (typeof agent !== 'string' || agent === '') return fail('setup needs an agent or an endpoint');
  if (variables === undefined) return ok({ agent });
  if (!isRecord(variables) || !isJsonValue(variables)) return fail('setup.variables must be an object of JSON values');
  return ok({ agent, variables: structuredClone(variables) as Record<string, JsonValue> });
}

/** `ok(undefined)` when nothing is saved or storage cannot be read; an error when what is saved cannot be used. */
export function loadSetup(storage: StorageLike): Result<SavedSetup | undefined> {
  let text: string | null;
  try {
    text = storage.getItem(SETUP_STORAGE_KEY);
  } catch {
    // Blocked storage only means nothing is remembered.
    return ok(undefined);
  }
  if (text === null) return ok(undefined);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return fail(`The saved setup was not used: it is not valid JSON (${describeError(error)})`);
  }
  if (!isRecord(json) || json.version !== FORMAT_VERSION || Object.keys(json).some((key) => key !== 'version' && key !== 'setup')) {
    return fail(`The saved setup was not used: this inspector reads version ${FORMAT_VERSION}`);
  }
  const setup = parseSetup(json.setup);
  return setup.ok ? setup : fail(`The saved setup was not used: ${setup.error}`);
}

/** Never throws: blocked or full storage means the setup is not remembered. */
export function saveSetup(storage: StorageLike, setup: SavedSetup): void {
  try {
    storage.setItem(SETUP_STORAGE_KEY, JSON.stringify({ version: FORMAT_VERSION, setup }));
  } catch {
    // The setup holds for this page and is not remembered.
  }
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

export interface SetupSources {
  readonly agents: readonly AgentConfig[];
  readonly policy: TransportPolicy;
  /** The saved profile, or the default one. */
  readonly profile: ClientProfileSettings;
  readonly saved?: SavedSetup;
  readonly link?: LaunchValues;
}

export interface ResolvedSetup {
  /** What to select. Absent when no agent is configured and nothing else applies. */
  readonly selection?: SavedSetup;
  readonly variables: Record<string, JsonValue>;
  readonly profile: ClientProfileSettings;
  /** The link keys that took effect, in the contract's order. Empty without a link. */
  readonly keys: readonly string[];
  /** Saved values that were dropped: Configuration warnings. */
  readonly warnings: readonly string[];
  /** Link values that were dropped: Link warnings. Never a value. */
  readonly linkWarnings: readonly string[];
}

/** Why the page may not use this endpoint, in the words a typed one gets; undefined when it may. */
function endpointProblem(url: string, policy: TransportPolicy): string | undefined {
  const target = resolveTarget(url, policy);
  return target.ok ? undefined : target.error;
}

export function resolveSetup({ agents, policy, profile, saved, link = {} }: SetupSources): ResolvedSetup {
  const warnings: string[] = [];
  const linkWarnings: string[] = [];
  const keys: string[] = [];
  const known = (id: string) => agents.some((agent) => agent.id === id);

  let selection: SavedSetup | undefined;
  if (link.agent !== undefined) {
    if (known(link.agent)) {
      selection = { agent: link.agent };
      keys.push('agent');
    } else linkWarnings.push('agent: no configured agent has this id; it was ignored');
  } else if (link.endpoint !== undefined) {
    const problem = endpointProblem(link.endpoint, policy);
    if (problem === undefined) {
      selection = { endpoint: link.endpoint };
      keys.push('endpoint');
    } else linkWarnings.push(`endpoint: ${problem}. It was ignored`);
  }

  if (saved !== undefined) {
    if ('endpoint' in saved) {
      if (selection === undefined) {
        const problem = endpointProblem(saved.endpoint, policy);
        if (problem === undefined) selection = saved;
        else warnings.push(`The saved endpoint was not used: ${problem}`);
      }
    } else if (!known(saved.agent)) {
      if (selection === undefined) warnings.push(`The saved agent "${saved.agent}" is no longer configured; the first agent is selected`);
    } else if (selection === undefined || ('agent' in selection && selection.agent === saved.agent)) {
      // The saved values belong to the saved agent; a link that selects another agent starts from that agent's defaults.
      selection = saved;
    }
  }

  const first = agents[0];
  if (selection === undefined && first !== undefined) selection = { agent: first.id };

  const agentId = selection !== undefined && 'agent' in selection ? selection.agent : undefined;
  const agent = agents.find((candidate) => candidate.id === agentId);
  const declared = agent?.preset?.variables ?? {};
  const variables: Record<string, JsonValue> = {};
  if (selection !== undefined && 'agent' in selection) {
    for (const [name, value] of Object.entries(selection.variables ?? {})) {
      const definition = Object.hasOwn(declared, name) ? declared[name] : undefined;
      if (definition === undefined) warnings.push(`The saved variable "${name}" is not declared by agent "${selection.agent}"; it was dropped`);
      else if (definition.type !== 'json' && typeof value !== 'string') warnings.push(`The saved variable "${name}" is not text; it was dropped`);
      else variables[name] = value;
    }
  }
  for (const [name, text] of Object.entries(link.variables ?? {})) {
    const key = `var.${name}`;
    const definition = Object.hasOwn(declared, name) ? declared[name] : undefined;
    if (agent === undefined) linkWarnings.push(`${key}: only a configured agent has variables; it was ignored`);
    else if (definition === undefined) linkWarnings.push(`${key}: agent "${agent.id}" declares no such variable; it was ignored`);
    else if (definition.type === 'json') {
      try {
        variables[name] = JSON.parse(text) as JsonValue;
        keys.push(key);
      } catch {
        linkWarnings.push(`${key} is a JSON variable and the value is not valid JSON; it was ignored`);
      }
    } else {
      variables[name] = text;
      keys.push(key);
    }
  }
  // The saved selection carries its values; the resolved one carries the merged values instead.
  if (selection !== undefined && 'agent' in selection) selection = { agent: selection.agent };

  let next = profile;
  if (link.context !== undefined) {
    next = { ...next, context: link.context };
    keys.push('context');
  }
  if (link.forwardedProps !== undefined) {
    next = { ...next, forwardedProps: link.forwardedProps };
    keys.push('forwardedProps');
  }
  if (link.message !== undefined) keys.push('message');

  return { ...(selection !== undefined && { selection }), variables, profile: next, keys, warnings, linkWarnings };
}
