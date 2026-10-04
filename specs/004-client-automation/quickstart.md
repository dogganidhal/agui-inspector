# Validation guide: Client automation

**Status**: Acceptance commands for the implementation. This planning change runs none of them.

## Prerequisites

Node 24 or newer, `npm ci --ignore-scripts`, and Chromium for Playwright (`npx playwright install chromium`). No model, no
API key and no outside server: every end-to-end test talks to `examples/reference-agent`.

## Fast checks while implementing

```sh
npm run typecheck
npm run test:unit -- packages/inspector/tests/runtime packages/inspector/tests/config packages/inspector/tests/conversation packages/inspector/tests/foundation
npm run test:unit -- tests/demo
npm run test:e2e -- tests/e2e/runtime/automation.spec.ts --workers=2
npm run test:e2e -- tests/e2e/config --workers=2
```

The full gate before the pull request is ready:

```sh
npm run check:ci
```

## What to look at, by user story

### US1 and US2: answering without clicking

1. Open the public demo or the hosted example. In Settings, set Interrupt replies to Resolve. (The runtime e2e page has no Settings panel; its tests set the profile directly.)
2. Select the reference agent and press the `interrupt` quick message.
3. Expect: no reply card stays open, a second run appears at once, and the agent's text reads
   `Resumed with i-approve=resolved:{"approved":false,"note":""}, i-contact=resolved:{}`.
4. Set Interrupt replies to Cancel and repeat. Expect `i-approve=cancelled, i-contact=cancelled`.
5. Add the tools `pick_color` and `pick_size`, give each a scripted result, and press the `tools` quick message. Expect
   `Tool results: c-color=<text>, c-size=<text>` with the text exactly as written.
6. Clear the script of `pick_size` and repeat. Expect the `pick_size` card to wait, the `pick_color` card to show
   `Automatic`, and the second run to start only after `Submit result` for `pick_size`.

The automated version asserts the second request body against the one a manual reply sends. Unit tests use a fixed
identifier source and compare the two bodies with `assert.deepEqual`. The e2e test compares them after replacing the
generated identifiers.

### US3: the marks

1. After step 3 above, read the conversation. The continuation run shows `Carried: resume · 2 answers automatic · i-approve, i-contact`.
2. After step 5, the tool results read `Result · automatic`.
3. Answer one run by hand. Expect no mark on it.
4. Export the session, reload, import it. Expect the same marks. Import a 0.1.0 session file. Expect it to load with no marks.

### US4: the profile

1. Set a mode and two scripts, press Export profile, reload the page, press Import profile with that file.
2. Expect the same settings in the panel and in `localStorage` under `agui-inspector.profile`, and `"version": 0` in the file.
3. Import a 0.1.0 profile file. Expect it to load and every reply to stay by hand.
4. Import a file with `"interruptReply": "manual"`, then one with `"toolResults": { "nope": "x" }`. Expect a visible error that
   names the field, and the profile in use unchanged.

### US5: the limit

1. Set Interrupt replies to Resolve.
2. Send `interrupt forever` (type it, it is not a quick message).
3. Expect 11 runs in the recording (the message and 10 automatic continuations), then a notice:
   `1 interrupt waiting. Answer it to continue the run. Automatic replies paused after 10 in a row. Answer by hand to continue the run.`
4. Press Resolve on the waiting card. Expect run 12, and then up to 10 more automatic runs.
5. Press Stop while a chain runs. Expect no further run.

## Requirement coverage

| Requirement | Where it is checked |
| --- | --- |
| FR-001 to FR-004 | `settings.test.ts` (validation, export, import, load), `settings-view.test.tsx` (controls), `settings.spec.ts` (e2e panel) |
| FR-005 to FR-008 | `replies.test.ts` (`automate`), `runtime.test.ts` (chains, equality, settings at run end), `automation.spec.ts` |
| FR-009, FR-010 | `runtime.test.ts` (mixed run, failed preparation, retry), `automation.spec.ts` (mixed run) |
| FR-011 | `runtime.test.ts` (surface action untouched) |
| FR-012 to FR-015 | `runtime.test.ts` (limit, reset, pause notice, Stop), `automation.spec.ts` (`interrupt forever`) |
| FR-016, FR-017 | `projection` and `connection-view` tests, session export and import test, `automation.spec.ts` |
| FR-018 to FR-020 | `settings.test.ts`, `contracts.test.ts` (no credential field) |
| FR-021 | the docs test for `runs.mdx` and a read of the pages |
| FR-022 | the files above plus `npm run check:ci` |
| SC-007 | the network allowlist assertion every runtime e2e test already makes |
