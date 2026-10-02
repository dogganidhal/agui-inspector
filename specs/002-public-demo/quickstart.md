# Validation guide: Public demo

**Status**: Implementation acceptance commands, not evidence run by this planning PR.
Run on main after W3 D01/D02/D03 and the responsible W4 slice(s) merge. No live Pages deployment
or publishing is needed for local acceptance.

## Prerequisites

Node >=24, existing exact locks (`npm ci --ignore-scripts`), uv for existing Python package checks,
and installed Playwright Chromium (`npm exec -- playwright install chromium`). Install dependencies
only when required by the command/environment; never enable npm lifecycle scripts. No models,
API keys or remote example servers.

Set `SPECIFY_FEATURE_DIRECTORY=specs/002-public-demo` for Spec Kit commands. Stay on the dispatched
branch; feature scripts must not create/switch branches.

## P01 policy acceptance

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/hosted packages/inspector/tests/runtime
npm run test:e2e -- tests/e2e/visitor-policy
```

Expect: absent/false option retains fixed allowlist; wrong type/embedded presence fails startup.
Opt-in plus out-of-bound fixed HTTP origins fails startup; constructed policies cannot bypass it.
Opted-in HTTPS unlisted targets and localhost ports reach real CORS-permitting endpoints without
inspector prompts, no cookies; schemes/userinfo/redirects/non-loopback HTTP fail before requests.
All caller classes (config/capability/preparation/run/raw) share the predicate. Footer changes
only with policy; ordinary root auto-mount and config semantics remain intact.

Chromium tests re-prove exact IPv4 CSP support. Manually record Firefox/Safari versions,
localhost/IPv4 at non-default ports, CORS/local-network permissions and success/failure. Do not
advertise `[::1]` or add all-http CSP; localhost is the documented local URL. Browser permission
prompts are outside the inspector's "no endpoint approval prompt" guarantee.

## P02 pure scenario / worker acceptance

```sh
npm run typecheck
npm exec -- tsc -p demo/tsconfig.worker.json
npm run test:unit -- tests/demo/scenarios.test.ts tests/demo/worker.test.ts packages/inspector/tests/foundation/reference-agent.test.ts packages/inspector/tests/runtime packages/inspector/tests/frames packages/inspector/tests/a2ui
```

Expect: existing Node fixture routes/statuses/CORS/recorded ordering/failures/held-stream counters
remain unchanged. Compare shared default bytes to prior fixtures (baseline and run-error cover
all 31 types); input-ID generation occurs at source, not postprocessing. Worker adapter tests
prove exact reserved routing, methods, malformed JSON/missing-ID status and no unrelated interception/
network forwarding/storage/header reads. Pure tests do not claim a browser controller or abort proof.

## P03 integrated demo build / browser checks

```sh
npm exec -- tsc -p demo/tsconfig.json
npm exec -- tsc -p demo/tsconfig.worker.json
node scripts/build-demo.mjs --outdir .build/public-demo --base-path /agui-inspector/
node scripts/bundle-budget.mjs --dir .build/public-demo
npm run test:unit -- tests/demo
npm run test:e2e -- tests/e2e/public-demo tests/e2e/visitor-policy
```

The E2E harness serves isolated output under `/agui-inspector/` with actual native service workers
(not request stubs for example endpoints) and a fresh browser context. It also serves real local
visitor endpoints with controlled CORS; simulated browser API failures may test unavailable UX.
No Pages deployment is required.

| Scenario | Required evidence |
| --- | --- |
| First visit / existing controller | Preparing status then matching worker control/version <=10 seconds; first example succeeds without manual reload; exactly one app mount. |
| Plain / preparations | Recorded ordered PUT session/POST warm requests followed by POST run and exact shared response bytes. |
| Interrupt | All interrupts resolved together and separately cancelled; next request matches normal resume contract. |
| Tools | No early run on subset replies; all results recorded in next run. |
| Slow / stop | Incremental response visible before close; Stop aborts both client/recorder branches, native producer cleanup observed, partial evidence retained, no invented terminal frame. |
| State / broken | Snapshot/delta applied; invalid JSON/sequence evidence and all later bytes retained despite client failure. |
| A2UI | Existing form rendered; edit/action records forwarded envelope in a new run and continuation surface changes; remote assets/catalogs remain blocked. |
| Baseline / run-error | All 31 original event types retained; mixed delimiters/split Unicode byte equality and original-vs-expanded distinction. |
| Worker unsupported / blocked / timeout | Clear unavailable reason <=10 seconds, no example POST to Pages, own-server and import still work; no fake transport/auto-reload/replay. |
| Scope and network | Config/preparations/worker under base path; unrelated paths/assets/visitor endpoints untouched; zero third-party requests on example-only fresh use. |
| Privacy | Hosted cookies omitted; no worker storage/cache/session/header persistence; credential echo unchanged with export warning, existing D03 regression retained. |
| Embedding link | Native accessible link to repository docs/embedding.md; explicit navigation only, no prefetch/external asset request. |

Compare complete bytes/order and progressive delivery, not a browser's coalesced chunk boundaries
or fixed wall-clock timing. G-D03 stays blocked if native stop fails; do not patch the recorder
or introduce a transport replacement without coordinator approval.

## Standard distributions / final CI

```sh
npm run build && npm run check:bundle
npm run package:python
uv sync --project packages/python --locked --extra embedded --group test
uv run --project packages/python python -m unittest discover -s packages/python/tests
npm run check:ci
```

Expect both budgets pass independently at <=2,000,000 raw/minified and <=600,000 deterministic
gzip bytes. `tests/demo/build.test.ts` creates an npm archive in an isolated temporary directory
using `npm pack --ignore-scripts`, opens it and the built Python wheel, and rejects demo assets/
worker registration in ordinary dist/npm/wheel. It checks ordinary asset hashes are unchanged by
the demo build. Tests clean their own named temporary output, never workspace-wide directories.

The CI runner includes both demo TypeScript projects/build/budget/package-isolation tests once
introduced. Empty selectors/missing output are failures. Existing 5,000-frame fixture checks and
headed physical M2 responsiveness evidence remain the MVP release gate; portable CI is not that
certification.

## Pages review / deployment authorization

Review `.github/workflows/pages.yml`: only main push or main-guarded manual trigger, SHA pins from
research, build contents-read, deploy pages-write/id-token-write, build dependency, github-pages
environment/output URL, isolated artifact directory and serialized deployment. Existing PR CI
never deploys or receives Pages privileges.

G-D04 requires maintainer enabling Pages Actions source/environment protection separately.
Do not change settings, deploy, publish packages, tag or release during planning/validation.
