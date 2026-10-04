# Validation guide: State history

Commands that show the feature works. Run them from the repository root on the feature branch after
implementation. No model, key or outside server is needed.

## Prerequisites

Node 24 or newer, `npm ci --ignore-scripts`, and Playwright Chromium (`npx playwright install chromium`).

## Unit tests

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/conversation
```

Expect: the diff cases, the history cases (20 deltas with two snapshots, checkpoint boundaries at 63, 64, 65 and
130 deltas, unappliable deltas, starting state, first state), the projection additions and the 5,000-frame state
workload. The workload test prints the open time and the 95th percentile of 100 selections, both under their limits.

## End-to-end tests

```sh
npm run test:e2e -- tests/e2e/conversation tests/e2e/hosted --workers=2
```

Expect: both `state-history.spec.ts` files pass (`tests/e2e/conversation` and `tests/e2e/hosted`). It covers pointer and keyboard selection, the past-state banner and
"Back to latest", 100 live changes with a past point selected, a shortened long value, a 250-difference snapshot,
and export, reload and import with every point compared.

## By hand

1. `npm run build`, then serve `packages/inspector/dist` or use the demo build.
2. Pick the `state` example, send its quick message.
3. Open the State tab. The newest row is selected and the state is labelled "Current state".
4. Press Tab until the history list has focus. Press the down arrow. The state and diff change, and the banner says
   it is a past state. Press Home. The banner goes and the label returns to "Current state".
5. Press End. The oldest row shows. Press Tab to the frame reference and press Enter. The frames list shows that
   frame.
6. Press Export session in the Inspection tab and save the file. Browse the history. Export again. The two files are the same.
7. Import the file after a reload. The history and every point match.

## Gate

```sh
npm run check:ci
```

Includes the bundle budget (2,000,000 bytes minified, 600,000 gzipped) and the docs tests.
