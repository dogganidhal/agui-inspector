// Shared checks for configuration, presets and profiles. Framework-free: nothing here knows about
// React, the DOM or the network. Every check returns a message a person can act on; none of them
// repairs, defaults or drops what it was given.
import type { JsonObject, JsonValue } from '../../contracts.ts';

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: string): Result<never> => ({ ok: false, error });

export const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Inert data only: no functions, undefined, bigint, non-finite numbers or class instances. */
export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

export const isJsonObject = (value: unknown): value is JsonObject => isRecord(value) && isJsonValue(value);

const CREDENTIAL_NAME = /auth|token|secret|passw|credential|cookie|api[-_]?key|bearer|header/i;

/**
 * The message for the first key of `value` that is not in `allowed`, or undefined. A name that looks
 * like a credential gets the sharper message: credentials never live in a file, a profile or a preset.
 */
export function unexpectedKey(value: Record<string, unknown>, allowed: readonly string[], where: string, keptIn: string): string | undefined {
  const key = Object.keys(value).find((candidate) => !allowed.includes(candidate));
  if (key === undefined) return undefined;
  return CREDENTIAL_NAME.test(key)
    ? `${where}: "${key}" is not allowed; authentication credentials are never kept in ${keptIn}`
    : `${where}: unknown field "${key}"`;
}

/** True for `user:password@` in an absolute or scheme-relative URL; a plain path never has any. */
export function hasUserinfo(url: string): boolean {
  try {
    const parsed = new URL(url, 'http://placeholder.invalid');
    return parsed.username !== '' || parsed.password !== '';
  } catch {
    return false;
  }
}

/** An error message for a bad URL-like value, or undefined. Relative references are allowed. */
export function urlProblem(url: unknown, where: string): string | undefined {
  if (typeof url !== 'string' || url === '') return `${where} must be a nonempty string`;
  if (hasUserinfo(url)) return `${where} must not contain credentials (user:password@)`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    if (!/^https?:/i.test(url)) return `${where} must use http or https`;
    try {
      new URL(url);
    } catch {
      return `${where} is not a valid URL`;
    }
  }
  return undefined;
}

// A theme value is written into a CSS declaration and must not leave it or start a request. The
// functions below load a resource; `@` starts an at-rule such as @import; `;`, `{` and `}` end a
// declaration or open a rule; a backslash can spell any of them as an escape. Whitespace before `(`
// is rejected too, and the match is case-insensitive.
const REQUEST_FUNCTION = /(?:url|src|image(?:-set)?|cross-fade)\s*\(/i;
const DECLARATION_ESCAPE = /[@;{}\\]/;

/** Why `value` cannot be a theme value, or undefined. */
export function themeValueProblem(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return 'must be a nonempty string';
  if (REQUEST_FUNCTION.test(value) || DECLARATION_ESCAPE.test(value)) {
    return 'could start a request or escape its declaration (url(), image-set(), @, ;, { }, backslash)';
  }
  return undefined;
}

/** Where the page is, so a logo can be judged by the URL it resolves to. */
export interface PageLocation {
  readonly origin: string;
  readonly baseUrl: string;
}

/** For a reader that is not told the page: a path or a `data:` image passes, since nothing else stays on every page's origin. */
export const NO_PAGE: PageLocation = { origin: 'http://placeholder.invalid', baseUrl: 'http://placeholder.invalid/' };

/**
 * The resolved URL of a logo, or why it cannot be one. The check runs on the parsed URL, not on the text, so a tab,
 * a backslash or a scheme-relative form cannot hide another origin from it. A `data:` image has no origin; anything
 * else must be http(s) on the page's origin and carry no credentials. The page's policy (`img-src 'self' data:`)
 * is the second line.
 */
export function logoSource(value: unknown, page: PageLocation): Result<string> {
  if (typeof value !== 'string' || value.trim() === '') return fail('must be a nonempty string');
  let url: URL;
  try {
    url = new URL(value, page.baseUrl);
  } catch {
    return fail('is not a valid URL');
  }
  if (url.protocol === 'data:' && /^image\//i.test(url.pathname)) return ok(url.href);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== page.origin) return fail('must be a path on this origin or a data:image URI');
  if (url.username !== '' || url.password !== '') return fail('must not contain credentials (user:password@)');
  return ok(url.href);
}

// A backslash and C0 controls are how a value hides a different address from a reader of the text. They are refused as
// written, on top of the check on the parsed URL below.
const BACKSLASH_OR_CONTROL = /[\\\u0000-\u001f\u007f]/;

/**
 * The resolved address of a plugin module, or why it cannot be one. A plugin is code, so the rule is the strictest of the
 * page's address rules: http(s) on the page's own origin and no credentials. The check runs on the parsed URL, so a
 * scheme-relative form or a spelling a URL parser rewrites cannot reach another origin. `data:` is not a plugin source.
 * The page's policy (`script-src 'self'`) is the second line.
 */
export function pluginSource(value: unknown, page: PageLocation): Result<string> {
  if (typeof value !== 'string' || value.trim() === '') return fail('must be a nonempty string');
  if (BACKSLASH_OR_CONTROL.test(value)) return fail('must not contain a backslash or a control character');
  let url: URL;
  try {
    url = new URL(value, page.baseUrl);
  } catch {
    return fail('is not a valid URL');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== page.origin) return fail('must be a path on this origin');
  if (url.username !== '' || url.password !== '') return fail('must not contain credentials (user:password@)');
  return ok(url.href);
}
