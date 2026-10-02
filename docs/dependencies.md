# Dependencies

Every direct dependency is pinned to an exact version in a `package.json` and resolved through the
committed `package-lock.json`. Installation runs no lifecycle scripts (`.npmrc` sets
`ignore-scripts=true`). A dependency is added only for a demonstrated need, and its row says what
the platform or an existing dependency could not do instead.

Tooling: npm workspaces, Node 24 LTS (`engines.node` is `>=24`).

## Runtime dependencies (`packages/inspector`)

| Package | Version | Purpose | Rejected alternative |
| --- | --- | --- | --- |
| `@ag-ui/core` | 1.0.1 | Event, run-input and resume types plus the Zod schemas used to validate frames. Implements the 31-event protocol 1.0 baseline. | Local copies of the schemas would drift from the protocol. |
| `@ag-ui/client` | 1.0.1 | `HttpAgent` keeps the derived transcript, state, interrupts and outcomes, reports sequence errors, and takes the recorder's `fetch`. | Hand-written client: duplicates the protocol rules. `EventSource`: cannot POST a run body. |
| `@ag-ui/a2ui-middleware` | 0.0.11 | Only the official `RENDER_A2UI_TOOL` declaration and the A2UI action types. | Re-declaring the tool schema would diverge from the middleware. Its Node `crypto` import is replaced in the browser build by `scripts/build.mjs`. |
| `@a2ui/react` | 0.12.0 | The A2UI v0.9 React renderer (`@a2ui/react/v0_9`). | A custom renderer or a chat framework: the constitution requires the official renderer packages. |
| `@a2ui/web_core` | 0.12.0 | `MessageProcessor` and the surface model that drive the v0.9 renderer. | Hand-written message processing. |
| `react` | 19.3.0 | Views, and a peer of the renderer. | Plain DOM: the constitution requires React views. |
| `react-dom` | 19.3.0 | Browser rendering, and server rendering in unit tests of the scaffold. | None: it is the React DOM target. |
| `zod` | 3.25.76 | Peer of both `@ag-ui/core` and the renderer. Stays on 3.x because the renderer's peer range is `^3.25.76`. | Zod 4: outside the renderer's peer range. |

## Development dependencies (repository root)

| Package | Version | Purpose | Rejected alternative |
| --- | --- | --- | --- |
| `typescript` | 7.0.2 | Strict type checking (`npm run typecheck`). | JSDoc checking: the sources are TypeScript. |
| `esbuild` | 0.28.2 | Production bundle and compilation of unit tests. Works without its postinstall because the platform binary is an optional dependency. | Vite or webpack: more machinery than a one-bundle static build needs. |
| `@playwright/test` | 1.63.0 | End-to-end tests and the network-allowlist check. Browsers are installed by an explicit command, not at install time. | jsdom: no real layout or network, and the A2UI renderer does not support server rendering. |
| `@types/node` | 24.19.1 | Types for `node:test` and the build scripts, matching Node 24. | None. |
| `@types/react` | 19.3.0 | Types for React 19.3. | None. |
| `@types/react-dom` | 19.3.0 | Types for React DOM 19.3. | None. |

## License and notices

The project is MIT, `Copyright (c) 2026 Nidhal Dogga` (`LICENSE`). `THIRD_PARTY_NOTICES.txt` lists every
non-development package in `package-lock.json` (42 at the time of writing) with its license, says which of them
`dist/app.js` bundles, and reproduces the full license texts. It includes the Apache-2.0 text for `@a2ui/react`,
`@a2ui/web_core` and `@a2ui/markdown-it`; none of the three, and no other listed package, ships a `NOTICE` file.
Packages whose tarball has no license file (`@bufbuild/protobuf`, `@lit-labs/ssr-dom-shim`,
`@protobuf-ts/protoc`) use the text from their upstream repository, and the file says so. The notices were written
from the license files in the installed packages. Regenerate them when a dependency changes: a Python test fails
when a runtime package in the lockfile is missing from the file, or when a `NOTICE` file appears upstream and is not
reproduced. Both package directories carry byte-identical copies of `LICENSE` and `THIRD_PARTY_NOTICES.txt`, because
npm and `uv_build` cannot pack files from outside the package; a test compares them.

## Known upstream findings

These come from the pinned baseline and are recorded here rather than worked around by changing it.

- **DOMPurify override (D01).** `@a2ui/react` 0.12.0 depends on `@a2ui/markdown-it` 0.2.0, which pins DOMPurify
  3.4.11. That version is affected by [GHSA-c2j3-45gr-mqc4](https://github.com/advisories/GHSA-c2j3-45gr-mqc4) and
  [GHSA-55q2-fjhq-7xh7](https://github.com/advisories/GHSA-55q2-fjhq-7xh7). The root `package.json` sets
  `"overrides": { "dompurify": "3.4.16" }` and the committed lockfile resolves exactly 3.4.16; check it with
  `npm ls dompurify --all`. The override changes neither the required renderer nor the direct dependency list.
  The production bundle does not currently include DOMPurify or `@a2ui/markdown-it` (conversation Markdown is out of
  scope), so the override protects the installed tree and any future use of the renderer's Markdown path. Remove
  it when A2UI ships a fixed pin, and review the lockfile in the same change. The lockfile was updated with
  `npm update dompurify --ignore-scripts`; no lifecycle script ran.
- `@ag-ui/a2ui-middleware` imports Node's `crypto` at module scope. `scripts/build.mjs` resolves that
  import to a small browser stand-in (`randomUUID` from Web Crypto; `createHash` throws).
- `clarinet`, which the middleware depends on, calls `require("stream")` inside a try/catch. The
  browser bundle keeps that guarded call.
- `@ag-ui/client` splits SSE events on `\n\n` only, so CRLF or CR delimited streams make the client
  fail. The recorder's own frame reader has to handle all three delimiters (slice F05) while the
  recording branch keeps draining.
