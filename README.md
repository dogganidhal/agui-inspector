<img src="branding/icon.svg" alt="" width="64" height="64">

# agui-inspector

A developer tool for [AG-UI](https://docs.ag-ui.com) servers: point it at an agent and see the wire. Every request it
sends and every event that comes back, in order, with its timing, checked against the protocol. It drives runs the
way a client does, answering interrupts, tool calls and A2UI surfaces, and sends the requests no client would.

It is designed to work with any AG-UI server, with four distribution modes:

- **embedded**: a server SDK helper mounts it next to your agent routes, on the same origin;
- **hosted**: a static page, pointed at your server;
- **CLI**: `npx agui-inspector --target <url>`, with a local proxy;
- **in-app**: a custom element attached to an agent your application already runs.

## Status

The 0.1.0 MVP is implemented on `main` (see the [specification](specs/001-inspector-mvp/spec.md)). Release
verification is not finished: the headed Mac mini M2 benchmark run (SC-009) is pending with the maintainer, and
nothing is published. The packages are private, and the names were unregistered on 2026-10-02. [ROADMAP.md](ROADMAP.md) tracks release goals,
dependencies and open decisions.

The [original product brief](docs/reference/product-brief.md) preserves protocol details and
architecture inputs for planning.
