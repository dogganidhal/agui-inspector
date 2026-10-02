# 5,000-frame benchmark profile

This is the measurement protocol for SC-009. It restates the fixed profile in
[plan.md](../../specs/001-inspector-mvp/plan.md#fixed-5000-frame-benchmark); if the two ever differ, the
plan wins. Changing anything here needs explicit plan review before a measurement is taken.

**Status: pending.** The fixture and the bundle budget exist (slice F03). The browser measurement does
not: the benchmark UI and the Playwright interaction test arrive with slice L04. Until a run on the
runner below passes every rule in [Verdicts](#verdicts), SC-009 is not passed. `npm run test:benchmark`
says so explicitly and `-- --strict` exits non-zero while it holds.

## What counts as a measurement

Only an elapsed time measured in the real browser UI counts. It starts at the trusted Playwright
input event handler and ends when React has committed the expected filtered list or expanded raw text
and a following paint opportunity has passed (two nested `requestAnimationFrame` callbacks), with the
visible DOM content checked by Playwright. Parsing, filtering and UI scheduling are inside the interval.

These never count: a timer around a reducer or store call, a Node benchmark, a headless run on other
hardware, a run with throttling, or a run that pauses capture, swaps the retained data for rendered
rows only, or drops slow samples.

## Required runner

| Item | Requirement |
| --- | --- |
| Machine | Dedicated Apple Mac mini M2, 8 CPU cores, 16 GB RAM |
| OS | macOS 15.7, plugged in |
| Load | No CPU or network throttling and no concurrent workloads |
| Browser | Headed Chromium 153.0.8010.12 (Chrome for Testing revision 1243), foreground window, fresh browser context, no extensions |
| Driver | Playwright 1.63.0 (`@playwright/test`, exact pin in `package.json`) |
| Viewport | 1440x900, device scale factor 1 |
| Build | Production build with the full bundled A2UI renderer (`npm run build`) |
| Origins | The page and the reference agent on two loopback origins, with explicit CORS and allowlist permission, so browser-to-SSE behavior is isolated |

Record the actual hardware model, OS, browser and Playwright versions with every result. A different
machine or browser reports timings but is not the release measurement. CI runs the same fixture and
checks counts and hashes, but it cannot certify the 200 ms threshold.

## Workload

The fixture is `tests/benchmarks/generate.ts` (seed `001`), frozen in `tests/benchmarks/manifest.json`:
ten sequential exchanges of 500 original SSE data frames, 5,000 in all (4,900 schema-valid, 100 invalid
or unknown), covering all 31 baseline event types. Eight exchanges finish (success, interrupt,
cancellation) and two end with `RUN_ERROR`. The server sends 50 frames per second for 100 seconds, with
LF, CRLF and CR line endings in the planned 60/30/10 split. Every tenth schema-valid frame uses two
`data` lines. The byte chunks cycle through 1, 7, 64 and 4096 bytes across each frame's envelope, and
each scheduled frame is flushed without compression or coalescing. Offsets use `performance.now()`
relative to request dispatch.

Interactions start at t=20 s and run every 400 ms through t=99.6 s: 100 filter changes alternating with
100 raw-frame expansions.

| Class | Count | Selection |
| --- | ---: | --- |
| Filter change | 100 | Cycle 34 type selections, 33 substring searches, 33 issue toggles |
| Raw-frame expansion | 100 | Cycle normal, malformed and 16 KiB payload frames that have already arrived; scroll the chosen row into view before timing |

The last 50 interactions happen with at least 4,000 frames retained. Filtering and expansion stay
keyboard-accessible.

## Run procedure

1. One warm-up run, identical to a measured run, whose results are discarded.
2. Three complete measured runs.
3. For each run record, per class: 100 samples, p95, maximum and the percentage at or under 200 ms.
4. For each run record the retained frame count, the ordered raw hashes, the actual arrival timing and
   the peak heap. Peak heap is diagnostic only; there is no memory threshold.

## Verdicts

A run passes only if all of these hold:

| Rule | Threshold |
| --- | --- |
| Filter changes | At least 95 of 100 visibly complete within 200 ms |
| Raw-frame expansions | At least 95 of 100 visibly complete within 200 ms |
| Retained frames | Exactly 5,000 original data frames (chunk expansions and keepalive comments do not count) |
| Order and hashes | The retained frames match the manifest in order: each exchange's raw text hashes to its `sha256` |

SC-009 passes only when all three measured runs pass on the required runner and the bundle budget
(`npm run build && npm run check:bundle`) passes. Any of these is a not-passed or pending verdict:
a failed class, a missing sample, a count or hash mismatch, a different runner, a different profile, or
no measurement at all. Samples are never removed to reach the threshold.

## Out of scope

The 50,000-frame profile defined in the plan is a 1.0.0 acceptance definition. It has no fixture, no
script and no task in the 0.1.0 MVP.
