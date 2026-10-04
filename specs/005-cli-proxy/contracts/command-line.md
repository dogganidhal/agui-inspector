# Contract: the command line

What a developer types and what comes back. Everything here is checked by a test (see `quickstart.md` and the test plan
in `plan.md`).

## Usage

```text
agui-inspector [options]

Options:
  --target <url>            An AG-UI endpoint to inspect. Repeat it for more than one.
  --header "<Name>: <value>"  A header to send to the target before it. Repeat it for more.
  --port <number>           Port to listen on. Default 4747. Use 0 for any free port.
  --help                    Show this text.
  --version                 Show the version.
```

`agui-inspector` is the `bin` of the `agui-inspector` npm package. `npx agui-inspector --target <url>` runs it. It needs
Node.js 22.12 or newer.

The first argument that does not start with `-` is a command name. None exists yet. The same layout will hold
`agui-inspector replay ...` and `agui-inspector test ...` later, and the options above keep working without a command.

## Output

| Stream | Content |
| --- | --- |
| Standard output | `--help` and `--version` text. After the listener is ready, the startup lines below. |
| Standard error | A usage error or a startup failure (one message), and later one line for each failure to reach a target. |

Startup lines (names of headers, never values):

```text
agui-inspector listening on http://127.0.0.1:4747/
  /proxy/1 -> http://127.0.0.1:8787 (headers: Authorization)
  /proxy/2 -> https://agent.example
```

The line for a target with no header ends after its origin. The first line is printed only after the listener is ready.

A failure to reach a target on a later request, one line:

```text
agui-inspector: could not reach http://127.0.0.1:8787 (ECONNREFUSED)
```

## Exit codes

| Code | When |
| --- | --- |
| 0 | `--help`, `--version`, and a stop by `SIGINT` or `SIGTERM`. |
| 1 | Startup failed for a reason that is not the arguments: the port is in use, another listen error, the packaged page files are missing. |
| 2 | The arguments are wrong, or a target points at the command's own listener. |

## Messages

Each usage error is printed on standard error as `agui-inspector: <message>`, then a pointer on the next line:
`Run agui-inspector --help for the options.` Messages are fixed text with at most an option name, a number or an origin.
None contains a header value, or a target's query or credentials. The table lists the `<message>`.

| Cause | Message starts with |
| --- | --- |
| No target | `--target is required` |
| Target not an absolute http or https URL | `--target must be an absolute http or https URL` |
| Target has credentials | `--target must not contain credentials; use --header` |
| Target has a query or fragment | `--target must not contain a query or a fragment; use --header for secrets` |
| Header before a target | `--header must come after the --target it belongs to` |
| Header malformed | `--header must be "Name: value" with a nonempty value` |
| Header name refused | `--header must not set Host, Content-Length, Transfer-Encoding or Connection` |
| Port not a number from 0 to 65535 | `--port must be a whole number from 0 to 65535` |
| First argument is not an option | `unknown command "<name>"` |
| Stray argument | `unexpected argument; quote a --header value that has spaces` |
| Unknown option | `unknown option "<name>"`, with the name of the option and nothing after it |
| Missing value, value given to a flag | `<option> needs a value`, `<option> takes no value` |
| Target is the command's own listener | `--target points at this command's own address` |
| Port in use (exit code 1) | `port <n> is already in use; choose another with --port`, with no pointer |
| Page files missing (exit code 1) | the core's message, which names `npm run build`, with no pointer |

## Stop

`SIGINT` and `SIGTERM` stop listening, close every open connection, relays in progress included, and exit with 0.
