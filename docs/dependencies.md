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

## Known upstream findings

These come from the pinned baseline and are recorded here rather than worked around by changing it.

- `npm audit` reports a moderate DOMPurify advisory reached through `@a2ui/react` 0.12.0 and
  `@a2ui/markdown-it`. The baseline is pinned, so this PR does not change it. Markdown rendering of
  conversation text is out of scope; whether the renderer's own Markdown path is reachable is for
  the A2UI slice to check.
- `@ag-ui/a2ui-middleware` imports Node's `crypto` at module scope. `scripts/build.mjs` resolves that
  import to a small browser stand-in (`randomUUID` from Web Crypto; `createHash` throws).
- `clarinet`, which the middleware depends on, calls `require("stream")` inside a try/catch. The
  browser bundle keeps that guarded call.
- `@ag-ui/client` splits SSE events on `\n\n` only, so CRLF or CR delimited streams make the client
  fail. The recorder's own frame reader has to handle all three delimiters (slice F05) while the
  recording branch keeps draining.
