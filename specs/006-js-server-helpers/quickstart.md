# Quickstart: validate the JavaScript server helpers

Run from the repository root. Node.js 24 or newer. Nothing here publishes or releases anything.

## 1. Install and build

```sh
npm ci --ignore-scripts
npm run build
```

`npm run build` writes `packages/inspector/dist` (the page) and `packages/inspector/lib` (the helpers). It fails when an
`exports` target of the package is missing from `lib`.

## 2. Unit tests

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/server
```

They use a stand-in directory for the page, so they run without step 1. They cover, for the core and for Express 5, Hono
and Next.js: mounting, the disabled case, the warning, the content security policy, the redirect,
`config.json`, path traversal, methods and a host guard in front of the routes. A further test checks that the page
bundle has no helper code.

## 3. Package and browser tests

```sh
npm run test:e2e -- tests/e2e/js-helpers --workers=2
```

`package.spec.ts` imports each entry the way a host would: ESM `import`, CommonJS `require`, a TypeScript consumer
under `NodeNext`, and `npm pack --dry-run` for the file list. `embedding.spec.ts` opens the real page served by each
helper in Chromium, sees the configured agent, runs the scripted reference agent and checks the recorded frames and that
no request left the page's origin.

## 4. By hand (optional)

An Express host with no model, from a scratch directory:

```sh
npm pack --workspace packages/inspector --pack-destination "$TMPDIR"
mkdir try && cd try && npm init -y && npm i express "$TMPDIR"/agui-inspector-*.tgz
```

```js
// server.mjs
import express from 'express';
import { mountInspector } from 'agui-inspector/express';

const app = express();
mountInspector(app, { agents: [{ id: 'demo', url: '/agents/demo/stream' }], enabled: true });
app.listen(3000);
```

`node server.mjs` logs the warning. `http://localhost:3000/agui-inspector` redirects to `.../agui-inspector/index.html`
and lists `demo`. With `enabled: false` the same URL is Express's own 404.

A Next.js host, from a scratch directory: create `app/agui-inspector/[[...path]]/route.ts` as in
[contracts/public-api.md](contracts/public-api.md), run `next dev`, and open `/agui-inspector` with the default
`next.config`.

## 5. The full gate

```sh
npm run check:ci
```

## Expected outcomes

| Check | Outcome |
| --- | --- |
| Disabled helper | zero routes, zero log lines, the host's 404 (Next.js: the route's 404) |
| Enabled helper | one warning that names the mount path |
| Every response | the content security policy header |
| `config.json` | equals the Python helper's for the same agents and theme |
| `../`, encoded or not, `\`, null byte | 404, never a file outside the directory |
| Page bundle | no helper code, same budgets |
| `agui-inspector` manifest | no new runtime dependency |
