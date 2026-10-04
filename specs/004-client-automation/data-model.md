# Data model: Client automation

Two saved formats gain optional fields and stay at version 0: the client profile (browser storage and the exported
file) and the session file (the `runs` list). Nothing else is saved. The runtime keeps two small values in memory.

## ClientProfileSettings (extended)

Three optional fields join the seven in `contracts.ts`. The other seven are unchanged.

| Field | Type | Default | Rule |
| --- | --- | --- | --- |
| `interruptReply` | `"resolve"` or `"cancel"` | absent (by hand) | Any other value is an error that names the field. The key is left out of the parsed value when absent. |
| `interruptPayloads` | object, interrupt reason to JSON value | absent (the starting answer) | Every key is a nonempty string, the `reason` of an interrupt. Every value is any JSON value except `null`, which the protocol's run input schema refuses as a resume payload. Order is kept. An empty object parses to absent. Used only when `interruptReply` is `"resolve"`, and kept when it is not. |
| `toolResults` | object, tool name to text | absent (by hand) | Every key is the `name` of a tool in the same profile. Every value is a nonempty string. Order is kept. An empty object parses to absent. |

Notes:

- `toolResults` keys are matched against `tools` after the tools are validated, so a profile that removes a tool and
  keeps its script is invalid. The settings panel removes both in one change.
- A script is not part of the tool entry, so `tools` in the run input is the same with or without scripts.
- A script that equals what the developer would have typed produces the same tool message `content`, byte for byte. It is
  not trimmed, parsed or templated.
- The injected `render_a2ui` tool is not in `tools`, so it cannot have a script.
- `interruptPayloads` keys cannot be checked against a list: `Interrupt.reason` is a required open string in
  `@ag-ui/core`, so any nonempty text is a valid key. A payload for a reason no interrupt has is unused.
- A payload is not checked against any response schema, and it is sent as the JSON value in the file, parsed once, with
  the key order of the file. It is the value the manual editor would hold if the developer typed the same JSON.
- Both lookups at run time use `Object.hasOwn`, because the tool name and the reason come from the agent's stream. See
  [research R3](research.md).

Export writes the envelope `{ "version": 0, "profile": { ... } }` with the three fields only when they are set. Import and
load use the same `parseProfileSettings`. See [contracts/automation.md](contracts/automation.md#profile-file).

## InterruptAnswer and ToolResultDraft (extended)

| Entity | New field | Meaning |
| --- | --- | --- |
| `InterruptAnswer` | `automatic?: true` | The inspector gave this answer. Absent when the developer did. |
| `ToolResultDraft` | `automatic?: true` | The inspector gave this result from the profile. Absent when the developer did. |

Both live in the runtime's pending replies, which are memory only. The value of an automatic answer is
the draft the reply already had, or the profile's payload for the interrupt's reason: an interrupt keeps the starting
answer from its response schema unless the profile has a payload for its reason, which replaces the draft, and a tool
draft takes the script as its `resultDraft`. The status changes the way a manual change does (`resolved` or `cancelled`, `answered`).

## Run (extended)

| Field | Type | Rule |
| --- | --- | --- |
| `automaticReplies?` | `{ interruptIds: string[]; toolCallIds: string[] }` | Present only when at least one id is in it. The ids are the ones the run's input carried and the inspector answered. |

The session file's `runs` entry gets the same optional key. Validation: an object with exactly the two keys, each a list of
nonempty strings. It does not check the ids against the run's input: the projection ignores an id that matches nothing,
and a session file is not the place to repeat protocol checks.

A run without the field is read as "every reply was given by the developer", which is what every 0.1.0 session means.

## Runtime values (memory only)

| Value | Meaning | Changes |
| --- | --- | --- |
| `streak` | Automatic continuations sent in a row, from 0 to 10. | +1 when an automatic run is sent. Set to 0 when a developer run is sent, on `newThread` and on a target change. |
| `paused` | The limit stopped an automatic reply the profile would have given. | Set when that happens. Cleared when the next run is sent, on `newThread` and on a target change. |

`AUTOMATIC_REPLY_LIMIT` is the constant 10 in `replies.ts`. It is not a setting.

## Projection (extended)

| Entity | New data | Source |
| --- | --- | --- |
| `RunEntry.carried` | one item `automatic · <interrupt ids>` when `automaticReplies.interruptIds` is not empty | the `Run` of the exchange |
| `ToolResult` | `automatic?: true` when the tool message answers a call in `automaticReplies.toolCallIds` | the `Run` of the exchange |

State transitions of a reply, with the new edge:

```text
unanswered/pending ──developer: Resolve, Cancel, Submit result──▶ resolved/cancelled/answered   (no mark)
unanswered/pending ──profile when the run ends, below the limit──▶ resolved/cancelled/answered  (automatic: true)
unanswered/pending ──profile when the run ends, at the limit────▶ unanswered/pending             (paused)
```

An answered reply stays final until the next run starts, as in 0.1.0.
