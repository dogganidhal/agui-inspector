# Research: Markdown rendering of the conversation

**Date**: 2026-10-04 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Every unknown from the plan's technical context is settled here. Each entry has a decision, the reason, and what else was checked.

## R1. Which Markdown parser

- **Decision**: Use `markdown-it` 14.3.2 as a direct dependency of `packages/inspector`, pinned exactly. Use it only to parse (`parse()`), never to render HTML (`render()`).
- **Why**: The brief said to look at the A2UI stack first. `@a2ui/react` 0.12.0 and `@a2ui/markdown-it` 0.2.0 both depend on `markdown-it ^14.2.0`, and the lockfile already resolves it to 14.3.2 (MIT, with `entities`, `linkify-it`, `mdurl`, `punycode.js` and `uc.micro`). So no new package enters the dependency tree. The only change to `package-lock.json` is one line in the `packages/inspector` entry. Every one of those packages is already in `THIRD_PARTY_NOTICES.txt` as "installed". They become "bundled".
- **Measured** (esbuild, minified, same settings as `scripts/build.mjs`, a one-line entry file):

  | Entry | Minified bytes | Gzip bytes (level 6) |
  | --- | --- | --- |
  | `markdown-it` alone | 149,000 | 52,607 |
  | `renderMarkdown` from `@a2ui/markdown-it` (adds DOMPurify) | 180,235 | 64,374 |

  The baseline build is 1,227,500 bytes minified and 308,758 gzipped (`npm run build && npm run check:bundle`, 2026-10-04), with 772,500 and 291,242 bytes of headroom. The parser alone costs about 12% of the minified headroom and 18% of the gzip headroom, before the mapping code. The mapping code is small.

  Measured on the finished change (`npm run build && npm run check:bundle`, 2026-10-04): 1,382,491 bytes minified and 364,191 gzipped. The change adds 154,991 and 55,433 bytes. Headroom left: 617,509 and 235,809. The check passes.
- **Alternatives considered**: see R2 for `@a2ui/markdown-it`. Another parser (`marked`, `micromark`, `remark`) is a new package for a job the installed one does. Writing a parser is not small or safe.

## R2. Reuse `@a2ui/markdown-it`, or build elements from tokens

- **Decision**: Do not use `renderMarkdown` from `@a2ui/markdown-it`. Walk the `markdown-it` token list and build React elements directly. No HTML string exists at any point and no sanitizer runs, because the output can only contain the elements and attributes the walker creates.
- **Why**: `renderMarkdown` returns a sanitized HTML string. Checked against 0.2.0 and `markdown-it` 14.3.2 on 2026-10-04 with a probe input:
  - A table with column alignment renders `<th style="text-align:center">`. The page's content security policy is `style-src 'self'` with no `unsafe-inline`, so an inline style attribute that arrives as markup is blocked and reports a violation. SC-002 asks for zero violations. DOMPurify's default profile keeps `style` attributes, and `renderMarkdown` takes no options.
  - `![x](https://e.test/p.png)` renders `<img src="https://e.test/p.png">`, and DOMPurify keeps it. Spec FR-006 forbids loading it. Stripping it means a second parse of the string in the DOM, or a hook on DOMPurify's shared instance, which would also change the A2UI renderer's output.
  - `[v](/rel)` and `[u](//e.test/x)` pass `markdown-it`'s own link check, so they become anchors. A relative address resolves against the inspector's own origin, and a protocol-relative one leaves it. FR-007 allows `http:`, `https:` and `mailto:` only. The anchors also carry no `rel` or `target`, so a click would replace the page and lose the in-memory capture.
  - `renderMarkdown` is asynchronous and needs a `window` for DOMPurify (its README says so). The unit tests run under `node --test` with no DOM, so none of this could be tested there. A streaming message would also paint a frame late on every delta.
- Building elements fixes all four at the source. React escapes every string. A table's alignment is a `data-align` attribute that a stylesheet rule reads, so no inline style exists. The link rule is one function. Server rendering works in node tests.
- **Cost**: about 150 lines of mapping code that we own, against about 50 for a wrapper. The extra code is the safety rules, written once and tested.
- **Side effect**: DOMPurify stays out of the production bundle, as today. The "DOMPurify override" section of `dependencies.mdx` says the bundle does not include it "because conversation Markdown is out of scope". That reason changes, and the sentence is updated. The override itself stays, since `@a2ui/markdown-it` is still installed.
- **Alternatives considered**: `renderMarkdown` plus a DOM pass that removes images and styles, sets link attributes and parses again (more code than the walker, and still async). A DOMPurify hook through a direct `dompurify` dependency (the hook is global, so it would change A2UI output too, and it adds a second direct dependency).

## R3. Types for `markdown-it`

- **Decision**: A local declaration file, `packages/inspector/src/views/conversation/markdown-it.d.ts`, that types only what the walker uses: the constructor options, `parse` and the `Token` fields.
- **Why**: `markdown-it` 14 ships no types, and `@types/markdown-it` is not installed. Adding it brings `@types/linkify-it` and `@types/mdurl` with it, three new development packages for about 25 lines of declarations. `css.d.ts` in the theme folder is the precedent for a small local declaration.
- **Alternatives considered**: `@types/markdown-it` (more packages, richer types we do not use).

## R4. Which Markdown

- **Decision**: `markdownit({ html: false, linkify: false, typographer: false, breaks: false })`, with markdown-it's own `default` rule set and its default `maxNesting` of 100.
- **Why**: The default rule set is CommonMark plus tables and strikethrough, which is the list in FR-004. `html: false` makes raw HTML text, which is FR-005. `linkify: false` keeps a bare address as text. `typographer: false` keeps quotes and dashes as sent. `breaks: false` keeps the CommonMark meaning of a single newline. Task lists, math and diagrams are plugins or absent, so they show as typed. Footnote syntax is absent too, and CommonMark reads `[^1]: text` as a link reference definition, so the spec does not claim it shows as typed. Checked on 2026-10-04: `- [ ] task` gives a list item with the text `[ ] task`, and `<script>x</script>` gives a paragraph of text.
- **Alternatives considered**: `breaks: true` (chat tools often use it, but it changes meaning and the plain mode is one click away). `linkify: true` (turns text into links the agent did not write).

## R5. Links and images

- **Decision**: A link becomes an anchor only when `new URL(href)`, with no base, parses and its protocol is `http:`, `https:` or `mailto:`. The anchor has `href` set to the parsed URL's `href`, `target="_blank"`, `rel="noopener noreferrer"` and `referrerPolicy="no-referrer"`. The destination is printed after the link text in a muted span, except for an angle-bracket autolink where the text is the address. Any other link shows its text followed by its typed address, with no anchor. An image shows `[image: alt]` as inert text and nothing is requested.
- **Why**: Parsing without a base rejects relative and protocol-relative addresses. Showing the parsed `href` (not the typed string) makes a look-alike host appear in its punycode form. `markdown-it` already refuses `javascript:`, `vbscript:`, `file:` and non-image `data:` addresses, so those stay as literal text. The new tab, `noopener` and no-referrer keep the capture in memory and tell the destination nothing. Navigation happens only when the developer activates the link, which is a user action and not a request the page makes on its own (principle IV).
- **Alternatives considered**: no links at all (safe but loses a feature people expect; the destination display removes the main risk). Opening links in the same tab (loses the in-memory capture). Loading images through `data:` only (a `data:` image can be megabytes, and the plain mode shows it).

## R6. Heading levels

- **Decision**: A Markdown heading of level n renders as `h` of level `min(n + 2, 6)`.
- **Why**: The page's `h1` is the brand and the conversation's `h2` is "Conversation". A message that says `# Title` must not create a second `h1`. Levels 4 to 6 all become `h6`, which keeps the cap simple.
- **Alternatives considered**: no demotion (breaks the outline). Paragraphs with `role="heading"` (a native heading is better for assistive technology).

## R7. Where the state lives

- **Decision**: One `useState` in `ConversationView`, passed to message and reasoning blocks through a React context (the pattern `RevealProvider` already uses in `shared.tsx`). Nothing is saved.
- **Why**: `Entries` and `StepBlock` recurse, so a prop would change four signatures in the file other views of #79 edit. The context keeps the edit to the two text lines and the section. `ConversationView` stays mounted when a session is imported (`PaneBoundary` resets only its error, and the store is a prop), so the mode survives imports as FR-011 asks. The theme switch is not saved either, so there is no storage precedent for view state.
- **Alternatives considered**: state in `App` (touches the shell, which every view of #79 shares). A saved preference in the profile (adds a format field for a convenience; deferred in the spec).

## R8. The control

- **Decision**: The existing `SegmentedControl` primitive, labelled "Message text", with options "Plain text" and "Markdown", at the top of the conversation section.
- **Why**: It is a group of native buttons with `aria-pressed`, which is keyboard operable and announces its state. The activity card already uses it for Rendered and JSON. No new styling is needed beyond a small row.
- **Alternatives considered**: a `Switch` (one boolean, but the two states have no clear on/off meaning). A control on every message (more edits in `MessageBlock`; the spec chose one control).

## R9. The length limit and failures

- **Decision**: `MARKDOWN_LIMIT = 200_000` characters. Above it, or when parsing throws, the entry shows its plain text and a one-line note. The walker runs once per distinct text (`useMemo` on the text), so a live message is parsed once per update and finished messages are not parsed again.
- **Why**: A hostile or runaway message must not freeze a tool people point at untrusted servers. `markdown-it` runs in linear time on ordinary input and caps nesting at 100, and the cap is cheap insurance. The spec lets the plan lower the number if a measurement says so. The task list measures it (SC-005) and records the figure here.
- **Depth cap**: markdown-it stops block nesting at 100 but not run-on emphasis, and `*` repeated 5,000 times on each side of a letter nests about 2,500 elements. `fold` throws past 200 open elements (`MAX_DEPTH`), and the entry shows plain text with the failure note. The limit sits above the 100 block levels markdown-it allows plus ordinary inline nesting.
- **Measured** (Node 24, one run beside other work, best of a few; the unit test prints them): a dense 199,920 character message formats in about 54 ms. A thousand messages of about a kilobyte each draw to markup in about 0.6 s. The 5,000-frame workload has only two message and reasoning entries, so it adds under a millisecond, and the long conversation is the meaningful figure. The limit stays at 200,000 characters. The unit test bounds are five times the figures in SC-005, because a bound at the measured time failed once on a busy machine.

## R10. Test approach

- **Decision**:
  - Node unit tests with `renderToStaticMarkup`: every construct, every safety rule on a hostile sample list (at least 15), the length limit and failure notes, role scoping, the default mode, and the timing in SC-005 on the 5,000-frame workload generator.
  - Playwright on the existing conversation fixture page: the toggle, keyboard use, streaming growth, hostile samples with a request listener, a `securitypolicyviolation` listener and a script canary, and a SHA-256 over the recorded frames before, during and after.
  - Playwright through the whole production app: a live run answered by a new reference-agent producer, `markdownRunResponse`, then export and import of the session. The page's own policy is in force there, so a policy violation or a stray request is real. The conversation fixture page is served with the production policy from `contentSecurityPolicy()`, because its current meta tag sets `script-src` only. zod probes `new Function('')` once inside a try/catch and the policy reports the blocked probe as a `script-src eval` violation, so the checks leave that one report out, as `tests/e2e/hosted/support.ts` does, and fail on any other.
- **Why**: Node tests are fast and need no DOM, because the output is React elements. The behaviors that need a browser (policy violations, requests, focus) are exactly the ones Playwright proves.
- **Alternatives considered**: jsdom (not installed, and `dependencies.mdx` already rejects it for lack of real layout and network).

## R11. Documentation and notices

- **Decision**: `event-views.mdx` replaces its "Plain text" section with a "Markdown" section and keeps the sentence the existing `docs.test.ts` matches only if the new text still says Markdown is not interpreted by default. `dependencies.mdx` gets a runtime row for `markdown-it` and a corrected DOMPurify paragraph. `THIRD_PARTY_NOTICES.txt` and its two package copies move six packages from "installed" to "bundled". A changeset covers `agui-inspector` and `agui-inspector-python` (the wheel ships the same bundle).
- **Why**: AGENTS.md says docs change in the same change as the code, and a test enforces the dependency row.
- **Note on `docs.test.ts`**: it asserts `Markdown is not interpreted`. The new section keeps a sentence with those words ("By default Markdown is not interpreted"), so the test keeps its meaning. The new test adds the new claims.

## R12. Parallel work on issue #79

- **Decision**: New code goes in new files (`markdown.tsx`, `markdown-it.d.ts`, tests). Edits to shared files are small and listed: `views/conversation/index.tsx` (import, two text lines, the section's toolbar and provider, the header comment), `conversation.css` (one block appended at the end), and the docs and notices. `examples/reference-agent/scenarios.ts` gets one exported producer. It is not added to `SCENARIOS`: `tests/demo/scenarios.test.ts` requires the demo's quick messages to equal `Object.values(SCENARIOS)`, so a new entry would add a demo example, which this spec does not do. No edit to `src/app`, `core`, `contracts.ts` or the state view.
- **Why**: Other workers change the conversation view (subagent lanes) and the state view in parallel. Keeping the footprint to named lines makes any conflict a mechanical rebase.
