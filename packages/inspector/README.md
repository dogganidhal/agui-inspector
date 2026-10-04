# agui-inspector

The static files of the AG-UI inspector, helpers that serve them from Express, Hono and Next.js, and a command that
serves them on your machine. The inspector records every request and server-sent event (SSE) frame of an AG-UI server,
checks them against the protocol and lets you drive runs from the browser.

## Command line

From version 0.2.0, one command serves the inspector on `127.0.0.1` and relays its requests to your server, in any
language. Your server needs no CORS setup and no helper. Node.js 22.12 or newer.

```sh
npx agui-inspector --target http://127.0.0.1:8787/agent --header "Authorization: Bearer <token>"
```

A `--header` is sent to the `--target` before it, and to no other. The command listens on `127.0.0.1` only, relays to the
targets you name and refuses every other host. Command-line arguments are visible in the process list and your shell
history, so keep long-lived secrets out of them. The [docs](https://dogganidhal.github.io/agui-inspector/docs/cli/) cover
the options and the limits.

## Express, Hono and Next.js

From version 0.2.0, one call in your server serves the inspector next to your agent routes, on the same origin, so your
own authentication applies. Node.js 22.12 or newer.

```js
import { mountInspector } from 'agui-inspector/express'; // or 'agui-inspector/hono'

mountInspector(app, {
  agents: [{ id: 'support', url: '/agents/support/stream' }],
  enabled: process.env.NODE_ENV !== 'production',
});
```

In Next.js, a route file at `app/agui-inspector/[[...path]]/route.ts` exports the handlers:

```js
import { inspectorRoute } from 'agui-inspector/next';

export const { GET, HEAD } = inspectorRoute({ agents: [{ id: 'support', url: '/api/agents/support' }], enabled: true });
```

Nothing is mounted unless `enabled` is `true`, and an enabled helper logs a warning that names the path. The
[docs](https://dogganidhal.github.io/agui-inspector/docs/embedding/#javascript-servers) cover the arguments,
authentication and routes.

## Static assets

`staticAssetsPath` is the absolute path of the directory that holds the built page. Serve that directory from any other
static file server.

```js
import { staticAssetsPath } from 'agui-inspector';

console.log(staticAssetsPath); // .../node_modules/agui-inspector/dist
```

For a Python server, use the [`agui-inspector`](https://pypi.org/project/agui-inspector/) package on PyPI instead. It
mounts the same files in Starlette or FastAPI.

See the [docs](https://dogganidhal.github.io/agui-inspector/docs/hosted/) to set up the page, and the
[repository](https://github.com/dogganidhal/agui-inspector) for the source.
