---
"agui-inspector": minor
"agui-inspector-python": minor
---

The page keeps your setup across a reload: the selected agent or the endpoint you applied, and the values of that agent's preset variables. They are saved in browser storage under `agui-inspector.setup`, beside the profile. The token, the header name, the thread, the conversation and the message box are never saved. A launch link opens the page with everything filled in, so you only press send. The values go after `#` in the page's address: `agent` or `endpoint`, `var.<name>`, `context`, `forwardedProps` and `message`. A link never sends anything by itself, never reaches past the page's allowed destinations, and refuses keys that name a credential. Each bad key shows a "Link" warning and the rest applies. Link values win over saved ones and are saved; the message is not. The format is version 0 and is described on the new "Saved setup and launch links" docs page. Without a link and without a saved setup, the page starts as before.
