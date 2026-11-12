# Quickstart: Agent discovery

## Python embedded

```bash
npm run package:python
export EXAMPLE_USER=dev EXAMPLE_PASSWORD="$(openssl rand -hex 8)"
EXAMPLE_DEBUG=1 uv run --project packages/python --locked --extra embedded --group test \
  python examples/fastapi/app.py --port 8000
```

The log shows:

```text
agui-inspector is enabled and mounted at /agui-inspector; disable it outside development; guide for coding agents at /agui-inspector/llms.txt
```

Fetch the guide with the host's credentials, as for the page:

```bash
curl -u "$EXAMPLE_USER:$EXAMPLE_PASSWORD" http://127.0.0.1:8000/agui-inspector/llms.txt
curl -u "$EXAMPLE_USER:$EXAMPLE_PASSWORD" http://127.0.0.1:8000/agui-inspector/config.json
```

Without credentials both are refused.

## Command

```bash
npm run build
node packages/inspector/lib/cli/main.js --target http://127.0.0.1:8787
```

The output ends with `guide for coding agents: http://127.0.0.1:4747/llms.txt`. Fetch it; it equals
`packages/inspector/public/llms.txt`.

## Checks

```bash
npm run test:unit -- packages/inspector/tests/agent-guide packages/inspector/tests/server packages/inspector/tests/cli
uv run --project packages/python python -m unittest discover -s packages/python/tests
npm run check:ci
```
