# Distribution

`agui-inspector` is the approved package name on npm and PyPI (gate G-02). On 2026-10-02 it was unregistered on
both registries. Nothing is published today. The Python release workflow exists, but no tag has run it, both
package manifests are still private, and the npm release is not set up. This page lists what has to be true
before a release and how to cut the Python one.

## Current state

- `.github/workflows/ci.yml` runs on pull requests with read-only access. It builds and tests only, on Python
  3.10 and 3.14.
- `.github/workflows/release-python.yml` runs on pushes to `main` and is driven by Changesets. It is the only
  workflow that publishes. See [Python release](#python-release).
- The repository is MIT licensed, `Copyright (c) 2026 Nidhal Dogga` (`LICENSE`), and ships
  `THIRD_PARTY_NOTICES.txt` for the bundled dependencies. See [dependencies](dependencies.md).
- The npm manifests carry `"license": "MIT"` and `"private": true`. The npm `files` list and the Python
  `license-files` include `LICENSE` and `THIRD_PARTY_NOTICES.txt`, so the npm tarball, the wheel and the sdist all
  contain them. `packages/python/tests/test_distribution.py` asserts it.
- The Python package carries `License-Expression: MIT` and still has the `Private :: Do Not Upload` classifier.
  PyPI rejects an upload that has it, so the classifier stays until the first release (see below).
- Local packaging and checks of the inputs a provenance statement would cover are allowed.

## Gates

| Gate | Status | What it decides |
| --- | --- | --- |
| G-01 license | Closed 2026-10-02: MIT. | `LICENSE` and third-party notices ship in every distribution. |
| G-02 package names | Closed 2026-10-02: `agui-inspector` on npm and PyPI, both unregistered that day. | The identity in both manifests. Registering the name is the first PyPI publish, below. |
| G-03 upstream placement | Open. | Whether upstream accepts the inspector under `apps/inspector`, and when. `@ag-ui/inspector` is a conditional name that applies only if upstream adopts the project; nothing registers or reserves it. |

If a gate is unresolved, the answer is to stop and ask, not to pick a default.

## Python release

Changesets choose the version and the workflow does the rest. No PyPI token is stored in the repository.

1. A pull request that changes what the Python package does or ships adds a changeset with `npx changeset`: pick
   `agui-inspector-python`, the bump type and one line for the changelog. The wheel bundles the inspector assets, so a
   user-visible change to the inspector needs one too. Before 1.0.0, a change to a config, session, profile or plugin
   format also puts its migration in that line, which is how the changelog documents it.
2. On every push to `main`, `release-python.yml` runs `changesets/action`. With pending changesets it opens or updates
   a `chore: version packages` pull request. That pull request runs `scripts/changeset-version.mjs`, which bumps
   `packages/python/package.json` (a private file that only holds the version for Changesets), writes
   `packages/python/CHANGELOG.md`, copies the version into `pyproject.toml` and refreshes `uv.lock`. Only plain `x.y.z`
   versions work; the script refuses a pre-release, so do not use `changeset pre`.
3. Merging the version pull request is the release. The next run tags the commit `agui-inspector-python@<version>`,
   then two more jobs run.

The build job has `contents: read` and does this:

1. Refuses the commit unless it carries the tag for the version in `packages/python/pyproject.toml`, and unless the
   `Private ::` classifier is gone.
2. Installs with `npm ci --ignore-scripts` and runs `npm run check:ci -- --strict`, the integrated gate, on
   Python 3.14. Pull request CI has already covered 3.10 and 3.14.
3. Runs `npm run package:python -- --no-build` to build the wheel and sdist from the build the gate checked, and
   uploads them as an artifact.

The publish job has `id-token: write` and uses the environment `pypi`. It downloads that artifact and uploads it
with `pypa/gh-action-pypi-publish`, which also publishes PEP 740 attestations. It runs no repository code.

Only the version job can write to the repository (`contents: write`, `pull-requests: write`). It pushes tags and the
version branch, and creates no GitHub release. Every action is pinned to a full commit SHA. The
`test_the_release_workflow_versions_with_changesets_and_publishes_only_through_trusted_publishing` test fails if the
trigger widens, a token or an extra write permission appears, or a pin loosens, and
`tests/release/changeset.test.ts` fails if the version copies drift apart.

### One-time setup

Only the maintainer can do these. Nothing in the repository changes a setting.

1. On PyPI, add a pending publisher at <https://pypi.org/manage/account/publishing/>: project `agui-inspector`,
   owner `dogganidhal`, repository `agui-inspector`, workflow `release-python.yml`, environment `pypi`. The first
   successful publish creates the project and takes the name.
2. In the repository settings, create the environment `pypi`. Add yourself as a required reviewer, so every
   publish waits for an approval, and limit deployment to the `main` branch.
3. Under Settings, Actions, General, allow GitHub Actions to create and approve pull requests. The version pull
   request cannot be opened without it.
4. Before the workflow reaches `main`, tag a commit on `main` with the current version and push the tag:
   `git tag agui-inspector-python@0.0.0 <commit> && git push origin agui-inspector-python@0.0.0`. Changesets tags
   any package whose current version has no tag, so without this the first run tags 0.0.0 and the build job stops
   at the classifier check. Delete that stray tag if it happens.

### Cutting a release

1. Check the gates that CI cannot: the headed benchmark on the physical runner (SC-009, see
   [development](development.md#integrated-mvp-gate)), and the manual smoke run of each distribution mode.
2. For the first release, merge a pull request that removes the `Private :: Do Not Upload` classifier, updates the
   tests that assert it (`test_distribution.py`) and the docs that call the package private. The build job refuses to
   publish until that is on `main`. A `minor` changeset takes the package from 0.0.0 to 0.1.0.
3. Merge the `chore: version packages` pull request. A pull request opened by GitHub Actions does not start the
   pull request workflows, so its required checks stay pending: close and reopen it once to run `ci.yml`.
4. Approve the `pypi` deployment when the publish job waits. When it finishes, check the files and their
   attestations on <https://pypi.org/project/agui-inspector/>.

A published version cannot be replaced. To fix a bad release, yank it on PyPI and publish the next version.

## npm release (not set up)

FR-040 also requires the npm package to be built by CI from a version tag and published with npm provenance, from
the same build and with the same static assets as the wheel (the wheel's `static.sha256` against the npm files, as
the local tests do now). None of that exists: `release-python.yml` touches npm only to build the assets, and
Changesets ignores `agui-inspector` (`ignore` in `.changeset/config.json`). To bring it in, drop that entry, put both
packages in a `fixed` group so the versions move together, and add a publish job with npm provenance. The root and
`packages/inspector` manifests stay `"private": true` until an explicit decision to publish, and `@ag-ui/inspector`
still waits on G-03.
