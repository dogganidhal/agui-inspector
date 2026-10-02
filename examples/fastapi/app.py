"""Model-free FastAPI host for the embedded inspector, behind the host's own HTTP Basic auth.

Run from the repository root (after `npm run package:python`):

    EXAMPLE_USER=... EXAMPLE_PASSWORD=... EXAMPLE_DEBUG=1 \
        uv run --project packages/python --locked --extra embedded --group test \
        python examples/fastapi/app.py --port 8000

The inspector is mounted only when EXAMPLE_DEBUG=1. The credentials come from the environment and
are checked by the middleware below, which guards the inspector, its config and the agent route
alike: the inspector adds no authentication of its own and never sees the credentials.
"""

import argparse
import base64
import binascii
import json
import os
import secrets
import sys

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse

from agui_inspector import Agent, mount_inspector

app = FastAPI()
_user, _password = os.environ.get("EXAMPLE_USER"), os.environ.get("EXAMPLE_PASSWORD")


def _authorized(header: str | None) -> bool:
    if not (_user and _password and header and header.startswith("Basic ")):
        return False
    try:
        user, _, password = base64.b64decode(header[6:], validate=True).decode().partition(":")
    except (binascii.Error, UnicodeDecodeError):
        return False
    return secrets.compare_digest(user, _user) and secrets.compare_digest(password, _password)


@app.middleware("http")
async def host_auth(request: Request, call_next):
    if _authorized(request.headers.get("authorization")):
        return await call_next(request)
    return Response(status_code=401, headers={"www-authenticate": 'Basic realm="example host"'})


@app.post("/agents/demo/stream")
async def demo_stream(request: Request):
    try:
        run = await request.json()
        thread_id, run_id = str(run["threadId"]), str(run["runId"])
    except (ValueError, KeyError, TypeError):
        return Response("threadId and runId are required", status_code=422)
    events = [
        {"type": "RUN_STARTED", "threadId": thread_id, "runId": run_id},
        {"type": "TEXT_MESSAGE_START", "messageId": "msg-1", "role": "assistant"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "msg-1", "delta": "Hello from the FastAPI example."},
        {"type": "TEXT_MESSAGE_END", "messageId": "msg-1"},
        {"type": "RUN_FINISHED", "threadId": thread_id, "runId": run_id, "outcome": {"type": "success"}},
    ]
    return StreamingResponse((f"data: {json.dumps(e)}\n\n" for e in events), media_type="text/event-stream")


mount_inspector(
    app,
    agents=[Agent(id="demo", name="Demo agent", url="/agents/demo/stream")],
    enabled=os.environ.get("EXAMPLE_DEBUG") == "1",
)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    port = parser.parse_args().port
    if not (_user and _password):
        sys.exit("set EXAMPLE_USER and EXAMPLE_PASSWORD")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
