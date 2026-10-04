// The shared core of the JavaScript server helpers (Express, Hono, Next.js) and, later, of the command line tool. It
// serves the packaged inspector page, `config.json` and the packaged files on web-standard `Request` and `Response`, and
// holds the rules every helper shares: the `enabled` gate, the path and agent checks and the warning text. Nothing here
// imports a framework or React. The contract is specs/006-js-server-helpers/contracts/internal-core.md.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { staticAssetsPath } from '../static-path.js';

export const DEFAULT_PATH = '/agui-inspector';

// Same policy as the page's own <meta>: own-origin scripts only, and no eval.
const POLICY = "script-src 'self'; object-src 'none'; base-uri 'none'";

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// What a request for a name that does not exist raises. Anything else (permissions, a failing disk) is the host's to see.
const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG']);

/** One entry of the browser configuration. Only `id` and `url` are required. */
export interface InspectorAgent {
  id: string;
  url: string;
  name?: string;
  capabilities?: Record<string, unknown> | string;
  preset?: Record<string, unknown>;
}

/** `{ light, dark }`, each a map from a `--agui-*` property name to a CSS value. The page validates it. */
export interface InspectorTheme {
  light?: Record<string, string>;
  dark?: Record<string, string>;
}

/** What the handler is built from. */
export interface HandlerOptions {
  agents: readonly InspectorAgent[];
  theme?: InspectorTheme;
  /** The directory with the built page. Tests use a stand-in. @internal */
  assetsDir?: string;
}

/** The helper arguments for Express and Hono, as in the Python `mount_inspector`. */
export interface InspectorOptions extends HandlerOptions {
  /** Mounts only when `true`. Default `false`. */
  enabled?: boolean;
  /** Where the page lives. Default `/agui-inspector`. It starts with `/` and is not `/` alone. */
  path?: string;
}

/**
 * Answers one request for `asset`, the decoded path below the mount: `''` is the mount itself, `config.json`,
 * `app.js`, `assets/chunk.js`. The caller works `asset` out from its own routing and decodes it once.
 */
export type InspectorHandler = (request: Request, asset: string) => Promise<Response>;

/**
 * The handler for one configuration. Throws when the files directory has no `index.html`. Reads no other file until
 * a request asks for it.
 */
export function createInspectorHandler(options: HandlerOptions): InspectorHandler {
  const root = path.resolve(options.assetsDir ?? staticAssetsPath);
  if (!existsSync(path.join(root, 'index.html'))) {
    throw new Error("the packaged inspector files are missing; build them with 'npm run build'");
  }
  // JSON.stringify leaves out the fields that are undefined, which is the file the Python helper writes.
  const config = JSON.stringify({ version: 0, agents: options.agents, theme: options.theme });

  const reply = (body: BodyInit | null, status: number, headers: Record<string, string>) =>
    new Response(body, { status, headers: { 'content-security-policy': POLICY, ...headers } });
  const notFound = () => reply('Not found', 404, { 'content-type': 'text/plain' });

  return async (request, asset) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply('Method Not Allowed', 405, { allow: 'GET, HEAD', 'content-type': 'text/plain' });
    }
    const url = new URL(request.url);
    if (asset === '' && !url.pathname.endsWith('/')) {
      // The page's files are relative to its own address, so it must load from a URL inside the mount. A Next.js
      // application redirects `<mount>/` back to `<mount>` by default, so the target is index.html, not the slash form.
      // Relative to the address the client used, it holds under any outer prefix.
      const last = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
      return reply(null, 307, { location: `${last}/index.html${url.search}` });
    }

    let body: string | Uint8Array<ArrayBuffer>;
    let type: string;
    if (asset === 'config.json') {
      body = config;
      type = CONTENT_TYPES['.json']!;
    } else {
      const parts = asset === '' ? ['index.html'] : asset.split('/');
      if (parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) return notFound();
      const file = path.resolve(root, ...parts);
      if (!file.startsWith(root + path.sep)) return notFound();
      try {
        const bytes = await readFile(file);
        body = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      } catch (error) {
        if (MISSING.has((error as NodeJS.ErrnoException).code ?? '')) return notFound();
        throw error;
      }
      type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    }
    const length = typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength;
    return reply(request.method === 'HEAD' ? null : body, 200, { 'content-type': type, 'content-length': String(length) });
  };
}

/**
 * The shared start of `mountInspector` and `inspectorRoute`. Returns `null`, having checked and read nothing, unless
 * `enabled` is exactly `true`. Otherwise it checks `path`, then `agents`, then that the page exists, and throws on the
 * first problem. The messages match the Python helper where it has one. It logs nothing: see `warnMounted`.
 */
export function resolveMount(options: InspectorOptions): { mount: string; handle: InspectorHandler } | null {
  if (options.enabled !== true) return null;
  const given = options.path ?? DEFAULT_PATH;
  if (!given.startsWith('/') || given.replace(/\//g, '') === '') {
    throw new Error(`path must start with '/' and name a sub-path, got ${JSON.stringify(given)}`);
  }
  const { agents } = options;
  const ids = Array.isArray(agents) ? agents.map((agent) => agent?.id) : [];
  if (!Array.isArray(agents) || ids.some((id) => !id) || agents.some((agent) => !agent?.url) || new Set(ids).size !== ids.length) {
    throw new Error('every agent needs a unique nonempty id and a url');
  }
  return { mount: given.replace(/\/+$/, ''), handle: createInspectorHandler(options) };
}

/** The one warning: the inspector shows request bodies and raw frames to anyone who can reach it. */
export function warnMounted(mount: string): void {
  console.warn(`agui-inspector is enabled and mounted at ${mount}; disable it outside development`);
}
