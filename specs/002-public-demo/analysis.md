# Specification Analysis Report: Public demo

**Date**: 2026-10-02.
**Scope**: spec.md, plan.md, tasks.md, supporting design contracts and constitution 1.1.0.
**Method**: speckit-analyze read-only detection, followed by separately authorized remediation
of owned artifacts and a final consistency review. The maintainer requested remediation in the task.
No implementation or browser acceptance is claimed.

## Findings and dispositions

Locations below name the initial analysis snapshot; remediation changes line numbers.

| ID | Category | Severity | Location(s) | Summary | Recommendation / disposition |
| --- | --- | --- | --- | --- | --- |
| C1 | Constitution alignment / inconsistency | CRITICAL | spec.md FR-008; plan.md Startup policy; contracts/demo.md Hosting option | Retaining arbitrary fixed origins while opting in could admit non-loopback HTTP beyond the amended HTTPS/loopback boundary. | Fixed: opt-in rejects out-of-bound fixed origins at parse and guard, including constructed policies; default-off behavior unchanged. T001/T002 and validation guide explicitly cover it. |
| A1 | Ambiguity | HIGH | spec.md US2 scenario 5 | "Credentials never enter headers" could prohibit intended in-memory authentication-header transmission rather than header recording. | Fixed: distinguishes transmitted authentication header from recorded headers/persisted inspector credentials; target evidence remains unchanged. |
| I1 | Inconsistency | MEDIUM | spec.md Key entities; data-model.md DemoReadiness; plan.md lifecycle | Readiness metadata still implied in-page retry although the simpler design mounts once and avoids evidence-losing remounts. | Fixed: reload guidance only, no automatic retry/replay/remount; save current evidence first. |

**Final findings left**: zero CRITICAL, HIGH, MEDIUM or LOW artifact inconsistencies.
Browser/operational gates below are known evidence requirements, not unresolved design defects.

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
| --- | --- | --- | --- |
| FR-001 | Yes | T011/T012/T014/T016 | Static Pages app/build/native integration. |
| FR-002 | Yes | T006-T008/T010/T014 | Real HTTP/SSE byte path and browser proof. |
| FR-003 | Yes | T006/T007/T010 | Shared producers, unchanged Node behavior. |
| FR-004 | Yes | T009/T014 | Agents/presets/quick messages. |
| FR-005 | Yes | T003/T011/T014 | Bounded first-page readiness. |
| FR-006 | Yes | T008/T010/T012/T014 | Exact scoped routes, no storage/proxy. |
| FR-007 | Yes | T001/T002/T005 | Startup-only hosted opt-in/defaults. |
| FR-008 | Yes | T001/T002/T005 | No-prompt unlisted targets; strict boundary and browser gate. |
| FR-009 | Yes | T001/T002/T004/T005/T011 | CSP/guard/footer/worker rules. |
| FR-010 | Yes | T002/T005/T008/T010/T014 | No automatic external traffic/worker persistence. |
| FR-011 | Yes | T002/T005/T014 | Cookies/auth/echo/header/export regression. |
| FR-012 | Yes | T012/T013/T015 | Separate artifact, actual archive isolation. |
| FR-013 | Yes | T013/T015 | Dual complete budgets, inherited workload gates. |
| FR-014 | Yes | T015/T016 | PR validation, main-only SHA-pinned Pages. |
| FR-015 | Yes | T011/T017 | Provenance and embedding docs navigation. |
| FR-016 | Yes | T003/T011/T014 | Usable own-server/import fallback. |
| FR-017 | Yes | All slice prerequisite/ownership rules; T016 | Three disjoint slices, W3 main, one stacking level, no publishing. |
| SC-001 | Yes | T011/T014 | Fresh ready/unavailable <=10 seconds. |
| SC-002 | Yes | T006-T010/T014 | Full interactive/A2UI/all-31 matrix. |
| SC-003 | Yes | T001/T002/T005 | Native HTTPS/localhost, no cookies, forbidden refusal. |
| SC-004 | Yes | T005/T008/T010/T014 | Zero external auto-requests/persistence. |
| SC-005 | Yes | T012/T013/T015 | Standard isolation/dual budgets; existing 5,000-frame checks. |
| SC-006 | Yes | T011/T012/T014/T017 | Sub-path/fallback/docs link. |
| SC-007 | Yes | T015/T016 | Deployable validated artifact, actual authorization separate. |

## Constitution Alignment Issues

C1 is resolved without changing the constitution further. The explicitly approved 1.1.0 amendment
is the only governance change. Wire/protocol/framework separation, presets, native dependency
reuse, all-event fixtures, credential echo/header privacy, shared ordinary bundle and inherited
acceptance gates are assessed in plan.md. Demo-only supplements do not create a second app.

## Unmapped Tasks

None. All 17 tasks map to requirements/stories. Setup/foundation is inherited merged W3 main,
not speculative implementation work or a fourth slice. Cross-cutting checks/docs stay inside P03.

## Metrics

| Metric | Final result |
| --- | --- |
| Functional requirements | 17 |
| Buildable success criteria | 7 |
| Total tracked requirement keys | 24 |
| Executable tasks | 17 (US1 8, US2 4, US3 5) |
| Requirement coverage | 24/24, 100% |
| Implementation slices | 3 |
| Exact owned-path overlap | 0 (P01 12 paths, P02 10, P03 12) |
| Ambiguity / duplication remaining | 0 / 0 |
| CRITICAL / HIGH remaining | 0 / 0 |

## Open gates / next actions

Implementation waits for G-D01 merged W3 main. P01 proves G-D02 exact numeric-loopback CSP and
records browser limits; localhost is the documented URL and IPv6 remains unclaimed. P02/P03 prove
G-D03 native first-load/bytes/Stop. Maintainer owns G-D04 Pages enablement/authorization.
P03 proves G-D05 dual budgets/package isolation/integrated CI; physical M2 responsiveness remains
the inherited maintainer gate. None is passed by this planning PR.

Next command after reviewed planning and W3 merges is `/speckit-implement` for a dispatched slice,
not a deployment/publishing workflow. No additional remediation required. No pre/post analysis
hooks exist; `.specify/extensions.yml` is absent.
