# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the [Security tab](https://github.com/dogganidhal/agui-inspector/security) and
choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for it.

Say what an attacker can do, the mode it affects (public demo, hosted, embedded or static assets), and the steps or a
proof of concept. Use synthetic data; never send real credentials or real session exports. The discussion and the fix
stay in that private advisory until it is published.

## Supported versions

Nothing has been released yet. Reports apply to the `main` branch and to the
[public demo](https://dogganidhal.github.io/agui-inspector/), which is deployed from it. Once releases exist, fixes go
into the latest one.

## What counts

The inspector makes promises that the [constitution](.specify/memory/constitution.md) and the docs spell out. Breaking
any of them is a vulnerability, for example:

- A credential typed into the inspector reaches browser storage, configuration, a recording, an export or a log.
- The page sends a request outside its policy: to an origin that `hosting-config.json` does not allow, to a third party
  on its own initiative, or with cookies in hosted mode.
- Content from a server (a frame, a request body, an A2UI surface) runs script, loads a remote resource or gets around
  the content security policy.
- `mount_inspector` adds a route while disabled, or serves a file outside its packaged `static` directory.
- The public demo's service worker answers or reads anything beyond its documented routes.

## What does not count

These are documented behavior:

- An enabled embedded inspector shows request bodies, raw frames and the agent list to anyone who can reach its route.
  Keep `enabled` tied to a debug setting and put the route behind your app's authentication
  ([embedding](docs/embedding.md#debug-guard)).
- Bytes a server sends are recorded unchanged, even when they echo a credential. The export dialog warns about this
  ([recordings](docs/recordings.md)).
- Browser rules for CORS, mixed content and local network access apply as the browser enforces them. The inspector does
  not work around them.
