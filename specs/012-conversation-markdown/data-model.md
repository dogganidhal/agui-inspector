# Data model: Markdown rendering of the conversation

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Nothing here is stored, sent or exported. These are view-local types and rules. The session, configuration and profile formats do not change.

## Text mode

| Field | Type | Rule |
| --- | --- | --- |
| mode | `'plain' \| 'markdown'` | One value for the whole conversation. Starts as `plain` on every page load. Held in `ConversationView` state. Never saved. Survives new threads, runs and session imports while the page stays open. |

A view mounted without the provider (a test, or a host that mounts only a part) behaves as `plain`.

## Message text and reasoning text

The input. It is `MessageEntry.text` or `ReasoningEntry.text` from `projectConversation`, exactly as the projection built it. The projection is not changed. Markdown applies to:

| Source | Applies |
| --- | --- |
| Message entry with role `assistant`, `user`, `system`, `developer` | Yes |
| Reasoning entry | Yes |
| Message entry with role `tool` | No |
| Any other role string | No. A role the inspector does not know shows as plain text (a safe default). |
| Tool arguments and results, run results, activity content, custom and raw values, subagent lines, state, delta lists, the frames list | No. They are not message text. |

## Format result

What `format(text)` returns. Derived on each draw, memoized on the text, never stored.

| Variant | Fields | When |
| --- | --- | --- |
| `formatted` | `nodes: ReactNode` | The text is at most `MARKDOWN_LIMIT` characters and the parser and the walker finish. |
| `plain` | `note: string` | The text is longer than `MARKDOWN_LIMIT`, or any step threw. The entry shows its text unchanged under the note. |

`MARKDOWN_LIMIT` is 200,000 characters. R9 in the research may lower it.

Notes shown (exact text, also in the contract):

- Over the limit: `Too long to format as Markdown. Shown as plain text.`
- Failure: `Could not format this as Markdown. Shown as plain text.`

## Link rule

Input: the `href` string a link token carries. Output: `undefined` (not a link) or a URL.

1. Parse with `new URL(href)` and no base. A throw means not a link. This rejects relative and protocol-relative addresses.
2. The protocol must be `http:`, `https:` or `mailto:`. Anything else is not a link.
3. The anchor's `href` and the printed destination are both `url.href`.

A rejected link prints its text followed by its typed address in the muted style and has no anchor. `markdown-it` already refuses `javascript:`, `vbscript:`, `file:` and non-image `data:` addresses, so those never become link tokens and stay as literal text.

## Element rules

One output element for each token type, listed in the contract. The walker never writes `dangerouslySetInnerHTML`, `style`, an event handler, or an attribute taken from the text, other than `href` through the link rule and `start` on an ordered list (an integer, checked).

## Relationships

```text
SessionStore --(useProjection)--> ConversationModel --> MessageEntry.text / ReasoningEntry.text
                                                              |
                          mode (ConversationView state) -----> ConversationText --> plain text | format(text)
```

The arrow stops at the view. Nothing flows back to the store.
