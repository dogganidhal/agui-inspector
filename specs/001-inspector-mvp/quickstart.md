# MVP validation quickstart

## Current integrated checkout

W1/W2 are implemented on main (PRs #3-#18). This PR records approved decisions only; D01-D03 below
implement their follow-ups. Commands exist, but this guide is not a claim that every release check
has passed. Publishing, tags and releases remain unauthorized; manifests stay private.

From the repository root:

```sh
export SPECIFY_FEATURE_DIRECTORY=specs/001-inspector-mvp
.specify/scripts/bash/check-prerequisites.sh --json
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
git diff --check
```

Expected: the feature directory resolves explicitly despite the nonnumeric Git branch, plan/tasks
and design artifacts are found, and whitespace checks pass. Review [plan gates](plan.md#open-decision-and-approval-gates)
for the resolved G-07 policy and remaining verification; policy approval is not runtime certification.

## Implementation prerequisites and commands

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
| US3 built-in catalog / SC-003, SC-004 | Use middleware 0.0.11 default `https://a2ui.org/specification/v0_9/basic_catalog.json`, then renderer basic id | Both resolve to bundled basic catalog; action round trip works; no fetch or raw-operation rewrite; other aliases remain unsupported |
| US4 presets | Edit text/JSON/default/built-in variables; whole-value JSON substitution; full/turn selection; fail preparation on continuation | Correct types/precedence, ordered recorded preparations; failure sends no run and shows explicit error |
| US4 profiles / SC-005 | Change every switch; save/reload; JSON export/import; change targets | Input-affecting settings change next recorded input; display-only renderA2ui does not, while injectA2uiTool changes tools; both persist/export; auth absent and cleared on reload/target change |
| US4 capabilities | Load inline and permitted URL declarations; contradiction fixture | Eleven groups visible; observed events retained independently, no invented discovery/consistency finding |
| US5 raw / SC-006 | Send `{"threadId":17}` with deliberate whitespace from raw editor; also submit syntactically invalid JSON | Schema-invalid document flagged and exact text sent; server error shown; syntax error visible and not sent; no preset/conversation mutation |
| US5 state | Snapshot/delta/messages snapshot; invalid patch | Current valid state carried to next run, operations inspectable; visible transcript replacement marker/added-removed messages; invalid update preserves evidence and shows error |
| US5 recordings / SC-007 | Export after warning, import, compare raw strings/order/timing/input; attempt corrupt/header-bearing file | Round trip exact; zero headers; no auth state; import sends zero requests; failed import visible and preserves old session |
| Privacy / SC-008 | Observe all requests during config/capability/preparation/run/rendering; attempt disallowed URLs/redirects and blocked CORS | Only explicit targets and own origin; zero telemetry/third-party assets; hosted no cookies; denied requests visible; CSP active before boot/no eval |
| Credential echo / SC-008 | Enter a synthetic token only in auth, capture a target's exact echo frame, export after warning | Frame byte-identical, no redaction; token absent from config, browser storage, exported headers and request recordings written by inspector auth state; sensitive frame remains in export |
| Performance / SC-009 | Production build, fixed 5,000-frame profile, one warm-up plus three measured runs | Exact retained counts/hashes; each measured class >=95% within 200 ms; complete asset totals <=2,000,000 and <=600,000 gzip bytes |
| Theming / SC-010 | Load config.json theme light/dark maps in hosted, Python embedded and generic static serving; switch modes; try private/unknown names, unsafe syntax and hostile host generic tokens | Every view/primitive uses public overrides; each rejected override gives visible nonfatal warning, no request, unchanged CSP; generic derived properties remain mount-root-scoped |

Tests use synthetic payloads and entered synthetic credentials; do not upload recordings or
request bodies to external tools. G-07 is resolved by constitution 1.0.3; D03 must prove the
credential-echo scenario rather than claiming it passed from policy approval.

## Integrated-main checkpoint

Each W2 lane runs its owned module/UI tests with the F01 contracts and scripted collaborators.
After all seven lanes merge to main, run every scenario together with no unimplemented feature
skips, then compare packaged assets and run the hardware benchmark. Missing suites or unavailable
hardware are pending checks, not passing checks. The checkpoint recorded 13 pass, 1 fail (F-01
embedded config path, fixed by PR #18), 2 pending (SC-008 credential part, D03; SC-009 physical
M2 runner, maintainer). G-08 is closed with no extra integration PR. The M4 Pro headless result is
informational, not headed M2 release certification. Release verification still requires that
physical run, a manual smoke in every MVP distribution mode, and publishing approval under FR-040.

## W3 follow-up checks

D01 checks local npm/wheel/sdist LICENSE/notices contents, MIT metadata, private publishing guards,
the exact DOMPurify 3.4.16 override/lock and Python tests on 3.10 and 3.14; it updates benchmark docs
with the M4 Pro headless result while leaving M2 certification pending.
D02 checks the theme/config scenarios above, including Python helper serialization.
D03 checks the built-in catalog and credential-echo scenarios. Each slice is one independent PR
from main after this decision-recording PR; [tasks.md](tasks.md) defines disjoint ownership.
