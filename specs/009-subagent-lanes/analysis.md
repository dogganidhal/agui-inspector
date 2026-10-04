# Specification Analysis Report: Subagent lanes and timeline

Run on 2026-10-04 over `spec.md`, `plan.md`, `tasks.md`, the design files and the constitution (1.2.0). The analysis
changes no file. The fixes listed below were then made by hand in the named files, and the analysis was read again.

## Findings

| ID | Category | Severity | Location | Summary | Resolution |
| --- | --- | --- | --- | --- | --- |
| C1 | Coverage | HIGH | spec FR-012, SC-005 | Contrast of text, bars and focus rings to WCAG 2.2 AA had no task. | T019 now computes it in the page for both themes. |
| C2 | Coverage | HIGH | spec edge case on whole messages | No task tested that whole messages from an input or a snapshot keep their 0.1.0 place. | Case added to T004. |
| C3 | Coverage | MEDIUM | spec FR-021, plan CSP row | The plan says the style object is allowed by the policy, but only the whole-app run uses the production policy. | T028 now asserts no `securitypolicyviolation`. |
| C4 | Coverage | MEDIUM | spec FR-024, SC-012 | The spec says the pages for event views and inspection change, the tasks changed only the event views and internals pages. | T030 and T031 now cover `inspection.mdx`. Plan and research list it. |
| I1 | Inconsistency | HIGH | spec FR-015 | The key list asks for "open a shortened value", but the design has no such control: a shortened name is complete in the lane header the row jumps to. | The phrase is removed from FR-015. The edge case and FR-016 keep the jump as the way to the full text. |
| I2 | Inconsistency | HIGH | spec SC-006 | SC-006 says the 200-subagent thread "shows" its timeline within 1 s, while the measured work is projection and row building. | SC-006 now says "builds its timeline rows". Browser responsiveness is SC-007. |
| I3 | Inconsistency | MEDIUM | tasks T002, T004 | T002 put its first test in either of two files, and T004 created a file that T002 had already used. | T002 creates `lanes.test.ts`, T004 adds to it. |
| D1 | Design | HIGH | tasks T006 | `inTranscript` was set only for lanes of the exchange being read, but a snapshot also removes lanes of earlier runs. | T006 sets it for the whole list of lanes. |
| D2 | Design | MEDIUM | tasks T021 | The jump path included the target lane, so a collapsed target would open although the spec only asks to open what hides it. | `pathTo` returns the containers only. |
| D3 | Design | MEDIUM | tasks T021, T022 | A focus effect that runs once per request misses a target that mounts one render later, inside a body that opens on the same request. | The effects run on mount and on a new request. |
| D4 | Design | MEDIUM | tasks T006 | `collect` keeps run headers and issues, and issues now sit inside lanes. | T006 names `collect` and `visit` for the recursion. |
| A1 | Ambiguity | LOW | spec FR-016 | "Large number of subagents" is open in the sentence, and fixed by the 100-row limit that follows it. | None. The limit is the measure. |
| T1 | Terminology | LOW | all | "Lane", "segment" and "invocation" are three words. | Kept on purpose: the key entities define them, a lane is the transcript's block for a segment. |

No finding is CRITICAL.

## Coverage summary

Every functional requirement has at least one task, and every success criterion has a check.

| Requirement | Tasks |
| --- | --- |
| FR-001 to FR-004 | T003, T004, T010, T011, T013, T014 |
| FR-005, FR-006 | T010, T012, T013, T014 |
| FR-007, FR-008 | T005, T025, T026 |
| FR-009 | T004, T025, T026 |
| FR-010, FR-011 | T007, T015, T016, T017, T018, T019 |
| FR-012, FR-013 | T017, T018, T019 |
| FR-014, FR-015 | T020, T021, T022, T023, T024 |
| FR-016 | T015, T018, T024 |
| FR-017, FR-018, FR-019 | T027, T028, T029 |
| FR-020 | T002, T006, T007 |
| FR-021, FR-022, FR-023 | T013, T028, T033 |
| FR-024 | T030, T031 |
| FR-025 | T004 to T009, T014, T019, T024, T026 to T029 |
| SC-001 to SC-003 | T004, T005, T007, T014, T018 |
| SC-004, SC-005, SC-007 | T018, T019, T024 |
| SC-006 | T009 |
| SC-008 | T027 |
| SC-009, SC-010 | T028, T029 |
| SC-011 | T001, T033 |
| SC-012 | T030, T031 |

**Unmapped tasks**: none. T001, T033 and T034 are baseline, gate and release tasks.

## Constitution alignment

No conflict. The plan's table assesses all six principles, the architecture rules, the quality gates and the release
scope. The 1.0.0 gates are out of scope because no 1.0.0 is planned. The tasks cover behavior (Phases 2 to 7),
validation (tests in each phase) and the documents that describe the behavior (T030, T031).

## Metrics

- Requirements: 25 functional, 12 success criteria.
- Tasks: 34.
- Coverage: 100% of requirements have at least one task.
- Ambiguities: 1 (low). Duplications: 0. Critical issues: 0. High findings: 5, all fixed.

## Next actions

Ready for the maintainer's review of the spec and the plan. The orchestrator's `APPROVED` starts `/speckit-implement`.
