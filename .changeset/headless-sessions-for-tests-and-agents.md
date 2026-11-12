---
"agui-inspector": minor
"agui-inspector-python": patch
---

Headless sessions run the inspector's runtime, recorder and protocol checks in Node, without a browser. `agui-inspector/testing` opens a session against an AG-UI endpoint, sends messages and raw run inputs, answers interrupts and client tools, fires A2UI v0.9 actions, and reads the frames, findings, conversation, state and surfaces. Assertion functions throw `AssertionError` and can save the session file when they fail. `agui-inspector run` sends one input and writes the session file, with exit codes for findings. `agui-inspector mcp` is an MCP server over standard input and output for coding agents, with no new dependency. Headers never reach a recording, a result or a file, and every written session file comes with the export warning. The page's network error now reads "Could not complete the request to <origin>", because it no longer assumes a browser. The Python package ships the page with that message and does not change otherwise.
