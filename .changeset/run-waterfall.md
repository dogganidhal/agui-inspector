---
"agui-inspector": minor
"agui-inspector-python": minor
---

The Inspection view has a new Waterfall tab. It shows each run of the current thread as nested rows on a time axis: steps, messages, reasoning messages, tool calls and subagent runs, each with a bar from its start to its end and its times as text. A row whose end was not seen is drawn open and labelled "running" or "no end seen". The tree works with the arrow keys, Home, End and Enter, and Enter shows the row's first frame in Frames. The waterfall follows a live run, works on an imported recording, and reads the capture without sending anything. Recordings from 0.1.0 show their waterfall without any change to the file.
