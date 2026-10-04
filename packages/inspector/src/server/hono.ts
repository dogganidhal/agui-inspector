// The Hono helper: `mountInspector(app, options)`, the counterpart of the Python `mount_inspector`. Hono already speaks
// web-standard `Request` and `Response`, so the core runs as it is. The helper takes anything with Hono's `all`, so the
// package needs no dependency on Hono. The contract is specs/006-js-server-helpers/contracts/public-api.md.
import { resolveMount, warnMounted, type InspectorOptions } from './core.ts';

export type { InspectorAgent, InspectorOptions, InspectorTheme } from './core.ts';

/** The part of a Hono application that the helper uses. */
export interface HonoLike {
  all(
    path: string,
    handler: (context: { req: { raw: Request; param(name: string): string | undefined } }) => Response | Promise<Response>,
  ): unknown;
}

/**
 * Serves the inspector page, its files and `<path>/config.json` from `app`. Does nothing, and checks nothing, unless
 * `options.enabled` is `true`. Enabling logs a warning that names the mount path. It adds no authentication: register the
 * host's own middleware with `app.use` before this call, so it runs first.
 */
export function mountInspector(app: HonoLike, options: InspectorOptions): void {
  const mounted = resolveMount(options);
  if (mounted === null) return;
  const { mount, handle } = mounted;
  // `all`, so that a POST reaches the core and gets its 405. `{.*}` also matches the empty asset of `<mount>/`, which
  // Hono's default strict routing keeps apart from `<mount>`. Hono decodes the parameter.
  app.all(mount, (c) => handle(c.req.raw, ''));
  app.all(`${mount}/:asset{.*}`, (c) => handle(c.req.raw, c.req.param('asset') ?? ''));
  warnMounted(mount);
}
