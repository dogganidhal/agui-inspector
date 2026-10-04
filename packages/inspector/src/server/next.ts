// The Next.js helper: `inspectorRoute(options)` returns the `GET` and `HEAD` handlers of a route file. A route handler
// takes a web-standard `Request`, so the core runs as it is and the package needs no `next` import. The contract is
// specs/006-js-server-helpers/contracts/public-api.md.
import { resolveMount, warnMounted, type InspectorOptions } from './core.ts';

export type { InspectorAgent, InspectorTheme } from './core.ts';

/** Next.js has no `path` argument: the route file's location sets the path. */
export type InspectorRouteOptions = Omit<InspectorOptions, 'path'>;

/** What Next.js passes a route handler: `params` is a promise from Next.js 15 and a plain object before it. */
export interface InspectorRouteContext {
  params: Promise<{ path?: string[] }> | { path?: string[] };
}

export type InspectorRouteHandler = (request: Request, context: InspectorRouteContext) => Promise<Response>;

/**
 * The handlers for `app/<path>/[[...path]]/route.ts`:
 *
 *     export const { GET, HEAD } = inspectorRoute({ agents: [...], enabled: process.env.NODE_ENV !== 'production' });
 *
 * Unless `options.enabled` is `true` the route answers 404 with no inspector content and logs nothing. Enabled, the first
 * request logs one warning that names the path, because Next.js loads a route module on its first request and only a
 * request tells the helper where the route lives (a `basePath` included).
 */
export function inspectorRoute(options: InspectorRouteOptions): { GET: InspectorRouteHandler; HEAD: InspectorRouteHandler } {
  const mounted = resolveMount(options);
  if (mounted === null) {
    const notFound = async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return { GET: notFound, HEAD: notFound };
  }
  let warned = false;
  const serve: InspectorRouteHandler = async (request, context) => {
    const { path = [] } = (await context?.params) ?? {};
    if (!warned) {
      warned = true;
      warnMounted(mountOf(new URL(request.url).pathname, path.length));
    }
    return mounted.handle(request, path.join('/'));
  };
  return { GET: serve, HEAD: serve };
}

/** The route's own path: the request path without the trailing slash and without the `[[...path]]` segments. */
function mountOf(pathname: string, assetSegments: number): string {
  const segments = pathname.split('/');
  if (segments.at(-1) === '') segments.pop();
  return segments.slice(0, Math.max(segments.length - assetSegments, 1)).join('/') || '/';
}
