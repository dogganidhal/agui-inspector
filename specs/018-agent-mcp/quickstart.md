# Quickstart: validate headless sessions

Run from the repository root after `npm ci --ignore-scripts` and `npm run build`. Contracts:
[testing-api.md](contracts/testing-api.md), [run-command.md](contracts/run-command.md),
[mcp-server.md](contracts/mcp-server.md).

## 1. The reference agent

```bash
node examples/reference-agent/server.ts --port 8787
```

It prints `{"url": "http://127.0.0.1:8787"}` when ready.

## 2. One run from the command (milestone 1)

```bash
node packages/inspector/lib/cli/main.js run --target http://127.0.0.1:8787/agent --message "hello" --out /tmp/agui-run.json; echo "exit $?"
```

Expected: `exit 0`, a summary line on standard error, and a file that the page's Import session opens with the same
frames.

## 3. A test with the library (milestone 1)

A test file that imports `openSession` and the assertions from `agui-inspector/testing`, opens a session on the
interactive reference server (`createInteractiveServer`), sends the interrupt scenario's message, resolves the interrupt,
and asserts on the messages and findings. Expected: it passes under `node --test`, in under 20 lines of test body
(SC-002). The unit tests under `packages/inspector/tests/headless` are the reference.

## 4. Header privacy

Run step 2 with `--header "Authorization: Bearer synthetic-018"`. Expected: the value appears nowhere: not in the file,
not on standard output or standard error, not in any message. The unit tests search every output this way.

Against `/credential-echo`, the target sends the value back in one frame on purpose. That frame keeps it, because bytes
from the target are evidence and are never redacted (principle IV). The value still appears nowhere else.

## 5. An embedded Python project

Start the FastAPI example as its docstring says (`examples/fastapi/app.py`, port 8000, `EXAMPLE_USER` and
`EXAMPLE_PASSWORD` set). Then:

```bash
export EXAMPLE_AUTH="Basic $(printf '%s:%s' "$EXAMPLE_USER" "$EXAMPLE_PASSWORD" | base64)"
node packages/inspector/lib/cli/main.js run --target http://127.0.0.1:8000/agents/demo/stream --header "Authorization: $EXAMPLE_AUTH" --message "hi"
```

Expected: exit 0 and a session file with the example's five events. Without the header: exit 1 and a recorded 401.

## 6. The MCP server (milestone 3)

```bash
node packages/inspector/lib/cli/main.js mcp --target http://127.0.0.1:8787/agent
```

Send, one per line on standard input: `initialize`, `notifications/initialized`, `tools/list`, then `tools/call` for
`open`, `send` and `read` with `what: "summary"`. Expected: one JSON-RPC answer per request on standard output, nothing
else on it, and a summary whose second content block starts with the untrusted-data line. A scripted client in the unit
tests does the same without a model.

## 7. Full gate

```bash
npm run check:ci
```

## Validation

2026-11-12, T022, step 5 on macOS with Node 24.11.1 and uv 0.9.30: the FastAPI example on port 8018 with synthetic
credentials. With the header, `run` exited 0 and the file held the example's five events (`RUN_STARTED`,
`TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`, `RUN_FINISHED`), with no trace of the password or of its
Base64 form. Without the header, the exchange was recorded with status 401 and `run` exited 1. No code change was
needed.

