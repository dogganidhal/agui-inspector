// The guarded transport (FR-003 to FR-005, FR-036, FR-037). Framework-free: fetch and URL only.
//
// Every request the inspector makes to a target (configuration, capabilities, preparation, run and raw
// submission) goes through here. It decides where a request may go, which credentials ride with it
// and what happens to a redirect; the caller supplies the destination, method, exact body text and
// the kind of body to expect, and nothing else.
//
// - Destinations: the page's own origin, plus the origins the deployment allowed at startup. A
//   configuration or a typed endpoint cannot add one. A URL with `user:password@` is refused outright.
//   A hosted deployment may instead opt in, at startup, to visitor-chosen targets (feature 002): any
//   HTTPS origin and plain HTTP to exactly localhost or 127.0.0.1 on any port. `isVisitorTarget` is
//   that boundary in one place; the startup content security policy is built from the same list.
// - Cookies: none when hosted. Embedded requests to the page's own origin use the host's same-origin
//   credentials; every other request omits them.
// - Token: the volatile credential is turned into one header here and nowhere else. It is never part
//   of a returned value, an error message or anything the recorder is given.
// - Redirects are not followed. A redirect answer is an error the user sees, never a second request.
// - A browser-level failure (CORS, private-network or mixed-content rules, an unreachable server) is
//   reported as such. The inspector has no proxy and no bypass for any of them.
import { AGUI_MEDIA_TYPE } from '@ag-ui/proto';
import type { GuardedTransport, TransportPolicy, TransportRequest, VolatileAuth } from '../../contracts.ts';
import { fail, hasUserinfo, ok, type Result } from '../config/validation.ts';

/** `send` may also take the signal that stops the request; the frozen interface needs no more than two parameters. */
export interface AbortableTransport extends GuardedTransport {
  send(request: TransportRequest, auth?: VolatileAuth, signal?: AbortSignal): Promise<Response>;
}

export interface TransportOptions {
  /** Replaces the global fetch. Only tests need this. */
  readonly fetch?: typeof globalThis.fetch;
}

/** The JSON body headers and the response-kind accept header are the transport's own. */
const RESERVED_HEADER = /^(?:cookie2?|set-cookie|host|content-length|content-type|accept)$/i;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

// The one place a request's Accept header is chosen: a run, a continuation, a surface action and a raw
// submission all reach a target through `send`, so the encoding they ask for is decided here and nowhere else.
const ACCEPT = {
  sse: 'text/event-stream',
  protobuf: AGUI_MEDIA_TYPE,
  response: 'application/json, text/plain;q=0.9, */*;q=0.1',
} as const;

/** An error message if `name` cannot be an authentication header, else undefined. */
export function headerNameProblem(name: string): string | undefined {
  if (!HEADER_NAME.test(name)) return 'The header name must be a single HTTP header token such as Authorization or X-Api-Key';
  if (RESERVED_HEADER.test(name)) return `The header name "${name}" is set by the inspector or the browser and cannot carry a token`;
  return undefined;
}

/**
 * The plain-HTTP hosts an opted-in page may reach, on any port. Exact names: a browser's content
 * security policy cannot match IPv6 literals such as [::1] portably, so they are not listed and not
 * claimed. A numeric form such as 127.1 or 2130706433 is already 127.0.0.1 once the URL is parsed.
 */
export const VISITOR_LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];

const VISITOR_BOUNDARY = 'HTTPS origins, and http://localhost or http://127.0.0.1 on any port';

/** The opt-in boundary: HTTPS, or HTTP to an exact loopback host, with no credentials in the URL. */
export function isVisitorTarget(url: URL): boolean {
  if (url.username !== '' || url.password !== '') return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && VISITOR_LOOPBACK_HOSTS.includes(url.hostname));
}

const isVisitorOrigin = (origin: string): boolean => {
  try {
    return isVisitorTarget(new URL(origin));
  } catch {
    return false;
  }
};

/** Whether `policy` is a hosted one that opted in. Only the boolean `true` does. */
export const allowsVisitorTargets = (policy: TransportPolicy): boolean => policy.mode === 'hosted' && policy.allowVisitorTargets === true;

/**
 * Why a constructed policy cannot be enforced, or undefined. The hosting file is checked for the same
 * things when it is read; a policy built another way gets the same refusal, for every request.
 */
function policyProblem(policy: TransportPolicy): string | undefined {
  const option = policy.allowVisitorTargets;
  if (option === undefined || option === false) return undefined;
  if (option !== true) return 'The transport policy is invalid: allowVisitorTargets must be true or false';
  if (policy.mode !== 'hosted') return 'The transport policy is invalid: only a hosted deployment can allow visitor targets';
  const outside = policy.allowedOrigins.find((origin) => !isVisitorOrigin(origin));
  return outside === undefined ? undefined : `The transport policy is invalid: allowedOrigins entry "${outside}" is outside the visitor-target boundary (${VISITOR_BOUNDARY}) and cannot widen it`;
}

/** Where `url` goes under `policy`, or the reason it may not. Never sends anything. */
export function resolveTarget(url: string, policy: TransportPolicy): Result<URL> {
  const problem = policyProblem(policy);
  if (problem !== undefined) return fail(problem);
  if (hasUserinfo(url)) return fail('The URL must not contain credentials (user:password@); enter the token in the authentication field instead');
  let target: URL;
  try {
    target = new URL(url, policy.pageOrigin);
  } catch {
    return fail('The URL is not a valid URL');
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return fail('The URL must use http or https');
  const allowed = [policy.pageOrigin, ...policy.allowedOrigins];
  if (allowsVisitorTargets(policy)) {
    if (target.origin === policy.pageOrigin || isVisitorTarget(target)) return ok(target);
    return fail(
      `${target.origin} is not an allowed destination. This page may reach its own origin, ${VISITOR_BOUNDARY}; ` +
        `IPv6 literals such as [::1] are not supported, so use http://localhost for a local server`,
    );
  }
  if (!allowed.includes(target.origin)) {
    return fail(`${target.origin} is not an allowed destination. This page may reach ${allowed.join(', ')}; the list is fixed when the page starts`);
  }
  return ok(target);
}

/** The path an exchange records: what the server sees, without the origin. */
export const recordedPath = (url: URL): string => `${url.pathname}${url.search}`;

const isAbort = (error: unknown): boolean => typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';

export function createGuardedTransport(policy: TransportPolicy, options: TransportOptions = {}): AbortableTransport {
  return {
    async send(request, auth, signal) {
      const target = resolveTarget(request.url, policy);
      if (!target.ok) throw new Error(target.error);

      const headers: Record<string, string> = { accept: ACCEPT[request.responseKind] };
      if (request.body !== undefined) headers['content-type'] = 'application/json';
      if (auth !== undefined && auth.token !== '') {
        const problem = headerNameProblem(auth.headerName);
        if (problem) throw new Error(problem);
        headers[auth.headerName] = auth.token;
      }

      const init: RequestInit = {
        method: request.method,
        headers,
        // Cookies only for the host's own page and only when embedded; hosted requests carry none.
        credentials: policy.mode === 'embedded' && target.value.origin === policy.pageOrigin ? 'same-origin' : 'omit',
        redirect: 'manual',
        referrerPolicy: 'no-referrer',
        ...(request.body !== undefined && { body: request.body }),
        ...(signal !== undefined && { signal }),
      };

      let response: Response;
      try {
        response = await (options.fetch ?? globalThis.fetch)(target.value.href, init);
      } catch (error) {
        if (isAbort(error) || !(error instanceof TypeError)) throw error;
        // Only the origin is named: the path and query may hold something the user would not paste into a bug report.
        throw new Error(
          `The browser could not complete the request to ${target.value.origin}. Possible causes: the target does not allow this page's origin (CORS), ` +
            `private-network or mixed-content rules, or the server is unreachable. The inspector does not proxy or bypass these checks.`,
        );
      }
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        const status = response.status === 0 ? '' : ` (status ${response.status})`;
        throw new Error(`The target answered with a redirect${status}. The inspector does not follow redirects; enter the final URL as the target`);
      }
      return response;
    },
  };
}

/** The configuration loader's `FetchText`, routed through the guard: allowlist, no cookies, no redirects. */
export function guardedFetchText(transport: GuardedTransport): (url: string) => Promise<string> {
  return async (url) => {
    const response = await transport.send({ url, method: 'GET', responseKind: 'response' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return response.text();
  };
}
