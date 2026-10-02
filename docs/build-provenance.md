# Build provenance

`agui-inspector` is a working name and nothing is published. FR-040 requires published distributions
to have verifiable build provenance. Since there is no published distribution yet, this page covers
the checks that already run on a developer machine or in pull request CI, and the safeguards that
remain required before a release. The release process is listed in [distribution](distribution.md).

## What the local build proves

`npm run package:python` (`scripts/package-python.mjs`) does this, in order:

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
  Starlette, no unconditional dependency, no license field or file, no entry point, and the
  `Private :: Do Not Upload` classifier that stops an accidental PyPI upload;
- an installed copy of the wheel serves every asset byte for byte with `PATH` stripped of Node and
  with socket connections made to fail, so nothing is built or downloaded at startup;
- the package source imports no networking or process module.

The staged copy and the checksum file are git-ignored build output. Nothing generated is committed.

## Inputs a provenance statement would cover

| Input | Where it is fixed |
| --- | --- |
| npm dependency tree, including esbuild | `package-lock.json`, installed with `npm ci --ignore-scripts` |
| Python dependency tree | `packages/python/uv.lock`, used with `--locked` |
| Python build backend | `uv_build==0.12.22` in `packages/python/pyproject.toml` |
| `uv` version used by CI | pinned in `.github/workflows/ci.yml` |
| Static asset content | `static.sha256`, compared with the npm directory |

Pull request CI runs `npm run check:ci`, which runs the Python tests and the browser tests that rely
on these inputs. It requests read-only access, uses no secrets and publishes nothing.

## Safeguards retained for a release

None of these is implemented. They are listed so that a release cannot skip them:

- Build releases in CI from a reviewed version tag, with every action pinned to a full commit SHA
  and the minimum permissions.
- Publish to npm with provenance and to PyPI through trusted publishing, with no long-lived token
  stored in the repository.
- Compare the wheel's `static.sha256` with the npm package's files before publishing, as the local
  tests do now.
- Remove the `Private :: Do Not Upload` classifier and add a license only after gates G-01 (license)
  and G-02 (package names) are decided.
- Pass `npm run check:ci -- --strict` on the integrated main branch.

No command in this repository publishes, tags or releases, and this slice adds no workflow that does.
