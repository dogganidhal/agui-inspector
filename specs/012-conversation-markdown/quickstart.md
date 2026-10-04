# Quickstart: validating Markdown in the conversation

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Contract**: [contracts/markdown.md](contracts/markdown.md)

Run everything from the repository root. Node 24 or newer.

## Prerequisites

```sh
npm ci --ignore-scripts
npx playwright install chromium   # once, for the end-to-end checks
```

## See it

```sh
npm run build
npm run package:python           # optional: the embedded helper serves the same bundle
```

Serve `packages/inspector/dist` with any static server, or use the repository's reference agent through the end-to-end support. Then:

1. Open the page. The conversation shows `Message text: Plain text | Markdown`, with Plain text pressed.
2. Send a message to an AG-UI server whose reply contains Markdown (the whole-app test uses the reference agent's `markdownRunResponse`). The reply shows as typed.
3. Press Markdown. Headings, a list, a table, a code block and a link show formatted. The link's address shows next to it.
4. Press Plain text. The reply is exactly the text received.
5. Open the frames list. The frames are the same in both modes.

## Run the checks

```sh
npm run test:unit -- packages/inspector/tests/conversation        # constructs, safety samples, limit, scope, timing, docs
npm run test:e2e -- tests/e2e/conversation/markdown.spec.ts --workers=2   # fixture page: toggle, keyboard, streaming, hostile samples
npm run test:e2e -- tests/e2e/conversation/markdown-app.spec.ts --workers=2   # whole app: live run, export, import
npm run typecheck
npm run build && npm run check:bundle                                       # SC-006
npm run check:ci                                                            # the full gate
```

## Expected outcomes

| Check | Expected |
| --- | --- |
| Default | A fresh page shows `Plain text` pressed, and every message equals its received text. |
| Constructs | Each construct of the contract table renders as listed. |
| Hostile samples | At least 15 samples: zero script runs, zero requests outside the permitted targets and the page's origin, zero `securitypolicyviolation` events. |
| Scope | A `tool` role message and everything outside message and reasoning text is unchanged in Markdown mode. |
| Recording | The SHA-256 of the recorded frames, and the exported session bytes, are identical before, during and after toggling. |
| Keyboard | Tab to the control, Enter turns Markdown on, Tab reaches a link and a wide code block and table, Space turns Markdown off. No pointer. |
| Live and import | A streaming message grows formatted. After export and import the same messages render the same. The mode survives the import. |
| Limit | A 200,001 character message shows plain text and the note. A 200,000 character one formats. |
| Timing | The 5,000-frame workload formats in under 1 second, and a message at the limit in under 200 ms. The numbers print in the test log and are copied into research R9. |
| Bundle | `check:bundle` passes. The added bytes, minified and gzipped, go in the pull request. |
