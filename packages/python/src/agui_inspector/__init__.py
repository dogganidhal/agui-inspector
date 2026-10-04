"""Opt-in mount helper that serves the prebuilt inspector from a Starlette or FastAPI app.

The static files ship inside this package (see scripts/package-python.mjs); nothing is built or
downloaded on the host. The helper mounts nothing unless ``enabled=True``, adds no authentication
(the host's own middleware, or on FastAPI its application-level dependencies, guards every route),
and has no session storage or agent proxy.
"""

from __future__ import annotations

import functools
import json
import logging
import mimetypes
from dataclasses import asdict, dataclass
from importlib.resources import files
from typing import Any

__all__ = ["Agent", "Brand", "mount_inspector"]

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


@dataclass(frozen=True)
class Brand:
    """The adopter's name and logos for the page's top bar. Every field is optional.

    ``logo`` and ``logo_dark`` (the logo for the dark theme) are a path on the page's own origin or a
    ``data:`` image URI. The helper serves no logo file: the host serves it from one of its own routes.
    """

    name: str | None = None
    logo: str | None = None
    logo_dark: str | None = None


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


def _brand_config(brand: Brand) -> dict[str, str]:
    fields = {"name": brand.name, "logo": brand.logo, "logoDark": brand.logo_dark}
    return {key: value for key, value in fields.items() if value is not None}


def mount_inspector(
    app,
    *,
    agents: list[Agent],
    enabled: bool = False,
    path: str = DEFAULT_PATH,
    theme: dict[str, dict[str, str]] | None = None,
    brand: Brand | None = None,
) -> None:
    """Serve the inspector page, its assets and ``<path>/config.json`` from ``app``.

    ``enabled`` defaults to False and a disabled call touches nothing, not even the optional
    Starlette import. Enabling logs a warning that names the mount path.

    The helper adds no authentication; every route inherits the host's. Middleware on ``app`` or on
    an application that mounts it covers all of them. On a FastAPI ``app`` the routes are API routes,
    so the dependencies passed to ``FastAPI(dependencies=[...])`` run too. A dependency on an
    enclosing application does not run for a mounted sub-application: put it on the ``app`` you pass
    here, or guard with middleware or the reverse proxy.

    ``theme`` is ``{"light": {...}, "dark": {...}}``, either map optional, from the ten documented
    ``--agui-*`` property names to CSS values. It goes into ``config.json`` as given: the page
    validates it and shows a warning for any name or value it rejects, never an error.

    ``brand`` puts the adopter's name and logo in the page's top bar. Like ``theme`` it goes into
    ``config.json`` as given, with ``logo_dark`` written as ``logoDark`` and unset fields left out. The page
    accepts a logo only from its own origin or as a ``data:`` image and warns about anything else.
    """
    if not enabled:
        return
    if not path.startswith("/") or not path.strip("/"):
        raise ValueError(f"path must start with '/' and name a sub-path, got {path!r}")
    ids = [agent.id for agent in agents]
    if not all(ids) or not all(agent.url for agent in agents) or len(set(ids)) != len(ids):
        raise ValueError("every agent needs a unique nonempty id and a url")
    try:
        from starlette.requests import Request
        from starlette.responses import RedirectResponse, Response
    except ImportError as exc:
        raise ImportError(
            "mount_inspector(enabled=True) needs Starlette; install it with 'pip install \"agui-inspector[embedded]\"'"
        ) from exc
    if not _assets_root().joinpath("index.html").is_file():
        raise RuntimeError("the packaged inspector assets are missing; build them with 'npm run package:python'")

    mount = path.rstrip("/")
    config = json.dumps(
        {
            "version": _CONFIG_VERSION,
            "agents": [{k: v for k, v in asdict(a).items() if v is not None} for a in agents],
            **({"theme": theme} if theme is not None else {}),
            **({"brand": _brand_config(brand)} if brand is not None else {}),
        }
    )
    headers = {"content-security-policy": _CSP}

    async def redirect(request):
        query = f"?{request.url.query}" if request.url.query else ""
        # root_path holds the prefix of every enclosing mount and of a proxy that strips its own
        prefix = request.scope.get("root_path", "").rstrip("/")
        return RedirectResponse(f"{prefix}{mount}/{query}", status_code=307)

    async def serve(request):
        asset = request.path_params["asset"]
        if asset == "config.json":
            return Response(config, media_type="application/json", headers=headers)
        node = _find(asset)
        if node is None:
            return Response("Not found", status_code=404, media_type="text/plain", headers=headers)
        media_type = mimetypes.guess_type(node.name)[0] or "application/octet-stream"
        return Response(node.read_bytes(), media_type=media_type, headers=headers)

    if hasattr(app, "add_api_route"):
        # FastAPI runs application-level dependencies only for API routes, and takes the request
        # from a real annotation (the ones in this module are strings).
        redirect.__annotations__ = serve.__annotations__ = {"request": Request}
        add = functools.partial(app.add_api_route, include_in_schema=False)
    else:
        add = app.add_route
    add(mount, redirect, methods=["GET", "HEAD"])
    add(f"{mount}/{{asset:path}}", serve, methods=["GET", "HEAD"])
    _log.warning("agui-inspector is enabled and mounted at %s; disable it outside development", mount)
