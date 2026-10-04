# Implementation Plan: Markdown rendering of the conversation

**Branch**: `gh-79-conversation-markdown` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: `specs/012-conversation-markdown/spec.md`, issue [#79](https://github.com/dogganidhal/agui-inspector/issues/79), and the 0.2.0 roadmap (item 7).

**Status**: Planning. Implementation starts after the maintainer approves the spec and this plan.

## Summary

Add a "Message text" control to the conversation, with two states: Plain text (the default) and Markdown. In Markdown, the text of messages (roles `assistant`, `user`, `system`, `developer`) and of reasoning shows formatted. Everything else in the conversation stays as it is.

The parser is `markdown-it`, which the A2UI packages already pull in. It becomes a direct dependency at the same exact version the lockfile already resolves, so no new package enters the tree. The view walks the parser's token list and builds React elements. There is no HTML string and no sanitizer: the output can only hold the elements and attributes the walker creates, links go through one allowlist, and images are never loaded. [research.md](research.md) explains why this beats `@a2ui/markdown-it` (inline styles break the content security policy, images load, relative links pass, and it is async and DOM-only).

The change is a view change. The recording, the projection, the session format and the network are untouched. New code is in new files. The conversation view gets a few small edits so the work of the other #79 views merges without trouble.

## Technical Context

**Language/Version**: Strict TypeScript 7.0.2 with `noUncheckedIndexedAccess` and `erasableSyntaxOnly`, React 19.3.0, Node 24 or newer.

**Primary Dependencies**: Existing exact-pinned packages, plus `markdown-it` 14.3.2 as a direct runtime dependency of `packages/inspector`. It is already in `package-lock.json` through `@a2ui/react` and `@a2ui/markdown-it`, so the lockfile gains one line and no package. No new development dependency: the types are a local declaration file.

**Storage**: None. The mode is React state and resets on reload. Nothing is written to profiles, configuration, sessions or browser storage.

**Testing**: `node --test` through the repository's esbuild runner with `renderToStaticMarkup` (no DOM needed), and Playwright on Chromium: the conversation fixture page for views, and the whole app against `examples/reference-agent` for a live run and an imported session.

**Target Platform**: The one static bundle: hosted, embedded and npm assets. No mode-specific code.

**Project Type**: Static browser app, React views over framework-free core.

**Performance Goals**: SC-005. Turning Markdown on formats the 5,000-frame workload in under 1 second. A message at the length limit formats in under 200 ms. Measured by the workload test and recorded in [research.md](research.md) R9.

**Constraints**: Production bundle at most 2,000,000 bytes minified and 600,000 bytes gzipped, with the parser adding about 149,000 and 52,600 before our own code (R1). Content security policy unchanged: scripts from the page's own origin, no `eval`, no inline styles, `img-src 'self' data:`. No request caused by rendering. No new theme property or token (`T/styles.test.ts` keeps checking the stylesheet).

**Scale/Scope**: One new view module, small edits in one existing view and one stylesheet, one reference-agent scenario, tests, docs, notices and one changeset. No change to `src/core`, `src/app`, `contracts.ts` or any format.

## Constitution Check

*GATE: passes before Phase 0 and after Phase 1 design (constitution 1.2.0).*

| Rule | Assessment and evidence |
| --- | --- |
| I: the wire comes first | Pass. Rendering reads `MessageEntry.text` and `ReasoningEntry.text` from the projection and never writes. Frames, order, timing, deltas, chunk tags and frame references show in both modes. A test hashes the recorded frames and the session export before, during and after toggling (SC-003). |
| II: the protocol, not a framework | Pass. No chat framework, no change to the protocol client or the A2UI renderer. `markdown-it` is a text parser. `src/core` and `contracts.ts` get no change and stay free of React. |
| III: generic core, application presets | Pass. Nothing server-specific. The new reference-agent scenario is a test fixture. |
| IV: local-only and credential privacy | Pass. Rendering makes no request. Images are never loaded. A link opens only when the developer activates it, in a new tab with no opener and no referrer. That is user navigation, not a request the page makes, and it is documented as such. Nothing is stored, so no credential can reach storage. Exports are unchanged. |
| V: small and auditable | Pass with one documented addition. `markdown-it` 14.3.2: exact pin, committed lockfile, a row in `dependencies.mdx` giving the purpose and the rejected alternatives (R1, R2), no lifecycle scripts. It adds no new package to the lockfile. Types are a 25-line local file, not three new development packages (R3). No speculative abstraction: one module, one control. |
| VI: every event type has a view | Pass. No event type is added or removed. The message and reasoning views keep their fixtures. New tests feed Markdown text through `TEXT_MESSAGE_*`, `TEXT_MESSAGE_CHUNK`, `REASONING_MESSAGE_*` and a `MESSAGES_SNAPSHOT` message. Encrypted reasoning is untouched and not decoded. |
| Architecture: one static bundle, CSP | Pass. The page's policy is unchanged. The walker creates no inline style (alignment is a `data-align` attribute read by a stylesheet rule), no script and no active element. No `eval` or `new Function` (the existing test over `src` still passes). |
| Quality gates | Pass. Regression tests per FR-018, `npm run check:ci`, the bundle check (SC-006), and a docs test. The 50,000-frame, WCAG audit and format-version items in the constitution are 1.0.0 gates, and no 1.0.0 is planned. Keyboard use and native semantics are still built and tested here. |
| Release scope | Pass. Accepted 0.2.0 scope: issue #79, roadmap item 7. Only released features are used. Formats stay at version 0 with no change. |

No violation, so the complexity table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/012-conversation-markdown/
├── spec.md
├── plan.md              # this file
├── research.md          # decisions R1 to R12
├── data-model.md        # text mode, format result, link and element rules
├── quickstart.md        # how to see it and how to run each check
├── contracts/
│   └── markdown.md      # the control, scope, element mapping, safety rules, notes
├── checklists/
│   └── requirements.md
└── tasks.md             # from /speckit-tasks
```

### Source code (repository root)

```text
packages/inspector/
├── package.json                                   # + "markdown-it": "14.3.2"
├── src/views/conversation/
│   ├── markdown.tsx                               # NEW: mode context, control, text component, token walker
│   ├── markdown-it.d.ts                           # NEW: the parts of markdown-it the walker uses (referenced from markdown.tsx)
│   ├── index.tsx                                  # EDIT, small: two text lines, toolbar and provider, header comment
│   └── conversation.css                           # EDIT: one block of .agui-md-* rules, after the Reasoning rules
└── tests/conversation/
    ├── hostile.ts                                 # NEW: the hostile samples, shared with the browser spec
    ├── markdown.test.tsx                          # NEW: constructs, safety, limit, scope, timing
    └── docs.test.ts                               # EDIT: the new claims

examples/reference-agent/scenarios.ts              # EDIT: one exported producer, `markdownRunResponse` (not a SCENARIOS entry)
tests/e2e/conversation/markdown.spec.ts            # NEW: fixture page: toggle, keyboard, streaming, hostile samples, unchanged recording
tests/e2e/conversation/markdown-app.spec.ts        # NEW: whole app against the reference agent: live run, export, import

website/content/docs/event-views.mdx               # EDIT: replace "Plain text" with "Markdown"
website/content/docs/dependencies.mdx              # EDIT: runtime row, DOMPurify paragraph
THIRD_PARTY_NOTICES.txt                            # EDIT: six packages become "bundled"; copies in both packages stay identical
.changeset/<name>.md                               # NEW: minor for agui-inspector and agui-inspector-python
package-lock.json                                  # one line in the packages/inspector entry
```

**Structure Decision**: One new module in the existing conversation view folder, next to `shared.tsx` and `state.tsx`. It uses the view's own context pattern (`RevealProvider`) and the existing `SegmentedControl` and `CodeBlock` primitives. No new folder, no `core` module, because the parser output never leaves the view.

## Design

The detail is in [contracts/markdown.md](contracts/markdown.md) and [data-model.md](data-model.md). In short:

1. `ConversationView` holds `mode` in `useState('plain')` and renders a toolbar with the segmented control above the entries, inside a `MarkdownModeProvider`.
2. `MessageBlock` and `ReasoningBlock` replace `{entry.text}` with `<ConversationText text={entry.text} role={entry.role} />` (reasoning passes no role). Their body `div` keeps its classes, so streaming carets, role styles and delta lists do not change.
3. `ConversationText` reads the mode. Plain mode, role `tool`, or no provider returns the text string as before, with no wrapper. Markdown mode calls `format(text)`, memoized on the text, and puts the result in a `div.agui-md`.
4. `format(text)` returns `formatted` nodes or `plain` with a note. It refuses text over `MARKDOWN_LIMIT` and catches any exception. Otherwise it parses with a module-level `markdownit({ html: false, linkify: false, typographer: false, breaks: false })` and folds the token list into elements with a stack, one rule per token type. Unknown tokens render their `content` as text.
5. Rules that matter for safety: no `dangerouslySetInnerHTML` anywhere; links through `safeLink(href)` (R5); images as inert text; heading levels shifted by two (R6); fenced and indented code through the existing `CodeBlock` primitive; tables inside a focusable, labelled scroll box; alignment as `data-align`.

## Phases

- **Phase 0**: [research.md](research.md), done.
- **Phase 1**: [data-model.md](data-model.md), [contracts/markdown.md](contracts/markdown.md), [quickstart.md](quickstart.md), done.
- **Phase 2**: `/speckit-tasks` writes [tasks.md](tasks.md). `/speckit-analyze` checks it. The maintainer reviews the spec and this plan before `/speckit-implement`.

## Risks

- The streaming caret (`agui-caret::after`) follows the last inline box. After a block element it can land on its own line. This is cosmetic, and a Playwright check looks at it. The fix, if needed, is a CSS rule scoped to `.agui-md`.
- A very large table or list creates many elements. The length limit bounds it. T016 measures the worst case.
- Another #79 worker edits `views/conversation/index.tsx` at the same time. The edits here are about ten lines. The orchestrator can rebase either order.
- A future A2UI release may configure Markdown for its own text components. That is a different renderer path and a different spec. This module does not block it.
