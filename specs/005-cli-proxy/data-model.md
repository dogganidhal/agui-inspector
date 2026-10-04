# Data model: command line inspector

The command keeps no stored data. It holds what its command line says, in memory, for the life of the process. This page
lists the shapes and the rules that tests check.

## Options

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `--target` | URL, repeatable | at least one | Absolute `http` or `https` URL with a host. No credentials, no query, no fragment. |
| `--header` | `Name: value`, repeatable | no | Belongs to the last `--target` before it. See the header rules. |
| `--port` | integer | no, default 4747 | 0 to 65535. `0` asks the system for a free port. |
| `--help` | flag | no | Prints the usage and exits with 0. |
| `--version` | flag | no | Prints the package version and exits with 0. |

Checks run in this order and stop at the first failure: unknown options and missing values (from `parseArgs`), the first
argument as a command name, stray arguments, `--help` and `--version`, `--port`, a header before any target, each target in
order with its headers, at least one target. Nothing listens before all of them pass.

## Target

| Field | Meaning |
| --- | --- |
| `n` | Position from 1, in command-line order. |
| `url` | The parsed target URL. `href` is its text. |
| `origin` | `url.origin`. The allowlist is the set of these. |
| `host`, `port`, `tls` | What the relay connects to: the host without brackets, the port (80 or 443 by default) and whether the scheme is `https`. |
| `path` | `url.pathname`, at least `/`. It is the tail of the agent's `url` in `config.json`. |
| `headers` | The held headers, keyed by lowercase name. A repeated name replaces the earlier value. |

A target never holds credentials in its URL, so `href` can go into `config.json` and into the startup line.

## Header rules

- The text before the first `:` is the name. It is an HTTP header token (`!#$%&'*+.^_`|~0-9A-Za-z-`) and is not `host`,
  `content-length`, `transfer-encoding` or `connection`, in any case.
- The text after it is trimmed. It is nonempty and `http.validateHeaderValue` accepts it (no line break, no control
  character).
- A header before any `--target` is an error.

## Proxy path

`/proxy/<n>` stands for target `n` on the page's own origin. `n` is plain digits with no leading zero, from 1 to the
number of targets. The text after it, and the query, are the path sent to the target (`/` when there is none). A path
that names no target is refused with 403.

## Served configuration

The version 0 `config.json` built by the core from one agent per target:

```json
{
  "version": 0,
  "agents": [
    { "id": "target-1", "url": "/proxy/1/agent", "name": "http://127.0.0.1:8787/agent" },
    { "id": "target-2", "url": "/proxy/2/", "name": "https://agent.example/" }
  ]
}
```

No `theme`, `capabilities` or `preset`. No header, no credential and no other field. The page reads it from its own
directory, which is the root of the command's address.

## Own origins

The two origins the guards accept for the page: `http://127.0.0.1:<port>` and `http://localhost:<port>`, where `<port>` is the
bound port (known after the listener is ready, so a `--port 0` run uses the real one). The accepted `Host` values are the
same two without the scheme.

## State

None changes after startup. The set of targets, the held headers and the port are fixed for the run. Stopping the process
discards them.
