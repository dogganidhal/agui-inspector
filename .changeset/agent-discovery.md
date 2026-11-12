---
"agui-inspector": minor
"agui-inspector-python": minor
---

The page's files now include `llms.txt`, a short guide for coding agents, so an agent working in a project that embeds or runs the inspector can find out how to use it. Every mode serves it next to the page, behind the same authentication: `mount_inspector`, the Express, Hono and Next.js helpers, the command and the static assets. It says where the page and its list of agents are, how to build a launch link, and how to drive an agent with `agui-inspector run` or `agui-inspector mcp`. It holds no configuration value and no credential. The helpers' startup warning now ends with `; guide for coding agents at <mount>/llms.txt`, the command prints a `guide for coding agents:` line after its target lines, and the page links to the guide with `rel="describedby"`. The JavaScript helpers serve `.txt` files as `text/plain`. A new docs page has the guide and blocks to paste into a project's `AGENTS.md` or `CLAUDE.md`.
