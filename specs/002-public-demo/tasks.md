# Tasks: Public demo (0.1.0 companion)

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md),
[data model](data-model.md), [contracts](contracts/demo.md), [validation guide](quickstart.md).

**Approval**: Maintainer decisions and coordinator technical clarification, 2026-10-02.
Constitution 1.1.0 is the explicit hosted visitor-target amendment; no other exception.

**Format**: Pxx is a one-PR implementation slice; Txxx is an executable checklist task.
[USn] maps stories; [P] permits independent tasks only after slice prerequisites. The existing
001 slice format and disjoint ownership take precedence over generic serial story phases.
Tests are required by this spec/constitution. No scaffold/publishing/deploy-now task.

## Setup and foundation: merged prerequisites, not a fourth slice

Every slice depends on **main after all W3 D01/D02/D03 merge** (G-D01). D02 owns startup.ts/index.tsx
while in progress; W4 must not edit or stack on those unmerged changes. Existing MVP foundation,
tooling and configuration are reused. Confirm merged prerequisites before starting each slice.

At most three implementation slices, exact disjoint paths below. Coordinator alone updates shared
spec/task/roadmap tracking; implementation workers do not edit each other's paths or these planning
artifacts. A required extra path, unresolved constitution conflict or failed native SW direction
is a coordinator question, not silent scope expansion.

## Wave W4: policy and example producers, then Pages integration

### P01 visitor-policy

**Refs:** FR-007 to FR-011, FR-016, FR-017; US2 (P1), US1.5; SC-003/SC-004/SC-006;
constitution IV; G-D01/G-D02.
**Depends on:** main after W3 D01/D02/D03 merge only.
**Owned paths:** `packages/inspector/src/contracts.ts`,
`packages/inspector/src/app/security.ts`, `packages/inspector/src/app/startup.ts`,
`packages/inspector/src/app/index.tsx`, `packages/inspector/src/core/runtime/transport.ts`,
`packages/inspector/tests/hosted/startup.test.ts`, `packages/inspector/tests/hosted/app.test.tsx`,
`packages/inspector/tests/hosted/visitor-policy.test.ts`,
`packages/inspector/tests/runtime/transport.test.ts`,
`tests/e2e/visitor-policy/policy.spec.ts`, `docs/hosted.md`, `docs/configuration.md`.

**US2 goal/independent test:** A normal hosted app with startup opt-in accepts an unlisted
browser-compatible endpoint through native fetch; defaults/embedded auth stay unchanged.
No example worker or Pages workflow is needed for this slice.

- [x] T001 [US2] Add default-off/parser/policy/CSP tests in `packages/inspector/tests/hosted/visitor-policy.test.ts` and guard tests in `packages/inspector/tests/runtime/transport.test.ts`: optional boolean defaults false; any embedded occurrence rejected; wrong types/unknown keys and out-of-bound fixed origins with opt-in visibly fail; HTTPS/unlisted and exact loopback/non-default ports versus non-loopback HTTP/scheme/userinfo/redirect/hostname-suffix tricks; audit normalized numeric/IPv6 forms and every guarded-request caller, including constructed policy objects.
- [x] T002 [US2] Extend hosting validation/policy in `packages/inspector/src/app/security.ts` and optional `TransportPolicy.allowVisitorTargets` in `packages/inspector/src/contracts.ts`; add the one shared opt-in predicate in `packages/inspector/src/core/runtime/transport.ts` and derive startup connect-src from it, preserving existing false/embedded/fixed-origin behavior and no cookies/header recording. Opted-in fixed origins cannot widen HTTPS/loopback; reject invalid combinations at parse and guard. Use https: plus exact localhost source and proven IPv4 only; no broad http:/* fallback or unproven IPv6 claim.
- [x] T003 [US1] Add optional config-file-only startup override in `packages/inspector/src/app/startup.ts` and test default/override/optional-404/error/policy ordering in `packages/inspector/tests/hosted/startup.test.ts`; it changes no mode/origin/policy and leaves no-agent own-server/import fallback usable. Demo hosting must omit explicit required config.
- [x] T004 [US2] Carry policy to footer in `packages/inspector/src/app/index.tsx`, accurately name visitor-target scope and preserve existing ordinary-root auto-mount/exported mountApp seam; extend `packages/inspector/tests/hosted/app.test.tsx` for default/opt-in footer, ordinary mount and a different demo container with no automatic mount. No alternate app, demo registration or credential-containing text.
- [x] T005 [US2] Prove native Chromium CSP/fetch against real unlisted targets/local ports in `tests/e2e/visitor-policy/policy.spec.ts`, including CORS failure/no-cookie/forbidden-HTTP refusal, config/capability/preparation/run/raw caller consistency and preserved A2UI external-resource blocking. Re-prove exact 127.0.0.1 matching; document manual Firefox/Safari numeric-loopback results and localhost guidance in `docs/hosted.md`, and strict hosting field/default/migration in `docs/configuration.md`. Unsupported forms visibly fail, browser prompts are not bypassed.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/hosted
packages/inspector/tests/runtime`, `npm run test:e2e -- tests/e2e/visitor-policy`.
Native requests and CSP agree on tested boundary; no endpoint approval prompts, no hosted cookies;
all restrictive defaults/auth/redirect/credential rules preserved. G-D02 records Chromium IPv4
evidence and manual matrix; IPv6 not advertised. New override resource cannot widen policy.

### P02 shared-demo-endpoints

**Refs:** FR-002 to FR-006, FR-010 to FR-012, FR-017; US1 (P1); SC-002/SC-004;
constitution I/II/III/VI; G-D01/G-D03 (adapter proof, integrated browser proof in P03).
**Depends on:** main after W3 D01/D02/D03 merge only; independent of P01.
**Owned paths:** `examples/reference-agent/scenarios.ts`,
`examples/reference-agent/server.ts`, `examples/reference-agent/interactive-scenarios.ts`,
`examples/reference-agent/protocol-fixtures.ts`, `demo/service-worker.ts`,
`demo/tsconfig.worker.json`, `demo/hosting-config.json`, `demo/config.json`,
`tests/demo/scenarios.test.ts`, `tests/demo/worker.test.ts`.

**US1 goal/independent test:** Pure byte producers match existing fixture behavior; Node and native
worker adapters consume the same source. Worker-only tests/typecheck and Node regressions run
without P01/P03; final fresh-browser demo readiness/Stop acceptance belongs to P03.

- [x] T006 [US1] Freeze default scenario bytes/IDs/order and Node validation/routes/CORS/request-order/failure/open-stream behavior in `tests/demo/scenarios.test.ts`, including plain/interrupt/tools/slow/state/broken, resolve/cancel/tool/A2UI continuations and all 31 protocol fixture types; reuse existing recorder/A2UI/protocol helpers, not duplicate event data.
- [x] T007 [US1] Extract pure interactive selection/serialization and shared response descriptor into `examples/reference-agent/scenarios.ts`; adapt `examples/reference-agent/interactive-scenarios.ts` and `examples/reference-agent/server.ts` to it while preserving existing I/O/validation/status/CORS/CLI/logging semantics. Reuse existing pure A2UI operations/continuation and protocol/recorder helpers; parameterize protocol generation in `examples/reference-agent/protocol-fixtures.ts` with original fixed defaults and unchanged default bytes. No Node/React/worker dependency in the pure module.
- [x] T008 [US1] Implement exact base-scoped same-origin reserved routes and native Response/Uint8Array ReadableStream adapter in `demo/service-worker.ts`, with no forwarding/cache/storage/header inspection; preserve malformed bytes, return visible 400/422/405/404 error bodies, native hold/abort cleanup and no artificial terminal frames. Initial skipWaiting/activate clients.claim and type/version readiness handshake only; add strict worker-only WebWorker TypeScript project in `demo/tsconfig.worker.json`.
- [x] T009 [P] [US1] Add deployment-only `demo/hosting-config.json` with explicit hosted visitor-target opt-in and omitted required config, plus existing-version agent/preset/capability/quick-message `demo/config.json` for interactive/A2UI/baseline/run-error. All six interactive messages and ordered session/warm preparations must be exposed; source endpoint/preparation references are demo-relative, no credential/policy fields in agent config.
- [x] T010 [US1] Add worker route/method/body/error/byte/hold-cancel tests in `tests/demo/worker.test.ts` using native Response/streams and existing pure producers; verify unrelated origins/routes/navigation/assets pass unhandled, readiness messages carry no sensitive data, no Node I/O imports or storage/network forwarding, and both default/protocol-input-ID producers retain exact intended bytes.

**Acceptance:** `npm run typecheck`, `npm exec -- tsc -p demo/tsconfig.worker.json`,
`npm run test:unit -- tests/demo/scenarios.test.ts tests/demo/worker.test.ts
packages/inspector/tests/foundation/reference-agent.test.ts packages/inspector/tests/runtime
packages/inspector/tests/frames packages/inspector/tests/a2ui`.
Existing Node fixtures remain unchanged on the wire/test controls; shared producer is the only
interactive source. All 31 types and malformed/continuation bytes are covered. Adapter-only checks
do not claim first-page control or native browser abort proof; G-D03 remains until P03.

### P03 demo-pages-delivery

**Refs:** FR-001, FR-004 to FR-006, FR-009 to FR-017; US1 (P1), US3 (P2), integrated US2;
SC-001 to SC-007; G-D01/G-D03/G-D04/G-D05.
**Depends on:** main after W3 D01/D02/D03 merge, plus P01 and P02.
P03 may stack on **one** unmerged direct parent only when the other is already merged;
otherwise wait for both on main. No deeper stack or fourth integration PR.
**Owned paths:** `demo/bootstrap.ts`, `demo/tsconfig.json`, `demo/index.html`,
`scripts/build-demo.mjs`, `scripts/ci.mjs`, `.github/workflows/ci.yml`,
`.github/workflows/pages.yml`, `tests/demo/build.test.ts`,
`tests/e2e/public-demo/demo.spec.ts`, `packages/python/tests/test_distribution.py`,
`docs/public-demo.md`, `docs/development.md`.

**US3 goal/independent test:** An isolated artifact previews under Pages sub-path with the shared
app and embedding link; ordinary dist/npm/wheel remain clean. Workflow can be reviewed/tested
without enabling Pages or deployment.

**Integrated US1 goal:** Fresh control/readiness, full scenario bytes/continuations/Stop and
unavailable fallback proven using actual service workers, not endpoint request stubs.

- [x] T011 [US1] Build demo-only bootstrap in `demo/bootstrap.ts`/`demo/index.html`: native accessible preparing/unavailable status, sibling same-origin worker registration, identity/scope/version handshake and pre-registration controller listener, existing-controller handling and total 10-second bound; mount shared app once into different root with ready-example or absent-optional config. Include explicit worker-src self; no auto-reload/remount/replay, fake fetch or early example POST; keep own-server/import when unavailable and link existing embedding docs without prefetch.
- [x] T012 [US3] Implement `scripts/build-demo.mjs` reusing buildApp/bundleOptions into isolated .build/public-demo, strict output/base validation and only demo URL/preparation-prefix generation with template preservation; add DOM project `demo/tsconfig.json`. External-import the shared app module to avoid duplicate renderer; never place demo files in ordinary package public/dist or change normal config URL semantics.
- [x] T013 [US3] Add `tests/demo/build.test.ts` and extend `packages/python/tests/test_distribution.py` for complete dual budgets, ordinary dist byte/hash stability after demo build, strict argument failures, app/worker dependency separation and absence of worker/bootstrap/demo config/registration in actual npm archive and Python wheel. Use isolated temporary npm pack --ignore-scripts output and clean only named test-owned artifacts; no publishing.
- [x] T014 [US1] Add real fresh-context/sub-path service-worker E2E in `tests/e2e/public-demo/demo.spec.ts`: readiness <=10 seconds, no manual reload, no duplicate mount, six interactive scenarios, both interrupt outcomes, all-tool barrier, A2UI action/surface round trip, all-31 baseline/error bytes, malformed tail after client failure, slow incremental capture/Stop cleanup and partial evidence; unsupported/blocked/timeout fallback, stale controller/update failure, exact scope, no worker persistence and zero example-only third-party requests. Native cancellation of both readers/producer must pass G-D03; ask if it fails.
- [x] T015 [US3] Add introduced DOM/worker typechecks, demo build/budget and packaging-isolation coverage to `scripts/ci.mjs` and `.github/workflows/ci.yml` using existing tooling/locks, keeping all prior gates and no PR deployment permissions; arrange package build before archive/isolation checks and fail missing output/empty tests. Document exact introduced commands/status in `docs/development.md`.
- [x] T016 [US3] Create main-only `.github/workflows/pages.yml` with validated demo artifact upload/deploy, researched SHA pins, configure-pages `origin`/`base_path` passed to the build, build contents-read (plus pages-read), deploy pages-write/id-token-write only, needs build, github-pages environment/output URL and serialized concurrency; optional manual trigger must refuse non-main. No automatic Pages enablement, package publishing/tag/release step or PR deployment.
- [x] T017 [US3] Document public URL, browser-local example provenance, startup opt-in/footer, localhost/CORS/local-network/IPv6 limits, worker failure/reload guidance, ordinary package isolation, embedding link and separate maintainer Pages authorization in `docs/public-demo.md`; run integrated acceptance from `specs/002-public-demo/quickstart.md` on owned implementation files and record real results in the P03 PR without changing shared planning artifacts.

**Acceptance:** Commands/matrix in [quickstart](quickstart.md), including both TS projects,
`node scripts/build-demo.mjs --outdir .build/public-demo --origin https://dogganidhal.github.io --base-path /agui-inspector/`,
`node scripts/bundle-budget.mjs --dir .build/public-demo`, `npm run test:unit -- tests/demo`,
`npm run test:e2e -- tests/e2e/public-demo tests/e2e/visitor-policy`,
`npm run build && npm run check:bundle`, `npm run package:python`, existing uv distribution
tests and `npm run check:ci`. Both full sets meet strict budgets and actual package archives
exclude demo; native worker first-load/bytes/abort and fallback pass. Workflow review passes;
G-D04 is still maintainer authorization, not permission to deploy from the implementation PR.
Inherited physical 5,000-frame responsiveness remains separate maintainer evidence.

## Requirement coverage

| Refs | Slice / executable coverage |
| --- | --- |
| FR-001 | P03 T011/T012/T014/T016 |
| FR-002/FR-003 | P02 T006-T010; P03 T014 real browser proof |
| FR-004 | P02 T009; P03 T014 |
| FR-005/FR-016 | P01 T003; P03 T011/T014 |
| FR-006 | P02 T008/T010; P03 T012/T014 |
| FR-007/FR-008 | P01 T001/T002/T005 |
| FR-009 | P01 T001/T002/T004/T005; P03 T011 |
| FR-010/FR-011 | P01 T002/T005; P02 T008/T010; P03 T014 |
| FR-012/FR-013 | P03 T012/T013/T015 |
| FR-014 | P03 T015/T016 |
| FR-015 | P03 T011/T017 |
| FR-017 | All prerequisite/ownership/stacking rules; P03 T016 excludes publishing |

## Dependencies, parallel examples and delivery strategy

```text
main after W3 D01 + D02 + D03
  P01 visitor-policy -------+
                           +--> P03 demo-pages-delivery
  P02 shared-demo-endpoints +
```

US2 can be implemented/tested through P01 while US1 producer/adapter work proceeds in P02;
T009 config is independent of producer/worker implementation after P02 prerequisites. US3
workflow/docs drafting can run alongside P03 browser work once its slice dependencies are met,
but artifact acceptance and deploy readiness wait for all introduced checks.

Deliver/test P01 and P02 independently, merge, then integrate P03. Every worker owns only its
listed exact paths. Setup/foundation is inherited; polish/cross-cutting validation/documentation
is T013-T017 inside P03, not additional slices. No optional abstraction or "later" scaffold.

**Count:** 17 tasks: US1 8, US2 4, US3 5. Every task has checkbox, unique ID, story and exact
path(s); all requirements/stories map to acceptance. No extension hooks exist.
