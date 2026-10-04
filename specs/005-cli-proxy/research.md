# Research: command line inspector with a local proxy

Evidence comes from two spikes run on 2026-10-04 in a scratch directory outside the repository, on Node.js 26.9.0:
a relay of about 30 lines (`http.request` and `stream.pipeline`) between a scripted target and a plain client, and a
`parseArgs` probe. The spikes are not part of the change. The decisions below say what they proved. The plan checks the
Node.js 24 behavior again when the tests run in CI.

## 1. Where the command lives and how it ships

Decision: write the command in TypeScript under `packages/inspector/src/cli/`, compile it with the `tsc` step that
feature 006 adds (`tsconfig.server.json`, output in `packages/inspector/lib/`), and point `bin` at
`./lib/cli/main.js`. `main.js` starts with `#!/usr/bin/env node`, which `tsc` keeps. The `files` list of feature 006
already ships `lib`. The `include` of `tsconfig.server.json` gains `src/cli`.

Rationale: Node does not strip types from files under `node_modules`, so TypeScript cannot ship as it is. The compile
step exists after feature 006 and costs nothing more. Putting the command next to `src/server` keeps the Node code
together and leaves `src/cli` for the replay and conformance commands of the next minor.

Alternatives considered: put the command in `src/server` (it is not a server helper, and subcommands would crowd that
folder); a new package for the command (the issue says `npx agui-inspector`, and a second package needs its own
release and its own provenance); a `bin` that points at `.ts` (refused by Node for installed packages).

The repository's tests forbid a `bin` today (`policy.test.ts` for every manifest, `static-path.test.ts` for the package).
Both change: the published package may have exactly one `bin` entry, `agui-inspector`, and every other manifest still
may not.

## 2. Reusing the core of feature 006

Decision: `server.ts` calls `createInspectorHandler({ agents })` once, with one agent per target, and answers every
request that is not a proxy path with `sendResponse(await handle(toRequest(request), asset), response)`. The asset is
the decoded path below `/`, and `/` becomes `index.html`, as `contracts/internal-core.md` of feature 006 says for a host at
the root.

Rationale: the issue and feature 006 both require one implementation of file serving, path safety, the policy header
and the configuration text. The CLI adds no second one.

Checked against the contract, to verify when feature 006 merges (the plan assumes it, and the tasks start by reading
the merged code):

- The core serves `hosting-config.json` and every packaged file, so the page starts under the embedded policy.
- `config.json` is built from `agents` with only the fields given. The CLI passes `id`, `name` and `url`.
- `handle` takes `request.method` and `request.url` only. If the merged core leaves the `405` for methods other than GET
  and HEAD to the adapters, the CLI does it in its router (a few lines).
- `createInspectorHandler` throws when the packaged page is missing, with a message that names the build step. `run()`
  prints it and exits with 1.

If the merged API differs, the change is made here in the plan and in `tasks.md` before any code.

Reconciliation with the merged code (PR #93, read on 2026-10-04 before any code of this feature). The contract holds. The
differences, none of which changes the design:

- `config.json` is `{ version, agents, theme, brand }`. `brand` came with issue #73. The command passes no `theme` and
  no `brand`, so its file has `version` and `agents` only.
- The core answers 405 with `Allow: GET, HEAD` for every other method, `HEAD` included in what it serves. `server.ts` adds
  no 405 of its own, and task T009 drops that conditional.
- `toRequest` takes the path and query of an absolute-form target, reads `//` as a path, and turns `CONNECT`, `TRACE` and
  `TRACK` into `OPTIONS`. The command refuses absolute-form targets and `CONNECT` before the core sees them, so the
  bridge never has to.
- `sendResponse` buffers a whole body. That is right for the page files and `config.json`. The relay does not use it.
- The missing-files message is `the packaged inspector files are missing; build them with 'npm run build'`, so `run()`
  prints the core's message as it is.
- `buildServer()` in `scripts/build.mjs` already checks the `exports` targets. T010 adds the `bin` target to that check.
  `tsconfig.server.json` includes `src/server/**/*` and `src/static-path.js`, and T002 adds `src/cli/**/*`.
- `tests/e2e/js-helpers/package.spec.ts` already reads every `lib` file and requires `node:` or relative `.js` imports
  only. The command files follow that rule.
- `AGENTS.md` has a "Where things are" row for `src/server`. T032 adds one for `src/cli`.

## 3. The relay: `http.request` and `stream.pipeline`

Decision: relay with the platform's `http.request` or `https.request`, `agent: false`, the raw header list for the
response, `res.flushHeaders()` after `writeHead`, `setNoDelay(true)` on the outbound request, and `stream.pipeline` in
both directions.

Spike results:

| Case | Result |
| --- | --- |
| Target writes 10 chunks 100 ms apart, one of them the bytes `ff fe 0a` | The client received 10 chunks in order. Each of the first 9 arrived before the target wrote the next. The invalid bytes arrived as sent. |
| Target writes `Set-Cookie` twice, `X-Multi` twice, and the relay drops hop-by-hop names and `Set-Cookie` | The client saw both `X-Multi` lines in order, no `Set-Cookie`, and a `Transfer-Encoding: chunked` that Node added for its own hop. |
| Target writes one chunk and destroys its socket | The client's response ended with `ECONNRESET` and `complete` false. It did not end cleanly. `pipeline` destroyed the page's response, which is what the spec asks for. |
| Client destroys its request while the target holds the response open | The target's response emitted `close` in the same millisecond. The abort reached the target. |

`fetch` is not used: it decompresses response bodies and hides raw headers, which would change the bytes the page
records. `agent: false` gives one connection per request, so a stream's timing never depends on a pooled socket that a
target closed at the wrong moment. `res.on('close')` with `writableFinished` false is the page-abort signal, because
`req.on('close')` fires in Node 16 and later when the request body has been read, not when the socket goes.

Chunk boundaries are kept as far as Node allows: each `data` event of the target's response is one `write` to the page.
Node's HTTP parser and TCP can still merge two writes the target made in the same turn, or split one that crossed a
packet. The spec asks for the case that matters, chunks written apart in time.

Alternatives considered: a library such as `http-proxy` (a new runtime dependency for forty lines of platform code, and
its buffering and header rewriting need a review); `http2` (the page's recorder and the targets are HTTP/1.1).

## 4. Arguments: `parseArgs` with tokens

Decision: `parseArgs({ strict: true, allowPositionals: true, tokens: true })` with `target` and `header` as repeatable
string options, `port` as a string option checked by a rule, and `help` and `version` as booleans.

Spike results:

- `tokens` gives options and positionals in command-line order, so each `--header` attaches to the last `--target` before
  it. A header before any target is detected from the token list.
- `--header=Y: value` and `--header "Y: value"` give the same token.
- Messages from `parseArgs` name only the option. `--bogus=SECRET` reports `Unknown option '--bogus'`, and `--help=SECRET`
  reports `Option '--help' does not take an argument`. None echoes a value.
- `--header` as the last argument, and `--header --target`, fail with a message that names the option.
- An unquoted header, `--header Authorization: Bearer SECRET`, gives the header value `Authorization:` and the stray
  positionals `Bearer` and `SECRET`. A stray positional is therefore a usage error that echoes nothing, and an empty
  header value is a usage error. A first argument that is not an option is the only one echoed, as a command name.
- `-h` and `-v` are unknown options. The spec lists only `--help` and `--version`.

Alternatives considered: `commander` or `yargs` (a runtime dependency for five options); parsing `argv` by hand (the
platform parser already handles `=`, `--` and missing values).

## 5. Why the browser guards

The relay can attach credentials. A web page in the same browser can try to use it in four ways:

| Attack | What stops it |
| --- | --- |
| A page on another site sends `fetch` or a form POST to `http://127.0.0.1:4747/proxy/1/...` | The browser sends `Origin` on every cross-origin request except a plain GET. The relay refuses a foreign `Origin`. It also refuses `Sec-Fetch-Site` values other than `same-origin` and `none`, which covers GETs, images and navigations that carry no `Origin`. |
| A page rebinds its own host name to `127.0.0.1`, so the browser treats the listener as same-origin | The relay refuses any `Host` that is not `127.0.0.1:<port>` or `localhost:<port>`. |
| A page on another machine on the network | The listener binds `127.0.0.1` only. |
| A client sends `CONNECT` or `Upgrade: websocket` | Spike on Node.js 26.9: with no `upgrade` listener, Node serves the upgrade request as an ordinary request (it got a 200), and with no `connect` listener it closes a `CONNECT` socket without a reply. The server therefore registers both listeners and answers 403, so the behavior does not depend on the Node.js version. |
| Another program of the same user | Not defended. The relay trusts the account that started it. The documentation says so. |

Decision: the `Host` rule applies to every path, because a rebinding page that can read the static files can also learn
the proxy paths. The `Origin` and `Sec-Fetch-Site` rules apply to proxy paths only. A link from another site to the printed
address then still opens the page, which holds nothing secret, and no other site can reach a target.

A browser that sends no `Sec-Fetch-Site` header (before Chrome 76, Firefox 90 or Safari 16.4) is covered only for the
requests that carry `Origin`. The documentation names the dependency.

Alternatives considered: a random token in the printed address (it breaks the stable address and the saved profile, and
the rules above already close the browser attacks); refusing every request without `Origin` (it would refuse `curl`
and same-origin GETs the page makes).

## 6. Credentials in memory

Decision: held headers are values in a `Map` inside the process and in each outbound request, and nowhere else. The
startup output lists their names. Every message the command writes is built from fixed text and, at most, the option
name, the port, the target's origin and a Node error code. No message includes a value, a query string or a path.

The relay logs failures to reach a target as one line with the origin and the error code. It logs no request.

Limits the documentation names: command-line arguments are visible in the process list and in the shell history.
Reading a header from the environment or a file would avoid it and is not part of this feature.

## 7. Cookies

Browsers share cookies across ports on `localhost` and `127.0.0.1`, so a session cookie from another local application is
sent to the listener on a `same-origin` request, and a `Set-Cookie` from a target would land in the same jar. Decision: remove
`Cookie` from requests and `Set-Cookie` from responses. A developer who needs a cookie sets it with `--header "Cookie: ..."`,
which the relay sends as a command-line header. The page's own copy of `Cookie` is never forwarded.

## 8. Port, address and opening the browser

Decision: default port 4747, `--port 0` for any free port, no `--host`, no automatic opening of a browser.

Rationale: the page stores the client profile in browser storage, which belongs to the origin. A random port per run would
lose it each time. 4747 is not used by the repository's tests or documentation, and a clash gives a message that names
`--port`. Opening a browser needs a platform specific command for each system and adds code that has no test in CI. The
printed address is enough, and terminals make it clickable.

The listener binds `127.0.0.1`. `localhost` in a browser reaches it, because browsers try IPv4 after IPv6. The `[::1]` form is
not bound and not claimed, as in the constitution's visitor-target rule.

## 9. Targets and proxy paths

Decision: the allowlist is the set of target origins. Target `n` (from 1, in command-line order) has the proxy path
`/proxy/<n>` and its agent has the id `target-<n>`, the name `<target URL>` and the `url` `/proxy/<n><target path>`. A target
URL has no credentials, no query and no fragment.

Rationale: presets, preparation and capability requests use other paths of one server, so the origin is the useful unit
and matches `allowedOrigins` in hosted mode. A credential or a token in the query would be written into `config.json`, so
the command refuses it. A query typed in the page still goes through. Two targets with one origin stay two entries so each keeps its headers.

Alternatives considered: one prefix per origin (two targets with different headers on one origin would clash); a prefix
by target host (a longer path, and a host name in the recorded path adds nothing).

## 10. HTTPS, HTTP versions and certificates

Decision: `https` targets use `https.request` with Node's default certificate checks and no option to skip them. HTTP/1.1
only. A trusted development CA goes through `NODE_EXTRA_CA_CERTS`.

Test: a unit test cannot trust a throwaway certificate inside the same process. The process-level spec generates a
self-signed certificate with `openssl` in a temporary directory, starts an HTTPS target, and runs the command with
`NODE_EXTRA_CA_CERTS` set to it. A second run without it expects a 502 that names the origin and the code
`DEPTH_ZERO_SELF_SIGNED_CERT`. If `openssl` is missing the spec is skipped and says so. No key is committed.

## 11. Tests and the loopback bind

Decision: unit tests run `listen()` in process on port 0 with scripted `node:http` targets, and use a stand-in directory
for the page (the `assetsDir` hook of feature 006) so they run before the build. Playwright specs run the shipped
`lib/cli/main.js` as a child process, which needs `npm run build` first, as the Python specs do.

The bound address is asserted from the server (`127.0.0.1`) and from the child process's printed address. The
"not reachable from another machine" check connects to the machine's first non-loopback IPv4 address and the command's
port and expects a refused connection. It is skipped when the machine has no such address, and the spec records the skip.

A `CONNECT` or `Upgrade` request is sent with a raw socket. The test checks that the target sees no connection.

## 12. Documentation

Decision: a new page, `website/content/docs/cli.mdx`, in the "Set it up" group before "Host the static page". The index,
status, hosted and embedding pages, the troubleshooting page and both READMEs link to it where they list the ways to run
the inspector. The development page lists the new folder. No new root script is added, so its script list does not change.
The status page's data section, which says that the browser sends each run directly to the agent, gets one sentence for
CLI mode.

Prose follows the repository's rule: short plain sentences, no em dashes, no marketing, no bold labels. The humanizer
skill reads the page before the pull request.
