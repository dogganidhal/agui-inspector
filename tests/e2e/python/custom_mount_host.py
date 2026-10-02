"""Starlette host for tests/e2e/python: the inspector mounted at a custom path, with no authentication."""

import argparse

import uvicorn
from starlette.applications import Starlette

from agui_inspector import Agent, mount_inspector

app = Starlette()
mount_inspector(app, agents=[Agent(id="demo", name="Demo agent", url="/agents/demo/stream")], enabled=True, path="/tools/inspector")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    uvicorn.run(app, host="127.0.0.1", port=parser.parse_args().port, log_level="warning")
