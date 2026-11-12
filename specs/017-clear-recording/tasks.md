# Tasks: Clear the recording

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[store contract](contracts/session-store.md), [view contract](contracts/inspection-view.md), [validation guide](quickstart.md).

**Format**: `T###` is one task. `[P]` touches files no other open task touches. `[USn]` maps to a user story. Tests come
before the code they cover and fail first.

**Rules**: no new dependency, no new `npm run` script, no change to the recorder, the runtime, the session format or the
connection view (spec 016 changes it in parallel). Docs use short plain sentences, no em dashes, no bold labels.

## Phase 1: Setup

- [ ] T001 Record a green baseline: `npm run typecheck` and `npm run test:unit -- packages/inspector/tests/frames packages/inspector/tests/inspection packages/inspector/tests/hosted`.

## Phase 2: Foundational

- [ ] T002 Add `clear(): void` to `SessionStore` in `packages/inspector/src/contracts.ts`, with the doc comment of the store contract.
- [ ] T003 Write failing tests in `packages/inspector/tests/frames/store.test.ts`: (a) after appends of every kind, `clear()` leaves a snapshot with the same `id` and empty `exchanges`, `runs`, `frames`, `findings` and `derived`, and the snapshot is a new object; (b) subscribers are told once through the scheduler, like an append; (c) after `clear()` the old ids are accepted again, frame indices start at 0 for a re-added exchange, a finding or derived entry that points at a cleared frame or run is refused; (d) a session serialized after a clear and new appends parses with `parseSession`.
- [ ] T004 Implement `clear()` in `packages/inspector/src/core/store/index.ts`: empty the five collections and their id sets, call `changed()`. T003 passes.

## Phase 3: User Story 1 and 2 - Clear without reloading, never during a live capture (P1)

- [ ] T005 Add to `InspectionViewProps` in `packages/inspector/src/contracts.ts`: optional `onClearSession()`, `clearBlocked?: string`, `pendingExport?()` returning `{ exchanges, frames } | undefined`.
- [ ] T006 [P] [US1] [US2] Write failing markup tests in `packages/inspector/tests/inspection/clear.test.tsx` (`renderToStaticMarkup` of `SessionControls`): without `onClearSession` there is no Clear session button; with it the button is named "Clear session"; with `clearBlocked` it is disabled and carries the reason as its description; without it, enabled.
- [ ] T007 [US1] [US2] In `packages/inspector/src/views/inspection/session.tsx` add the button after Import session, disabled with `title` set to `clearBlocked`. Pass the three props through `packages/inspector/src/views/inspection/index.tsx`. T006 passes.
- [ ] T008 [US1] [US2] In `packages/inspector/src/app/index.tsx`: `clearBlocked` from `state.capturing` and the live exchange count (research R3); `onClearSession` that refuses while `runtime.getState().capturing`, then `runtime.newThread()`, `live.clear()`, forgets the export marker, shows `live`, ends the recording and clears the inspection error.

## Phase 4: User Story 3 - Confirm before losing evidence (P2)

- [ ] T009 [US3] In `packages/inspector/src/app/index.tsx`: remember the live capture's exchange and frame counts when the live capture is exported; `pendingExport()` returns the live counts (data frames, as the export summary counts them) when the live capture is non-empty and differs from the marker.
- [ ] T010 [US3] In `session.tsx`: on press, call `pendingExport()`; undefined clears at once; counts open a "Clear this session" dialog naming them, saying clearing cannot be undone and Export session keeps a copy, with Cancel and Clear session.

## Phase 5: Imported recording (FR-008)

- [ ] T011 [P] Update the recording notice and banner in `packages/inspector/src/app/index.tsx` to name Clear session instead of a reload, and the matching assertion in `packages/inspector/tests/hosted/app.test.tsx`.

## Phase 6: End to end

- [ ] T012 Write `tests/e2e/hosted/clear.spec.ts` against the assembled app and the reference agent: (a) empty page: Clear session disabled, described "Nothing to clear"; (b) set a token, run the reference agent twice, press Clear session: the confirmation names the counts, Cancel keeps everything; confirm: frames list, waterfall, conversation and State view are empty and the footer counts are zero; the next message is recorded with exchange and frames, carries the token, a new `threadId` and no earlier message; (c) export, then Clear session clears at once with no dialog; (d) with the reference agent's slow pace, Clear session is disabled and described "Stop the run first" while the reply streams; after Stop it is enabled; (e) import an exported file, Clear session closes it and the composer sends again; (f) no request outside the allowed origins.

## Phase 7: Docs and release

- [ ] T013 [P] `website/content/docs/runs.mdx`: a Clear session bullet under Stop, New thread and quick messages; add `Clear session` to the phrases in `packages/inspector/tests/runtime/docs.test.ts`.
- [ ] T014 [P] `website/content/docs/inspection.mdx`, `recordings.mdx`, `hosted.mdx`, `troubleshooting.mdx`: Clear session in the header controls, and as the way to leave a recording.
- [ ] T015 [P] `ROADMAP.md`: a 0.3.0 row for this feature.
- [ ] T016 [P] `.changeset/clear-session.md`: minor for `agui-inspector` and `agui-inspector-python`.
- [x] T017 `npm run check:ci`.

## Dependencies

T002 before T003 and T004. T005 before T006 to T010. T007 before T010. T008 before T009 and T012. T012 after T004 to T011. T013 to T016 any time. T017 last.
