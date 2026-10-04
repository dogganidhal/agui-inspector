# Automation contracts

Version-0 contracts. Nothing here is a published stable schema. The names below go into
`packages/inspector/src/contracts.ts`. Field and function names are the plan's choice and the tasks may refine a
spelling without changing behavior.

## Profile file

The envelope is unchanged: `{ "version": 0, "profile": { ... } }`. The profile gains three optional keys.

```json
{
  "version": 0,
  "profile": {
    "protocolVersion": "1.0",
    "tools": [
      { "name": "pick_color", "description": "Ask the user for a color", "parameters": { "type": "object", "properties": {} } },
      { "name": "pick_size", "description": "Ask the user for a size", "parameters": { "type": "object", "properties": {} } }
    ],
    "context": [],
    "renderA2ui": true,
    "injectA2uiTool": false,
    "forwardedProps": {},
    "interruptReply": "resolve",
    "interruptPayloads": { "approval": { "approved": true, "note": "auto" } },
    "toolResults": { "pick_color": "teal", "pick_size": "{\"size\":2}" }
  }
}
```

Rules, checked by `parseProfileSettings` for import, load and the settings panel:

| Input | Result |
| --- | --- |
| No `interruptReply`, no `toolResults` (every 0.1.0 profile) | Accepted. Every reply is by hand. |
| `interruptReply` is `"resolve"` or `"cancel"` | Accepted. |
| `interruptReply` is anything else, including `"manual"`, `null` and `""` | Error: `profile.interruptReply must be "resolve" or "cancel"`. |
| `interruptPayloads` is not an object (a list, text, `null`) | Error: `profile.interruptPayloads must be an object from interrupt reason to JSON`. |
| An `interruptPayloads` key that is empty | Error: `profile.interruptPayloads: an interrupt reason cannot be empty`. |
| An `interruptPayloads` value that is not JSON (possible from code, not from a file) | Error: `profile.interruptPayloads.<reason> must be JSON`. |
| An `interruptPayloads` value that is `null` | Error: `profile.interruptPayloads.<reason> cannot be null: the protocol's run input does not accept a null answer`. |
| `interruptPayloads` is `{}` | Accepted and read as absent. |
| `interruptPayloads` set while `interruptReply` is absent or `"cancel"` | Accepted and kept. It is not used. |
| `toolResults` is not an object (a list, text, `null`) | Error: `profile.toolResults must be an object from tool name to text`. |
| A `toolResults` key that is not the name of a tool in `tools` | Error: `profile.toolResults: no tool named "<name>"`. |
| A `toolResults` value that is not text or is empty | Error: `profile.toolResults.<name> must be nonempty text`. |
| `toolResults` is `{}` | Accepted and read as absent. |
| Any other key | Error, as today. |

An error never changes the profile in use. Export writes each new key only when it is set, so an exported default profile
equals a 0.1.0 export.

## Run record

`Run` gains an optional field. The session file's `runs[]` entry gains the same key, and `runOut` copies it.

```json
{
  "id": "run-2",
  "threadId": "t-1",
  "runId": "r-2",
  "parentRunId": "r-1",
  "input": { "...": "the continuation as sent" },
  "exchangeId": "ex-2",
  "startedAt": 1759600000000,
  "outcome": { "kind": "success", "pendingToolCallIds": [] },
  "automaticReplies": { "interruptIds": ["i-approve", "i-contact"], "toolCallIds": [] }
}
```

A session file without `automaticReplies` imports as before. A session file with it whose value is not an object with the
two string lists fails with `runs[n]: automaticReplies ...`, as every bad run field does today.

## Pure functions (`core/runtime/replies.ts`)

```ts
export const AUTOMATIC_REPLY_LIMIT = 10;

export type Automation = Pick<ClientProfileSettings, 'interruptReply' | 'interruptPayloads' | 'toolResults'>;

/** What the profile answers for these replies. Returns `replies` itself when it answers nothing. */
export function automate(replies: PendingReplies, automation: Automation): PendingReplies;

/** The ids of the replies the inspector answered, or undefined when there are none. */
export function automaticReplies(replies: PendingReplies): AutomaticReplies | undefined;
```

`automate`:

- An interrupt still `unanswered` becomes `resolved` or `cancelled` per `interruptReply`, with `automatic: true`. With
  no `interruptReply` it is left alone. When it resolves, its draft becomes a clone of `interruptPayloads[reason]` if
  `reason` (read from the interrupt of the same id in `replies.source`) is an own key of `interruptPayloads`, and
  stays the starting answer otherwise. A payload is never checked against `responseSchema`. Cancel ignores payloads.
- A tool draft still `pending` whose `toolName` is an own key of `toolResults` takes that text as `resultDraft` and becomes
  `answered`, with `automatic: true`. A draft with an empty `toolName` or no script is left alone.
- It never touches an answered reply, a `source` entry or an id. It returns the same object when nothing changed, which
  is how the runtime tells "nothing to answer" from "answered".

## Profile edits (`core/profiles/index.ts`)

The settings panel builds the next profile with four small pure functions, each returning a new profile that then goes
through `parseProfileSettings`. They exist so that one change can touch two settings and so that no map is left empty.

```ts
export function setInterruptReply(settings, reply: InterruptReply | undefined): ClientProfileSettings;
export function setInterruptPayload(settings, reason: string, payload: JsonValue | undefined): ClientProfileSettings;
export function setToolResult(settings, name: string, text: string | undefined): ClientProfileSettings;
/** Removes the tool and its scripted result together, so the profile stays valid. */
export function removeTool(settings, name: string): ClientProfileSettings;
```

An unset setting is a missing key. Setting the last entry of a map to `undefined` removes the map. An edit keeps the
order of the other entries, and `__proto__` is an ordinary own key.

## Runtime behavior (`core/runtime/index.ts`)

`dispatch(turn)` is a loop:

```text
turn := the developer's turn
automatic := false
repeat
  sent := dispatchRun(turn, automatic)            // the existing body; true when a run was sent and not stopped
  turn := sent ? automaticTurn() : none
  automatic := true
until no turn
```

`dispatchRun` is the existing `dispatch` body. At the point it clears the waiting replies and calls `execute`, it also sets
`streak` (+1 when `automatic`, else 0) and clears `paused`. It returns true when it reached `execute` and the run's
controller was not aborted.

`automaticTurn()`:

1. If nothing is owed, return none.
2. `answered := automate(replies, options.settings().profile)`. If `answered === replies`, return none.
3. If `streak >= AUTOMATIC_REPLY_LIMIT`, set `paused`, emit, return none. The replies stay as they were.
4. Keep `answered` as the pending replies and emit, so the cards show the answers and their marks.
5. If anything is still unanswered (a mixed run), return none. The developer finishes it.
6. Build the continuation turn with the same function `continueRun` uses. On an error, show it and return none. The
   answers stay, as for a failed manual continuation.
7. Return the turn. It carries `automaticReplies(answered)`, which `execute` writes onto the `Run`.

`continueRun`, `answerInterrupt`, `submitToolResult`, `send` and `sendA2uiAction` call `dispatch` as before. Their promise
resolves when the whole chain has ended.

`changeTarget` and `newThread` set `streak` to 0 and `paused` to false where they already clear the replies.

### Notice

The runtime's `notice` is `waitingNotice(replies)` followed, when `paused`, by
`Automatic replies paused after 10 in a row. Answer by hand to continue the run.`
The composer is already disabled while a notice exists, and it is, because the replies still wait.

## Views

| Where | Change |
| --- | --- |
| Settings, "Client profile" group | A segmented control `Interrupt replies`: By hand, Resolve, Cancel. |
| Settings, "Interrupt payloads" group | One row for each reason in `interruptPayloads`: the reason, a JSON editor labelled `Payload for <reason>` and a button `Remove payload for <reason>`. A form with `Interrupt reason` and `Payload` (JSON) fields and an `Add payload` button. A note says payloads are used when Interrupt replies is Resolve and are sent as written. |
| Settings, "Client tools" | Each tool row shows `answered by hand` or `answered with a scripted result`, and a text area `Scripted result for <name>`. Clearing it removes the script. Removing the tool removes the script. |
| Connection, answered interrupt card | A tag `Automatic` when `automatic` is set. |
| Connection, answered tool card | A tag `Automatic` when `automatic` is set. |
| Connection, tool card footer | `The next run starts once every pending call has a result, and carries each as a tool message. Calls without a scripted result wait for you.` |
| Conversation, run entry | `Carried:` gains `automatic · <ids>`, the interrupt ids and tool call ids the input carries and the run record names. The existing items `resume · n answers` and `tool result · <id>` stay. |
| Conversation, tool card | `Result · automatic` for a scripted result, `Result · entered by you` for the rest. |

Every new control has an accessible name and works from the keyboard like its neighbors.

## Reference agent

`interactiveResponse` answers the last user message `interrupt forever` with a run that ends with one interrupt
`i-loop-<runId>` (`reason: "input"`, a short message, no response schema). It checks this before the resume branch, so a
continuation of the loop interrupts again. It is exported as `INTERRUPT_FOREVER` from `scenarios.ts` and
`interactive-scenarios.ts`. It is not in `SCENARIOS` and not a demo quick message.
