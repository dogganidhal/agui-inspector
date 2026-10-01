# agui-inspector

A developer tool for [AG-UI](https://docs.ag-ui.com) servers: point it at an agent and see the wire. Every request it
sends and every event that comes back, in order, with its timing, checked against the protocol. It drives runs the
way a client does, answering interrupts, tool calls and A2UI surfaces, and sends the requests no client would.

It works with any AG-UI server, and loads four ways:

- **embedded**: a server SDK helper mounts it next to your agent routes, on the same origin;
- **hosted**: a static page, pointed at your server;
- **CLI**: `npx agui-inspector --target <url>`, with a local proxy;
- **in-app**: a custom element attached to an agent your application already runs.

## Status

Specification stage: no code yet. [SPEC.md](SPEC.md) defines the first release, 0.1.0, and the stable target,
1.0.0.
