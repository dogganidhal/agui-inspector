"""L06 T046 (US2.3, FR-001, FR-040): the wheel and sdist carry the npm assets, and the wheel runs without Node.
D01 T055-T058 (G-01, G-02): MIT license and third-party notices ship in the npm tarball, wheel and sdist, the
manifests stay private, the DOMPurify override resolves exactly, and CI covers Python 3.10 and 3.14.
P03 T013, T016 (feature 002, FR-012): the public demo's worker, bootstrap, examples and registration are in none
of the ordinary distributions, a demo build leaves the ordinary assets untouched, and the Pages deployment is
main-only and ships no package.
FR-040: the only workflow that publishes is the Changesets-driven Python release, with trusted publishing and no
stored token.

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
BUILD = REPO / ".build"
DIST = REPO / "packages" / "inspector" / "dist"
PACKAGE = REPO / "packages" / "python" / "src" / "agui_inspector"
STATIC = "agui_inspector/static/"
MANIFEST = "agui_inspector/static.sha256"
LICENSE_FILES = ("LICENSE", "THIRD_PARTY_NOTICES.txt")
COPYRIGHT = "Copyright (c) 2026 Nidhal Dogga"
A2UI_PACKAGES = ("@a2ui/react", "@a2ui/web_core", "@a2ui/markdown-it")
# What only the public demo build holds (scripts/build-demo.mjs): file names, and what its worker and page say.
DEMO_NAMES = {"service-worker.js", "bootstrap.js", "demo.css", "examples.json"}
DEMO_MARKERS = ("agui-demo-hello", "agui-demo-ready", "__demo__", "serviceWorker", "service-worker")
ASSET = re.compile(r"\.(js|css|html|json)$")


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
        pack = subprocess.run(
            ["npm", "pack", "--workspace", "packages/inspector", "--pack-destination", str(cls.out)],
            cwd=REPO, capture_output=True, text=True,
        )
        if pack.returncode != 0:
            raise AssertionError(f"npm pack failed:\n{pack.stdout}\n{pack.stderr}")
        cls.npm_tarball = next(cls.out.glob("*.tgz"))
        cls.expected = tree(DIST)
        cls.tmp = Path(tmp.name)
        # A demo build into a directory of its own, run before the isolation checks: it must change nothing ordinary.
        BUILD.mkdir(exist_ok=True)
        demo = tempfile.TemporaryDirectory(prefix="distribution-test-demo-", dir=BUILD)
        cls.addClassCleanup(demo.cleanup)
        cls.demo = Path(demo.name)
        built = subprocess.run([node, "scripts/build-demo.mjs", "--outdir", str(cls.demo)], cwd=REPO, capture_output=True, text=True)
        if built.returncode != 0:
            raise AssertionError(f"build-demo failed:\n{built.stdout}\n{built.stderr}")

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
            self.assertEqual("MIT", meta["License-Expression"])
            self.assertEqual(list(LICENSE_FILES), meta.get_all("License-File"))
            self.assertFalse([n for n in wheel.namelist() if n.endswith(".dist-info/entry_points.txt")])  # no CLI

    def test_license_is_mit_with_the_exact_copyright_line(self):
        text = (REPO / "LICENSE").read_text()
        self.assertTrue(text.startswith("MIT License\n"))
        self.assertEqual([COPYRIGHT], [line for line in text.splitlines() if line.startswith("Copyright")])
        self.assertIn("Permission is hereby granted, free of charge", text)
        self.assertIn('THE SOFTWARE IS PROVIDED "AS IS"', text)

    def test_notices_hold_apache_text_and_every_installed_runtime_package(self):
        notices = (REPO / "THIRD_PARTY_NOTICES.txt").read_text()
        self.assertIn("Apache License\n", notices)
        self.assertIn("TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION", notices)
        lock = json.loads((REPO / "package-lock.json").read_text())["packages"]
        runtime = {
            (key.split("node_modules/")[-1], meta["version"])
            for key, meta in lock.items()
            if key.startswith("node_modules/") and not meta.get("link") and not meta.get("dev") and not meta.get("devOptional")
        }
        self.assertTrue({name for name, _ in runtime} >= set(A2UI_PACKAGES))
        for name, version in sorted(runtime):
            self.assertIn(f"{name}@{version}", notices)
            # Upstream NOTICE files, if a package carries one, must be reproduced.
            for upstream in (REPO / "node_modules" / name).glob("NOTICE*"):
                self.assertIn(upstream.read_text().strip(), notices, f"{name} {upstream.name}")

    def test_license_files_are_identical_in_the_root_npm_and_python_packages(self):
        for name in LICENSE_FILES:
            root = (REPO / name).read_bytes()
            self.assertTrue(root, name)
            self.assertEqual(root, (REPO / "packages" / "inspector" / name).read_bytes(), f"inspector {name}")
            self.assertEqual(root, (REPO / "packages" / "python" / name).read_bytes(), f"python {name}")

    def test_wheel_and_sdist_ship_the_license_and_notices(self):
        with zipfile.ZipFile(self.wheel) as wheel:
            licenses = next(n for n in wheel.namelist() if n.endswith(".dist-info/licenses/LICENSE"))[: -len("LICENSE")]
            for name in LICENSE_FILES:
                self.assertEqual((REPO / name).read_bytes(), wheel.read(licenses + name), name)
        with tarfile.open(self.sdist) as sdist:
            root = sdist.getnames()[0].split("/")[0]
            for name in LICENSE_FILES:
                self.assertEqual((REPO / name).read_bytes(), sdist.extractfile(f"{root}/{name}").read(), name)

    def test_npm_tarball_ships_the_license_and_notices(self):
        with tarfile.open(self.npm_tarball) as tarball:
            for name in LICENSE_FILES:
                self.assertEqual((REPO / name).read_bytes(), tarball.extractfile(f"package/{name}").read(), name)
            self.assertIn("package/dist/index.html", tarball.getnames())

    def test_npm_manifests_are_private_mit_and_pin_dompurify(self):
        root = json.loads((REPO / "package.json").read_text())
        package = json.loads((REPO / "packages" / "inspector" / "package.json").read_text())
        self.assertIs(True, root["private"])
        self.assertIs(True, package["private"])
        self.assertEqual("agui-inspector", package["name"])
        self.assertEqual("MIT", package["license"])
        self.assertTrue(set(LICENSE_FILES) <= set(package["files"]))
        self.assertEqual({"dompurify": "3.4.16"}, root["overrides"])
        lock = json.loads((REPO / "package-lock.json").read_text())["packages"]
        found = {key: meta["version"] for key, meta in lock.items() if key.split("node_modules/")[-1] == "dompurify"}
        self.assertEqual({"node_modules/dompurify": "3.4.16"}, found)

    def test_pyproject_is_private_mit_with_the_license_files(self):
        text = (REPO / "packages" / "python" / "pyproject.toml").read_text()
        self.assertIn('license = "MIT"', text)
        self.assertIn('license-files = ["LICENSE", "THIRD_PARTY_NOTICES.txt"]', text)
        self.assertIn('"Private :: Do Not Upload"', text)

    def test_ci_runs_python_310_and_314_and_never_publishes(self):
        text = (REPO / ".github" / "workflows" / "ci.yml").read_text()
        self.assertRegex(text, r'python-version: \["3\.10", "3\.14"\]')
        self.assertIn("UV_PYTHON: ${{ matrix.python-version }}", text)
        self.assertIsNone(re.search(r"^\s*(tags|release|workflow_dispatch|push):", text, re.M))
        self.assertIsNone(re.search(r"\bpublish\b|pypi|npm publish|gh release", text, re.I))

    def test_the_pages_workflow_deploys_the_demo_and_docs_from_main_and_ships_no_package(self):
        workflows = sorted(p.name for p in (REPO / ".github" / "workflows").glob("*.yml"))
        self.assertEqual(["ci.yml", "pages.yml", "release-python.yml"], workflows)
        text = (REPO / ".github" / "workflows" / "pages.yml").read_text()
        self.assertIn("branches: [main]", text)
        self.assertIsNone(re.search(r"^\s*(tags|release|pull_request|pull_request_target|schedule):", text, re.M))
        self.assertIsNone(re.search(r"\bpublish\b|pypi|npm publish|uv publish|twine|gh release|git tag|attest", text, re.I))
        # The uploaded directory is the demo merged with the docs site, never a package build.
        self.assertIn("path: .build/pages", text)
        self.assertIn("for (const dir of ['.build/public-demo', 'website/out'])", text)

    def test_the_release_workflow_versions_with_changesets_and_publishes_only_through_trusted_publishing(self):
        workflows = REPO / ".github" / "workflows"
        text = (workflows / "release-python.yml").read_text()
        code = re.sub(r"^\s*#.*$", "", text, flags=re.M)  # what the workflow does, not what its comments say
        # Only a push to main starts it, runs are serialized, and nothing is granted by default.
        self.assertRegex(code, r"(?m)^on:\n  push:\n    branches: \[main\]\n+permissions: \{\}\n+concurrency:\n  group: release-python\n  cancel-in-progress: false\n")
        self.assertIsNone(re.search(r"pull_request|workflow_dispatch|schedule:|workflow_run|^\s*tags:", code, re.M))
        # Every action is pinned to a full commit SHA, and the shared ones are the pull request workflow's pins.
        for ref in re.findall(r"^\s*(?:-\s+)?uses:\s*(\S+)", code, re.M):
            self.assertRegex(ref, r"^[\w.-]+/[\w./-]+@[0-9a-f]{40}$", ref)
        pins = lambda source: set(re.findall(r"uses:\s*((?:actions/(?:checkout|setup-node)|astral-sh/setup-uv)@\S+)", source))
        self.assertEqual(pins((workflows / "ci.yml").read_text()), pins(code))
        # No stored credential, no other way to publish, tag or release.
        self.assertIsNone(re.search(r"secrets\.|password:|packages: write|npm publish|changeset publish|twine|uv publish|gh release|git tag |git push", code))
        self.assertIsNone(re.search(r"npm (?:ci|install)(?![^\n]*--ignore-scripts)", code))
        self.assertEqual(1, code.count("contents: write"))
        self.assertEqual(1, code.count("id-token: write"))
        version, rest = code.split("\njobs:\n")[1].split("\n  build:\n")
        build, publish = rest.split("\n  publish:\n")
        # The version job is the only one that writes: it opens the version pull request and pushes tags, no releases.
        self.assertIn("\n    permissions:\n      contents: write\n      pull-requests: write\n", version)
        self.assertRegex(version, r"uses: changesets/action@[0-9a-f]{40}")
        self.assertIn("version-script: node scripts/changeset-version.mjs", version)
        self.assertIn("publish-script: npm exec -- changeset git-tag", version)
        self.assertIn("create-github-releases: false", version)
        # The build job reads only, runs after the version job, and only when a Python version was just tagged.
        self.assertIn("\n    permissions:\n      contents: read\n", build)
        self.assertIn("\n    needs: version\n", build)
        self.assertRegex(build, r"if: needs\.version\.outputs\.published == 'true' && contains\(needs\.version\.outputs\.packages, 'agui-inspector-python'\)")
        self.assertNotIn("id-token", build)
        # It gates the tagged commit, then builds from it.
        steps = ["--points-at", "npm ci --ignore-scripts", "npm run check:ci -- --strict", "npm run package:python -- --no-build", "actions/upload-artifact@"]
        at = [build.find(step) for step in steps]
        self.assertNotIn(-1, at, steps)
        self.assertEqual(sorted(at), at)
        # The publish job holds the only token grant, runs no repository code and uses the pypi environment.
        self.assertIn("\n    permissions:\n      id-token: write\n", publish)
        self.assertIn("\n    needs: build\n", publish)
        self.assertIn("\n    environment:\n      name: pypi\n", publish)
        self.assertIsNone(re.search(r"\brun:|actions/checkout", publish))
        self.assertRegex(publish, r"uses: pypa/gh-action-pypi-publish@[0-9a-f]{40}")

    def member_files(self, archive: str) -> dict[str, bytes]:
        """Every file of one distribution, by archive name."""
        if archive == "wheel":
            with zipfile.ZipFile(self.wheel) as wheel:
                return {n: wheel.read(n) for n in wheel.namelist() if not n.endswith("/")}
        path = self.sdist if archive == "sdist" else self.npm_tarball
        with tarfile.open(path) as tar:
            return {m.name: tar.extractfile(m).read() for m in tar.getmembers() if m.isfile()}

    def test_no_distribution_holds_the_demo_worker_bootstrap_examples_or_registration(self):
        assets = {"wheel": STATIC, "sdist": "/src/" + STATIC, "npm": "package/dist/"}
        for label, archive in (("wheel", "wheel"), ("sdist", "sdist"), ("npm", "npm")):
            files = self.member_files(archive)
            self.assertTrue(files, label)
            self.assertFalse({Path(n).name for n in files} & DEMO_NAMES, f"{label} holds a demo file")
            shipped = {n: data for n, data in files.items() if assets[label] in n and ASSET.search(n)}
            self.assertIn("index.html", {Path(n).name for n in shipped}, label)
            for name, data in shipped.items():
                text = data.decode("utf-8")
                for marker in DEMO_MARKERS:
                    self.assertTrue(marker not in text, f"{label}: {name} mentions {marker}")  # not assertNotIn: it would print the asset
        # The built ordinary directory they were made from is clean too, and a demo build changed none of it.
        self.assertFalse({p.name for p in DIST.rglob("*")} & DEMO_NAMES)
        for name in self.expected:
            if ASSET.search(name):
                text = (DIST / name).read_text()
                for marker in DEMO_MARKERS:
                    self.assertTrue(marker not in text, f"dist/{name} mentions {marker}")
        self.assertEqual(self.expected, tree(DIST))

    def test_the_demo_build_is_separate_from_the_ordinary_assets_it_shares(self):
        demo = tree(self.demo)
        self.assertEqual({"app.css", "app.js", "bootstrap.js", "demo.css", "examples.json", "hosting-config.json", "index.html", "service-worker.js"}, set(demo))
        # The shared app is the ordinary app, byte for byte; the demo adds files and replaces the page and the hosting file.
        for shared in ("app.js", "app.css"):
            self.assertEqual(self.expected[shared], demo[shared], shared)
        self.assertNotEqual(self.expected["index.html"], demo["index.html"])
        self.assertIn("embedded", (DIST / "hosting-config.json").read_text())
        self.assertIn("hosted", (self.demo / "hosting-config.json").read_text())

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
