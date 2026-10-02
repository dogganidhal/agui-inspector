"""Opt-in mount helper that serves the prebuilt inspector from a Starlette or FastAPI app.

The static files ship inside this package (see scripts/package-python.mjs); nothing is built or
downloaded on the host. The helper mounts nothing unless ``enabled=True``, adds no authentication
(the host's own middleware guards every route), and has no session storage or agent proxy.
"""

from __future__ import annotations

import json
import logging
import mimetypes
from dataclasses import asdict, dataclass
from importlib.resources import files
from typing import Any

__all__ = ["Agent", "mount_inspector"]

DEFAULT_PATH = "/agui-inspector"
_CONFIG_VERSION = 0
# Same policy as the page's own <meta>: own-origin scripts only, and no eval.
_CSP = "script-src 'self'; object-src 'none'; base-uri 'none'"

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Agent:
    """One entry of the browser configuration. Only ``id`` and ``url`` are required."""

    id: str
    url: str
    name: str | None = None
    capabilities: dict[str, Any] | str | None = None
    preset: dict[str, Any] | None = None


def _assets_root():
    return files(__package__) / "static"


def _find(asset: str):
    parts = asset.split("/") if asset else ["index.html"]
    if any(part in ("", ".", "..") or "\\" in part for part in parts):
        return None
    node = _assets_root()
    for part in parts:  # Traversable.joinpath takes one name on Python 3.10
        node = node.joinpath(part)
    return node if node.is_file() else None


def mount_inspector(app, *, agents: list[Agent], enabled: bool = False, path: str = DEFAULT_PATH) -> None:
    """Serve the inspector page, its assets and ``<path>/config.json`` from ``app``.

    ``enabled`` defaults to False and a disabled call touches nothing, not even the optional
    Starlette import. Enabling logs a warning that names the mount path.
    """
    if not enabled:
        return
    if not path.startswith("/") or not path.strip("/"):
        raise ValueError(f"path must start with '/' and name a sub-path, got {path!r}")
    ids = [agent.id for agent in agents]
    if not all(ids) or not all(agent.url for agent in agents) or len(set(ids)) != len(ids):
        raise ValueError("every agent needs a unique nonempty id and a url")
    try:
        from starlette.responses import RedirectResponse, Response
    except ImportError as exc:
        raise ImportError(
            "mount_inspector(enabled=True) needs Starlette; install it with 'pip install \"agui-inspector[embedded]\"'"
        ) from exc
    if not _assets_root().joinpath("index.html").is_file():
        raise RuntimeError("the packaged inspector assets are missing; build them with 'npm run package:python'")

    mount = path.rstrip("/")
    config = json.dumps(
        {"version": _CONFIG_VERSION, "agents": [{k: v for k, v in asdict(a).items() if v is not None} for a in agents]}
    )
    headers = {"content-security-policy": _CSP}

    async def redirect(request):
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"{mount}/{query}", status_code=307)

    async def serve(request):
        asset = request.path_params["asset"]
        if asset == "config.json":
            return Response(config, media_type="application/json", headers=headers)
        node = _find(asset)
        if node is None:
            return Response("Not found", status_code=404, media_type="text/plain", headers=headers)
        media_type = mimetypes.guess_type(node.name)[0] or "application/octet-stream"
        return Response(node.read_bytes(), media_type=media_type, headers=headers)

    app.add_route(mount, redirect, methods=["GET", "HEAD"])
    app.add_route(f"{mount}/{{asset:path}}", serve, methods=["GET", "HEAD"])
    _log.warning("agui-inspector is enabled and mounted at %s; disable it outside development", mount)
