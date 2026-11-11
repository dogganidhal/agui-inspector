# Quickstart: Clear the recording

Prerequisites: `npm ci --ignore-scripts`, `npx playwright install chromium`.

## Automated

```sh
npm run test:unit -- packages/inspector/tests/frames/store.test.ts packages/inspector/tests/inspection packages/inspector/tests/hosted packages/inspector/tests/runtime/docs.test.ts
npm run build && npm run test:e2e -- tests/e2e/hosted/clear.spec.ts
npm run check:ci
```

## By hand

1. Run the reference agent and the page (see the development docs), pick the reference agent, set a token.
2. Send two messages. Clear session is enabled.
3. Press Clear session. A dialog names the exchanges and frames not exported. Cancel: nothing changes.
4. Export session, then press Clear session: everything empties at once, no dialog.
5. Check the conversation, State view, frames list and waterfall are empty, and the token and agent are still set. Send a message: it is recorded as on a fresh page, with a new `threadId`.
6. Send `slow`. While it streams, Clear session is disabled and says to stop the run first. Press Stop: it becomes enabled.
7. Import an exported file. Press Clear session: the recording closes and the composer sends again.
