# Hosted deployment

`agui-inspector` is a working name. This page covers serving the inspector as a static site, so a
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
| `config` | Optional. Where the agent configuration comes from. Without it the page reads `config.json` beside itself. A URL here must be this page's origin or an allowed one. |

The file in the build says `embedded` with no allowed origins, so a page deployed as shipped can reach
its own origin and nothing else. If the file is missing the page behaves the same way. A file that
exists but is wrong (bad JSON, an unknown field, a wildcard) stops the page from starting and shows
the reason; the page never guesses a wider policy. Unknown fields are errors so that a misspelled
`allowedOrigin` cannot silently mean "no restriction".

## What happens at startup

1. The page reads `hosting-config.json` from its own origin. This is the only request made under the
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
is the transport's. The remaining checks wait for integrated main: the whole
[quickstart](../specs/001-inspector-mvp/quickstart.md) with every lane merged (G-08 decides whether
that needs a further pull request), the 5,000-frame benchmark on the named hardware, and the
credential-echo checks that depend on the undecided G-07 policy. The app records frames exactly as
received and does not redact them; whether a server that echoes a token back is a problem is not
decided here.

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/hosted
npm run test:e2e -- tests/e2e/hosted
npm run build && npm run check:bundle
```
