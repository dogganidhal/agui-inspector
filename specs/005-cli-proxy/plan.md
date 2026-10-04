# Implementation Plan: Command line inspector with a local proxy

**Branch**: `gh-75-cli-proxy` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-cli-proxy/spec.md`, with the clarifications of 2026-10-04.

## Summary

Add the `agui-inspector` command to the `agui-inspector` npm package. `npx agui-inspector --target <url>` starts one
`node:http` listener on `127.0.0.1`. It serves the page, `config.json` and the content security policy through the
shared core of feature 006, and it relays every request under `/proxy/<n>/` to the origin of target `n`. The served
`config.json` lists each target as an agent whose `url` is its proxy path, so the page, which is embedded and reaches its
own origin only, needs no change.

The work is four small modules and the reuse of the core:

- `args.ts` turns `argv` into a typed result with `node:util` `parseArgs`. It checks targets and headers and never
  echoes a value.
- `proxy.ts` relays one request to one target with `http.request` or `https.request` and `stream.pipeline`. Bodies are
  streams of unchanged bytes. The header rules of the spec live here.
- `server.ts` builds the listener: the guards, the routing between proxy paths and the core, and the bind to
  `127.0.0.1`.
- `run.ts` and `main.ts` are the glue: print, exit codes, signals. `main.ts` is the `bin` entry and holds nothing else.

The core and its Node bridge come from `src/server` (feature 006) by relative import. They are not copied. Nothing here
enters the browser bundle, and the package gains no dependency. The command layout leaves room for subcommands by
reading the first argument as a command name, and builds none.

Spikes on Node.js 26.9 (the repository's local runtime) shaped the relay. [research.md](research.md) lists what each
proved: chunks reach the client in order and before the next write when the target writes 100 ms apart, invalid bytes
survive, a target that destroys its socket makes the client see a reset and never a clean end, and a client abort
reaches the target.

## Technical Context

**Language/Version**: Strict TypeScript 7.0.2 (`noUncheckedIndexedAccess`, `erasableSyntaxOnly`), Node.js 24 for the
repository and 22.12 or newer for adopters. No React.

**Primary Dependencies**: None. `node:http`, `node:https`, `node:stream`, `node:util` (`parseArgs`), `node:net`,
`node:fs` and the shared core of feature 006. No development dependency is added either.

**Storage**: None. Headers live in a `Map` in the process.

**Testing**: `node --test` through the esbuild runner for unit tests (in-process listener on port 0, scripted
`node:http` targets). Playwright for the shipped command: a real browser against the scripted reference agent, and
process-level specs (exit codes, output, signals, loopback bind) with no browser.

**Target Platform**: Node.js on the developer's machine. macOS, Linux and Windows run it. The loopback checks in the
tests skip the non-loopback case when the machine has no other IPv4 address.

**Project Type**: A command line entry of the existing npm package. No new package, no new workspace.

**Performance Goals**: None beyond a relay that adds no buffering: a chunk is written to the page in the turn it
arrives.

**Constraints**: The browser bundle and its limits do not change (2,000,000 bytes minified, 600,000 gzipped). Zero new
runtime dependencies. The listener binds `127.0.0.1` only. No outbound connection except to a configured target. Header
values never leave the target's requests.

**Scale/Scope**: Four source files of about 400 lines in all with their comments, one `bin` entry, one `package.json`
change, 5 unit test files, 2 Playwright specs, one docs page and a handful of one-line docs fixes.

## Constitution Check

Constitution 1.2.0. The constitution says that adding a CLI to the 0.1.0 MVP needs an explicit scope revision. The
maintainer-approved 0.2.0 roadmap (item 3), issue #75 and this specification are that revision. `ROADMAP.md` on `main`
shows the revised text once issue #86 merges, and this plan follows the approved text.

| Rule | Assessment and evidence |
| --- | --- |
| I: the wire comes first | The relay passes request and response bodies as streams of the exact bytes: no parse, no decode, no buffer to the end, no chunk merge held back. A cut stream stays a cut stream (research 3). The page's recorder and protocol client are not touched. Tests compare bytes, order and arrival of chunks. |
| II: the protocol, not a framework | No chat framework and no React. The command is framework-free Node code that imports the core of feature 006. It reads no frame and interprets no event. |
| III: generic core, application presets | No server-specific route or convention. A target is a URL and optional headers. Presets and capabilities stay the adopter's through the config format, and this feature sets none (spec assumptions). |
| IV: local-only operation, credential privacy | The command makes requests only to configured targets and sends no telemetry and no update check. "CLI mode MUST reach targets through its local proxy": the page's config points at proxy paths on its own origin and the packaged hosting policy stays embedded, so the page still reaches its own origin only. Command-line headers live in memory, go only to their target and are in no served file, output or error (research 6). The command removes `Cookie` and `Set-Cookie`, so no cookie is sent to a target from the browser's `localhost` jar (research 7). The recorder and exports are untouched, so they read no header. Target bytes that echo a header stay as sent. |
| V: small and auditable | No runtime or development dependency. Four files. The one extra compile target (`src/cli` in the `tsc` step of feature 006) reuses a tool the repository has. |
| VI: every event type has a view | Not touched. |
| Shared bundle and distribution | The one static bundle is served unchanged by the core. The Python wheel and `dist` do not change. Command code goes to `lib`, which the wheel never stages. |
| Embedded helpers | Not applicable: the command is an explicit run by the developer, not a mount in a host. It still writes the address and the targets it serves at startup. |
| Embedded requests, CLI | "The CLI MUST bind only to localhost, proxy only to explicitly configured targets, and pass target bytes unchanged": FR-006, FR-009, FR-010. Cookies: the page is embedded by policy and may send same-origin cookies to the listener, which drops them (research 7), so the other-modes rule "no cookies" holds toward the target. |
| Implementation tools | Strict TypeScript, `node --test`, Playwright, as before. No dynamic code: the existing source scan covers `src/cli`. |
| Quality gates | Type check, unit tests, build, bundle budget and end-to-end tests cover the change. End-to-end tests use the scripted reference agent and no outside service, check the network allowlist, and check that no header value appears in exports. |
| Release | One minor changeset for `agui-inspector`. No version edit, tag or publish. |

Result: pass, with no amendment and no principle worked around. One reading to review: the constitution's "other modes
MUST NOT send cookies" is met by the proxy dropping cookies, while the page keeps its embedded policy.

Post-design re-check: the design added the Host, Origin and `Sec-Fetch-Site` guards and the removal of `Cookie` and
`Set-Cookie` after the first assessment. All of them narrow what the command accepts or relays. None widens a principle.

## Project Structure

### Documentation (this feature)

```text
specs/005-cli-proxy/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── command-line.md      # options, messages, exit codes, output
│   └── proxy.md             # routes, guards, what is relayed and removed, statuses
├── checklists/requirements.md
└── tasks.md                 # from /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/
├── package.json             # bin: { "agui-inspector": "./lib/cli/main.js" }
├── tsconfig.server.json     # include += src/cli (the emit config of feature 006)
├── src/cli/
│   ├── main.ts              # #!/usr/bin/env node; wires signals to run(); nothing else
│   ├── run.ts               # run(argv, io): parse, listen, print, wait, close; returns the exit code
│   ├── args.ts              # parseCli(argv), Target, USAGE
│   ├── server.ts            # listen(options): guards, routing, bind 127.0.0.1
│   └── proxy.ts             # relay(request, response, target, path)
└── tests/cli/
    ├── args.test.ts         # options, rules, messages never echo a value
    ├── proxy.test.ts        # bytes, chunks, headers, cookies, errors, aborts
    ├── server.test.ts       # routes, config.json, refused spellings, guards, loopback bind, several targets
    ├── run.test.ts          # run(): output, streams, exit codes, self target, stop
    ├── outbound.test.ts     # source scan: the command makes no request of its own (FR-016)
    └── support.ts           # scripted servers, a plain client with chunk timing, a stand-in page
tests/e2e/cli/
├── command.spec.ts          # the shipped bin: help, errors, exit codes, port in use, signals, loopback, secrets
├── browser.spec.ts          # real browser against the reference agent through the command
└── support.ts               # start the command and scripted targets
.changeset/<name>.md         # agui-inspector: minor
website/content/docs/cli.mdx # the command's page; meta.json, index, status, hosted, embedding, development,
                             #   troubleshooting; README.md and packages/inspector/README.md point to it
```

Existing tests that change: `packages/inspector/tests/foundation/policy.test.ts` (it forbids `bin` in every manifest; the
published package may have exactly the `agui-inspector` command) and `packages/inspector/tests/foundation/static-path.test.ts`
(it asserts `pkg.bin === undefined`). The 006 build step (`scripts/build.mjs`, `buildServer()`) already checks that every
`exports` target exists in `lib`; it also checks the `bin` target.

**Structure Decision**: The command lives in `src/cli`, next to `src/server`, because both ship as Node code in `lib` and
neither enters the browser bundle. Replay and the conformance suite will add their own files here. `main.ts` holds only
the signal wiring so `run()` can be tested in process, and the Playwright specs cover the real entry.

## Design

### Order of work in one request

`server.ts` handles a request in this order. Each step ends the request or passes it on.

1. The request target must be an absolute path (`req.url` starts with `/`). Otherwise 403.
2. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (case-insensitive). Otherwise 403.
3. If the path starts with `/proxy/`: the next segment must be `1` to `<count>` written as plain digits, or 403. For a
   proxy path, `Origin` (when present) must be one of the two own origins and `Sec-Fetch-Site` (when present) must be
   `same-origin` or `none`, or 403. Then `relay`.
4. Anything else is the core's: the asset is the path with `/` mapped to `index.html`, decoded once. A failed decode is
   404. The core answers, and `sendResponse` writes it.

`CONNECT` and upgrade requests never reach step 1. The server has a `connect` and an `upgrade` listener that write
`HTTP/1.1 403 Forbidden` with `Connection: close` and end the socket. A server without these listeners is not enough: the
spike on Node.js 26.9 showed that an upgrade request with no `upgrade` listener is served as an ordinary request, and only
`CONNECT` is closed (research 5). A test checks both.

### The relay

`relay` does this and nothing more:

1. Builds the outbound headers from the request's headers: drops hop-by-hop names (and names the `Connection` header
   lists), `Host`, `Cookie`, `Origin` and `Referer`; then adds the target's held headers whose name the page did not send.
2. Calls `http.request` or `https.request` with `{ host, port, path, method, headers, agent: false }`. `path` is the
   text after the proxy number, with the query, used as given. The host and port come from the target, never from the
   path, so no spelling of the path can change them.
3. Pipes the request body into it and the response body out of it with `stream.pipeline`. On the response it writes
   `statusCode`, `statusMessage` and the raw header list without hop-by-hop names and `Set-Cookie`, flushes the headers,
   and pipes. Chunks are written as they arrive.
4. On an error before the response, it writes 502 with a one-line body that names the target's origin and the error
   code, and logs the same line to standard error. On an error after the headers, it destroys the page's socket. When the
   page's response closes before it finished, it destroys the outbound request.

### Arguments

`parseArgs` runs strict with `tokens: true`, so the order of `--target` and `--header` is known. Each header attaches to
the last target seen. Unknown options, missing values and options that take none fail inside `parseArgs`, and their
messages hold only option names (research 4). Everything else is written in `args.ts` with fixed messages.

### Next minor: subcommands

`parseCli` returns an `error` for a first argument that is not an option. When commands exist, that branch becomes a
lookup in a table of command functions, and `run` calls the one found with the rest of the arguments. The serve options
stay valid without a command. Nothing in this feature builds the table.

## Test plan

| Requirement | Tests |
| --- | --- |
| FR-001, FR-020 | `command.spec.ts` runs the packed `lib/cli/main.js` (`--version`, `--help`). A manifest test checks `bin`, the lack of runtime dependencies and that the page bundle has no command code (the bundle test of feature 006 gains command markers). |
| FR-002, FR-003, FR-019 | `args.test.ts`: every option, the first-argument rule, stray arguments, and that no message echoes a header value, a target's query or credentials. `run.test.ts`: the exit codes and the streams. |
| FR-004, FR-005 | `args.test.ts`: target and header rules, positional binding, a header before any target, a repeated header name. |
| FR-006, FR-017 | `server.test.ts`: a connection to `127.0.0.1` works and `::1` does not. `run.test.ts`: port in use gives exit code 1, a target at the command's own port gives exit code 2. `command.spec.ts`: the same through the shipped command, and a connection to the machine's other IPv4 address does not connect (it is refused, or a host firewall drops it). |
| FR-007, FR-008 | `server.test.ts`: routes, methods, HEAD, policy header on every core response, `config.json` content and key order, `hosting-config.json` unchanged. |
| FR-009, FR-013 | `proxy.test.ts` and `server.test.ts`: unknown number, absolute-form target, `*`, `CONNECT`, upgrade, `//host`, `@host`, `\`, encoded and dot forms, foreign `Host`, foreign `Origin`, cross-site fetch, with a counting target that must see nothing. |
| FR-010, FR-011 | `proxy.test.ts`: bytes with invalid UTF-8, ten chunks 100 ms apart that each arrive before the next write, request body, large body, compressed body, redirect, error statuses, hop-by-hop and cookie removal, page header wins, `Host` set for the target. |
| FR-009, FR-012 over HTTPS | `command.spec.ts`: an HTTPS target with a throwaway certificate made by `openssl` at test time. It relays when the child process trusts the certificate through `NODE_EXTRA_CA_CERTS`, and gives a 502 that names the origin and the certificate error code when it does not. Skipped, with the reason shown, when `openssl` is missing. |
| FR-012 | `proxy.test.ts`: refused connection and unknown name give 502 with the origin and code only, a cut stream is a failed stream, a page abort closes the target's connection. |
| FR-014 to FR-016 | `command.spec.ts` and `browser.spec.ts`: a unique synthetic header value is searched for in `config.json`, every served file, the command's output on every run and error case, and an exported session; the target received it. A counting target sees no extra request. |
| FR-018 | `command.spec.ts`: `SIGTERM` closes the listener and exits with 0 while a relay is in progress. |
| FR-021 | `browser.spec.ts`: the real browser opens the printed address, sees the agent, records a run against the reference agent and every request it made went to its own origin. |
| FR-022 | The development page test already requires every root script. The docs get the same read-through as the other pages (humanizer pass, plain-language check). |

## Complexity Tracking

No constitution violation. The costs to review:

| Cost | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Host, Origin and `Sec-Fetch-Site` checks | The listener can attach credentials. Without them, a web page in the same browser can use it, and a rebinding page can read through it | Trusting loopback alone makes the proxy an open door to the target for every site the developer visits (research 5) |
| Positional `--header` | A token for one target must not reach another | One list for all targets leaks across targets, and an option per target needs a second syntax |
| Removing `Cookie` and `Set-Cookie` | Browsers share `localhost` cookies across ports, so other local applications' cookies would go to the target | Relaying them hands unrelated cookies to a third party and stores the target's in a shared jar |
| `src/cli` in the `tsc` step | Node cannot run TypeScript from `node_modules` | Hand-written JavaScript can drift from the typed code |
