# Data model: Subagent lanes and timeline

All of this is derived data in memory. Nothing is stored, exported or added to the session format. Types live in
`core/projection` and use only plain data.

## Lane (`SubagentEntry`, extended)

One lane is one segment: one invocation inside one run. It is the existing `SubagentEntry`, with these fields added.
Existing fields (`subagentRunId`, `name`, `description`, `parentToolCallId`, `parentSubagentRunId`, `parentRunId`,
`lines`, `frames`, `exchangeId`, `id`) keep their meaning.

| Field | Type | Meaning |
| --- | --- | --- |
| `children` | `ConversationEntry[]` | The entries of events that carry this invocation's id, in arrival order. Steps the lane opened hold their own children. Nested lanes are children. |
| `status` | `SubagentStatus` | See below. Set after the run's frames are read. |
| `parentLaneId` | `string?` | The `id` of the lane it sits in. Set only when the lane was created by its own `SUBAGENT_STARTED` and its `parentSubagentRunId` had a lane in the same run. |
| `parentMessageId` | `string?` | The message that held the spawning tool call, from the start event. |
| `startOffsetMs` | `number?` | Offset of the first `SUBAGENT_STARTED` frame. Absent when none arrived ("Start not received"). |
| `firstOffsetMs` | `number` | Offset of the frame that created the lane. |
| `endOffsetMs` | `number` | Offset of the end line, or of the last valid frame of the exchange when there is none. Set after the run's frames are read. |
| `continued` | `boolean` | An earlier run of the thread had a lane for the same id. |
| `inTranscript` | `boolean` | False when a `MESSAGES_SNAPSHOT` removed the lane from the entries. |

`SubagentLine` gets an optional `interruptIds` (from the outcome of a suspended finish).

### Status

`SubagentStatus = 'running' | 'finished' | 'suspended' | 'error' | 'stopped' | 'no-end'`.

| Latest lifecycle line of the lane in the run | Exchange state after the run's frames are read | Status |
| --- | --- | --- |
| finished, outcome `suspended` | any | `suspended` |
| finished, outcome `success` or none | any | `finished` |
| error | any | `error` |
| started, or no line | live and the run has no terminal event | `running` |
| started, or no line | stopped by the developer | `stopped` |
| started, or no line | otherwise | `no-end` |

Transitions inside one run: a lane is created `running`. Each lifecycle line replaces the status by the table. A later
start line after an end line makes it `running` again. Status is final when the exchange's frames are all read, and a
live exchange recomputes it with every projection.

### Placement

| Event | Where its entry goes |
| --- | --- |
| Carries `subagentRunId`, makes a conversation entry | The container of that invocation's lane: the top step of the lane's own stack, else the lane's `children`. The lane is created if the run has none. |
| Carries no `subagentRunId` | The container of the parent's flow, whatever lane is open. |
| `SUBAGENT_STARTED` that creates a lane | The container of the parent lane when `parentSubagentRunId` names a lane of this run. Otherwise the container of the parent's flow. |
| `SUBAGENT_FINISHED` or `SUBAGENT_ERROR` | Adds a line to the lane. Creates the lane in the parent's flow when the run has none. |
| State event | Not a lane entry. Stays in the state model. |
| Whole message from a run's input or a snapshot | As in 0.1.0. |

## Model additions

- `ConversationModel.subagents: SubagentEntry[]`. Every lane, in creation order, including lanes with `inTranscript:
  false`. The only source for the timeline.
- `RunEntry.axisMs: number`. The end of the run's exchange on the offset axis: `max(exchange.elapsedMs ?? last, last,
  1)` where `last` is the offset of the exchange's last frame of any kind.

## Chart and row (`core/projection/subagents.ts`)

```text
TimelineChart
  exchangeId   string       the run's exchange
  run          RunEntry     the run, for its label and extent
  axisMs       number       run.axisMs
  rows         TimelineRow[]  depth first: run row, then lanes

TimelineRow (a run row or a lane row)
  kind         'run' | 'subagent'
  id           string       the run entry's or the lane's id
  depth        number       0 for the run row, 1 for a lane directly under the run, then +1 per nesting level
  startMs      number       run: startOffsetMs or 0. Lane: startOffsetMs, else firstOffsetMs
  endMs        number       run: startMs + durationMs. Lane: endOffsetMs. Never less than startMs
  lane?        SubagentEntry   present for a lane row, for its status, name, id, parent and inTranscript
```

Rules: a chart exists only for a run with at least one lane. Lanes whose `parentLaneId` is in the chart sit under that
row. Siblings are in creation order, which is start order. A lane whose `parentLaneId` is absent sits under the run row.

## Relationships

- A run entry has zero or more lanes, all with its `exchangeId`.
- A lane has zero or one parent lane (`parentLaneId`) and zero or more nested lanes (the lanes in its `children`, found
  through steps too).
- A lane may have a lane of the same `subagentRunId` in another run (`continued`).
- The timeline row of a lane points back at the lane. The lane's toggle points at its row by lane id.

## Validation rules from the spec

- Every entry made by an event with `subagentRunId = X` is in the lane for X of that run, and in no other lane (FR-001).
- The lane for X sits in the lane for Y when X's start named Y and Y's lane was created earlier in the run (FR-003).
- An entry whose event has no `subagentRunId` is never in a lane (FR-001).
- Status follows the table above and never carries an outcome no frame carried (FR-007).
- A bar's start and end are frame offsets, or the last valid frame offset for an open lane (SC-003).
