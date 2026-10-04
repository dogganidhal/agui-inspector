# Contract: lanes and timeline

What the projection, the derivation and the two views promise. Tests check each item. Types are in
[data-model.md](../data-model.md).

## 1. Attribution (projection)

An event with a `subagentRunId` makes its entry in that invocation's lane, in the run being read. The table lists every
event type that can carry the field.

| Event types | Entry | In a lane |
| --- | --- | --- |
| `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `TEXT_MESSAGE_CHUNK` | message | yes |
| `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_CHUNK`, `TOOL_CALL_RESULT` | tool call (a result with no call is a message) | yes |
| `STEP_STARTED`, `STEP_FINISHED` | step, with its own stack per lane | yes |
| `REASONING_START`, `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `REASONING_MESSAGE_CHUNK`, `REASONING_END` | reasoning | yes |
| `REASONING_ENCRYPTED_VALUE` | encrypted marker (metadata only) | yes |
| `ACTIVITY_SNAPSHOT`, `ACTIVITY_DELTA` | activity | yes |
| `CUSTOM`, `RAW` | marker | yes |
| `STATE_SNAPSHOT`, `STATE_DELTA` | none in the conversation | no |
| `SUBAGENT_STARTED`, `SUBAGENT_FINISHED`, `SUBAGENT_ERROR` | the lane itself, here `subagentRunId` names the subject | not applicable |
| `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `MESSAGES_SNAPSHOT` | no field | not applicable |

Rules:

1. Without the field, the entry goes to the parent's flow. A lane being open changes nothing.
2. The projection issues for an attributed frame (an event that points at something never started) go into the same
   container as the frame's entries.
3. A chunk lane (the client's expansion state) is keyed as before by tag or id. An entry a chunk opens goes to the lane of
   the chunk's `subagentRunId`.
4. A frame that is invalid, unknown or schema-invalid projects to nothing, as before.
5. A lane is created once per run and invocation. A lane created by an attributed event before any start has
   `startOffsetMs` unset.
6. `MESSAGES_SNAPSHOT`: a lane stays while it is open (all lines are starts, or it has none) or while something inside
   it stays. Otherwise it leaves the entries, keeps its place in `model.subagents` and gets `inTranscript: false`. A
   later attributed event puts the same lane object back into the current container with empty `children`.

## 2. The shared derivation

```ts
// core/projection/subagents.ts
export function timelineOf(model: ConversationModel): TimelineChart[];
```

- Pure. No React, no store, no clock. Reads `model.subagents` and the `run` entries of `model.entries`.
- One chart for each run entry that has at least one lane, in the order of the runs.
- Rows: the run row, then lanes depth first, siblings in creation order. A lane whose `parentLaneId` is not in the chart
  sits under the run row.
- `depth`, `startMs` and `endMs` as in the data model. `endMs` is never less than `startMs`.
- It does not depend on `model.entries` apart from reading the run entries, so a transcript replacement does not shorten
  it.

Reuse by the waterfall (spec 011): it can read `model.subagents` for the relationships (which run, which parent lane,
which tool call and message started it, offsets, status) and `RunEntry.startOffsetMs`, `durationMs` and `axisMs` for run
extents. Neither view imports the other. If the waterfall needs a field, it is added to `SubagentEntry` here.

## 3. Lane markup (conversation)

```text
div.agui-lane  data-entry="subagent"  data-subagent="<subagentRunId>"  data-lane="<entry id>"  data-status="<status>"
├── div.agui-lane-head
│   ├── button.agui-lane-toggle  aria-expanded  aria-controls  aria-label="<name for assistive technology>"
│   │     icon, name (or id), id tag, status tag (pulse when running), "Continued", "Start not received",
│   │     parent text, start offset and duration (title: "Derived from frame offsets, not received"), counts
│   ├── button  "Show in timeline"
├── div.agui-lane-body  id  (rendered only while open)
│     description, "via tool call <id>", "message <id>"
│     ul.agui-conv-lines  (lifecycle lines, as 0.1.0: phase tag, offset, outcome, code, interrupt ids, detail, frame reference)
│     children through the conversation's entry renderer, or "No events in this lane."
```

- Open when first shown. The toggle changes `aria-expanded` and mounts or unmounts the body. State survives updates.
- The existing `data-entry="subagent"` and `data-subagent` attributes stay, so the 0.1.0 selectors still find one block
  per subagent.
- A lane inside a lane indents with a rail. Indentation is decoration. The name states the nesting.
- Counts cover direct entries: messages, tool calls and nested lanes, found through the lane's steps but not through
  nested lanes. Zero counts are left out.

### Names for assistive technology

Lane toggle and timeline row use one builder:

`<name or "Subagent <id>">, subagent <id>, <status word>, <duration or "no duration">, starts +<offset>s[, nested under
<parent name>][, continued][, start not received]`

The toggle adds "collapse" or "expand" through `aria-expanded`. The row says that activating it shows the lane.

### Status words, shapes and bar styles

| Status | Word | End glyph | Bar style |
| --- | --- | --- | --- |
| `running` | Running | `▸` | accent fill, open right end, pulse (not under reduced motion) |
| `finished` | Finished | `✓` | solid fill, `ok` tint |
| `suspended` | Suspended | `‖` | dashed outline, no fill |
| `error` | Error | `✕` | solid fill, `err` tint |
| `stopped` | Stopped by you | `■` | dotted outline, `warn` tint |
| `no-end` | No end event | `?` | dotted outline, no fill |

Word and glyph are text, so they survive forced colors and removed color. The glyph is `aria-hidden`. The word is in the
row's name.

## 4. Timeline markup (conversation)

```text
section.agui-tl  data-timeline="subagents"  (above the transcript, only when model.subagents is not empty)
└── Disclosure "Subagent timeline" + counts  (open when first shown; opens on a jump request)
    └── for each chart:
        div.agui-tl-chart  data-chart="<exchangeId>"
        ├── heading line: run id, "axis: offsets from request dispatch", the derived note
        └── div.agui-tl-box  tabindex=0  role="region"  aria-label="Timeline of run <id>"  (max height, scrolls)
            ├── div.agui-tl-axis  aria-hidden  (tick labels, same rule as the frames list)
            └── ol.agui-tl-rows
                ├── li  run row (text, bar, not a button)
                ├── li > button.agui-tl-row  data-tl-row="<lane id>"  data-status  tabindex 0 or -1  aria-label
                │     span.agui-tl-label  (indent by depth, ellipsis, title = full text)
                │     span.agui-tl-track > span.agui-tl-bar (style left, width) > span.agui-tl-end (glyph)
                │     span  status word and duration (visible text)
                └── button "Show <n> more rows"  (after the first 100 rows)
```

- A bar's `left` is `startMs / axisMs`, its `width` is `(endMs - startMs) / axisMs`, as percentages, clamped to the
  track. A minimum width keeps a zero-length bar visible.
- A row whose lane is not in the transcript says "Replaced transcript" beside its status and its activation calls
  `onReveal({ exchangeId, frameId })` for its start frame, or for its first frame when it has no start. Without
  `onReveal` the row is not a jump target and says so in its name.
- The note says: "Positions and durations are derived from the offsets at which frames arrived. The optional timestamp
  of an event is not used."

## 5. Keys

| Where | Key | Action |
| --- | --- | --- |
| Timeline rows | Tab | Enters or leaves the rows as one stop. The active row has focus. |
| Timeline rows | ArrowDown, ArrowUp | Next or previous row, across charts. No wrap. |
| Timeline rows | Home, End | First or last row of the timeline. |
| Timeline row | Enter, Space | Jump to the lane: open what hides it, scroll, focus its toggle. |
| Chart box | Arrow keys, Page keys | Native scroll of the box. |
| Lane toggle | Enter, Space | Collapse or open the lane. |
| Lane header | Tab | Toggle, "Show in timeline", then the frame references. |
| "Show in timeline" | Enter, Space | Open the timeline and the chart's full list if needed, focus the row. |
| "Show n more rows" | Enter, Space | Show the rest of the chart. Focus stays on the row that was next. |

The handler acts only for events from a row, so typing in the composer or another control is never taken.

## 6. Texts

Lane: "Subagent", "Continued", "Start not received", "Parent <id> not seen in this run", "No events in this lane.",
"Show in timeline", "via tool call <id>". Counts: "<n> messages", "<n> tool calls", "<n> subagents" (singular for 1).
Timeline: "Subagent timeline", "Show <n> more rows" ("Show 1 more row" for one), "Replaced transcript". All rendered as React text, so a name or an id
that looks like Markdown or HTML is shown as typed.

## 7. Docs the tests read

`event-views.mdx` states: that each subagent invocation is a lane and that lanes nest, the six statuses with their
words, that the timeline uses arrival offsets and not the event timestamp, the jump actions, the keys of section 5,
that state events and whole messages are not in lanes, and that live and imported sessions behave the same. The 31 event
types stay mapped, as `docs.test.ts` requires.

## 8. What does not change

The recording, the session and recording formats, the frames list and its filters, the state view, request sending, the
content security policy, the theme tokens and the public props of `ConversationView`.
