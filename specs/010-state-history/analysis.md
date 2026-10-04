# Analysis: State history

Cross-check of [spec.md](spec.md), [plan.md](plan.md) and [tasks.md](tasks.md) against each other and against
the constitution (1.2.0), run before implementation on 2026-10-04. The analysis changes no file. The fixes below
were made by hand afterward.

## Result

No constitution conflict. Every functional requirement and measurable outcome maps to at least one task.
No critical finding. Two high findings and four medium and low ones, all fixed.

| ID | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| A1 | High | FR-010, tasks | No task put a "derived, not received" line on the detail, so the MUST had no work behind it. | Added the line to `StateDetail` (T010), the contract and the markup test (T011). |
| A2 | High | tasks, US1 | The row summary (FR-001) was built in the US2 phase, so US1 could not pass on its own. T008 also pointed at the wrong task for the list. | Moved `PointList` into the US1 phase (T008) and renumbered. Dependencies rewritten. |
| A3 | Medium | tasks, US3 | The keyboard test checked the frame reference button, but the fixture host passes no `onReveal`, so the reference renders as text. | T016 makes the fixture record the reveal target. |
| A4 | Medium | tasks, US4 | The import case used "0.1.0 fixtures" that do not exist, and the app-level helpers live in `tests/e2e/inspection`. | T018 is a new spec in `tests/e2e/inspection` that builds a 0.1.0-format file with the existing helpers. |
| A5 | Medium | SC-010 | The plan promised a docs test line for the history section and no task wrote it. | Two assertions added to `docs.test.ts` in T019. |
| A6 | Low | plan, US4.4 | The plan named one e2e spec and the workload test file loosely. The "inspection only" notice had no assertion. | Plan tree and test table aligned. T018 asserts the notice. |

## Coverage

| Requirement | Tasks |
| --- | --- |
| FR-001 | T007, T008, T010, T011 |
| FR-002, FR-003 | T004, T007, T010, T011 |
| FR-004 | T007, T011 |
| FR-005 | T010, T011 |
| FR-006 | T005, T012, T014 |
| FR-007, FR-008 | T012, T013, T014, T016 |
| FR-009 | T002, T003, T005 |
| FR-010 | T010, T011, T012 |
| FR-011, FR-012 | T013, T017 |
| FR-013, FR-014 | T018 |
| FR-015 | T015, T016 |
| FR-016 | T007, T011 |
| FR-017 | T006 |
| FR-018 | T019, T020 |
| FR-019 | T022 |
| FR-020 | One bundle for every mode and no mode-specific code, so T018 on the hosted app stands for all. |

| Outcome | Tasks |
| --- | --- |
| SC-001, SC-002 | T004, T005 |
| SC-003 | T016 |
| SC-004 | T006 |
| SC-005 | T017 |
| SC-006, SC-007 | T018 |
| SC-008 | T022 |
| SC-009 | T011 |
| SC-010 | T019, T020 |

## Metrics

Requirements 20, outcomes 10, tasks 23, coverage 100%, duplications 0, critical issues 0.
