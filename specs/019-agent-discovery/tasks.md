# Tasks: Agent discovery

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md), [contract](contracts/agent-guide.md),
[validation guide](quickstart.md).

**Format**: `T###` is one checklist task. `[P]` means the task touches different files from the other open tasks.
`[USn]` maps a task to a user story. Tests come with the code they cover.

**Rules for every task**: no new dependency, no new route, no new public API, no new root `npm run` script. The guide
holds no credential, header value or host value. Tests use the synthetic header value `synthetic-header-019`. Docs use
short plain sentences, no em dashes and no bold labels.

**Stories**: US1 the running server tells the agent (P1). US2 the project's agent instructions (P2). US3 the code that
mounts the inspector (P3).

## Phase 1: Guide and serving (US1)

- [x] T001 [US1] Add `packages/inspector/public/llms.txt` with the text of `contracts/agent-guide.md`. Indented code
  blocks only, no em dash.
- [x] T002 [US1] In `packages/inspector/src/server/core.ts`, map `.txt` to `text/plain; charset=utf-8`.
- [x] T003 [P] [US1] In `packages/inspector/src/app/index.html`, add `<link rel="describedby" type="text/plain" href="llms.txt" />`.
- [x] T004 [US1] Add `packages/inspector/tests/agent-guide/guide.test.ts`: the guide starts with `# agui-inspector` and a
  blockquote; names `config.json`, `#agent=`, `agui-inspector run`, `agui-inspector mcp`, `--header`, the launch links
  docs URL and the agent-guide docs URL; has no credential-like text (`Bearer ` or `Basic ` followed by a literal,
  `Authorization:` followed by anything but `$`); has no em dash; `index.html` has the describedby link. Unit tests run
  compiled under `.build`, where `buildApp` cannot resolve the app entry, so the built copy is checked in
  `packages/python/tests/test_distribution.py` instead: `dist/llms.txt` equals the source, and the wheel, the sdist and
  the installed wheel hold and serve it.
- [x] T005 [US1] In `packages/inspector/tests/server/core.test.ts`, serve the real `llms.txt` from the stand-in
  directory: 200, `text/plain; charset=utf-8`, same bytes. The helpers route every file below the mount to the core,
  which their existing tests cover, so the core test covers the guide for them.
- [x] T006 [US1] In `packages/python/tests/test_embedding.py`: the guide is served below the mount with the packaged
  bytes and a `text/plain` type; refused like the page when the host's middleware guards the mount; absent when the
  helper is disabled.

## Phase 2: Startup output (US1)

- [x] T007 [US1] `warnMounted` in `packages/inspector/src/server/core.ts` and the warning in
  `packages/python/src/agui_inspector/__init__.py` end with `; guide for coding agents at <mount>/llms.txt`. Update the
  exact-text tests in `packages/inspector/tests/server/{core,express,hono,next}.test.ts`,
  `packages/python/tests/test_embedding.py`, `tests/e2e/js-helpers/embedding.spec.ts` and
  `tests/e2e/js-helpers/package.spec.ts`.
- [x] T008 [US1] In `packages/inspector/src/cli/run.ts`, after the target lines, print
  `guide for coding agents: http://127.0.0.1:<port>/llms.txt`. Update `packages/inspector/tests/cli/run.test.ts`, and
  add a test that the guide served by the command with `--header "X-Key: synthetic-header-019"` equals the source and
  does not contain the value.
- [x] T009 [P] Dated notes in `specs/005-cli-proxy/contracts/command-line.md` and
  `specs/006-js-server-helpers/contracts/public-api.md` pointing to this spec for the new line and suffix.

## Phase 3: Docs (US2, US3)

- [x] T010 [US2] Add `website/content/docs/agent-guide.mdx`: why, where the guide is in each mode, the guide in one
  fenced block, three paste-ready blocks (Python embedded, JavaScript helpers, the command), and what the guide holds
  and does not. Add it to `website/content/docs/meta.json`.
- [x] T011 [US2] Extend `packages/inspector/tests/agent-guide/guide.test.ts`: the docs page contains the guide
  character for character; it has the three blocks, each naming `llms.txt`; no block has credential-like text;
  `tests-and-agents.mdx`, `embedding.mdx` and `cli.mdx` link to `agent-guide`.
- [x] T012 [P] [US3] Link the new page from `tests-and-agents.mdx`, `embedding.mdx` and `cli.mdx`; update the warning and
  listening examples there.
- [x] T013 [P] [US3] Name the guide in the `mount_inspector` docstring, the doc comments of `mountInspector` (Express,
  Hono) and `inspectorRoute` (Next.js), and `packages/inspector/README.md`.

## Phase 4: Release record

- [x] T014 [P] Add the 0.3.0 row to `ROADMAP.md`.
- [x] T015 [P] Add `.changeset/agent-discovery.md` for `agui-inspector` (minor) and `agui-inspector-python` (minor).
- [x] T016 Run `npm run check:ci` and the Python tests. Check the launch link docs URL against #109's branch by hand.

## Analysis, 2026-11-12

`speckit-analyze` pass over spec, plan and tasks after implementation started. Every FR maps to a task: FR-001 to
FR-003 to T001 and T004; FR-004 to T001; FR-005 to T004, T008 and T011; FR-006 to T006; FR-007 to T002, T005, T006 and
T008; FR-008 to T007 and T008; FR-009 to T003; FR-010 to T013; FR-011 and FR-012 to T010 and T011; FR-013 needs no
task. No constitution conflict. One gap fixed: in command mode `config.json` lists `/proxy/<n>/` paths, so the guide
now says the agent's `name` is the real endpoint to point the commands at (contract updated too).
