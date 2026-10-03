---
"agui-inspector-python": patch
---

Event streams that end their lines with CRLF or a bare CR now leave the same transcript, state and outcome as LF streams, so the next request carries the assistant reply and the updated state. The recorded bytes are unchanged.
