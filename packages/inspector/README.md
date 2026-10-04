# agui-inspector

The static files of the AG-UI inspector. The inspector records every request and server-sent event (SSE) frame of an
AG-UI server, checks them against the protocol and lets you drive runs from the browser.

This package has no CLI and no server helper. It exports one value, `staticAssetsPath`, the absolute path of the
directory that holds the built page. Serve that directory from any static file server.

```js
import { staticAssetsPath } from 'agui-inspector';

console.log(staticAssetsPath); // .../node_modules/agui-inspector/dist
```

For a Python server, use the [`agui-inspector`](https://pypi.org/project/agui-inspector/) package on PyPI instead. It
mounts the same files in Starlette or FastAPI.

See the [docs](https://dogganidhal.github.io/agui-inspector/docs/hosted/) to set up the page, and the
[repository](https://github.com/dogganidhal/agui-inspector) for the source.
