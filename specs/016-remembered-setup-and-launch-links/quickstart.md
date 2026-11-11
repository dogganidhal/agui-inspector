# Quickstart: validate remembered setup and launch links

## Prerequisites

```sh
npm ci --ignore-scripts
npm run build
npx playwright install chromium
```

## Automated checks

```sh
npm run test:unit -- packages/inspector/tests/setup packages/inspector/tests/hosted
npm run test:e2e -- tests/e2e/hosted/launch.spec.ts
npm run check:ci
```

## By hand, against the reference agent

Serve the reference agent with the inspector the way the end-to-end tests do (see `website/content/docs/development.mdx`),
then:

1. **Reload keeps the setup.** Select `support`, set `userId` to `42` in Settings, reload. Expected: `support` is
   selected and `userId` is `42`. Type a token, reload. Expected: no token, and the browser's storage for the page holds
   no token and no header name.
2. **Full link.** Open the page with the example from [contracts/launch-link.md](contracts/launch-link.md). Expected:
   `support` selected, `userId` 42, the context and forwarded property in Settings, the message in the composer, a
   "Link" notice naming `agent`, `var.userId`, `context`, `forwardedProps` and `message`, and an address bar without
   the fragment. The frames list is empty: nothing was sent. Press send. Expected: the recorded run input carries the
   context, `tenant: "acme"` and `user_id: "42"`.
3. **Reload after a link.** Reload. Expected: the same setup, an empty composer, no notice.
4. **Bad link.** Open `#agent=nobody&context=%5B&message=hi`. Expected: two "Link" warnings (`agent`, `context`), the
   saved agent and context unchanged, `hi` in the composer.
5. **Credential refused.** Open `#token=SYNTHETIC-016&message=hi`. Expected: one warning about credentials, and
   `SYNTHETIC-016` appears nowhere on the page, in storage or in an exported session.
6. **Policy holds.** On an embedded page open `#endpoint=https://elsewhere.example/run`. Expected: the same refusal a
   typed endpoint gets, and no request to `elsewhere.example`.
7. **Second link in the same tab.** Paste a new link with a different `message` into the address bar. Expected: the page
   restarts and shows the new message.
