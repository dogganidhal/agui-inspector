# Analysis: Run waterfall

Cross-check of `spec.md`, `plan.md` and `tasks.md` against each other and against the constitution (1.2.0). It was run
after `speckit-tasks` and before any code. The analysis changes no file; the fixes below were made by hand after it.

## Findings

| ID | Category | Severity | Where | Finding | Resolution |
| --- | --- | --- | --- | --- | --- |
| I1 | Inconsistency | High | spec edge cases, FR-008, data-model | The edge case said an inner step still open when its outer step finishes "ends there". FR-008 and the data model say an open row runs to the latest frame of the run. The two cannot both hold. | Fixed. The edge case now says the inner step stays open and its bar runs to the latest frame, even past its parent. T014 tests it. |
| C1 | Coverage | Medium | FR-020, tasks | No task opened the page in embedded mode. | Fixed. T023 opens the page with `hosting: () => null` and checks the same tab and rows. |
| C2 | Coverage | Medium | FR-017, T025 | FR-017 says "during capture and after". T025 measured only after. | Fixed. T025 adds a rebuild-per-frame case over the last 200 frames of the workload, p95 under 100 ms. |
| U1 | Underspecified | Medium | T023 | "A session file shaped by 0.1.0" had no concrete source. No stored 0.1.0 file exists. | Fixed. The file is written by `serializeSession`, the 0.1.0 format, and the test asserts the envelope keys and that this feature added none. |
| U2 | Underspecified | Low | edge cases, T007, T009 | Two edge cases (equal starts keep arrival order, long labels are cut with the full text in the details) had no task text. | Fixed in T007 and T009. T009 also names the panel heading. |
| U3 | Ordering | Low | T004 | T004 tested rows of the workload before rows exist (T006). | Fixed. The clause moved to T025, which already has the counts. |

No critical finding. No constitution conflict: the plan's table passes every principle, adds no dependency, no storage
and no format field, and keeps the wire as received.

## Coverage

Every FR and SC has at least one task.

| Requirement | Tasks |
| --- | --- |
| FR-001 | T010 |
| FR-002, FR-003 | T004, T005, T009, T010 |
| FR-004, FR-005 | T006, T007, T009 |
| FR-006 | T012, T013 |
| FR-007 | T006, T007, T008, T009, T011 |
| FR-008, FR-009 | T004, T006, T012, T014, T015 |
| FR-010 | T016 |
| FR-011, FR-012 | T021, T023 |
| FR-013 | T021, T022 |
| FR-014 | T010, T022, T023 |
| FR-015 | T017, T018, T019 |
| FR-016 | T011, T015, T026 |
| FR-017 | T025 |
| FR-018 | T029 and the existing dependency tests |
| FR-019 | T027 |
| FR-020 | T023 |
| SC-001 to SC-003 | T007, T013, T014 |
| SC-004 | T019 |
| SC-005 | T016 |
| SC-006, SC-007 | T023 |
| SC-008 | T025 |
| SC-009 | T029 |
| SC-010 | T011, T015, T026 |
| SC-011 | T027 |

Every task maps to a story, to the foundation or to the polish phase.

## Metrics

Requirements: 20 FR and 11 SC. Tasks: 30. Coverage: 100%. Critical: 0. High: 1 (fixed). Medium: 3 (fixed). Low: 2
(fixed).

## Open points for the maintainer

None that change 0.2.0 scope, need a constitution amendment or add a dependency. Two notes for the reviewer:

- Spec 009 (subagent lanes) had no commit and no spec when this plan was written. The waterfall reads the
  `subagentRunId` of events itself and will use the projection's if 009 adds it.
- A demo scenario that shows the waterfall (nested delegation in the public demo) is a good follow-up. It would change
  the demo's quick messages and docs, so it is not part of this issue.
