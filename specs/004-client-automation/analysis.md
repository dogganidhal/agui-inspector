# Analysis: Client automation

Read-only pass over [spec.md](spec.md), [plan.md](plan.md) and [tasks.md](tasks.md) against the constitution (1.2.0),
before implementation. Findings that were fixed in the same change are marked Fixed.

## Findings

| ID | Category | Severity | Where | Summary | Resolution |
| --- | --- | --- | --- | --- | --- |
| C1 | Coverage | HIGH | tasks.md T021 | The hosted end-to-end fixture serves only fixed replies and has no interrupt route, so the real-app test could not run as written. | Fixed. T021 adds one `/interactive` route that serves `interactiveResponse` from the reference agent, so the scenario stays the reference agent's. |
| I1 | Inconsistency | MEDIUM | spec.md FR-013, US5.4 | The spec said a manual answer resets the count. The design resets it when a developer-started run is sent. The two differ only before the continuation starts, which nothing can observe, but the text was imprecise. | Fixed. FR-013 and scenario 4 now name the sent run. |
| U1 | Underspecification | MEDIUM | tasks.md T012 | One assertion about the request body ("no key or value that a manual one lacks") could not be checked as written. | Fixed. It now walks the parsed body for any key named `automatic` or `automaticReplies`. |
| U2 | Underspecification | LOW | tasks.md T009, T020 | The manual half of the equality test needs the profile reset to by hand, and the panel test needs a tool before it can have a script. | Fixed. Both steps are named. |
| I2 | Inconsistency | MEDIUM | quickstart.md | It sent the reader to a Settings panel in the runtime e2e page, which has none. | Fixed. It names the public demo and the hosted example. |
| D1 | Documentation | MEDIUM | tasks.md T027, T028 | A 0.1.0 inspector rejects the new keys. The pull request template asks for compatibility notes. | Fixed. The docs say so in one sentence. |
| D2 | Documentation | LOW | tasks.md T027 | The public demo is the natural place to try the feature and said nothing. | Fixed. One sentence in `demo.mdx`. |
| A1 | Ambiguity | LOW | spec.md Assumptions | Resolve sends the schema's starting answer, which is `approved: false` for an approval schema. A developer who wants `true` has no way to script it. | Fixed by the maintainer's decision of 2026-10-04: an optional `interruptPayloads` map from interrupt reason to a JSON payload, sent as written. Spec, plan, research, data model, contract, quickstart and tasks are updated. |

No finding is CRITICAL. No constitution conflict. The payload addition was checked after the maintainer's approval: it adds one optional profile field, no dependency and no request type, so the constitution check in the plan still passes.

## Coverage

| Requirement | Tasks |
| --- | --- |
| FR-001, FR-002, FR-018, FR-019, FR-020 | T002, T003, T004, T020 |
| FR-005 payload | T005, T006, T007, T009, T021 |
| FR-003 | T007, T010, T023 |
| FR-004 | T018, T019, T020 |
| FR-005, FR-007, FR-008 | T005, T006, T007, T008, T009 |
| FR-006 | T005, T006, T010, T011 |
| FR-009, FR-010 | T010, T011, T023 |
| FR-011 | T007 |
| FR-012 to FR-015 | T022 to T025 |
| FR-016, FR-017 | T012 to T017, T021 |
| FR-021 | T026 to T028 |
| FR-022 | every test task, T030 |

Success criteria: SC-001 and SC-002 by T007, T009, T010, T011; SC-003 by T012, T016, T017; SC-004 by T023, T025; SC-005 by
T003, T020; SC-006 by T007 and the existing manual tests; SC-007 by the allowlist check in every runtime e2e test.

## Constitution alignment

No issue. The plan's check covers each principle. The two points a reviewer should look at: the mark lives on the recorded
`Run` and never on the wire (principle I), and a scripted result is saved and exported with the profile, so the docs tell
the developer not to put a secret in one (principle IV).

## Metrics

Requirements 22, success criteria 8, tasks 32. Every requirement has at least one task. No task is unmapped. Critical 0,
high 0 open, ambiguity 0 open.
