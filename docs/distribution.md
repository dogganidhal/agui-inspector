# Distribution

`agui-inspector` is a working name. Nothing is published today. There is no publishing workflow, no
tag, no release, no `LICENSE` file, and both package manifests are private. This page keeps the
requirements from FR-040 and the constitution so they are not lost, and lists what has to be true
before any of them is acted on.

## Current state

- `.github/workflows/ci.yml` runs on pull requests with read-only access. It builds and tests only.
- Both the workspace and `packages/inspector` are `"private": true` and carry no `license` value.
- The planned Python package will be private in the same way until the gates below are cleared.
- Local packaging and checks of the inputs a provenance statement would cover are allowed.
  Publishing, creating a license, tagging and releasing are not.

## Gates that block publication

| Gate | What it decides | Owner |
| --- | --- | --- |
| G-01 license | The final license and the obligations of the dependencies. The MIT candidate from the original brief is not adopted. A `LICENSE` file and a `license` field wait for this decision. | Project maintainer, with dependency and legal review. |
| G-02 package names | Whether the working name is free on npm and PyPI, and whether an upstream namespace is involved. Until then no public package identity exists. | Project maintainer, and the upstream namespace owner if relevant. |

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
7. **License and name gates.** G-01 and G-02 are resolved, and the dependency license obligations
   are met.

Adding a publishing workflow, a tag, a release or a `LICENSE` file is outside slice F02. It needs the
gates above and an explicit decision.
