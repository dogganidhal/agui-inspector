# MVP validation quickstart

## Current planning checkout

Only specifications and design artifacts exist now. The implementation commands below are
acceptance targets for W1/W2, not claims of commands already present or runtime checks already
passed. No package installation, license creation, publication, tags or releases are needed here.

From the repository root:

```sh
export SPECIFY_FEATURE_DIRECTORY=specs/001-inspector-mvp
.specify/scripts/bash/check-prerequisites.sh --json
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
git diff --check
```

Expected: the feature directory resolves explicitly despite the nonnumeric Git branch, plan/tasks
and design artifacts are found, and whitespace checks pass. Review [plan gates](plan.md#open-decision-and-approval-gates)
at G1, particularly the unresolved raw/auth-echo conflict; runtime compliance cannot be asserted yet.

## Future implementation prerequisites and commands

Node 24 LTS/npm, uv, Python 3.10+ and the exact Playwright browser from the plan. Install npm
dependencies only through the committed lockfile with lifecycle scripts disabled. Python embedding
dependencies are an optional extra; the served application itself needs no Node after wheel install.
F01/F02 define these scripts; F03 adds budget/benchmark scripts and L06 adds Python packaging.

```sh
export SPECIFY_FEATURE_DIRECTORY=specs/001-inspector-mvp
npm ci --ignore-scripts
npm run typecheck
npm run test:unit
npm run build
npm run check:bundle
npm exec playwright install chromium
npm run test:e2e
npm run test:benchmark
uv sync --project packages/python --locked --extra embedded --group test
uv run --project packages/python python -m unittest discover -s packages/python/tests
npm run package:python
```

`test:unit` explicitly compiles TS then invokes `node --test`; `test:e2e` starts its own local
static server/reference agent through Playwright, with cleanup. `test:benchmark` verifies counts/
hashes and reports timing; release threshold certification also requires the named physical runner.
`package:python` builds the static assets first, copies/checksums the same assets, then invokes
`uv build --project packages/python`. No command publishes or requires tag creation.

## Acceptance scenarios

| Scenario | Exercise | Required result |
| --- | --- | --- |
| US1 live inspection / SC-001 | Select permitted hosted reference endpoint; capture valid, malformed, unknown, fragmented, interleaved and missing-terminal fixtures | All evidence retained in order with offset/verdict; sequence/terminal findings separate; original client bytes unchanged; visible transport errors |
| US1 uncommon types / SC-003 | Run each of the 31 named fixtures and every reference family; toggle filters/copy/expansion | Frame view for each; specified conversation mapping, chunks beside expansions, opaque encrypted data, nested subagent markers, steps/durations |
| US1 controls | Stop midstream; start a new thread; use quick message | Partial prior capture preserved, no synthetic terminal event, new identifiers/current state reset, ordinary quick-message path |
| US2 embedding / SC-002 | Enable in Starlette and FastAPI, then disable; use custom path | Default page/config/assets and configured agents work with host auth; disabled mounts zero routes; enabled warning includes path |
| US2 distribution | Install built wheel in a Python-only environment; serve npm static path from another local server | Assets present without Node/download, same hashes in both artifacts, no JS helper or CLI required |
| US3 replies / SC-004 | Resolve and cancel multiple interrupts; enter only one of several tool results, then all; stream arguments and results | No premature continuation; precise upstream resume/tool messages; all preparations and resulting input inspectable |
| US3 A2UI / SC-004 | Render v0.9 surface/update and activate control; repeat renderer-disabled | Correct envelope/context/timestamp in next prepared run, no third-party resources; disabled/unknown content remains JSON |
| US4 presets | Edit text/JSON/default/built-in variables; whole-value JSON substitution; full/turn selection; fail preparation on continuation | Correct types/precedence, ordered recorded preparations; failure sends no run and shows explicit error |
| US4 profiles / SC-005 | Change every switch; save/reload; JSON export/import; change targets | Next recorded input reflects setting; profile restored; auth absent from saved/exported data and cleared on reload/target change |
| US4 capabilities | Load inline and permitted URL declarations; contradiction fixture | Eleven groups visible; observed events retained independently, no invented discovery/consistency finding |
| US5 raw / SC-006 | Send `{"threadId":17}` with deliberate whitespace from raw editor; also submit syntactically invalid JSON | Schema-invalid document flagged and exact text sent; server error shown; syntax error visible and not sent; no preset/conversation mutation |
| US5 state | Snapshot/delta/messages snapshot; invalid patch | Current valid state carried to next run, operations inspectable; visible transcript replacement marker/added-removed messages; invalid update preserves evidence and shows error |
| US5 recordings / SC-007 | Export after warning, import, compare raw strings/order/timing/input; attempt corrupt/header-bearing file | Round trip exact; zero headers; no auth state; import sends zero requests; failed import visible and preserves old session |
| Privacy / SC-008 | Observe all requests during config/capability/preparation/run/rendering; attempt disallowed URLs/redirects and blocked CORS | Only explicit targets and own origin; zero telemetry/third-party assets; hosted no cookies; denied requests visible; CSP active before boot/no eval |
| Performance / SC-009 | Production build, fixed 5,000-frame profile, one warm-up plus three measured runs | Exact retained counts/hashes; each measured class >=95% within 200 ms; complete asset totals <=2,000,000 and <=600,000 gzip bytes |
| Theming / SC-010 | Open the F06 fixture page and the assembled app with default tokens, then with a stylesheet that overrides only `--agui-*`, in light and dark | Every view and primitive uses the overrides; no colors, radii or fonts outside the tokens; zero font or other third-party requests |

Tests use synthetic payloads and entered synthetic credentials; do not upload recordings or
request bodies to external tools. Authentication echo acceptance remains blocked on G-07; the
checks above do not silently resolve it.

## Integrated-main checkpoint

Each W2 lane runs its owned module/UI tests with the F01 contracts and scripted collaborators.
After all seven lanes merge to main, run every scenario together with no unimplemented feature
skips, then compare packaged assets and run the hardware benchmark. Missing suites or unavailable
hardware are pending checks, not passing checks. Record integration gaps for the user at G-08;
no extra wave/PR is authorized automatically, and publishing remains behind G-01/G-02 and FR-040.
