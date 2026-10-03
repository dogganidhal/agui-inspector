---
"agui-inspector-python": patch
---

Keep Stop available while a response is still being recorded. A raw request whose response never finishes, and a run the protocol client rejected while its response stays open, can now be stopped, and nothing the server sends after Stop is kept.
