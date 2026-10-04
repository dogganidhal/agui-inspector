// The Express helper: `mountInspector(app, options)`, the counterpart of the Python `mount_inspector`. It takes anything
// with Express's `use` (an application or a Router), so the package needs no dependency on Express. The contract is
// specs/006-js-server-helpers/contracts/public-api.md.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolveMount, warnMounted, type InspectorOptions } from './core.ts';
import { sendResponse, toRequest } from './node.ts';

export type { InspectorAgent, InspectorOptions, InspectorTheme } from './core.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;

/** The part of an Express application or Router that the helper uses. */
export interface ExpressLike {
  use(path: string, handler: Handler): unknown;
}

/**
 * Serves the inspector page, its files and `<path>/config.json` from `app`. Does nothing, and checks nothing, unless
 * `options.enabled` is `true`. Enabling logs a warning that names the mount path. It adds no authentication: register the
 * host's own middleware with `app.use` before this call, so it runs first.
 */
export function mountInspector(app: ExpressLike, options: InspectorOptions): void {
  const mounted = resolveMount(options);
  if (mounted === null) return;
  const { mount, handle } = mounted;
  app.use(mount, (req, res, next) => {
    // Inside `app.use(mount, ...)` Express makes `req.url` relative to the mount. `toRequest` takes the address the
    // client used from `originalUrl`.
    const relative = (req.url ?? '/').split('?')[0]!.slice(1);
    let asset: string;
    try {
      asset = relative.split('/').map(decodeURIComponent).join('/');
    } catch {
      asset = '..'; // a malformed escape names no file, and the core answers `..` with 404
    }
    handle(toRequest(req), asset)
      .then((response) => sendResponse(response, res))
      .catch(next);
  });
  warnMounted(mount);
}
