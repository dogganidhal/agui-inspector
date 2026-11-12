# Implementation Plan: Agent discovery

**Branch**: `worktree/agent-discovery-for-embedded-inspectors-e9e87b` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/019-agent-discovery/spec.md`, clarified on 2026-11-12.

## Summary

Ship one static Markdown file, `llms.txt`, in `packages/inspector/public/`. The build already copies that directory
into `dist/`, and every mode already serves every file of `dist/` below its mount, so the guide reaches the Python
helper, the JavaScript helpers, the command, the npm static assets, hosted deployments and the demo with no new route.
The guide names the page and `config.json` relative to its own address, so it needs no per-host value and is the same
bytes everywhere. Agents learn its address from the startup warning of the helpers, the listening output of the command,
a `rel="describedby"` link in the page, the helpers' documentation and a paste-ready block on a new docs page. Tests
keep the docs copy equal to the file and check that nothing secret is in either. No new dependency, no new public API.

## Technical Context

**Language/Version**: TypeScript (strict) for the JavaScript core and command; Python 3.10+ for `mount_inspector`;
Markdown and MDX for the guide and docs.

**Primary Dependencies**: none new.

**Storage**: none.

**Testing**: `node --test` through `npm run test:unit` (server core, helpers, command, docs equality, secret check,
build output); Python `unittest` in `packages/python/tests` (served bytes, content type, guarded mount); the existing
Playwright helper and Python end-to-end specs, updated for the warning text.

**Target Platform**: whatever already serves the page.

**Project Type**: a static file plus small edits in the existing helpers, command and docs.

**Performance Goals**: none. The file is about 3 KB.

**Constraints**: same bytes in every mode; no credential or host value; the host's authentication applies; the warning
still names the mount path (constitution, architecture constraints); docs plain, no em dashes.

**Scale/Scope**: one new file, one new docs page, about ten edited files, about ten edited tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle or rule | Before design | After design |
| --- | --- | --- |
| I. The wire comes first | Not touched | Pass. No change to recording, frames or the relay. |
| II. The protocol, not a framework | Not touched | Pass. |
| III. Generic core, application presets | The guide must not name a host's routes | Pass. The guide is relative to its own address and names example endpoints only as examples. |
| IV. Local-only operation and credential privacy | The guide is served to whoever reaches the page | Pass. It is static, holds no credential or host value, sends nothing and is served through the host's own routes and auth. A test checks that the command's served guide does not contain a synthetic header value. |
| V. Small and auditable | No dependency | Pass. One file, no generator, no new route. |
| VI. Every event type has a view | Not touched | Pass. |
| One static bundle | The guide is part of the bundle's files | Pass. It is in `dist/`, the one asset set every mode serves. It adds no code to the page bundle. |
| Python package without Node | Wheel stages `dist/` | Pass. `scripts/package-python.mjs` stages it with the other files. |
| Helpers log a startup warning with the mount path | The warning gains a suffix | Pass. The existing text, with the mount path, stays first. |
| CLI binds localhost, relays unchanged | One more output line | Pass. The line names the command's own loopback address, no header. |
| Scope through `ROADMAP.md` | Not listed | Pass after this plan adds a 0.3.0 row. |

## Project Structure

### Documentation (this feature)

```text
specs/019-agent-discovery/
├── spec.md
├── plan.md
├── research.md
├── quickstart.md
├── contracts/agent-guide.md
├── checklists/requirements.md
└── tasks.md            (speckit-tasks)
```

No `data-model.md`: the feature has no data beyond one text file, described in the contract.

### Source code

```text
packages/inspector/public/llms.txt                 new: the guide
packages/inspector/src/app/index.html              link rel="describedby"
packages/inspector/src/server/core.ts              '.txt' content type; warnMounted suffix
packages/inspector/src/server/{express,hono,next}.ts  doc comments name the guide
packages/inspector/src/cli/run.ts                  listening output: guide line
packages/inspector/README.md                       one paragraph
packages/python/src/agui_inspector/__init__.py     warning suffix; docstring
website/content/docs/agent-guide.mdx               new: guide copy and paste-ready blocks
website/content/docs/meta.json                     page order
website/content/docs/{tests-and-agents,embedding,cli}.mdx   link to the new page; warning and output examples
specs/005-cli-proxy/contracts/command-line.md      dated note: guide line
specs/006-js-server-helpers/contracts/public-api.md  dated note: warning suffix
ROADMAP.md                                         0.3.0 row
.changeset/agent-discovery.md                      both packages
```

Tests:

```text
packages/inspector/tests/agent-guide/guide.test.ts   new: structure, facts, no secret, docs copy equal, blocks, index.html link, dist copy
packages/inspector/tests/server/core.test.ts         llms.txt served as text/plain, same bytes; warning text
packages/inspector/tests/server/{express,hono,next}.test.ts  warning text; llms.txt served under the mount
packages/inspector/tests/cli/run.test.ts             guide line; served guide holds no synthetic header value
packages/python/tests/test_embedding.py              served bytes and type; refused like the page when guarded; not served when disabled; warning text
tests/e2e/js-helpers/{embedding,package}.spec.ts     warning text
```

## Phases

1. Guide and serving: `llms.txt`, the content type in `core.ts`, the `index.html` link. Tests: guide test, core test,
   Python served-bytes test.
2. Startup output: `warnMounted`, the Python warning, the command's line. Tests and contract notes updated with them.
3. Docs: `agent-guide.mdx` with the guide and three blocks, links from three pages, warning examples, README,
   docstrings. Docs equality test.
4. Release record: ROADMAP row, changeset for both packages, `npm run check:ci`.

## Risks

- #109 renames or moves the launch link docs before merging. The guide links to `/docs/launch-links/`; if that changes,
  update the guide and the docs copy together (the equality test catches only the copy, so the plan checks the link by
  hand before the PR leaves draft).
- An adopter already serves their own `llms.txt` at the site root. Ours is only below the mount, so there is no clash.
- Log scrapers that match the whole warning line. The prefix is unchanged; the changeset says the line grew.

## Complexity Tracking

None.
