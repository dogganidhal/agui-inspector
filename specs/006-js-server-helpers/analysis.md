# Analysis: JavaScript server helpers

`/speckit-analyze` over `spec.md`, `plan.md` and `tasks.md`, run on 2026-10-04 after the first full draft. It changes
no file, so the fixes below were made by hand. Result: no critical finding, one high finding, four medium and two low,
all fixed.

## Findings

| ID | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| E1 | High | tasks T011, T014, T017 | The browser hosts imported `agui-inspector/express` and the other entries. `npm run check:ci` type checks `tests/` before it builds, and those entries have no declarations until `lib` exists, so the type check would fail. | The hosts import the helpers from `packages/inspector/src/server/*.ts`, as other end-to-end tests import `src`. T022 covers the built `lib`: the exports, `import`, `require`, a TypeScript consumer and one served page. |
| F1 | Medium | spec FR-010, public contract | FR-010 asks for a 405 with `Allow` from every helper, but Next.js answers the methods a route file does not export. | FR-010 says the Next.js route exports only GET and HEAD and the framework answers the rest. T027 checks the real answer. |
| C1 | Medium | tasks T022 | The package test only loaded each entry. Nothing showed that the shipped `lib` serves the real `dist`. | T022 adds a child-process Express server that `require`s the built entry and fetches the redirect, the page and `config.json`. |
| C2 | Medium | tasks T018 | "No route added" had no way to be measured for Express 4 and 5. | T018 names the router stack of each major. |
| F2 | Medium | tasks T023 | The warning names the path as passed, so an outer `Router` or `basePath` prefix is absent. The docs did not say so. | T023 says it. |
| D1 | Low | plan | `node.test.ts` and `guard.spec.ts` were in the tasks but not in the structure. The constitution lists esbuild, and `lib` is built with `tsc`. | Both added to the plan. A row in the constitution check says `tsc` only emits `lib` and esbuild still builds the page. |
| B1 | Low | tasks T012 | The Hono traversal case was worded in a way that mixed two things. | Reworded to one encoded traversal case. |

## Coverage

Every requirement has at least one task: FR-001 T010 T013 T016 T022; FR-002 T006 T009 T010 T015 T016; FR-003 T005 T018
T019 T020; FR-004 T006 T018 T019 T020; FR-005 T005 T009 T012 T015 T017; FR-006 T005; FR-007 T005; FR-008 T005 T018
T019 T020; FR-009 T005 T009 T012; FR-010 T005 T009 T012 T027; FR-011 T018 T019 T020 T021 T023; FR-012 T017 T027;
FR-013 T001 T022; FR-014 T006 T007; FR-015 T008; FR-016 T022; FR-017 T005; FR-018 T009 to T021; FR-019 T001 T023 T024
T025. Every success criterion has a test task, except SC-001 (under ten lines), which the documented examples show.

## Constitution

No violation. One reading is flagged for review: the Next.js warning is logged at the first request, not at process
start, because Next.js loads a route module lazily and only a request tells the helper its path (research 13).
