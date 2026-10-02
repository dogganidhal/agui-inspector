# Distribution

`agui-inspector` is the approved package name on npm and PyPI (gate G-02). On 2026-10-02 it was unregistered on
both registries. Nothing is published today: there is no publishing workflow, no tag, no release, both package
manifests are private, and registering a name or publishing remains unauthorized. This page keeps the
requirements from FR-040 and the constitution so they are not lost, and lists what has to be true before any
of them is acted on.

## Current state

- `.github/workflows/ci.yml` runs on pull requests with read-only access. It builds and tests only, on Python
  3.10 and 3.14.
- The repository is MIT licensed, `Copyright (c) 2026 Nidhal Dogga` (`LICENSE`), and ships
  `THIRD_PARTY_NOTICES.txt` for the bundled dependencies. See [dependencies](dependencies.md).
- The npm manifests carry `"license": "MIT"` and `"private": true`. The npm `files` list and the Python
  `license-files` include `LICENSE` and `THIRD_PARTY_NOTICES.txt`, so the npm tarball, the wheel and the sdist all
  contain them. `packages/python/tests/test_distribution.py` asserts it.
- The Python package carries `License-Expression: MIT` and keeps the `Private :: Do Not Upload` classifier.
- Local packaging and checks of the inputs a provenance statement would cover are allowed.
  Publishing, registering a name, tagging and releasing are not.

## Gates

| Gate | Status | What it decides |
| --- | --- | --- |
| G-01 license | Closed 2026-10-02: MIT. | `LICENSE` and third-party notices ship in every distribution. Publication is still unauthorized under FR-040. |
| G-02 package names | Closed 2026-10-02: `agui-inspector` on npm and PyPI, both unregistered that day. | The identity in both manifests. It does not authorize registering or publishing the name. |
| G-03 upstream placement | Open. | Whether upstream accepts the inspector under `apps/inspector`, and when. `@ag-ui/inspector` is a conditional name that applies only if upstream adopts the project; nothing registers or reserves it. |

Publication also needs every item in the next section. If a gate is unresolved, the answer is to
stop and ask, not to pick a default.

## Required release process (not implemented)

These are retained from FR-040, the constitution's quality gates and the product brief's security
section. Each one has to be built, reviewed and exercised before a release. None of it exists yet.

1. **Reviewed tag-triggered CI build.** A release is built by CI from a version tag, not from a
   developer machine. The release workflow gets its own review, separate from the pull request
   workflow. It pins every action to a full commit SHA, requests only the permissions it needs, and
   builds from the tagged commit with `npm ci --ignore-scripts`.
2. **Semantic versioning.** Versions follow semantic versioning. Product 0.1.0 is the HTTP/SSE MVP.
   Before 1.0.0, changes to the config, session, profile and plugin formats document their migration
   in a changelog.
3. **npm provenance.** The npm package is published from that CI build with provenance, so a
   consumer can verify which commit and workflow produced it.
4. **PyPI trusted publishing.** The Python package is published through PyPI trusted publishing from
   the same CI build, with no long-lived PyPI token stored in the repository.
5. **Same assets in both packages.** The wheel and the npm package ship the same prebuilt static
   assets, checked by comparing checksums. The Python package needs no Node toolchain on the host.
6. **Passing integrated gate.** `npm run check:ci -- --strict` passes on the integrated main branch
   (see `docs/development.md`), and the hardware benchmark has been run on the physical runner.
7. **License and name gates.** G-01 and G-02 are closed, and the dependency license obligations
   are met by `LICENSE` and `THIRD_PARTY_NOTICES.txt`. G-03 stays open: moving to `@ag-ui/inspector` needs
   upstream adoption first.

Adding a publishing workflow, a tag, a release or a registry registration is outside the 0.1.0 MVP slices,
including release hygiene (D01). It needs the gates above and an explicit decision.
