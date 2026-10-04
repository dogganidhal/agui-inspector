# Analysis: command line inspector with a local proxy

`/speckit-analyze` over `spec.md`, `plan.md` and `tasks.md`, run on 2026-10-04 after the first full draft. It changes no
file, so the fixes below were made by hand. Result: no critical finding, two high findings, three medium and two low,
all fixed.

## Findings

| ID | Severity | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| A1 | High | plan Design, proxy contract, tasks T017 | The design relied on a server with no `upgrade` listener to refuse upgrade requests. A spike on Node.js 26.9 showed that Node then serves such a request as an ordinary request (it got a 200), so FR-013 would have failed T016. | The server registers `connect` and `upgrade` listeners that answer 403 and end the socket. Plan, research 5, the proxy contract and T017 say so, and FR-013 asks for a 403. |
| A2 | High | tasks T002 | T002 made `buildServer()` fail when the `bin` target is missing, but `main.ts` only exists after T010. Every build and `npm run check:ci` between the two tasks would fail. | The build check moved to T010. T002 only adds the manifest entry and the `tsc` include. |
| B1 | Medium | spec FR-006, command line contract | FR-006 said the command prints one line, and the contract prints one line for the address and one for each target. | FR-006 says one line for the address and one for each target. |
| B2 | Medium | spec FR-014, constitution IV | "Not in anything the page can read" collides with the rule that bytes a target repeats are evidence and stay unchanged. | FR-014 limits the promise to what the command itself writes and says that a target's own echo is relayed unchanged. |
| C1 | Medium | spec FR-016, tasks | No task checked that the command makes no request of its own and no update check. | T035 adds a source scan: no `fetch`, DNS, child process or file write in `src/cli`, and `http.request` only in `proxy.ts`. T012 already checks that the target sees exactly the page's requests. |
| C2 | Medium | spec FR-012, tasks T013 | A connection cut before the response headers (502) was in the spec and in no test. | T013 adds a target that destroys the socket before it writes a header. |
| C3 | Low | spec FR-002, tasks T004 | No test showed that no option sets the listening address. | T004 adds `--host` to the unknown options. |
| D1 | Low | tasks T036 | The new docs page was only checked by the existing tests that read the docs, not by the docs site build. | T036 builds the docs site, or says that it could not. |

## Coverage

Every requirement has at least one task: FR-001 T002 T003 T010 T030 T031; FR-002 T004 T005; FR-003 T004 T005 T028 T030;
FR-004 T004 T005; FR-005 T004 T005 T026; FR-006 T008 T009 T010 T021 T028; FR-007 T001 T008 T009; FR-008 T008 T009 T012;
FR-009 T006 T007 T008 T009 T016 T017; FR-010 T006 T007 T013 T015; FR-011 T006 T007 T022 T023; FR-012 T013 T014 T015 T030;
FR-013 T016 T017 T019 T020 T021; FR-014 T022 T024 T025; FR-015 T013 T024 T029; FR-016 T012 T035; FR-017 T028 T029;
FR-018 T028 T030; FR-019 T004 T028 T029 T030; FR-020 T003 T035 T036; FR-021 every test task; FR-022 T031 to T034.
Every success criterion has a test task: SC-001 T012 and the by-hand run of T036; SC-002 T012; SC-003 T013 T015; SC-004 T013;
SC-005 T016 T019; SC-006 T008 T019 T021; SC-007 T024 T025; SC-008 T003 T035; SC-009 T031 T036.

## Constitution

No violation. Two readings are flagged for review:

- The constitution says other modes must not send cookies. The page keeps its embedded policy, so it may send same-origin
  cookies to the listener, and the proxy removes `Cookie` and `Set-Cookie`. No cookie reaches a target and none of a
  target's lands in the browser's `localhost` jar.
- The constitution asks embedded helpers to log a warning when they mount. The command is an explicit run, not a mount in a
  host, so the rule does not apply. It prints the address and the targets at startup.

## Notes for the maintainer

- `npx agui-inspector` installs every runtime dependency of the package (React, the A2UI renderer and others), although
  the command uses none of them: the page is prebuilt. Moving them to development dependencies is outside this feature and
  would need its own spec.
- The spikes ran on Node.js 26.9. CI uses Node.js 24, and the tests are the check that the behavior holds there.
