// The start of the page, in an order that matters. Framework-free so a test can run it without a browser.
//
//   1. read hosting-config.json from the page's own origin (the only request made under the static policy)
//   2. turn it into the transport policy and add the content security policy
//   3. only then create the runtime, read the agent configuration and the saved profile
//
// Every request after step 2 goes through the runtime's guarded transport, so it obeys the allowlist
// fixed in step 1. A bad hosting-config.json stops the start with a message; it never falls back to a
// wider policy.
import type { AgentConfig, BrandConfig, ClientProfileSettings, JsonValue, SessionStore, ThemeConfig, TransportPolicy } from '../contracts.ts';
import { loadConfig, type ParsedConfig, type Result } from '../core/config/index.ts';
import { defaultProfile, loadProfile, type StorageLike } from '../core/profiles/index.ts';
import { createRuntime, guardedFetchText, resolveTarget, type Runtime } from '../core/runtime/index.ts';
import { createSessionStore } from '../core/store/index.ts';
import { DEFAULT_CONFIG_FILE, EMBEDDED_DEFAULTS, HOSTING_CONFIG_FILE, installPolicy, parseHostingConfig, policyFor, type HostingConfig } from './security.ts';

export interface StartupEnvironment {
  readonly document: Document;
  /** The page's origin; the policy's `pageOrigin`. */
  readonly origin: string;
  /** Where the page was loaded from; `hosting-config.json` and `config.json` sit beside it. */
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  /** Browser storage for the saved profile, when the browser lets the page use it. */
  readonly storage?: StorageLike;
  /**
   * Which file the initial agent configuration is read from, instead of the deployment's `config` or
   * `config.json`: relative to the page like those. It chooses a resource and nothing else. It is read
   * after the policy is in place, from the page's origin or a fixed allowed origin only, and a missing
   * one is the usual empty start unless the deployment's own file requires a configuration.
   */
  readonly configFile?: string;
}

/** What the runtime reads when it builds a run. The page updates it as the user edits. */
export interface Settings {
  profile: ClientProfileSettings;
  variables: Record<string, JsonValue>;
}

export interface Started {
  readonly policy: TransportPolicy;
  readonly store: SessionStore;
  readonly runtime: Runtime;
  readonly settings: Settings;
  readonly agents: readonly AgentConfig[];
  /** The agent selected at the start, which is the first configured one. */
  readonly selectedAgentId?: string;
  /** The validated theme maps from `config.json`; the page applies them. */
  readonly theme?: ThemeConfig;
  /** The validated brand from `config.json`; the top bar shows it. */
  readonly brand?: BrandConfig;
  /** Theme and brand values that were rejected. The page shows them; none of them stops the start. */
  readonly warnings: readonly string[];
  /** Why the configuration or the saved profile could not be used. */
  readonly error?: string;
}

export type StartResult = ({ readonly ok: true } & Started) | { readonly ok: false; readonly error: string };

/** The page's own file, read with the page's own credentials and never through a redirect. */
async function loadHosting(env: StartupEnvironment): Promise<Result<HostingConfig>> {
  let response: Response;
  try {
    response = await env.fetch(new URL(HOSTING_CONFIG_FILE, env.baseUrl).href, {
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { ok: false, error: `${HOSTING_CONFIG_FILE} could not be read` };
  }
  // Without the file the page is embedded: its own origin only.
  if (response.status === 404) return { ok: true, value: EMBEDDED_DEFAULTS };
  if (!response.ok) return { ok: false, error: `${HOSTING_CONFIG_FILE} answered ${response.status}` };
  return parseHostingConfig(await response.text());
}

const NOT_FOUND = /: 404\b/;

export async function startPage(env: StartupEnvironment): Promise<StartResult> {
  const hosting = await loadHosting(env);
  if (!hosting.ok) return hosting;

  const policy = policyFor(hosting.value, env.origin);
  installPolicy(env.document, policy);

  const store = createSessionStore();
  const settings: Settings = { profile: defaultProfile(), variables: {} };
  const runtime = createRuntime({ store, policy, settings: () => settings, fetch: env.fetch });
  const problems: string[] = [];

  // Relative to the page, like `hosting-config.json`: the guarded transport alone would resolve it against the origin root.
  const configName = env.configFile ?? hosting.value.config ?? DEFAULT_CONFIG_FILE;
  const readText = guardedFetchText(runtime.transport);
  // A page with no `config.json` is allowed: the user types an endpoint. One that exists but is
  // wrong, or that the policy refuses, is an error to show.
  const loaded: Result<ParsedConfig> = await loadConfig(configName, () => {
    const href = new URL(configName, env.baseUrl).href;
    // The page loads this by itself, so it is held to the fixed list: opting in to visitor targets covers
    // what a visitor starts, not where the page reads its own configuration from.
    const fixed = resolveTarget(href, { ...policy, allowVisitorTargets: false });
    if (!fixed.ok) throw new Error(fixed.error);
    return readText(href);
  }, { origin: env.origin, baseUrl: env.baseUrl });
  let agents: readonly AgentConfig[] = [];
  let theme: ThemeConfig | undefined;
  let brand: BrandConfig | undefined;
  let warnings: readonly string[] = [];
  if (loaded.ok) ({ agents, theme, brand, warnings } = loaded.value);
  else if (hosting.value.config !== undefined || !NOT_FOUND.test(loaded.error)) problems.push(loaded.error);

  if (env.storage !== undefined) {
    const saved = loadProfile(env.storage);
    if (!saved.ok) problems.push(saved.error);
    else if (saved.value !== undefined) settings.profile = saved.value;
  }

  const first = agents[0];
  if (first !== undefined) runtime.selectAgent(first);
  return {
    ok: true,
    policy,
    store,
    runtime,
    settings,
    agents,
    warnings,
    ...(theme !== undefined && { theme }),
    ...(brand !== undefined && { brand }),
    ...(first !== undefined && { selectedAgentId: first.id }),
    ...(problems.length > 0 && { error: problems.join(' ') }),
  };
}
