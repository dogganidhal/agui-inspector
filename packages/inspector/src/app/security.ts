// The startup security policy (FR-004, FR-005, FR-037, FR-038). Framework-free: URL parsing and one
// meta element, nothing else.
//
// A deployment states, in `hosting-config.json` beside the page, whether it is embedded or hosted and
// which target origins a hosted page may reach. That file is read once, before any other request, and
// becomes two things that cannot drift apart: the `TransportPolicy` the guarded transport enforces,
// and the content security policy the browser enforces. Both come from the same origin list, so a
// request the transport would refuse is also one the browser would block.
//
// Nothing the page loads afterwards (a configuration file, a capabilities URL, a typed endpoint) can
// change either. Changing the policy means changing the deployment's file and reloading.
import type { DeploymentMode, TransportPolicy } from '../contracts.ts';
import type { Result } from '../core/config/index.ts';

export const HOSTING_CONFIG_FILE = 'hosting-config.json';
export const DEFAULT_CONFIG_FILE = 'config.json';

export interface HostingConfig {
  readonly mode: DeploymentMode;
  /** Absolute target origins a hosted page may reach, normalized. Always empty when embedded. */
  readonly allowedOrigins: readonly string[];
  /** Where the agent configuration is read from; the page's own `config.json` when absent. */
  readonly config?: string;
}

/** A page served without a `hosting-config.json`: its own origin and nothing else. */
export const EMBEDDED_DEFAULTS: HostingConfig = { mode: 'embedded', allowedOrigins: [] };

const ALLOWED_KEYS = ['version', 'mode', 'allowedOrigins', 'config'];
const reject = (error: string): Result<never> => ({ ok: false, error: `${HOSTING_CONFIG_FILE}: ${error}` });

/** The normalized origin of an absolute http(s) origin written alone, or why it is not one. */
function parseOrigin(value: unknown, where: string): Result<string> {
  if (typeof value !== 'string' || value === '') return reject(`${where} must be a nonempty string`);
  if (value.includes('*')) return reject(`${where} "${value}" must name one origin; wildcards are not allowed`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject(`${where} "${value}" is not an absolute URL such as https://agent.example`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(`${where} "${value}" must use http or https`);
  if (url.username !== '' || url.password !== '') return reject(`${where} must not contain credentials`);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    return reject(`${where} "${value}" must be an origin only, without a path, query or fragment`);
  }
  return { ok: true, value: url.origin };
}

/** Strict on purpose: a misspelled key in a security file must not silently mean "no restriction". */
export function parseHostingConfig(text: string): Result<HostingConfig> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reject('not valid JSON');
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return reject('expected a JSON object');
  const file = json as Record<string, unknown>;
  const unknown = Object.keys(file).find((key) => !ALLOWED_KEYS.includes(key));
  if (unknown !== undefined) return reject(`unknown field "${unknown}"`);
  if ('version' in file && file.version !== 0) return reject('version must be 0');
  if (file.mode !== 'embedded' && file.mode !== 'hosted') return reject('mode must be "embedded" or "hosted"');

  const listed = file.allowedOrigins ?? [];
  if (!Array.isArray(listed)) return reject('allowedOrigins must be an array of origins');
  const origins: string[] = [];
  for (const [index, entry] of listed.entries()) {
    const origin = parseOrigin(entry, `allowedOrigins[${index}]`);
    if (!origin.ok) return origin;
    if (!origins.includes(origin.value)) origins.push(origin.value);
  }
  if (file.mode === 'embedded' && origins.length > 0) {
    return reject('an embedded page reaches its own origin only; allowedOrigins belongs to a hosted deployment');
  }

  if ('config' in file && (typeof file.config !== 'string' || file.config === '')) return reject('config must be a nonempty URL');
  return {
    ok: true,
    value: { mode: file.mode, allowedOrigins: origins, ...(typeof file.config === 'string' && { config: file.config }) },
  };
}

export function policyFor(hosting: HostingConfig, pageOrigin: string): TransportPolicy {
  return { mode: hosting.mode, pageOrigin, allowedOrigins: hosting.allowedOrigins };
}

/**
 * The policy the page enforces on itself. Scripts and everything else come from the page's own
 * origin only, there is no `eval` or inline script, and `connect-src` is the page plus exactly the
 * origins the transport policy allows. Anything not listed is denied by `default-src 'none'`.
 */
export function contentSecurityPolicy(policy: TransportPolicy): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${["'self'", ...policy.allowedOrigins].join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/**
 * Adds the policy as a second `<meta>` policy. The page's static one already limits scripts; a
 * policy added later can only narrow what is allowed, never widen it.
 */
export function installPolicy(document: Document, policy: TransportPolicy): void {
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = contentSecurityPolicy(policy);
  document.head.append(meta);
}
