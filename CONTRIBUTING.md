# Contributing

Bug reports, fixes and ideas are welcome. This page explains what a change needs before it can merge.

## Issues

Use the [issue forms](https://github.com/dogganidhal/agui-inspector/issues/new/choose). For a bug, say which mode you
used (public demo, hosted, embedded or static assets), the browser, and what the server sent. A session export shows
exactly what the inspector received, but it holds raw frames and request bodies. Attach one only if it contains
synthetic or redacted data.

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).

## Scope

[ROADMAP.md](ROADMAP.md) says what each release contains, and the [constitution](.specify/memory/constitution.md) sets
the engineering rules. Fixes and small improvements inside that scope can go straight to a pull request. For a new
capability, open an issue first: features are specified under [`specs/`](specs) with [Spec Kit](https://github.com/github/spec-kit)
before they are built, and the 1.0.0 items in the roadmap have no specification yet.

## Setup

You need Node 24 or newer and npm. The Python package also needs [uv](https://docs.astral.sh/uv/).

```sh
npm ci --ignore-scripts
npx playwright install chromium
```

Never install with lifecycle scripts enabled; `.npmrc` turns them off. esbuild and TypeScript ship their binaries as
optional packages, so they work without scripts.

## Checks

Run the pull request gate before you push:

```sh
npm run check:ci
```

It runs the type checks, unit tests, the build, the bundle budget, the public demo build, the Playwright suite and the
Python tests, in that order, and stops at the first failure. Narrower commands are faster while you work:

| Command | What it runs |
| --- | --- |
| `npm run typecheck` | Strict TypeScript over the tooling and `packages/inspector`. |
| `npm run test:unit -- packages/inspector/tests/frames` | Unit tests under the given paths. |
| `npm run test:e2e -- tests/e2e/inspection` | Playwright specs under the given paths. |
| `npm run build && npm run check:bundle` | The bundle and its 2 MB minified, 600 KB gzipped budget. |

[docs/development.md](docs/development.md) lists every command, and a test fails if a root script is missing from it.

## What reviewers look for

- The wire comes first. Recorded frames keep their bytes, order and timing, and a malformed frame stays inspectable.
- Behavior changes come with a regression test. End-to-end tests use the scripted reference agent in
  `examples/reference-agent`, never a model or a network service.
- A change to protocol handling updates the views, fixtures and docs for that event type together.
- Credentials stay in memory. Nothing new is written to storage, exports or logs, the recorder reads no headers, and the
  page makes no request of its own to third parties.
- A new dependency has to earn its place. Pin the exact version, commit the lockfile, and add a row to
  [docs/dependencies.md](docs/dependencies.md) saying why the platform or an existing dependency could not do the job.
  A test checks that every direct dependency has one.
- Docs change in the same pull request as the behavior they describe.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`,
`ci:`, `build:` or `chore:`, then a short sentence that says what changes. Fill in the
[pull request template](.github/PULL_REQUEST_TEMPLATE.md) and tick only what you checked.

If the change alters what the Python package does or ships, add a changeset:

```sh
npx changeset
```

Pick `agui-inspector-python`, the bump type and a line for the changelog. The wheel bundles the inspector page, so a
user-visible change to the inspector counts. Docs-only and test-only changes need none. Never edit a version by hand;
the release workflow does that.

## License

By contributing, you agree that your contribution is licensed under the [MIT License](LICENSE). Everyone taking part
follows the [code of conduct](CODE_OF_CONDUCT.md).
