# Tasks: inspector 0.1.0 MVP

**Input:** [plan](plan.md), [spec](spec.md), [research](research.md), [data model](data-model.md),
[contracts](contracts/mvp.md), [validation guide](quickstart.md).

**Approval:** G1 must review the plan and resolve or explicitly disposition G-07/G-08.
No task chooses a license/name/upstream/discovery/transport/element decision, redacts received
frames, permits credential recording, publishes, creates LICENSE/tags/releases, or edits agent
context. `agui-inspector` remains a working name.

**G-07 hold:** G1 implementation approval is blocked for every F01-F05 and L01-L07 slice.
The conflicting raw/privacy acceptance in F04/F05 and L02/L03/L04/L05/L06/L07, full
FR-008/FR-036 sign-off and integrated SC-008 credential-exclusion check cannot pass for a
server-echoed token until the user resolves the guarantees. Non-conflicting header isolation,
no-header recording/export, volatile-token clearing, credential-free settings and export warnings
remain required; passing them does not clear the gate. Do not adopt the candidate interpretation
or implement redaction. The plan's 50,000-frame criteria define future 1.0.0 acceptance only and
add no implementation or test task here.

**Format:** Fxx/Lxx identifies a one-PR slice; Txxx identifies its executable checklist tasks.
`[USn]` identifies the story; `[P]` marks an independent task within an available slice, not permission
to ignore wave prerequisites. Foundation tasks have no story tag. User-requested waves and disjoint
ownership take precedence over the template's serial story phases; story goals/tests are retained
below. Tests are required by the spec/constitution, not optional polish.

## Wave W1: sequential setup and foundation

Exactly five one-PR slices. Direct prerequisites form the chain F01 -> F02 -> F03 -> F04 -> F05.
An unmerged stack is at most one slice plus its direct successor: merge that pair before starting
the next pair. A slice inherits previously merged work but names only its immediate predecessor.
All W1 must be merged to main before any W2 lane starts.

### F01 scaffold-contracts

**Refs:** FR-001, FR-012, FR-031, FR-036, FR-040; US1, US2, US3, US4, US5 (shared foundation).
**Depends on:** none. **Goal:** buildable strict scaffold and concrete public seams, no speculative modes.
**Owned paths:** `package.json`, `package-lock.json`, `.npmrc`, `tsconfig.json`, `playwright.config.ts`,
`packages/inspector/package.json`, `packages/inspector/tsconfig.json`,
`packages/inspector/src/contracts.ts`, `packages/inspector/src/static-path.js`,
`packages/inspector/src/app/index.tsx`, `packages/inspector/src/app/index.html`,
`packages/inspector/src/views/settings/index.tsx`, `packages/inspector/src/views/connection/index.tsx`,
`packages/inspector/src/views/conversation/index.tsx`, `packages/inspector/src/views/inspection/index.tsx`,
`packages/inspector/src/views/a2ui/index.tsx`, `packages/inspector/tests/foundation/**`,
`scripts/build.mjs`, `scripts/test-build.mjs`, `examples/reference-agent/server.ts`,
`docs/dependencies.md`, `docs/development.md`.

- [ ] T001 Set npm workspace/private working-name metadata, exact researched dependencies, committed lockfile, strict TS and disabled install lifecycle scripts in `package.json`, `package-lock.json`, `.npmrc`, `tsconfig.json`, `packages/inspector/package.json` and `packages/inspector/tsconfig.json`; document every direct dependency's purpose and rejected platform alternative in `docs/dependencies.md`.
- [ ] T002 Freeze framework-free entity/service/UI boundary types from the contracts in `packages/inspector/src/contracts.ts`; auth state is not a persisted/session field, JSON is nonexecutable, transport and observed outcome are separate, and raw/derived provenance is explicit.
- [ ] T003 Build fixed React entry exports and visible disabled/unimplemented scaffold surfaces in the five `packages/inspector/src/views/*/index.tsx` paths and `packages/inspector/src/app/index.tsx`; use external scripts in `packages/inspector/src/app/index.html`, no plugin registry or false successful action.
- [ ] T004 Prove pinned core/client 31 types, fetch hook, sequence reporting/recording lifetime, resume/cancel input shapes, middleware tool and v0.9 renderer integration in `packages/inspector/tests/foundation/compatibility.test.ts`; a mismatch blocks implementation rather than changing the baseline.
- [ ] T005 Implement explicit esbuild/test compilation and path-selector support in `scripts/build.mjs` and `scripts/test-build.mjs`, static asset location export in `packages/inspector/src/static-path.js`, and a loopback model-free fixture server in `examples/reference-agent/server.ts`; configure Playwright in `playwright.config.ts` and commands in `docs/development.md`.

**Acceptance:** `npm ci --ignore-scripts`, `npm run typecheck`, `npm run test:unit --
packages/inspector/tests/foundation`, `npm run build`; all pass with exact locks and functional
esbuild binary despite disabled postinstall. Published package/baseline imports work together.
Scaffold status is visibly incomplete, not MVP acceptance. No network/model dependency is needed.

### F02 pr-ci

**Refs:** FR-001, FR-012, FR-036, FR-037, FR-040; US1, US2, US3, US4, US5; constitution quality gates.
**Depends on:** F01 only. **Owned paths:** `.github/workflows/ci.yml`, `scripts/ci.mjs`,
`package.json`, `docs/development.md`, `docs/distribution.md`.

- [ ] T006 Add PR CI with exact reviewed action refs, no-script locked npm installation, typecheck, compiled node unit tests, build, budget, Playwright, and introduced-package Python checks in `.github/workflows/ci.yml` and `scripts/ci.mjs`; wire root commands in `package.json`.
- [ ] T007 Make not-yet-introduced budget/E2E/Python suites explicitly pending in `scripts/ci.mjs`, not passing/empty-test claims; require all introduced suites, propagate errors, and describe the full integrated-MVP gate in `docs/development.md`.
- [ ] T008 Retain FR-040's future reviewed tag-CI build, semantic versioning, npm provenance/PyPI trusted-publishing and license/name gates in `docs/distribution.md`; do not create publishing workflows, tags, releases or LICENSE.

**Acceptance:** `npm run check:ci` runs the currently introduced checks successfully and reports
future suites as pending; workflow command/permission review confirms PR-only checks and no
publication. CI is implementation work, not an existing check passed by this planning PR.

### F03 bundle-budget

**Refs:** FR-001, FR-008, FR-012, FR-020; US1.3, US1.5, US2.3, US2.4; SC-009.
**Depends on:** F02 only. **Owned paths:** `scripts/bundle-budget.mjs`, `scripts/benchmark.mjs`,
`tests/benchmarks/generate.ts`, `tests/benchmarks/manifest.json`,
`tests/benchmarks/fixture.test.ts`, `tests/benchmarks/profile.md`, `package.json`,
`packages/inspector/tests/foundation/budget.test.ts`, `docs/development.md`.

- [ ] T009 Implement deterministic complete-asset accounting, fixed-mtime per-file gzip and limit failures at 2,000,000/600,000 bytes in `scripts/bundle-budget.mjs`; test equality/both over-limit cases and renderer/chunk inclusion in `packages/inspector/tests/foundation/budget.test.ts`; add root commands in `package.json`.
- [ ] T010 Freeze the plan's 31-type-plus-invalid count matrix, payload sizes, seed/order/fragments, ten 500-frame exchanges and byte/hash manifest in `tests/benchmarks/generate.ts`, `tests/benchmarks/manifest.json` and `tests/benchmarks/fixture.test.ts`; validate 4,900 schema-valid/100 invalid original frames and required event lifecycles before implementation proceeds.
- [ ] T011 Define physical-runner/browser requirements, warm-up/three runs, per-class >=95/100 <=200 ms and raw-count/hash verdicts in `tests/benchmarks/profile.md`; add `scripts/benchmark.mjs` with explicit pending UI/hardware status until L04 supplies measurements, and document commands in `docs/development.md`.

**Acceptance:** `npm run build && npm run check:bundle` counts every shipped scaffold asset;
`npm run test:unit -- packages/inspector/tests/foundation tests/benchmarks` proves budget logic and
exact fixture counts/size/hash manifest. Also measure a representative build with the actual pinned
v0.9 renderer, not only an empty app: renderer headroom is reported, not certified as final app size.
The final integrated build repeats the same strict budget. UI responsiveness is pending until L04,
never passed using a non-UI timer.

### F04 wire-recorder

**Refs:** FR-004, FR-005, FR-007, FR-008, FR-009, FR-028, FR-033, FR-036; US1.1, US1.2, US1.6,
US3, US4.3, US5.2, US5.3.
**Depends on:** F03 only. **Owned paths:** `packages/inspector/src/core/recorder/**`,
`packages/inspector/tests/recorder/**`, `examples/reference-agent/recorder-fixtures.ts`,
`docs/inspection.md`.

- [ ] T012 Write split/coalesced stream, non-2xx body, transport-failure, slow-client, early-client-failure and user-abort regression checks in `packages/inspector/tests/recorder/recorder.test.ts`; trap request/response header access to prove it never occurs.
- [ ] T013 Implement request-kind-aware exchange capture and response-clone draining without altering the original client branch in `packages/inspector/src/core/recorder/index.ts`; record method/path/exact body/status/duration and visible capture/transport failure without recording request objects/headers.
- [ ] T014 Add deterministic recorder error/fragment/body scenarios in `examples/reference-agent/recorder-fixtures.ts` and explain captured versus derived/transport evidence in `docs/inspection.md`.

**Acceptance:** `npm run typecheck && npm run test:unit -- packages/inspector/tests/recorder`.
Independent readers receive identical bytes; recording continues past client schema/sequence failure;
no headers are accessed or serialized; stopping preserves partial evidence without manufacturing
protocol events. This does not choose the G-07 auth-echo policy.

### F05 frame-reader-store

**Refs:** FR-008, FR-009, FR-012, FR-014, FR-017, FR-019, FR-034, FR-035; US1.1 to US1.5,
US3.3, US5.1, US5.3, US5.4.
**Depends on:** F04 only. **Owned paths:** `packages/inspector/src/core/frames/**`,
`packages/inspector/src/core/store/**`, `packages/inspector/tests/frames/**`,
`examples/reference-agent/protocol-fixtures.ts`, `docs/inspection.md`.

- [ ] T015 Write named dedicated fixture cases for all 31 EventType values plus unknown/non-JSON/schema-invalid, LF/CRLF/CR/multiline/comment/control, split UTF-8 and EOF fragments in `packages/inspector/tests/frames/reader.test.ts`; compare original raw text/order/offsets rather than only parsed events.
- [ ] T016 Implement incremental SSE data extraction and EventSchema validation with nonmutating findings and valid-terminal detection in `packages/inspector/src/core/frames/index.ts`; preserve control/partial evidence without counting it as fabricated AG-UI data.
- [ ] T017 Implement framework-free exchange/run/frame store, source/provenance links and immediate append plus at-most-once-per-animation-frame subscription scheduling in `packages/inspector/src/core/store/index.ts`; test monotonic offsets, client sequence run-findings and independent transport/outcomes in `packages/inspector/tests/frames/store.test.ts`.
- [ ] T018 Provide the deterministic baseline event families, invalid sequences and missing-terminal scenarios in `examples/reference-agent/protocol-fixtures.ts`; prove the F03 5,000-frame manifest survives recorder/reader/store unchanged in `packages/inspector/tests/frames/workload.test.ts` and document distinctions in `docs/inspection.md`.

**Acceptance:** `npm run typecheck && npm run test:unit -- packages/inspector/tests/recorder
packages/inspector/tests/frames tests/benchmarks`. Exactly 5,000 original frames match fixture hashes;
validation/client exceptions do not discard malformed evidence; a missing terminal produces a
finding, not an invented outcome. No React imports occur in core.

## Wave W2: disjoint user-story lanes

Seven one-PR lanes. All start from **merged W1 main**. L02 has exactly one additional prerequisite,
L01; L01 has no W2 prerequisite, so that stack is at most one level. Every other lane has no W2
prerequisite. Frozen F01 contracts and scripted collaborators permit scoped browser tests before
unrelated lanes finish; no lane must wait for another's internal implementation or edit its files.
Root manifests, lockfiles, CI, shared contracts and W1 fixtures are frozen during W2; a required
change is a coordinator blocker, not an undeclared shared-file edit.

### L01 config-presets-profiles

**Refs:** FR-006, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-036; US4.1 to US4.6.
**Depends on:** merged W1 only.
**Owned paths:** `packages/inspector/src/core/config/**`, `packages/inspector/src/core/presets/**`,
`packages/inspector/src/core/profiles/**`, `packages/inspector/src/views/settings/**`,
`packages/inspector/tests/config/**`, `tests/e2e/config/**`,
`docs/configuration.md`, `examples/reference-agent/config-scenarios.ts`.

**US4 (P2) goal/independent test:** inspect recorded mock run/preparation inputs for every variable,
profile switch and import/reload action without requiring real interactive replies or embedding.

- [ ] T019 [US4] Add config/preset/profile contract regression tests in `packages/inspector/tests/config/settings.test.ts`, including unique ids/tools, no auth fields, version 0, unknown version/errors, undefined variables and invalid JSON.
- [ ] T020 [P] [US4] Implement configuration and eleven-group declared-capability loading with guarded-request callbacks in `packages/inspector/src/core/config/index.ts`; configuration never expands the allowlist or discovers extra routes.
- [ ] T021 [P] [US4] Implement typed templates, defaults/built-in UUID per dispatch, full/turn selection, property precedence and ordered preparation plan in `packages/inspector/src/core/presets/index.ts`; fail visibly on invalid variables, never substitute silent empty values.
- [ ] T022 [P] [US4] Implement ordinary/continuation input composition, all profile switches, credential-free browser persistence and validated JSON import/export in `packages/inspector/src/core/profiles/index.ts`; use upstream input schema/current state/parent links.
- [ ] T023 [US4] Build accessible settings/capabilities/quick-message controls in `packages/inspector/src/views/settings/index.tsx`; record every switch's resulting input, reload/token absence and profile round trip in `tests/e2e/config/settings.spec.ts` using `examples/reference-agent/config-scenarios.ts`; document formats/migrations in `docs/configuration.md`.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/config`,
`npm run test:e2e -- tests/e2e/config`. All US4 scenarios pass through scripted request seam; whole
JSON substitutions preserve type; profile changes match input; no persisted/exported auth. Ordinary
input validation errors are visible, not blocked raw submissions. Preparation execution integrates in L02.

### L02 connection-interactive-runs

**Refs:** FR-003, FR-004, FR-005, FR-007, FR-009, FR-011, FR-014, FR-023, FR-024, FR-025,
FR-028, FR-031, FR-036, FR-037; US1.1, US1.2, US1.6, US2.1, US3.1 to US3.4, US4.3, US4.4, US4.5.
**Depends on:** merged W1 and L01 only; L01 may be the single unmerged parent.
**Owned paths:** `packages/inspector/src/core/runtime/**`, `packages/inspector/src/views/connection/**`,
`packages/inspector/tests/runtime/**`, `tests/e2e/runtime/**`,
`examples/reference-agent/interactive-scenarios.ts`, `docs/conversation.md`.

**US1 (P1)/US3 (P2) goal/independent test:** connect directly to a scripted origin-permitting endpoint,
drive input/preparation/reply barriers and inspect next-run bodies without needing final view assembly.

- [ ] T024 [US1] Test target changes/reload token clearing, no-cookie hosted and same-origin embedded auth, URL/userinfo/redirect denial and visible browser failures in `packages/inspector/tests/runtime/transport.test.ts`.
- [ ] T025 [US1] Implement the guarded transport, volatile named-header token, HttpAgent recorder injection, state/thread/stop/quick-message controls and client sequence run-findings in `packages/inspector/src/core/runtime/index.ts`; ensure client parse errors do not end raw capture.
- [ ] T026 [US4] Execute L01 preparation plans before every ordinary/continuation run and fail without dispatch after any preparation error in `packages/inspector/src/core/runtime/prepare.ts`; verify ordered recorded exchanges and continuation failure in `packages/inspector/tests/runtime/prepare.test.ts`.
- [ ] T027 [US3] Implement all-interrupt Resolve/Cancel and all-pending-tool manual-result barriers, upstream resume shapes, tool messages and new-run A2UI action callback in `packages/inspector/src/core/runtime/replies.ts`; test subset/no-early-run and recorded input in `packages/inspector/tests/runtime/replies.test.ts`.
- [ ] T028 [US3] Build accessible connection and in-place reply editors prefilled from response schemas in `packages/inspector/src/views/connection/index.tsx`; exercise interrupt resolve/cancel, tool results, transport stop and action envelopes in `tests/e2e/runtime/interactive.spec.ts` with `examples/reference-agent/interactive-scenarios.ts`; document manual behavior in `docs/conversation.md`.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/runtime`,
`npm run test:e2e -- tests/e2e/runtime`. US1 controls and every US3 continuation input are proven;
all preparations recorded, no early continuation, no fabricated events; raw action callback tests
use valid v0.9 envelopes without depending on L05. G-07 echo policy is not selected.

### L03 conversation-event-views

**Refs:** FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-021, FR-022;
US1.1, US1.3, US3.3, US5.1.
**Depends on:** merged W1 only.
**Owned paths:** `packages/inspector/src/core/projection/**`,
`packages/inspector/src/views/conversation/**`, `packages/inspector/tests/conversation/**`,
`tests/e2e/conversation/**`, `docs/event-views.md`.

**US1 (P1) goal/independent test:** feed F05 fixtures/client snapshots into the conversation with
scripted callbacks; verify each mapping without real transport or final application assembly.

- [ ] T029 [US1] Add a named conversation-mapping test for each of the 31 baseline fixtures in `packages/inspector/tests/conversation/events.test.ts`, including types mapped to inspection-only rather than inventing conversation cards.
- [ ] T030 [US1] Implement event projection and source-linked client-expanded chunk entries in `packages/inspector/src/core/projection/index.ts`; use client-derived messages/state and valid raw events for uncommon markers without overwriting raw evidence.
- [ ] T031 [US1] Render plain-text roles, live text/reasoning/tool arguments/results, parsed completed arguments, collapsible timed steps, outcome/result/pending-call headers, parent-linked subagent markers and custom/raw entries in `packages/inspector/src/views/conversation/index.tsx`; encrypted values expose metadata only.
- [ ] T032 [US5] Implement current-state/operations inspection and message-snapshot replacement markers with added/removed messages in `packages/inspector/src/views/conversation/state.tsx`; show projection errors without losing raw evidence in `packages/inspector/tests/conversation/state.test.ts`.
- [ ] T033 [US1] Exercise streaming/interleaving and every event-family presentation via the browser fixture host in `tests/e2e/conversation/events.spec.ts`; document the full mapping/derived distinction in `docs/event-views.md`.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/conversation`,
`npm run test:e2e -- tests/e2e/conversation`. Dedicated fixture cases cover all 31; text is not
Markdown/HTML; opaque reasoning remains undecoded; state is correct for next-run snapshot consumers.

### L04 frames-raw-sessions

**Refs:** FR-007, FR-008, FR-009, FR-010, FR-012, FR-017, FR-033, FR-034, FR-035, FR-036, FR-039;
US1.2 to US1.5, US5.2 to US5.4; SC-006, SC-007, SC-009.
**Depends on:** merged W1 only.
**Owned paths:** `packages/inspector/src/core/session-files/**`,
`packages/inspector/src/views/inspection/**`, `packages/inspector/tests/inspection/**`,
`tests/e2e/inspection/**`, `tests/benchmarks/interaction.spec.ts`,
`tests/benchmarks/render-measurement.ts`, `docs/recordings.md`.

**US1 (P1)/US5 (P2) goal/independent test:** inspect/copy/filter stored frames, send exact raw input
through the F01 guarded-request callback, round-trip files and run the benchmark with scripted
transport/store. No dependency on L02 internals or automatic execution on import.

- [ ] T034 [US1] Render newest-first exchanges/newest expanded, type/content/issue filters, raw expansion, ordered JSON-copy and all 31 frame summaries in `packages/inspector/src/views/inspection/index.tsx`; test malformed frames and original-versus-expanded links in `packages/inspector/tests/inspection/frames.test.ts`.
- [ ] T035 [US5] Implement schema-flagging raw JSON editor that submits exact entered text outside conversation/presets and displays server errors via the recorder callback in `packages/inspector/src/views/inspection/raw.tsx`; test whitespace/key order, invalid-schema sends and invalid-syntax errors in `packages/inspector/tests/inspection/raw.test.ts`.
- [ ] T036 [US5] Implement version-0 explicit session serialization and whole-file validation before inspect-only import in `packages/inspector/src/core/session-files/index.ts`; preserve order/text/time/input, reject header fields/invalid references/versions, exclude volatile auth, and retain old session on visible import failure in `packages/inspector/tests/inspection/session.test.ts`.
- [ ] T037 [US5] Add export warning, local import controls and no-request round-trip/corrupt-file/header-absence checks in `tests/e2e/inspection/session.spec.ts`; document pre-stable format/migration/sensitive-payload warning in `docs/recordings.md`.
- [ ] T038 [US1] Implement generation-linked visible-render/double-paint timing and exact planned interaction schedule in `tests/benchmarks/render-measurement.ts` and `tests/benchmarks/interaction.spec.ts`; prove original 5,000-frame retention, measure each class separately through the full renderer-enabled fixture host, report unavailable physical hardware as pending, and improve native/lazy frame rendering only when the fixed test fails.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/inspection`,
`npm run test:e2e -- tests/e2e/inspection`, `npm run test:benchmark`. All inspection/raw/session
scenarios pass; benchmark counts/hashes/schedule pass. Certify 200 ms only on the plan's actual
runner; other hardware reports timing without a release-pass claim. No byte-redaction/auth-echo
choice is built into export. Final assembled production benchmark repeats after integrated main.

### L05 a2ui-surfaces

**Refs:** FR-012, FR-020, FR-025, FR-030, FR-037; US1.3, US3.4, US4.4.
**Depends on:** merged W1 only.
**Owned paths:** `packages/inspector/src/core/a2ui/**`, `packages/inspector/src/views/a2ui/**`,
`packages/inspector/tests/a2ui/**`, `tests/e2e/a2ui/**`,
`examples/reference-agent/a2ui-scenarios.ts`, `docs/a2ui.md`.

**US3 (P2) goal/independent test:** feed v0.9 operations into official renderer and record the action
callback envelope; use scripted continuation callback, not L02's internal runtime.

- [ ] T039 [US3] Add surface/create/update/delete/delta, disabled/unknown-activity, malformed-operation and action-envelope regression tests in `packages/inspector/tests/a2ui/surfaces.test.ts`.
- [ ] T040 [US3] Implement v0.9 bundled-catalog rendering through official renderer/core, JSON fallback and visible renderer errors in `packages/inspector/src/core/a2ui/index.ts` and `packages/inspector/src/views/a2ui/index.tsx`; keep encrypted/unknown data opaque and preserve raw operations.
- [ ] T041 [US3] Preserve name/surface/component/context/timestamp in action callback, toggle rendering independently of official optional tool declaration, and deny surface-triggered external resources in `packages/inspector/src/core/a2ui/actions.ts`; no catalog fetches/third-party assets or auto tool replies.
- [ ] T042 [US3] Check round-trip callback data, updates, JSON-only mode, keyboard actions and zero third-party requests in `tests/e2e/a2ui/surfaces.spec.ts` with `examples/reference-agent/a2ui-scenarios.ts`; document v0.9-only support in `docs/a2ui.md`.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/a2ui`,
`npm run test:e2e -- tests/e2e/a2ui`, `npm run build && npm run check:bundle`. Real renderer works
offline with local catalog and correct callback; renderer and all assets remain counted.

### L06 python-static-distribution

**Refs:** FR-001, FR-002, FR-004, FR-006, FR-036, FR-038, FR-040; US2.1 to US2.4.
**Depends on:** merged W1 only.
**Owned paths:** `packages/python/**`, `examples/fastapi/**`, `tests/e2e/python/**`,
`scripts/package-python.mjs`, `docs/embedding.md`, `docs/build-provenance.md`.

**US2 (P1) goal/independent test:** package/serve the same F01/F03 static assets in minimal Starlette
and FastAPI hosts; test host routes/auth/guards without requiring complete conversation features.

- [ ] T043 [US2] Create uv-built Python >=3.10 package, exact dependency pins/uv lock, optional Starlette embedded extra and test-only FastAPI dependencies in `packages/python/pyproject.toml` and `packages/python/uv.lock`; include no unconditional framework dependency or lifecycle asset download.
- [ ] T044 [US2] Implement Agent/config and enabled-only mount helper with default `/agui-inspector`, adjacent config, custom paths, same-origin auth and startup mount-path warning in `packages/python/src/agui_inspector/__init__.py`; use standard resources to serve prebuilt assets with own-origin/no-eval CSP.
- [ ] T045 [US2] Test disabled zero routes, enabled/custom/trailing paths, config/asset correctness, missing optional dependency and startup warning on Python 3.10/3.14 in `packages/python/tests/test_embedding.py`; add host-auth model-free example in `examples/fastapi/app.py`.
- [ ] T046 [US2] Build identical wheel/sdist static package data and checksum verification against npm staticAssetsPath in `scripts/package-python.mjs`; test installed wheel with Node absent and zero startup downloads in `packages/python/tests/test_distribution.py`.
- [ ] T047 [US2] Verify browser same-origin auth/config/CSP and generic static serving in `tests/e2e/python/embedding.spec.ts`; document enabled/debug guard and local artifact/provenance-input checks in `docs/embedding.md` and `docs/build-provenance.md`, retaining future publishing safeguards without publishing.

**Acceptance:** `npm run package:python`, `uv sync --project packages/python --locked --extra
embedded --group test`, `uv run --project packages/python python -m unittest discover -s
packages/python/tests`, `npm run test:e2e -- tests/e2e/python`. Wheels/sdist contain matching
assets, optional Starlette and >=3.10 metadata; installed Python-only host works; no server-side
session storage. Public names/license/publication remain undecided.

### L07 hosted-app-assembly

**Refs:** FR-001, FR-003, FR-004, FR-005, FR-006, FR-010, FR-013, FR-020, FR-029, FR-030,
FR-033, FR-037, FR-038, FR-039; US1, US2.4, US3.4, US4, US5; SC-008.
**Depends on:** merged W1 only.
**Owned paths:** `packages/inspector/src/app/**`, `packages/inspector/public/**`,
`packages/inspector/tests/hosted/**`, `tests/e2e/hosted/**`, `docs/hosted.md`.

**US1 (P1)/US2 (P1) goal/independent test:** wire the fixed feature entry exports and security
bootstrap, prove direct browser policy and callback wiring using scoped scripted feature collaborators.
Unimplemented lane surfaces stay visibly unavailable, never represented as passing full-product tests.

- [ ] T048 [US1] Test startup allowlist/CSP-before-requests, own-origin assets/config, blocked URL/config escalation/redirects and hosted no-cookie requests in `packages/inspector/tests/hosted/startup.test.ts`.
- [ ] T049 [US1] Assemble fixed settings/runtime/conversation/inspection/A2UI entry seams, shared store and credential-isolated callbacks in `packages/inspector/src/app/index.tsx`; callbacks use public contracts only, no lane internal imports or dynamically discovered plugins.
- [ ] T050 [US2] Generate/serve startup CSP with scripts only from own origin/no eval and explicit connect targets in `packages/inspector/src/app/security.ts` and `packages/inspector/public/hosting-config.json`; configuration/capability URLs and typed endpoints cannot widen policy without deployment reconfiguration/reload.
- [ ] T051 [US1] Exercise app wiring, direct allowed browser run, blocked CORS/private-network/secure-context failure presentation, keyboard focus/basic accessible labels and request allowlist in `tests/e2e/hosted/app.spec.ts`; document static deployment and scoped-versus-integrated acceptance in `docs/hosted.md`.

**Acceptance:** `npm run typecheck`, `npm run test:unit -- packages/inspector/tests/hosted`,
`npm run test:e2e -- tests/e2e/hosted`, `npm run build && npm run check:bundle`.
Scoped wiring/security works without third-party scripts/eval/proxy/cookies. After every lane merges,
rerun the entire [quickstart](quickstart.md) with all real implementations; G-08 controls any extra
integration PR rather than disguising it as a deeper W2 prerequisite.

## Requirement and story coverage

All 40 FRs have implementation or explicit retained/deferred coverage. No user story is deferred.

| Requirement | Slices |
| --- | --- |
| FR-001 | F01, F02, F03, L06, L07 |
| FR-002 | L06 |
| FR-003 | L02, L07 |
| FR-004 | F04, L02, L06, L07 |
| FR-005 | F04, L02, L07 |
| FR-006 | L01, L06, L07 |
| FR-007 | F04, L02, L04 |
| FR-008 | F03, F04, F05, L04 |
| FR-009 | F04, F05, L02, L04 |
| FR-010 | L04, L07 |
| FR-011 | L02 |
| FR-012 | F01, F02, F03, F05, L03, L04, L05 |
| FR-013 | L03, L07 |
| FR-014 | F05, L02, L03 |
| FR-015 | L03 |
| FR-016 | L03 |
| FR-017 | F05, L03, L04 |
| FR-018 | L03 |
| FR-019 | F05, L03 |
| FR-020 | F03, L05, L07 |
| FR-021 | L03 |
| FR-022 | L03 |
| FR-023 | L02 |
| FR-024 | L02 |
| FR-025 | L02, L05 |
| FR-026 | L01 |
| FR-027 | L01 |
| FR-028 | F04, L01, L02 |
| FR-029 | L01, L07 |
| FR-030 | L01, L05, L07 |
| FR-031 | F01, L01, L02 |
| FR-032 | L01 |
| FR-033 | F04, L04, L07 |
| FR-034 | F05, L04 |
| FR-035 | F05, L04 |
| FR-036 | F01, F02, F04, L01, L02, L04, L06; auth-echo guarantee blocked on G-07 |
| FR-037 | F02, L02, L05, L07 |
| FR-038 | L06, L07 |
| FR-039 | L04, L07 |
| FR-040 | F01, F02, L06 retain local build/provenance checks and publishing safeguards; actual publication deferred by explicit no-publishing constraint and G-01/G-02 |

| Story/acceptance refs | Completion slices | Independent criterion |
| --- | --- | --- |
| US1 P1: US1.1-US1.6 | F04/F05, L02/L03/L04/L07 | Scripted live stream, malformed retention, all event views, controls and exact hardware benchmark |
| US2 P1: US2.1-US2.4 | L02/L06/L07 | Enabled/disabled Starlette/FastAPI plus Node-free wheel and static-assets serving |
| US3 P2: US3.1-US3.4 | L02/L03/L05 | All-interrupt/tool barriers, streamed arguments/results and surface action callback/input |
| US4 P2: US4.1-US4.6 | L01/L02/L07 | Config/variables/preparation failures, every profile switch, reload and credential-free JSON exchange |
| US5 P2: US5.1-US5.4 | L03/L04/L07 | Current state, exact schema-invalid raw send, warning/round-trip/header absence and visible invalid import |

Success criteria: SC-001 L02/L03/L04/L07; SC-002 L06; SC-003 F05/L03/L04/L05;
SC-004 L02/L05; SC-005 L01/L02; SC-006 L04; SC-007 L04; SC-008 L02/L04/L05/L06/L07;
SC-009 F03/F05/L04 plus final complete-build budget. A matrix entry is traceability, not evidence
that the currently unbuilt requirement has passed.

## Dependencies and parallel execution

```text
W1: F01 -> F02 -> F03 -> F04 -> F05 -> merged-main checkpoint
W2 roots: L01, L03, L04, L05, L06, L07
W2 stack: L01 -> L02
All W2 merged -> integrated-main validation (no new slice; G-08 if gaps)
```

The only W2-to-W2 edge is L01 -> L02. No root lane depends on another W2 lane. Ownership prefixes
listed in W2 are disjoint, including tests/examples/docs; F01 foundation-created scaffold entry
files transfer to their named W2 owner. No global CSS/schema/index/barrel file is edited by
multiple lanes. L07 alone owns app assembly; its scripted collaborator tests certify wiring, not
unimplemented external features. Contracts/stubs prevent compile-order dependencies, not runtime
acceptance requirements.

Parallel examples by story after W1 merges:

| Story | Parallel work example | Required merge/acceptance ordering |
| --- | --- | --- |
| US1 | L03 event presentation, L04 frames/performance, L07 app/network bootstrap | Full live UI check after these plus L02 merge |
| US2 | L06 packaging/hosts and L07 static host policy | Same-origin auth checks use scoped fixture; full run after L02 merge |
| US3 | L05 renderer/action callback alongside L03 streaming argument views | L02 starts after L01; integrated action/reply scenarios after merges |
| US4 | L01 config/templates/profile tests alongside unrelated P1 lanes | L02 preparation/actual input tests depend only on L01 |
| US5 | L04 raw/import and L03 current-state views | Integrated raw/current-state inputs repeat on main; no lane-stack edge |

## Implementation strategy and final cross-cutting checkpoint

Deliver foundation pairs sequentially, then parallel story lanes. Each lane writes regressions
before the corresponding behavior and completes its scoped checks/docs in the same PR. Review
P1 inspection/embedding first without treating P2 stories as optional: **the MVP includes all five**.
Do not turn isolated fixture-host checks into a claimed product acceptance.

After all seven lanes merge, run every quickstart scenario on integrated main with no missing-suite
or unimplemented-feature skips. Check complete bundle bytes, all 31 dedicated fixtures/views,
actual next-run/profile/preparation inputs, interruptions/tool/A2UI round trips, exact raw sends,
profile/session exchange, host wheel without Node, network allowlist and physical 5,000-frame
benchmark. Record failures and the G-07 policy block explicitly; user decides at G-08 whether
an additional integration PR is required. This checkpoint is verification, not an authorized W3.

Publication/license/name decisions, all excluded modes/transports/tools, stable-v1 formats,
50,000-frame/on-demand-renderer acceptance and the stable WCAG audit remain deferred for their
documented release boundaries. Accessibility basics, error handling, trust-boundary validation
and privacy are not deferred.

**Count:** 12 PR slices (W1: 5, W2: 7), 51 checklist tasks. Story-tag counts: US1 11, US2 6,
US3 6, US4 6, US5 4; foundation 18. Shared story coverage is recorded in slice refs/matrices
rather than counting a task multiple times.
