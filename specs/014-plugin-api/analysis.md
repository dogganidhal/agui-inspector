# Analysis: Plugin API

`/speckit-analyze` over `spec.md`, `plan.md` and `tasks.md`, run on 2026-10-04 after the first full draft. It changes no
file, so the fixes below were made by hand. Result: no critical finding, three high findings, four medium and three low,
all fixed.

## Findings

| ID | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| A1 | High | tasks T034 | The reference-agent test was named `tests/reference-agent.test.ts`. The file is `packages/inspector/tests/foundation/reference-agent.test.ts`. The frozen scenario bytes of `tests/demo/scenarios.test.ts` were not named as a guard. | Path fixed. T034 says the existing scenario bytes and the demo's quick messages stay unchanged, and the new message is not one of `SCENARIOS`. |
| A2 | High | tasks T028 | The `checkRunInput` test had no real location ("runtime.test.ts area"). `composeRunInput` is tested in `packages/inspector/tests/config/settings.test.ts`. | Path fixed. |
| A3 | High | tasks T041 | The example provider's rule for which address it answers for was garbled, and it did not show the `request.url` check that the docs ask of every provider. | The example answers only for paths that start with `/interactive`, the scripted agent in the tests. |
| B1 | Medium | tasks T040, spec FR-014 | "Cleanup when the card goes away" had no test. | T040 (a) adds New thread removing the cards and running the cleanup. |
| B2 | Medium | tasks T012, spec FR-019 | "No route, no header change" was tested for Python only. | T012 compares the route list and the response headers with and without `plugins`. |
| B3 | Medium | contracts, tasks T005 | The contract's warning table lacked the "did not load within" text that the host tests expect for an import that never settles. | Row added. |
| B4 | Medium | data model | `eventRenderer` and `activityRenderer` return `PluginRenderer`, which no file defined. | Defined in `data-model.md`. |
| C1 | Low | tasks T039, T016, T042 | One garbled sentence in T039, one unclear sentence in T016, and T042 compared a whole export, which holds ids and timings that differ between runs. | Reworded. T042 compares the frames' `envelope`, `data` and `eventType`. |
| C2 | Low | tasks T009 | The source scan for `eval(` and `new Function(` covers comments, and nothing reminded the implementer. | T009 names the scan and the rule for comments. |
| C3 | Low | plan | `internals.mdx` was in the tasks and not in the structure. | Added. |

## Coverage

Every requirement has at least one task: FR-001 T003 T007 T015; FR-002 T003 T004 T015; FR-003 T003 T007 T015; FR-004 T005
T006 T008 T009 T015; FR-005 T005 T006 T016; FR-006 T005 T006; FR-007 T002 T043 T045; FR-008 T029 T030 T031 T032 T033;
FR-009 T028 T029 T031 T032 T033; FR-010 T031 T033; FR-011 T020 T021 T022 T023 T024 T025 T027; FR-012 T018 T019 T022 T024
T027; FR-013 T024 T027; FR-014 T035 T036 T037 T038 T039 T040; FR-015 T037 T038 T040; FR-016 T029 T031 T035 T040; FR-017
T005 T010 T011 T016 T040; FR-018 T010 T011 T015; FR-019 T012 T013 T015; FR-020 T014 T015; FR-021 T046 T047 T048 T049;
FR-022 T034 T041 T042; FR-023 T043 T044; FR-024 every test task; FR-025 T050. Success criteria: SC-001 T015; SC-002 T008 T012
T013 T015; SC-003 T003 T015; SC-004 T042; SC-005 T024 T027; SC-006 T016 T027 T033 T040; SC-007 T040 T042; SC-008 has no
automated check (the docs test of T042 only keeps the page and the example in step; the example is complete enough to be
copied); SC-009 T050.

No task lacks a requirement: T001 and T050 to T051 are the baseline, the gate and the close-out.

## Constitution

No violation. Two readings are flagged for review:

- Principle IV says scripts MUST remain same-origin only and dynamic code evaluation MUST remain forbidden. The page
  loads a module file by address with `import()`. A string is never evaluated, and the policy text is unchanged. A test
  compares it with and without plugins, and the source scan for `eval(` and `new Function(` stays.
- A plugin can read the token a developer typed, because it runs with the page's rights. The constitution's promise is
  about what the inspector writes, and nothing it writes holds a credential. The spec and the docs say that a plugin is
  the deployer's code and is not sandboxed.

## Open questions for the maintainer

Whether the command of feature 005 gets `--plugin` in 0.2.0 (plan, open question 1).

## Follow-up, 2026-10-04, after approval

The maintainer approved the spec and the plan. Features 005, 008 and 013 merged first, and the artifacts were read against
`main` again. No critical finding. Changes made by hand:

| ID | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| G1 | High | spec FR-012, tasks T018, T019 | Feature 013 made `Accept` depend on the encoding of the request (`sse`, `protobuf`, `response`). The spec did not say which side wins when a provider returns `Accept`. | The transport owns `Accept` and `Content-Type`. A provider that returns either is invalid and that one request is not sent, so the encoding always wins. Spec scenario 8, FR-012, an edge case, a clarification, the contract, and the transport tests (a protobuf run included) say it. A provider-specific wording replaces the token wording of `headerNameProblem`. |
| G2 | High | spec FR-021, plan, research 10 | The command now exists, and its relay checks `Origin` and `Sec-Fetch-Site` only below `/proxy/`. A plugin file can hold a signing key. | A request for a plugin file passes the relay's checks, and the listener stays on `127.0.0.1`. FR-021, story 6 (scenario 5), research 10 and T047 to T049 say so. |
| G3 | Medium | spec 005 | FR-002 said "and no others". | A dated note in `specs/005-cli-proxy` (FR-002, the flags assumption, the command contract) names `--plugin` and points here. |
| G4 | Medium | tasks T003, T007, T009 | The reader gained `catalogAliases` (feature 008), so the order of warnings and the destructuring in `startPage` changed. | Tasks follow the merged code: theme, brand, catalog aliases, plugins. |
| G5 | Low | plan | The open question is answered and story 6 is no longer blocked. | Plan, tasks (phase 9) and the checklist updated. |
