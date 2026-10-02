# Implementation Plan: Public demo

**Branch**: `mvp/w4-p00-plan-public-demo` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-public-demo/spec.md`; approved maintainer decisions and coordinator
compatibility clarification of 2026-10-02.

**Status**: Planning only. Implementation starts on main after W3 D01/D02/D03; deployment has
additional gates below.

## Summary

Add a GitHub Pages companion to 0.1.0: the existing app, a demo-only bootstrap and a same-origin
service worker answering deterministic reference-agent endpoints with real `Response`/
`ReadableStream<Uint8Array>` HTTP/SSE data. Native fetch still traverses the guarded transport,
response-cloning recorder and frame reader. Share scenario producers with Node fixtures, not
a second fake transport or app.

Add strict hosted startup `allowVisitorTargets: true`, false when omitted; derive CSP and
transport restrictions from this same policy and disclose it in the footer. Allow all HTTPS
targets and exact supported HTTP loopback sources, never `http:` globally. Browser limitations
are a gate, not permission to widen policy. Ordinary distributions never register/include the
worker. A SHA-pinned main-only Pages workflow validates an isolated demo artifact; planning
does not enable Pages, deploy, release or publish anything.

## Technical Context

**Language/Version**: Existing strict TypeScript 7.0.2 / React 19; Node >=24; Python >=3.10.
**Primary Dependencies**: Existing exact-pinned AG-UI/A2UI packages and esbuild 0.28.2;
native service workers, fetch and streams; no new dependency.
**Storage**: Existing credential-free profiles only; no worker cache, IndexedDB, request logs,
credentials or server sessions persisted.
**Testing**: Existing `node --test` compiler runner, Playwright Chromium, budget checker and
Python package tests; separate DOM/worker TS projects avoid conflicting platform globals.
**Target Platform**: HTTPS Pages at `/agui-inspector/`; loopback preview for tests.
Firefox/Safari numeric-loopback checks are manual evidence, not existing CI coverage.
**Project Type**: Static browser app with isolated demo build, no backend.
**Performance Goals**: Examples ready/unavailable within 10 seconds; inherited MVP >=95%
of filter/expand actions visibly complete within 200 ms during 5,000-frame capture.
**Constraints**: Complete ordinary and demo sets each <=2,000,000 bytes and <=600,000
deterministic per-file gzip total bytes, including demo worker/config.
**Scale/Scope**: Three implementation PRs; no publication, release workflow, JS helper or CLI.
No unresolved design choice is hidden as a default.

## Constitution Check

Pre-research: 1.0.3 required an amendment for visitor-selected destinations; the maintainer
approved the 1.1.0 MINOR amendment. Post-design: compliant with 1.1.0 conditional on evidence.

| Rule | Assessment and required evidence |
| --- | --- |
| I: wire first | Native worker HTTP/SSE, real fetch and unmodified recorder/reader; compare bytes/order, malformed tail, partial stop and recorded continuation requests, not only rendered text. |
| II: protocol / framework-free core | Existing client/schema/renderer baseline; pure producers have no React, Node I/O or worker imports. Worker is an endpoint adapter, not a client replacement. |
| III: generic core / presets | Example routes/preparations stay in demo config/worker; no scenario branches in runtime/config parser/recorder. |
| IV: privacy | Default-off hosted-only startup opt-in, accurate footer; no automatic external requests, cookies, headers or persistent credentials; echoes unchanged and browser restrictions retained. |
| V: small / auditable | Native APIs, installed esbuild, one shared producer module, existing budget helper; no cache/offline shell/mock library. |
| VI: all event types | Baseline plus run-error cover all 31 fixtures; existing views/A2UI v0.9 renderer and D03 alias retained. |
| Shared bundle / packaging | Existing app build with demo-only supplemental assets; standard static/npm/Python sets contain no demo bootstrap/worker/examples. No alternate app or recorder. |
| CSP / auth | Same-origin scripts, no eval, explicit demo worker-src; startup policy owns connect-src; embedded auth/default restrictions unchanged. |
| Quality / release | Introduced checks in PR CI, dual budgets/package isolation, inherited physical 5,000-frame gate. Main deployment is not a tag release or publication. |

No other constitution exception is authorized. Failure of SW wire/stop integrity, package isolation
or strict network enforcement blocks the responsible slice instead of weakening principles I/IV.
MVP docs describe restrictive defaults; 002 and FR-037/FR-038 cross-references govern the extension
without rewriting W3-owned artifacts.

### Open gates

| Gate | Owner / blocks | Exit evidence |
| --- | --- | --- |
| G-D01 W3 prerequisite | Coordinator; every implementation slice | D01 release hygiene, D02 theme delivery and D03 catalog/credential echo merged on main, especially D02 startup/index edits. No W4 branch from an unmerged W3 lane. |
| G-D02 exact loopback CSP | P01; numeric-address support claims | Native Chromium CSP/fetch tests for localhost/127.0.0.1 at non-default ports plus non-loopback HTTP refusal; manual Firefox/Safari IPv4 matrix. IPv6 literal CSP is not portable: [::1] is unclaimed until exact browser enforcement is proven; use localhost, never broad http:. Coordinator confirmed 2026-10-02. |
| G-D03 SW byte/stop proof | P02/P03; example acceptance | First-load controller, exact bytes versus Node fixtures, malformed tail, incremental delivery and native stop of both recorder/client branches plus producer cleanup. If native behavior fails, ask before changing transport or adding a bridge. |
| G-D04 Pages authorization | Maintainer; deployment only | Maintainer enables Pages Actions source and confirms github-pages environment/main authorization. Workers do not change settings or deploy in planning. |
| G-D05 integrated artifact | P03; deployment readiness | Dual complete-set budgets, wheel/npm/static isolation, sub-path E2E and PR CI pass on P01/P02. Inherited physical M2 responsiveness certification remains with maintainer, not this planning PR. |

No unresolved product question remains. These evidence/authorization gates are not claimed passed
by planning; IPv6 support is not an advertised acceptance prerequisite without proof.

## Project Structure

### Documentation (this feature)

```text
specs/002-public-demo/
  spec.md
  checklists/requirements.md
  plan.md
  research.md
  data-model.md
  contracts/demo.md
  quickstart.md
  tasks.md
  analysis.md
```

### Source Code (repository root)

```text
packages/inspector/src/contracts.ts                 # P01 policy
packages/inspector/src/app/{security,startup,index}.*# P01 policy/footer/mount seam
packages/inspector/src/core/runtime/transport.ts    # P01 central guard
examples/reference-agent/scenarios.ts              # P02 new pure producer
examples/reference-agent/{server,interactive-scenarios,protocol-fixtures}.ts
demo/bootstrap.ts                                  # P03 DOM entry
demo/tsconfig.json                                 # P03 DOM typecheck
demo/service-worker.ts                             # P02 endpoint adapter
demo/tsconfig.worker.json                          # P02 worker typecheck
demo/{hosting-config,config}.json                   # P02 deployment examples
demo/index.html                                    # P03 separate entry
scripts/build-demo.mjs                             # P03 isolated shared build
tests/demo/{scenarios,worker,build}.test.ts          # P02/P03 Node checks
tests/e2e/{visitor-policy,public-demo}/             # P01/P03 browser checks
.github/workflows/pages.yml                        # P03 main deployment
docs/{hosted,configuration,public-demo,development}.md
```

**Structure Decision**: Policy extends existing seams; demo lives outside ordinary public/dist.
Exact paths/ownership are frozen in [tasks.md](tasks.md), not permission to edit whole directories.

## Phase 0: Research

[research.md](research.md) records native API/Pages sources, existing seams and alternatives.
Worker HTTP/SSE direction holds; literal loopback CSP is not portable and was escalated/confirmed.
No speculative backend, library or credential storage.

## Phase 1: Design

### Startup policy and mount seam

Strict optional boolean `allowVisitorTargets` is hosted-only. Extend `TransportPolicy` with an
optional boolean so old callers retain false. `resolveTarget` remains the one shared destination
guard for config, capabilities, preparation, run and raw requests; opted-in HTTPS and exact proven
HTTP loopback sources are added without config/profile mutation. Keep URL normalization/userinfo/
redirect guards and hosted `credentials: 'omit'`; audit every caller for consistent behavior.
When opted in, fixed origins cannot add non-loopback HTTP: reject out-of-bound combinations at
hosting parse and enforce the same opted-in boundary in the guard even for a constructed policy.
Default-off fixed-origin semantics remain unchanged.

Derive startup connect-src before config/target traffic. Current static HTML restricts scripts/
objects/base URI, not connects; meta policies intersect and cannot widen an existing restriction.
Demo HTML explicitly permits `worker-src 'self'` before registration; startup policy must permit
that worker too. Ordinary policy need not gain worker directives to build demo assets. Preserve
A2UI remote-resource blocks even with broad HTTPS target requests; no external catalog/asset loads.
Footer accurately names policy without tokens or URL queries.

Reuse the existing ordinary-root guard around app auto-mount; no new auto-mount mechanism is needed.
Demo uses a different container and imports exported `mountApp` once. Add optional
startup config-file override (not policy override), allowing demo bootstrap to choose examples
after readiness or an absent optional config for usable own-server fallback. These seams belong
to P01, so P03 never edits W3-sensitive app files.

### Shared scenarios and service worker

Extract interactive selection/serialization into pure `examples/reference-agent/scenarios.ts`.
Reuse already-neutral A2UI/protocol/recorder helpers, not duplicate event data. Node adapters retain
I/O, CORS, validation statuses, request-order logs, failure controls and open-stream accounting.
Protocol generation may accept run/thread IDs with unchanged fixed defaults: generate desired
bytes at the producer, never rewrite captured fixture evidence.

Worker handles only exact same-origin reserved routes under its page directory. Read/validate
body and return HTTP status/content-type plus byte stream, without reading auth headers, storing
requests or forwarding network traffic. Assets/navigation/external/visitor endpoints pass through
unhandled. No cache/offline shell. Native cancellation/abort must release both page readers and
held-open producer without inventing terminal frames; browser proof G-D03 is required. Compare
complete bytes/order and incremental delivery; native chunk boundaries may coalesce.

Register a classic bundled sibling worker with page-directory scope and `updateViaCache: 'none'`.
Install uses `skipWaiting()`, activate `clients.claim()`; no persistent state is migrated.
Listen for controller changes before registration, handle an existing matching controller and
require identity/scope/version readiness handshake within 10 seconds. `ready` alone cannot prove
first-page control. No reload. Update/controller failure during a run is visible and never
replays a request.

Unsupported/blocked/timed-out workers show a reason and mount the same app without example
config, retaining own-server and import functions. No example controls/POSTs until ready.
No remount/retry machinery: visitors can reload to retry setup after saving any current recording.

### Demo configuration, build and Pages

`build-demo.mjs` calls existing `buildApp(outdir)` into `.build/public-demo`, adds demo-only assets
and replaces HTML/config only there. Validate base path, `/agui-inspector/` by default, and `--origin` (the Pages site by default; the Pages
workflow passes the configure-pages `origin` and `base_path` outputs). Prefix only
checked-in demo endpoint/preparation references into absolute URLs (origin, base path, path), because hosted
mode refuses a non-absolute endpoint; preserve preparation
templates and ordinary URL semantics. `config.json` lists interactive/A2UI/baseline/run-error agents,
capabilities, presets and quick messages. Bootstrap uses the same built app module as an external
import, avoiding duplicate renderer/app bundles. Worker and DOM bootstrap get separate strict
TypeScript projects using WebWorker and DOM libraries.

P03 wires introduced demo checks into existing PR CI; no new dependency. Existing complete-dir
budget checker validates ordinary and demo outputs independently, including all demo assets.
Inspect npm archive and Python wheel contents as well as ordinary dist for isolation.

Pages workflow triggers only main push and optional manual run explicitly restricted to main.
Build job has contents-read, locked no-script installation, checks and upload of only demo output.
Deploy job needs build, has only pages-write/id-token-write, github-pages environment/output URL,
SHA-pinned researched deployment action and a Pages concurrency group that serializes deployments
without cancelling an active one. PR CI never deploys/uploads a Pages deployment artifact or gains
deployment permissions. Workflow does not auto-enable Pages.

## Validation strategy

P01: parser/predicate/CSP/defaults/footer/mount seam, existing hosted/runtime checks and real
browser unlisted-target/loopback/forbidden-HTTP evidence. P02: pure bytes and Node fixture controls,
worker status/route/stream confinement and strict worker types. P03: fresh-load/unsupported/sub-path
browser matrix; all interactive/A2UI/protocol scenarios; inherited recorder/frames/config/runtime/
hosted checks; dual budgets, distribution archives and CI wiring. [quickstart.md](quickstart.md)
provides commands and expected outcomes, not claims these planned checks ran.

P01 visitor-policy and P02 shared-demo-endpoints are independent after W3; P03 demo-pages-delivery
depends on both. P03 may have only one unmerged direct parent while the other is already merged;
otherwise wait for both on main. No fourth integration slice.

## Complexity Tracking

None. Approved 1.1.0 resolves the hosting conflict; no further exception, runtime dependency,
parallel app, speculative abstraction or shared-file lane.

## Workflow record

Specify quality checklist passed with mandated technical constraints retained. Constitution
scaffold resolved and 1.1.0 applied; sync report retained at the explicit maintainer request.
Setup-plan resolved this directory via `SPECIFY_FEATURE_DIRECTORY`; its BRANCH JSON reports the
feature ID, not a branch switch (actual branch remains `mvp/w4-p00-plan-public-demo`).
Phase 0/1 artifacts complete; no extension/agent-context/branch-creation hooks. Gates remain open.
