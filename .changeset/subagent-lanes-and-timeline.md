---
"agui-inspector": minor
"agui-inspector-python": minor
---

Each subagent is now a lane in the conversation. A lane holds the messages, tool calls, steps and other events that carry its `subagentRunId`, and a subagent that another subagent starts sits inside its parent's lane. A subagent timeline above the transcript draws one bar for each subagent on a time axis for each run, with its status shown by a word and a glyph. Rows and lane headers jump to each other, and the whole view works from the keyboard. Lanes and the timeline follow a live run and work on an imported recording, including recordings from 0.1.0. They read the capture and send nothing.
