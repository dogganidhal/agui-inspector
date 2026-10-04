# Quickstart: Run waterfall

How to see the feature work, by hand and by test. Run from the repository root with Node 24 or newer.

## By hand

1. `npm ci --ignore-scripts && npm run build`
2. Start the page with a scripted agent, for example the interactive server through the e2e fixtures, or the public
   demo build. Send the message `tools`, then `never finishes`, then press Stop.
3. Open Inspection, then the Waterfall tab.
   - The newest run is open. Its message has an open bar tagged "no end seen" or, before Stop, "running".
   - The `tools` run shows two tool calls tagged "waiting for result".
   - Older runs are closed. Press the right arrow on one to open it.
4. Press Tab until the tree has focus, then ArrowDown, ArrowRight, ArrowLeft, Home and End. The details area follows
   focus. Press Enter on a tool call: the Frames tab opens on its first frame.
5. Export the session, reload, import it. The waterfall shows the same rows and times.

## By test

```sh
npm run test:unit -- packages/inspector/tests/inspection                # builder, keys, markup, workload, docs, styles
npm run test:e2e -- tests/e2e/inspection/waterfall.spec.ts --workers=2  # keyboard, live growth, workload
npm run test:e2e -- tests/e2e/hosted/waterfall.spec.ts --workers=2      # real app, export, import, no requests
npm run check:ci                                                        # the whole gate, including the bundle budget
```

## What to check against the spec

| Spec | Where to look |
| --- | --- |
| SC-001 | `waterfall.test.ts`, the delegation run: each written time equals a frame offset |
| SC-002 | `waterfall.test.ts`: nested subagents, a missing parent, a cycle |
| SC-003 | `waterfall.test.ts`: streaming, stopped, no terminal event, finished with an unended message |
| SC-004 | `waterfall.spec.ts`: keyboard only |
| SC-005 | `waterfall.spec.ts`: live growth |
| SC-006, SC-007 | `hosted/waterfall.spec.ts`: export, import, no requests, identical export |
| SC-008 | `waterfall-workload.test.ts` and `waterfall.spec.ts`: workload |
| SC-009 | `npm run check:bundle` after `npm run build` |
| SC-010 | `waterfall-view.test.tsx` and the contrast check in `waterfall.spec.ts` |
| SC-011 | `waterfall-docs.test.ts` |
