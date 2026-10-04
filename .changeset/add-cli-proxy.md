---
"agui-inspector": minor
---

The package has a command, `agui-inspector`, that serves the inspector on your machine and relays its requests to any AG-UI server. Run `npx agui-inspector --target <url>`. The server needs no CORS setup and no helper. The command listens on `127.0.0.1` only, connects only to the targets you name, and passes request and response bytes through unchanged, so the recorded frames, their order and their timing are the server's. `--header "Name: value"` after a target sends that header to it and to no other target. A header stays in the command's memory and is never printed, served or exported. It needs Node.js 22.12 or newer, adds no runtime dependency, and keeps replay and the conformance suite free as later subcommands.
