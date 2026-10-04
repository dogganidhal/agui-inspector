# Tasks: Markdown rendering of the conversation

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md), [contract](contracts/markdown.md), [validation guide](quickstart.md).

**Format**: `- [ ] Txxx [P] [USn] Description with file path`. `[P]` means the task touches other files than the tasks it could run beside and has no unfinished prerequisite. `[USn]` maps to the user stories in the spec. Tests are required by the constitution and by FR-018, and each story writes its tests first.

**Paths**: all under the repository root. `V` stands for `packages/inspector/src/views/conversation`, `T` for `packages/inspector/tests/conversation`.

**Parallel work**: other workers change the conversation view and the state view for the other views of issue #79. Edit only the lines this list names in shared files. Do not edit `ROADMAP.md`, other features' specs, `src/core`, `src/app` or `contracts.ts`.

## Phase 1: Setup

- [ ] T001 Add `"markdown-it": "14.3.2"` to `dependencies` in `packages/inspector/package.json`, then run `npm install --package-lock-only --ignore-scripts` so `package-lock.json` changes by that one line in the `packages/inspector` entry. Check `npm ls markdown-it --all` shows only 14.3.2 and `git diff --stat package-lock.json` shows no new `node_modules/` entry. No `@types` package.
- [ ] T002 [P] Create `V/markdown-it.d.ts`: `declare module 'markdown-it'` with the default-exported constructor taking `{ html: boolean; linkify: boolean; typographer: boolean; breaks: boolean }`, and an instance with `parse(src: string, env: object): Token[]`. `Token` has `type`, `tag`, `nesting: -1 | 0 | 1`, `content`, `info`, `markup`, `hidden`, `attrs: [string, string][] | null`, `children: Token[] | null`, `attrGet(name: string): string | null`. Nothing else (research R3).
- [ ] T003 [P] Add `export function markdownRunResponse(ids: RunIds): ScenarioResponse` to `examples/reference-agent/scenarios.ts`, beside `referenceRunResponse`: a run with one assistant message whose text uses every construct of the contract table (a heading, emphasis, a list, a table with aligned columns, a fenced block, an allowed link) and the samples that matter under the page's policy (a remote image, a `javascript:` link, a raw `<img onerror>` line). The text is an exported constant so tests can compare it. Do not add it to `SCENARIOS` or `demo/config.json`: `tests/demo/scenarios.test.ts` requires the demo's quick messages to equal `Object.values(SCENARIOS)`. Add a case in `packages/inspector/tests/foundation/reference-agent.test.ts` that the producer is deterministic and its frames are valid SSE events for `RUN_STARTED` through `RUN_FINISHED`.

## Phase 2: Foundation (blocks every story)

The control and the wiring, with Markdown mode still showing plain text. Each story then makes it do its part.

- [ ] T004 Create `V/markdown.tsx` with: the `TextMode` type (`'plain' | 'markdown'`), a context and `MarkdownModeProvider`, `useTextMode()` (no provider means `'plain'`), `MarkdownToggle` (the existing `SegmentedControl`, label `Message text`, options `Plain text` and `Markdown`, in a `div.agui-conv-toolbar`), and `ConversationText({ text, role })` that returns the `text` string unchanged for now, with no wrapper. `role === 'tool'` always returns the text, and so does any role other than `assistant`, `user`, `system`, `developer` or an absent role (reasoning). Export `MARKDOWN_LIMIT = 200_000`.
- [ ] T005 [P] Append one block of rules to the end of `V/conversation.css`: `.agui-conv-toolbar` (a row, `padding-bottom`, tokens only) and the `.agui-md` base (`white-space: normal`, spacing between blocks in multiples of `--u`). Every color, radius, spacing step and font comes from the theme tokens, and `T/styles.test.ts` must keep passing (spacing as `calc(var(--u) * n)`, radii from `--r`, `--r-sm` or `--r-xs`, fonts from the font tokens, only `agui-` classes, no custom properties, no `url(`).
- [ ] T006 Wire `V/index.tsx`, and nothing more: import from `./markdown`; hold `useState<TextMode>('plain')` in `ConversationView`; render `<MarkdownToggle>` after the `h2` and wrap the entries in `MarkdownModeProvider`; set `data-text-mode` on the `section`; replace `{entry.text}` with `<ConversationText text={entry.text} role={entry.role} />` in `MessageBlock`, and with `<ConversationText text={entry.text} />` in `ReasoningBlock`; update the header comment that says there is "no Markdown or HTML path". Keep each wrapper `div` and its classes.
- [ ] T007 [P] Foundation tests in `T/markdown.test.tsx` with `renderToStaticMarkup` over the fixtures in `T/fixture.tsx` and `T/support.ts`: the section has `data-text-mode="plain"` and the control has the group label `Message text` with `Plain text` pressed; the control also renders for an empty conversation; a message with Markdown characters renders as the bare text with no wrapper element, so its markup equals 0.1.0's; `ConversationText` rendered without the provider shows plain text. Run `npm run test:unit -- packages/inspector/tests/conversation`: every existing test still passes.

**Checkpoint**: the page shows the control, nothing else changes, all existing tests pass.

## Phase 3: User Story 1 - Read an agent reply as formatted text (P1)

**Goal**: Markdown on shows each supported construct formatted, off shows the exact received text.

**Independent test**: one assistant message using every construct, Markdown on, then off.

- [ ] T008 [P] [US1] Write construct tests in `T/markdown.test.tsx`, one case per row of the contract's element table: paragraph; headings 1 to 6 give `h3`, `h4`, `h5`, `h6`, `h6`, `h6`; `em`, `strong`, `del`; inline code; fenced code with a language (label `Code, ts`) and without (`Code`); indented code; block quote; bullet list; ordered list with `start="3"`; a tight list item has no `p`; `hr`; hard break gives `br`; a table with `data-align` on aligned cells and no `style` attribute anywhere; a raw HTML line and a bare address stay text; a footnote and a task-list box stay text. Render these at the `ConversationText` level inside `MarkdownModeProvider value="markdown"`. Feed the Markdown text through the real projection with `sessionOf` from `T/support.ts` for each event that produces message text: `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`; `TEXT_MESSAGE_CHUNK`; `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`; and a message in a `MESSAGES_SNAPSHOT`. Then: role `tool` stays plain; reasoning text formats; plain mode equals the received text for each of these. The delta lists, chunk tags and frame references are checked in the browser in T014. Tests fail until T009.
- [ ] T009 [US1] In `V/markdown.tsx`, add the module-level `markdownit({ html: false, linkify: false, typographer: false, breaks: false })`, `format(text, parse = md.parse)` and the token fold: a stack, `nesting === 1` opens a frame, `-1` closes it into an element, `0` is a leaf, an `inline` token folds its `children`. One rule per token type from the contract table. A token type the table does not list renders its `content` as text. Fenced and indented code use the existing `CodeBlock` primitive with `format="raw"`, the trailing newline removed. Tables sit in `div.agui-md-scroll` with `tabIndex={0}`, `role="region"` and `aria-label="Table"`. Alignment comes from the token's `style` attribute and becomes `data-align`; the text is never used as an attribute. `start` on an ordered list is set only when `Number.isSafeInteger` and not 1. No `dangerouslySetInnerHTML`, no `style`. `ConversationText` calls `useMemo(() => format(text), [text])` in Markdown mode and puts the result in a `div.agui-md` inside the entry's body, which keeps its own classes.
- [ ] T010 [US1] Add the limit and failure notes. Tests first in `T/markdown.test.tsx`: a 200,000 character text formats; 200,001 characters shows the text unchanged under `Too long to format as Markdown. Shown as plain text.`; a `parse` that throws (passed to `format`) shows `Could not format this as Markdown. Shown as plain text.`; other entries in the same render still format; text with 1,000,000 characters on one line and 5,000 nested `>` characters both finish and fall back or format without throwing. Then implement in `format`: the length check first, then `try`/`catch`, returning `{ kind: 'plain', note }`, drawn as `p.agui-conv-muted` above the text.

**Checkpoint**: US1 passes on its own. `npm run test:unit -- packages/inspector/tests/conversation`.

## Phase 4: User Story 2 - Agent output cannot run code or fetch anything (P1)

**Goal**: Hostile text shows as inert text or harmless elements. Nothing runs, nothing is requested.

**Independent test**: the hostile sample list with Markdown on, in a unit test and in a browser.

- [ ] T011 [P] [US2] Write safety tests in `T/markdown.test.tsx`. A table of at least 15 hostile samples (raw `<script>`, `<img onerror>`, `<iframe>`, `<svg onload>`, `<style>`, `<a href="javascript:...">` as HTML, `[a](javascript:...)`, `[a](data:text/html,...)`, `[a](file:///etc/passwd)`, `![t](https://example.test/p.png)`, `![t](data:image/png;base64,...)`, `[a](//example.test/x)`, `[a](/relative)`, `[a](#frag)`, `[a](ftp://example.test)`, `[a](tel:+1)`, a link with `title`, a table with style-like alignment text, 5,000 nested brackets), each asserted against the serialized markup: none of `<script`, `<img`, `<iframe`, `<svg`, `<style`, ` style=`, ` on[a-z]+=`, `srcdoc`, and no `href` that is not `http:`, `https:` or `mailto:`. Link rule cases: allowed `https:`, `http:`, `mailto:`; the destination prints after the text; an angle-bracket autolink prints it once; a look-alike host prints in its parsed form; a rejected link prints its text and typed address with no anchor; every anchor has `target="_blank"`, `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"`; an image prints `[image: alt]` or `[image]`, with no `src` and no `<img`. Add a source guard that `V/markdown.tsx` contains none of `dangerouslySetInnerHTML`, `innerHTML`, `eval(` or `new Function`.
- [ ] T012 [US2] Implement `safeLink(href)` as in the data model (`new URL(href)` with no base, protocol allowlist, return the parsed URL's `href`), the link rule (anchor plus `span.agui-md-dest`, or text plus typed address when rejected), and the image rule (`span.agui-md-inert`). Add the `.agui-md-dest` and `.agui-md-inert` rules to the block in `V/conversation.css` (muted token, `overflow-wrap: anywhere`).
- [ ] T013 [US2] Write `tests/e2e/conversation/markdown.spec.ts` (hostile part) on the existing fixture bundle (`T/fixture.tsx`, `window.__conversation`), served from this spec's own page with the production policy from `contentSecurityPolicy()` in `packages/inspector/src/app/security.ts` as a `Content-Security-Policy` header. `events.spec.ts` sets `script-src` only, so a violation of `style-src` or `img-src` would not show there. Before loading, register a `securitypolicyviolation` listener and a script canary (`window.__pwned`) with `page.addInitScript`. Push the samples from T011 as assistant messages, turn Markdown on, and assert: no script ran, no `securitypolicyviolation` event, and every request the page made is to the fixture's own origin. Click an allowed link (route its destination with `context.route`): a popup opens, `window.opener` there is `null`, the inspector page keeps its URL and `__conversation.session()` still has its frames.

**Checkpoint**: US1 and US2 pass. The feature is safe to review.

## Phase 5: User Story 3 - Works on a live run and on an imported session (P2)

**Goal**: The same behavior while streaming and after an import, with the recording untouched.

**Independent test**: stream a run with Markdown on, then export and import it.

- [ ] T014 [P] [US3] In `tests/e2e/conversation/markdown.spec.ts` (streaming part): push a message in deltas that stops inside a code fence and inside a table, with Markdown on, and assert the formatted text grows and nothing throws or blanks; end the message and assert the final form. Assert the mode survives opening another exchange. Take a SHA-256 over `JSON.stringify(__conversation.session().frames)` and over the exported session JSON before turning Markdown on, while on and after turning it off, and assert all are equal (SC-003). Assert the streaming caret still shows beside a live formatted message. Assert that the delta lists, chunk tags and frame references have the same markup in both modes (compare the `outerHTML` of those nodes before and after).
- [ ] T015 [US3] Write `tests/e2e/conversation/markdown-app.spec.ts` through the whole production app against the reference agent. Self-contained setup, as `tests/e2e/hosted/support.ts` does: `buildApp` into a temporary directory and a small `node:http` server in the spec that serves its files, a `config.json` naming one agent on that origin, and answers the run request with the chunks of `markdownRunResponse` from `examples/reference-agent/scenarios.ts`. Do not edit another spec's helpers. Register a `securitypolicyviolation` listener and a script canary before load: the page's own policy is in force here. Export and import use the same controls `tests/e2e/inspection/session.spec.ts` uses (the `Export session` dialog and the `input[type=file]`). Send a message, turn Markdown on, assert the heading, list, table, code and link (with its destination) show formatted, the remote image and the `javascript:` link show as inert text, the raw HTML shows as typed, no policy violation fired, and the frames list holds the same frames as before; export the session, import it, assert Markdown is still on and the same elements show; turn it off and assert the text equals the received text; assert no request left the permitted targets.
- [ ] T016 [P] [US3] Timing, in `T/markdown.test.tsx` or `T/markdown-workload.test.ts` using `generateFixture` from `tests/benchmarks/generate.ts` the way `T/workload.test.ts` does: project the 5,000-frame workload, then format every message and reasoning entry in Markdown mode in under 1,000 ms; format one dense 200,000 character message (headings, lists, links, tables, code) in under 200 ms. Print both numbers. If either fails, lower `MARKDOWN_LIMIT`, record the new value in the data model and the spec's FR-012, and say why. Copy the measured numbers into research R9.

## Phase 6: User Story 4 - Use it from the keyboard (P2)

**Goal**: The control, links and scrollable blocks work with the keyboard, and the structure is right for assistive technology.

**Independent test**: a keyboard-only run through the control, a link, a code block and a table.

- [ ] T017 [P] [US4] In `tests/e2e/conversation/markdown.spec.ts` (keyboard part): Tab reaches `Message text`, the focused button shows a visible focus ring, Enter presses Markdown (`aria-pressed`), Tab reaches a link and a code block and a table scroll box, ArrowDown scrolls a code block taller than its box, Space returns to Plain text. Use `getByRole` to assert headings (message headings start at level 3, and the page still has one `h1` and one `h2`), list, table and link. Check a 360 px wide viewport for no horizontal page scroll with a wide table and code block. Check the muted destination text keeps the contrast the existing contrast spec asks for (`tests/e2e/hosted/evidence-contrast.spec.ts`) in light and dark themes.
- [ ] T018 [US4] Fix what T017 finds in `V/conversation.css` and `V/markdown.tsx` only: focus ring on `.agui-md-scroll` and the code block, `max-width: 100%` and wrapping so a narrow pane scrolls inside the box, and the caret rule scoped to `.agui-md` if it lands badly after a block.

## Phase 7: Polish and cross-cutting

- [ ] T019 [P] Docs: replace the "Plain text" section of `website/content/docs/event-views.mdx` with a "Markdown" section that follows the contract's documentation list, in short plain sentences with no em dashes, and keep a sentence saying Markdown is not interpreted by default. Update `T/docs.test.ts` so it asserts the control label, `Plain text` as the default, the syntax list, the image and link rules, the limit and the "not saved" statement. Run the `humanizer` skill on the new text.
- [ ] T020 [P] Dependencies and notices: add the `markdown-it` row (version 14.3.2, purpose, rejected alternative) to the runtime table of `website/content/docs/dependencies.mdx`, and reword the "DOMPurify override" paragraph that says conversation Markdown is out of scope (the bundle still excludes DOMPurify, because the conversation uses `markdown-it` directly). Build, read the esbuild metafile, and change the packages that are now bundled (expected: `markdown-it`, `linkify-it`, `mdurl`, `uc.micro`, `entities`, `punycode.js`) from `installed` to `bundled` in `THIRD_PARTY_NOTICES.txt`, then copy it byte for byte to the two package copies (`packages/inspector/THIRD_PARTY_NOTICES.txt` and `packages/python/THIRD_PARTY_NOTICES.txt`, as `scripts/package-python.mjs` and `dependencies.mdx` describe). Run `uv run --project packages/python python -m unittest discover -s packages/python/tests` for the notices test.
- [ ] T021 [P] Add `.changeset/conversation-markdown.md` with a minor bump for `agui-inspector` and for `agui-inspector-python`, and one plain sentence of release notes. `tests/release/changeset.test.ts` must pass.
- [ ] T022 Bundle and gates: `npm run build && npm run check:bundle`, record the added bytes (minified and gzipped, against 1,227,500 and 308,758) in research R1 and in the pull request, then `npm run typecheck`, `npm run test:unit`, targeted `npm run test:e2e -- tests/e2e/conversation --workers=2`, and finally `npm run check:ci`.
- [ ] T023 Close the loop: run `/speckit-converge` if code and spec disagree, set the spec's Status to implemented, tick this list, then `/ponytail:ponytail-review` on the diff, `humanizer` on the pull request body, rebase on `origin/main`, and update the pull request.

## Dependencies and order

- T001 and T002 come first. T003 is independent of both.
- Phase 2 needs T001 and T002. T004 comes before T006 and T007. T005 is independent.
- US1 (T008 to T010) needs Phase 2. T008 is written before T009. T010 follows T009.
- US2 (T011 to T013) needs T009, because the link and image rules extend the walker. T011 is written before T012. T013 needs T012 and T006.
- US3 (T014 to T016) needs US1 and US2. T015 needs T003.
- US4 (T017, T018) needs T009 and T012.
- Polish needs every story. T019, T020 and T021 do not depend on each other.

## Parallel examples

- After T001 and T002: T003, T004 and T005 together.
- After T009: T008's tests already exist, so run T011 beside T010.
- After US2: T014, T016 and T017 together, since they are different tests in different files or sections.
- In Polish: T019, T020 and T021 together.

## Implementation strategy

1. Phases 1 and 2, then US1 and US2. That is the smallest reviewable slice, because safety is part of the feature and not a later hardening.
2. US3 and US4 add the live run, import, timing and keyboard evidence. They should need only small fixes to code that US1 and US2 wrote.
3. Polish finishes docs, notices, the changeset and the gates. Run `npm run check:ci` before the pull request leaves draft.
