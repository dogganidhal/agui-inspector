# Contracts: Public demo

**Status**: Planned additive version-0 hosting/config contract; no implementation in this PR.

## Hosted startup option

```json
{
  "version": 0,
  "mode": "hosted",
  "allowedOrigins": [],
  "allowVisitorTargets": true
}
```

Absent allowVisitorTargets means false. Embedded rejects its presence including false; nonboolean/
unknown keys fail visibly. Agent config/profile cannot widen policy. Old files retain behavior,
no saved-format migration; document additive pre-1.0 field in configuration guide.

True permits own origin and HTTPS plus exact proven HTTP loopback hosts/ports. Fixed entries cannot
widen that boundary; out-of-bound combinations fail startup and are refused by the runtime guard.
Default-off fixed origins retain existing semantics.
CSP includes https: http://localhost:*; IPv4 included/advertised only with browser proof; IPv6
unclaimed until exact enforcement proven. No http:/*/unsafe-eval source or address rewriting.
Hosted targets always omit cookies; embedded default same-origin auth unchanged.

Footer names chosen scope, e.g. "requests to this origin, HTTPS targets and supported local
servers · no telemetry · headers never recorded", with browser-limit guidance. No misleading
origin-only claim, URL queries or tokens. Existing userinfo/redirect/export rules unchanged.

## Startup mount seam

Existing mountApp(container, env) remains the app mount. Optional config-file override in startup
environment affects resource only, not hosting policy. Without it, existing hosting config/default
config.json unchanged. Optional override 404 keeps existing empty-agent/typed-endpoint fallback
when hosting does not require a config; the demo hosting file omits explicit config for this reason.

Ordinary auto-mount runs only if ordinary root exists. Demo HTML uses a separate root, bootstrap
imports shared app and mounts once after readiness with example config, or absent optional config
when unavailable. Native status/docs are outside app root. No remount/automatic reload/replay;
failure guidance says reload to retry setup after exporting any current recording.

## Worker registration/readiness

- Sibling ./service-worker.js, scope ./ under /agui-inspector/, classic bundle, updateViaCache none.
- Demo HTML worker-src self; no external imports/inline script/eval or wider scope header.
- Initial install skipWaiting and activate clients.claim; no cached/persistent state migration.
- Listen before registration, handle existing expected controller, verify identity/scope/version
  handshake within 10 seconds; ready promise alone insufficient.
- Handshake messages contain type/version/ready only; no header/body/credential/recording data.
- Unsupported/blocked/timeout visibly disables examples only, retaining own-server/import.

## Exact HTTP routes

B is normalized deployment base, /agui-inspector/ by default. Respond only to same-origin reserved
routes; never proxy arbitrary URLs, handle navigation, cache assets or intercept visitor endpoints.

| Route | Method / response |
| --- | --- |
| B + __demo__/agent/interactive | POST run input; 200 shared interactive SSE, paced. |
| B + __demo__/agent/a2ui | POST run input; 200 supported activity snapshot containing existing form/continuation operations and matching run envelope, paced. |
| B + __demo__/agent/protocol/baseline | POST run input; 200 baseline bytes generated with supplied IDs. |
| B + __demo__/agent/protocol/run-error | POST run input; 200 RUN_STARTED/RUN_ERROR bytes. |
| B + __demo__/prepare/sessions/<threadId> | PUT; 200 JSON {"ok":true}; exactly one nonempty segment, not a broad prefix. |
| B + __demo__/prepare/warm | POST; 200 JSON {"ok":true}. |

Wrong reserved method 405; malformed JSON 400; missing string threadId/runId 422; error bodies
remain recorded. Node interactive adapter keeps its existing malformed-input 422 behavior:
validation belongs to adapters while successful scenario content is shared. Unknown reserved
paths may return local JSON 404; nonreserved fetch events pass through unhandled.

Responses declare content type/cache-control no-store; recorder still reads no headers. Worker
never inspects auth/cookie headers or records request objects. Uint8Array SSE chunks preserve
malformed bytes/mixed delimiters; native browser coalescing is not failure. Cancellation/abort
cleans up held-open producer, a paced producer in a pause or mid-stream, and both page readers, with
no artificial terminal event. Browser proof required; unsupported cleanup blocks G-D03 rather than
hiding failure.

Pacing (FX9): the interactive and A2UI answers are paced. RUN_STARTED goes out at once; the first event
after it waits 300 to 900 ms; text, reasoning and tool-call argument deltas are cut into word-sized or
few-character pieces 20 to 60 ms apart; a new message, step or tool call waits 150 to 400 ms, a tool
result 400 to 900 ms after its call, a state or surface update 250 to 600 ms. Event types and order are
those of the scenario and each delta stream joins back to the original text. Baseline and run-error bytes,
chunks and delimiters are unchanged and unpaced. The only worker timers are these pauses.

## Example config

Existing version 0, agents/capabilities/presets only. Interactive messages cover six scenarios;
A2UI/baseline/run-error have their own quick messages. Interactive preset demonstrates ordered
session/warm preparations using threadId/runId built-ins. A2UI actions use existing forwardedProps
envelope in a new run, not an auxiliary fake transport. Source references are relative; build
writes each as an absolute URL, origin plus B plus the path (a hosted page refuses an endpoint that is not
absolute), without altering ordinary loader/config/user URL semantics.

## Build / Pages

- node scripts/build-demo.mjs --outdir .build/public-demo --origin https://dogganidhal.github.io --base-path /agui-inspector/ builds only
  isolated demo assets using shared helpers; ordinary package dist untouched. --origin defaults to the
  authorized Pages site; it must match the origin that serves the page, because the worker answers only
  same-origin requests.
- Validate base path absolute/trailing slash, no origin/userinfo/query/fragment/traversal; validate origin as one
  HTTPS origin (HTTP only for localhost/127.0.0.1) with no path/userinfo/query/fragment; invalid
  output/base/origin options fail explicitly, not silent fallback.
- Existing budget --dir .build/public-demo counts all assets under unchanged limits; normal
  npm run build/check:bundle stays separate.
- Pages main-only workflow passes the configure-pages origin and base_path outputs to the build, so a fork
  deploys under its own address; upload/deploy use researched SHA pins; build contents-read, deploy pages-write/
  id-token-write. PR CI has no deployment permissions/trigger.
- Standard static/npm/wheel contain no worker/bootstrap/demo configs; verify archive contents.
