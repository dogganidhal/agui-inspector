"""L06 T046 (US2.3, FR-001, FR-040): the wheel and sdist carry the npm assets, and the wheel runs without Node.

setUpClass runs the real packaging script on the already built ``packages/inspector/dist``
(``npm run build``), so these tests need Node and a build; a missing one is a failure, not a skip.
"""

import ast
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from email.parser import Parser
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DIST = REPO / "packages" / "inspector" / "dist"
PACKAGE = REPO / "packages" / "python" / "src" / "agui_inspector"
STATIC = "agui_inspector/static/"
MANIFEST = "agui_inspector/static.sha256"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tree(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): sha256(p.read_bytes()) for p in sorted(root.rglob("*")) if p.is_file()}


def parse_manifest(text: str) -> dict[str, str]:
    return {line.split("  ", 1)[1]: line.split("  ", 1)[0] for line in text.splitlines() if line}


class DistributionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (DIST / "index.html").is_file():
            raise AssertionError(f"{DIST} is not built; run 'npm run build' first")
        node = shutil.which("node")
        if node is None:
            raise AssertionError("node is needed to run scripts/package-python.mjs")
        tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(tmp.cleanup)
        cls.out = Path(tmp.name) / "out"
        run = subprocess.run(
            [node, "scripts/package-python.mjs", "--no-build", "--out-dir", str(cls.out)],
            cwd=REPO, capture_output=True, text=True,
        )
        if run.returncode != 0:
            raise AssertionError(f"package-python failed:\n{run.stdout}\n{run.stderr}")
        cls.wheel = next(cls.out.glob("*.whl"))
        cls.sdist = next(cls.out.glob("*.tar.gz"))
        cls.expected = tree(DIST)
        cls.tmp = Path(tmp.name)

    def wheel_static(self) -> dict[str, str]:
        with zipfile.ZipFile(self.wheel) as wheel:
            return {n[len(STATIC):]: sha256(wheel.read(n)) for n in wheel.namelist() if n.startswith(STATIC) and not n.endswith("/")}

    def sdist_static(self) -> dict[str, str]:
        with tarfile.open(self.sdist) as sdist:
            prefix = sdist.getnames()[0].split("/")[0] + "/src/"
            files = {m.name[len(prefix) + len(STATIC):]: m for m in sdist.getmembers() if m.isfile() and m.name.startswith(prefix + STATIC)}
            return {name: sha256(sdist.extractfile(m).read()) for name, m in files.items()}

    def test_wheel_and_sdist_hold_exactly_the_npm_static_assets(self):
        self.assertIn("index.html", self.expected)
        self.assertEqual(self.expected, self.wheel_static())
        self.assertEqual(self.expected, self.sdist_static())

    def test_checksum_list_matches_the_assets_in_both_artifacts(self):
        with zipfile.ZipFile(self.wheel) as wheel:
            in_wheel = parse_manifest(wheel.read(MANIFEST).decode())
        with tarfile.open(self.sdist) as sdist:
            root = sdist.getnames()[0].split("/")[0]
            in_sdist = parse_manifest(sdist.extractfile(f"{root}/src/{MANIFEST}").read().decode())
        self.assertEqual(self.expected, in_wheel)
        self.assertEqual(self.expected, in_sdist)

    def test_metadata_is_private_python_310_with_optional_starlette_only(self):
        with zipfile.ZipFile(self.wheel) as wheel:
            name = next(n for n in wheel.namelist() if n.endswith(".dist-info/METADATA"))
            meta = Parser().parsestr(wheel.read(name).decode())
            self.assertEqual("agui-inspector", meta["Name"])
            self.assertEqual(">=3.10", meta["Requires-Python"])
            self.assertEqual(["embedded"], meta.get_all("Provides-Extra"))
            requires = [re.sub(r"[ '\"]", "", r) for r in meta.get_all("Requires-Dist")]  # quoting differs by backend
            self.assertEqual(["starlette==1.7.0;extra==embedded"], requires)
            self.assertIn("Private :: Do Not Upload", meta.get_all("Classifier"))
            # License, name and publication are undecided: no license value, no license file.
            for header in ("License", "License-Expression", "License-File"):
                self.assertIsNone(meta[header], header)
            self.assertFalse([n for n in wheel.namelist() if "LICEN" in n.upper()])
            self.assertFalse([n for n in wheel.namelist() if n.endswith(".dist-info/entry_points.txt")])  # no CLI

    def test_installed_wheel_serves_without_node_or_network(self):
        site = self.tmp / "site"
        with zipfile.ZipFile(self.wheel) as wheel:
            wheel.extractall(site)
        empty_path = self.tmp / "empty-path"
        empty_path.mkdir()
        script = f"""
import json, shutil, socket, sys
from pathlib import Path

assert shutil.which("node") is None, "node must be absent"
assert shutil.which("npm") is None, "npm must be absent"

def refuse(*args, **kwargs):
    raise AssertionError("network access attempted")
socket.socket.connect = refuse
socket.getaddrinfo = refuse

import agui_inspector
assert Path(agui_inspector.__file__).is_relative_to({str(site)!r}), agui_inspector.__file__

from starlette.applications import Starlette
from starlette.testclient import TestClient

app = Starlette()
agui_inspector.mount_inspector(app, agents=[agui_inspector.Agent(id="a", url="/a")], enabled=True)
client = TestClient(app)
served = {{}}
dist = Path({str(DIST)!r})
for path in sorted(p for p in dist.rglob("*") if p.is_file()):
    rel = path.relative_to(dist).as_posix()
    url = "/agui-inspector/" if rel == "index.html" else "/agui-inspector/" + rel
    response = client.get(url)
    assert response.status_code == 200, (url, response.status_code)
    assert response.content == path.read_bytes(), url
    served[rel] = len(response.content)
assert client.get("/agui-inspector/config.json").json()["agents"][0]["id"] == "a"
print(json.dumps(served))
"""
        env = {"PATH": str(empty_path), "PYTHONPATH": str(site), "PYTHONDONTWRITEBYTECODE": "1"}
        run = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True)
        self.assertEqual(0, run.returncode, run.stderr)
        self.assertEqual(sorted(self.expected), sorted(json.loads(run.stdout)))

    def test_package_source_has_no_download_or_process_code(self):
        banned = {"urllib", "http", "socket", "requests", "httpx", "subprocess", "ftplib", "urllib3"}
        for source in PACKAGE.rglob("*.py"):
            for node in ast.walk(ast.parse(source.read_text())):
                names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""] if isinstance(node, ast.ImportFrom) else []
                for name in names:
                    self.assertNotIn(name.split(".")[0], banned, f"{source.name} imports {name}")

    def test_staged_copy_is_git_ignored(self):
        for staged in (PACKAGE / "static" / "index.html", PACKAGE / "static.sha256"):
            self.assertEqual(0, subprocess.run(["git", "check-ignore", "-q", str(staged)], cwd=REPO).returncode, staged.name)


if __name__ == "__main__":
    unittest.main()
