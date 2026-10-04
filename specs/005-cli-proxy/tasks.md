# Tasks: Command line inspector with a local proxy

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[command line contract](contracts/command-line.md), [proxy contract](contracts/proxy.md),
[validation guide](quickstart.md).

**Format**: `- [ ] Txxx [P] [USn] description with file path`. `[P]` means the task touches files no other open task
touches and has no unfinished prerequisite. `[USn]` maps to a user story of the spec. Setup, foundation and polish
tasks carry no story label.

Tests are required (constitution: behavior changes need regression tests). Each test task comes before the code it
covers. Unit tests use a stand-in directory for the page (the `assetsDir` hook of feature 006), so they run before the
build. Browser and process tests run the shipped `packages/inspector/lib/cli/main.js` against
`examples/reference-agent` or a scripted `node:http` target, never a model or an outside service, so they need
`npm run build` first.

Rules for every task: do not edit `ROADMAP.md` or another feature's spec directory, add no dependency (runtime or
development), write no publish, tag or release step, and keep docs in short plain sentences with no em dashes and no bold
labels. Implementation starts only after the orchestrator says feature 006 has merged to `main` and this branch is
rebased on it.

## Phase 1: Setup

- [ ] T001 Read the merged core of feature 006: `packages/inspector/src/server/core.ts`, `node.ts`,
  `packages/inspector/tsconfig.server.json`, the `buildServer()` step of `scripts/build.mjs` and the `assetsDir` hook.
  Check each point of research 2 (the core serves `hosting-config.json`; `config.json` carries only the fields given; how
  `handle` treats methods other than GET and HEAD; the error for missing page files; the asset for `/`). Write any
  difference into `research.md` section 2 and into `plan.md` before writing code. If the core does not answer 405 for
  other methods, `server.ts` (T010) does it with `Allow: GET, HEAD`.
- [ ] T002 Make the package ship the command. In `packages/inspector/package.json` add
  `"bin": { "agui-inspector": "./lib/cli/main.js" }` (leave `exports`, `files` and `dependencies` alone). In
  `packages/inspector/tsconfig.server.json` add `src/cli/**/*` to `include`. The build check for the `bin` target comes with
  `main.ts` in T010, so the build keeps passing until then. Depends on T001.
- [ ] T003 Update the two tests that forbid a `bin`. In `packages/inspector/tests/foundation/policy.test.ts` remove
  `'bin'` from the forbidden list for the published manifest only and assert that
  `json('packages/inspector/package.json').bin` deep-equals `{ 'agui-inspector': './lib/cli/main.js' }`, that every other
  manifest still has no `bin`, and that the published manifest's `dependencies` keys are unchanged from `main` (no new
  runtime dependency; the exact-version test stays). In `packages/inspector/tests/foundation/static-path.test.ts` replace
  the `assert.equal(pkg.bin, undefined)` check with the same `bin` assertion. Depends on T002.

**Checkpoint**: `npm run typecheck` and `npm run test:unit -- packages/inspector/tests/foundation` pass.

## Phase 2: Foundation, the arguments (blocks every story)

- [ ] T004 [P] Write `packages/inspector/tests/cli/args.test.ts` for `parseCli(argv)`. Cover: `--target` repeatable and a
  header attached to the last `--target` before it (`--target A --header "X: a" --target B --header "X: b"`);
  `--header=Name: value` and `--header "Name: value"` give the same result; `--port` default 4747, `0`, `65535`, and the
  refusals `-1`, `65536`, `abc`, `1.5`, empty; `--help` and `--version` (kind `help` and `version`, even with other
  options); the first argument not starting with `-` gives `unknown command "<name>"`; a stray argument later gives
  `unexpected argument; quote a --header value that has spaces` with no echo; unknown option and missing value give the
  `parseArgs` message; `-h`, `-v` and `--host` are unknown (no option sets the listening address). Targets: relative, `ftp:`, no host, `user:pass@`, a query, a fragment each
  fail with the messages of [contracts/command-line.md](contracts/command-line.md); `http://127.0.0.1:8787`,
  `http://[::1]:8787/a`, `https://agent.example/agent` pass; no target fails with `--target is required`. Headers: a
  header before any target; a name that is not an HTTP header token (`!#$%&'*+.^_`|~0-9A-Za-z-`); `Host`,
  `content-length`, `Transfer-Encoding`, `CONNECTION` in any case; an empty value; no colon; a value with a line break;
  a repeated name for one target replaces the earlier value. For every failing input assert that the message does not
  contain a unique synthetic secret placed in the header value, in the target's query or in its password, and that an
  unquoted `--header Authorization: Bearer SECRET` fails without printing `SECRET`.
- [ ] T005 Implement `packages/inspector/src/cli/args.ts` to make T004 pass: `parseCli(argv)`, the `Target` type
  (`n`, `url`, `origin`, `host` without brackets, `port`, `tls`, `path` as `url.pathname`, `headers` keyed by lowercase
  name), the `Cli` result (`help`, `version`, `serve` with `port` and `targets`, `error` with `message`) and the `USAGE`
  text of the command line contract. Use `parseArgs` with `strict: true`, `allowPositionals: true`, `tokens: true`, and
  `target`, `header`, `port` as strings (`target` and `header` with `multiple: true`) and `help`, `version` as booleans.
  Order of checks as in the data model: `parseArgs` errors, first-argument command name, stray arguments, `--help` and
  `--version`, `--port`, a header before any target, each target with its headers, at least one target. Header value check
  with `http.validateHeaderValue`; trim the value. Messages are fixed text from the contract, never built from a value.
  Under 120 lines, no dependency. Depends on T004.

**Checkpoint**: `npm run test:unit -- packages/inspector/tests/cli/args.test.ts` passes.

## Phase 3: User Story 1, inspect any AG-UI server with one command (Priority: P1) MVP

**Goal**: `agui-inspector --target <url>` serves the page on `127.0.0.1` and relays the page's runs to the target.

**Independent test**: the shipped command against the reference agent in Chromium: the agent is listed, a run is
recorded, and every request the page made went to its own origin.

- [ ] T006 [P] [US1] Write the first part of `packages/inspector/tests/cli/proxy.test.ts` with a scripted `node:http`
  target on port 0 that records method, path, headers and body. Cover `relay(request, response, target, path)`: the method,
  path and query reach the target as given (`/agent?x=1&y=%20`); a POST body is delivered unchanged; the status, status
  message and headers come back; `Host` is the target's own authority; the page's `Connection`, `Keep-Alive`, `TE`,
  `Upgrade`, `Proxy-Authorization` headers and any name `Connection` lists do not reach the target; the response's
  `Transfer-Encoding` and `Connection` are Node's own for the page's hop. Drive `relay` through a small in-test
  `http.createServer` that calls it with `target` built by hand.
- [ ] T007 [US1] Implement `packages/inspector/src/cli/proxy.ts`: `relay(request, response, target, path)` as written in
  the Design section of [plan.md](plan.md) and [contracts/proxy.md](contracts/proxy.md): `http.request` or
  `https.request` with `{ host, port, path, method, headers, agent: false }`, hop-by-hop and `Host`, `Cookie`, `Origin`,
  `Referer` removed from the outbound headers, `setNoDelay(true)` on the outbound request, `stream.pipeline` for the
  request body, and for the response `writeHead(statusCode, statusMessage, rawHeadersWithoutHopByHopAndSetCookie)`,
  `flushHeaders()`, then `pipeline`. Error and abort handling and held headers come in T014 and T023. Depends on T005,
  T006.
- [ ] T008 [P] [US1] Write `packages/inspector/tests/cli/server.test.ts`, first part, with a temporary directory as the
  page (`index.html`, `hosting-config.json` with `{"version":0,"mode":"embedded","allowedOrigins":[]}`, `app.js`) passed as
  `assetsDir`, and `listen({ port: 0, targets, assetsDir })`. Cover: the server's bound address is `127.0.0.1` and the
  returned port is the bound one; `GET /` is the page, `GET /app.js` the file, `GET /hosting-config.json` unchanged;
  `GET /config.json` parses to `{ version: 0, agents: [{ id: 'target-1', url: '/proxy/1/agent', name:
  'http://127.0.0.1:<port>/agent' }] }` in that key order, with `url` `/proxy/1/` for a target without a path, and no other
  field; every one of these responses has `Content-Security-Policy: script-src 'self'; object-src 'none'; base-uri
  'none'`; `HEAD` has the headers and no body; `POST /` is 405 with `Allow: GET, HEAD`; `/nope` is 404; `/%` (bad
  escape) is 404; `GET /proxy/1/agent?x=1` and `POST /proxy/1/agent` reach the scripted target with the same path, query
  and body; `/proxy/1` reaches the target as `/`. Send requests with `Host`, `Origin` and `Sec-Fetch-Site` that a browser
  sends for the same origin (the guards come in T020).
- [ ] T009 [US1] Implement `packages/inspector/src/cli/server.ts`: `listen({ port, targets, assetsDir? })` returns
  `{ port, close() }`. Create the handler once with `createInspectorHandler({ agents, assetsDir })` where each agent is
  `{ id: 'target-<n>', name: <target href>, url: '/proxy/<n>' + target.path }`; create the `node:http` server; for a
  request whose path starts with `/proxy/` take the number segment (plain digits, 1 to the number of targets, otherwise
  403 with a plain text body) and call `relay` with the text after the segment (`/` when empty) plus the query, exactly
  as received; otherwise answer from the core with `sendResponse(await handle(toRequest(request), asset), response)`,
  where the asset is the path without its first `/`, with `/` as `index.html`, decoded once (a failed decode is 404).
  Add the 405 for other methods only if T001 found the core does not. Bind with `server.listen(port, '127.0.0.1')`,
  never another address. `close()` ends the listener and calls `closeAllConnections()`. Depends on T007, T008.
- [ ] T010 [US1] Implement `packages/inspector/src/cli/run.ts` and `packages/inspector/src/cli/main.ts`.
  `run(argv, io)` with `io = { out(text), err(text), stop: AbortSignal }` returns the exit code: parse; for `help` and
  `version` print and return 0 (version from `package.json` read next to `lib/cli` or `src/cli`, two levels up); for
  `error` print the message and `Run agui-inspector --help for the options.` to `err` and return 2; for `serve` call
  `listen`, print the startup lines of the command line contract (address, then one line per target with header names
  only), wait for `stop` to abort, close, return 0. `main.ts` starts with `#!/usr/bin/env node`, creates an
  `AbortController` wired to `SIGINT` and `SIGTERM`, calls `run(process.argv.slice(2), ...)` and sets `process.exitCode`.
  Nothing else in `main.ts`. In `scripts/build.mjs` make `buildServer()` also throw when the `bin` target of
  `packages/inspector/package.json` does not exist in `lib`. Exit codes 1 and the self-target check come in T029.
  Depends on T009.
- [ ] T011 [P] [US1] Write `tests/e2e/cli/support.ts`: `startCommand(args, env?)` spawns
  `node packages/inspector/lib/cli/main.js` with `stdio: pipe`, waits for the line starting with
  `agui-inspector listening on `, returns `{ origin, port, stdout(), stderr(), stop() }` and kills the child on `stop`;
  `startTarget(options)` starts a scripted `node:http` target on `127.0.0.1` that records every request (method, path,
  headers, body) and answers `POST /agent` with `referenceRunResponse` from `examples/reference-agent/scenarios.ts`, and
  can instead write a given list of `{ bytes, delayMs }` chunks; it sends no CORS header. Fail fast with a message that
  names `npm run build` when `lib/cli/main.js` does not exist. Self-contained, like `tests/e2e/hosted/support.ts`.
- [ ] T012 [US1] Write `tests/e2e/cli/browser.spec.ts`, first test. Start the target and the command (`--port 0`), open
  the printed address in Chromium, and check: the agent list shows `http://127.0.0.1:<target port>/agent`; sending a
  message shows the reply "Hello from the reference agent." and one exchange with its frames and no finding; the target saw
  exactly one `POST /agent`; `config.json` fetched by the page has the agent's `url` `/proxy/1/agent` and no target
  origin; every request the page made (`page.on('request')`) has the command's origin, none the target's. Reuse
  `send` and `expectAllowlisted` from `tests/e2e/hosted/support.ts` if they fit, otherwise write the few lines here.
  Depends on T010, T011.

**Checkpoint**: `npm run build && npm run test:unit -- packages/inspector/tests/cli && npm run test:e2e -- tests/e2e/cli
--workers=2` passes for the tests so far. The quickstart's step 4 works by hand.

## Phase 4: User Story 2, the recorded frames are the bytes the target sent (Priority: P1)

**Goal**: the relay keeps bytes, order, chunk timing and failure shape.

**Independent test**: scripted targets with split frames, invalid bytes, pauses, cuts and aborts, read through the relay by
a plain client and by the page.

- [ ] T013 [P] [US2] Extend `packages/inspector/tests/cli/proxy.test.ts` with the fidelity cases, each against a
  scripted target and a plain `http.get` client that records the arrival time of every `data` event: ten chunks written
  100 ms apart, where chunk 3 is the bytes `ff fe 0a` and chunk 5 splits one SSE event across two chunks, arrive as ten
  chunks in order with equal bytes and each (but the last) before the target writes the next; a non-JSON `data:` frame; a
  1 MB request body and a 5 MB response body arrive equal (compare a hash); a gzip response keeps its bytes and its
  `Content-Encoding` header (the client does not decode); a 302 with `Location` arrives with the same status and
  `Location` and the relay makes no second request; a 500 with a body, a 204 with no body and a HEAD answer arrive as
  sent; the target's repeated headers (`X-Multi` twice) keep order and case; the target's `Set-Cookie` does not arrive; a
  target that writes one chunk then destroys its socket makes the client's response end with an error and `complete`
  false (never a clean end); a client that destroys its request while the target holds the response makes the target's
  response emit `close` within 1 s; a target that destroys the connection before it writes any header gives 502 with `ECONNRESET`; a refused connection
  (`127.0.0.1` with a closed port) gives 502 with the body
  `agui-inspector could not reach http://127.0.0.1:<port> (ECONNREFUSED)` and the same text on standard error through
  an injected logger; an unknown name (`http://nohost.invalid`) gives 502 with `ENOTFOUND` or `EAI_AGAIN`; the 502 body
  and the log line contain no path, query or header (use a synthetic query and header value and search both).
- [ ] T014 [US2] Complete `packages/inspector/src/cli/proxy.ts` to make T013 pass: the error path before the response
  (502 with the one-line body and the log line via an injected `log` function that `server.ts` sets to `io.err`), the
  error path after the headers (destroy the page's socket), `response.on('close')` with `writableFinished` false
  destroying the outbound request, and an `error` listener on the outbound request that never throws. Depends on T013.
- [ ] T015 [US2] Add to `tests/e2e/cli/browser.spec.ts`: a scripted target writes a stream of chunks with pauses
  (a frame split across two chunks, a non-JSON frame, invalid UTF-8) and the page records it through the command. Read
  the recorded frames the way `tests/e2e/inspection/support.ts` (`snapshot`) does and compare their raw text with the
  bytes the target wrote, in order, and the findings with the findings the same scripted stream gives against a direct
  hosted page (reuse the hosted `openSite` pattern, or compare to the findings the spec fixtures name). A second test:
  the target holds a run open, the test clicks Stop, and the target's request emits `close` within 2 s. A third: the
  target cuts the stream mid-frame and the page shows a transport error with the bytes that arrived. Depends on T014.

**Checkpoint**: the proxy tests and the browser tests for stories 1 and 2 pass.

## Phase 5: User Story 3, only the named targets can be reached (Priority: P1)

**Goal**: no request spelling reaches a host other than a configured target.

**Independent test**: raw sockets and a plain client against one target, with a counting second server that must see
nothing.

- [ ] T016 [P] [US3] Extend `packages/inspector/tests/cli/server.test.ts` with the refusal set. Start the command's server
  with one target and a second `node:http` server (the "other host") that counts connections. With raw `net` sockets and
  `http.request`, send: `GET /proxy/2/x`, `GET /proxy/0/x`, `GET /proxy/01/x`, `GET /proxy/+1/x`, `GET /proxy/%31/x`,
  `GET /proxy/1x/x`, `GET /proxy//x`, `GET /proxy/-1/x` (403 each); `GET http://<other host:port>/ HTTP/1.1`,
  `OPTIONS * HTTP/1.1` and an authority-form line (403, or the socket closed); a `CONNECT <other host:port> HTTP/1.1`
  and a request with `Connection: Upgrade` and `Upgrade: websocket` (403 each, and neither the target nor the other host
  sees a connection); and, below the allowed proxy path, `//<other host:port>/x`, `/@<other host:port>`, `/\\<other host>`,
  `/..%2f..%2f`, `/%2e%2e/`, `/a/../../b`, `/x%00y` and `/x y` (encoded). For these, assert the scripted target (not the
  other host) received the exact raw path or the request was answered 400, and the other host's counter stayed 0. After
  every case assert the other host's connection count is 0.
- [ ] T017 [US3] Make T016 pass in `packages/inspector/src/cli/server.ts`: refuse a request target that does not start
  with `/` with 403 before anything else; keep the number rule from T009 strict (`/^[1-9][0-9]*$/` on the raw segment, at
  most the number of targets); register `connect` and `upgrade` listeners on the server that write `HTTP/1.1 403 Forbidden`
  with `Connection: close` and end the socket (current Node.js serves an unlistened upgrade request as an ordinary
  request, see research 5); return 400 when `http.request` rejects the path (`ERR_UNESCAPED_CHARACTERS`) instead of throwing. The relay's `path` stays the raw
  text after the proxy number. Depends on T016.
- [ ] T018 [US3] Add to `tests/e2e/cli/browser.spec.ts`: with the command running, type the target's real address
  (`http://127.0.0.1:<target port>/agent`) into the endpoint field and use it. The page refuses before any request, shows a
  message that names the command's origin as the destination it may reach, and the target saw no request. Typing
  `/proxy/1/agent` works. Depends on T012.

**Checkpoint**: SC-005 holds for the whole refusal set.

## Phase 6: User Story 4, the listener stays on this machine and answers only this browser (Priority: P1)

**Goal**: loopback only, and no other site in the browser can use the relay.

**Independent test**: read the bound address, connect to another address, send foreign `Host`, `Origin` and
`Sec-Fetch-Site`.

- [ ] T019 [P] [US4] Extend `packages/inspector/tests/cli/server.test.ts` with the guard cases against a counting target:
  `Host` of `127.0.0.1:<port>` and `localhost:<port>` (any case) pass; `127.0.0.1` without a port, `127.0.0.1:1`,
  `evil.example`, `evil.example:<port>`, `localhost.evil.example:<port>` and a missing `Host` get 403 on `/`, `/config.json`
  and a proxy path; on a proxy path `Origin: http://evil.example`, `Origin: null`, `Origin: http://127.0.0.1:<other port>`
  get 403 and the target sees nothing, while the two own origins pass; `Sec-Fetch-Site: cross-site` and `same-site` get
  403 on a proxy path, `same-origin` and `none` pass; a request with none of these headers (like `curl`) passes; on `/` and
  `/config.json` a cross-site `Sec-Fetch-Site` or foreign `Origin` is served (a link from another site opens the page);
  the bound address from `server.address()` is `127.0.0.1` and the family IPv4, and no second listener exists.
- [ ] T020 [US4] Add the guards to `packages/inspector/src/cli/server.ts` in the order of the Design section: after the
  absolute-path check, refuse a `Host` that is not `127.0.0.1:<port>` or `localhost:<port>` (compare lowercase, with the
  port read from `server.address()` per request); for proxy paths only, refuse an `Origin` that is present and not
  `http://127.0.0.1:<port>` or `http://localhost:<port>`, and a `Sec-Fetch-Site` that is present and neither `same-origin`
  nor `none`. Refusals are 403 with a plain text body of one fixed line and no outbound connection. Depends on T017, T019.
- [ ] T021 [US4] Write `tests/e2e/cli/command.spec.ts`, first tests, with the shipped command: the printed address is
  `http://127.0.0.1:<port>/`; a connection to the machine's first non-loopback IPv4 address (from `os.networkInterfaces()`)
  on that port is refused (`ECONNREFUSED`), and the test is skipped with a visible reason when there is none; a request
  to `http://localhost:<port>/config.json` is served; a request with `Host: other.example` is 403. Depends on T011, T020.

**Checkpoint**: SC-005 and SC-006 hold.

## Phase 7: User Story 5, command-line headers stay in the proxy's memory (Priority: P1)

**Goal**: held headers reach their target and nothing else.

**Independent test**: a unique synthetic header value is searched for in every output, served file and export.

- [ ] T022 [P] [US5] Extend `packages/inspector/tests/cli/proxy.test.ts` with the header cases: a held header is sent on
  every request to its target (GET and POST); when the page's request carries the same name in another case, the target
  receives the page's value and not the held one; the page's `Cookie` is not forwarded and the target's `Set-Cookie` does
  not reach the page; `Origin` and `Referer` are not forwarded; a held `Cookie: a=b` header is sent; held header names keep
  their written case on the wire (compare the raw header line from a raw socket target); a held header is not sent to a
  second target of another `relay` call with other held headers.
- [ ] T023 [US5] Make T022 pass in `packages/inspector/src/cli/proxy.ts`: after the outbound headers are built, add each
  held header of the target whose lowercase name the page's request did not carry. Depends on T022.
- [ ] T024 [US5] Add to `tests/e2e/cli/command.spec.ts` the secret search: start the command with
  `--header "X-Synthetic: <random uuid>"`. Fetch `/`, `/config.json`, `/hosting-config.json`, `app.js`, `app.css`
  (and every file in `packages/inspector/dist`) and a refused request (403) and a 404, and assert none contains the value.
  Assert the standard output (startup lines name `X-Synthetic`, not the value) and standard error are free of it on a normal
  run, after a 502 (target down), after a refused request, and for each usage error of T004 run as a separate process with
  the value in the offending option. A target that records headers confirms it received the value on every request.
- [ ] T025 [US5] Add to `tests/e2e/cli/browser.spec.ts`: with `--header "X-Synthetic: <uuid>"`, run through the page,
  export the session (`Export session`, as `tests/e2e/inspection/session.spec.ts` does) and assert the file does not
  contain the value; the target received it. Then enter a token with the same header name in the page and assert the target
  received the page's token. Add a cookie for `127.0.0.1` to the browser context first and assert the target received no
  `Cookie` header and that a `Set-Cookie` the target sends leaves no cookie for the target in the context. Depends on T012,
  T023.

**Checkpoint**: SC-007 holds.

## Phase 8: User Story 6, several targets, each with its own headers (Priority: P2)

**Goal**: two targets in the picker, each with its own headers and nothing crossed.

**Independent test**: two scripted targets with different headers, one run to each.

- [ ] T026 [P] [US6] Extend `packages/inspector/tests/cli/server.test.ts`: two targets on different origins with
  `--header` pairs built through `parseCli`; `config.json` lists `target-1` and `target-2` in order with `/proxy/1/...` and
  `/proxy/2/...`; a run to each reaches its own target; A receives only A's header and B only B's, with the same header
  name and different values; two targets with the same origin and different headers get separate proxy paths and their own
  headers.
- [ ] T027 [US6] Add to `tests/e2e/cli/browser.spec.ts`: two targets in the agent picker in the order given, a run to each
  records on its own target, and each target saw only its own header value. Depends on T012, T026.

**Checkpoint**: story 6 passes. No source change is expected, since T005 and T009 build for many targets.

## Phase 9: User Story 7, a clear command line that leaves room to grow (Priority: P2)

**Goal**: help, version, exit codes and streams as written in the contract.

**Independent test**: run `run()` in process and the shipped command as a process.

- [ ] T028 [P] [US7] Add `run()` tests to `packages/inspector/tests/cli/server.test.ts` with injected `out`, `err` and a
  `stop` signal: `--help` prints the usage to `out` and returns 0 and listens on nothing; `--version` prints the version
  from `package.json`; a usage error prints one message and the pointer to `err` and returns 2 and listens on nothing;
  `unknown command "replay"` returns 2; the port already taken (listen first on a port, then run with it) returns 1 with
  `port <n> is already in use; choose another with --port`; a missing page directory (`assetsDir` that does not exist)
  returns 1 with the core's message; a target on `127.0.0.1` with the command's own port returns 2 with
  `--target points at this command's own address`, after the listener closed; a normal run prints the address line to `out`,
  keeps running until `stop` aborts, then returns 0 and has closed a relay that was still open.
- [ ] T029 [US7] Finish `packages/inspector/src/cli/run.ts` to make T028 pass: exit code 1 for listen errors (message for
  `EADDRINUSE`, otherwise the error message) and for the core's missing-files error, exit code 2 for the self-target check
  made after the bind (`host` is `127.0.0.1`, `localhost` or `[::1]` and the port equals the bound port), close the
  listener first. Print failures to reach a target to `err` through the logger passed to `listen`. Depends on T028.
- [ ] T030 [US7] Add to `tests/e2e/cli/command.spec.ts`: the shipped command's `--help` (exit 0, usage on stdout, nothing
  on stderr), `--version` equals `packages/inspector/package.json` version, no arguments (exit 2, stderr names `--target`),
  `replay` (exit 2, `unknown command "replay"`), `--port 99999` (exit 2), a port in use (exit 1, names the port), `SIGTERM`
  while a relay is in progress (exit 0 and the in-flight request ends), and an HTTPS target: make a self-signed certificate
  for `127.0.0.1` with `openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=127.0.0.1 -addext
  subjectAltName=IP:127.0.0.1` into a temporary directory, start an `https` scripted target with it, and check that a
  request through the command (child started with `NODE_EXTRA_CA_CERTS` set to the certificate) relays, and that a child
  started without it gets a 502 whose body names the origin and the certificate error code. Skip the HTTPS test with a
  visible reason when `openssl` is missing. Depends on T011, T029.

**Checkpoint**: every story passes.

## Phase 10: Docs and polish

- [ ] T031 [P] Write `website/content/docs/cli.mdx` (title `Run it locally with the CLI`, description of one sentence).
  Cover: when to use it (a server that does not allow the page's origin, any language), the one command and its output,
  every option with an example (`--target`, `--header` and how it binds to the target before it, `--port`, `--help`,
  `--version`), what the page lists and the proxy paths (`/proxy/<n>`), typing an endpoint in the page, what the proxy
  relays and removes (cookies, hop-by-hop headers) and what it keeps (bytes, redirects, compression), the guards in two
  short paragraphs (loopback, Host and cross-site refusals), the limits (HTTP/1.1, IPv4 loopback only, no WebSocket,
  certificates and `NODE_EXTRA_CA_CERTS`, arguments visible in the process list and shell history, other programs of the
  same user, browsers without `Sec-Fetch-Site`), Node.js 22.12 or newer, and troubleshooting (403, 502, port in use,
  `replay` not available yet). Short plain sentences, no em dashes, no bold labels.
- [ ] T032 [P] Update the pages that list the ways to run the inspector. In `website/content/docs/meta.json` add `cli`
  to "Set it up" before `hosted`. In `website/content/docs/index.mdx` add a Cards entry and a row to the modes table. In
  `website/content/docs/status.mdx` change the CLI row of the mode table, and add one sentence to "Where your data goes"
  that in CLI mode the browser's run goes through the local proxy to the target, unchanged. In
  `website/content/docs/hosted.mdx` and `embedding.mdx` add one pointer each. In
  `website/content/docs/troubleshooting.mdx` add the three CLI cases with a link to the page. In
  `website/content/docs/development.mdx` add `packages/inspector/src/cli` to "Where things are", and the unit and
  browser test commands for it. No root script is added, so the script table stays as it is. Keep the pages' existing
  claims true: search them for "no proxy" and "directly" and fix each.
- [ ] T033 [P] Update `README.md` and `packages/inspector/README.md`: add the command to the list of ways to run it with a
  link to the new page, and remove any statement that the package has no command.
- [ ] T034 [P] Add `.changeset/add-cli-proxy.md` with `'agui-inspector': minor` and a short plain summary (no Python
  package entry). Run `npm run test:unit -- tests/release` to check the changeset test.
- [ ] T035 [P] Extend the bundle test of feature 006 (`packages/inspector/tests/server/bundle.test.ts`) so that no input of
  the page bundle lies under `packages/inspector/src/cli` and the output has no `unknown command` or `listening on` text
  from the command. Add `packages/inspector/tests/cli/outbound.test.ts`, a source scan for FR-016: no file under
  `packages/inspector/src/cli` mentions `fetch(`, `XMLHttpRequest`, `node:dns`, `node:child_process`, a `net.connect`, a file
  write (`writeFile`, `appendFile`, `createWriteStream`) or an update check, and `http.request` and `https.request` appear
  only in `proxy.ts`. Depends on T010.
- [ ] T036 Run `npm run typecheck`, `npm run test:unit` and the full gate `npm run check:ci`. Fix what fails. Build the docs
  site to check that the new page renders (`cd website && npm ci --ignore-scripts && npm run build`; if it cannot install in
  this environment, say so in the PR). Run the quickstart's step 4 by hand and write the result (what was seen, the commands) at the end of `quickstart.md` under
  "Result of the run".
- [ ] T037 Run `/speckit-converge` if the code and the spec disagree anywhere. Run `/ponytail:ponytail-review` on the
  diff and fix what it finds. Run the humanizer skill on the new docs text and on the PR body.

## Dependencies and order

- Setup (T001 to T003) before everything. T001 waits for feature 006 on `main`.
- Foundation (T004, T005) before every story.
- Story 1 (T006 to T012) is the MVP. Stories 2 to 5 build on `proxy.ts` and `server.ts` from story 1, and each edits those
  files after the previous story's tasks, so run them in order: 2 (T013 to T015), 3 (T016 to T018), 4 (T019 to T021), 5
  (T022 to T025). Story 6 (T026, T027) and story 7 (T028 to T030) need only story 1 and can run in either order after it.
- Polish (T031 to T037) after the stories. T031 to T034 can start once story 1 works, since the docs follow the contracts.

## Parallel opportunities

- T004 with T006 and T008 (three different test files).
- T011 (e2e support) with T006 to T010.
- T013, T016, T019, T022, T026, T028 are test tasks on different parts of two files, so write them in one sitting but
  keep each file's edits in order.
- T031 to T034 touch different files.

## Implementation strategy

- MVP: T001 to T012. After it, the command works for one target in a browser. Everything after hardens or widens it.
- Stories 2 to 5 are the safety properties. They ship together with story 1: the command is not releasable without them.
- Stories 6 and 7 are small, and no story needs a source change beyond what T005, T009 and T010 already do for many
  targets.
- Each test is written first. A test that already passes because an earlier task built the behavior stays as a regression
  test.

## Format check

Every task starts with `- [ ]`, an ID from T001 to T037, `[P]` where it is parallel, `[USn]` for story tasks only, and
names its files.
