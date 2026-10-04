# Feature Specification: Markdown rendering of the conversation

**Feature Branch**: `gh-79-conversation-markdown`

**Created**: 2026-10-04

**Status**: Implemented, in review

**Input**: Issue [#79](https://github.com/dogganidhal/agui-inspector/issues/79), "Add subagent lanes, state history, a run waterfall and Markdown rendering", fourth view: Markdown rendering of the conversation, on demand. The issue asks for one spec per view so each merges on its own. This spec covers only the Markdown view. The other three views have their own specs.

## Clarifications

### Session 2026-10-04

Nobody was available to answer, so each question was answered from the issue, the roadmap, the constitution and the code, taking the recommended option.

- Q: Does the conversation start as plain text or as Markdown, and how far away is the other mode? → A: Plain text is the default on every page load. Markdown is one action away, and so is going back. The issue left this to the spec. Plain text keeps 0.1.0 behavior and keeps the exact characters for a developer who needs them.
- Q: Is the switch one control for the whole conversation, or one per message? → A: One control, at the top of the conversation. Showing one message as plain text means switching the mode off. It matches the existing Rendered and JSON switch on the activity card and keeps the change to the conversation view small, which matters because other views of issue #79 change it in parallel.
- Q: Which text does Markdown apply to? → A: Message text with role `assistant`, `user`, `system` or `developer`, and reasoning text. Messages with role `tool`, tool arguments and results, run results, activity content, custom and raw values and subagent lines stay as they are, because they hold data, not prose.
- Q: Can a Markdown link be opened, and what does the developer see before opening it? → A: A link with an `http:`, `https:` or `mailto:` address opens only when activated, in a new tab with no access to the inspector and no referrer. Its destination is always shown next to the text, so a link cannot hide where it goes. Other addresses show as text. Images are never loaded and show as their alt text.
- Q: What happens to a message too long or too odd to format? → A: Above 200,000 characters, or on any failure while formatting, that message shows as plain text with a short note. Other messages still format. The plan measures the limit on the reference CI machine and may only lower it, in which case it records why.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read an agent reply as formatted text (Priority: P1)

A developer runs an agent that answers in Markdown: headings, lists, tables, code blocks, links. In 0.1.0 the conversation shows that text as typed, so a long reply is hard to read. The developer turns on Markdown for the conversation, reads the reply formatted, and turns it off again to see exactly the text that was sent.

**Why this priority**: This is the whole feature. Without it there is nothing to deliver.

**Independent Test**: Stream one assistant message that uses every supported construct. Turn Markdown on and check the formatted result. Turn it off and check that the text is exactly what was sent.

**Acceptance Scenarios**:

1. **Given** a conversation with an assistant message that contains a heading, a list, a table, a code block and a link, **When** the developer turns Markdown on, **Then** each construct is shown formatted and the text that is not Markdown syntax is unchanged.
2. **Given** Markdown is on, **When** the developer turns it off, **Then** every message shows the exact text received, as in 0.1.0.
3. **Given** a fresh page, **When** a conversation first appears, **Then** it shows plain text. Markdown is never on until the developer asks for it.
4. **Given** Markdown is on, **When** the developer looks at a message's delta list, frame references, chunk tags or the frames list, **Then** these show the same raw evidence as when Markdown is off.
5. **Given** Markdown is on, **When** a reasoning block, a tool call, a run result or an activity card appears, **Then** reasoning text is formatted and the others look as they do with Markdown off.

---

### User Story 2 - Agent output cannot run code or fetch anything (Priority: P1)

An agent can return any text, including text written to attack the viewer: script tags, event handlers, tracking images, links that run code, or markup that tries to restyle the page. A developer turns on Markdown to inspect that reply and must not be exposed to any of it. The inspector never loads remote content on its own and never changes its content security policy for this feature.

**Why this priority**: The inspector's value is that it is safe to point at any server. A rendering mode that breaks that would make the feature a liability, so this ranks with the feature itself.

**Independent Test**: Send messages built from a list of hostile samples with Markdown on. Check that no script runs, that the page makes no request beyond its permitted targets and its own origin, and that every sample shows as inert text or a harmless element.

**Acceptance Scenarios**:

1. **Given** a message with raw HTML such as `<script>`, `<img onerror=...>` or `<iframe>`, **When** Markdown is on, **Then** the markup shows as typed text and nothing runs or loads.
2. **Given** a message with `![tracker](https://example.test/pixel.png)`, **When** Markdown is on, **Then** no request is made, and the image shows as inert text that names its alt text.
3. **Given** links with `javascript:`, `data:` or `file:` addresses, **When** Markdown is on, **Then** they are not links. They show as text.
4. **Given** a link to an `https:` address, **When** the developer activates it, **Then** it opens in a new tab with no access to the inspector page and no referrer, and the inspector page keeps its captured session. Nothing is requested before the developer activates it.
5. **Given** a link whose text names one site and whose address is another, **When** Markdown is on, **Then** the address is visible next to the text without hovering.

---

### User Story 3 - Works on a live run and on an imported session (Priority: P2)

The developer uses the control while a run streams, and again on a session loaded from a file. Both behave the same.

**Why this priority**: The issue requires both. A feature that works only live would not help with a bug report that arrives as a session file.

**Independent Test**: Play a scripted run from the reference agent with Markdown on and check the formatted text grows as it streams. Export the session, import it, and check that the same messages render the same.

**Acceptance Scenarios**:

1. **Given** Markdown is on and an assistant message is streaming, **When** deltas arrive, **Then** the formatted text grows with them, a half-written construct such as an open code fence or a half table shows without errors, and the message settles into its final form when the run ends.
2. **Given** a recorded session is imported, **When** the developer turns Markdown on, **Then** messages show the same formatted output as they showed on the live run.
3. **Given** Markdown is on, **When** the developer starts a new thread, runs again or imports a session, **Then** Markdown stays on until the developer turns it off or reloads the page.
4. **Given** a session with 5,000 frames, **When** the developer turns Markdown on, **Then** the conversation stays usable (see SC-005).

---

### User Story 4 - Use it from the keyboard (Priority: P2)

A developer who does not use a pointer turns Markdown on, reads, follows a link and turns it off, with the keyboard only.

**Why this priority**: The issue requires keyboard use, and the constitution requires keyboard navigation for the accessibility audit.

**Independent Test**: With only the keyboard, tab to the control, turn Markdown on, tab to a link in a message, scroll a wide code block and a wide table, and turn Markdown off.

**Acceptance Scenarios**:

1. **Given** the conversation pane, **When** the developer tabs through it, **Then** the Markdown control is reachable, shows a visible focus, says whether it is on, and changes with Enter or Space.
2. **Given** Markdown is on, **When** the developer tabs through a message, **Then** each link takes focus in reading order, and a code block or table that is wider than the pane takes focus so the arrow keys can scroll it.
3. **Given** a screen reader, **When** a message with headings, lists and a table is read, **Then** they are announced as headings, lists and a table, and the headings inside a message do not break the page's heading outline.

---

### Edge Cases

- A message that is empty or only whitespace shows nothing extra in both modes.
- A message so long that formatting it could freeze the page (more than 200,000 characters) shows as plain text with a short note that says why. It does not freeze the page. Other messages still format.
- Deeply nested lists or quotes, run-on emphasis that would nest elements more than 200 levels deep, thousands of unclosed brackets, and a single line of one million characters do not freeze the page or throw. A message that nests too deep falls back to plain text with the failure note. The others format or fall back at the length limit.
- Any failure while formatting one message shows that message as plain text with a short note. It never blanks the conversation or stops other messages from showing.
- Messages with role `tool` stay plain text in both modes. Their content is a tool result, not prose.
- A message with images or files as content parts keeps its "non-text parts" tag. Parts are never loaded.
- Markdown syntax that this view does not support (raw HTML, task-list boxes, math, diagrams) shows as typed. Footnotes are not supported, and `[^1]: text` is read the way CommonMark reads it, as a link reference definition.
- A bare web address in text, without Markdown link syntax, stays plain text. Only an explicit link or an angle-bracket address is a link.
- Text with Markdown characters used on purpose, such as a snake_case name, a path with asterisks or a `#` at the start of a line in a code sample, may look different with Markdown on. Turning it off shows the exact text. This is why plain text is the default.
- Light and dark themes, and adopter theme overrides, apply to the formatted text the same way they apply to the rest of the conversation.
- A narrow pane (a phone-width window) does not scroll the page sideways. Wide tables and code blocks scroll inside their own box.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The conversation MUST show message and reasoning text as plain text, exactly as received, until the developer turns Markdown on. This is the default on every page load.
- **FR-002**: The conversation MUST offer one labelled control, at the top of the conversation, that switches message and reasoning text between plain text and Markdown. The control MUST say which state is active, and switching back MUST take one action. It MUST be present for a live run and for an imported session.
- **FR-003**: Markdown MUST apply to the text of message entries with role `assistant`, `user`, `system` and `developer`, and to reasoning text. It MUST NOT apply to messages with role `tool`, tool arguments and results, run results, activity content, custom and raw values, subagent lines, state, the delta lists, or the frames list.
- **FR-004**: Markdown MUST support paragraphs, emphasis, strong emphasis, strikethrough, headings, block quotes, ordered and unordered lists, inline code, fenced and indented code blocks, horizontal rules, line breaks, tables and links. Anything else MUST show as typed.
- **FR-005**: Raw HTML in the text MUST NOT be interpreted. It MUST show as typed text.
- **FR-006**: Rendering MUST NOT cause any request. Images MUST NOT be loaded. An image MUST show as inert text that names its alt text, and its address MUST NOT be requested or followed.
- **FR-007**: Only `http:`, `https:` and `mailto:` addresses MUST become links. Any other address MUST show as text. A link MUST open only when the developer activates it, in a new tab that has no access to the inspector page and receives no referrer. The link's destination MUST be visible next to its text.
- **FR-008**: Rendering MUST NOT use dynamic code evaluation and MUST NOT require any relaxation of the page's content security policy. Output MUST contain no script, event handler, inline style from the text, form, embedded frame or other active element.
- **FR-009**: Switching modes MUST be a view change only. It MUST NOT alter the recording, the frames, run inputs or exports, MUST NOT send a request, and MUST NOT write to session files, configuration, profiles or browser storage.
- **FR-010**: Markdown MUST work for a live run, including text that is still streaming, and for an imported session. The same text MUST produce the same output in both.
- **FR-011**: The Markdown state MUST be kept while the page stays open, across new threads, further runs and session imports. It MUST reset to plain text on reload.
- **FR-012**: A message longer than the limit, 200,000 characters unless the plan records a lower one, MUST show as plain text with a visible note. Any failure to format a message MUST show that message as plain text with a visible note and MUST NOT affect other messages.
- **FR-013**: The control, links and scrollable blocks MUST be reachable and operable from the keyboard with a visible focus. Headings, lists and tables MUST keep their native semantics for assistive technology, with heading levels inside a message placed below the page's own headings.
- **FR-014**: Formatted text MUST use the theme tokens only, so light, dark and adopter themes apply. It MUST NOT add new documented theme properties unless the plan says why.
- **FR-015**: Evidence MUST stay as it is in both modes: chunk tags, the streaming indicator, frame references, delta lists and run references.
- **FR-016**: The change MUST stay within the production bundle limits of 2,000,000 bytes minified and 600,000 bytes gzipped, and the plan MUST report the size it adds.
- **FR-017**: The documentation MUST describe the control, what formatted text covers, the supported syntax, the safety rules and the limit. The statement in the event views page that Markdown is not interpreted MUST be replaced by a description that is true for both modes.
- **FR-018**: Regression tests MUST cover each construct of FR-004, each safety rule of FR-005 to FR-008 with hostile samples, the limit of FR-012, a streaming message, an imported session, keyboard use, and the unchanged recording of FR-009.

### Key Entities

- **Text mode**: Whether message and reasoning text show as plain text or as Markdown. One value for the conversation. Held in the page only, never saved.
- **Message text**: The text of a message entry or a reasoning entry, as the projection built it from received frames. It is the only input to formatting and is never changed.
- **Formatted text**: What the Markdown mode draws for one message text. Derived on each draw, never stored, and never part of a session.
- **Inert text**: How an element that is not allowed shows: an image as its alt text, a blocked link as its typed text, raw HTML as typed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a fixture message that uses every construct of FR-004, Markdown on shows all of them formatted and Markdown off shows text equal to the received text, on a live run and on an imported session, in 100% of the fixture checks.
- **SC-002**: With a set of at least 15 hostile samples (raw HTML, event handlers, remote images, tracking and script links, style injection, nested and malformed input) shown with Markdown on, zero scripts run, zero requests leave the permitted targets and the page's own origin, and no new content security policy violation is reported.
- **SC-003**: The raw frames, run inputs and session export bytes are identical before turning Markdown on, while it is on and after turning it off, for the same session.
- **SC-004**: A keyboard-only developer completes turn on, read, follow a link and turn off, with no pointer, in an automated test.
- **SC-005**: For the fixed 5,000-frame workload, turning Markdown on formats the conversation in under 1 second, and a message at the length limit formats in under 200 milliseconds on the reference CI machine. The plan records the measured numbers. The unit test bounds are five times these, so a busy shared machine does not fail a run, and a slowdown of an order of magnitude still does.
- **SC-006**: `npm run check:bundle` passes, and the pull request states the bytes added, minified and gzipped.
- **SC-007**: The docs site describes the control, the syntax, the safety rules and the limit, and a docs test fails if any of them is missing.

## Assumptions

- Plain text stays the default. The issue says "on demand", and the MVP shows text as sent, so a developer who wants the exact characters keeps them without doing anything.
- One control for the whole conversation is enough. Showing one message as plain text means turning the mode off, which takes one action. A control on every message is not needed to meet the issue.
- The setting is not saved in the client profile, the configuration or browser storage. The theme choice is remembered separately, under its own key (feature 001, issue #101). A saved default can be a later change if people ask for it. Adding it would also add a profile field.
- The plan reuses a Markdown parser that is already in the installed dependency tree (it arrives through the A2UI packages) and adds no new package. The plan records what it checked, and whether the output is built as page elements or as sanitized markup. If no existing package fits, the plan returns to the maintainer before adding one.
- The other three views of issue #79 (subagent lanes, state history, run waterfall) are separate specs built in parallel. This spec touches the conversation view only through the control and the way message and reasoning text is drawn, so those changes stay small and do not depend on each other.
- Out of scope: syntax highlighting of code, math, diagrams, copy buttons, task lists, footnotes, Markdown in A2UI surfaces (A2UI has its own text rendering and its own setting), Markdown in tool arguments and results, a configurable default, a per-message control, and exporting the conversation as a Markdown file.
- No new protocol behavior, no new event types, and no change to the session, configuration or profile formats.
