---
"agui-inspector": minor
"agui-inspector-python": minor
---

A Clear session button in the Inspection pane, next to Export session and Import session, empties the page without a reload. It removes every exchange, frame, run and finding and starts a new thread, as New thread does. The agent, the endpoint, the token, the profile and the variables stay. It is disabled while a request is being sent or a response is being recorded, so a stream that is still arriving is never cut. It asks before clearing when something was recorded since the last export. With an imported recording open, it closes the recording, so the page can send again without a reload. Clearing makes no request and writes nothing to storage.
