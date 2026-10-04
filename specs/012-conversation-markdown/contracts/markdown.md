# Contract: Markdown in the conversation

**Spec**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

This is the user-visible contract of the feature. Tests and docs follow it. It covers the control, the scope, how each Markdown construct is drawn, the safety rules and the notes. The session, configuration and profile formats do not change.

## The control

- One group at the top of the conversation section, above the entries and above the empty-state text.
- Group label: `Message text`. Two buttons: `Plain text` and `Markdown`. The active one has `aria-pressed="true"`.
- Default: `Plain text`, on every page load.
- Present for a live run and for an imported session, and when the conversation is empty.
- Native buttons: Tab reaches them, Enter and Space press them, and the focus ring is the theme's.
- Hook for tests: the section keeps `data-view="conversation"` and gets `data-text-mode="plain"` or `"markdown"`.

## Scope

| Text | In Markdown mode |
| --- | --- |
| Message, role `assistant`, `user`, `system`, `developer` | Formatted |
| Reasoning | Formatted |
| Message, role `tool` | Plain |
| Tool arguments and results, run result, activity content, custom and raw values, subagent lines, state | Unchanged |
| Delta lists, frame references, chunk tags, role and id tags, the streaming caret | Unchanged |

## Markdown mode: how constructs are drawn

A formatted entry's text sits in a `div.agui-md` inside the entry's existing body `div`. The body keeps its classes, so role styles and the streaming caret stay. Plain mode adds no wrapper: the text is a bare string, so the markup equals 0.1.0.

| Construct | Output |
| --- | --- |
| Paragraph | `p` (no wrapper inside a tight list item) |
| Heading level 1 to 4+ | `h3` to `h6`, as `min(level + 2, 6)` |
| Emphasis, strong, strikethrough | `em`, `strong`, `del` |
| Inline code | `code` |
| Fenced or indented code | The `CodeBlock` primitive with `format="raw"` and `aria-label` `Code` or `Code, <language>`. Focusable, scrolls. No highlighting. |
| Block quote | `blockquote` |
| Bullet list, ordered list, list item | `ul`, `ol` (with `start` when it is an integer other than 1), `li` |
| Horizontal rule | `hr` |
| Soft line break | A newline in the text, which wraps like a space |
| Hard line break | `br` |
| Table | `div.agui-md-scroll` (focusable, `role="region"`, `aria-label="Table"`) holding `table`, `thead`, `tbody`, `tr`, `th`, `td`. Column alignment is `data-align="left\|center\|right"`. |
| Link, allowed | `a` with `href` (the parsed URL), `target="_blank"`, `rel="noopener noreferrer"`, `referrerpolicy="no-referrer"`, followed by `span.agui-md-dest` with the same URL. For an angle-bracket autolink the text is the address, so the span is left out. |
| Link, not allowed | The link text, then the typed address in `span.agui-md-dest`. No anchor. |
| Image | `span.agui-md-inert` reading `[image: <alt>]`, or `[image]` when the alt text is empty. Nothing is requested. |
| Raw HTML | Text, exactly as typed |
| Bare web address | Text |
| Task list box, math, diagram syntax | Text, as typed |
| Footnote syntax | Not supported. `[^1]: text` is a CommonMark link reference definition and `[^1]` a reference to it. |
| Link reference (`[a][r]` with `[r]: https://...`) | As an inline link of the same address |

Links are allowed only when the address parses as an absolute URL whose protocol is `http:`, `https:` or `mailto:`.

## Safety rules

1. No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`, no `new Function`.
2. No `style` attribute and no event handler attribute in the output. The only attributes the walker sets are `href`, `target`, `rel`, `referrerpolicy`, `start`, `data-align`, `class`, `tabindex`, `role` and `aria-label`.
3. No element that loads: no `img`, `iframe`, `object`, `embed`, `video`, `audio`, `source`, `link`, `script`, `form`.
4. Rendering never calls `fetch`, never creates a `URL` request and never touches storage.
5. The content security policy and the page's policy tests are unchanged.

## Notes

| When | Text |
| --- | --- |
| Text longer than `MARKDOWN_LIMIT` (200,000 characters) | `Too long to format as Markdown. Shown as plain text.` |
| Any step threw, or the elements would nest more than 200 deep | `Could not format this as Markdown. Shown as plain text.` |

A note is a `p.agui-conv-muted` above the plain text, inside the entry. The text under it is the received text, unchanged.

## Documentation contract

`website/content/docs/event-views.mdx` has a "Markdown" section that says, in short sentences:

- Plain text is the default.
- Where the control is and what it changes.
- Which text it covers.
- The supported syntax, and what stays as typed.
- That images are not loaded, raw HTML is not run, and which links open and how.
- The length limit and the plain text note.
- That the choice is not saved and the recording is never changed.

`website/content/docs/dependencies.mdx` has a `markdown-it` row with the purpose and the rejected alternative.
