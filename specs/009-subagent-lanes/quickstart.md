# Quickstart: Subagent lanes and timeline

How to see the feature work and how to run each check. Contracts are in
[contracts/lanes-and-timeline.md](contracts/lanes-and-timeline.md), the data in [data-model.md](data-model.md).

## Prerequisites

Node 24 or newer, then `npm ci --ignore-scripts` from the repository root. Playwright needs Chromium once:
`npx playwright install chromium`.

## See it

1. `npm run build`, then serve the bundle with the reference agent the way the development docs describe, or open the
   fixture page that `tests/e2e/conversation/lanes.spec.ts` serves.
2. Connect to the reference agent and send the message `subagents`.
3. In the conversation you see a subagent timeline above the transcript. It has one chart for the run: a row for the run,
   then one row for each subagent, nested rows indented. Two subagents overlap on the axis. One ends with `✕` and the
   word Error.
4. Below it, each subagent is a lane. The nested one sits inside its parent's lane. Collapse a lane: its header keeps the
   status and the counts.
5. With the keyboard only: Tab to the timeline, press ArrowDown to the nested subagent, press Enter. The conversation
   scrolls to its lane and focus is on the lane's toggle. Press Tab to "Show in timeline" and Enter: focus returns to the row.
6. Export the session, reload, import it. The same lanes and the same timeline show, and the page says it is inspection
   only.

## Run the checks

| What | Command |
| --- | --- |
| Projection, derivation, markup | `npm run test:unit -- packages/inspector/tests/conversation` |
| Everything unit | `npm run test:unit` |
| Types | `npm run typecheck` |
| Fixture page, keys, live and gaps | `npm run test:e2e -- tests/e2e/conversation/lanes --workers=2` |
| Whole app: live run, export, import | `npm run test:e2e -- tests/e2e/conversation/lanes-app --workers=2` |
| The 0.1.0 marker checks still pass | `npm run test:e2e -- tests/e2e/conversation/events --workers=2` |
| Bundle | `npm run build` then `npm run check:bundle` |
| The full gate | `npm run check:ci` |

## What each check proves

- `lanes.test.ts`: SC-001, SC-002, and the status, gap and snapshot rules (FR-001 to FR-009).
- `timeline.test.ts`: SC-003, and the row order and axis rules (FR-010, FR-011).
- `lanes-view.test.tsx`: names, statuses without color, the row limit (FR-012, FR-015, FR-016, SC-005).
- `lanes-workload.test.ts`: SC-006.
- `lanes.spec.ts`: SC-004, SC-005 (contrast), SC-007 and SC-008, the jumps and the live behavior (FR-014, FR-017).
- `lanes-app.spec.ts`: SC-009 and SC-010, and that no request leaves the page's allowlist.
- `lanes-docs.test.ts`: SC-012.
