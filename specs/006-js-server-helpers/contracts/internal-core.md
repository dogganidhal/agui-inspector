# Contract: the shared core (internal)

Not exported from the package. It is the one implementation the three helpers use, and the interface the command line
tool of issue #75 will call from its own `node:http` listener. A change to it is a change to this file.

## `src/server/core.ts`

```ts
export const DEFAULT_PATH = '/agui-inspector';
export interface InspectorOptions { agents: readonly InspectorAgent[]; theme?: InspectorTheme; assetsDir?: string }
export type InspectorHandler = (request: Request, asset: string) => Promise<Response>;

/** The handler for one configuration. Throws if the files directory has no index.html. Reads nothing else until a request. */
export function createInspectorHandler(options: InspectorOptions): InspectorHandler;

export interface MountOptions extends InspectorOptions { enabled?: boolean; path?: string }
/** null when `enabled` is not true. Otherwise the checked, normalized mount path and its handler. Logs nothing. */
export function resolveMount(options: MountOptions): { mount: string; handle: InspectorHandler } | null;
/** The one warning text. Express and Hono call it after registering; Next.js calls it on the first request. */
export function warnMounted(mount: string): void;
```

### `handle(request, asset)`

- `asset` is the decoded path below the mount, without a leading `/`. `''` is the mount itself. The caller works it out
  from its own routing and decodes it exactly once. The core rejects an unsafe value with 404.
- Only `request.method` and `request.url` are read. Headers and body are ignored.
- A bare mount path is told from its slash form by whether `new URL(request.url).pathname` ends in `/`.
- It returns a `Response` for every input and throws only for an unexpected file system error (anything but a missing
  file or a directory). The host's error handling takes it from there.
- A caller that serves the inspector at the root of its own server (the CLI) passes `asset` from the path and handles
  the bare-path case itself, or sends `/index.html`.

## `src/server/node.ts`

```ts
/** Method and URL of a node:http message as a Request. `message.originalUrl`, when set (Express), wins over `message.url`. */
export function toRequest(message: IncomingMessage): Request;
/** Writes status, headers and the whole body. HEAD keeps the headers and sends no body. */
export function sendResponse(response: Response, serverResponse: ServerResponse): Promise<void>;
```

The CLI would write:

```ts
createServer(async (req, res) => sendResponse(await handle(toRequest(req), assetFor(req.url)), res));
```

## Rules the core guarantees

1. Every response has the content security policy. Redirects and errors included.
2. A path cannot leave the files directory by any spelling the callers can pass. Callers decode once. The core checks
   segments and the resolved path.
3. `config.json` is the version 0 file built from the options, equal to the Python helper's for equal input.
4. No state, no cache, no timer, no request of its own. Each call reads at most one file.
