// Configuration and declared capabilities (FR-006, FR-029). Framework-free.
//
// A configuration is version-0 JSON naming agents. Each agent needs an id and a url; a name, declared
// capabilities and a preset are optional. The file never holds credentials: fields that could carry
// one are rejected, not ignored.
//
// Nothing here talks to the network. Loading takes a callback, which the guarded transport supplies,
// so every request obeys the startup allowlist and a configuration can neither widen that list nor
// make the inspector fetch a route it was not handed.
import type { AgentCapabilities } from '@ag-ui/core';
import { AgentCapabilitiesSchema } from '@ag-ui/core/schemas';
import { CAPABILITY_GROUPS, FORMAT_VERSION, THEME_PROPERTIES, type AgentConfig, type BrandConfig, type ConfigFile, type JsonValue, type ThemeConfig, type ThemeMap } from '../../contracts.ts';
import { parsePreset } from '../presets/index.ts';
import { describeError, fail, isJsonObject, isRecord, logoSource, NO_PAGE, ok, themeValueProblem, unexpectedKey, urlProblem, type PageLocation, type Result } from './validation.ts';

export type { PageLocation, Result } from './validation.ts';

/** Reads one text resource. The caller routes it through the guarded transport. */
export type FetchText = (url: string) => Promise<string>;

export type ParsedConfig = ConfigFile & {
  readonly agents: readonly AgentConfig[];
  readonly version: typeof FORMAT_VERSION;
  /** Theme and brand values that were rejected. They never stop the configuration from loading. */
  readonly warnings: readonly string[];
};

const AGENT_FIELDS = ['id', 'name', 'url', 'capabilities', 'preset'];

function parseCapabilities(value: unknown, where: string): Result<AgentCapabilities | string> {
  if (typeof value === 'string') {
    const problem = urlProblem(value, `${where} url`);
    return problem ? fail(problem) : ok(value);
  }
  const parsed = isJsonObject(value) ? AgentCapabilitiesSchema.safeParse(value) : undefined;
  if (!parsed) return fail(`${where} must be an object or a url`);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`${where}: ${issue?.path.join('.') || 'value'}: ${issue?.message ?? 'invalid'}`);
  }
  return ok(value as AgentCapabilities);
}

function parseAgent(value: unknown, index: number): Result<AgentConfig> {
  const label = `agents[${index}]`;
  if (!isRecord(value)) return fail(`${label} must be an object`);
  const named = typeof value.id === 'string' && value.id !== '' ? `agent "${value.id}"` : label;
  const extra = unexpectedKey(value, AGENT_FIELDS, named, 'configuration');
  if (extra) return fail(extra);
  if (typeof value.id !== 'string' || value.id === '') return fail(`${label}: id must be a nonempty string`);
  const urlError = urlProblem(value.url, `${named}: url`);
  if (urlError) return fail(urlError);
  if (value.name !== undefined && typeof value.name !== 'string') return fail(`${named}: name must be a string`);

  let agent: AgentConfig = { id: value.id, url: value.url as string, ...(value.name !== undefined && { name: value.name as string }) };
  if (value.capabilities !== undefined) {
    const capabilities = parseCapabilities(value.capabilities, `${named}: capabilities`);
    if (!capabilities.ok) return capabilities;
    agent = { ...agent, capabilities: capabilities.value };
  }
  if (value.preset !== undefined) {
    const preset = parsePreset(value.preset, `${named}: preset`);
    if (!preset.ok) return preset;
    agent = { ...agent, preset: preset.value };
  }
  return ok(agent);
}

/** A name from the file, quoted and cut short so a hostile one cannot flood the page. */
const shown = (name: string) => JSON.stringify(name.length > 48 ? `${name.slice(0, 48)}…` : name);

/** One light or dark map: every accepted property is kept, every other one is a warning. */
function parseThemeMap(value: unknown, where: string, warnings: string[]): ThemeMap | undefined {
  if (!isRecord(value)) {
    warnings.push(`${where} must be an object of --agui-* properties; it was ignored`);
    return undefined;
  }
  const accepted: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    const problem = (THEME_PROPERTIES as readonly string[]).includes(name) ? themeValueProblem(entry) : 'is not a public theme property';
    if (problem === undefined) accepted[name] = entry as string;
    else warnings.push(`${where}: ${shown(name)} ${problem}; it was ignored`);
  }
  return accepted;
}

/** The optional `theme` field. Bad names, shapes and values are dropped one by one, each with a warning. */
function parseTheme(value: unknown, warnings: string[]): ThemeConfig | undefined {
  if (!isRecord(value)) {
    warnings.push('theme must be an object with optional "light" and "dark" maps; it was ignored');
    return undefined;
  }
  const theme: { light?: ThemeMap; dark?: ThemeMap } = {};
  for (const [mode, map] of Object.entries(value)) {
    if (mode !== 'light' && mode !== 'dark') warnings.push(`theme: ${shown(mode)} is not a theme map (use "light" or "dark"); it was ignored`);
    else {
      const parsed = parseThemeMap(map, `theme.${mode}`, warnings);
      if (parsed !== undefined) theme[mode] = parsed;
    }
  }
  return theme.light !== undefined || theme.dark !== undefined ? theme : undefined;
}

const BRAND_FIELDS = ['name', 'logo', 'logoDark'];

/** The optional `brand`. A bad field is dropped alone with a warning that names it and never repeats its value. */
function parseBrand(value: unknown, page: PageLocation, warnings: string[]): BrandConfig | undefined {
  if (!isRecord(value)) {
    warnings.push('brand must be an object with optional "name", "logo" and "logoDark"; it was ignored');
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!BRAND_FIELDS.includes(key)) warnings.push(`brand: ${shown(key)} is not a brand field (use "name", "logo" or "logoDark"); it was ignored`);
  }
  const brand: { name?: string; logo?: string; logoDark?: string } = {};
  if ('name' in value) {
    if (typeof value.name === 'string' && value.name.trim() !== '') brand.name = value.name;
    else warnings.push('brand.name must be a nonempty string; it was ignored');
  }
  for (const field of ['logo', 'logoDark'] as const) {
    if (!(field in value)) continue;
    const logo = field === 'logoDark' && brand.logo === undefined ? fail('needs a valid brand.logo') : logoSource(value[field], page);
    if (logo.ok) brand[field] = logo.value;
    else warnings.push(`brand.${field} ${logo.error}; it was ignored`);
  }
  return Object.keys(brand).length > 0 ? brand : undefined;
}

/** Version 0 only; a file without a version is the historical form and reads as version 0. `page` is where logos must stay. */
export function parseConfig(text: string, page: PageLocation = NO_PAGE): Result<ParsedConfig> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return fail(`Configuration is not valid JSON: ${describeError(error)}`);
  }
  if (!isRecord(json)) return fail('Configuration must be a JSON object with an "agents" list');
  const extra = unexpectedKey(json, ['version', 'agents', 'theme', 'brand'], 'configuration', 'configuration');
  if (extra) return fail(extra);
  if ('version' in json && json.version !== FORMAT_VERSION) {
    return fail(`Unsupported configuration version ${JSON.stringify(json.version)}; this inspector reads version ${FORMAT_VERSION}`);
  }
  if (!Array.isArray(json.agents)) return fail('Configuration needs an "agents" list');

  const agents: AgentConfig[] = [];
  for (const [index, entry] of json.agents.entries()) {
    const agent = parseAgent(entry, index);
    if (!agent.ok) return agent;
    if (agents.some((known) => known.id === agent.value.id)) return fail(`Duplicate agent id "${agent.value.id}"`);
    agents.push(agent.value);
  }
  const warnings: string[] = [];
  const theme = json.theme === undefined ? undefined : parseTheme(json.theme, warnings);
  const brand = json.brand === undefined ? undefined : parseBrand(json.brand, page, warnings);
  return ok({ version: FORMAT_VERSION, agents, ...(theme !== undefined && { theme }), ...(brand !== undefined && { brand }), warnings });
}

/** Fetches `url` through the callback and parses it. This is the only request made. */
export async function loadConfig(url: string, fetchText: FetchText, page?: PageLocation): Promise<Result<ParsedConfig>> {
  let text: string;
  try {
    text = await fetchText(url);
  } catch (error) {
    return fail(`Configuration ${url}: ${describeError(error)}`);
  }
  const parsed = parseConfig(text, page);
  return parsed.ok ? parsed : fail(`Configuration ${url}: ${parsed.error}`);
}

// ---------------------------------------------------------------------------------------------
// Declared capabilities
// ---------------------------------------------------------------------------------------------

export type CapabilityGroupName = (typeof CAPABILITY_GROUPS)[number];

export interface CapabilityEntry {
  readonly key: string;
  readonly value: JsonValue;
}

/** One of the eleven groups; `entries` is empty when the agent declares nothing for it. */
export interface CapabilityGroupView {
  readonly group: CapabilityGroupName;
  readonly entries: readonly CapabilityEntry[];
}

export interface LoadedCapabilities {
  readonly source: 'inline' | 'url' | 'none';
  /** Where a `url` declaration was read from. */
  readonly url?: string;
  readonly groups: readonly CapabilityGroupView[];
}

/** The eleven groups in their documented order, whether declared or not. */
export function describeCapabilities(capabilities: AgentCapabilities): CapabilityGroupView[] {
  return CAPABILITY_GROUPS.map((group) => {
    const declared: Record<string, unknown> = capabilities[group] ?? {};
    return {
      group,
      entries: Object.entries(declared)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => ({ key, value: value as JsonValue })),
    };
  });
}

/** Reads the agent's declaration from its configured source only; there is no discovery. */
export async function loadCapabilities(agent: AgentConfig, fetchText: FetchText): Promise<Result<LoadedCapabilities>> {
  const declared = agent.capabilities;
  if (declared === undefined) return ok({ source: 'none', groups: describeCapabilities({}) });
  if (typeof declared !== 'string') return ok({ source: 'inline', groups: describeCapabilities(declared) });

  let text: string;
  try {
    text = await fetchText(declared);
  } catch (error) {
    return fail(`Capabilities ${declared}: ${describeError(error)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return fail(`Capabilities ${declared} are not valid JSON: ${describeError(error)}`);
  }
  if (!isRecord(json)) return fail(`Capabilities ${declared} must be a JSON object`);
  const parsed = parseCapabilities(json, `Capabilities ${declared}`);
  if (!parsed.ok) return parsed;
  return ok({ source: 'url', url: declared, groups: describeCapabilities(parsed.value as AgentCapabilities) });
}
