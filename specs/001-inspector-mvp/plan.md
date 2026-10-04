# Implementation Plan: inspector 0.1.0 MVP

**Branch**: `mvp/w3-d00-record-release-decisions` | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-inspector-mvp/spec.md`, constitution 1.0.3, roadmap, repository PR template,
and maintainer-approved release decisions of 2026-10-02. W1/W2 are implemented on main (PRs #3-#18).
`agui-inspector` is the approved npm/PyPI name; neither was registered on 2026-10-02.
Spec Kit's directory override reports `001-inspector-mvp` as its feature identity.

## Summary

Deliver one static HTTP/SSE inspector for hosted use, Python Starlette/FastAPI embedding, and
static serving by other servers. Keep the wire in a framework-free TypeScript recorder, incremental
frame reader, findings, and session store; use the protocol's `HttpAgent` for derived conversation
and state, React for views, and the official A2UI v0.9 renderer. All five stories are required;
priority orders delivery rather than cutting scope.

No CLI/proxy, in-app element, JS server helpers, non-SSE transports, plugins, conformance tooling,
replay, automatic replies, Markdown conversation rendering, stable-v1 formats, or release operations
are included in this decision-recording PR. W3 D01 implements the approved MIT LICENSE and notices;
publication, tags and releases remain unauthorized, manifests remain private, and G-03 stays open.

## Technical Context

| Item | Concrete choice |
| --- | --- |
| Language/runtime | Strict TypeScript; Node 24 LTS for tooling; Python >=3.10, tested at 3.10 and 3.14 |
| Runtime dependencies | Exact pins and purposes in [research](research.md#protocol-and-renderer-packages); core/client 1.0.1, A2UI renderer/core 0.12.0 with `/v0_9` imports, React/DOM 19.3.0, middleware 0.0.11, Zod 3.25.76 |
| Build | esbuild 0.28.2, one production static asset set, npm workspaces/lockfile, uv Python builds/lockfile |
| Storage | In-memory sessions/credentials; browser localStorage for version-0 profiles and the light or dark theme choice only; explicit local JSON import/export; no backend storage |
| Testing | Compiled TypeScript with `node --test`; Playwright 1.63.0; Python `unittest`; deterministic model-free reference agent |
| Target | Modern browser with Fetch streaming, TextDecoder, AbortController, CSP; Starlette/FastAPI embedding; static hosted deployments with explicit allowlist |
| Performance | 5,000 original retained frames, >=95% of filters and >=95% of raw expansions visibly complete within 200 ms in the fixed profile |
| Budget | Entire production client <=2,000,000 minified bytes and <=600,000 gzip bytes, including renderer and all shipped client assets |
| Scale | Local single-user inspection; ten benchmark exchanges; all 31 baseline event types and malformed evidence |

Dependency additions include purpose/stdlib alternative in `docs/dependencies.md`, use exact
manifest versions and committed locks, and install without lifecycle scripts. Compatibility/budget
failures stop the affected PR; no baseline downgrade or budget exception is pre-approved.

## Constitution Check

Pre-research and post-design assessments use the same rows below. A design PASS means the proposed
architecture satisfies the principle; it does not certify unbuilt runtime behavior.

| Principle/constraint | Pre-design | Post-design | Evidence, justification, or gate |
| --- | --- | --- | --- |
| I. Wire comes first | PASS | PASS | F04/F05 preserve original response and raw frame text/order/time, including target-supplied credential echoes; no redaction or fabricated terminal events. D03 proves echo retention end to end. |
| II. Protocol, not framework | PASS | PASS | Required upstream packages; framework-free core; React only in views; explicit raw/expanded/client-derived separation; A2UI `/v0_9`. |
| III. Generic core/presets | PASS | PASS | L01 templates/preparation/input composition; no server-specific branches; preparation errors prevent run dispatch. Plugins excluded. |
| IV. Local/privacy | PASS | PASS | Constitution 1.0.3 clarifies inspector-held credentials remain memory-only and are never written by the inspector; target evidence is unchanged with export warning. No recorder header access/export headers; allowlist/CSP unchanged; hosted no cookies or server-side sessions. D03 regression pending, not a policy block. CLI clauses N/A. |
| V. Small/auditable | PASS | PASS | Exact pins/locks, no lifecycle installs, native primitives and CSS theming. D01's exact dompurify 3.4.16 root override/lock is a documented upstream-pin exception, removed when A2UI fixes its pin. |
| VI. Every event view | PASS | PASS | 31 named fixture cases; L03/L04/L05 frame/conversation mapping, original chunks plus derived expansions; encrypted values never decoded. |
| Architecture/distribution | PASS | PASS | Same bundle in static/npm/wheel; explicit Python enable switch/warning; strict TS/React/esbuild/node tests/Playwright/uv; optional Starlette; no excluded modes. |
| Workflow/quality | INCOMPLETE: 50,000-frame criteria were missing | PASS planning criteria, execution pending | Measurable 5,000- and 50,000-frame profiles/thresholds/methods are now defined below; only 5,000-frame implementation/testing belongs to MVP tasks. F02 establishes required CI; absent infrastructure and unrun workloads are not counted as passed. |
| Release/version governance | PASS | PASS with release blocked | Pre-stable version-0 local formats and migration docs; FR-040 provenance/trusted-publishing requirements preserved as documented gates; no publication/tags. Stable-v1 and 1.0.0 audits deferred. |

**Maintainer resolution, 2026-10-02:** G-07 is closed by constitution PATCH 1.0.3; G-08 is closed
without an extra integration PR. Exactly three W3 follow-up PRs are authorized below.
There are no constitution violations or approved complexity exceptions; the DOMPurify override
changes an upstream dependency pin, not principle V's exact-pin/lockfile rule.

## Open-decision and approval gates

All gate statuses are recorded below; G-03 through G-06 remain open.

| Gate | Status / decision | Remaining work or block | Decision owner |
| --- | --- | --- | --- |
| G-01 license | CLOSED: MIT; Copyright (c) 2026 Nidhal Dogga | D01 ships LICENSE and third-party notices in npm/wheel, including Apache-2.0 texts and any NOTICE for @a2ui/react, @a2ui/web_core, @a2ui/markdown-it; publishing still unauthorized under FR-040 | Project maintainer, 2026-10-02 |
| G-02 package-names | CLOSED: agui-inspector on npm and PyPI, both unregistered on 2026-10-02 | @ag-ui/inspector remains conditional on upstream adoption (G-03); no registration/publication authorized | Project maintainer, 2026-10-02 |
| G-03 upstream-placement | Whether upstream accepts `apps/inspector`, and when | Upstream submission/relocation/namespace commitments, not local MVP implementation | Project maintainer/user and upstream maintainers |
| G-04 capability-discovery | Whether/when the protocol defines discovery | Any discovery beyond inline/configured URL | AG-UI protocol maintainers define mechanism; project maintainer selects future scope |
| G-05 websocket-push | Protocol-defined WebSocket/push semantics | These transports and notifications; no inferred contract from capability names | AG-UI protocol maintainers, then project maintainer for a later release |
| G-06 in-app-isolation | Element isolation with document-injected A2UI styles; unresolved shadow-root integration | In-app element/style architecture | Project maintainer/user after renderer integration research |
| G-07 echoed-credentials | CLOSED: adopt candidate, constitution 1.0.3 PATCH; inspector-held credentials isolated, target bytes unchanged, no redaction | D03 echo regression completes SC-008 credential acceptance; policy no longer blocks slices | Project maintainer, 2026-10-02 |
| G-08 post-W2 integration acceptance | CLOSED: no extra integration PR; checkpoint 13 pass, 1 fail (F-01 embedded config path, fixed by #18), 2 pending | SC-008 credential part goes to D03; SC-009 physical M2 runner is run by maintainer | Project maintainer, 2026-10-02 |
| G-09 theme-delivery | CLOSED: config.json theme with optional light/dark maps of documented public --agui-* names | D02 validates/applies in every MVP mode and Python helper; visible nonfatal warnings for invalid names/unsafe values, unchanged CSP | Project maintainer, 2026-10-02 |

G-07 **candidate adopted**: principle IV and FR-036 cover credentials the inspector holds.
Entered tokens stay in memory; the inspector never writes them to configuration, browser storage,
recordings, views, logs or exports, and the recorder never reads headers. Target bytes are evidence
under principle I/FR-008 and remain unchanged even when they echo credentials. Export retains its
sensitive-data warning. No redaction anywhere. Constitution 1.0.3 records rationale, affected
sections, compatibility impact and D03 follow-up; ratification is unchanged.

**G-07 formerly blocked checks, now resolved:** F04/F05 and L02-L07 retain all target evidence,
including echoes, while excluding inspector-held auth from their own writes. FR-008/FR-036 no
longer conflict. Header isolation/absence, token clearing, credential-free config/profile storage
and export warnings remain required. D03 proves the byte-identical echoed frame, warning and
absence of the entered token from configuration, browser storage, exported headers and request
recordings; until that regression passes, the SC-008 credential part is pending, not blocked policy.

G-08 records the integrated-main checkpoint: 13 pass, 1 fail (F-01 embedded config path, fixed by
PR #18), 2 pending (SC-008 credential part, D03; SC-009 physical M2, maintainer).
No extra integration PR is authorized. Release verification still requires SC-009 on that runner,
a manual smoke run in all MVP distribution modes, and publishing authorization/safeguards.
FR-040 remains unchanged: reviewed tag-CI builds, npm provenance and PyPI trusted publishing.

## Architecture and interface boundaries

1. A guarded transport owns URL policy, redirect rejection, same-origin/omit cookies, and volatile
   auth injection. Auth never enters recorder snapshots, profile/config state, client debug logs,
   or exception diagnostics. URL userinfo and auth-bearing configuration are rejected.
2. The recorder receives request metadata/body without consulting request or response headers.
   Request kind tells it whether to read SSE or a normal response body; it records status and
   elapsed time, including non-2xx/transport failures. The original response goes to `HttpAgent`.
3. The frame reader keeps raw envelope text, decoded `data` text, index and monotonic offsets.
   JSON/schema errors attach findings without stopping its independent reader. EOF incomplete
   evidence is inspectable; no fake valid event is emitted.
4. The framework-free store retains exchanges, frames, run links, findings and derived snapshots.
   Views subscribe with notifications batched at most once per animation frame; capture appends
   immediately rather than dropping/coalescing evidence. Sequence errors from the client are run
   findings. Transport status and observed protocol outcome are independent.
5. Conversation/state come from official client callbacks plus explicit event projection needed
   for uncommon events. Expanded chunks have source links and a derived label, never a raw-frame
   index. A projection error does not stop capture or erase the last valid derived state.
6. Presets build ordinary and continuation inputs; profiles override selected client settings.
   Ordered preparations precede every conversation dispatch; raw submissions bypass them.
   Resume waits for every interrupt answer; tool continuation waits for every result.
7. React entry modules assemble settings, run controls, frames/raw/session views, conversation,
   capabilities/state, and the v0.9 renderer. Native editors/buttons and accessible names/keyboard
   focus suffice; no theme/framework dependency is required. Views style only through F06's plain-CSS
   `--agui-*` tokens and shared primitives, specified in [design/design.md](design/design.md).
8. Every MVP mode loads `config.json`; its optional `theme.light`/`theme.dark` maps override only
   the ten documented public names. Reject unknown/private names and unsafe values with visible
   nonfatal configuration warnings. At minimum deny case-insensitive `url(`/`image-set(` including
   whitespace before `(`, `@`, `;`, `{`, `}` and backslash escapes; values cannot request resources
   or escape declarations. Apply light/dark selection without changing the CSP. The Python helper
   accepts the same field. Scope generic derived tokens to the inspector mount root, including
   dialogs/popovers in its subtree; they must not overwrite/inherit host generic tokens.

Public contracts are in [contracts/mvp.md](contracts/mvp.md); entities and provenance distinctions
are in [data-model.md](data-model.md). F01 defines the concrete shared TypeScript boundary types
and fixed entry exports that W2 owns. Scaffold entry points explicitly render "not implemented"
and disable unsupported actions rather than claiming success. These are temporary required
scaffold surfaces, not a plugin registry. W2 lanes replace only their owned entry points.
L07 owns the single static application assembly and its tests, with contract-level scripted
collaborators while other lanes are in progress; complete cross-lane acceptance waits for integrated
main. No W2 lane imports another's internal files, edits another's paths, or silently changes
the frozen contracts.

## Fixed 5,000-frame benchmark

**Runner:** dedicated Apple Mac mini M2 (8 CPU cores, 16 GB RAM), macOS 15.7, plugged in, no CPU/network
throttling or concurrent workloads. Headed Chromium **153.0.8010.12**, Playwright **1.63.0**, Chromium
revision **1243**; viewport 1440x900, device scale 1, foreground window, fresh browser context,
no extensions, production build and full bundled A2UI renderer. Serving page and reference agent
on two loopback origins with explicit CORS/allowlist permission isolates browser-to-SSE behavior.
Record actual hardware/OS/browser versions with each result; a different machine/browser is not
the release measurement. CI runs the same data but cannot certify this hardware threshold.

**Arrival:** ten sequential conversation exchanges, 500 original data frames per exchange,
50 frames/second for 100 seconds total; first/last events are the exchange's run boundaries.
Eight runs finish (including success, interruption and cancellation outcomes), two end with
`RUN_ERROR`. The capture branch continues through invalid frames even if the protocol client
terminates processing. Counts below count original wire data frames only, never chunk expansions.

| Type | Count | Payload content size before JSON/SSE envelope |
| --- | ---: | --- |
| RUN_STARTED | 10 | Fixed identifiers and required fields, <=1 KiB |
| RUN_FINISHED | 8 | Required outcome/result/interrupt fields, <=2 KiB |
| RUN_ERROR | 2 | Fixed error code plus 128-byte message |
| STEP_STARTED | 100 | Fixed 32-byte name |
| STEP_FINISHED | 100 | Matching fixed 32-byte name |
| TEXT_MESSAGE_START | 120 | Fixed identifiers/role, <=1 KiB |
| TEXT_MESSAGE_CONTENT | 2200 | 128-byte UTF-8 delta |
| TEXT_MESSAGE_END | 120 | Fixed identifiers, <=1 KiB |
| TEXT_MESSAGE_CHUNK | 200 | 512-byte text payload |
| TOOL_CALL_START | 60 | Fixed ids/name, <=1 KiB |
| TOOL_CALL_ARGS | 400 | 256-byte argument fragment; combined arguments form valid JSON |
| TOOL_CALL_END | 60 | Fixed identifiers, <=1 KiB |
| TOOL_CALL_CHUNK | 80 | 1,024-byte complete argument JSON |
| TOOL_CALL_RESULT | 60 | 2,048-byte result string |
| REASONING_START | 40 | Fixed identifiers, <=1 KiB |
| REASONING_MESSAGE_START | 40 | Fixed identifiers, <=1 KiB |
| REASONING_MESSAGE_CONTENT | 600 | 128-byte UTF-8 delta |
| REASONING_MESSAGE_END | 40 | Fixed identifiers, <=1 KiB |
| REASONING_MESSAGE_CHUNK | 60 | 512-byte text payload |
| REASONING_END | 40 | Fixed identifiers, <=1 KiB |
| REASONING_ENCRYPTED_VALUE | 20 | 4,096-byte opaque value; never decoded |
| STATE_SNAPSHOT | 20 | 16,384-byte valid state JSON |
| STATE_DELTA | 200 | 2,048-byte valid JSON Patch operations |
| MESSAGES_SNAPSHOT | 20 | 16,384-byte valid message array JSON |
| ACTIVITY_SNAPSHOT | 40 | 16,384-byte activity JSON; 20 A2UI v0.9, 20 ordinary |
| ACTIVITY_DELTA | 180 | 2,048-byte valid activity-patch JSON |
| SUBAGENT_STARTED | 20 | Fixed linked ids, <=1 KiB |
| SUBAGENT_FINISHED | 15 | Matching linked ids/result, <=2 KiB |
| SUBAGENT_ERROR | 5 | Matching linked ids plus 128-byte message |
| CUSTOM | 20 | 4,096-byte valid JSON value |
| RAW | 20 | 4,096-byte valid JSON value |
| Non-JSON | 40 | Exactly 1,024 bytes of malformed JSON/text data |
| Unknown type | 30 | Exactly 1,024 bytes of JSON with an unrecognized type |
| Known type/schema-invalid | 30 | Exactly 1,024 bytes of JSON with a wrong required field type |
| **Total** | **5000** | 4,900 schema-valid frames, 100 invalid/unknown |

The deterministic generator uses seed `001`, fixed-length identifiers and repeated synthetic text,
and pads only schema-permitted payload values to the stated UTF-8 sizes; lifecycle envelope sizes
are bounded above, not artificially padded. F03 commits the ordered fixture manifest with counts,
exact serialized payload/envelope byte lengths and SHA-256 of each exchange. Event lifecycles remain
valid apart from the specified invalid frames; interleave two live messages and streamed tool
arguments. Ten extra sequence-invalid and missing-terminal fixtures are separate correctness tests,
not replacements for the benchmark's ten terminal events.

SSE uses LF for 60%, CRLF for 30%, and CR for 10% of framed envelopes (counts 3000/1500/500).
Every tenth schema-valid frame uses two `data` lines split at schema-safe JSON whitespace. The server emits byte
chunks cycling through 1, 7, 64, and 4096 bytes across each scheduled frame's envelope, exercising
delimiter and multibyte boundaries; it flushes each scheduled frame without compressing/coalescing
the timed schedule. Fragmented/coalesced cases also have separate fast correctness fixtures.
Offsets use `performance.now()` relative to request dispatch, at completion of each raw envelope,
not simulated protocol timestamps.

**Interaction schedule:** start at t=20 seconds, dispatch one trusted Playwright interaction every
400 ms through t=99.6: 100 filter changes alternating with 100 raw-frame expansions. Filter changes
cycle 34 type selections, 33 substring searches and 33 issue toggles. Expansion selections cycle
normal, malformed, and 16 KiB payload frames that have already arrived; scroll the chosen row into
view before timing. Filtering and expansion remain keyboard-accessible. The final 50 interactions
occur with at least 4,000 retained frames. Do not pause capture, replace the full data set with
rendered rows, or exclude slow measurements.

**Measurement:** timestamp the actual browser input handler, identify the resulting filter/expansion
generation, and record completion after React commits the expected matching list/raw text and the
following paint opportunity (double `requestAnimationFrame`), checking visible DOM content in
Playwright. Include parsing and UI scheduling, not just reducer time. Collect 100 samples per class,
separate p95/maximum and percentages <=200 ms, plus raw retained count/hash, actual arrival timing,
and peak heap as diagnostic (no invented memory threshold). Report three complete measured runs
after one identical warm-up. Each measured run requires >=95/100 filters and >=95/100 expansions
within 200 ms, with exactly 5,000 original frames and matching order/raw hashes. Failure or missing
hardware means SC-009 is not passed. Changing the profile needs explicit plan review before measuring.

**Bundle:** sum uncompressed production minified JS/CSS and every client-shipped runtime asset,
including all renderer code/chunks/local assets; sum each file's gzip size with fixed mtime=0.
Use decimal bytes and include files even when not exercised in the benchmark. Exclude source maps,
development fixtures, host-package code, duplicate copies of the same bundle in wheel/npm archives,
and documentation. F03 reports per-file and total bytes and fails above either limit; no renderer
exclusion or remote dependency is allowed.

## Defined 50,000-frame criteria: 1.0.0 only

These criteria satisfy the constitution's both-workloads planning obligation. They are a future
stable-release acceptance definition, **not MVP implementation, test tasks, or a measured pass**.
The 0.1.0 workload and SC-009 remain unchanged. Any future profile change requires explicit review,
not automatic substitution of newer hardware, browser or protocol fixtures.

**Profile:** use the same named Mac mini M2/16 GB/macOS 15.7 runner, headed Chromium 153.0.8010.12
revision 1243/Playwright 1.63.0, viewport, scale, loopback origins, production build and no-throttling
conditions defined above. Repeat the entire 5,000-frame mix ten times in one retained session,
rebasing all thread/run/message/tool/activity ids and parent links to avoid cross-cycle collisions.
This gives 100 sequential 500-frame exchanges at 50 original frames/second for 1,000 seconds:
49,000 schema-valid and 1,000 invalid/unknown frames, with every table row's count multiplied by
ten and identical per-type payload sizes. Keep all 31 types, fragment/multiline/interleaving rules,
80 RUN_FINISHED and 20 RUN_ERROR events. LF/CRLF/CR counts become 30,000/15,000/5,000. Freeze an
ordered serialized-size/hash manifest for this future workload before its implementation.

**Renderer assumption:** the stable-release A2UI renderer starts unloaded and loads only on first
enabled v0.9 surface use, with local assets/catalog and no third-party requests. Surface use occurs
before the measured interaction window; do not prefetch the renderer to bypass the on-demand
requirement. Record first-use load/render latency separately as a diagnostic. The responsiveness
criteria below measure inspection while the surface renderer is active, not a renderer-excluded
bundle or an unloaded synthetic UI.

**Interactions and metrics:** at t=920 seconds, with 46,000 frames retained, begin 200 trusted
interactions every 400 ms through t=999.6 seconds, alternating 100 filter changes and 100 raw
expansions. Use the same 34 type/33 substring/33 issue-filter schedule and normal/malformed/16 KiB
expansion selections as the MVP. The final 50 interactions occur with at least 49,000 retained
frames. Report per-class p95, maximum, percentage <=200 ms, frame count/order/raw hashes, actual
arrival timing and diagnostic peak heap. Do not pause capture, discard retained evidence, time
only visible-row subsets, or remove slow samples.

**Measurement and thresholds:** timestamp the actual browser input handler through the expected
React commit plus double-requestAnimationFrame paint opportunity, with Playwright-visible
list/raw-content verification; include parsing, filtering and scheduling. After one identical
warm-up, run three complete measured captures. **Each run must retain exactly 50,000 original
frames in manifest order with identical raw hashes, and at least 95/100 filters and 95/100 raw
expansions must finish visibly within 200 ms.** Reusing the MVP latency limit preserves the same
interaction responsiveness at tenfold retention; it is not a relaxed stable-release target.
Absent matching hardware, missing samples, hash/count mismatch or a failed class means the
50,000-frame criterion has not passed. No such run is implemented or executed by this MVP plan.

The stable-release WCAG 2.2 AA audit, all-mode/reference/conformance obligations and on-demand
renderer implementation remain future scope. Defining these criteria adds no 1.0.0 slice or
checklist task to [tasks.md](tasks.md).

## Project Structure

```text
specs/001-inspector-mvp/
  plan.md  research.md  data-model.md  quickstart.md  tasks.md
  contracts/mvp.md
  design/{design.md,prototype.html,screens/}
packages/inspector/
  src/contracts.ts
  src/core/{recorder,frames,store,config,presets,profiles,runtime,projection,a2ui,session-files}/
  src/views/{settings,connection,conversation,inspection,a2ui,theme}/
  src/app/
  public/
  tests/{foundation,recorder,frames,config,runtime,conversation,inspection,a2ui,hosted,theme}/
packages/python/
  pyproject.toml  uv.lock
  src/agui_inspector/
  tests/
examples/{reference-agent,fastapi}/
tests/e2e/{config,runtime,conversation,inspection,a2ui,python,hosted,theme}/
tests/benchmarks/
scripts/{build,test-build,bundle-budget,benchmark,package-python}.mjs
docs/{dependencies,development,distribution,configuration,conversation,inspection,a2ui,hosted,theming}.md
.github/workflows/ci.yml
```

Paths are prospective implementation paths, not files generated by this planning PR. No agent-context
updates or `.specify/feature.json` are needed or committed. [tasks.md](tasks.md) gives exact ownership
and acceptance; [quickstart](quickstart.md) distinguishes current planning checks from future commands.

## Delivery and validation

W1: F01 scaffold/contracts, F02 CI, F03 full bundle budget/benchmark fixture, F04 recorder, F05 reader/store,
F06 design foundation (tokens and view primitives).
Each depends only on its immediate predecessor and can be reviewed as an unstacked slice plus at
most its direct successor. Merge the current pair before opening another stacked pair.

W2: L01 configuration/presets/profiles, L02 transport/interactive runs (depends on L01 only),
L03 conversation/event projection, L04 frame/raw/session inspection and benchmark UI,
L05 A2UI, L06 Python/static distribution, L07 hosted app assembly. Start from merged W1 main;
L02 may stack only on L01. Owned paths are disjoint. Each lane provides unit and scoped end-to-end
checks using its contract seams; the assembled release's tests run again after all lanes merge.
Full-SC acceptance is pending rather than silently counted as passed during isolated development.

Missing infrastructure is W1 work. F02 runs all relevant checks as packages/tests appear, but explicitly
reports not-yet-introduced suites as pending. Release verification requires every suite, no empty-suite
or feature-skipped success. Local packaging/provenance checks and D01's approved license creation
are allowed; publishing, tags, releases, main pushes and merges remain unauthorized.

W3: D01 release-hygiene, D02 theme-delivery, D03 a2ui-catalog-and-credential-echo. Each is one PR
depending only on main after this decision PR, with disjoint exact ownership in [tasks.md](tasks.md).
D01 implements MIT/notices/metadata, exact DOMPurify 3.4.16 override and committed lock, Python
3.10/3.14 CI and benchmark-doc cleanup. D02 implements config theme delivery and root-scoped
derived tokens. D03 adds the single catalog-factory alias and credential-echo E2E regression.
The M4 Pro headless benchmark result is informational; headed M2 SC-009 certification remains
pending with the maintainer. No follow-up may publish, un-private manifests, tag, release or merge.

**Recorded development measurement (#14):** Apple M4 Pro, 12 cores/48 GiB, macOS 26.7.1,
headless Chromium 153.0.8010.12/Playwright 1.63.0; one warm-up and three measured runs. Each measured
run retained 5,000 frames in ten exchanges with matching hashes, completed 200/200 interactions,
and had 100/100 filters and 100/100 expansions within 200 ms (p95 31.0-32.6 ms; interaction lateness
p95 40-66 ms). This is not the specified M2 headed runner and does not pass SC-009. D01 records this
result in the stale benchmark docs; no profile substitution is authorized.

## Complexity Tracking

None approved. G-07/G-08/G-09 are resolved; G-03 through G-06 remain open. D01's documented
DOMPurify override is compatible with principle V, not a constitution exception.
