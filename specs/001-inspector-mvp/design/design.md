# UI design: inspector 0.1.0

**Input:** [spec](../spec.md) (FR-041 and the 2026-10-02 theming clarification), [plan](../plan.md),
[tasks](../tasks.md). **Owners:** F06 builds the tokens and primitives; each W2 lane builds its views
from them.

This folder is the visual and interaction reference for every view in the MVP.
[prototype.html](prototype.html) is a clickable mock driven by a scripted, synthetic session. Open it
in a browser; it needs no build or server. [screens/](screens/) holds captures of its key states.

This document is the contract. Where the prototype and this document disagree, this document wins.
Where either disagrees with the spec, the spec wins and the design gets fixed.

The prototype is one HTML file with inline script, written to show layout, states and motion. It is
not code to port. Views are React, conversation and state come from the projection modules, and
frames come from the recorder and store. Its CSS is the exception: F06 lifts the token block and the
primitive styles from it almost unchanged.

## Reference screens

| File | Shows |
| --- | --- |
| [desktop-light.png](screens/desktop-light.png) | Default theme, light. Newest exchange expanded, interrupt waiting for an answer |
| [desktop-dark.png](screens/desktop-dark.png) | Same state, dark |
| [live-run.png](screens/live-run.png) | Interrupt resolved, `run_04` streaming into both panes |
| [theme-cobalt.png](screens/theme-cobalt.png) | Adopter theme applied through tokens only, with the design tool's token panel open |
| [phone-conversation.png](screens/phone-conversation.png) | 400 px wide, conversation pane |
| [phone-frames.png](screens/phone-frames.png) | 400 px wide, frames pane with an unparsed frame expanded |

## Principles

The wire data gets the room. Frames, offsets and findings use the monospace face and most of the
space; chrome stays small and quiet.

Color carries meaning and nothing else. The accent marks what needs the user: the primary action,
the selected state, focus, a waiting interrupt. Semantic colors mark outcomes and findings. Each
event family gets a small colored dot. Everything else is a neutral derived from the text and
background colors.

Surfaces are flat. Borders are 1 px lines mixed from the text color. Only floating layers
(popovers, dialogs, toasts) get a shadow.

Every color, radius, spacing step and font comes from the `--agui-*` properties below, so an adopter
can rebrand the whole interface from one short stylesheet.

## Theme tokens

### Public properties

These are the adopter contract (FR-041). Views read them through the derived tokens and never set
literal colors, radii or font names of their own.

| Property | Light default | Dark default | Controls |
| --- | --- | --- | --- |
| `--agui-accent` | `var(--agui-fg)` | follows `--agui-fg` | Primary buttons, selection, focus ring, interrupt outline, brand mark |
| `--agui-accent-contrast` | `var(--agui-bg)` | follows `--agui-bg` | Text and icons drawn on the accent |
| `--agui-tint-hue` | `75` | same | Hue of the neutral tint, in OKLCH degrees |
| `--agui-tint-chroma` | `0.006` | same | Strength of the tint; `0` gives pure grey |
| `--agui-bg` | `oklch(0.993 c×0.6 h)` | `oklch(0.175 c×1.2 h)` | Page background |
| `--agui-fg` | `oklch(0.235 c×2.2 h)` | `oklch(0.93 c×1.2 h)` | Body text; source of every neutral |
| `--agui-radius` | `8px` | same | Base of the radius scale |
| `--agui-density` | `1` | same | Spacing multiplier; `0.85` is the compact setting |
| `--agui-font-sans` | system stack | same | Interface text |
| `--agui-font-mono` | system stack | same | Frames, ids, JSON, offsets |

`c` and `h` stand for `--agui-tint-chroma` and `--agui-tint-hue`. The default accent is the text
color, so the stock inspector is monochrome and an adopter's accent is the only hue in the chrome.

The shipped font defaults are `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` and
`ui-monospace, "SF Mono", Menlo, Consolas, monospace`. The prototype puts Geist and Geist Mono at the
front of those stacks and loads them from Google Fonts. That request is for the preview only:
FR-037 forbids it in the product. A font file shipped inside the bundle is allowed if it fits the
bundle budget.

Dark mode follows `prefers-color-scheme` and an explicit `data-theme="light"` or `"dark"` on the
root element, which the top-bar theme switch sets. The inspector redefines `--agui-bg` and
`--agui-fg` in both dark rules. An adopter who overrides those two must also supply dark values in
the same two rules; the other properties work in both themes unchanged.

Pick an accent that is not red, amber or green. Those hues are taken by errors, warnings and
success, and an accent that matches one makes the primary button read as a status.

### Derived tokens

Internal to the inspector. Adopters should not override them, and lanes should not add new ones
without an F06 change.

| Token | Value | Use |
| --- | --- | --- |
| `--sunk` | `fg` 4% into `bg` | Code blocks, inputs, selected rows, the user message block |
| `--hover` | `fg` 5.5% | Row and button hover |
| `--line` | `fg` 10% | Borders and dividers |
| `--line-2` | `fg` 18% | Control borders, dashed derived markers |
| `--muted` | `fg` 64% | Secondary text, offsets, summaries |
| `--faint` | `fg` 40% | Decoration only: check marks, separators, axis ticks |
| `--acc-ink` | accent 78% into `fg` | Accent-colored text and links |
| `--acc-soft` | accent 9% into `bg` | Accent tag fill, focus halo, interrupt halo |
| `--acc-line` | accent 40% into `bg` | Accent borders and focus rings |
| `--err`, `--warn`, `--ok` | `oklch(L C H)`, L 0.54 light and 0.72 dark (warn 0.06 lighter); H 27, 70, 150 | Findings, outcomes, status codes |
| `--err-soft` and siblings | 11 to 14% into `bg` | Finding and tag fills |
| `--f-text`, `--f-tool`, `--f-reason`, `--f-state`, `--f-activity` | `oklch(L C H)`, L 0.55 light and 0.76 dark (state 0.08 lighter); H 255, 300, 200, 75, 350 | Event family dots and timeline ticks |
| `--u` | `4px × --agui-density` | Spacing unit; paddings and heights are multiples of it |
| `--r`, `--r-sm`, `--r-xs` | radius × 1, 0.7, 0.45 | Cards, controls, tags |
| `--ease` | `cubic-bezier(.16, 1, .3, 1)` | All transitions |

All mixes use `color-mix(in oklab, …)`. Run, step, subagent, custom and raw families use `--muted`
with a hollow dot rather than a hue of their own.

### Delivering overrides

How a host supplies its overrides is open decision G-09 in the [plan](../plan.md). Until it is
decided, tests apply overrides with a stylesheet loaded after the inspector's own, which every
candidate mechanism reduces to. Custom properties inherit through shadow roots, so the later in-app
element can take the same properties from its host element.

The A2UI renderer styles surface content itself. L05 maps the tokens onto whatever theming the
official renderer exposes; content the renderer still styles on its own may keep its defaults, while
the activity card around it uses the tokens.

## Layout

The page is a fixed app shell and never scrolls as a whole. A top bar sits above two panes:
conversation on the left (`1fr`) and inspection on the right (`1.22fr`), split by a 1 px line. Each
pane scrolls on its own. The conversation pane hides its scrollbar so no bar sits on the split;
wheel, touch and keyboard scrolling still work. The inspection pane keeps the platform scrollbar at
the window edge.

Every edge keeps a 16 px gutter. The conversation column stops at 780 px and message text at 64
characters.

Under 960 px only one pane shows. A segmented control under the top bar switches between
Conversation and Inspection, and links that point across panes (a run id, "Raw frame") switch to the
other pane. Under 720 px the top-bar buttons drop their text labels, the frames list drops its
summary column, and expanded frames lose their left indent.

## Components

F06 builds these as shared primitives. Every W2 view composes them; a lane that needs a variant
raises it with the coordinator instead of styling around the primitive.

| Primitive | Variants and states | Notes |
| --- | --- | --- |
| Button | default, primary, ghost, icon, small; hover, active, disabled | Height `7.5u` (small `6u`), radius `--r-sm`. Primary fills with the accent. Pressing scales to 0.98 |
| Tag | neutral, line, dashed, accent, ok, warn, err | Mono 11 px, 19 px tall, radius `--r-xs`. For ids, statuses, kinds and finding types |
| Filter chip | default, pressed, disabled | Optional leading family dot and trailing count |
| Family dot | filled, hollow | 7 px; color from the family token |
| Card | header, body, footer; interrupt variant | Interrupt variant has an accent border and a 4 px `--acc-soft` halo |
| Code block | JSON or raw text | Highlight classes for keys, strings, numbers, literals and punctuation. Long values wrap; height caps at 340 px and scrolls |
| Segmented control | 2 to 3 options | `aria-pressed` on each option |
| Switch | on, off | `role="switch"` with `aria-checked`; on uses the accent |
| Field, search field, editor | default, focus, error | Editor is the multi-line mono JSON input used for payloads, results and raw requests |
| Popover | anchored | Native `popover` attribute, positioned under its trigger. Agent picker and authentication |
| Dialog | modal | Native `<dialog>`. Export warning and clipboard fallback |
| Toast | single line | Bottom center, `aria-live="polite"`, removed after 3.2 s |
| Finding | neutral, warn, err | Icon, bold kind, message. Used under exchanges, frames and editors |
| Label | uppercase | 10.5 px, letter spacing 0.07em, `--muted` |

Icons are inline SVG on a 24 px grid with a 1.8 stroke and round caps. The prototype's `ICONS` table
holds the set; no icon library is added.

## Views

### Top bar

Left to right: brand mark and product name, agent picker, mode tag, then authentication, Import,
Export, the light and dark switch.

The agent picker lists the agents from the configuration with their endpoints and has a field for
any other endpoint. The mode tag reads `embedded` or `hosted`. The authentication button shows
"No token" or the header name with a masked value; its popover holds the header name, the token and
a line saying the token stays in memory, is cleared on reload or target change, and is never
recorded or exported. Changing the agent or endpoint clears the token and says so in a toast
(FR-004). Export opens the warning dialog described under sessions below.

The "Theme tokens" button and its panel exist only in the prototype, as a tool for previewing
brands. They are not a product feature; do not build them.

### Conversation

| Entry | Treatment | Comes from |
| --- | --- | --- |
| Run header | Run id (links to its exchange), `← parent` id, duration that counts up while streaming, outcome tag, optional note such as "1 pending tool call", and a rule to the right. An optional line below names what the run carried: a tool result, an A2UI action or `resume` answers | `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR` |
| User message | Uppercase role label, text in a `--sunk` block | Run input |
| Assistant message | Role label and message id; text exactly as sent, no Markdown; a block caret while streaming; a dashed tag "from TEXT_MESSAGE_CHUNK" when chunks produced it | `TEXT_MESSAGE_*` |
| Reasoning | Collapsible; muted text behind a left rule | `REASONING_*` |
| Step | Collapsible group with the step name in mono and its duration; children indented behind a left rule | `STEP_*` |
| Tool call | Card with name, `server tool` or `client tool` tag, call id and status. Arguments show raw fragments while they stream and parsed JSON once complete; the result follows. A pending client call shows a result editor in the interrupt card's pattern; once answered it shows "Result · entered by you" and a footer naming the run that carried it | `TOOL_CALL_*` |
| Subagent | Dashed box with started, finished or error lines and the subagent run id | `SUBAGENT_*` |
| Encrypted reasoning | Inline marker: lock icon, subtype, entity and size tags, "not decoded", link to the raw frame | `REASONING_ENCRYPTED_VALUE` |
| Activity | Card with the activity type and id and a Rendered or JSON switch. A2UI surfaces render; other types and disabled rendering show JSON. The footer records the action the user sent and the run that carried it | `ACTIVITY_*` |
| Custom or raw | Inline marker: mono type, name or source, value | `CUSTOM`, `RAW` |
| Interrupt | Accent card with the message, a payload editor prefilled from the response schema with a one-line schema hint, Resolve and Cancel interrupt, and an "n of m waiting" count. The footer states that the next run carries `resume` once every interrupt has an answer. Invalid JSON or a schema miss shows an inline error. Once answered it collapses to one line with the payload and the run that carried it | `RUN_FINISHED` interrupt outcome |
| Messages snapshot | Not in the prototype. A full-width divider in the run header's style reading "Transcript replaced by MESSAGES_SNAPSHOT", with added and removed counts that expand to the lists (FR-019) | `MESSAGES_SNAPSHOT` |
| Run error | Not in the prototype. Run header with the Error tag, then the error message as an error finding | `RUN_ERROR` |

Outcome tags: Streaming (accent, pulsing dot), Finished (ok), Interrupted (accent), Cancelled
(neutral), Error (err), Stopped by you (warn). "Stopped by you" is transport status, not a protocol
outcome, and appears without any invented terminal frame.

The composer sits under the transcript: a notice line, the message box, a send button, and the
preset's quick messages as chips. Enter sends and Shift+Enter adds a line; the box grows to 120 px.
While an interrupt or pending tool call waits, or a run is streaming, the box, send button and chips
are disabled and the notice says why. New thread and Stop live in the pane header; Stop is enabled
only while a run streams.

### Frames

The filter bar has a search field matching type or raw content, one chip per event family with its
frame count, and an Issues chip that turns red when issues exist. Filters apply to every exchange,
and exchange headers show "shown/total frames" while a filter is active.

Exchanges are listed newest first with the newest expanded (FR-010). A header row shows a chevron,
the method, the path (truncated when tight), a kind tag (the run id, `prepare` or `raw`), a live tag
while streaming, then status, duration, frame count and issue count, with a copy button that copies
the exchange's frames as JSON. Status codes of 400 and above are red.

An expanded exchange shows, in order: the request body behind a disclosure (tagged `resume` or
`a2uiAction` when the input carries one), run-level findings, the response body for non-stream
replies, the timeline strip, and the frame rows.

The timeline strip draws one 2 px tick per received frame at its offset, on a linear scale from 0 to
the exchange's duration. Ticks take the family color; frames with issues get a taller red tick.
Whole seconds are labeled, and the end label is the duration. Derived frames get no tick. While a
run streams, the scale grows with it.

A frame row has four columns: offset as `+s.mmm` in tabular figures, family dot and type, summary,
and verdict (a check, a `derived` tag, or the finding kind). Derived rows have no offset and are
indented behind a dashed lead-in, directly under or near the chunk that produced them. Rows with
issues get a faint red background. A frame that is not JSON shows the type `unparsed` and its byte
count. During capture, new rows fade in.

An expanded frame shows findings first, then "Raw · size as received" with a copy button, then the
pretty-printed JSON, or the text exactly as received when it is not JSON. A derived row says which
chunk produced it and that it was not on the wire (FR-017).

Each of the 31 types needs a one-line summary (T034). The prototype's `summarize()` gives the format
for every type it shows: ids first, then the most useful payload field, with strings quoted and cut
at about 56 characters.

The prototype renders every row. L04 must meet SC-009 at 5,000 frames by the research decision:
native list, lazy expansion, windowing only if the benchmark fails.

### State

The current state as a code block, labeled "sent as state in the next run". Below it, snapshots and
deltas newest first, each with its run, offset and type, and one line per operation: op, path and
the new value.

### Raw request

A short explanation that the request goes out as written, outside the conversation, with presets,
profile and preparation requests not applied. Then the method and path, the editor, live findings
and "Send unchanged". Invalid JSON is an error and disables sending. Run-input schema violations are
warnings and never block. The reply lands in Frames as an expanded `raw` exchange with its findings
and response body.

### Agent

The agent's name and id, the source of its declared capabilities, and the eleven capability groups
in a two-column grid. True values are ok tags, false values are struck-through tags, and other values
are line tags with the value.

### Client profile

A settings list with protocol version, message mode as a segmented control, the A2UI render switch
and the `render_a2ui` injection switch, followed by client tools, context entries and preset
variables with their resolved values. Export profile and Import profile sit at the bottom with the
note "Saved in this browser. Tokens are never saved."

### Session export and import

Export opens a modal dialog that says what the file holds, warns that raw frames can contain
personal or sensitive data, states that headers and tokens are never included, and shows a summary
line with the file name, exchange count, frame count and "0 headers". Its buttons are Cancel and
Export session. Import opens a file picker; a failed import shows its error in place of any success
message and keeps the current session (FR-035).

### Footer

The inspection pane ends with a one-line summary: exchange and frame counts and the privacy facts
for the current mode. Embedded mode reads "requests only to this origin · no telemetry · headers
never recorded"; hosted mode names the allowed target origin instead of "this origin".

## States to cover

The prototype shows a streaming run, a stopped run, interrupted and finished runs, a schema-invalid
frame, an unparsed frame, derived rows, a filter with no matches and the raw-request warnings.

These states are not in the prototype and follow the same parts:

- An empty session shows "No exchanges yet" in the frames list and an empty transcript with the
  composer ready.
- A connection failure is an exchange with status "failed" and an error finding naming the browser
  rule that blocked it: CORS, private network access or secure context (FR-005).
- A failed preparation request is a red `prepare` exchange with its response, followed by a run
  header with the Error tag and the line "Preparation failed; the run was not sent" (FR-028).

## Copy

Write plainly and say what happened and what to do next. Prefer the user's words over the
protocol's where both fit, but keep protocol names wherever the user needs to match them against
the wire. Examples from the prototype: "1 interrupt waiting. Answer it to continue the run.",
"Run stopped · partial recording kept", "approved must be true or false. The interrupt's response
schema requires it." Avoid "successfully", apologies and exclamation marks.

## Accessibility

Every control is a native button, input, select, textarea or dialog. Exchange headers and frame rows
are buttons with `aria-expanded`. The focus ring is a 2 px accent outline at 55% opacity, offset by
1 px. `prefers-reduced-motion` turns off the caret blink, the pulse and the row fade. Text uses
`--muted` or stronger; `--faint` is for decoration only. Status color always comes with a word or an
icon.

The prototype has two gaps the implementation must close. Icon-only buttons need an `aria-label`,
including top-bar buttons whose labels collapse under 720 px. The inspection tabs carry
`role="tab"` without arrow-key handling or `aria-controls`; implement the full tab pattern or use
plain buttons.

## Motion

Chevrons and switches turn in 0.2 s, new frame rows fade in over 0.5 s, toasts slide in over 0.4 s,
live dots pulse every 1.2 s and the streaming caret blinks once a second. All use `--ease`. Nothing
else moves.

## What the prototype fakes

- The session is synthetic. Some field shapes, such as the `RUN_FINISHED` outcome fields, the
  capability groups' fields and the `SUBAGENT_*` payloads, are illustrative; `@ag-ui/core` and the F05
  fixtures define the real shapes.
- The A2UI card is drawn by hand. L05 renders with `@a2ui/react`.
- Import, export, new thread and profile export only show a toast. Runs are scripted timers, not
  network requests.
- The fonts come from Google Fonts, and the Theme tokens panel is a design tool.

## Task map

| Area | Sections here | Slice and tasks |
| --- | --- | --- |
| Tokens and primitives | Theme tokens, Components | F06: T052, T053, T054 |
| Settings, capabilities, profile | Top bar, Agent, Client profile | L01: T023 |
| Connection, reply editors, composer | Top bar, Conversation (tool call, interrupt, composer) | L02: T028 |
| Conversation entries, state | Conversation, State | L03: T031, T032 |
| Frames, raw request, sessions | Frames, Raw request, Session export and import | L04: T034, T035, T037 |
| A2UI surfaces | Conversation (activity) | L05: T040 |
| App shell, responsive layout, footer | Layout, Footer | L07: T049, T051 |
