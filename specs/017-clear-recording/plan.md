# Implementation Plan: Clear the recording

**Branch**: `worktree/clear-recorded-frames-6ce54d` | **Date**: 2026-11-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-clear-recording/spec.md`

## Summary

A Clear session button in the inspection pane header, next to Export session and Import session. It empties the live capture through a new `clear()` on the session store, starts a new thread through the runtime's existing `newThread()`, and closes an imported recording if one is open. It is disabled while anything is still being recorded and when there is nothing to clear. It asks for confirmation only when the live capture changed since its last export. No new dependency, no new module.

## Technical Context

**Language/Version**: TypeScript (strict, `erasableSyntaxOnly`), Node 24 for tooling

**Primary Dependencies**: React (views), existing theme primitives (`Button`, `Dialog`, `Finding`, `Icon`). Nothing added.

**Storage**: none. The capture lives in memory; clearing writes nothing to browser storage.

**Testing**: `node --test` unit tests (store, view markup, app markup), Playwright end-to-end in `tests/e2e/hosted` against the assembled app and the reference agent's interactive scenarios.

**Target Platform**: the one static bundle, every mode (hosted, embedded, CLI, demo).

**Project Type**: browser developer tool (static web bundle plus server helpers).

**Performance Goals**: clearing a 5,000-frame capture is one synchronous call and one batched notification. The page root does not subscribe to the store, so capture throughput is unchanged.

**Constraints**: principle I (no frame of a live stream dropped), principle IV (no request, no storage), bundle budget (the change is a few hundred bytes).

**Scale/Scope**: about 8 source and test files, 6 docs pages.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
| --- | --- | --- |
| I. The wire comes first | Clearing is refused while any request is sent or any response is recorded (`capturing`), so no live frame is dropped, cut or reordered. A clear is a deliberate removal of finished evidence by the developer, the same as a reload today. Recorded frames are never repaired or reordered. | Pass |
| II. The protocol, not a framework | No protocol code changes. `clear()` sits in the framework-free store; the button in the React view. | Pass |
| III. Generic core | Nothing server-specific. | Pass |
| IV. Local-only, credential privacy | Clearing makes no request and writes no storage. The token stays in memory as before; it is not touched, logged or shown. | Pass |
| V. Small and auditable | No dependency. One store method, one runtime call already there, optional view props. | Pass |
| VI. Every event type has a view | Unchanged. | Pass |
| Quality gates | Store unit tests, view and app markup tests, an end-to-end test against the reference agent, docs updated, `npm run check:ci`. | Pass |

Post-design re-check: same result. The design adds no new state that outlives a clear except the export marker, which is reset by the clear.

## Design

### Store (`packages/inspector/src/core/store/index.ts`, `contracts.ts`)

`SessionStore.clear(): void` empties exchanges, frames, findings, runs and derived entries and their id sets, drops the cached snapshot and notifies subscribers (batched like every append). The session id stays. After a clear every invariant check behaves as on a new store. Ids are not reused in practice because the recorder and runtime counters keep counting (research R2).

### Runtime

No change. `newThread()` already stops open connections (a no-op when nothing is capturing), makes a new thread, drops waiting interrupts and tool results, the automatic reply streak and the error, and emits.

### App (`packages/inspector/src/app/index.tsx`)

- `onClearSession`: refuses when `runtime.getState().capturing`; otherwise `runtime.newThread()`, `live.clear()`, forget the export marker, show `live`, close the recording, clear the inspection error.
- `clearBlocked`: "Stop the run first: a response is still being recorded" while `state.capturing`; "Nothing to clear" when no recording is open and the live capture has no exchange; otherwise absent. Read during render: every exchange is created while capturing, and the end of a capture emits a runtime change that re-renders the page (research R3).
- Export marker: when the live capture is exported, remember its exchange and frame counts. `pendingExport()` returns the counts to confirm when the live capture is non-empty and differs from the marker.
- The recording notice and banner say "Clear session" instead of "Reload the page".

### View (`packages/inspector/src/views/inspection/session.tsx`, `index.tsx`, `contracts.ts`)

`InspectionViewProps` gets three optional members: `onClearSession`, `clearBlocked`, `pendingExport`. Without `onClearSession` no button shows (tests and hosts that render the view alone stay as they are). The button's accessible name is "Clear session"; when blocked it is disabled and its accessible description is the reason. Pressing it calls `pendingExport()`: nothing pending clears at once; otherwise a "Clear this session" dialog names the exchanges and frames not exported and says clearing cannot be undone, with Cancel and Clear session.

### Docs

- `runs.mdx`, Stop, New thread and quick messages: a Clear session bullet. Its docs test gains the phrase.
- `inspection.mdx`: the header controls line names Clear session.
- `recordings.mdx`, `hosted.mdx`, `troubleshooting.mdx`: "reload the page" for leaving a recording becomes Clear session.
- `ROADMAP.md`: a 0.3.0 row for this feature.

### Release

One changeset, minor, for `agui-inspector` and `agui-inspector-python` (the wheel ships the bundle).

## Project Structure

### Documentation (this feature)

```text
specs/017-clear-recording/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── session-store.md
│   └── inspection-view.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
packages/inspector/src/contracts.ts                     # SessionStore.clear, InspectionViewProps additions
packages/inspector/src/core/store/index.ts              # clear()
packages/inspector/src/app/index.tsx                    # wiring, export marker, notice text
packages/inspector/src/views/inspection/index.tsx       # pass props to SessionControls
packages/inspector/src/views/inspection/session.tsx     # button and confirmation dialog
packages/inspector/tests/frames/store.test.ts           # store clear tests
packages/inspector/tests/inspection/                    # view markup test
packages/inspector/tests/hosted/app.test.tsx            # notice text
tests/e2e/hosted/clear.spec.ts                          # end to end
website/content/docs/{runs,inspection,recordings,hosted,troubleshooting}.mdx
ROADMAP.md, .changeset/*.md
```

**Structure Decision**: the existing layout. The button joins `SessionControls` because the connection view is being changed by spec 016 in parallel.

## Complexity Tracking

None.
