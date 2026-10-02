"""L06 T045 (US2, FR-002, FR-004, FR-006, FR-038): the opt-in mount helper in Starlette and FastAPI.

Route tests serve a small stand-in asset directory so they run on a source checkout; the real
built assets are checked in test_distribution.py and in tests/e2e/python.
"""

import json
import logging
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fastapi import FastAPI
from starlette.applications import Starlette
from starlette.testclient import TestClient

import agui_inspector
from agui_inspector import Agent, mount_inspector

INDEX = "<!doctype html><title>inspector</title><script type=\"module\" src=\"./app.js\"></script>"
APP_JS = "export const app = 1;\n"
CHUNK_JS = "export const chunk = 2;\n"
AGENTS = [Agent(id="support", url="/agents/support/stream")]


class StaticFixture(unittest.TestCase):
    """Stand-in for the packaged static directory, with a secret outside it."""

    def setUp(self):
        quiet = logging.NullHandler()  # keep the startup warning out of the test output
        logging.getLogger("agui_inspector").addHandler(quiet)
        self.addCleanup(logging.getLogger("agui_inspector").removeHandler, quiet)
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        (root / "secret.txt").write_text("outside the static directory")
        static = root / "static"
        (static / "assets").mkdir(parents=True)
        (static / "index.html").write_text(INDEX)
        (static / "app.js").write_text(APP_JS)
        (static / "assets" / "chunk.js").write_text(CHUNK_JS)
        patcher = mock.patch.object(agui_inspector, "_assets_root", return_value=static)
        patcher.start()
        self.addCleanup(patcher.stop)

    def apps(self):
        return (("starlette", Starlette()), ("fastapi", FastAPI()))


class DisabledTest(StaticFixture):
    def test_disabled_by_default_mounts_zero_routes_and_stays_silent(self):
        for name, app in self.apps():
            with self.subTest(name), self.assertNoLogs("agui_inspector"):
                before = list(app.routes)
                mount_inspector(app, agents=AGENTS)
                mount_inspector(app, agents=AGENTS, enabled=False, path="/custom")
                self.assertEqual(before, list(app.routes))
                client = TestClient(app)
                for path in ("/agui-inspector", "/agui-inspector/", "/agui-inspector/config.json", "/custom/"):
                    self.assertEqual(404, client.get(path, follow_redirects=False).status_code, path)

    def test_disabled_needs_no_optional_dependency(self):
        with mock.patch.dict(sys.modules, {"starlette": None, "starlette.routing": None}):
            mount_inspector(object(), agents=AGENTS)


class EnabledTest(StaticFixture):
    def test_serves_page_assets_and_config_at_the_default_path(self):
        for name, app in self.apps():
            with self.subTest(name):
                mount_inspector(app, agents=AGENTS, enabled=True)
                client = TestClient(app)
                page = client.get("/agui-inspector/")
                self.assertEqual(200, page.status_code)
                self.assertEqual(INDEX, page.text)
                self.assertTrue(page.headers["content-type"].startswith("text/html"))
                self.assertEqual(APP_JS, client.get("/agui-inspector/app.js").text)
                nested = client.get("/agui-inspector/assets/chunk.js")
                self.assertEqual(CHUNK_JS, nested.text)
                self.assertIn("javascript", nested.headers["content-type"])
                self.assertEqual(404, client.get("/agui-inspector/missing.js").status_code)
                self.assertEqual(404, client.get("/agui-inspector/assets").status_code)

    def test_missing_trailing_slash_redirects_to_the_page(self):
        for name, app in self.apps():
            with self.subTest(name):
                mount_inspector(app, agents=AGENTS, enabled=True)
                response = TestClient(app).get("/agui-inspector?x=1", follow_redirects=False)
                self.assertEqual(307, response.status_code)
                self.assertEqual("/agui-inspector/?x=1", response.headers["location"])

    def test_custom_path_with_or_without_trailing_slash(self):
        for requested in ("/tools/inspector", "/tools/inspector/"):
            for name, app in self.apps():
                with self.subTest(requested=requested, host=name):
                    mount_inspector(app, agents=AGENTS, enabled=True, path=requested)
                    client = TestClient(app)
                    self.assertEqual(INDEX, client.get("/tools/inspector/").text)
                    self.assertEqual(APP_JS, client.get("/tools/inspector/app.js").text)
                    self.assertEqual(1, len(client.get("/tools/inspector/config.json").json()["agents"]))
                    self.assertEqual(404, client.get("/agui-inspector/").status_code)

    def test_rejects_paths_that_could_shadow_the_host(self):
        for bad in ("", "/", "inspector", "//"):
            with self.subTest(bad), self.assertRaises(ValueError):
                mount_inspector(Starlette(), agents=AGENTS, enabled=True, path=bad)

    def test_config_is_version_zero_and_carries_only_declared_fields(self):
        agents = [
            Agent(id="minimal", url="/m"),
            Agent(
                id="full",
                url="/f",
                name="Full",
                capabilities="/f/capabilities",
                preset={"messages": "turn", "prepare": [{"method": "PUT", "path": "/s/{{threadId}}"}]},
            ),
        ]
        app = Starlette()
        mount_inspector(app, agents=agents, enabled=True)
        response = TestClient(app).get("/agui-inspector/config.json")
        self.assertEqual("application/json", response.headers["content-type"])
        self.assertEqual(
            {
                "version": 0,
                "agents": [
                    {"id": "minimal", "url": "/m"},
                    {
                        "id": "full",
                        "url": "/f",
                        "name": "Full",
                        "capabilities": "/f/capabilities",
                        "preset": {"messages": "turn", "prepare": [{"method": "PUT", "path": "/s/{{threadId}}"}]},
                    },
                ],
            },
            response.json(),
        )

    def test_agents_need_a_unique_nonempty_id_and_a_url(self):
        for bad in ([Agent(id="a", url="/1"), Agent(id="a", url="/2")], [Agent(id="", url="/1")], [Agent(id="a", url="")]):
            with self.subTest(bad), self.assertRaises(ValueError):
                mount_inspector(Starlette(), agents=bad, enabled=True)

    def test_startup_warning_names_the_actual_mount_path(self):
        for path in ("/agui-inspector", "/tools/inspector/"):
            with self.subTest(path), self.assertLogs("agui_inspector", logging.WARNING) as logs:
                mount_inspector(Starlette(), agents=AGENTS, enabled=True, path=path)
            self.assertEqual(1, len(logs.records))
            self.assertIn(path.rstrip("/"), logs.output[0])

    def test_every_response_carries_an_own_origin_no_eval_csp(self):
        app = Starlette()
        mount_inspector(app, agents=AGENTS, enabled=True)
        client = TestClient(app)
        for path in ("/agui-inspector/", "/agui-inspector/app.js", "/agui-inspector/config.json"):
            policy = client.get(path).headers["content-security-policy"]
            directives = {d.split()[0]: d.split()[1:] for d in policy.split(";") if d.strip()}
            self.assertEqual(["'self'"], directives["script-src"], path)
            self.assertNotIn("'unsafe-eval'", policy)
            self.assertNotIn("'unsafe-inline'", policy)
            self.assertNotIn("http", policy)

    def test_paths_cannot_escape_the_static_directory(self):
        app = Starlette()
        mount_inspector(app, agents=AGENTS, enabled=True)
        client = TestClient(app)
        for path in (
            "/agui-inspector/../secret.txt",
            "/agui-inspector/%2e%2e/secret.txt",
            "/agui-inspector/assets/../../secret.txt",
            "/agui-inspector/..%2fsecret.txt",
            "/agui-inspector/assets%5c..%5c..%5csecret.txt",
        ):
            response = client.get(path, follow_redirects=False)
            self.assertNotIn("outside the static directory", response.text, path)
            self.assertIn(response.status_code, (307, 400, 404), path)

    def test_no_session_storage_or_agent_proxy(self):
        app = Starlette()
        before = len(app.routes)
        mount_inspector(app, agents=AGENTS, enabled=True)
        self.assertEqual(before + 2, len(app.routes))  # the bare-path redirect and the mount
        client = TestClient(app)
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            for path in ("/agui-inspector/config.json", "/agui-inspector/", "/agui-inspector/sessions"):
                self.assertIn(client.request(method, path, content=b"{}").status_code, (404, 405), f"{method} {path}")
        self.assertEqual(404, client.get("/agui-inspector/sessions").status_code)
        self.assertEqual(404, client.get("/agents/support/stream").status_code)

    def test_host_authentication_guards_every_inspector_route(self):
        # The helper adds no authentication: whatever protects the host app protects the mount.
        async def guard(request, call_next):
            if request.headers.get("authorization") != "Bearer synthetic":
                from starlette.responses import Response

                return Response(status_code=401)
            return await call_next(request)

        app = FastAPI()
        app.middleware("http")(guard)
        mount_inspector(app, agents=AGENTS, enabled=True)
        client = TestClient(app)
        for path in ("/agui-inspector", "/agui-inspector/", "/agui-inspector/app.js", "/agui-inspector/config.json"):
            self.assertEqual(401, client.get(path, follow_redirects=False).status_code, path)
        allowed = {"authorization": "Bearer synthetic"}
        self.assertEqual(200, client.get("/agui-inspector/config.json", headers=allowed).status_code)
        # config.json never echoes request headers back
        self.assertNotIn("synthetic", json.dumps(client.get("/agui-inspector/config.json", headers=allowed).json()))


class MissingAssetsTest(unittest.TestCase):
    def test_missing_static_directory_is_an_actionable_error_when_enabled(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(agui_inspector, "_assets_root", return_value=Path(tmp) / "static"):
            with self.assertRaisesRegex(RuntimeError, "package:python"):
                mount_inspector(Starlette(), agents=AGENTS, enabled=True)
            mount_inspector(Starlette(), agents=AGENTS)  # disabled stays silent


class MissingOptionalDependencyTest(StaticFixture):
    def test_enabling_without_starlette_explains_the_extra(self):
        with mock.patch.dict(sys.modules, {"starlette": None, "starlette.routing": None, "starlette.responses": None}):
            with self.assertRaises(ImportError) as caught:
                mount_inspector(object(), agents=AGENTS, enabled=True)
        self.assertIn("agui-inspector[embedded]", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
