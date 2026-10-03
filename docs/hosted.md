# Hosted deployment

`agui-inspector` is the approved package name. Nothing is published yet (see [distribution](distribution.md)).
This page covers serving the inspector as a static site, so a
developer opens it in a browser and it talks straight to an agent they name. For the same files
inside a Starlette or FastAPI application, see [embedding](embedding.md).

## What you deploy

`npm run build` writes `packages/inspector/dist`, and `staticAssetsPath` from the npm package points
at the same directory. Put it on any static host:

| File | What it is |
| --- | --- |
| `index.html` | The page. Its `<meta>` content security policy and its one script tag are fixed. |
| `app.js`, `app.css` | The application and its styles. The A2UI renderer is inside `app.js`. |
| `hosting-config.json` | The deployment's own policy: mode and allowed origins. Edit this one. |
| `config.json` | Optional. The agents to list. You add this file; the build does not ship one. |

Nothing else is loaded: no fonts, no analytics, no third-party scripts, and no server-side code. The page never sends a captured session anywhere; exports are files the
user saves.

## hosting-config.json

```json
{
  "version": 0,
  "mode": "hosted",
  "allowedOrigins": ["https://agent.example", "http://127.0.0.1:8787"],
  "config": "https://agent.example/inspector.json"
}
```

| Field | Meaning |
| --- | --- |
| `version` | Optional. Only `0` is accepted. |
| `mode` | `hosted` or `embedded`. Required. |
| `allowedOrigins` | Hosted only. Each entry is one absolute `http` or `https` origin: no path, no credentials, no wildcard. |
| `config` | Optional. Where the agent configuration comes from. Without it the page reads `config.json` beside itself. A relative value is read beside the page too, so under a mount path such as `/tools/inspector/` it means `/tools/inspector/agents.json`; start it with `/` to read from the origin root. A URL here must be this page's origin or an allowed one. |
| `allowVisitorTargets` | Optional boolean, `false` when absent. Hosted only: an embedded file that mentions it, even as `false`, is refused. `true` lets a visitor choose their own target; see [Visitor-chosen targets](#visitor-chosen-targets). |

The file in the build says `embedded` with no allowed origins, so a page deployed as shipped can reach
its own origin and nothing else. If the file is missing the page behaves the same way. A file that
exists but is wrong (bad JSON, an unknown field, a wildcard) stops the page from starting and shows
the reason; the page never guesses a wider policy. Unknown fields are errors so that a misspelled
`allowedOrigin` or `allowVisitorTarget` cannot silently mean "no restriction".

## What happens at startup

1. The page reads `hosting-config.json` from beside itself, on its own origin. This is the only request made under the
   static policy in `index.html`. It uses the page's own credentials, follows no redirect and is never
   cached.
2. The page turns the file into two things built from the same origin list: the policy the guarded
   transport enforces, and a second content security policy added to the document.
3. Only then does it create the runtime and read the configuration and the saved profile. Every one of
   those requests goes through the guarded transport.

The added policy reads:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self' https://agent.example http://127.0.0.1:8787; object-src 'none'; base-uri 'none';
form-action 'none'
```

Scripts come from the page's origin only, and `eval` and inline scripts are not allowed.
`connect-src` is the page plus the allowed origins. The policy in `index.html` stays in force
beside it, and a second policy can only narrow the first, never widen it.

Nothing the page reads later can change either policy. A configuration file, a capabilities URL, a
typed endpoint, an agent's `url` and a redirect all meet the same list: a destination outside it is
refused before any request is made, with a message that names the origin. To allow another origin,
edit `hosting-config.json` and reload.

### Also send the header

The `<meta>` policy is added by the page, so it exists from the moment the script runs. If your host
can set response headers, send the same policy as a `Content-Security-Policy` header too; the browser
then enforces it from the first byte. `contentSecurityPolicy(policy)` in
`packages/inspector/src/app/security.ts` produces the exact string for a given origin list.

### One message in the console

A page running under this policy logs one blocked-`eval` report at startup. One of the bundled
validation libraries (zod) calls `new Function('')` inside a `try` to learn whether it may compile
validators, and the browser reports the refusal. The library then takes its interpreted path. Nothing
is evaluated, and no other report appears in normal use.

## Visitor-chosen targets

A deployment such as a public demo cannot list the endpoints its visitors will try. Setting
`allowVisitorTargets` to `true` in `hosting-config.json` lets the visitor type any endpoint inside one
fixed boundary, without a deployer allowlist and without an approval prompt from the inspector:

```json
{
  "version": 0,
  "mode": "hosted",
  "allowedOrigins": [],
  "allowVisitorTargets": true
}
```

The boundary is the same everywhere it is enforced:

- any `https` origin, on any port;
- plain `http` to exactly `localhost` or `127.0.0.1`, on any port;
- the page's own origin, as always.

Everything else stays refused before a request is made: `http` to any other host, other schemes,
`user:password@` in a URL, hostnames that only contain or end with `localhost` or `127.0.0.1`
(`localhost.example`, `foo.localhost`), other loopback addresses such as `127.0.0.2`, and IPv6
literals such as `http://[::1]:8787`. A numeric spelling of the IPv4 address (`127.1`, `2130706433`) is
the same host once the browser parses the URL, and the guard reads the parsed URL, so those are
accepted exactly as `127.0.0.1` is. Redirects are still never followed, requests still carry no cookies,
and the token is still sent only as the one header the visitor chose.

The option does not change where the page reads its own configuration from. The agent configuration
comes from the page's own origin or from an origin you named in `allowedOrigins`, as before. Turning
the option on does not let the configuration be read from an address a visitor could type. What the
configuration declares is a target like any other: a capabilities URL is read when its agent is
selected (the first agent is selected at start, and a visitor switches agents from the picker beside the endpoint field), and a preparation request runs when the visitor sends a
message. Both meet the same boundary as the run, so a deployer who lists agents should list only
targets they are content for the page to contact. An A2UI surface still loads no remote image, video,
audio or catalog and opens no link; the policy below leaves `img-src` and `default-src` as they were.

With the option on, the added content security policy changes in one directive:

```
connect-src 'self' https: http://localhost:* http://127.0.0.1:*
```

The guard and this directive are built from the same host list in `packages/inspector/src/core/runtime/transport.ts`,
so a destination the guard accepts is one the browser lets through, and the reverse. There is no bare
`http:`, no wildcard host and no IPv6 entry. Entries in `allowedOrigins` must already be inside the
boundary (an `https` origin, or `http` to one of those two hosts) because a fixed origin cannot widen
it. A file that lists anything else fails to start, with the entry named, and the transport refuses
every request for a policy object built that way. Without the option, `allowedOrigins` keeps its
earlier meaning and may hold any `http` or `https` origin.

The footer says what applies. With the option on it reads
`2 exchanges · 14 frames · requests to this origin, HTTPS targets and supported local servers (use localhost; browser CORS and local-network rules apply) · no telemetry · headers never recorded`.
It names the kind of target, never an address, a query or a token.

Embedded pages reject the option, and nothing the page reads later (a configuration, an agent, a
profile, a typed endpoint) can turn it on. Changing it means changing the deployment's file.

### Local servers: use localhost

Type `http://localhost:<port>` for a server on the visitor's own machine. It is the form the policy
can match exactly in every browser. `http://127.0.0.1:<port>` is also accepted and is matched exactly
in Chromium and Safari (below). IPv6 loopback is not supported: browsers do not agree on how a content
security policy source names `[::1]`, so the inspector refuses it with a message that points here
instead of claiming it works.

The browser still decides whether the request goes out. The local server has to answer CORS for the
page's origin, and a browser may show its own permission prompt before a public page reaches a
local address. The inspector shows no prompt of its own and does not get around the browser's.

### Browser check

The Chromium rows are automated in `tests/e2e/visitor-policy/policy.spec.ts`, which sends the same
requests from the page and compares the browser's decision with the guard's for each destination. The
manual rows come from one probe page served from a loopback port with the connect-src above: for each
address it ran `fetch` against a loopback server that answers CORS and recorded whether the request
reached the server and whether the browser reported a connect-src violation.

| Destination | Chromium 153.0.8010.12 (Playwright 1.63.0) | Safari 27.0 (macOS 26.7.1) | Firefox |
| --- | --- | --- | --- |
| `http://127.0.0.1:<port>` | reached | reached | not run |
| `http://localhost:<port>` | reached | reached | not run |
| `http://127.1:<port>`, `http://2130706433:<port>` | reached as `127.0.0.1` | reached as `127.0.0.1` | not run |
| `http://127.0.0.2:<port>` | blocked by connect-src | blocked by connect-src | not run |
| `http://foo.localhost:<port>` | blocked by connect-src | blocked by connect-src | not run |
| `http://[::1]:<port>` | blocked by connect-src | blocked by connect-src | not run |
| non-loopback `http` host | blocked by connect-src | not tried | not run |

The Safari column was recorded by hand on 2026-10-02. Firefox was not installed where this was
written, so its column is open: to fill it, serve a page with the policy above, run the same seven
fetches against a CORS-permitting loopback server, and note which ones the browser blocks. Treat any
form other than `localhost` and `127.0.0.1` as unsupported until a row says otherwise.

## Direct browser requests

A hosted run is a request from the user's browser to the agent. There is no proxy and no bypass, so the
browser's own rules apply:

- CORS: the agent must allow this page's origin: `Access-Control-Allow-Origin` with the page's
  origin, `Access-Control-Allow-Methods: POST, OPTIONS`, and `Access-Control-Allow-Headers` naming
  `Content-Type`, `Accept` and the header the token travels in. A reply without these is blocked.
- Private network access: a page on a public address that calls a loopback or private address needs
  the target to answer the preflight with `Access-Control-Allow-Private-Network: true`.
- Secure context: an `https` page cannot call a plain `http` target, except for loopback addresses.

When the browser blocks a request, it tells the page only that the fetch failed. The inspector shows
the target's origin and those three likely causes, keeps the request as an exchange marked `failed`
with a transport finding, and sends nothing else.

Requests carry no cookies, not even to the page's own origin, because a hosted page has none of the
host's authentication to reuse. The token the user types goes out as one header of their choosing and is
cleared on reload or when the target changes. Redirects are never followed.

The footer of the inspection pane states the facts for the running mode: for example
`7 exchanges · 54 frames · requests only to this origin and https://agent.example · no telemetry · headers never recorded`.
With visitor-chosen targets it names that scope instead, as described above.

## An imported recording

Importing a session file opens it for inspection. It makes no request, and nothing can be sent until
the page is reloaded: the composer says why, and the footer and the inspection pane name the state. A
file that fails validation shows its error and leaves the session on screen unchanged.

## What this slice proves

`packages/inspector/tests/hosted` runs the startup sequence without a browser: file order, the policy
text, escalation attempts, redirects, cookies and the token's path.
`tests/e2e/hosted/app.spec.ts` builds the application the way it ships and checks it in Chromium
against scripted, model-free agents on separate loopback origins:

- the policy is present while the configuration request is still pending, scripts and connections
  outside it are blocked by the browser, and `eval` throws;
- a configured agent, capabilities URL, configuration URL, typed endpoint or redirect outside the
  allowlist is refused and the foreign origin sees no request;
- hosted runs carry no cookie, embedded runs carry the host's, and every request stays on the page's
  origin or the allowed agent;
- a blocked request is shown with its causes and kept as a failed exchange;
- the token reaches only the target, and is absent from storage, both exports and the page text;
- an A2UI surface renders under the policy and its action starts a new run;
- layout at wide and narrow widths, keyboard order, accessible names and the theme tokens.

This is scoped acceptance, not the product sign-off. Loopback cannot trigger private-network or
secure-context blocks, so those are stood in for by aborting the request in the browser; their wording
is the transport's. The whole [quickstart](../specs/001-inspector-mvp/quickstart.md) was checked on integrated main, and G-08
closed without a further pull request. The credential-echo checks (G-07, constitution 1.0.3) are in
`tests/e2e/inspection/credential-echo.spec.ts`. The app records frames exactly as received and does not
redact them (see [recordings](recordings.md#a-token-you-entered-and-a-server-that-repeats-it)). Two checks
remain: the 5,000-frame benchmark on the named hardware, which the maintainer runs, and a manual smoke run in
every distribution mode before any release.

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/hosted
npm run test:e2e -- tests/e2e/hosted
npm run build && npm run check:bundle
```

The visitor-target option has its own checks. `packages/inspector/tests/hosted/visitor-policy.test.ts`
and `packages/inspector/tests/runtime/transport.test.ts` cover the parser, the policy, the content
security policy and each caller (configuration, capabilities, preparation, run and raw request).
`tests/e2e/visitor-policy` covers the browser:

```sh
npm run test:unit -- packages/inspector/tests/hosted packages/inspector/tests/runtime
npm run test:e2e -- tests/e2e/visitor-policy
```
