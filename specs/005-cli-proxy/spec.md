# Feature Specification: Command line inspector with a local proxy

**Feature Branch**: `gh-75-cli-proxy`

**Created**: 2026-10-04

**Status**: Draft for review.

**Input**: Issue [#75](https://github.com/dogganidhal/agui-inspector/issues/75), item 3 of the 0.2.0 roadmap. Hosted
mode needs the target to allow the page's origin (CORS). Embedded mode needs a helper for the server's language. A local
command removes both requirements for any AG-UI server: `npx agui-inspector --target <url>` serves the inspector on this
machine and relays the page's requests to the target. Headers for the target can be set on the command line. Replay and
the conformance suite become subcommands in the next minor, so the command layout leaves room for them, but this feature
builds none. The command reuses the shared serving behavior of feature
[006](../006-js-server-helpers/spec.md) (issue [#76](https://github.com/dogganidhal/agui-inspector/issues/76)).

## Clarifications

No maintainer was available, so the spec author answered each question from the issue, the 0.2.0 roadmap, the
constitution and the code, and took the recommended option.

### Session 2026-10-04

- Q: With several targets, does a `--header` apply to every target or only to the target before it? → A: Only to the
  target before it. A token for one server must never reach another, and the position rule needs no extra option. A
  header before any target is a usage error (FR-005, story 6).
- Q: When the command line and the page both set a header with the same name, which value does the target receive? → A:
  The page's. A developer who types a wrong token in the page wants to see the server's answer to it, and the command
  line only sets the default (FR-011, story 5).
- Q: Does the allowlist hold the origin of each target or only its exact path? → A: The origin. Presets,
  preparation requests and capability requests use other paths of the same server, and a hosted deployment's
  `allowedOrigins` is a list of origins too. Each target keeps its own proxy path and its own headers (edge cases,
  FR-009).
- Q: What happens to cookies, given that the page is embedded and browsers share `localhost` cookies across ports? → A:
  The command removes `Cookie` from requests and `Set-Cookie` from responses. Cookies of other local applications must
  not reach the target, and a cookie of the target must not land in the shared `localhost` jar. A developer who needs a
  cookie sets it with `--header` (FR-011, story 5).
- Q: Which exit codes and output streams does the command use? → A: Exit code 0 for a normal stop, `--help` and
  `--version`. Exit code 2 when the arguments are wrong, the self-targeting check included. Exit code 1 for any other
  failure, such as a port in use or missing page files. The startup line and `--help` go to standard output. Errors and
  the failure log go to standard error (FR-006, FR-017, FR-019, story 7).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect any AG-UI server with one command (Priority: P1)

A developer has an AG-UI server on their machine, in any language, that does not allow a browser page from another
origin. They run `npx agui-inspector --target http://127.0.0.1:8787/agent`. The command prints an address. They open it
in a browser and see the target listed as an agent. They send a run and inspect the request, the frames and the findings.
They changed nothing on the server, installed no helper and set up no CORS.

**Why this priority**: This is the point of the feature. It is the smallest slice that proves the command, the served
page and the relay work together.

**Independent Test**: Start the scripted reference agent without any CORS option. Start the command with its address as
the target. Open the printed address in a real browser, check that the agent is listed, send a run and check the
recorded exchange and frames. Fetch the page files and `config.json` with a plain HTTP client and check the headers.

**Acceptance Scenarios**:

1. **Given** a target that sends no CORS headers, **When** the developer starts the command with `--target` and opens
   the printed address, **Then** the inspector loads and lists one agent that names the target.
2. **Given** the page is open, **When** the developer sends a message, **Then** the run reaches the target, the reply is
   shown in the conversation, and the Inspection view shows one exchange with its frames and no findings.
3. **Given** the page is open, **When** the developer reads the requests the page made, **Then** every one went to the
   page's own origin: the files, `config.json` and the run. None went to the target's address.
4. **Given** `config.json` is requested, **When** it is read, **Then** it is the version 0 file with one agent whose
   `url` is a path on the page's own origin, not the target's address.

---

### User Story 2 - The recorded frames are the bytes the target sent (Priority: P1)

A developer debugs a server whose stream is odd: a frame split across chunks, a non-JSON frame, an invalid UTF-8
sequence, a pause of a few seconds between frames, or a stream that ends without a terminal event. They need the
inspector to show what the server sent, not what a proxy made of it.

**Why this priority**: The constitution puts the wire first. A proxy that buffers, re-chunks, decodes or repairs would
make the inspector's evidence wrong in exactly the cases it exists for.

**Independent Test**: Put a scripted target behind the command that writes chosen chunks with known pauses, including
split frames and invalid bytes. Read the relayed stream with a plain client and with the page. Compare the bytes, the
chunk order and the arrival times with what the target wrote.

**Acceptance Scenarios**:

1. **Given** a target that writes a stream as chunks 100 ms or more apart, **When** a client reads it through the
   command, **Then** it receives the same bytes in the same order, and each chunk arrives before the target writes the
   next one. Nothing waits for the end of the response.
2. **Given** a target that splits one event across two chunks, sends a frame that is not JSON and sends bytes that are
   not valid UTF-8, **When** the page records the run, **Then** the recorded frames are those bytes, with the same
   findings the page reports for a direct request to the same server.
3. **Given** a target that closes the connection in the middle of a stream, **When** the page reads it through the
   command, **Then** the page sees a stream that was cut, with the bytes that arrived before the cut. It never sees a
   stream that completed.
4. **Given** a target that answers with an error status and a body, a redirect, or a response with no body, **When** the
   page requests it through the command, **Then** the status, the headers that matter and the body reach the page as
   they were sent. A redirect is passed on and is not followed.
5. **Given** a run in progress, **When** the developer stops it in the page, **Then** the command closes its connection
   to the target, and the target sees the connection end.

---

### User Story 3 - Only the named targets can be reached (Priority: P1)

A developer starts the command with one target. Nothing else on the network is reachable through it, by any spelling of
a request: another host, another port, an absolute URL as the request target, a scheme-relative path, or a path with
`@`, `\` or encoded characters.

**Why this priority**: A relay that can be pointed at any host is an open proxy on the developer's machine. The
allowlist is the safety property of the feature.

**Independent Test**: Start the command with one target. Send requests with raw sockets and a plain client that try
every spelling in the edge cases below. For each, check the answer and check that no connection reached any host other
than the target.

**Acceptance Scenarios**:

1. **Given** one configured target, **When** a request uses a proxy path with a number that names no target, **Then** it
   is refused with a 403 and no outbound connection is made.
2. **Given** one configured target, **When** a request path below the target's proxy path contains `//other.example/x`,
   `@other.example`, `\`, encoded slashes or `..`, **Then** the outbound connection still goes to the target's host and
   port, and the odd text is only a path on that host.
3. **Given** one configured target, **When** a client sends an absolute-form request target such as
   `GET http://other.example/ HTTP/1.1`, a `CONNECT`, or an upgrade request, **Then** it is refused and no outbound
   connection is made.
4. **Given** the command is running, **When** the page is asked to reach the target's real address directly (typed in
   the endpoint field), **Then** the page refuses, as in every embedded page, and names the address it may reach.

---

### User Story 4 - The listener stays on this machine and answers only this browser (Priority: P1)

A developer runs the command on a laptop on a shared network and has a browser open on other sites. Nothing on the
network can reach the listener, and no other website in their browser can use it to reach the target with the
developer's credentials.

**Why this priority**: The relay can attach credentials. A listener that another machine, or another site in the same
browser, can use would hand those credentials to anyone.

**Independent Test**: Start the command and read its bound address. Connect to the machine's other network addresses
and expect refusal. Send requests with a foreign `Host`, a foreign `Origin` and a cross-site `Sec-Fetch-Site`, and
expect a 403 with no outbound connection.

**Acceptance Scenarios**:

1. **Given** the command is running, **When** its bound address is read, **Then** it is the IPv4 loopback address and
   the chosen port, and there is no other listener.
2. **Given** the machine has a non-loopback network address, **When** a client connects to that address and the
   command's port, **Then** the connection is refused.
3. **Given** a request to any path whose `Host` is not `127.0.0.1` or `localhost` with the command's port, **When** it
   arrives, **Then** it is refused with a 403. That stops a page that rebinds a host name to the loopback address.
4. **Given** a request to a proxy path that carries an `Origin` other than the page's own, or a `Sec-Fetch-Site` other
   than `same-origin` or `none`, **When** it arrives, **Then** it is refused with a 403 and nothing reaches the target.
5. **Given** a request with none of those headers, such as one from `curl`, **When** it arrives with a correct `Host`,
   **Then** it is served. The command guards against browsers and the network, not against other programs of the same
   user.

---

### User Story 5 - Command-line headers stay in the proxy's memory (Priority: P1)

A developer's target needs `Authorization: Bearer <token>`. They pass it with `--header`. The token reaches the target
on every request, and nowhere else.

**Why this priority**: The constitution forbids credentials in configuration, storage, recordings, views, logs and
exports. The command is the one component that holds a credential before the page starts, so it must keep that promise
on its own.

**Independent Test**: Start the command with a header whose value is a unique synthetic string. Run the page, record a
run and export the session. Search every served file, the `config.json`, the command's output (on a normal start and on
each error), the exported session and the recorded frames for the string. Check that the target received it.

**Acceptance Scenarios**:

1. **Given** `--target <url> --header "Authorization: Bearer <secret>"`, **When** the page sends a run, **Then** the
   target receives the header with that value.
2. **Given** the same command, **When** `config.json`, the page's files, the command's output and the exported session
   are searched, **Then** the secret is in none of them. The startup output may name the header, never its value.
3. **Given** the same command, **When** the target is unreachable, the arguments are wrong, or a request is refused,
   **Then** the messages name the option or the origin and never echo a header value or a target's query.
4. **Given** the header is set on the command line and the developer types a token with the same header name in the
   page, **When** the page sends a run, **Then** the target receives the token typed in the page. The developer can
   still test a wrong token.
5. **Given** the browser holds cookies for `localhost` or `127.0.0.1` from other local applications, **When** the page
   sends a run, **Then** no cookie reaches the target, and no cookie the target sets reaches the browser.

---

### User Story 6 - Several targets, each with its own headers (Priority: P2)

A developer works on two agent servers and wants both in the agent picker. They give `--target` twice. A header belongs
to the target before it, so a token for one server is never sent to the other.

**Why this priority**: The configuration format and the picker already support several agents, and an allowlist has
more than one entry. The cost is small. It is not needed for the first working command.

**Independent Test**: Start the command with two targets on different origins and different headers. Send a run to each
and check which headers each target received.

**Acceptance Scenarios**:

1. **Given** two targets, **When** the page opens, **Then** both are listed, in the order given, and each run goes to
   its own target.
2. **Given** `--target A --header "X-Key: a" --target B --header "X-Key: b"`, **When** a run goes to each, **Then** A
   receives only `a` and B receives only `b`.
3. **Given** a `--header` before any `--target`, **When** the command starts, **Then** it stops with a usage error that
   says a header follows the target it belongs to.

---

### User Story 7 - A clear command line that leaves room to grow (Priority: P2)

A developer runs `agui-inspector --help` and learns every option. A later release adds `replay` and `test` as
subcommands. Today's invocation keeps working then, and a mistyped subcommand fails clearly now.

**Why this priority**: Replay and the conformance suite are planned for the next minor. The layout is cheap to settle
now and costly to change after adopters script it.

**Independent Test**: Run the command with `--help`, `--version`, no target, a bad option value, and a first argument
that is not an option. Check output and exit codes.

**Acceptance Scenarios**:

1. **Given** `--help`, **When** it runs, **Then** it prints the usage and every option and exits with 0, with no
   listener started.
2. **Given** `--version`, **When** it runs, **Then** it prints the package version and exits with 0.
3. **Given** no `--target`, an invalid target or header, an unknown option, or an invalid port, **When** it runs,
   **Then** it prints one message to standard error that names the option and the problem, adds a pointer to `--help`,
   starts no listener and exits with code 2.
4. **Given** a first argument that does not start with `-`, **When** it runs, **Then** it stops with
   `unknown command "<name>"` and code 2. No command exists yet, and the name space is kept for later ones.
5. **Given** the port is already in use, **When** it starts, **Then** it stops with a message that names the port and
   code 1, and does not pick another port by itself.

---

### Edge Cases

- A target is an `http` or `https` URL with a host. It has no `user:password@`, no query and no fragment. A credential in
  the URL, or a token in its query, would end up in `config.json`, so the command refuses it and says to use `--header`.
  A query can still be typed in the page, below the proxy path. The refusal message does not echo the URL.
- A target whose host is loopback (`127.0.0.1`, `localhost`, `[::1]`) and whose port is the command's own port would make
  the relay call itself. The command refuses it at startup, after it knows its port.
- The proxy path of a target is `/proxy/<n>`, with `n` counted from 1 in the order given. The part after it, and the
  query, go to that target's origin as a path. The proxy never builds the outbound address by resolving that text as a
  URL, so no spelling of it can change the host or the port.
- `--target` with a path, such as `http://127.0.0.1:8787/agent`, lists the agent with the proxy path of that path
  (`/proxy/1/agent`). The whole origin is reachable under `/proxy/1/`, because presets and capability requests use other
  paths of the same server. The allowlist is the set of target origins, as in a hosted deployment's `allowedOrigins`.
- Two targets with the same origin are two entries. Each has its own proxy path and its own headers.
- The target answers with compressed content. The proxy passes the bytes and the `Content-Encoding` header on and
  decompresses nothing, so the browser decodes them as it would for a direct request.
- A target that answers with a redirect: the status and `Location` go to the page unchanged. The page's transport shows
  a redirect as an error and does not follow it.
- The target cannot be reached, the name does not resolve, or its certificate is not trusted, before it answers. The page
  gets a 502 with a one-line plain text body that names the target's origin and the error code, so the page can tell it
  from an answer the target sent. The command logs the same line.
- The target answers with headers and then cuts the stream. The command ends its own response without a clean ending, so
  the page sees a failed stream.
- The page aborts a request. The command closes its connection to the target at once. Long streams have no time limit of
  the command's own.
- A request for a path that is neither a packaged file, `config.json` nor a proxy path gets a 404. A method other than
  GET and HEAD on a file gets a 405 with an `Allow` header. A proxy path takes every method but `CONNECT`.
- `https` targets are checked against the certificates Node.js trusts by default. There is no option to skip the check. A
  development certificate is trusted the usual way (`NODE_EXTRA_CA_CERTS`).
- The command speaks HTTP/1.1 to targets. WebSocket and other upgrades are refused. Transports other than HTTP and SSE
  are not in scope.
- Another program of the same user that opens the printed address can use the proxy. The command does not defend against
  it, and the documentation says so. The browser rules rely on the `Sec-Fetch-Site` header that current browsers send.
- Command-line arguments are visible in the process list and the shell history of the machine, as for any command-line
  secret. The documentation says so.
- The packaged page files are missing, for example in a source checkout that has not been built. The command stops with
  a message that names the build step and exit code 1.
- A browser that opens `http://localhost:<port>/` works as the printed `127.0.0.1` address does. The command binds IPv4
  only. An IPv6 literal such as `[::1]` is not served and is not claimed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `agui-inspector` npm package MUST provide a command named `agui-inspector`, so that
  `npx agui-inspector --target <url>` starts the inspector. It needs Node.js 22.12 or newer, the same minimum as the
  JavaScript helpers of feature 006, and the documentation says so.
- **FR-002**: The command MUST accept these options and no others: `--target <url>` (repeatable, at least one),
  `--header "<Name>: <value>"` (repeatable), `--port <number>` (default 4747, `0` for any free port), `--help` and
  `--version`. No option sets the listening address.
- **FR-003**: The first argument, when it does not start with `-`, MUST be treated as a command name. No command exists
  in this feature, so such an argument stops the command with `unknown command "<name>"` and exit code 2. Options without
  a command MUST keep their meaning when commands are added later. A stray argument anywhere else MUST be a usage error
  that does not echo it, because it can be the rest of an unquoted header value. This feature builds no subcommand.
- **FR-004**: A target MUST be an absolute `http` or `https` URL with a host, and MUST have no credentials, no query and
  no fragment. A target that breaks a rule MUST stop the command before it listens, with a message that names `--target`
  and the rule and does not echo the URL.
- **FR-005**: A `--header` value MUST be a header name, a colon and a value. The name MUST be an HTTP header token and
  MUST NOT be `Host`, `Content-Length`, `Transfer-Encoding` or `Connection`, which the proxy sets. The value MUST be
  nonempty and valid in an HTTP header. A header belongs to the closest `--target` before it. A header before any target, or a malformed
  one, MUST stop the command before it listens, with a message that names `--header` and the rule and does not echo the
  value.
- **FR-006**: The command MUST listen on the IPv4 loopback address `127.0.0.1` only, on the port from `--port`, and
  MUST open no other listener. It MUST NOT listen before the arguments are valid. If the port is in use, it MUST stop
  with a message that names the port and exit code 1. After it listens, it MUST print to standard output one line with
  the address `http://127.0.0.1:<port>/` and one line for each target with its proxy path. A target's line MAY list the
  names of its headers and MUST NOT list a value.
- **FR-007**: The command MUST serve the page, its packaged files and `config.json` through the shared serving behavior
  of feature 006, so every such response carries the content security policy that the page's own `<meta>` element states.
  It MUST NOT carry a second implementation of file serving, path safety, the configuration format or the policy. The page
  is served at the root of the command's address. Only GET and HEAD MUST be served for these files.
- **FR-008**: The `config.json` the command serves MUST be the version 0 file with one agent for each target, in the order
  given. The agent's `id` is `target-<n>`, its `name` is the target's URL, and its `url` is the target's proxy path
  (`/proxy/<n>` followed by the target's path). It MUST contain no header, no credential and no field of its own. The
  packaged `hosting-config.json` MUST be served unchanged, so the page reaches its own origin only.
- **FR-009**: A request to `/proxy/<n>/<rest>?<query>` MUST be relayed to the origin of target `n`, with path `/<rest>`
  and the same query, with the request's method (every method except `CONNECT`) and body. The command MUST connect only
  to the origins of the targets given on the command line. A proxy path that names no target MUST be refused with a 403.
  No text after the proxy path MUST be able to change the host, the port or the scheme of the outbound connection.
- **FR-010**: The command MUST relay request and response bodies as streams of the exact bytes, in order. It MUST NOT
  buffer a body to its end, parse it, decode it, re-encode it or decompress it. A chunk that the target writes MUST be
  written to the page as it arrives. The command MUST NOT add, remove or reorder bytes of a body.
- **FR-011**: The command MUST relay the target's status and headers, except hop-by-hop headers and `Set-Cookie`, which it
  removes. It MUST NOT follow a redirect and MUST NOT rewrite `Location` or any other header. It MUST send the target the
  page's request headers except hop-by-hop headers and `Host`, `Cookie`, `Origin` and `Referer`. It sets `Host` for the
  target. Then it adds the headers set on the command line for that target, except any header the page's request already
  carries by the same name: the page's value wins.
- **FR-012**: When the command cannot get a response from the target (no connection, no name, no trusted certificate, a
  connection cut before headers), it MUST answer with a 502 and a one-line plain text body that names the target's origin
  and the error code, and MUST log that line. When the target cuts a stream after its headers, the command MUST end its
  response to the page as a failure, never as a complete response. When the page closes or aborts a request, the command
  MUST close the connection to the target.
- **FR-013**: The command MUST refuse, with a 403 and no outbound connection: a request to any path whose `Host` is not
  `127.0.0.1` or `localhost` followed by the command's port; a request to a proxy path with an `Origin` other than
  `http://127.0.0.1:<port>` or `http://localhost:<port>`; a request to a proxy path with a `Sec-Fetch-Site` other than
  `same-origin` or `none`; and a request whose target is not an absolute path (an absolute URL, an authority form or
  `*`). It MUST refuse `CONNECT` and upgrade requests with a 403. The cross-origin rules apply to proxy paths only, so a link on
  another site can still open the page, and no other site can reach a target through the proxy.
- **FR-014**: Headers set on the command line MUST be held in the memory of the command only. They MUST be sent only to
  their own target. They MUST NOT appear in `config.json`, in any file or response the command serves, in the command's
  output or logs, in an error message, or in anything the page can read from the command itself. The command MUST NOT
  write them to disk. A target that repeats a header value in its own response is a different case: those bytes are the
  target's evidence, and the command relays them unchanged like any other byte.
- **FR-015**: After the startup line, the command MUST write only failures to reach a target (FR-012) and fatal errors,
  to standard error. It MUST NOT log requests, paths, queries, headers or bodies.
- **FR-016**: The command MUST NOT make any request other than the relays of FR-009, and MUST NOT check for updates, send
  telemetry or contact any third party. It MUST add no cookie, session or file storage of its own.
- **FR-017**: A target whose host is loopback and whose port equals the command's own port MUST stop the command at
  startup with a message that names `--target` and exit code 2.
- **FR-018**: On `SIGINT` or `SIGTERM` the command MUST stop listening, close its open connections, including relays in
  progress, and exit with 0.
- **FR-019**: `--help` and `--version` MUST print their output to standard output and exit with 0 without listening. A
  usage error MUST print one message to standard error that names the option, add a pointer to `--help`, and exit with
  code 2. Any other failure at startup, such as the packaged page files being missing, MUST exit with code 1. No message
  echoes a header value or a target URL's query or credentials.
- **FR-020**: The command code MUST NOT be part of the browser bundle, and the bundle's content and its limits (2,000,000
  bytes minified, 600,000 bytes gzipped) MUST NOT change. The package MUST gain no runtime dependency. The command MUST
  need no change to the page, to the configuration format or to the hosting policy format.
- **FR-021**: Tests MUST cover each requirement above. They MUST include at least one end-to-end test that runs the
  command against the scripted reference agent, opens the printed address in a real browser, sees the agent, records a
  run and checks that the page made no request outside its own origin. Tests MUST cover a host other than the targets
  being refused, the loopback-only listener, the byte, chunk and timing fidelity of the relay, and the absence of a
  command-line header value from every file, response, output and export.
- **FR-022**: The documentation MUST describe the command on its own page: install and run, every option, the proxy paths,
  what the proxy relays and removes, how headers work with several targets, the guards, the limits (HTTP/1.1, loopback
  IPv4 only, no WebSocket, certificates, process list and shell history) and troubleshooting. The introduction, the
  status page, the embedding and hosting pages and the package README MUST point to it where they list the ways to run
  the inspector. The development page MUST list every new root script and the command's place in the repository. A
  changeset MUST add a minor change for `agui-inspector` only.

### Key Entities

- **Command line**: the options of FR-002 in the order given. A header's meaning depends on the target before it.
- **Target**: a URL given with `--target`. It has an origin (the part the allowlist holds), a path, its position `n`, and
  zero or more headers. Its credentials are never in its URL.
- **Proxy path**: `/proxy/<n>`, the part of the page's own origin that stands for target `n`. The configuration's agent
  URL is a proxy path followed by the target's path.
- **Held headers**: the name and value pairs set with `--header`, for one target each. They exist in the command's memory
  and in each request to that target, and nowhere else.
- **Served configuration**: the version 0 `config.json` the command builds from the targets. Same format as the other
  modes. No new field.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with a running AG-UI server that allows no foreign origin runs one command with its address,
  opens the printed address and records a run. The server needs no change, and no file is copied or written.
- **SC-002**: In a real browser, the page served by the command lists the target, records a run against the scripted
  reference agent and makes zero requests outside its own origin.
- **SC-003**: For a scripted stream with split frames, a non-JSON frame and invalid UTF-8, the bytes the client reads
  through the command equal the bytes the target wrote, in 100% of runs of the test set.
- **SC-004**: For a stream of at least ten chunks written 100 ms apart, every chunk reaches the client before the target
  writes the next one, and the chunk count and order match, in 100% of runs of the test set.
- **SC-005**: Of the request spellings in the test set (unknown proxy number, absolute-form target, `CONNECT`, upgrade,
  `//host`, `@host`, `\`, encoded slash and dot forms, a foreign `Host`, a foreign `Origin`, a cross-site fetch), zero make
  the command connect to a host other than a configured target.
- **SC-006**: The listener's bound address is `127.0.0.1` and no other. A connection to a non-loopback address of the test
  machine on the command's port is refused.
- **SC-007**: A unique synthetic header value is found in zero of: `config.json`, every served file, every response the
  command writes itself, its standard output and error on a normal run and on each error case, and an exported session.
  The target receives it on every request.
- **SC-008**: The browser bundle contains no command code and passes its size budgets unchanged. The package manifest adds
  zero runtime dependencies.
- **SC-009**: The docs site has a page for the command, and the existing documentation checks that read the docs pass.

## Assumptions

- Feature 006 merges first. This feature uses its internal serving core and its Node.js bridge as described in its
  `contracts/internal-core.md`, and the plan is checked against the merged code before implementation starts.
- The configuration format stays at version 0 and gains no field. The hosting policy of the packaged page stays
  `embedded`, so the page reaches its own origin only.
- The command sets no theme, branding, preset or capability for the agents it lists. A later item can add flags. A
  developer who needs them uses a helper or the static assets.
- The command does not open a browser. It prints the address.
- Replay and the conformance suite are subcommands of the next minor and are not part of this feature. The command layout
  of FR-003 only keeps room for them.
- The page is unchanged. A developer who types an endpoint in the page types a proxy path, because the embedded page
  reaches its own origin only. The agent picker lists the targets with their proxy paths ready.
- The default port 4747 is stable on purpose: the page saves its client profile in browser storage, which belongs to the
  origin, and a random port would lose it at each start.
- Targets speak HTTP/1.1, over TLS for `https`. HTTP/2-only servers, WebSocket and other transports are not in scope.
- A header that the developer sets for a target with a long-lived credential is visible in the process list and the shell
  history. Reading a header from the environment or a file is not part of this feature.
- Publishing, tags and releases stay with the maintainer. The changeset only records the change.
