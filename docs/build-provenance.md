# Build provenance

`agui-inspector` is the approved name (unregistered on npm and PyPI on 2026-10-02) and nothing is published. FR-040 requires published distributions
to have verifiable build provenance. Since there is no published distribution yet, this page covers
the checks that already run on a developer machine or in pull request CI, and the safeguards a release
adds. The Python release workflow is described in [distribution](distribution.md#python-release).

## What the local build proves

`npm run package:python` (`scripts/package-python.mjs`) does this, in order:

0. Checks that `packages/python/LICENSE` and `packages/python/THIRD_PARTY_NOTICES.txt` are byte-identical to the
   root files, and stops if they are not. `uv_build` cannot read files outside the project, so the package carries
   committed copies.
1. Builds the one static asset set into `packages/inspector/dist`, the directory that
   `staticAssetsPath` points at. `--no-build` reuses an existing build.
2. Copies that directory into `packages/python/src/agui_inspector/static`.
3. Writes `packages/python/src/agui_inspector/static.sha256`, one `sha256  path` line per file, and
   fails if the copy's checksums differ from the npm directory's.
4. Runs `uv build --project packages/python`, which produces the wheel and the sdist in
   `packages/python/dist` (`--out-dir` changes this). `--stage-only` stops after step 3.

`packages/python/tests/test_distribution.py` then opens both artifacts and checks that:

- the files under `agui_inspector/static/` in the wheel and in the sdist match `packages/inspector/dist`
  exactly, by name and SHA-256, and match the packaged `static.sha256`;
- the metadata says `Requires-Python: >=3.10`, has a single optional `embedded` extra with
  Starlette, no unconditional dependency, `License-Expression: MIT`, the `LICENSE` and
  `THIRD_PARTY_NOTICES.txt` files, no entry point, and the `Private :: Do Not Upload` classifier that stops an
  accidental PyPI upload;
- the wheel, the sdist and the npm tarball (`npm pack`) each contain `LICENSE` and `THIRD_PARTY_NOTICES.txt`,
  identical to the repository root files, and the notices name every runtime package in `package-lock.json`;
- both npm manifests are private and MIT, the root `package.json` overrides `dompurify` to 3.4.16, and the lockfile
  resolves exactly that version;
- the pull request workflow runs the Python tests on 3.10 and 3.14 and contains no publishing step;
- an installed copy of the wheel serves every asset byte for byte with `PATH` stripped of Node and
  with socket connections made to fail, so nothing is built or downloaded at startup;
- the package source imports no networking or process module.

The staged copy and the checksum file are git-ignored build output. Nothing generated is committed.

## Inputs a provenance statement would cover

| Input | Where it is fixed |
| --- | --- |
| npm dependency tree, including esbuild | `package-lock.json`, installed with `npm ci --ignore-scripts` |
| Python dependency tree | `packages/python/uv.lock`, used with `--locked` |
| `dompurify` version | root `package.json` `overrides`, resolved to 3.4.16 in `package-lock.json` (see [dependencies](dependencies.md)) |
| License and notices | `LICENSE` and `THIRD_PARTY_NOTICES.txt`, copied into both packages and compared by tests |
| Python build backend | `uv_build==0.12.22` in `packages/python/pyproject.toml` |
| `uv` version used by CI | pinned in `.github/workflows/ci.yml` |
| Static asset content | `static.sha256`, compared with the npm directory |

Pull request CI runs `npm run check:ci`, which runs the Python tests and the browser tests that rely
on these inputs. It requests read-only access, uses no secrets and publishes nothing.

## Safeguards for a release

For Python, `.github/workflows/release-python.yml` implements these, and `test_distribution.py` fails if one
is loosened:

- It builds only a commit that carries the `agui-inspector-python@<version>` tag Changesets just pushed for the
  version in `pyproject.toml`, with every action pinned to a full commit SHA and the minimum permissions per job.
  Only the job that opens the version pull request and pushes tags can write to the repository.
- It runs `npm run check:ci -- --strict` before it builds. That gate includes the comparison of the wheel's
  `static.sha256` with the npm assets that the local tests make.
- It publishes through PyPI trusted publishing, with no token stored in the repository. The publish job runs
  no repository code, and the action uploads PEP 740 attestations naming the workflow and commit.

Still required, and not implemented:

- Publish the npm package with provenance, from a CI build of its own.
- Remove the npm `"private": true` flag, and the Python `Private :: Do Not Upload` classifier, only with an
  explicit decision to publish. The classifier is what stops an accidental PyPI upload until then; the release
  workflow refuses a package that still has it. G-01 (MIT) and G-02 (`agui-inspector`) are closed. The conditional
  `@ag-ui/inspector` name depends on G-03 (upstream adoption), which is open.
- Pass the headed benchmark on the physical runner, which CI cannot do.

No command in this repository publishes, tags or releases on its own. A release happens when the maintainer merges the
version pull request and approves the `pypi` deployment.
