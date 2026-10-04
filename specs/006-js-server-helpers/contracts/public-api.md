# Contract: the three helpers

What a host imports and what it gets. Everything here is checked by a test (see `quickstart.md`).

## Entries

| Import | Export | Used as |
| --- | --- | --- |
| `agui-inspector/express` | `mountInspector(app, options)` | `app` is an Express application or `Router` |
| `agui-inspector/hono` | `mountInspector(app, options)` | `app` is a Hono application |
| `agui-inspector/next` | `inspectorRoute(options)` | returns `{ GET, HEAD }` for a route file |

The Express helper needs only `app.use(path, handler)` from the host. It is tested with Express 5. All three are ES
modules with `.d.ts` files. Node.js 22.12 or newer can `require()` them. Importing one loads no
framework. A host needs the Node.js runtime: the helpers read files with `node:fs`.

## Types

```ts
interface InspectorAgent { id: string; url: string; name?: string; capabilities?: Record<string, unknown> | string; preset?: Record<string, unknown> }
interface InspectorTheme { light?: Record<string, string>; dark?: Record<string, string> }
interface InspectorBrand { name?: string; logo?: string; logoDark?: string }
interface InspectorOptions { agents: readonly InspectorAgent[]; enabled?: boolean; path?: string; theme?: InspectorTheme; brand?: InspectorBrand }
type InspectorRouteOptions = Omit<InspectorOptions, 'path'>
interface InspectorRouteContext { params: Promise<{ path?: string[] }> }   // Next.js 15 and later; a plain object also works at run time
type InspectorRouteHandler = (request: Request, context: InspectorRouteContext) => Promise<Response>
```

Each entry exports the types it uses. The `app` parameter types are structural, so the package imports no framework:

```ts
interface ExpressLike { use(path: string, handler: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void): unknown }   // Express application or Router
interface HonoLike { all(path: string, handler: (c: { req: { raw: Request; param(name: string): string | undefined } }) => Response | Promise<Response>): unknown }
```

## `mountInspector(app, options)` for Express and Hono

- `enabled` not `true`: returns. No route, no log, no file read, no check.
- Otherwise: validates `path`, then `agents`, then that the page exists, throws on the first failure, and registers the
  routes. Then logs one warning with `console.warn`:
  `agui-inspector is enabled and mounted at <mount>; disable it outside development`.
- Express: `app.use(<mount>, handler)`. It answers for every method and every path below the mount.
- Hono: `app.all(<mount>, handler)` and `app.all(<mount>/:asset{.*}, handler)`.

## `inspectorRoute(options)` for Next.js

Used in `app/<path>/[[...path]]/route.ts`:

```ts
import { inspectorRoute } from 'agui-inspector/next';
export const { GET, HEAD } = inspectorRoute({ agents: [{ id: 'support', url: '/agents/support/stream' }], enabled: process.env.NODE_ENV !== 'production' });
```

- `enabled` not `true`: `GET` and `HEAD` answer `404` with no inspector content and log nothing. No file is read.
- Otherwise: validates `agents` and the page at call time and throws on failure. Each handler takes `(request, { params })`
  where `params` is a promise of an object with an optional `path` array (a plain object works at run time too, and the type says promise because Next.js checks it when it builds). The first request logs the warning once,
  with the mount path worked out from the request URL minus the `path` segments.
- Other methods are answered by Next.js itself (405).
- Works in the default `next.config`, with `basePath`, and with either trailing slash setting.

## Routes (mount `/agui-inspector`)

| Request | Response |
| --- | --- |
| `GET /agui-inspector` | 307 to `agui-inspector/index.html`, query kept |
| `GET /agui-inspector/` | the page, where the host passes the slash form through |
| `GET /agui-inspector/index.html` | the page |
| `GET /agui-inspector/config.json` | the configuration |
| `GET /agui-inspector/<file>` | a packaged file, nested ones included |
| other path below the mount | 404 |
| other method below the mount | 405 with `Allow: GET, HEAD` (Express and Hono) |

Every response has `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri 'none'`.

## Guard placement (documented per framework)

- Express: register the guard with `app.use` before `mountInspector`. A guard registered after it does not run.
- Hono: register the middleware before `mountInspector` too (`app.use('/agui-inspector/*', guard)`, or `app.use('*', guard)`).
- Next.js: guard in `middleware.ts` (or `proxy.ts` in Next.js 16) with a matcher that covers the path, or inside the route file.

## Errors

| Cause | When | Message starts with |
| --- | --- | --- |
| `path` empty of a sub-path or without a leading `/` | enabled call | `path must start with '/' and name a sub-path` |
| missing or duplicate `id`, missing `url` | enabled call | `every agent needs a unique nonempty id and a url` |
| no `index.html` in the files directory | enabled call | `the packaged inspector files are missing` |

The messages match the Python helper where one exists.
